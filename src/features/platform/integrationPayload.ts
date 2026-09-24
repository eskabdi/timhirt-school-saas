// Builds the manage-integration-credentials request body from the Integrations
// page form. The secret/config split comes from the Edge Function's own key
// allow-lists (keys.ts), so the page cannot drift from what the server accepts
// (R6 WP-00 review AC-1: AfroMessage's sender_id was posted as a secret and
// every save was rejected with a 400).
import {
  PROVIDERS,
  PROVIDER_CONFIG_KEYS,
  PROVIDER_SECRET_KEYS,
  type Provider,
} from "../../../supabase/functions/manage-integration-credentials/keys";

export { PROVIDERS, type Provider };

export type CredentialsPayload = {
  provider: Provider;
  credentials: Record<string, string>;
  config?: Record<string, string>;
};

/** Every form field for a provider: secrets first, then config. */
export function providerFieldKeys(provider: Provider): { key: string; secret: boolean }[] {
  return [
    ...PROVIDER_SECRET_KEYS[provider].map((key) => ({ key, secret: true })),
    ...PROVIDER_CONFIG_KEYS[provider].map((key) => ({ key, secret: false })),
  ];
}

export function buildCredentialsPayload(
  provider: Provider,
  values: Record<string, string>,
): CredentialsPayload {
  const pick = (keys: readonly string[]) =>
    Object.fromEntries(keys.map((k) => [k, (values[k] ?? "").trim()]));
  const configKeys = PROVIDER_CONFIG_KEYS[provider];
  return {
    provider,
    credentials: pick(PROVIDER_SECRET_KEYS[provider]),
    ...(configKeys.length > 0 ? { config: pick(configKeys) } : {}),
  };
}
