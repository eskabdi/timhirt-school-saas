-- ============================================================================
-- Invoice consolidation (20260820000001). Proves the part no other suite
-- exercises: several fee_invoices rows sharing ONE invoice_headers row, and
-- a single payment against that header correctly allocating across all of
-- its unpaid line items (oldest first) rather than crediting just one.
-- Covers both settlement paths -- apply_payment_to_invoice (manual cash/
-- bank) and settle_gateway_payment (gateway webhook) -- plus invoice_summary
-- aggregation and invoice_headers RLS.
-- ============================================================================
begin;
select plan(20);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'ec000001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ic-admin@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ec000002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ic-accountant@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ec000003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'ic-guardian@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ec000004-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'ic-other-guardian@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('ec000000-0000-0000-0000-00000000000a', 'IC Tenant', 'ic-tenant', 'active', 'premium');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('ec000001-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-00000000000a', 'school_admin', 'IC Admin',      'ic-admin@test.example'),
  ('ec000002-0000-0000-0000-000000000002', 'ec000000-0000-0000-0000-00000000000a', 'accountant',   'IC Accountant', 'ic-accountant@test.example'),
  ('ec000003-0000-0000-0000-000000000003', 'ec000000-0000-0000-0000-00000000000a', 'parent',       'IC Guardian',   'ic-guardian@test.example'),
  ('ec000004-0000-0000-0000-000000000004', 'ec000000-0000-0000-0000-00000000000a', 'parent',       'IC Other Guardian', 'ic-other-guardian@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('ec010000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-00000000000a', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('ec020000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-00000000000a', 'ec010000-0000-0000-0000-000000000001', 'Grade 1', 'A');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('ec030000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-00000000000a', 'ec020000-0000-0000-0000-000000000001', 'ADM-IC-001', 'Stu', 'One', '2015-01-01', 'male'),
  ('ec030000-0000-0000-0000-000000000002', 'ec000000-0000-0000-0000-00000000000a', 'ec020000-0000-0000-0000-000000000001', 'ADM-IC-002', 'Stu', 'Two', '2015-01-01', 'female');
insert into public.guardians (id, tenant_id, student_id, user_id, relationship) values
  ('ec035000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-00000000000a', 'ec030000-0000-0000-0000-000000000001', 'ec000003-0000-0000-0000-000000000003', 'mother');

insert into public.fee_structures (id, tenant_id, name_i18n, amount, billing_cycle) values
  ('ec040000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-00000000000a', '{"en":"Tuition"}', 1500, 'term'),
  ('ec040000-0000-0000-0000-000000000002', 'ec000000-0000-0000-0000-00000000000a', '{"en":"Library"}', 300, 'term');

-- ---------- Student 1: two fee items generated the same day share one header ----
insert into public.invoice_headers (id, tenant_id, student_id, due_date) values
  ('ec050000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-00000000000a', 'ec030000-0000-0000-0000-000000000001', '2026-08-01');
insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, amount_paid, due_date, status, invoice_header_id, created_at) values
  ('ec060000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-00000000000a', 'ec030000-0000-0000-0000-000000000001', 'ec040000-0000-0000-0000-000000000001', 1500.00, 0, '2026-08-01', 'pending', 'ec050000-0000-0000-0000-000000000001', '2026-08-01T09:00:00Z'),
  ('ec060000-0000-0000-0000-000000000002', 'ec000000-0000-0000-0000-00000000000a', 'ec030000-0000-0000-0000-000000000001', 'ec040000-0000-0000-0000-000000000002', 300.00,  0, '2026-08-01', 'pending', 'ec050000-0000-0000-0000-000000000001', '2026-08-01T09:05:00Z');

-- ---------- Student 2: single fee item, its own header (control) ----------------
insert into public.invoice_headers (id, tenant_id, student_id, due_date) values
  ('ec050000-0000-0000-0000-000000000002', 'ec000000-0000-0000-0000-00000000000a', 'ec030000-0000-0000-0000-000000000002', '2026-08-01');
insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, amount_paid, due_date, status, invoice_header_id) values
  ('ec060000-0000-0000-0000-000000000003', 'ec000000-0000-0000-0000-00000000000a', 'ec030000-0000-0000-0000-000000000002', 'ec040000-0000-0000-0000-000000000001', 1800.00, 0, '2026-08-01', 'pending', 'ec050000-0000-0000-0000-000000000002');

-- ---------- (1) invoice_summary aggregates a multi-line header correctly -------
select is(
  (select amount_due from public.invoice_summary where id = 'ec050000-0000-0000-0000-000000000001'),
  1800.00::numeric, 'invoice_summary sums amount_due across both line items (1500 + 300)');

select is(
  (select line_count::int from public.invoice_summary where id = 'ec050000-0000-0000-0000-000000000001'),
  2, 'invoice_summary reports 2 line items for the consolidated header');

select is(
  (select status::text from public.invoice_summary where id = 'ec050000-0000-0000-0000-000000000001'),
  'pending', 'invoice_summary status is pending before any payment');

-- ---------- (2) a manual payment allocates across lines, oldest first ----------
set local role authenticated;
set local request.jwt.claim.sub = 'ec000002-0000-0000-0000-000000000002'; -- accountant

select lives_ok(
  $stmt$ insert into public.payments (tenant_id, invoice_id, amount, provider, status)
         values ('ec000000-0000-0000-0000-00000000000a', 'ec050000-0000-0000-0000-000000000001', 1200.00, 'cash', 'succeeded') $stmt$,
  'a 1200 cash payment against the consolidated header succeeds');

select is(
  (select amount_paid from public.fee_invoices where id = 'ec060000-0000-0000-0000-000000000001'),
  1200.00::numeric, 'the OLDER line item (Tuition) absorbs the payment first');

select is(
  (select status::text from public.fee_invoices where id = 'ec060000-0000-0000-0000-000000000001'),
  'partial', 'Tuition is partial at 1200/1500');

select is(
  (select amount_paid from public.fee_invoices where id = 'ec060000-0000-0000-0000-000000000002'),
  0.00::numeric, 'the YOUNGER line item (Library) is untouched while Tuition still owes money');

select is(
  (select status::text from public.invoice_summary where id = 'ec050000-0000-0000-0000-000000000001'),
  'partial', 'invoice_summary status is partial once any money has landed');

-- A second payment finishes Tuition (300 more) and spills into Library (300).
select lives_ok(
  $stmt$ insert into public.payments (tenant_id, invoice_id, amount, provider, status)
         values ('ec000000-0000-0000-0000-00000000000a', 'ec050000-0000-0000-0000-000000000001', 600.00, 'cash', 'succeeded') $stmt$,
  'a second 600 cash payment covers the rest of Tuition and all of Library');

select is(
  (select status::text from public.fee_invoices where id = 'ec060000-0000-0000-0000-000000000001'),
  'paid', 'Tuition is now fully paid');

select is(
  (select amount_paid from public.fee_invoices where id = 'ec060000-0000-0000-0000-000000000002'),
  300.00::numeric, 'the spillover (600 - 300 owed on Tuition) fully pays Library');

select is(
  (select status::text from public.fee_invoices where id = 'ec060000-0000-0000-0000-000000000002'),
  'paid', 'Library is now fully paid too');

select is(
  (select status::text from public.invoice_summary where id = 'ec050000-0000-0000-0000-000000000001'),
  'paid', 'invoice_summary status is paid only once every line item is paid');

-- ---------- (3) settle_gateway_payment allocates across lines too --------------
-- Reuses student 1's shape on a fresh header so the webhook path is proven
-- independently of the manual-payment path above. Fixture rows are inserted
-- as postgres (bypassing RLS), same as every other suite's setup -- back out
-- of the accountant role section (2) switched into above.
set local role postgres;
reset request.jwt.claim.sub;

insert into public.invoice_headers (id, tenant_id, student_id, due_date) values
  ('ec050000-0000-0000-0000-000000000003', 'ec000000-0000-0000-0000-00000000000a', 'ec030000-0000-0000-0000-000000000001', '2026-09-01');
insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, amount_paid, due_date, status, invoice_header_id, created_at) values
  ('ec060000-0000-0000-0000-000000000004', 'ec000000-0000-0000-0000-00000000000a', 'ec030000-0000-0000-0000-000000000001', 'ec040000-0000-0000-0000-000000000001', 1500.00, 0, '2026-09-01', 'pending', 'ec050000-0000-0000-0000-000000000003', '2026-09-01T09:00:00Z'),
  ('ec060000-0000-0000-0000-000000000005', 'ec000000-0000-0000-0000-00000000000a', 'ec030000-0000-0000-0000-000000000001', 'ec040000-0000-0000-0000-000000000002', 300.00,  0, '2026-09-01', 'pending', 'ec050000-0000-0000-0000-000000000003', '2026-09-01T09:05:00Z');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, provider_ref, status) values
  ('ec070000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-00000000000a', 'ec050000-0000-0000-0000-000000000003', 1800.00, 'telebirr', 'ic-tb-ref-1', 'pending');

select is(
  public.settle_gateway_payment('ic-tb-ref-1', 'telebirr', 1800.00),
  'ok', 'a single telebirr settlement covering the full header total returns ok');

select is(
  (select status::text from public.fee_invoices where id = 'ec060000-0000-0000-0000-000000000004'),
  'paid', 'the gateway payment pays off Tuition');

select is(
  (select status::text from public.fee_invoices where id = 'ec060000-0000-0000-0000-000000000005'),
  'paid', 'the SAME gateway payment also pays off Library -- one transaction, two line items');

-- ---------- (4) the allocator never over-credits a single line item ------------
insert into public.invoice_headers (id, tenant_id, student_id, due_date) values
  ('ec050000-0000-0000-0000-000000000004', 'ec000000-0000-0000-0000-00000000000a', 'ec030000-0000-0000-0000-000000000002', '2026-10-01');
insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, amount_paid, due_date, status, invoice_header_id) values
  ('ec060000-0000-0000-0000-000000000006', 'ec000000-0000-0000-0000-00000000000a', 'ec030000-0000-0000-0000-000000000002', 'ec040000-0000-0000-0000-000000000002', 300.00, 0, '2026-10-01', 'pending', 'ec050000-0000-0000-0000-000000000004');
insert into public.payments (tenant_id, invoice_id, amount, provider, status) values
  ('ec000000-0000-0000-0000-00000000000a', 'ec050000-0000-0000-0000-000000000004', 700.00, 'cash', 'succeeded');

select is(
  (select amount_paid from public.fee_invoices where id = 'ec060000-0000-0000-0000-000000000006'),
  300.00::numeric, 'a 700 payment against a single 300-due line item credits only the 300 owed, never more');

-- ---------- (5) invoice_headers RLS --------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'ec000003-0000-0000-0000-000000000003'; -- guardian of student 1

select is(
  (select count(*)::int from public.invoice_headers where id = 'ec050000-0000-0000-0000-000000000001'),
  1, 'a guardian can see their own child''s consolidated header');

set local request.jwt.claim.sub = 'ec000004-0000-0000-0000-000000000004'; -- unrelated guardian

select is(
  (select count(*)::int from public.invoice_headers where id = 'ec050000-0000-0000-0000-000000000001'),
  0, 'an unrelated guardian sees 0 of another family''s header');

select throws_ok(
  $stmt$ insert into public.invoice_headers (tenant_id, student_id, due_date)
         values ('ec000000-0000-0000-0000-00000000000a', 'ec030000-0000-0000-0000-000000000001', '2026-11-01') $stmt$,
  '42501', null, 'no authenticated role can insert invoice_headers directly -- service_role only');

select * from finish();
rollback;
