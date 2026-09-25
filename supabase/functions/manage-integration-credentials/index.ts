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
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";
import { Payload } from "./schema.ts";
import { PROVIDER_CONFIG_KEYS, PROVIDER_SECRET_KEYS, sameKeys } from "./keys.ts";

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

    // Validate the whole request before any write, so a rejected request never
    // leaves a Vault secret behind (review AC-3). Both key sets are exact:
    // no unknown key, no missing key, and a provider that needs a set must send it.
    const secretKeys = PROVIDER_SECRET_KEYS[provider];
    const configKeys = PROVIDER_CONFIG_KEYS[provider];
    if (!sameKeys(credentials, secretKeys) || !sameKeys(config, configKeys)) return errors.badRequest();

    const db = ctx.adminClient;

    // The provider row must exist before anything is written, so a missing row
    // never leaves an orphan Vault secret behind (review R2-1).
    const { data: row, error: rowError } = await db.from("platform_integrations")
      .select("config").eq("provider", provider).maybeSingle();
    if (rowError) throw rowError;
    if (!row) throw new Error(`platform_integrations row missing for ${provider}`);

    // ---- secrets (Vault) ----
    for (const key of secretKeys) {
      const secretName = `${provider}_${key}`;
      const value = credentials![key]!;

      const { data: existing, error: lookupError } = await db.schema("vault").from("secrets")
        .select("id").eq("name", secretName).maybeSingle();
      if (lookupError) throw lookupError;

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

    // ---- config (platform_integrations.config jsonb) ----
    // The full secret/config set has been written (the exact-key check above
    // guarantees it), so the provider is configured.
    const { data: updated, error: updateError } = await db.from("platform_integrations").update({
      config: configKeys.length > 0 ? { ...(row.config ?? {}), ...config } : row.config,
      configured: true, updated_by: ctx.userId, updated_at: new Date().toISOString(),
    }).eq("provider", provider).select("provider").maybeSingle();
    if (updateError) throw updateError;
    if (!updated) throw new Error(`platform_integrations update matched no row for ${provider}`);

    // Never echo credential values back — success + metadata only.
    return json({ provider, configured: true }, 200);
  } catch (err) {
    console.error("manage-integration-credentials failed", { message: (err as Error).message });
    return errors.internal();
  }
});
