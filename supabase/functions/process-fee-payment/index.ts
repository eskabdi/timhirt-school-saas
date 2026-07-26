// ============================================================================
// [INSA-style category: PRIVATE — see §21.9] process-fee-payment
// AuthZ: parent-of-student OR school_admin/accountant, same tenant — enforced
// by RLS on the invoice lookup (user-scoped client). Amount is derived
// SERVER-SIDE from the invoice; the client can never set what it pays.
// Provider: Chapa (aggregates Telebirr, CBE Birr, cards). Stripe variant same shape.
// Credential source: Supabase Vault first (super_admin self-service via
// manage-integration-credentials), falling back to CHAPA_SECRET_KEY env var
// for infra-managed deployments — see getCredential() in _shared/security.ts.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, getCredential, corsHeaders } from "../_shared/security.ts";

const Payload = z.object({
  invoice_id: z.string().uuid(),
  provider: z.enum(["chapa", "telebirr"]).default("chapa"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();
    const ctx = await requireRole(req, ["parent", "school_admin", "accountant"]);
    if (ctx instanceof Response) return ctx;
    if (!(await rateLimit(`pay:${ctx.userId}`, 10, 60_000))) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();

    // AuthZ via RLS: if the caller cannot see this invoice, this returns null.
    const { data: invoice } = await ctx.userClient
      .from("fee_invoices")
      .select("id, tenant_id, amount_due, amount_paid, status")
      .eq("id", parsed.data.invoice_id).maybeSingle();
    if (!invoice || invoice.status === "paid") return errors.badRequest();

    const chapaSecretKey = await getCredential(ctx.adminClient, "chapa_secret_key", "CHAPA_SECRET_KEY");
    if (!chapaSecretKey) {
      console.error("process-fee-payment: no Chapa credential configured");
      return json({ error: "Payment gateway is not configured yet. Contact your platform administrator." }, 503);
    }

    // Server-derived amount — never trusted from the client
    const amount = (Number(invoice.amount_due) - Number(invoice.amount_paid)).toFixed(2);
    const txRef = `inv-${invoice.id}-${invoice.amount_paid}`; // idempotent per state

    const chapaRes = await fetch("https://api.chapa.co/v1/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chapaSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount, currency: "ETB", tx_ref: txRef,
        callback_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/chapa-webhook`,
        customization: { title: "School fees" },
        meta: { invoice_id: invoice.id, tenant_id: invoice.tenant_id },
      }),
    });
    if (!chapaRes.ok) throw new Error(`chapa_init_${chapaRes.status}`);
    const chapa = await chapaRes.json();

    // Record pending payment (service_role — clients cannot insert gateway rows)
    await ctx.adminClient.from("payments").insert({
      tenant_id: invoice.tenant_id, invoice_id: invoice.id,
      amount, provider: parsed.data.provider, provider_ref: txRef, status: "pending",
    });

    return json({ checkout_url: chapa.data?.checkout_url, tx_ref: txRef }, 200);
  } catch (err) {
    console.error("process-fee-payment failed", { message: (err as Error).message });
    return errors.internal();
  }
});
