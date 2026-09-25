// ============================================================================
// Shared fee-document (invoice/receipt PDF) rendering + issuance + billing
// notification helpers. Fourth caller of this shape of logic
// (chapa-webhook, record-fee-payment, issue-fee-document,
// enroll-finalize-billing) -- past that, copy-pasting issue-id-card's
// upload+sign boilerplate stops being reasonable.
//
// A4 portrait, pdf-lib, Latin/ASCII only for v1 -- Helvetica has no Ethiopic
// glyphs and pdf-lib throws on them, same constraint generate-payslip-pdf
// already lives with. Trilingual fee documents via issue-id-card's
// font-embedding path is a documented follow-up, not part of this change.
// ============================================================================
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "npm:pdf-lib@1";
import { toDataURL as qrToDataURL } from "npm:qrcode@1";
import type { AuthContext } from "./security.ts";
import type { DocumentBranding } from "./branding.ts";
import { drawWatermark, drawHeaderText, drawFooterText, type DocTemplate } from "./doc-template.ts";

const NAVY: [number, number, number] = [0.118, 0.165, 0.439]; // #1E2A70
const BLACK: [number, number, number] = [0, 0, 0];
const GREY: [number, number, number] = [0.45, 0.45, 0.45];
const W = 595.28, H = 841.89; // A4 portrait, points

export function generateVerifyCode(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); // 48 hex chars
}

function asciiOnly(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "");
}

function drawText(page: PDFPage, font: PDFFont, raw: string, x: number, y: number, size: number, color: [number, number, number] = BLACK) {
  page.drawText(asciiOnly(raw), { x, y, size, font, color: rgb(...color) });
}

function drawRightText(page: PDFPage, font: PDFFont, raw: string, rightX: number, y: number, size: number, color: [number, number, number] = BLACK) {
  const text = asciiOnly(raw);
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - width, y, size, font, color: rgb(...color) });
}

async function embedQr(pdfDoc: PDFDocument, url: string) {
  try {
    const dataUrl = await qrToDataURL(url, { margin: 1, width: 240 });
    const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
    return await pdfDoc.embedPng(bytes);
  } catch {
    return null;
  }
}

// One row per fee_invoices line item under the invoice's header
// (20260820000001) -- a consolidated invoice bills several fee structures at
// once, so the PDF draws a table now instead of a single description line.
export interface FeeLineItem {
  feeStructureName: string; billingCycle: string;
  amountDue: number; amountPaid: number; status: string;
}
interface InvoiceRenderData {
  tenantName: string;
  /** R5-B2: omit (or pass UNBRANDED) to render exactly as before this round. */
  branding?: DocumentBranding;
  /** R5-C6: omit (or pass null) to render the fixed layout. Per C3's matrix
   *  this document type takes header/footer/watermark but NOT a signature. */
  template?: DocTemplate | null;
  docNo: string; verifyCode: string; issuedOn: string;
  studentName: string; admissionNo: string; classLabel: string;
  lineItems: FeeLineItem[];
  amountDue: number; amountPaid: number; status: string; // header totals
  dueDate: string;
}
interface ReceiptRenderData {
  tenantName: string;
  /** R5-B2: omit (or pass UNBRANDED) to render exactly as before this round. */
  branding?: DocumentBranding;
  /** R5-C6: omit (or pass null) to render the fixed layout. Per C3's matrix
   *  this document type takes header/footer/watermark but NOT a signature. */
  template?: DocTemplate | null;
  docNo: string; verifyCode: string; issuedOn: string;
  studentName: string; admissionNo: string;
  receivedFrom: string;
  // The header's line items as they stand after this payment was applied --
  // a receipt for a consolidated invoice shows every fee it covers, same
  // table shape as the invoice, not just the one payments row.
  lineItems: FeeLineItem[];
  amount: number; provider: string; providerRef: string | null; paidAt: string;
  invoiceBalanceAfter: number;
}

function formatETB(n: number): string {
  return `ETB ${n.toFixed(2)}`;
}

/**
 * Letterhead. `branding` is R5-B2's accessor output: when the tenant is below
 * Standard tier (or has branding_extended overridden off) it arrives as
 * UNBRANDED and every branch below falls through to exactly the fixed NAVY
 * bar + raw tenant name this rendered before that round -- unchanged output,
 * not a re-styled approximation of it.
 */
async function renderHeader(
  pdfDoc: PDFDocument, page: PDFPage, font: PDFFont, boldFont: PDFFont,
  tenantName: string, title: string, branding?: DocumentBranding,
) {
  const barColor = branding?.primaryColor ?? NAVY;
  page.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: rgb(...barColor) });

  let textX = 40;
  if (branding?.logoBytes) {
    try {
      const img = await embedImageAuto(pdfDoc, branding.logoBytes);
      if (img) {
        // Fit inside the 70pt bar with padding, preserving aspect ratio.
        const maxH = 44, maxW = 120;
        const scale = Math.min(maxH / img.height, maxW / img.width);
        const w = img.width * scale, h = img.height * scale;
        page.drawImage(img, { x: 40, y: H - 70 + (70 - h) / 2, width: w, height: h });
        textX = 40 + w + 12;
      }
    } catch (err) {
      // A broken logo must not cost the whole document.
      console.error("renderHeader: logo embed failed", { message: (err as Error).message });
    }
  }

  drawText(page, boldFont, branding?.schoolName || tenantName, textX, H - 42, 16, [1, 1, 1]);
  drawRightText(page, boldFont, title, W - 40, H - 42, 16, [1, 1, 1]);
  return pdfDoc;
}

/** PNG or JPEG, sniffed by magic bytes -- tenants upload either. */
async function embedImageAuto(pdfDoc: PDFDocument, bytes: Uint8Array) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return await pdfDoc.embedJpg(bytes);
  }
  return await pdfDoc.embedPng(bytes);
}

export async function renderInvoicePdf(data: InvoiceRenderData): Promise<Uint8Array> {
  const appUrl = Deno.env.get("APP_URL") ?? "https://timhirt-school-saas.vercel.app";
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([W, H]);
  await renderHeader(pdfDoc, page, font, boldFont, data.tenantName, "INVOICE", data.branding);
  // Painted before the body: pdf-lib has no z-index, paint order is the
  // only control, so this must sit underneath the content.
  drawWatermark(page, font, data.template ?? null, W, H);

  let y = H - 110;
  y = drawHeaderText(page, font, data.template ?? null, 40, y);
  drawText(page, font, `Invoice No: ${data.docNo}`, 40, y, 10); y -= 16;
  drawText(page, font, `Issued: ${data.issuedOn} (GC)`, 40, y, 10); y -= 16;
  drawText(page, font, `Due: ${data.dueDate} (GC)`, 40, y, 10); y -= 30;

  drawText(page, boldFont, "Billed to", 40, y, 11); y -= 16;
  drawText(page, font, `${data.studentName} (Student No: ${data.admissionNo})`, 40, y, 10); y -= 14;
  drawText(page, font, `Class: ${data.classLabel}`, 40, y, 10); y -= 30;

  // Line item table -- one row per fee structure under this invoice.
  page.drawRectangle({ x: 40, y: y - 4, width: W - 80, height: 22, color: rgb(0.94, 0.94, 0.96) });
  drawText(page, boldFont, "Description", 46, y + 2, 9);
  drawText(page, boldFont, "Status", 320, y + 2, 9);
  drawRightText(page, boldFont, "Amount", W - 46, y + 2, 9);
  y -= 26;
  for (const item of data.lineItems) {
    drawText(page, font, `${item.feeStructureName} (${item.billingCycle})`, 46, y, 10);
    drawText(page, font, item.status.toUpperCase(), 320, y, 9);
    drawRightText(page, font, formatETB(item.amountDue), W - 46, y, 10);
    y -= 18;
  }
  y -= 12;

  page.drawLine({ start: { x: 300, y }, end: { x: W - 40, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) }); y -= 18;
  drawText(page, font, "Amount due", 300, y, 10);
  drawRightText(page, font, formatETB(data.amountDue), W - 46, y, 10); y -= 16;
  drawText(page, font, "Amount paid", 300, y, 10);
  drawRightText(page, font, formatETB(data.amountPaid), W - 46, y, 10); y -= 16;
  const balance = Math.max(0, data.amountDue - data.amountPaid);
  drawText(page, boldFont, "Balance", 300, y, 11);
  drawRightText(page, boldFont, formatETB(balance), W - 46, y, 11); y -= 24;

  drawText(page, boldFont, `Status: ${data.status.toUpperCase()}`, 300, y, 10); y -= 40;

  const qr = await embedQr(pdfDoc, `${appUrl}/verify/${data.verifyCode}`);
  if (qr) page.drawImage(qr, { x: 40, y: 60, width: 70, height: 70 });
  drawText(page, font, "Scan to verify this invoice", 120, 110, 8, GREY);
  drawText(page, font, `Code: ${data.verifyCode}`, 120, 96, 8, GREY);
  drawFooterText(page, font, data.template ?? null, W);
  drawText(page, font, "This document is system-generated and does not require a signature.", 40, 30, 7, GREY);

  return pdfDoc.save();
}

export async function renderReceiptPdf(data: ReceiptRenderData): Promise<Uint8Array> {
  const appUrl = Deno.env.get("APP_URL") ?? "https://timhirt-school-saas.vercel.app";
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([W, H]);
  await renderHeader(pdfDoc, page, font, boldFont, data.tenantName, "RECEIPT", data.branding);
  // Painted before the body: pdf-lib has no z-index, paint order is the
  // only control, so this must sit underneath the content.
  drawWatermark(page, font, data.template ?? null, W, H);

  let y = H - 110;
  y = drawHeaderText(page, font, data.template ?? null, 40, y);
  drawText(page, font, `Receipt No: ${data.docNo}`, 40, y, 10); y -= 16;
  drawText(page, font, `Issued: ${data.issuedOn} (GC)`, 40, y, 10); y -= 16;
  drawText(page, font, `Paid on: ${data.paidAt} (GC)`, 40, y, 10); y -= 30;

  drawText(page, boldFont, "Received from", 40, y, 11); y -= 16;
  drawText(page, font, `${data.receivedFrom}`, 40, y, 10); y -= 14;
  drawText(page, font, `Student: ${data.studentName} (Student No: ${data.admissionNo})`, 40, y, 10); y -= 30;

  // Fee items this invoice covers, with their status after this payment --
  // matches the invoice's own table so a receipt reads as "the same bill,
  // now marked paid" rather than a bare amount with no context.
  page.drawRectangle({ x: 40, y: y - 4, width: W - 80, height: 22, color: rgb(0.94, 0.94, 0.96) });
  drawText(page, boldFont, "Description", 46, y + 2, 9);
  drawText(page, boldFont, "Status", 320, y + 2, 9);
  drawRightText(page, boldFont, "Amount", W - 46, y + 2, 9);
  y -= 26;
  for (const item of data.lineItems) {
    drawText(page, font, `${item.feeStructureName} (${item.billingCycle})`, 46, y, 10);
    drawText(page, font, item.status.toUpperCase(), 320, y, 9);
    drawRightText(page, font, formatETB(item.amountDue), W - 46, y, 10);
    y -= 18;
  }
  y -= 16;

  page.drawRectangle({ x: 40, y: y - 4, width: W - 80, height: 22, color: rgb(0.94, 0.94, 0.96) });
  drawText(page, boldFont, "Method", 46, y + 2, 9);
  drawText(page, boldFont, "Reference", 220, y + 2, 9);
  drawRightText(page, boldFont, "Amount Paid", W - 46, y + 2, 9);
  y -= 26;
  drawText(page, font, data.provider.toUpperCase(), 46, y, 10);
  drawText(page, font, data.providerRef ?? "-", 220, y, 10);
  drawRightText(page, font, formatETB(data.amount), W - 46, y, 10);
  y -= 34;

  drawText(page, font, `Balance after this payment: ${formatETB(data.invoiceBalanceAfter)}`, 40, y, 10);
  y -= 40;

  const qr = await embedQr(pdfDoc, `${appUrl}/verify/${data.verifyCode}`);
  if (qr) page.drawImage(qr, { x: 40, y: 60, width: 70, height: 70 });
  drawText(page, font, "Scan to verify this receipt", 120, 110, 8, GREY);
  drawText(page, font, `Code: ${data.verifyCode}`, 120, 96, 8, GREY);
  drawFooterText(page, font, data.template ?? null, W);
  drawText(page, font, "This document is system-generated and does not require a signature.", 40, 30, 7, GREY);

  return pdfDoc.save();
}

type AdminClient = AuthContext["adminClient"];

interface IssueFeeDocumentInput {
  kind: "invoice" | "receipt";
  tenantId: string;
  invoiceId: string;
  paymentId?: string;
  createdBy?: string | null;
  render: (ids: { docNo: string; verifyCode: string }) => Promise<Uint8Array>;
  amount: number;
}

/**
 * Single choke point: render -> upload -> upsert fee_documents row.
 * Invoices are regenerated in place (reuse the existing verify_code/doc_no/
 * row id, best-effort delete the old storage object) so a previously-printed
 * QR keeps verifying against the CURRENT invoice state. Receipts are
 * immutable -- if a row already exists for that payment_id, the caller
 * should re-sign the existing pdf_path instead of calling this again (see
 * issue-fee-document's caching rule).
 */
export async function issueFeeDocument(admin: AdminClient, input: IssueFeeDocumentInput): Promise<{ url: string; docNo: string; verifyCode: string } | null> {
  const existingQuery = input.kind === "invoice"
    ? admin.from("fee_documents").select("id, doc_no, verify_code, pdf_path").eq("invoice_id", input.invoiceId).eq("kind", "invoice").maybeSingle()
    : admin.from("fee_documents").select("id, doc_no, verify_code, pdf_path").eq("payment_id", input.paymentId!).eq("kind", "receipt").maybeSingle();
  const { data: existing } = await existingQuery;

  const verifyCode = existing?.verify_code ?? generateVerifyCode();
  const year = new Date().getFullYear();
  const docNo = existing?.doc_no ?? `${input.kind === "invoice" ? "INV" : "RCP"}-${year}-${verifyCode.slice(0, 8).toUpperCase()}`;

  const pdfBytes = await input.render({ docNo, verifyCode });
  const path = `${input.tenantId}/${input.invoiceId}/${crypto.randomUUID()}.pdf`;
  const { error: upErr } = await admin.storage.from("fee-documents").upload(path, pdfBytes, { contentType: "application/pdf" });
  if (upErr) {
    console.error("issueFeeDocument: upload failed", { message: upErr.message });
    return null;
  }

  const row = {
    tenant_id: input.tenantId, kind: input.kind, invoice_id: input.invoiceId,
    payment_id: input.paymentId ?? null, doc_no: docNo, verify_code: verifyCode,
    amount: input.amount, pdf_path: path, created_by: input.createdBy ?? null,
  };

  const { error: dbErr } = existing
    ? await admin.from("fee_documents").update(row).eq("id", existing.id)
    : await admin.from("fee_documents").insert(row);
  if (dbErr) {
    console.error("issueFeeDocument: db write failed", { message: dbErr.message });
    // best-effort cleanup of the just-uploaded orphan
    await admin.storage.from("fee-documents").remove([path]);
    return null;
  }

  if (existing?.pdf_path && existing.pdf_path !== path) {
    await admin.storage.from("fee-documents").remove([existing.pdf_path]).catch(() => {});
  }

  const { data: signed } = await admin.storage.from("fee-documents").createSignedUrl(path, 300);
  return { url: signed?.signedUrl ?? "", docNo, verifyCode };
}

interface NotifyBillingInput {
  tenantId: string;
  studentId: string;
  kind: "invoice_issued" | "payment_received" | "invoice_overdue";
  invoiceId?: string;
  paymentId?: string;
  amount?: number;
}

/**
 * Resolves recipients (the student's own user_id, plus every guardian with a
 * user_id) and inserts portal_notifications rows. Swallows the unique-index
 * violation (recipient, kind, coalesce(payment_id, invoice_id)) -- the
 * replay guard already gives this idempotency, no need to pre-check.
 */
export async function notifyBilling(admin: AdminClient, input: NotifyBillingInput): Promise<void> {
  const { data: student } = await admin.from("students").select("user_id").eq("id", input.studentId).maybeSingle();
  const { data: guardians } = await admin.from("guardians").select("user_id").eq("student_id", input.studentId).not("user_id", "is", null);

  const recipientIds = new Set<string>();
  if (student?.user_id) recipientIds.add(student.user_id);
  for (const g of guardians ?? []) if (g.user_id) recipientIds.add(g.user_id);

  for (const recipientId of recipientIds) {
    const { error } = await admin.from("portal_notifications").insert({
      tenant_id: input.tenantId, recipient_id: recipientId, student_id: input.studentId,
      kind: input.kind, invoice_id: input.invoiceId ?? null, payment_id: input.paymentId ?? null,
      amount: input.amount ?? null,
    });
    // unique_violation (23505) = already notified for this event; not an error.
    if (error && (error as { code?: string }).code !== "23505") {
      console.error("notifyBilling: insert failed", { message: error.message });
    }
  }
}
