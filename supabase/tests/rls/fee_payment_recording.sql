-- ============================================================================
-- Manual payment recording + invoice crediting (record-fee-payment /
-- enroll-finalize-billing's underlying RLS + trigger contract). Proves:
-- an accountant cannot forge a gateway payment or insert a non-succeeded
-- manual payment; a registrar can write neither payments nor fee_invoices
-- directly (the exact gap enroll-finalize-billing's service_role write
-- exists to route around); a valid accountant cash insert actually credits
-- the invoice through apply_payment_to_invoice (pending -> partial -> paid);
-- the provider_ref unique index is real idempotency, not decoration; and a
-- provider='bank' payment fires the same credit trigger as 'cash' (guards
-- the "map admission methods to bank, not telebirr" decision against a
-- future regression that would silently stop crediting).
-- ============================================================================
begin;
select plan(12);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'aeb00001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fp-admin@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aeb00002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'fp-accountant@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aeb00003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'fp-registrar@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('aeb00000-0000-0000-0000-00000000000a', 'FP Tenant', 'fp-tenant', 'active', 'premium');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('aeb00001-0000-0000-0000-000000000001', 'aeb00000-0000-0000-0000-00000000000a', 'school_admin', 'FP Admin',      'fp-admin@test.example'),
  ('aeb00002-0000-0000-0000-000000000002', 'aeb00000-0000-0000-0000-00000000000a', 'accountant',   'FP Accountant', 'fp-accountant@test.example'),
  ('aeb00003-0000-0000-0000-000000000003', 'aeb00000-0000-0000-0000-00000000000a', 'registrar',    'FP Registrar',  'fp-registrar@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('aeb10000-0000-0000-0000-000000000001', 'aeb00000-0000-0000-0000-00000000000a', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('aeb20000-0000-0000-0000-000000000001', 'aeb00000-0000-0000-0000-00000000000a', 'aeb10000-0000-0000-0000-000000000001', 'Grade 1', 'A');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('aeb30000-0000-0000-0000-000000000001', 'aeb00000-0000-0000-0000-00000000000a', 'aeb20000-0000-0000-0000-000000000001', 'ADM-FP-001', 'Stu', 'One', '2015-01-01', 'male');
insert into public.fee_structures (id, tenant_id, name_i18n, amount, billing_cycle) values
  ('aeb40000-0000-0000-0000-000000000001', 'aeb00000-0000-0000-0000-00000000000a', '{"en":"Tuition"}', 500, 'monthly');
-- Two separate headers (not one shared header) -- this suite tests
-- independent per-invoice crediting; the "several fee items share one
-- header" behavior has its own dedicated suite (invoice_consolidation.sql).
insert into public.invoice_headers (id, tenant_id, student_id, due_date) values
  ('aebc0001-0000-0000-0000-000000000001', 'aeb00000-0000-0000-0000-00000000000a', 'aeb30000-0000-0000-0000-000000000001', '2026-08-01'),
  ('aebc0002-0000-0000-0000-000000000002', 'aeb00000-0000-0000-0000-00000000000a', 'aeb30000-0000-0000-0000-000000000001', '2026-08-02');
insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, amount_paid, due_date, status, invoice_header_id) values
  ('aeb50000-0000-0000-0000-000000000001', 'aeb00000-0000-0000-0000-00000000000a', 'aeb30000-0000-0000-0000-000000000001', 'aeb40000-0000-0000-0000-000000000001', 500.00, 0, '2026-08-01', 'pending', 'aebc0001-0000-0000-0000-000000000001'),
  ('aeb50000-0000-0000-0000-000000000002', 'aeb00000-0000-0000-0000-00000000000a', 'aeb30000-0000-0000-0000-000000000001', 'aeb40000-0000-0000-0000-000000000001', 300.00, 0, '2026-08-02', 'pending', 'aebc0002-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claim.sub = 'aeb00002-0000-0000-0000-000000000002'; -- accountant

select throws_ok(
  $stmt$ insert into public.payments (tenant_id, invoice_id, amount, provider, provider_ref, status)
         values ('aeb00000-0000-0000-0000-00000000000a', 'aebc0001-0000-0000-0000-000000000001', 500.00, 'chapa', 'fp-chapa-1', 'succeeded') $stmt$,
  '42501', null, 'an accountant cannot forge a gateway (chapa) payment');

select throws_ok(
  $stmt$ insert into public.payments (tenant_id, invoice_id, amount, provider, provider_ref, status)
         values ('aeb00000-0000-0000-0000-00000000000a', 'aebc0001-0000-0000-0000-000000000001', 500.00, 'telebirr', 'fp-telebirr-1', 'succeeded') $stmt$,
  '42501', null, 'an accountant cannot forge a telebirr gateway payment either -- payments_manual_insert stays cash|bank only post-migration');

select throws_ok(
  $stmt$ insert into public.payments (tenant_id, invoice_id, amount, provider, status)
         values ('aeb00000-0000-0000-0000-00000000000a', 'aebc0001-0000-0000-0000-000000000001', 500.00, 'cash', 'pending') $stmt$,
  '42501', null, 'an accountant cannot insert a cash payment with status other than succeeded');

set local request.jwt.claim.sub = 'aeb00003-0000-0000-0000-000000000003'; -- registrar

select throws_ok(
  $stmt$ insert into public.payments (tenant_id, invoice_id, amount, provider, status)
         values ('aeb00000-0000-0000-0000-00000000000a', 'aebc0001-0000-0000-0000-000000000001', 500.00, 'cash', 'succeeded') $stmt$,
  '42501', null, 'a registrar cannot insert a manual cash payment (only school_admin/accountant) -- this is the exact gap enroll-finalize-billing routes around');

select throws_ok(
  $stmt$ insert into public.fee_invoices (tenant_id, student_id, fee_structure_id, amount_due, due_date, invoice_header_id)
         values ('aeb00000-0000-0000-0000-00000000000a', 'aeb30000-0000-0000-0000-000000000001', 'aeb40000-0000-0000-0000-000000000001', 100.00, '2026-08-01', 'aebc0001-0000-0000-0000-000000000001') $stmt$,
  '42501', null, 'a registrar cannot insert a fee_invoices row directly (only school_admin/accountant)');

set local request.jwt.claim.sub = 'aeb00002-0000-0000-0000-000000000002'; -- accountant, valid path

select lives_ok(
  $stmt$ insert into public.payments (tenant_id, invoice_id, amount, provider, status)
         values ('aeb00000-0000-0000-0000-00000000000a', 'aebc0001-0000-0000-0000-000000000001', 300.00, 'cash', 'succeeded') $stmt$,
  'accountant''s valid cash payment insert succeeds');

select is(
  (select status::text from public.fee_invoices where id = 'aeb50000-0000-0000-0000-000000000001'),
  'partial', 'apply_payment_to_invoice credits the invoice to partial after a 300/500 payment');

select lives_ok(
  $stmt$ insert into public.payments (tenant_id, invoice_id, amount, provider, status)
         values ('aeb00000-0000-0000-0000-00000000000a', 'aebc0001-0000-0000-0000-000000000001', 200.00, 'cash', 'succeeded') $stmt$,
  'second cash payment covering the remaining balance succeeds');

select is(
  (select status::text from public.fee_invoices where id = 'aeb50000-0000-0000-0000-000000000001'),
  'paid', 'invoice flips to paid once amount_paid reaches amount_due');

-- ---------- provider='bank' fires the same credit trigger as 'cash' -----------
select lives_ok(
  $stmt$ insert into public.payments (tenant_id, invoice_id, amount, provider, provider_ref, status)
         values ('aeb00000-0000-0000-0000-00000000000a', 'aebc0002-0000-0000-0000-000000000002', 300.00, 'bank', 'adm-cbe-app-1', 'succeeded') $stmt$,
  'a provider=bank payment insert succeeds');

select is(
  (select status::text from public.fee_invoices where id = 'aeb50000-0000-0000-0000-000000000002'),
  'paid', 'a provider=bank payment credits the invoice via apply_manual_payment_trg exactly like cash -- guards the admission-methods-map-to-bank decision');

select throws_ok(
  $stmt$ insert into public.payments (tenant_id, invoice_id, amount, provider, provider_ref, status)
         values ('aeb00000-0000-0000-0000-00000000000a', 'aebc0002-0000-0000-0000-000000000002', 50.00, 'bank', 'adm-cbe-app-1', 'succeeded') $stmt$,
  '23505', null, 'a duplicate provider_ref is rejected by payments_provider_ref_uq -- the adm-<method>-<application_id> idempotency key actually works');

select * from finish();
rollback;
