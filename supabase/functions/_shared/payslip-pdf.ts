// ============================================================================
// Payslip PDF rendering (R5-B2).
//
// generate-payslip-pdf used to emit a hand-rolled ~20-line raw PDF byte
// string ("production: swap for pdf-lib" was written in its own comment). It
// had no letterhead, no tenant name, no colour -- there was literally nothing
// on it to brand. Extended branding can't be applied to that, so this ports
// the payslip onto pdf-lib and the same renderHeader shape fee-pdf.ts uses,
// which is what makes invoice/receipt/payslip look like one family of
// documents rather than three unrelated ones.
//
// Deliberately NOT a behavioral gamble: the body keeps the exact same
// content the old writer produced (period, one line per payslip_line with
// its localized label and sign, net pay) so an unbranded payslip below
// Standard tier still says everything it said before -- just typeset by
// pdf-lib instead of by hand.
//
// ASCII-only, same constraint fee-pdf.ts documents: Helvetica has no Ethiopic
// glyphs and pdf-lib throws on them. The old hand-rolled writer had the same
// limit (it stripped nothing and would emit broken bytes for Amharic labels,
// which this at least handles predictably).
// ============================================================================
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "npm:pdf-lib@1";
import type { DocumentBranding } from "./branding.ts";
import { drawHeaderText, drawFooterText, drawSignatureLine, type DocTemplate } from "./doc-template.ts";

const NAVY: [number, number, number] = [0.118, 0.165, 0.439];
const BLACK: [number, number, number] = [0, 0, 0];
const GREY: [number, number, number] = [0.45, 0.45, 0.45];
const W = 595.28, H = 841.89; // A4 portrait

export interface PayslipLine { label: string; kind: string; amount: number }

export interface PayslipRenderData {
  tenantName: string;
  /** R5-B2 accessor output; UNBRANDED/undefined renders the plain letterhead. */
  branding?: DocumentBranding;
  /** R5-C6: null renders the fixed layout. Per C3's matrix a payslip takes
   *  header/footer and a signature line, but deliberately NO watermark --
   *  a payslip is a payment record, not a draft to be stamped over. */
  template?: DocTemplate | null;
  period: string;
  employeeName: string;
  lines: PayslipLine[];
  netPay: number;
}

function asciiOnly(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "");
}
function drawText(page: PDFPage, font: PDFFont, raw: string, x: number, y: number, size: number, color: [number, number, number] = BLACK) {
  page.drawText(asciiOnly(raw), { x, y, size, font, color: rgb(...color) });
}
function drawRightText(page: PDFPage, font: PDFFont, raw: string, rightX: number, y: number, size: number, color: [number, number, number] = BLACK) {
  const text = asciiOnly(raw);
  page.drawText(text, { x: rightX - font.widthOfTextAtSize(text, size), y, size, font, color: rgb(...color) });
}
async function embedImageAuto(pdfDoc: PDFDocument, bytes: Uint8Array) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return await pdfDoc.embedJpg(bytes);
  return await pdfDoc.embedPng(bytes);
}

export async function renderPayslipPdf(data: PayslipRenderData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([W, H]);

  const barColor = data.branding?.primaryColor ?? NAVY;
  page.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: rgb(...barColor) });
  let textX = 40;
  if (data.branding?.logoBytes) {
    try {
      const img = await embedImageAuto(pdfDoc, data.branding.logoBytes);
      const scale = Math.min(44 / img.height, 120 / img.width);
      const w = img.width * scale, h = img.height * scale;
      page.drawImage(img, { x: 40, y: H - 70 + (70 - h) / 2, width: w, height: h });
      textX = 40 + w + 12;
    } catch (err) {
      console.error("renderPayslipPdf: logo embed failed", { message: (err as Error).message });
    }
  }
  drawText(page, boldFont, data.branding?.schoolName || data.tenantName, textX, H - 42, 16, [1, 1, 1]);
  drawRightText(page, boldFont, "PAYSLIP", W - 40, H - 42, 16, [1, 1, 1]);

  let y = H - 110;
  y = drawHeaderText(page, font, data.template ?? null, 40, y);
  drawText(page, font, `Period: ${data.period}`, 40, y, 10); y -= 16;
  drawText(page, font, `Employee: ${data.employeeName}`, 40, y, 10); y -= 30;

  page.drawRectangle({ x: 40, y: y - 4, width: W - 80, height: 22, color: rgb(0.94, 0.94, 0.96) });
  drawText(page, boldFont, "Description", 46, y + 2, 9);
  drawRightText(page, boldFont, "Amount (ETB)", W - 46, y + 2, 9);
  y -= 26;
  for (const l of data.lines) {
    drawText(page, font, l.label.slice(0, 60), 46, y, 10);
    drawRightText(page, font, `${l.kind === "deduction" ? "-" : ""}${l.amount}`, W - 46, y, 10);
    y -= 18;
  }
  y -= 12;
  page.drawLine({ start: { x: 300, y }, end: { x: W - 40, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) }); y -= 18;
  drawText(page, boldFont, "NET PAY", 300, y, 11);
  drawRightText(page, boldFont, `${data.netPay} ETB`, W - 46, y, 11);

  // Signature line sits below the totals, right-aligned, when configured.
  drawSignatureLine(page, font, data.template ?? null, W - 40, y - 60);
  drawFooterText(page, font, data.template ?? null, W);
  drawText(page, font, "This document is system-generated and confidential.", 40, 30, 7, GREY);
  return pdfDoc.save();
}
