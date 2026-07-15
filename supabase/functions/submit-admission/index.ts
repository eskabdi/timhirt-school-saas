// ============================================================================
// [INSA category: PUBLIC] submit-admission
// Anonymous submissions from the public /apply/:tenantSlug form (§19.2).
// RLS has NO anon policy on admission_applications — this Edge Function
// (service_role) is the only insert path. Rate-limited per IP; strict
// allow-list Zod validation; resolves tenant by slug (never trusts a tenant_id
// from the client). A CAPTCHA/Turnstile token would be verified here in
// production before insert (left as an integration point).
// ============================================================================
import { z } from "npm:zod@3";
import { createClient } from "npm:@supabase/supabase-js@2";
import { errors, json, rateLimit } from "../_shared/security.ts";

const Payload = z.object({
  tenant_slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  applicant_name: z.string().trim().min(1).max(120),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guardian_name: z.string().trim().min(1).max(120),
  guardian_phone: z.string().regex(/^\+?[0-9]{7,15}$/),
  guardian_email: z.string().email().max(254).optional().or(z.literal("")),
});

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return errors.badRequest();

    // Rate limit by client IP (defense against form abuse — INSA API hardening)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!rateLimit(`admission:${ip}`, 5, 3_600_000)) return errors.tooMany(3600);

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tenant } = await db.from("tenants").select("id").eq("slug", p.tenant_slug).maybeSingle();
    if (!tenant) return errors.badRequest();

    const { error } = await db.from("admission_applications").insert({
      tenant_id: tenant.id,
      applicant_name: p.applicant_name,
      date_of_birth: p.date_of_birth,
      guardian_name: p.guardian_name,
      guardian_phone: p.guardian_phone,
      guardian_email: p.guardian_email || null,
      stage: "applied",
    });
    if (error) throw error;

    return json({ received: true }, 201);
  } catch (err) {
    console.error("submit-admission failed", { message: (err as Error).message });
    return errors.internal();
  }
});
