// ============================================================================
// [INSA-style category: PUBLIC — HMAC-signature gated — see §21.9]
// chapa-webhook
// verify_jwt=false in config; instead: HMAC-SHA256 signature verification.
// H-3/H-4 fix: settlement (replay-guard + amount-check + invoice credit) now
// happens atomically inside settle_gateway_payment() (migration 010) — a
// single service_role RPC call, so a crash mid-way can never leave the
// replay guard written without the credit applied (or vice versa). The
// gateway-reported amount is verified against the stored payment amount
// before any credit is applied; a mismatch is logged for manual review and
// the payment is left 'pending' rather than silently trusted.
// This webhook is the ONLY path that flips a gateway payment to succeeded.
// Credential source: Supabase Vault first (super_admin self-service via
// manage-integration-credentials), falling back to CHAPA_WEBHOOK_SECRET env
// var for infra-managed deployments — see getCredential() in _shared/security.ts.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { errors, json, verifyHmac, getCredential, corsHeaders } from "../_shared/security.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();
    const raw = await req.text();
    const signature = req.headers.get("Chapa-Signature")
      ?? req.headers.get("x-chapa-signature") ?? "";
    // ⚠️ UNVERIFIED — needs runtime test: confirm the header name and whether
    // Chapa signs the raw body or a secret hash against their current docs
    // before go-live.

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const webhookSecret = await getCredential(db, "chapa_webhook_secret", "CHAPA_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("chapa-webhook: no webhook secret configured — rejecting");
      return errors.unauthorized();
    }
    const ok = await verifyHmac(raw, signature, webhookSecret);
    if (!ok) return errors.unauthorized();

    const event = JSON.parse(raw);
    const txRef: string | undefined = event?.tx_ref ?? event?.data?.tx_ref;
    if (!txRef || event?.status !== "success") return json({ received: true }, 200);

    const reported = Number(event?.amount ?? event?.data?.amount ?? NaN);
    if (!Number.isFinite(reported)) return json({ received: true }, 200);

    const { data: result, error } = await db.rpc("settle_gateway_payment", {
      p_tx_ref: txRef, p_provider: "chapa", p_reported_amount: reported,
    });
    if (error) throw error;

    // 'amount_mismatch' -> never silently credit; flag for manual review.
    // No amounts logged beyond the tx_ref (no financial data in logs).
    if (result === "amount_mismatch") {
      console.error("chapa-webhook amount mismatch", { txRef });
    }

    return json({ received: true, result }, 200);
  } catch (err) {
    console.error("chapa-webhook failed", { message: (err as Error).message });
    return errors.internal();
  }
});
