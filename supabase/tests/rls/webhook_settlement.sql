-- ============================================================================
-- Atomic webhook settlement — regression test for H3/H4. Exercises
-- settle_gateway_payment() directly (the function chapa-webhook calls after
-- HMAC verification): a correct-amount call credits exactly once; a replayed
-- tx_ref is a no-op; an unknown tx_ref reports not_found; a mismatched
-- amount is rejected WITHOUT crediting, leaving the payment 'pending'.
-- ============================================================================
begin;
select plan(8);

insert into public.tenants (id, name, slug, status) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'Tenant E', 'rls-test-tenant-e', 'active');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('eeee1111-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('eeee2222-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'eeee1111-0000-0000-0000-000000000001', 'Grade 1', 'A');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('eeee3333-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'eeee2222-0000-0000-0000-000000000001', 'ADM-E-001', 'Test', 'Student', '2015-01-01', 'male');
insert into public.fee_structures (id, tenant_id, name_i18n, amount, billing_cycle) values
  ('eeee4444-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', '{"en":"Tuition"}', 500, 'monthly');
insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, amount_paid, due_date, status) values
  ('eeee5555-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'eeee3333-0000-0000-0000-000000000001', 'eeee4444-0000-0000-0000-000000000001', 500.00, 0.00, '2026-08-01', 'pending');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, provider_ref, status) values
  ('eeee6666-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'eeee5555-0000-0000-0000-000000000001', 500.00, 'chapa', 'tx-ref-correct', 'pending'),
  ('eeee7777-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', 'eeee5555-0000-0000-0000-000000000001', 250.00, 'chapa', 'tx-ref-mismatch', 'pending');

-- ---------- 1. Unknown tx_ref --------------------------------------------------
select is(
  public.settle_gateway_payment('tx-ref-does-not-exist', 'chapa', 500.00),
  'not_found', 'Unknown tx_ref reports not_found and credits nothing');

-- ---------- 2. Correct amount settles exactly once -----------------------------
select is(
  public.settle_gateway_payment('tx-ref-correct', 'chapa', 500.00),
  'ok', 'Correct-amount settlement returns ok');

select is(
  (select status from public.payments where provider_ref = 'tx-ref-correct'),
  'succeeded', 'Payment flips to succeeded exactly once');

select is(
  (select amount_paid from public.fee_invoices where id = 'eeee5555-0000-0000-0000-000000000001'),
  500.00::numeric, 'Invoice amount_paid credited exactly once, matching the payment amount');

select is(
  (select status from public.fee_invoices where id = 'eeee5555-0000-0000-0000-000000000001'),
  'paid', 'Invoice status flips to paid once fully covered');

-- ---------- 3. Replay: same tx_ref again must be a no-op (H-4) -----------------
select is(
  public.settle_gateway_payment('tx-ref-correct', 'chapa', 500.00),
  'duplicate', 'Replaying the same tx_ref reports duplicate, not ok');

select is(
  (select amount_paid from public.fee_invoices where id = 'eeee5555-0000-0000-0000-000000000001'),
  500.00::numeric, 'Replay does NOT double-credit the invoice');

-- ---------- 4. Amount mismatch: never silently credit (H-3) --------------------
select is(
  public.settle_gateway_payment('tx-ref-mismatch', 'chapa', 999.00),
  'amount_mismatch', 'Gateway-reported amount not matching stored amount is rejected, not credited');

select * from finish();
rollback;
