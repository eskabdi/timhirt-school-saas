// ============================================================================
// [INSA-style category: PUBLIC — see §21.9] telebirr-notify
// verify_jwt=false in config. Replaces chapa-webhook's role for the Telebirr
// gateway: the async payment-result callback Telebirr's H5 C2B API posts to
// whatever notify_url was passed on preOrder (docs' "Step 7: Notify").
//
// INBOUND SIGNATURE VERIFICATION IS NOT IMPLEMENTED. Telebirr signs this
// payload with their own private key; verifying it requires Telebirr's
// public key, which is not available anywhere in the source documentation
// and is not yet stored in platform_integrations.config.telebirr_public_key_pem
// (blank until Ethio Telecom supplies it). THIS IS A PRE-PRODUCTION BLOCKER,
// the same severity class this repo already gives chapa-webhook's HMAC
// check — every invocation logs it loudly so it cannot be missed in
// function logs or during a later security pass. Testbed development can
// proceed without it; production must not.
//
// Settlement (replay-guard + amount-check + invoice credit) reuses
// settle_gateway_payment() (migration 010) UNCHANGED, called with
// p_provider='telebirr' — the same atomic, provider-agnostic RPC
// chapa-webhook already calls, proven provider-agnostic by
// supabase/tests/rls/telebirr_gateway.sql.
//
// NOTE the trade_status vocabulary here (Paying|Expired|Pending|Completed|
// Failure) is DIFFERENT from queryOrder's (PAY_SUCCESS|PAY_FAILED|...) —
// see _shared/telebirr.ts's QueryOrderStatus type. Deliberately not shared
// with this file's mapping; collapsing the two was explicitly ruled out.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { errors, json, corsHeaders } from "../_shared/security.ts";
import { issueFeeDocument, notifyBilling, renderReceiptPdf, type FeeLineItem } from "../_shared/fee-pdf.ts";

type NotifyTradeStatus = "Paying" | "Expired" | "Pending" | "Completed" | "Failure";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();

    console.error("telebirr-notify: inbound signature NOT verified — testbed only, pre-production blocker (Telebirr public key unavailable)");

    const event = await req.json().catch(() => null);
    if (!event) return json({ received: true }, 200);

    const merchOrderId: string | undefined = event?.merch_order_id;
    const tradeStatus: NotifyTradeStatus | undefined = event?.trade_status;
    const transId: string | undefined = event?.trans_id;
    const totalAmount = Number(event?.total_amount ?? NaN);

    if (!merchOrderId || !tradeStatus) return json({ received: true }, 200);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (tradeStatus === "Completed") {
      if (!Number.isFinite(totalAmount)) return json({ received: true }, 200);

      const { data: result, error } = await db.rpc("settle_gateway_payment", {
        p_tx_ref: merchOrderId, p_provider: "telebirr", p_reported_amount: totalAmount,
      });
      if (error) throw error;

      if (result === "amount_mismatch") {
        console.error("telebirr-notify amount mismatch", { merchOrderId });
      }

      if (transId) {
        await db.from("payments").update({ provider_trans_id: transId })
          .eq("provider_ref", merchOrderId).eq("provider", "telebirr");
      }

      // Receipt + notification generation is best-effort and must NEVER
      // affect this function's 200 ack — same reasoning chapa-webhook
      // documents: the payment is already settled atomically above, and a
      // failed ack would just make Telebirr retry a call whose retry can't
      // repair a receipt-generation failure.
      if (result === "ok") {
        try {
          const { data: payment } = await db.from("payments")
            .select("id, tenant_id, invoice_id, amount, paid_at, provider, provider_ref")
            .eq("provider_ref", merchOrderId).eq("provider", "telebirr").maybeSingle();
          if (payment) {
            // payment.invoice_id is an invoice_headers id (20260820000001) --
            // settle_gateway_payment already allocated this payment across
            // every unpaid line item under it; re-read them for the receipt.
            const { data: header } = await db.from("invoice_headers")
              .select("id, student_id").eq("id", payment.invoice_id).maybeSingle();
            if (header) {
              const { data: lines } = await db.from("fee_invoices")
                .select("amount_due, amount_paid, status, fee_structure:fee_structures(name_i18n, billing_cycle)")
                .eq("invoice_header_id", header.id).order("created_at");
              const { data: student } = await db.from("students")
                .select("id, tenant_id, first_name, last_name, admission_no")
                .eq("id", header.student_id).maybeSingle();
              const { data: tenant } = await db.from("tenants").select("name").eq("id", payment.tenant_id).maybeSingle();
              if (student && tenant && lines) {
                const lineItems: FeeLineItem[] = lines.map((l) => {
                  const fs = l.fee_structure as unknown as { name_i18n: Record<string, string>; billing_cycle: string } | null;
                  return {
                    feeStructureName: fs?.name_i18n?.en ?? "Fee", billingCycle: fs?.billing_cycle ?? "-",
                    amountDue: Number(l.amount_due), amountPaid: Number(l.amount_paid), status: l.status,
                  };
                });
                const amountDue = lineItems.reduce((s, l) => s + l.amountDue, 0);
                const amountPaid = lineItems.reduce((s, l) => s + l.amountPaid, 0);
                const doc = await issueFeeDocument(db, {
                  kind: "receipt", tenantId: payment.tenant_id, invoiceId: header.id,
                  paymentId: payment.id, amount: payment.amount,
                  render: ({ docNo, verifyCode }) => renderReceiptPdf({
                    tenantName: tenant.name,
                    docNo, verifyCode, issuedOn: new Date().toISOString().slice(0, 10),
                    studentName: `${student.first_name} ${student.last_name}`.trim(),
                    admissionNo: student.admission_no,
                    receivedFrom: `${student.first_name} ${student.last_name}`.trim(),
                    lineItems,
                    amount: payment.amount, provider: "telebirr", providerRef: payment.provider_ref,
                    paidAt: (payment.paid_at ?? new Date().toISOString()).slice(0, 10),
                    invoiceBalanceAfter: Math.max(0, amountDue - amountPaid),
                  }),
                });
                if (doc) {
                  await notifyBilling(db, {
                    tenantId: payment.tenant_id, studentId: header.student_id,
                    kind: "payment_received", invoiceId: header.id, paymentId: payment.id,
                    amount: payment.amount,
                  });
                }
              }
            }
          }
        } catch (docErr) {
          console.error("telebirr-notify: receipt/notification generation failed (non-fatal)", { message: (docErr as Error).message });
        }
      }

      return json({ received: true, result }, 200);
    }

    if (tradeStatus === "Failure" || tradeStatus === "Expired") {
      // No RPC needed here -- nothing to atomically roll back, unlike the
      // success path which credits an invoice.
      await db.from("payments").update({ status: "failed" })
        .eq("provider_ref", merchOrderId).eq("provider", "telebirr").eq("status", "pending");
      if (transId) {
        await db.from("payments").update({ provider_trans_id: transId })
          .eq("provider_ref", merchOrderId).eq("provider", "telebirr");
      }
      return json({ received: true }, 200);
    }

    // Paying | Pending -- payment still in flight, ack only, no state change.
    return json({ received: true }, 200);
  } catch (err) {
    console.error("telebirr-notify failed", { message: (err as Error).message });
    return errors.internal();
  }
});
