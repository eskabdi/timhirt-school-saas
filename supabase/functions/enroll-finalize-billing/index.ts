// ============================================================================
// [INSA category: PRIVATE] enroll-finalize-billing
// AuthZ: school_admin / registrar / accountant. Creates the first invoice
// (and, when the applicant declared registration-payment evidence, a
// matching payment + receipt) for a freshly-enrolled student.
//
// Runs internally with adminClient (service_role) -- this function's own
// requireRole() IS the authZ, same pattern process-fee-payment already uses
// for inserting gateway payments. This is deliberate, not a shortcut: RLS on
// fee_invoices/payments (invoices_write / payments_manual_insert) only
// allows school_admin/accountant, but enrollment in this app is normally
// performed by a registrar -- a direct client-side insert throws for the
// role that actually does the work. Routing the write through a
// service_role function with its own explicit role check fixes that without
// loosening RLS for every other caller.
//
// Also the single place that turns "applicant said they paid by bank
// transfer and uploaded a receipt image" into a real payments row: all
// three admission payment methods (cbe/awash_bank/telebirr) map to
// provider:'bank', NOT 'telebirr' -- apply_manual_payment_trg's WHEN clause
// only fires for provider in ('cash','bank'), so mapping to 'telebirr'
// would insert a 'succeeded' payment that never credits the invoice. The
// true instrument is preserved losslessly in provider_ref
// (adm-<method>-<application_id>), which doubles as an idempotency key via
// payments_provider_ref_uq.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";
import { issueFeeDocument, notifyBilling, renderInvoicePdf, renderReceiptPdf, type FeeLineItem } from "../_shared/fee-pdf.ts";
import { loadDocumentBranding } from "../_shared/branding.ts";
import { loadDocumentTemplate } from "../_shared/doc-template.ts";

const Payload = z.object({
  application_id: z.string().uuid(),
  student_id: z.string().uuid(),
  fee_structure_id: z.string().uuid().optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["school_admin", "registrar", "accountant"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  try {
    if (req.method !== "POST") return errors.badRequest();
    if (!(await rateLimit(`enroll-billing:${ctx.userId}`, 20, 60_000))) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;

    // RLS-gated read -- proves the caller can actually see this application
    // (same tenant) before any service_role write happens below.
    const { data: application } = await ctx.userClient.from("admission_applications")
      .select("id, tenant_id, converted_student_id, payment_method, fees_total_etb, payment_receipt_path")
      .eq("id", p.application_id).maybeSingle();
    if (!application || application.converted_student_id !== p.student_id) return errors.badRequest();

    const { data: student } = await ctx.adminClient.from("students")
      .select("id, tenant_id, first_name, last_name, admission_no, class:classes(name, section)")
      .eq("id", p.student_id).maybeSingle();
    if (!student) return errors.badRequest();

    const { data: tenant } = await ctx.adminClient.from("tenants").select("name").eq("id", application.tenant_id).maybeSingle();
    const tenantName = tenant?.name ?? "School";
    const studentName = `${student.first_name} ${student.last_name}`.trim();
    const classLabel = student.class ? `${(student.class as { name: string }).name} ${(student.class as { section: string | null }).section ?? ""}`.trim() : "-";

    let invoiceId: string | null = null;
    let invoiceUrl: string | null = null;
    let receiptUrl: string | null = null;
    let billingError: string | null = null;

    try {
      if (p.fee_structure_id) {
        const { data: structure } = await ctx.adminClient.from("fee_structures")
          .select("id, name_i18n, amount, billing_cycle").eq("id", p.fee_structure_id).maybeSingle();
        if (!structure) return errors.badRequest();

        // Idempotency: reuse an existing invoice for this student+structure
        // rather than duplicating it on a retry/double-click.
        const { data: existingInvoice } = await ctx.adminClient.from("fee_invoices")
          .select("id, amount_due, amount_paid, status, invoice_header_id")
          .eq("student_id", p.student_id).eq("fee_structure_id", structure.id).maybeSingle();

        let invoice = existingInvoice;
        let headerId: string;
        if (!invoice) {
          // Enrollment always produces exactly one fee item at this stage --
          // no consolidation candidate exists yet, so this fee_invoices row
          // gets its own 1:1 header (20260820000001), same as every legacy
          // pre-consolidation invoice.
          const { data: header, error: headerErr } = await ctx.adminClient.from("invoice_headers").insert({
            tenant_id: application.tenant_id, student_id: p.student_id,
            due_date: new Date().toISOString().slice(0, 10),
          }).select("id").single();
          if (headerErr) throw headerErr;
          headerId = header.id;

          const { data: created, error: invErr } = await ctx.adminClient.from("fee_invoices").insert({
            tenant_id: application.tenant_id, student_id: p.student_id, fee_structure_id: structure.id,
            amount_due: structure.amount, due_date: new Date().toISOString().slice(0, 10),
            invoice_header_id: headerId,
          }).select("id, amount_due, amount_paid, status, invoice_header_id").single();
          if (invErr) throw invErr;
          invoice = created;
        } else {
          headerId = invoice.invoice_header_id;
        }
        invoiceId = headerId;

        // Registration payment evidence declared on the application -> a
        // real payments row, mapped to provider:'bank' for every admission
        // payment method (see file header). unique_violation on
        // provider_ref = "already processed", not an error.
        let paymentId: string | null = null;
        if (application.payment_method && application.fees_total_etb && application.payment_receipt_path) {
          const providerRef = `adm-${application.payment_method}-${application.id}`;
          const { data: existingPayment } = await ctx.adminClient.from("payments")
            .select("id").eq("provider_ref", providerRef).maybeSingle();
          if (existingPayment) {
            paymentId = existingPayment.id;
          } else {
            const { data: created, error: payErr } = await ctx.adminClient.from("payments").insert({
              tenant_id: application.tenant_id, invoice_id: invoice.id,
              amount: application.fees_total_etb, provider: "bank", provider_ref: providerRef,
              status: "succeeded", paid_at: new Date().toISOString(),
            }).select("id").single();
            if (payErr && (payErr as { code?: string }).code !== "23505") throw payErr;
            paymentId = created?.id ?? null;
          }
          // Re-read the invoice: apply_manual_payment_trg may have just credited it.
          const { data: refreshed } = await ctx.adminClient.from("fee_invoices")
            .select("id, amount_due, amount_paid, status, invoice_header_id").eq("id", invoice.id).maybeSingle();
          if (refreshed) invoice = refreshed;
        }

        // Enrollment always produces exactly one fee item at this stage, so
        // the header's line-item table is this single invoice repeated as a
        // one-element array -- same shape every other issuer uses.
        const lineItems: FeeLineItem[] = [{
          feeStructureName: (structure.name_i18n as Record<string, string>)?.en ?? "Fee",
          billingCycle: structure.billing_cycle,
          amountDue: Number(invoice.amount_due), amountPaid: Number(invoice.amount_paid), status: invoice.status,
        }];
        // R5-B2/C6: the enrollment path issues the same two documents as
        // issue-fee-document, so it reads the same two accessors. Branding is
        // gated on branding_extended and resolves to UNBRANDED below Standard;
        // the template is null unless the school configured one, which leaves
        // the fixed layout untouched. Both fail closed.
        const branding = await loadDocumentBranding(ctx.adminClient, application.tenant_id);
        const invoiceTemplate = await loadDocumentTemplate(ctx.adminClient, application.tenant_id, "invoice");
        const receiptTemplate = await loadDocumentTemplate(ctx.adminClient, application.tenant_id, "receipt");

        const invoiceDoc = await issueFeeDocument(ctx.adminClient, {
          kind: "invoice", tenantId: application.tenant_id, invoiceId: headerId,
          amount: invoice.amount_due,
          render: ({ docNo, verifyCode }) => renderInvoicePdf({
            tenantName, branding, template: invoiceTemplate,
            docNo, verifyCode, issuedOn: new Date().toISOString().slice(0, 10),
            studentName, admissionNo: student.admission_no, classLabel,
            lineItems,
            amountDue: Number(invoice.amount_due), amountPaid: Number(invoice.amount_paid), status: invoice.status,
            dueDate: new Date().toISOString().slice(0, 10),
          }),
        });
        invoiceUrl = invoiceDoc?.url ?? null;
        await notifyBilling(ctx.adminClient, {
          tenantId: application.tenant_id, studentId: p.student_id,
          kind: "invoice_issued", invoiceId: headerId, amount: invoice.amount_due,
        });

        if (paymentId) {
          const { data: payment } = await ctx.adminClient.from("payments")
            .select("id, amount, provider_ref, paid_at").eq("id", paymentId).maybeSingle();
          if (payment) {
            const receiptDoc = await issueFeeDocument(ctx.adminClient, {
              kind: "receipt", tenantId: application.tenant_id, invoiceId: headerId,
              paymentId: payment.id, amount: payment.amount,
              render: ({ docNo, verifyCode }) => renderReceiptPdf({
                tenantName, branding, template: receiptTemplate,
                docNo, verifyCode, issuedOn: new Date().toISOString().slice(0, 10),
                studentName, admissionNo: student.admission_no, receivedFrom: studentName,
                lineItems,
                amount: Number(payment.amount), provider: "bank", providerRef: payment.provider_ref,
                paidAt: (payment.paid_at ?? new Date().toISOString()).slice(0, 10),
                invoiceBalanceAfter: Math.max(0, Number(invoice.amount_due) - Number(invoice.amount_paid)),
              }),
            });
            receiptUrl = receiptDoc?.url ?? null;
            await notifyBilling(ctx.adminClient, {
              tenantId: application.tenant_id, studentId: p.student_id,
              kind: "payment_received", invoiceId: headerId, paymentId: payment.id, amount: payment.amount,
            });
          }
        }
      }
    } catch (err) {
      console.error("enroll-finalize-billing: billing step failed (non-fatal to enrollment)", { message: (err as Error).message });
      billingError = "billing_failed";
    }

    return json({ invoice_id: invoiceId, invoice_url: invoiceUrl, receipt_url: receiptUrl, billing_error: billingError }, 200);
  } catch (err) {
    console.error("enroll-finalize-billing failed", { message: (err as Error).message });
    return errors.internal();
  }
});
