-- ============================================================================
-- CRITICAL fix: settle_gateway_payment() failed on every real settlement.
--
-- `status = case when v_paid >= v_due then 'paid' else 'partial' end` — with
-- both CASE branches bare string literals and no other branch giving the
-- expression a concrete type, Postgres resolves the CASE's type to `text`
-- rather than deferring to the assignment target. `text` has no implicit or
-- assignment cast to the `invoice_status` enum, so the UPDATE inside this
-- function raised "column \"status\" is of type invoice_status but
-- expression is of type text" on every call — meaning chapa-webhook's
-- post-HMAC settlement (H3/H4) never actually credited an invoice in
-- practice. Caught by supabase/tests/rls/webhook_settlement.sql once CI was
-- fixed to actually run `supabase test db` (see the CI-config commit on this
-- PR — the RLS/pgTAP suite had never executed before this).
--
-- Fix: explicit cast to invoice_status. (apply_payment_to_invoice(), the
-- sibling trigger for manual cash/bank payments, is unaffected — its CASE
-- has an `else status` branch that is already invoice_status-typed, which
-- gives Postgres a concrete type to resolve the whole expression against.)
-- ============================================================================

create or replace function public.settle_gateway_payment(
  p_tx_ref text, p_provider public.payment_provider, p_reported_amount numeric)
returns text language plpgsql security definer set search_path = public as $$
declare v_pay record; v_due numeric; v_paid numeric;
begin
  -- replay guard first, but inside the same tx as the credit
  begin
    insert into public.webhook_events(id, provider) values (p_tx_ref, p_provider);
  exception when unique_violation then
    return 'duplicate';
  end;

  select id, invoice_id, amount into v_pay
  from public.payments where provider_ref = p_tx_ref and status = 'pending'
  for update limit 1;
  if v_pay.id is null then return 'not_found'; end if;

  if round(p_reported_amount, 2) <> round(v_pay.amount, 2) then
    return 'amount_mismatch';                     -- do NOT credit; leave pending
  end if;

  update public.payments set status = 'succeeded', paid_at = now() where id = v_pay.id;

  select amount_due, amount_paid into v_due, v_paid
  from public.fee_invoices where id = v_pay.invoice_id for update;
  v_paid := v_paid + v_pay.amount;
  update public.fee_invoices
    set amount_paid = v_paid,
        status = (case when v_paid >= v_due then 'paid' else 'partial' end)::public.invoice_status
    where id = v_pay.invoice_id;

  return 'ok';
end $$;
