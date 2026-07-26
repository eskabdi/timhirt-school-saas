// ============================================================================
// [INSA-style category: INTERNAL — see §21.9 on what "INSA category" labels
// mean for this codebase] manage-integration-credentials
// AuthZ: super_admin only. The ONLY write path into Supabase Vault for
// third-party payment/SMS gateway secrets (migration 011). Secret values are
// never echoed back in the response — only a "configured" boolean and
// timestamp. Each provider has a fixed allow-list of expected credential
// keys; anything outside that list, or a partial set, is rejected rather
// than silently stored (a half-configured provider fails silently later,
// which is worse than refusing it up front).
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const PROVIDER_KEYS: Record<string, string[]> = {
  chapa: ["secret_key", "webhook_secret"],
  telebirr: ["secret_key"],
  stripe: ["secret_key", "webhook_secret"],
  sms_geezsms: ["api_key"],
  sms_afromessage: ["api_key", "sender_id"],
};

const Payload = z.object({
  provider: z.enum(["chapa", "telebirr", "stripe", "sms_geezsms", "sms_afromessage"]),
  credentials: z.record(z.string().min(1).max(500)),
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
    const { provider, credentials } = parsed.data;

    const allowedKeys = PROVIDER_KEYS[provider];
    const gotKeys = Object.keys(credentials);
    if (gotKeys.some((k) => !allowedKeys.includes(k))) return errors.badRequest();
    if (allowedKeys.some((k) => !(k in credentials))) return errors.badRequest(); // no partial sets

    const db = ctx.adminClient;

    for (const key of allowedKeys) {
      const secretName = `${provider}_${key}`;
      const value = credentials[key];

      // vault.secrets is a real table in the `vault` schema; querying it for
      // an existing secret by name lets us decide create vs. update.
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

    await db.from("platform_integrations").update({
      configured: true, updated_by: ctx.userId, updated_at: new Date().toISOString(),
    }).eq("provider", provider);

    // Never echo credential values back — success + metadata only.
    return json({ provider, configured: true }, 200);
  } catch (err) {
    console.error("manage-integration-credentials failed", { message: (err as Error).message });
    return errors.internal();
  }
});
