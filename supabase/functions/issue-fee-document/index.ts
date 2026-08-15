// ============================================================================
// [INSA category: PRIVATE] issue-fee-document
// AuthZ: school_admin / accountant / parent / student. On-demand invoice or
// receipt PDF, downloadable from InvoicesPage/InvoiceDetailPage and the
// parent/student portal. Reads the header (and, for a receipt, the payment)
// via ctx.userClient -- the existing invoice_headers_select/payments_select
// RLS policies already scope a parent to their own children's invoices, so
// requesting another family's invoice_id (a header id, since 20260820000001
// consolidation) yields null -> 400 with no extra role logic needed here.
//
// Invoices are ALWAYS regenerated fresh, never cached: fee_invoices has no
// updated_at column, so staleness can't even be cheaply detected, and
// amount_paid/status can change at any moment -- a stale cached PDF here is
// a real financial-document correctness bug. Regeneration reuses the same
// fee_documents row/verify_code (fee_documents_invoice_uq), so a
// previously-printed QR code keeps verifying against the CURRENT invoice
// state.
//
// Receipts are immutable: if a fee_documents row already exists for that
// payment_id, this just re-signs the existing pdf_path rather than
// re-rendering -- a receipt is a point-in-time artifact, re-rendering it
// would be pointless work at best and a correctness risk at worst if the
// renderer's output format ever changes underneath an old receipt.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";
import { issueFeeDocument, renderInvoicePdf, renderReceiptPdf, type FeeLineItem } from "../_shared/fee-pdf.ts";
import { loadDocumentBranding } from "../_shared/branding.ts";

const Payload = z.object({
  kind: z.enum(["invoice", "receipt"]),
  invoice_id: z.string().uuid(), // an invoice_headers id
  payment_id: z.string().uuid().optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["school_admin", "accountant", "parent", "student"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  try {
    if (req.method !== "POST") return errors.badRequest();
    if (!(await rateLimit(`fee-doc:${ctx.userId}`, 20, 60_000))) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;
    if (p.kind === "receipt" && !p.payment_id) return errors.badRequest();

    const { data: header } = await ctx.userClient.from("invoice_headers")
      .select("id, tenant_id, due_date, student:students(id, first_name, last_name, admission_no, class:classes(name, section))")
      .eq("id", p.invoice_id).maybeSingle();
    if (!header) return errors.badRequest();

    const { data: lines } = await ctx.userClient.from("fee_invoices")
      .select("amount_due, amount_paid, status, fee_structure:fee_structures(name_i18n, billing_cycle)")
      .eq("invoice_header_id", header.id).order("created_at");
    const lineItems: FeeLineItem[] = (lines ?? []).map((l) => {
      const fs = l.fee_structure as unknown as { name_i18n: Record<string, string>; billing_cycle: string } | null;
      return {
        feeStructureName: fs?.name_i18n?.en ?? "Fee", billingCycle: fs?.billing_cycle ?? "-",
        amountDue: Number(l.amount_due), amountPaid: Number(l.amount_paid), status: l.status,
      };
    });
    const amountDue = lineItems.reduce((s, l) => s + l.amountDue, 0);
    const amountPaid = lineItems.reduce((s, l) => s + l.amountPaid, 0);
    const status = lineItems.every((l) => l.status === "paid") ? "paid" : amountPaid > 0 ? "partial" : "pending";

    const student = header.student as unknown as { id: string; first_name: string; last_name: string; admission_no: string; class: { name: string; section: string | null } | null };
    const studentName = `${student.first_name} ${student.last_name}`.trim();
    const classLabel = student.class ? `${student.class.name} ${student.class.section ?? ""}`.trim() : "-";

    const { data: tenant } = await ctx.userClient.from("tenants").select("name").eq("id", header.tenant_id).maybeSingle();
    const tenantName = tenant?.name ?? "School";
    // R5-B2: gated on branding_extended -- below Standard this resolves to
    // UNBRANDED and the PDF renders exactly as it did before that round.
    const branding = await loadDocumentBranding(ctx.adminClient, header.tenant_id);

    if (p.kind === "invoice") {
      const doc = await issueFeeDocument(ctx.adminClient, {
        kind: "invoice", tenantId: header.tenant_id, invoiceId: header.id, amount: amountDue,
        render: ({ docNo, verifyCode }) => renderInvoicePdf({
          tenantName, branding, docNo, verifyCode, issuedOn: new Date().toISOString().slice(0, 10),
          studentName, admissionNo: student.admission_no, classLabel,
          lineItems, amountDue, amountPaid, status, dueDate: header.due_date,
        }),
      });
      if (!doc) return errors.internal();
      return json({ url: doc.url, doc_no: doc.docNo }, 200);
    }

    // Receipt: check for an existing (immutable) document first.
    const { data: existing } = await ctx.adminClient.from("fee_documents")
      .select("pdf_path, doc_no").eq("payment_id", p.payment_id!).eq("kind", "receipt").maybeSingle();
    if (existing) {
      const { data: signed } = await ctx.adminClient.storage.from("fee-documents").createSignedUrl(existing.pdf_path, 300);
      if (!signed?.signedUrl) return errors.internal();
      return json({ url: signed.signedUrl, doc_no: existing.doc_no }, 200);
    }

    const { data: payment } = await ctx.userClient.from("payments")
      .select("id, amount, provider, provider_ref, paid_at").eq("id", p.payment_id!).eq("invoice_id", header.id).maybeSingle();
    if (!payment) return errors.badRequest();

    const doc = await issueFeeDocument(ctx.adminClient, {
      kind: "receipt", tenantId: header.tenant_id, invoiceId: header.id, paymentId: payment.id, amount: payment.amount,
      render: ({ docNo, verifyCode }) => renderReceiptPdf({
        tenantName, branding, docNo, verifyCode, issuedOn: new Date().toISOString().slice(0, 10),
        studentName, admissionNo: student.admission_no, receivedFrom: studentName,
        lineItems,
        amount: Number(payment.amount), provider: payment.provider, providerRef: payment.provider_ref,
        paidAt: (payment.paid_at ?? new Date().toISOString()).slice(0, 10),
        invoiceBalanceAfter: Math.max(0, amountDue - amountPaid),
      }),
    });
    if (!doc) return errors.internal();
    return json({ url: doc.url, doc_no: doc.docNo }, 200);
  } catch (err) {
    console.error("issue-fee-document failed", { message: (err as Error).message });
    return errors.internal();
  }
});
