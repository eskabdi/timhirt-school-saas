// pdf-lib can only embed PNG or JPEG images (not WebP), but the storage
// buckets that photos/backgrounds land in accept WebP too (existing upload
// flows already allow it). Rather than have issue-id-card try to detect and
// reject/skip WebP at render time, every path that feeds an image into a
// PDF converts it to PNG here, client-side, before it's ever uploaded —
// createImageBitmap decodes WebP/JPEG/PNG alike, so this is a one-way
// normalization, not a format-specific special case.
//
// `maxDimension` matters because PNG is lossless: re-encoding a compressed
// JPEG routinely comes out several times larger than the original, so a
// source comfortably under a bucket's size limit can exceed it after
// conversion. Callers writing into a size-capped bucket (student-photos is
// 2 MB) pass a bound; a photo only ever printed at ~55x65pt on a card has
// nothing to gain from full camera resolution.
export async function convertImageToPng(blob: Blob, maxDimension?: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  let { width, height } = bitmap;
  if (maxDimension && Math.max(width, height) > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("PNG conversion failed"))), "image/png");
  });
}

/** Long edge for stored student photos. The ID card prints one at ~55x65pt,
 *  so 600px still leaves headroom above 300dpi while keeping the converted
 *  PNG well inside the student-photos bucket's 2 MB limit. */
export const STUDENT_PHOTO_MAX_PX = 600;

/** Same decode-and-redraw approach as convertImageToPng, encoding to WebP
 *  instead -- for storage-only image uploads that are never embedded into a
 *  pdf-lib PDF. pdf-lib can only embed PNG/JPEG (see convertImageToPng's own
 *  header), so anything that later needs PDF embedding must keep using that
 *  function instead of this one; this is for uploads that are only ever
 *  displayed on screen or downloaded raw (staff HR documents, assignment
 *  attachments). At quality 0.92 WebP is visually indistinguishable from the
 *  source for photographic content (ID/certificate scans) while typically
 *  landing at a fraction of the PNG re-encode's size -- unlike PNG, WebP's
 *  encoder is lossy-capable, so it doesn't inflate a compressed JPEG source
 *  the way a lossless re-encode does.
 *
 *  No new dependency: canvas.toBlob("image/webp") is natively supported by
 *  every browser this app targets, and per spec silently falls back to PNG
 *  if a browser somehow doesn't support WebP encoding -- never a hard error. */
export async function convertImageToWebp(blob: Blob, maxDimension?: number, quality = 0.92): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  let { width, height } = bitmap;
  if (maxDimension && Math.max(width, height) > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("WebP conversion failed"))), "image/webp", quality);
  });
}

/** Long edge for staff documents and assignment attachments converted to
 *  WebP -- these are legibility scans (ID cards, certificates, worksheets),
 *  not thumbnails, so the cap is generous next to STUDENT_PHOTO_MAX_PX. */
export const DOCUMENT_IMAGE_MAX_PX = 2000;
