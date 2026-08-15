// ============================================================================
// Shared document-template application (R5-C6), Edge-Function runtime.
//
// Reads a tenant's document_templates row and draws the configured
// header/footer/signature/watermark onto a pdf-lib page. The counterpart to
// src/lib/documentTemplate.ts, which does the same for browser-generated
// documents.
//
// THE CONTRACT: loadDocumentTemplate() returns null when there is no row, and
// every draw* helper below is a no-op on null. That is what makes "absence of
// a row == exactly today's fixed output" true in code and not just in the
// migration comment -- a generator that calls all four helpers renders
// byte-identically to before this round until the school configures something.
//
// Gating is NOT repeated here. document_templates' RLS write policy already
// requires has_module(tenant_id, 'document_templates'), so a tenant without
// the module has no row to read; a second check at render time would be
// belt-and-braces against a condition that cannot arise, and would risk
// blanking a template a school legitimately configured if the module check
// ever hiccuped.
// ============================================================================
import { rgb, type PDFFont, type PDFPage } from "npm:pdf-lib@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type DocumentType =
  | "transcript" | "report_card" | "invoice" | "receipt"
  | "payslip" | "leaving_certificate" | "seating_chart";

export interface DocTemplate {
  headerText: string | null;
  footerText: string | null;
  showSignatureLine: boolean;
  signatureTitle: string | null;
  watermarkText: string | null;
  watermarkOpacity: number;
}

const GREY: [number, number, number] = [0.45, 0.45, 0.45];

/** Null when the tenant has configured nothing for this document type. */
export async function loadDocumentTemplate(
  admin: SupabaseClient, tenantId: string, documentType: DocumentType,
): Promise<DocTemplate | null> {
  try {
    const { data } = await admin.from("document_templates")
      .select("header_text, footer_text, show_signature_line, signature_title, watermark_text, watermark_opacity")
      .eq("tenant_id", tenantId).eq("document_type", documentType).maybeSingle();
    if (!data) return null;
    return {
      headerText: data.header_text ?? null,
      footerText: data.footer_text ?? null,
      showSignatureLine: !!data.show_signature_line,
      signatureTitle: data.signature_title ?? null,
      watermarkText: data.watermark_text ?? null,
      watermarkOpacity: Number(data.watermark_opacity ?? 0.15),
    };
  } catch (err) {
    // A template lookup failure must not cost the document -- fall back to
    // the fixed layout, same posture as the branding accessor.
    console.error("loadDocumentTemplate failed; rendering fixed layout", { message: (err as Error).message });
    return null;
  }
}

function ascii(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "");
}

/**
 * Diagonal centred watermark, drawn BEFORE body content so it sits underneath
 * (pdf-lib has no z-index; paint order is the only control).
 */
export function drawWatermark(page: PDFPage, font: PDFFont, tpl: DocTemplate | null, W: number, H: number) {
  if (!tpl?.watermarkText) return;
  const text = ascii(tpl.watermarkText);
  if (!text) return;
  const size = 60;
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: W / 2 - (width / 2) * Math.cos(Math.PI / 4),
    y: H / 2 - (width / 2) * Math.sin(Math.PI / 4),
    size, font,
    color: rgb(0.5, 0.5, 0.5),
    opacity: tpl.watermarkOpacity,
    rotate: { type: "degrees", angle: 45 } as never,
  });
}

/** Returns the y the caller should continue from (unchanged when no header). */
export function drawHeaderText(page: PDFPage, font: PDFFont, tpl: DocTemplate | null, x: number, y: number): number {
  if (!tpl?.headerText) return y;
  const text = ascii(tpl.headerText);
  if (!text) return y;
  page.drawText(text, { x, y, size: 9, font, color: rgb(...GREY) });
  return y - 16;
}

export function drawFooterText(page: PDFPage, font: PDFFont, tpl: DocTemplate | null, W: number, y = 46) {
  if (!tpl?.footerText) return;
  const text = ascii(tpl.footerText);
  if (!text) return;
  const width = font.widthOfTextAtSize(text, 7.5);
  page.drawText(text, { x: W / 2 - width / 2, y, size: 7.5, font, color: rgb(...GREY) });
}

/** Signature rule + caption. No-op unless the school turned it on. */
export function drawSignatureLine(page: PDFPage, font: PDFFont, tpl: DocTemplate | null, rightX: number, y: number) {
  if (!tpl?.showSignatureLine) return;
  page.drawLine({
    start: { x: rightX - 170, y }, end: { x: rightX, y },
    thickness: 0.75, color: rgb(...GREY),
  });
  const caption = ascii(tpl.signatureTitle ?? "Authorized signature");
  page.drawText(caption, { x: rightX - 170, y: y - 12, size: 8, font, color: rgb(...GREY) });
}
