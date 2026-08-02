// ============================================================================
// [INSA category: PUBLIC] check-admission-status
// Lets an applicant (no account, no session) look up how their admission
// application is progressing using the tracking code they were given at
// submission time (submit-admission's response). Same shape as verify-id:
// a rate-limited service_role Edge Function is the only path in, since
// admission_applications has no anon RLS policy — never a direct table
// read or an anon-callable RPC.
//
// Deliberately minimal-disclosure: returns only what an applicant needs to
// see their own progress (name, grade, stage, submitted date) — never
// guardian contact info, documents, or payment details, even though the
// caller already proved they hold the code.
//
// When the application has been converted to a student (stage 'enrolled',
// converted_student_id set), also mints a short-lived signed URL for that
// student's most recent id_cards row so the status page can show the ID
// card PDF alongside the congratulations message. The row itself is never
// exposed — id_cards has no anon policy and none is added here; this
// function does the lookup server-side with the service-role client, same
// as everything else in it.
// ============================================================================
import { z } from "npm:zod@3";
import { createClient } from "npm:@supabase/supabase-js@2";
import { errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const Payload = z.object({
  tenant_slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  tracking_code: z.string().min(1).max(20),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!(await rateLimit(`admission-status:${ip}`, 20, 60_000))) return errors.tooMany(60);

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;

    // Normalize the same way the code is displayed to the applicant
    // (dash-grouped, uppercase) so copy/paste or manual retyping both work.
    const code = p.tracking_code.replace(/[\s-]/g, "").toUpperCase();

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tenant } = await db.from("tenants").select("id").eq("slug", p.tenant_slug).maybeSingle();
    if (!tenant) return json({ found: false }, 200);

    const { data: application } = await db.from("admission_applications")
      .select("applicant_name, desired_grade, stage, created_at, converted_student_id")
      .eq("tenant_id", tenant.id)
      .eq("tracking_code", code)
      .maybeSingle();

    if (!application) return json({ found: false }, 200);

    let idCardUrl: string | null = null;
    if (application.stage === "enrolled" && application.converted_student_id) {
      const { data: card } = await db.from("id_cards")
        .select("pdf_path, id_card_batches!inner(created_at)")
        .eq("subject_type", "student")
        .eq("subject_id", application.converted_student_id)
        .order("created_at", { referencedTable: "id_card_batches", ascending: false })
        .limit(1)
        .maybeSingle();
      if (card?.pdf_path) {
        const { data: signed } = await db.storage.from("id-cards").createSignedUrl(card.pdf_path, 300);
        idCardUrl = signed?.signedUrl ?? null;
      }
    }

    return json({
      found: true,
      applicant_name: application.applicant_name,
      grade: application.desired_grade,
      stage: application.stage,
      submitted_on: application.created_at,
      id_card_url: idCardUrl,
    }, 200);
  } catch (err) {
    console.error("check-admission-status failed", { message: (err as Error).message });
    return errors.internal();
  }
});
