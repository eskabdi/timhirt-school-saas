// ============================================================================
// Shared document-template application (R5-C6), browser runtime.
//
// Counterpart to supabase/functions/_shared/doc-template.ts, with the same
// contract: fetchDocumentTemplate() returns null when the school has
// configured nothing, and every draw method is a no-op on null -- so a
// generator that calls all four renders exactly its pre-existing fixed layout
// until somebody configures something.
//
// WHY THE FACTORY, rather than plain exported functions: every client-side
// PDF generator in this codebase dynamically imports pdf-lib so that ~400 KB
// of it plus fontkit stays out of the main bundle (see transcript-pdf.ts's
// header comment -- that is a deliberate, load-bearing optimization). A
// static `import { rgb } from "pdf-lib"` here would silently undo it for the
// whole app. So the caller -- which already has the module in hand -- passes
// `rgb` and `degrees` in once, and gets back a small renderer bound to its
// template. Types are erased at build time, so `import type` is free.
// ============================================================================
import type { PDFFont, PDFPage, RGB, Rotation } from "pdf-lib";
import { supabase } from "@/lib/supabase";

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

/** The two pdf-lib helpers these renderers need, supplied by the caller. */
export interface PdfDeps {
  rgb: (r: number, g: number, b: number) => RGB;
  degrees: (angle: number) => Rotation;
}

const GREY: [number, number, number] = [0.45, 0.45, 0.45];
const ascii = (s: string) => s.replace(/[^\x20-\x7E]/g, "");

/** Null when nothing is configured for this document type. Never throws. */
export async function fetchDocumentTemplate(documentType: DocumentType): Promise<DocTemplate | null> {
  try {
    // RLS scopes this to the caller's own tenant -- no .eq("tenant_id", ...)
    // here, per this codebase's rule that RLS injects it.
    const { data } = await supabase.from("document_templates")
      .select("header_text, footer_text, show_signature_line, signature_title, watermark_text, watermark_opacity")
      .eq("document_type", documentType).maybeSingle();
    if (!data) return null;
    return {
      headerText: data.header_text ?? null,
      footerText: data.footer_text ?? null,
      showSignatureLine: !!data.show_signature_line,
      signatureTitle: data.signature_title ?? null,
      watermarkText: data.watermark_text ?? null,
      watermarkOpacity: Number(data.watermark_opacity ?? 0.15),
    };
  } catch {
    return null;
  }
}

/**
 * Bind a template (possibly null) to the caller's pdf-lib instance.
 * Every method is a no-op when the template is null or the relevant field is
 * unset -- that is what preserves "no row == today's exact output".
 */
export function templateRenderer(deps: PdfDeps, tpl: DocTemplate | null) {
  const { rgb, degrees } = deps;
  const grey = () => rgb(...GREY);

  return {
    /** Call BEFORE body content: pdf-lib has no z-index, paint order is it. */
    watermark(page: PDFPage, font: PDFFont, W: number, H: number) {
      if (!tpl?.watermarkText) return;
      const text = ascii(tpl.watermarkText);
      if (!text) return;
      const size = 60;
      const width = font.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: W / 2 - (width / 2) * Math.cos(Math.PI / 4),
        y: H / 2 - (width / 2) * Math.sin(Math.PI / 4),
        size, font, color: rgb(0.5, 0.5, 0.5),
        opacity: tpl.watermarkOpacity,
        rotate: degrees(45),
      });
    },

    /** Returns the y to continue from (unchanged when unconfigured). */
    header(page: PDFPage, font: PDFFont, x: number, y: number): number {
      if (!tpl?.headerText) return y;
      const text = ascii(tpl.headerText);
      if (!text) return y;
      page.drawText(text, { x, y, size: 9, font, color: grey() });
      return y - 16;
    },

    footer(page: PDFPage, font: PDFFont, W: number, y = 46) {
      if (!tpl?.footerText) return;
      const text = ascii(tpl.footerText);
      if (!text) return;
      const width = font.widthOfTextAtSize(text, 7.5);
      page.drawText(text, { x: W / 2 - width / 2, y, size: 7.5, font, color: grey() });
    },

    signature(page: PDFPage, font: PDFFont, rightX: number, y: number) {
      if (!tpl?.showSignatureLine) return;
      page.drawLine({ start: { x: rightX - 170, y }, end: { x: rightX, y }, thickness: 0.75, color: grey() });
      page.drawText(ascii(tpl.signatureTitle ?? "Authorized signature"), {
        x: rightX - 170, y: y - 12, size: 8, font, color: grey(),
      });
    },
  };
}

export type TemplateRenderer = ReturnType<typeof templateRenderer>;
