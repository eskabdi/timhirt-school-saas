// Tier-1 security test — verifyHmac() is the timing-safe check that guards the
// Chapa payment webhook (chapa-webhook/index.ts): a request whose signature
// fails here is rejected with 401 before any settlement is written. This tests
// the REAL function (imported from _shared/hmac.ts, the Deno-import-free module
// security.ts re-exports) rather than a re-implementation, so the test and the
// code that runs in production cannot drift.
//
// Reference signatures are computed here with a separate Web Crypto hex-encoder
// so verifyHmac's own comparison/encoding path (length guard, hex casing, trim,
// XOR loop) is exercised against a value it did not produce — a forgery is
// caught by disagreement, not by reusing verifyHmac's arithmetic.
import { describe, it, expect } from "vitest";
import { verifyHmac } from "../../supabase/functions/_shared/hmac";

const SECRET = "chapa-webhook-secret-key";
const PAYLOAD = JSON.stringify({ tx_ref: "TX-12345", status: "success", amount: 4200 });

/** Independent reference MAC — lowercase hex, the format Chapa sends. */
async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("verifyHmac (payment-webhook signature check)", () => {
  it("accepts a signature computed with the shared secret", async () => {
    expect(await verifyHmac(PAYLOAD, await sign(PAYLOAD, SECRET), SECRET)).toBe(true);
  });

  it("accepts an uppercase hex signature — casing is not a forgery", async () => {
    const upper = (await sign(PAYLOAD, SECRET)).toUpperCase();
    expect(await verifyHmac(PAYLOAD, upper, SECRET)).toBe(true);
  });

  it("accepts a signature with surrounding whitespace", async () => {
    expect(await verifyHmac(PAYLOAD, `  ${await sign(PAYLOAD, SECRET)}\n`, SECRET)).toBe(true);
  });

  it("rejects a signature made with the wrong secret", async () => {
    expect(await verifyHmac(PAYLOAD, await sign(PAYLOAD, "attacker-guess"), SECRET)).toBe(false);
  });

  it("rejects a valid signature over a tampered payload", async () => {
    const good = await sign(PAYLOAD, SECRET);
    const tampered = JSON.stringify({ tx_ref: "TX-12345", status: "success", amount: 999999 });
    expect(await verifyHmac(tampered, good, SECRET)).toBe(false);
  });

  it("rejects a one-hex-digit flip (avalanche — no partial match survives)", async () => {
    const good = await sign(PAYLOAD, SECRET);
    const flipped = (good[0] === "0" ? "1" : "0") + good.slice(1);
    expect(await verifyHmac(PAYLOAD, flipped, SECRET)).toBe(false);
  });

  it("rejects an empty signature", async () => {
    expect(await verifyHmac(PAYLOAD, "", SECRET)).toBe(false);
  });

  it("rejects a truncated signature (length mismatch, early-out)", async () => {
    const good = await sign(PAYLOAD, SECRET);
    expect(await verifyHmac(PAYLOAD, good.slice(0, -2), SECRET)).toBe(false);
  });

  it("rejects a signature padded to full length with extra hex", async () => {
    const good = await sign(PAYLOAD, SECRET);
    expect(await verifyHmac(PAYLOAD, good + "ab", SECRET)).toBe(false);
  });

  it("is sensitive to the exact secret (no truncation/normalisation)", async () => {
    const good = await sign(PAYLOAD, SECRET);
    expect(await verifyHmac(PAYLOAD, good, SECRET + " ")).toBe(false);
  });
});
