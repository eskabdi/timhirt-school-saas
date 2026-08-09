// ============================================================================
// [INSA category: PUBLIC] upload-admission-document
// Documents + Fees steps of the public registration stepper. Anonymous —
// no session exists for an applicant — so this accepts multipart/form-data
// (application_id, doc_type, file) rather than requiring auth, and instead
// gates on the application still being in its initial 'applied' stage
// (prevents tampering with someone else's already-reviewed application via
// a guessed/leaked id). RLS has no anon policy on admission-documents either
// path — this Edge Function (service_role) is the only write path, same
// pattern as submit-admission.
// ============================================================================
import { z } from "npm:zod@3";
import { createClient } from "npm:@supabase/supabase-js@2";
import { errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const DOC_TYPES = ["birth_certificate", "transcript", "photo", "payment_receipt"] as const;
type DocType = typeof DOC_TYPES[number];

const PATH_COLUMN: Record<DocType, string> = {
  birth_certificate: "birth_certificate_path",
  transcript: "transcript_path",
  photo: "photo_path",
  payment_receipt: "payment_receipt_path",
};

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const PaymentExtra = z.object({
  payment_method: z.enum(["cbe", "awash_bank", "telebirr"]),
  bus_service_opted: z.enum(["true", "false"]).transform((v) => v === "true"),
  fees_total_etb: z.coerce.number().min(0).max(1_000_000),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!(await rateLimit(`admission-upload:${ip}`, 20, 3_600_000))) return errors.tooMany(3600);

    const form = await req.formData().catch(() => null);
    if (!form) return errors.badRequest();

    const applicationId = form.get("application_id");
    const docType = form.get("doc_type");
    const file = form.get("file");

    if (typeof applicationId !== "string" || !z.string().uuid().safeParse(applicationId).success) return errors.badRequest();
    if (typeof docType !== "string" || !DOC_TYPES.includes(docType as DocType)) return errors.badRequest();
    if (!(file instanceof File)) return errors.badRequest();
    if (!(file.type in MIME_EXT)) return errors.badRequest();
    if (file.size > 5 * 1024 * 1024) return errors.badRequest();

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: application } = await db.from("admission_applications")
      .select("id, tenant_id, stage").eq("id", applicationId).maybeSingle();
    if (!application || application.stage !== "applied") return errors.badRequest();

    const ext = MIME_EXT[file.type];
    const objectPath = `${application.tenant_id}/${application.id}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadErr } = await db.storage.from("admission-documents")
      .upload(objectPath, file, { contentType: file.type, upsert: false });
    if (uploadErr) throw uploadErr;

    const updatePayload: Record<string, unknown> = { [PATH_COLUMN[docType as DocType]]: objectPath };

    if (docType === "payment_receipt") {
      const parsed = PaymentExtra.safeParse({
        payment_method: form.get("payment_method"),
        bus_service_opted: form.get("bus_service_opted"),
        fees_total_etb: form.get("fees_total_etb"),
      });
      if (!parsed.success) return errors.badRequest();
      updatePayload.payment_method = parsed.data.payment_method;
      updatePayload.bus_service_opted = parsed.data.bus_service_opted;
      updatePayload.fees_total_etb = parsed.data.fees_total_etb;
    }

    const { error: updateErr } = await db.from("admission_applications")
      .update(updatePayload).eq("id", applicationId);
    if (updateErr) throw updateErr;

    return json({ ok: true }, 200);
  } catch (err) {
    console.error("upload-admission-document failed", { message: (err as Error).message });
    return errors.internal();
  }
});
