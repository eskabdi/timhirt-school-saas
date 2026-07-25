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
