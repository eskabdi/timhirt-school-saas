// R6 WP-00 (test-verifier F5): the credential endpoint must refuse every
// payment-gateway provider, so no gateway secret can be written to Vault.
import { assert, assertFalse } from "jsr:@std/assert@1";
import { Payload, PROVIDERS } from "./schema.ts";

Deno.test("only SMS providers are accepted", () => {
  for (const p of PROVIDERS) assert(p.startsWith("sms_"), p);
});

Deno.test("gateway providers are rejected (Telebirr decommissioned, Chapa/Stripe canceled)", () => {
  for (const provider of ["telebirr", "chapa", "stripe", "TELEBIRR", ""]) {
    const r = Payload.safeParse({ provider, credentials: { api_key: "x" } });
    assertFalse(r.success, `provider=${provider} must be rejected`);
  }
});

Deno.test("a valid SMS payload is accepted", () => {
  const r = Payload.safeParse({ provider: "sms_smsala", credentials: { api_key: "k" } });
  assert(r.success);
});

Deno.test("unknown top-level fields are rejected (.strict(), review AC-2)", () => {
  const r = Payload.safeParse({ provider: "sms_smsala", credentials: { api_key: "k" }, extra: 1 });
  assertFalse(r.success);
});

Deno.test("empty config values are rejected (review R2-TV-7)", () => {
  const r = Payload.safeParse({
    provider: "sms_afromessage", credentials: { api_key: "k" }, config: { sender_id: "" },
  });
  assertFalse(r.success);
});
