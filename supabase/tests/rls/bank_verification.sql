-- ============================================================================
-- bank_verification_domains + bank_payment_verifications (20260808000001).
-- Proves: only super_admin can write the allow-list, any authenticated role
-- can read it (needed for the public submit-admission GET's
-- bankVerifiableMethods derivation, which runs with service_role, but the
-- staff-facing SecuritySettingsPage list read needs this too);
-- unique(payment_method, hostname) is enforced; staff
-- (school_admin/registrar/accountant) can read tenant verification rows and
-- a different tenant's staff cannot; a guardian sees only verification rows
-- tied to their own child's payment; authenticated insert is rejected
-- (service_role only); and the one-target CHECK rejects rows with both or
-- neither FK set.
-- ============================================================================
begin;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'bce00001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'bv-super@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'bce00002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bv-admin@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'bce00003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'bv-registrar@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'bce00004-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'bv-parent@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'bcf00001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'bv-admin-b@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('bce00000-0000-0000-0000-00000000000a', 'BV Tenant A', 'bv-tenant-a', 'active'),
  ('bcf00000-0000-0000-0000-00000000000b', 'BV Tenant B', 'bv-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('bce00001-0000-0000-0000-000000000001', 'bce00000-0000-0000-0000-00000000000a', 'super_admin', 'BV Super',     'bv-super@test.example'),
  ('bce00002-0000-0000-0000-000000000002', 'bce00000-0000-0000-0000-00000000000a', 'school_admin', 'BV Admin',    'bv-admin@test.example'),
  ('bce00003-0000-0000-0000-000000000003', 'bce00000-0000-0000-0000-00000000000a', 'registrar',    'BV Registrar','bv-registrar@test.example'),
  ('bce00004-0000-0000-0000-000000000004', 'bce00000-0000-0000-0000-00000000000a', 'parent',       'BV Parent',   'bv-parent@test.example'),
  ('bcf00001-0000-0000-0000-000000000001', 'bcf00000-0000-0000-0000-00000000000b', 'school_admin', 'BV Admin B',  'bv-admin-b@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('bce10000-0000-0000-0000-000000000001', 'bce00000-0000-0000-0000-00000000000a', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('bce20000-0000-0000-0000-000000000001', 'bce00000-0000-0000-0000-00000000000a', 'bce10000-0000-0000-0000-000000000001', 'Grade 1', 'A');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('bce30000-0000-0000-0000-000000000001', 'bce00000-0000-0000-0000-00000000000a', 'bce20000-0000-0000-0000-000000000001', 'ADM-BV-001', 'Stu', 'One', '2015-01-01', 'male');
insert into public.guardians (id, tenant_id, student_id, user_id, relationship, phone) values
  ('bce40000-0000-0000-0000-000000000001', 'bce00000-0000-0000-0000-00000000000a', 'bce30000-0000-0000-0000-000000000001', 'bce00004-0000-0000-0000-000000000004', 'mother', '+251911000003');
insert into public.fee_structures (id, tenant_id, name_i18n, amount, billing_cycle) values
  ('bce50000-0000-0000-0000-000000000001', 'bce00000-0000-0000-0000-00000000000a', '{"en":"Tuition"}', 500, 'monthly');
insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, amount_paid, due_date, status) values
  ('bce60000-0000-0000-0000-000000000001', 'bce00000-0000-0000-0000-00000000000a', 'bce30000-0000-0000-0000-000000000001', 'bce50000-0000-0000-0000-000000000001', 500.00, 500.00, '2026-08-01', 'paid');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, provider_ref, status) values
  ('bce70000-0000-0000-0000-000000000001', 'bce00000-0000-0000-0000-00000000000a', 'bce60000-0000-0000-0000-000000000001', 500.00, 'bank', 'bv-pay-1', 'succeeded');

insert into public.bank_verification_domains (id, payment_method, hostname, label) values
  ('bce80000-0000-0000-0000-000000000001', 'cbe', 'secure.cbe.example', 'CBE Test');

insert into public.bank_payment_verifications (id, tenant_id, payment_id, payment_method, verification_url, status) values
  ('bce90000-0000-0000-0000-000000000001', 'bce00000-0000-0000-0000-00000000000a', 'bce70000-0000-0000-0000-000000000001', 'cbe', 'https://secure.cbe.example/verify/abc', 'verified');

-- ---------- one-target CHECK --------------------------------------------------
select throws_ok(
  $stmt$ insert into public.bank_payment_verifications (tenant_id, payment_method, verification_url)
         values ('bce00000-0000-0000-0000-00000000000a', 'cbe', 'https://secure.cbe.example/verify/none') $stmt$,
  '23514', null, 'a row with neither admission_application_id nor payment_id set is rejected (one-target CHECK)');

select throws_ok(
  $stmt$ insert into public.bank_payment_verifications (tenant_id, admission_application_id, payment_id, payment_method, verification_url)
         values ('bce00000-0000-0000-0000-00000000000a', gen_random_uuid(), 'bce70000-0000-0000-0000-000000000001', 'cbe', 'https://secure.cbe.example/verify/both') $stmt$,
  '23514', null, 'a row with BOTH admission_application_id and payment_id set is rejected (one-target CHECK)');

select throws_ok(
  $stmt$ insert into public.bank_verification_domains (payment_method, hostname) values ('cbe', 'secure.cbe.example') $stmt$,
  '23505', null, 'a duplicate (payment_method, hostname) is rejected');

-- ---------- RLS: bank_verification_domains ------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'bce00003-0000-0000-0000-000000000003'; -- registrar (not super_admin)

select is(
  (select count(*)::int from public.bank_verification_domains),
  1, 'any authenticated role (here: registrar) can read the domain allow-list');

select throws_ok(
  $stmt$ insert into public.bank_verification_domains (payment_method, hostname) values ('telebirr', 'evil.example') $stmt$,
  '42501', null, 'a non-super_admin cannot write to bank_verification_domains');

set local request.jwt.claim.sub = 'bce00001-0000-0000-0000-000000000001'; -- super_admin

select lives_ok(
  $stmt$ insert into public.bank_verification_domains (payment_method, hostname) values ('telebirr', 'secure.telebirr.example') $stmt$,
  'super_admin can write to bank_verification_domains');

-- ---------- RLS: bank_payment_verifications select ----------------------------
set local request.jwt.claim.sub = 'bce00002-0000-0000-0000-000000000002'; -- school_admin, same tenant

select is(
  (select count(*)::int from public.bank_payment_verifications where id = 'bce90000-0000-0000-0000-000000000001'),
  1, 'school_admin (staff) in the same tenant can read the verification row');

set local request.jwt.claim.sub = 'bcf00001-0000-0000-0000-000000000001'; -- school_admin, DIFFERENT tenant

select is(
  (select count(*)::int from public.bank_payment_verifications where id = 'bce90000-0000-0000-0000-000000000001'),
  0, 'staff in a different tenant sees 0');

set local request.jwt.claim.sub = 'bce00004-0000-0000-0000-000000000004'; -- guardian of the student on this payment's invoice

select is(
  (select count(*)::int from public.bank_payment_verifications where id = 'bce90000-0000-0000-0000-000000000001'),
  1, 'a guardian of the student on this payment''s invoice can see the verification row');

-- ---------- RLS: insert (service_role only) -----------------------------------
set local request.jwt.claim.sub = 'bce00002-0000-0000-0000-000000000002'; -- school_admin

select throws_ok(
  $stmt$ insert into public.bank_payment_verifications (tenant_id, payment_id, payment_method, verification_url)
         values ('bce00000-0000-0000-0000-00000000000a', 'bce70000-0000-0000-0000-000000000001', 'cbe', 'https://secure.cbe.example/verify/client') $stmt$,
  '42501', null, 'an authenticated school_admin cannot insert a bank_payment_verifications row (service_role only)');

select is(
  (select count(*)::int from public.bank_verification_domains),
  2, 'both domains (super_admin-added) are present -- sanity check the writes actually landed');

select * from finish();
rollback;
