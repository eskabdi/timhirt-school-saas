// Shared image helpers for the browser-generated PDF profile reports
// (staff-profile-pdf.ts, students/student-profile-pdf.ts): draws the
// person's actual photo when one was uploaded, stretched to the box like
// issue-id-card's drawImageBox, or a labelled placeholder box otherwise.
import type { Color, PDFDocument, PDFFont, PDFImage, PDFPage } from "pdf-lib";

// Person photos (avatars/student-photos buckets) are always PNG -- see
// convertImageToPng -- but the branding bucket's logo upload has no such
// conversion (accept="image/*"), so a tenant logo can be a JPEG. pdf-lib
// embeds PNG or JPEG only; anything else (WebP, SVG, HEIC) fails both and
// this returns null so the caller can omit the image rather than throw.
export async function embedImageAuto(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage | null> {
  try {
    return await doc.embedPng(bytes);
  } catch {
    try {
      return await doc.embedJpg(bytes);
    } catch (err) {
      console.error("pdf-photo-placeholder: image is neither PNG nor JPEG, omitting", err);
      return null;
    }
  }
}

export interface ProfilePhotoOptions {
  x: number;
  y: number;
  size: number;
  image: PDFImage | null;
  label: string;
  font: PDFFont;
  borderColor: Color;
  textColor: Color;
  fillColor?: Color;
}

export function drawProfilePhoto(page: PDFPage, opts: ProfilePhotoOptions): void {
  if (opts.image) {
    page.drawImage(opts.image, { x: opts.x, y: opts.y, width: opts.size, height: opts.size });
    page.drawRectangle({ x: opts.x, y: opts.y, width: opts.size, height: opts.size, borderColor: opts.borderColor, borderWidth: 1 });
    return;
  }
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
