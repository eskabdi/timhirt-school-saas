// ============================================================================
// [INSA category: PUBLIC] submit-admission
// Anonymous submissions from the public /apply/:tenantSlug registration
// stepper (§19.2). RLS has NO anon policy on admission_applications — this
// Edge Function (service_role) is the only insert path. Rate-limited per IP;
// strict allow-list Zod validation; resolves tenant by slug (never trusts a
// tenant_id from the client). A CAPTCHA/Turnstile token would be verified
// here in production before insert (left as an integration point).
//
// GET ?tenant_slug=... additionally exposes the tenant's grade list (for the
// stepper's "Applying for Grade" picker) — `classes` has no anon RLS policy
// either (tenant-scoped, authenticated-only), and this codebase's convention
// is every public flow goes through an Edge Function with service_role,
// never a direct anon-callable RPC (see verify-id's comment on the same
// point) — so this stays in the one function rather than adding a new
// anon-executable database function.
//
// The applicant chooses only a grade (e.g. "Grade 5"), never a specific
// section — sections (A/B/C…) are assigned by the admin at enrollment time
// based on remaining capacity, so the picker is deduplicated by class name
// and ordered by grade_level (falls back to name for legacy classes that
// predate that column).
// ============================================================================
import { z } from "npm:zod@3";
import { createClient } from "npm:@supabase/supabase-js@2";
import { errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const Payload = z.object({
  tenant_slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),

  applicant_first_name: z.string().trim().min(1).max(80),
  applicant_first_name_am: z.string().trim().min(1).max(80),
  applicant_middle_name: z.string().trim().min(1).max(80),
  applicant_middle_name_am: z.string().trim().min(1).max(80),
  applicant_last_name: z.string().trim().min(1).max(80),
  applicant_last_name_am: z.string().trim().min(1).max(80),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(["male", "female", "other"]),
  desired_grade: z.string().trim().min(1).max(40),

  guardian_name: z.string().trim().min(1).max(120),
  guardian_name_am: z.string().trim().min(1).max(120),
  guardian_relationship: z.enum(["father", "mother", "guardian", "other"]),
  guardian_occupation: z.string().trim().max(120).optional().or(z.literal("")),
  guardian_phone: z.string().regex(/^\+?[0-9]{7,15}$/),
  guardian_email: z.string().email().max(254).optional().or(z.literal("")),
  guardian_region: z.string().trim().max(80).optional().or(z.literal("")),
  guardian_subcity: z.string().trim().max(80).optional().or(z.literal("")),
  guardian_woreda_kebele: z.string().trim().max(80).optional().or(z.literal("")),
  guardian_house_number: z.string().trim().max(40).optional().or(z.literal("")),
});

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// Unambiguous alphabet (no 0/O/1/I/L) — this code is read off a screen and
// typed back in later on check-admission-status, not scanned from a QR code
// like id_cards.verify_code, so it needs to survive a parent squinting at a
// low-end phone. 10 chars ~= 50 bits of entropy (see migration
// 20260719000002) — enumerating another applicant's status this way is
// computationally infeasible, and the lookup endpoint is rate-limited too.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateTrackingCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (req.method === "GET") {
    try {
      if (!(await rateLimit(`admission-grades:${ip}`, 30, 60_000))) return errors.tooMany(60);
      const url = new URL(req.url);
      const tenantSlug = url.searchParams.get("tenant_slug") ?? "";
      if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(tenantSlug)) return errors.badRequest();

      const db = adminClient();
      const { data: tenant } = await db.from("tenants").select("id, name").eq("slug", tenantSlug).maybeSingle();
      if (!tenant) return errors.badRequest();

      const { data: classes, error } = await db.from("classes")
        .select("id, name, grade_level").eq("tenant_id", tenant.id);
      if (error) throw error;

      const byName = new Map<string, number | null>();
      // A grade name can cover several class sections (7A, 7B); the fee schedule
      // is per grade, so every class id under a name maps back to that name.
      const classIdToGrade = new Map<string, string>();
      for (const c of classes ?? []) {
        if (!byName.has(c.name)) byName.set(c.name, c.grade_level);
        classIdToGrade.set(c.id, c.name);
      }
      const grades = [...byName.entries()]
        .map(([name, grade_level]) => ({ name, grade_level }))
        .sort((a, b) => {
          if (a.grade_level == null && b.grade_level == null) return a.name.localeCompare(b.name);
          if (a.grade_level == null) return 1;
          if (b.grade_level == null) return -1;
          return a.grade_level - b.grade_level;
        });

      // Applicants pay against the total shown on Step 4 and upload a receipt
      // for it, so the figures have to be the tenant's own. Like `classes`,
      // fee_structures has no anon policy — it is read here with the service
      // role and reduced to just the fields the fee table needs.
      //
      // class_id null means the fee applies to the whole school; a fee scoped
      // to a class is keyed to that class's grade name, which is what the
      // applicant picked in Step 1.
      const { data: fees, error: feeErr } = await db.from("fee_structures")
        .select("name_i18n, amount, billing_cycle, class_id").eq("tenant_id", tenant.id);
      if (feeErr) throw feeErr;

      const feeSchedule = (fees ?? [])
        .filter((f) => f.class_id == null || classIdToGrade.has(f.class_id))
        .map((f) => ({
          name_i18n: f.name_i18n,
          amount: Number(f.amount),
          billing_cycle: f.billing_cycle,
          grade: f.class_id == null ? null : classIdToGrade.get(f.class_id) ?? null,
        }))
        .sort((a, b) => b.amount - a.amount);

      return json({ tenant_name: tenant.name, grades, fees: feeSchedule }, 200);
    } catch (err) {
      console.error("submit-admission (GET) failed", { message: (err as Error).message });
      return errors.internal();
    }
  }

  try {
    if (req.method !== "POST") return errors.badRequest();

    // Rate limit by client IP (defense against form abuse — INSA API hardening)
    if (!(await rateLimit(`admission:${ip}`, 5, 3_600_000))) return errors.tooMany(3600);

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;

    const db = adminClient();

    const { data: tenant } = await db.from("tenants").select("id").eq("slug", p.tenant_slug).maybeSingle();
    if (!tenant) return errors.badRequest();

    // Multiple sections can share a grade name (e.g. "Grade 5" A/B/C), so
    // this only confirms the grade exists for the tenant — .maybeSingle()
    // would throw on more than one match.
    const { data: cls } = await db.from("classes").select("id").eq("name", p.desired_grade).eq("tenant_id", tenant.id).limit(1);
    if (!cls?.length) return errors.badRequest();

    const applicantName = `${p.applicant_first_name} ${p.applicant_middle_name} ${p.applicant_last_name}`;
    const trackingCode = generateTrackingCode();

    const { data: application, error } = await db.from("admission_applications").insert({
      tenant_id: tenant.id,
      applicant_name: applicantName,
      tracking_code: trackingCode,
      applicant_first_name: p.applicant_first_name,
      applicant_first_name_am: p.applicant_first_name_am,
      applicant_middle_name: p.applicant_middle_name,
      applicant_middle_name_am: p.applicant_middle_name_am,
      applicant_last_name: p.applicant_last_name,
      applicant_last_name_am: p.applicant_last_name_am,
      date_of_birth: p.date_of_birth,
      gender: p.gender,
      desired_grade: p.desired_grade,
      guardian_name: p.guardian_name,
      guardian_name_am: p.guardian_name_am,
      guardian_relationship: p.guardian_relationship,
      guardian_occupation: p.guardian_occupation || null,
      guardian_phone: p.guardian_phone,
      guardian_email: p.guardian_email || null,
      guardian_region: p.guardian_region || null,
      guardian_subcity: p.guardian_subcity || null,
      guardian_woreda_kebele: p.guardian_woreda_kebele || null,
      guardian_house_number: p.guardian_house_number || null,
      stage: "applied",
    }).select("id").single();
    if (error) throw error;

    return json({ application_id: application.id, tracking_code: trackingCode }, 201);
  } catch (err) {
    console.error("submit-admission failed", { message: (err as Error).message });
    return errors.internal();
  }
});
