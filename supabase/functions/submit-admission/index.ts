// ============================================================================
// [INSA category: PUBLIC] submit-admission
// Anonymous submissions from the public /apply/:tenantSlug registration
// stepper (§19.2). RLS has NO anon policy on admission_applications — this
// Edge Function (service_role) is the only insert path. Rate-limited per IP;
// strict allow-list Zod validation; resolves tenant by slug (never trusts a
// tenant_id from the client). A CAPTCHA/Turnstile token would be verified
// here in production before insert (left as an integration point).
//
// GET ?tenant_slug=... additionally exposes the tenant's class list (for the
// stepper's "Applying for Grade" picker) — `classes` has no anon RLS policy
// either (tenant-scoped, authenticated-only), and this codebase's convention
// is every public flow goes through an Edge Function with service_role,
// never a direct anon-callable RPC (see verify-id's comment on the same
// point) — so this stays in the one function rather than adding a new
// anon-executable database function.
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
  desired_class_id: z.string().uuid(),

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (req.method === "GET") {
    try {
      if (!rateLimit(`admission-grades:${ip}`, 30, 60_000)) return errors.tooMany(60);
      const url = new URL(req.url);
      const tenantSlug = url.searchParams.get("tenant_slug") ?? "";
      if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(tenantSlug)) return errors.badRequest();

      const db = adminClient();
      const { data: tenant } = await db.from("tenants").select("id, name").eq("slug", tenantSlug).maybeSingle();
      if (!tenant) return errors.badRequest();

      const { data: classes, error } = await db.from("classes")
        .select("id, name, section").eq("tenant_id", tenant.id).order("name");
      if (error) throw error;

      return json({ tenant_name: tenant.name, classes: classes ?? [] }, 200);
    } catch (err) {
      console.error("submit-admission (GET) failed", { message: (err as Error).message });
      return errors.internal();
    }
  }

  try {
    if (req.method !== "POST") return errors.badRequest();

    // Rate limit by client IP (defense against form abuse — INSA API hardening)
    if (!rateLimit(`admission:${ip}`, 5, 3_600_000)) return errors.tooMany(3600);

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;

    const db = adminClient();

    const { data: tenant } = await db.from("tenants").select("id").eq("slug", p.tenant_slug).maybeSingle();
    if (!tenant) return errors.badRequest();

    const { data: cls } = await db.from("classes").select("id").eq("id", p.desired_class_id).eq("tenant_id", tenant.id).maybeSingle();
    if (!cls) return errors.badRequest();

    const applicantName = `${p.applicant_first_name} ${p.applicant_middle_name} ${p.applicant_last_name}`;

    const { data: application, error } = await db.from("admission_applications").insert({
      tenant_id: tenant.id,
      applicant_name: applicantName,
      applicant_first_name: p.applicant_first_name,
      applicant_first_name_am: p.applicant_first_name_am,
      applicant_middle_name: p.applicant_middle_name,
      applicant_middle_name_am: p.applicant_middle_name_am,
      applicant_last_name: p.applicant_last_name,
      applicant_last_name_am: p.applicant_last_name_am,
      date_of_birth: p.date_of_birth,
      gender: p.gender,
      desired_class_id: p.desired_class_id,
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

    return json({ application_id: application.id }, 201);
  } catch (err) {
    console.error("submit-admission failed", { message: (err as Error).message });
    return errors.internal();
  }
});
