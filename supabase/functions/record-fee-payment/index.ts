// ============================================================================
// [INSA category: PRIVATE] record-fee-payment
// AuthZ: school_admin / accountant. Moves InvoiceDetailPage's manual
// cash/bank payment recording server-side so a receipt PDF + portal
// notification can be generated -- a direct client-side insert into
// `payments` (the previous implementation) had nowhere to hook that.
//
// Reads the invoice via ctx.userClient (RLS is the authZ, same as
// process-fee-payment) and inserts the payments row via ctx.userClient too
// (not adminClient) so payments_manual_insert stays the real enforcement
// and apply_manual_payment_trg credits the invoice exactly as it did before
// this function existed -- no RLS/trigger changes needed here.
//
// Optionally accepts a bank-generated verification URL (Part 3). Unlike
// verify-admission-bank-url, a failed verification here does NOT block
// recording the payment: the accountant/school_admin is already a trusted
// human attesting a real transaction happened, and the URL is supplementary
// evidence, not a hard gate on their own entry. This asymmetry with the
// public admission path (where failure DOES block) is deliberate.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";
import { issueFeeDocument, notifyBilling, renderReceiptPdf } from "../_shared/fee-pdf.ts";
import { verifyBankUrl } from "../_shared/bank-verify.ts";

const Payload = z.object({
  invoice_id: z.string().uuid(),
  amount: z.number().positive(),
  provider: z.enum(["cash", "bank"]),
  reference: z.string().max(100).optional(),
  bank_verification: z.object({
    payment_method: z.enum(["cbe", "awash_bank", "telebirr"]),
    verification_url: z.string().url().max(2048),
  }).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["school_admin", "accountant"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  try {
    if (req.method !== "POST") return errors.badRequest();
    if (!(await rateLimit(`record-payment:${ctx.userId}`, 20, 60_000))) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;

    // AuthZ via RLS: invisible invoice -> null -> 400, same as process-fee-payment.
    const { data: invoice } = await ctx.userClient.from("fee_invoices")
      .select("id, tenant_id, student_id, amount_due, amount_paid, status")
      .eq("id", p.invoice_id).maybeSingle();
    if (!invoice || invoice.status === "paid") return errors.badRequest();

    const remaining = Number(invoice.amount_due) - Number(invoice.amount_paid);
    if (p.amount > remaining + 0.01) return json({ error: "amount_exceeds_balance" }, 400);

    const { data: payment, error: payErr } = await ctx.userClient.from("payments").insert({
      tenant_id: invoice.tenant_id, invoice_id: invoice.id,
      amount: p.amount, provider: p.provider, provider_ref: p.reference?.trim() || null,
      status: "succeeded",
    }).select("id, amount, provider, provider_ref, paid_at").single();
    if (payErr) throw payErr;

    let bankVerification: { status: string; failure_reason?: string } | null = null;
    if (p.bank_verification) {
      try {
        const result = await verifyBankUrl(ctx.adminClient, {
          tenantId: invoice.tenant_id, pathPrefix: payment.id,
          paymentMethod: p.bank_verification.payment_method,
          verificationUrl: p.bank_verification.verification_url,
        });
        await ctx.adminClient.from("bank_payment_verifications").insert({
          tenant_id: invoice.tenant_id, payment_id: payment.id,
          payment_method: p.bank_verification.payment_method,
          verification_url: p.bank_verification.verification_url,
          pdf_path: result.status === "verified" ? result.pdfPath : null,
          status: result.status, failure_reason: result.status === "failed" ? result.failureReason : null,
          checked_at: new Date().toISOString(),
        });
        bankVerification = result.status === "verified"
          ? { status: "verified" }
          : { status: "failed", failure_reason: result.failureReason };
      } catch (err) {
        console.error("record-fee-payment: bank verification failed (non-fatal)", { message: (err as Error).message });
        bankVerification = { status: "failed", failure_reason: "internal_error" };
      }
    }

    // Receipt + notification -- non-fatal, the payment is already recorded.
    let receiptUrl: string | null = null;
    try {
      const { data: student } = await ctx.adminClient.from("students")
        .select("first_name, last_name, admission_no").eq("id", invoice.student_id).maybeSingle();
      const { data: tenant } = await ctx.adminClient.from("tenants").select("name").eq("id", invoice.tenant_id).maybeSingle();
      const { data: refreshedInvoice } = await ctx.adminClient.from("fee_invoices")
        .select("amount_due, amount_paid").eq("id", invoice.id).maybeSingle();
      if (student && tenant && refreshedInvoice) {
        const studentName = `${student.first_name} ${student.last_name}`.trim();
        const doc = await issueFeeDocument(ctx.adminClient, {
          kind: "receipt", tenantId: invoice.tenant_id, invoiceId: invoice.id,
          paymentId: payment.id, amount: payment.amount,
          render: ({ docNo, verifyCode }) => renderReceiptPdf({
            tenantName: tenant.name, docNo, verifyCode, issuedOn: new Date().toISOString().slice(0, 10),
            studentName, admissionNo: student.admission_no, receivedFrom: studentName,
            amount: Number(payment.amount), provider: payment.provider, providerRef: payment.provider_ref,
            paidAt: (payment.paid_at ?? new Date().toISOString()).slice(0, 10),
            invoiceBalanceAfter: Math.max(0, Number(refreshedInvoice.amount_due) - Number(refreshedInvoice.amount_paid)),
          }),
        });
        receiptUrl = doc?.url ?? null;
        if (doc) {
          await notifyBilling(ctx.adminClient, {
            tenantId: invoice.tenant_id, studentId: invoice.student_id,
            kind: "payment_received", invoiceId: invoice.id, paymentId: payment.id, amount: payment.amount,
          });
        }
      }
    } catch (err) {
      console.error("record-fee-payment: receipt generation failed (non-fatal)", { message: (err as Error).message });
    }

    return json({ payment_id: payment.id, receipt_url: receiptUrl, bank_verification: bankVerification }, 201);
  } catch (err) {
    console.error("record-fee-payment failed", { message: (err as Error).message });
    return errors.internal();
  }
});
