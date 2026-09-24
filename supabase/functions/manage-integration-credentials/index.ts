// ============================================================================
// [INSA-style category: INTERNAL — see §21.9 on what "INSA category" labels
// mean for this codebase] manage-integration-credentials
// AuthZ: super_admin only. The ONLY write path into Supabase Vault for
// SMS-provider SECRETS (migration 011), and into platform_integrations.config
// for their non-secret identifiers. Secret values are never echoed back in the response
// — only a "configured" boolean and timestamp. Each provider has a fixed
// allow-list of expected secret AND config keys; anything outside that list,
// or a partial secret set, is rejected rather than silently stored (a
// half-configured provider fails silently later, which is worse than
// refusing it up front).
//
// Chapa, Stripe and the Telebirr online gateway (decommissioned in R6 WP-00,
// C-01) are not providers -- posting any of them gets a clean 400 from the
// enum, not silent acceptance.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const PROVIDERS = ["sms_smsala", "sms_afromessage", "sms_geezsms"] as const;

// Secrets: Vault-backed, all-or-nothing per provider (same discipline as before).
const PROVIDER_SECRET_KEYS: Record<string, string[]> = {
  sms_smsala: ["api_key"],
  sms_afromessage: ["api_key"],
  sms_geezsms: ["api_key"],
};

// Config: non-secret, platform_integrations.config jsonb. Also all-or-nothing
// per provider (a value may be an empty string, but the KEY must be present so
// a client can't silently omit a field it forgot about).
const PROVIDER_CONFIG_KEYS: Record<string, string[]> = {
  sms_afromessage: ["sender_id"],
};

const Payload = z.object({
  provider: z.enum(PROVIDERS),
  credentials: z.record(z.string().min(1).max(500)).optional(),
  config: z.record(z.string().max(2000)).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();
    const ctx = await requireRole(req, ["super_admin"]);
    if (ctx instanceof Response) return ctx;
    if (!(await rateLimit(`creds:${ctx.userId}`, 10, 60_000))) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const { provider, credentials, config } = parsed.data;

    const db = ctx.adminClient;

    // ---- secrets (Vault) ----
    const allowedSecretKeys = PROVIDER_SECRET_KEYS[provider] ?? [];
    if (credentials) {
      const gotKeys = Object.keys(credentials);
      if (gotKeys.some((k) => !allowedSecretKeys.includes(k))) return errors.badRequest();
      if (allowedSecretKeys.some((k) => !(k in credentials))) return errors.badRequest(); // no partial sets

      for (const key of allowedSecretKeys) {
        const secretName = `${provider}_${key}`;
        const value = credentials[key];

        const { data: existing } = await db.schema("vault").from("secrets")
          .select("id").eq("name", secretName).maybeSingle();

        if (existing) {
          const { error } = await db.schema("vault").rpc("update_secret", {
            secret_id: existing.id, new_secret: value,
          });
          if (error) throw error;
        } else {
          const { error } = await db.schema("vault").rpc("create_secret", {
            new_secret: value, new_name: secretName,
            new_description: `${provider} ${key} — set via manage-integration-credentials`,
          });
          if (error) throw error;
        }
      }
    } else if (allowedSecretKeys.length > 0) {
      return errors.badRequest(); // provider needs secrets but none were posted
    }

    // ---- config (platform_integrations.config jsonb) ----
    const allowedConfigKeys = PROVIDER_CONFIG_KEYS[provider] ?? [];
    if (config) {
      const gotKeys = Object.keys(config);
      if (gotKeys.some((k) => !allowedConfigKeys.includes(k))) return errors.badRequest();
      if (allowedConfigKeys.some((k) => !(k in config))) return errors.badRequest(); // no partial sets

      const { data: row } = await db.from("platform_integrations")
        .select("config").eq("provider", provider).maybeSingle();
      const nextConfig = { ...(row?.config ?? {}), ...config };
      const { error } = await db.from("platform_integrations")
        .update({ config: nextConfig }).eq("provider", provider);
      if (error) throw error;
    } else if (allowedConfigKeys.length > 0) {
      return errors.badRequest(); // provider has config fields but none were posted
    }

    // Every remaining provider is configured once its full secret/config
    // set has been written, which the all-or-nothing checks above guarantee.
    const configured = true;
    await db.from("platform_integrations").update({
      configured, updated_by: ctx.userId, updated_at: new Date().toISOString(),
    }).eq("provider", provider);

    // Never echo credential values back — success + metadata only.
    return json({ provider, configured }, 200);
  } catch (err) {
    console.error("manage-integration-credentials failed", { message: (err as Error).message });
    return errors.internal();
  }
});
