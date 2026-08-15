// ============================================================================
// telebirr-generate-keypair
// AuthZ: super_admin only. Generates the platform-wide RSA keypair Telebirr's
// H5 C2B signing scheme requires (RSASSA-PKCS1-v1_5/SHA-256, see
// _shared/telebirr.ts). The private key NEVER passes through the browser —
// it is generated server-side and written straight to Vault, mirroring this
// codebase's existing secret-handling discipline (migration 011). The public
// key is the one deliberate, narrow exception to "never re-display a secret
// value": it is not secret, and displaying it is the only way an admin can
// hand it to Ethio Telecom's merchant portal (an onboarding step, not code).
// Regenerating orphans whatever key Telebirr currently has on file for this
// merchant — the frontend confirms that with the admin before calling this.
// ============================================================================
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

function arrayBufferToPem(buf: ArrayBuffer, label: string): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();
    const ctx = await requireRole(req, ["super_admin"]);
    if (ctx instanceof Response) return ctx;
    if (!(await rateLimit(`tb-keygen:${ctx.userId}`, 5, 300_000))) return errors.tooMany();

    const db = ctx.adminClient;

    const pair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true, ["sign", "verify"],
    );
    const privPkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
    const pubSpki = await crypto.subtle.exportKey("spki", pair.publicKey);
    const privPem = arrayBufferToPem(privPkcs8, "PRIVATE KEY");
    const pubPem = arrayBufferToPem(pubSpki, "PUBLIC KEY");

    // Vault write — same create-or-update pattern as manage-integration-credentials.
    const secretName = "telebirr_private_key_pem";
    const { data: existing } = await db.schema("vault").from("secrets")
      .select("id").eq("name", secretName).maybeSingle();
    if (existing) {
      const { error } = await db.schema("vault").rpc("update_secret", {
        secret_id: existing.id, new_secret: privPem,
      });
      if (error) throw error;
    } else {
      const { error } = await db.schema("vault").rpc("create_secret", {
        new_secret: privPem, new_name: secretName,
        new_description: "Telebirr H5 C2B signing private key — generated via telebirr-generate-keypair",
      });
      if (error) throw error;
    }

    // Merge (not overwrite) config -- preserve appid/merch_code/etc. already saved.
    const { data: row } = await db.from("platform_integrations")
      .select("config").eq("provider", "telebirr").maybeSingle();
    const nextConfig = {
      ...(row?.config ?? {}),
      our_public_key_pem: pubPem,
      key_generated_at: new Date().toISOString(),
    };
    const { error: updErr } = await db.from("platform_integrations")
      .update({ config: nextConfig, updated_by: ctx.userId, updated_at: new Date().toISOString() })
      .eq("provider", "telebirr");
    if (updErr) throw updErr;

    return json({ our_public_key_pem: pubPem }, 200);
  } catch (err) {
    console.error("telebirr-generate-keypair failed", { message: (err as Error).message });
    return errors.internal();
  }
});
