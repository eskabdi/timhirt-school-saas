// ============================================================================
// [INSA category: PUBLIC] verify-admission-bank-url
// Fees step of the public registration stepper: alongside the existing
// manual receipt-image upload, an applicant can paste a bank-generated
// verification URL (a PDF the bank itself hosts). This function fetches it
// server-side and checks it via the shared verifyBankUrl() SSRF-safe chain
// (_shared/bank-verify.ts) against the super_admin-managed allow-list
// (bank_verification_domains).
//
// Same anonymous-but-stage-gated shape as upload-admission-document: no
// session exists for an applicant, so this gates on the application still
// being in its initial 'applied' stage rather than requiring auth, closing
// off tampering with someone else's already-reviewed application via a
// guessed/leaked id.
//
// Rate limit is 10/hour/IP -- tighter than upload-admission-document's
// 20/hour, because a network fetch this function performs on the caller's
// behalf is a more expensive/riskier operation to expose publicly than a
// file upload.
//
// Unlike record-fee-payment's optional bank-verification field (Part 2's
// second call site), a failed check HERE blocks the registrant: this is
// establishing trust for an anonymous submitter before any human has looked
// at the application, so the URL/domain has to actually check out.
// ============================================================================
import { z } from "npm:zod@3";
import { checkAndStoreBankUrl } from "../_shared/bank-verification-record.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";
import { verifyBankUrl } from "../_shared/bank-verify.ts";

const Payload = z.object({
  application_id: z.string().uuid(),
  payment_method: z.enum(["cbe", "awash_bank", "telebirr"]),
  verification_url: z.string().trim().url().max(2048), // https is enforced below (FS-1)
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!(await rateLimit(`admission-bank-verify:${ip}`, 10, 3_600_000))) return errors.tooMany(3600);

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: application } = await db.from("admission_applications")
      .select("id, tenant_id, stage").eq("id", p.application_id).maybeSingle();
    if (!application || application.stage !== "applied") return errors.badRequest();

    const result = await checkAndStoreBankUrl({ db, verify: verifyBankUrl }, {
      tenantId: application.tenant_id,
      target: { admission_application_id: application.id },
      paymentMethod: p.payment_method, verificationUrl: p.verification_url,
    });

    if (result.status === "failed") return json({ ok: false, status: "failed", reason: result.reason }, 200);
    return json({ ok: true, status: "verified" }, 200);
  } catch (err) {
    console.error("verify-admission-bank-url failed", { message: (err as Error).message });
    return errors.internal();
  }
});
