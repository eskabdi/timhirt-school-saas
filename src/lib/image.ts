// pdf-lib can only embed PNG or JPEG images (not WebP), but the storage
// buckets that photos/backgrounds land in accept WebP too (existing upload
// flows already allow it). Rather than have issue-id-card try to detect and
// reject/skip WebP at render time, every path that feeds an image into a
// PDF converts it to PNG here, client-side, before it's ever uploaded —
// createImageBitmap decodes WebP/JPEG/PNG alike, so this is a one-way
// normalization, not a format-specific special case.
export async function convertImageToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("PNG conversion failed"))), "image/png");
  });
}
