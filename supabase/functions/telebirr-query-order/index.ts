// ============================================================================
// [INSA-style category: PRIVATE — see §21.9] telebirr-query-order
// AuthZ: school_admin/accountant, same tenant — enforced by RLS on the
// payment lookup (user-scoped client), same "AuthZ via RLS" pattern
// process-fee-payment uses. On-demand reconciliation only: this repo has no
// pg_cron usage anywhere (cleanup_old_audit_logs() ships explicitly
// unscheduled too), so there is no automatic retry — an accountant clicks
// "Refresh status" on a stuck-pending invoice, which calls this.
//
// queryOrder's trade_status vocabulary (PAY_SUCCESS|PAY_FAILED|WAIT_PAY|
// ORDER_CLOSED|PAYING|ACCEPTED|REFUNDING|REFUND_SUCCESS|REFUND_FAILED) is
// DIFFERENT from telebirr-notify's (Paying|Expired|Pending|Completed|
// Failure) — see _shared/telebirr.ts. Each file maps only its own
// vocabulary, deliberately not shared.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";
import { loadTelebirrConfig, queryOrder } from "../_shared/telebirr.ts";

const Payload = z.object({
  payment_id: z.string().uuid(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();
    const ctx = await requireRole(req, ["school_admin", "accountant"]);
    if (ctx instanceof Response) return ctx;
    if (!(await rateLimit(`tb-query:${ctx.userId}`, 20, 60_000))) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();

    // AuthZ via RLS: if the caller cannot see this payment, this returns null.
    const { data: payment } = await ctx.userClient
      .from("payments")
      .select("id, invoice_id, provider, provider_ref, status")
      .eq("id", parsed.data.payment_id).maybeSingle();
    if (!payment || payment.provider !== "telebirr" || !payment.provider_ref) return errors.badRequest();

    if (payment.status !== "pending") {
      return json({ status: payment.status }, 200);
    }

    const telebirrCfg = await loadTelebirrConfig(ctx.adminClient);
    if (!telebirrCfg) {
      console.error("telebirr-query-order: Telebirr not fully configured");
      return json({ error: "Payment gateway is not configured yet. Contact your platform administrator." }, 503);
    }

    const result = await queryOrder(ctx.adminClient, telebirrCfg, payment.provider_ref);

    if (result.tradeStatus === "PAY_SUCCESS") {
      const amount = Number(result.totalAmount ?? NaN);
      if (Number.isFinite(amount)) {
        const { data: settleResult, error } = await ctx.adminClient.rpc("settle_gateway_payment", {
          p_tx_ref: payment.provider_ref, p_provider: "telebirr", p_reported_amount: amount,
        });
        if (error) throw error;
        if (settleResult === "amount_mismatch") {
          console.error("telebirr-query-order amount mismatch", { paymentId: payment.id });
        }
      }
      if (result.transId) {
        await ctx.adminClient.from("payments").update({ provider_trans_id: result.transId })
          .eq("id", payment.id);
      }
      return json({ status: "succeeded" }, 200);
    }

    if (result.tradeStatus === "PAY_FAILED" || result.tradeStatus === "ORDER_CLOSED") {
      await ctx.adminClient.from("payments").update({ status: "failed" })
        .eq("id", payment.id).eq("status", "pending");
      return json({ status: "failed" }, 200);
    }

    // WAIT_PAY | PAYING | ACCEPTED | REFUNDING | REFUND_SUCCESS | REFUND_FAILED
    // -- still in flight or refund-related, no state change here.
    return json({ status: "pending", telebirr_status: result.tradeStatus }, 200);
  } catch (err) {
    console.error("telebirr-query-order failed", { message: (err as Error).message });
    return errors.internal();
  }
});
