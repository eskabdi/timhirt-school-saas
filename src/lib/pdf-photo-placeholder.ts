// Shared "Photo" placeholder box for the browser-generated PDF profile
// reports (staff-profile-pdf.ts, students/student-profile-pdf.ts). No photo
// is embedded — a signed storage URL is short-lived and would not survive
// into a downloaded, re-opened file — so this draws a labelled box in the
// spot a printed photo would occupy.
import type { Color, PDFFont, PDFPage } from "pdf-lib";

export interface PhotoPlaceholderOptions {
  x: number;
  y: number;
  size: number;
  label: string;
  font: PDFFont;
  borderColor: Color;
  textColor: Color;
  fillColor?: Color;
}

export function drawPhotoPlaceholder(page: PDFPage, opts: PhotoPlaceholderOptions): void {
  page.drawRectangle({
    x: opts.x, y: opts.y, width: opts.size, height: opts.size,
    borderColor: opts.borderColor, borderWidth: 1, color: opts.fillColor,
  });
  const fontSize = 10;
  const tw = opts.font.widthOfTextAtSize(opts.label, fontSize);
  page.drawText(opts.label, {
    x: opts.x + (opts.size - tw) / 2, y: opts.y + opts.size / 2 - fontSize / 2.6,
    size: fontSize, font: opts.font, color: opts.textColor,
  });
}
