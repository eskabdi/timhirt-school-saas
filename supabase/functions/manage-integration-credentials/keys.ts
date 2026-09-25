// Per-provider key allow-lists for manage-integration-credentials. Dependency
// free on purpose: the Edge Function (Deno) and the super-admin Integrations
// page (Vite, src/features/platform/integrationPayload.ts) both import this one
// module, so the browser can never post a key the server rejects. That drift is
// how AfroMessage became unconfigurable: the page sent `sender_id` as a secret
// while the server expected it as config (R6 WP-00 review, AC-1).
//
// Keep this file import-free: Vite bundles it into the browser app, so an
// `npm:`/`jsr:` specifier or a Deno global here breaks the frontend build.

export const PROVIDERS = ["sms_smsala", "sms_afromessage", "sms_geezsms"] as const;
export type Provider = (typeof PROVIDERS)[number];

// Secrets: Vault-backed, all-or-nothing per provider.
export const PROVIDER_SECRET_KEYS: Record<Provider, readonly string[]> = {
  sms_smsala: ["api_key"],
  sms_afromessage: ["api_key"],
  sms_geezsms: ["api_key"],
};

// Config: non-secret, platform_integrations.config jsonb. Also all-or-nothing
// per provider: every key must be present (so a client can't silently omit a
// field it forgot about), and schema.ts requires each value to be non-empty.
export const PROVIDER_CONFIG_KEYS: Record<Provider, readonly string[]> = {
  sms_smsala: [],
  sms_afromessage: ["sender_id"],
  sms_geezsms: [],
};

// True when `got` holds exactly `expected` (an absent map counts as empty).
export function sameKeys(got: Record<string, string> | undefined, expected: readonly string[]): boolean {
  const keys = Object.keys(got ?? {});
  return keys.length === expected.length && expected.every((k) => keys.includes(k));
}
