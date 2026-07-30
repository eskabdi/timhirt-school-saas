// Pure Web Crypto helpers with no Deno- or npm-specific imports, so the same
// code runs in the Edge Function (Deno) and under Vitest (Node) — the pattern
// _shared/ethiopian-date.ts already follows. security.ts re-exports verifyHmac
// so existing callers (chapa-webhook) keep importing it from there unchanged.

/** Timing-safe HMAC-SHA256 verification for webhooks.
 *  Signatures are compared as lowercase hex — providers differ on casing and a
 *  case difference is not a forgery. */
export async function verifyHmac(payload: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = signature.trim().toLowerCase();
  if (expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
