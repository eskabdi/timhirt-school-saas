// R6 WP-00 review AC-1/AC-3: the server accepts exactly each provider's key
// set, and the page's payload shape (secret vs config) passes that check.
import { assert, assertFalse } from "jsr:@std/assert@1";
import { PROVIDER_CONFIG_KEYS, PROVIDER_SECRET_KEYS, PROVIDERS, sameKeys } from "./keys.ts";

Deno.test("AfroMessage: sender_id is config, not a secret", () => {
  assert(sameKeys({ api_key: "k" }, PROVIDER_SECRET_KEYS.sms_afromessage));
  assert(sameKeys({ sender_id: "S" }, PROVIDER_CONFIG_KEYS.sms_afromessage));
  // The pre-fix page payload: sender_id posted inside credentials.
  assertFalse(sameKeys({ api_key: "k", sender_id: "S" }, PROVIDER_SECRET_KEYS.sms_afromessage));
});

Deno.test("missing, extra and absent key sets are rejected", () => {
  for (const p of PROVIDERS) {
    const secrets = PROVIDER_SECRET_KEYS[p];
    assertFalse(sameKeys({}, secrets), `${p}: empty secrets`);
    assertFalse(sameKeys(undefined, secrets), `${p}: absent secrets`);
    const full = Object.fromEntries(secrets.map((k) => [k, "v"]));
    assertFalse(sameKeys({ ...full, extra: "x" }, secrets), `${p}: extra key`);
    assert(sameKeys(full, secrets), `${p}: exact set`);
  }
});

Deno.test("providers without config accept only an absent or empty config", () => {
  assert(sameKeys(undefined, PROVIDER_CONFIG_KEYS.sms_smsala));
  assertFalse(sameKeys({ sender_id: "S" }, PROVIDER_CONFIG_KEYS.sms_smsala));
});
