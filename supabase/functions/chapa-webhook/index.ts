// ============================================================================
// [INSA-style category: PUBLIC — HMAC-signature gated — see §21.9]
// chapa-webhook
// verify_jwt=false in config; instead: HMAC-SHA256 signature verification.
// H-3/H-4 fix: settlement (replay-guard + amount-check + invoice credit) now
// happens atomically inside settle_gateway_payment() (migration 010) — a
// single service_role RPC call, so a crash mid-way can never leave the
// replay guard written without the credit applied (or vice versa). The
// gateway-reported amount is verified against the stored payment amount
// before any credit is applied; a mismatch is logged for manual review and
// the payment is left 'pending' rather than silently trusted.
// This webhook is the ONLY path that flips a gateway payment to succeeded.
// Credential source: Supabase Vault first (super_admin self-service via
// manage-integration-credentials), falling back to CHAPA_WEBHOOK_SECRET env
// var for infra-managed deployments — see getCredential() in _shared/security.ts.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { errors, json, verifyHmac, getCredential, corsHeaders } from "../_shared/security.ts";
import { issueFeeDocument, notifyBilling, renderReceiptPdf } from "../_shared/fee-pdf.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();
    const raw = await req.text();
    // Chapa sends two headers that sign DIFFERENT things (developer.chapa.co
    // /integrations/webhooks):
    //
    //   x-chapa-signature — HMAC-SHA256 of the event payload, keyed by the
    //                       webhook secret. Binds the signature to this body.
    //   chapa-signature   — HMAC-SHA256 of the secret *itself*, keyed by the
    //                       secret. A constant: it proves the sender knows the
    //                       secret but says nothing about the payload, so on
    //                       its own it is replayable across bodies.
    //
    // Chapa's docs say either header is sufficient. We deliberately do NOT
    // honour that: chapa-signature is a constant, so anyone who observes one
    // legitimate delivery can replay it against a body of their choosing simply
    // by omitting x-chapa-signature. Accepting the fallback would hand an
    // attacker the ability to mark any pending payment succeeded — free
    // tuition. Chapa sends both headers on every delivery, so requiring the
    // payload-bound one costs nothing and closes the downgrade.
    //
    // The raw request text is signed, never a re-serialized JSON.stringify of
    // a parsed body — key order and whitespace would not survive the round trip.
    const payloadSig = req.headers.get("x-chapa-signature");
    const secretSig = req.headers.get("chapa-signature") ?? req.headers.get("Chapa-Signature");

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const webhookSecret = await getCredential(db, "chapa_webhook_secret", "CHAPA_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("chapa-webhook: no webhook secret configured — rejecting");
      return errors.unauthorized();
    }
    if (!payloadSig) {
      // Diagnosable without leaking the signature itself: if this ever fires in
      // production, Chapa changed the contract and the check needs revisiting.
      console.error("chapa-webhook: no x-chapa-signature header", { hadSecretSig: !!secretSig });
      return errors.unauthorized();
    }
    if (!(await verifyHmac(raw, payloadSig, webhookSecret))) return errors.unauthorized();

    const event = JSON.parse(raw);
    const txRef: string | undefined = event?.tx_ref ?? event?.data?.tx_ref;
    if (!txRef || event?.status !== "success") return json({ received: true }, 200);

    const reported = Number(event?.amount ?? event?.data?.amount ?? NaN);
    if (!Number.isFinite(reported)) return json({ received: true }, 200);

    const { data: result, error } = await db.rpc("settle_gateway_payment", {
      p_tx_ref: txRef, p_provider: "chapa", p_reported_amount: reported,
    });
    if (error) throw error;

    // 'amount_mismatch' -> never silently credit; flag for manual review.
    // No amounts logged beyond the tx_ref (no financial data in logs).
    if (result === "amount_mismatch") {
      console.error("chapa-webhook amount mismatch", { txRef });
    }

    // Receipt + notification generation is best-effort and must NEVER affect
    // this function's 200 ack: the payment is already settled and the
    // invoice already credited atomically inside settle_gateway_payment().
    // Failing the ack here would just make Chapa retry a call whose retry
    // can't repair a receipt-generation failure (repeat settlement returns
    // 'duplicate'). The repair path is the on-demand issue-fee-document
    // endpoint, which is idempotent via fee_documents_receipt_uq.
    if (result === "ok") {
      try {
        const { data: payment } = await db.from("payments")
          .select("id, tenant_id, invoice_id, amount, paid_at, provider, provider_ref")
          .eq("provider_ref", txRef).eq("provider", "chapa").maybeSingle();
        if (payment) {
          const { data: invoice } = await db.from("fee_invoices")
            .select("id, student_id, amount_due, amount_paid")
            .eq("id", payment.invoice_id).maybeSingle();
          if (invoice) {
            const { data: student } = await db.from("students")
              .select("id, tenant_id, first_name, last_name, admission_no")
              .eq("id", invoice.student_id).maybeSingle();
            const { data: tenant } = await db.from("tenants").select("name").eq("id", payment.tenant_id).maybeSingle();
            if (student && tenant) {
              const doc = await issueFeeDocument(db, {
                kind: "receipt", tenantId: payment.tenant_id, invoiceId: invoice.id,
                paymentId: payment.id, amount: payment.amount,
                render: ({ docNo, verifyCode }) => renderReceiptPdf({
                  tenantName: tenant.name,
                  docNo, verifyCode, issuedOn: new Date().toISOString().slice(0, 10),
                  studentName: `${student.first_name} ${student.last_name}`.trim(),
                  admissionNo: student.admission_no,
                  receivedFrom: `${student.first_name} ${student.last_name}`.trim(),
                  amount: payment.amount, provider: "chapa", providerRef: payment.provider_ref,
                  paidAt: (payment.paid_at ?? new Date().toISOString()).slice(0, 10),
                  invoiceBalanceAfter: Math.max(0, invoice.amount_due - invoice.amount_paid),
                }),
              });
              if (doc) {
                await notifyBilling(db, {
                  tenantId: payment.tenant_id, studentId: invoice.student_id,
                  kind: "payment_received", invoiceId: invoice.id, paymentId: payment.id,
                  amount: payment.amount,
                });
              }
            }
          }
        }
      } catch (docErr) {
        console.error("chapa-webhook: receipt/notification generation failed (non-fatal)", { message: (docErr as Error).message });
      }
    }

    return json({ received: true, result }, 200);
  } catch (err) {
    console.error("chapa-webhook failed", { message: (err as Error).message });
    return errors.internal();
  }
});
