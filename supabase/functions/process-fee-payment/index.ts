// ============================================================================
// [INSA-style category: PRIVATE — see §21.9] process-fee-payment
// AuthZ: parent-of-student OR school_admin/accountant, same tenant — enforced
// by RLS on the invoice lookup (user-scoped client). Amount is derived
// SERVER-SIDE from the invoice; the client can never set what it pays.
// Provider: Telebirr (H5 C2B Web Payment), the sole payment gateway — Chapa
// and Stripe are canceled. Credential/config source: Supabase Vault for
// secrets + platform_integrations.config for identifiers, both set via
// manage-integration-credentials / telebirr-generate-keypair — see
// _shared/telebirr.ts for the full signing/order/checkout-url flow.
// TESTBED ONLY until a production Telebirr merchant account exists.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";
import { loadTelebirrConfig, preOrder, buildCheckoutUrl } from "../_shared/telebirr.ts";

const Payload = z.object({
  invoice_id: z.string().uuid(),
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

    const telebirrCfg = await loadTelebirrConfig(ctx.adminClient);
    if (!telebirrCfg) {
      console.error("process-fee-payment: Telebirr not fully configured");
      return json({ error: "Payment gateway is not configured yet. Contact your platform administrator." }, 503);
    }

    // Server-derived amount — never trusted from the client
    const remaining = Number(invoice.amount_due) - Number(invoice.amount_paid);
    const amountEtb = remaining.toFixed(2);

    // Telebirr requires merch_order_id to match [A-Za-z0-9]+, <=64 chars.
    // The old Chapa-era `inv-<uuid>-<amount>` format contains hyphens and a
    // decimal point -- neither survives here. This stays idempotent per
    // outstanding-balance the same way the old format was: a retry against
    // the same remaining balance reuses the same order id, so a page
    // refresh doesn't double-charge.
    const remainingCents = Math.round(remaining * 100);
    const merchOrderId = `t${invoice.id.replace(/-/g, "")}${remainingCents}`;

    const { prepayId } = await preOrder(ctx.adminClient, telebirrCfg, {
      merchOrderId,
      amountEtb,
      title: "School fees",
      notifyUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/telebirr-notify`,
      redirectUrl: `${req.headers.get("origin") ?? ""}/fees/invoices/${invoice.id}`,
    });
    const checkoutUrl = await buildCheckoutUrl(telebirrCfg, { prepayId });

    // Record pending payment (service_role — clients cannot insert gateway rows)
    await ctx.adminClient.from("payments").insert({
      tenant_id: invoice.tenant_id, invoice_id: invoice.id,
      amount: amountEtb, provider: "telebirr", provider_ref: merchOrderId, status: "pending",
    });

    return json({ checkout_url: checkoutUrl, merch_order_id: merchOrderId }, 200);
  } catch (err) {
    console.error("process-fee-payment failed", { message: (err as Error).message });
    return errors.internal();
  }
});
