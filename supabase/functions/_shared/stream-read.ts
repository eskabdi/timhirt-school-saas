// ============================================================================
// Shared streaming-read-with-size-cap primitive. Factored out of
// bank-verify.ts's verifyBankUrl and manage-sso-provider's fetchMetadataXml,
// which both fetch an admin/applicant-supplied URL server-side and needed
// the identical "read the body in chunks, bail if it exceeds a cap, never
// buffer an unbounded response" loop -- the SSRF strategy around each fetch
// differs (bank-verify.ts uses an exact-hostname allow-list; the SSO
// metadata fetch has no allow-list to use, so it checks the resolved IP
// range instead), but the byte-accumulation loop itself was verbatim
// duplicated and is now the one thing this module owns.
// ============================================================================
export type StreamReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "empty_body" | "too_large" | "read_failed" };

export async function readBodyWithCap(res: Response, maxBytes: number): Promise<StreamReadResult> {
  if (!res.body) return { ok: false, reason: "empty_body" };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "read_failed" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  return { ok: true, bytes };
}
