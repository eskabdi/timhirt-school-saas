-- ============================================================================
-- fee_documents (20260807000001): invoice/receipt PDFs, service_role-only
-- writes. Proves: cross-family and cross-tenant isolation on select; no
-- blanket staff read (only school_admin/accountant, not teacher/registrar);
-- an authenticated school_admin cannot insert/update a row (service_role
-- only -- a financial document must not be client-forgeable); the four
-- CHECK/unique constraints actually reject what they claim to; and
-- verify_document() answers correctly for a real vs. bogus code.
-- ============================================================================
begin;
select plan(16);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'fda00001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fd-admin@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'fda00002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'fd-accountant@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'fda00003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'fd-registrar@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'fda00004-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'fd-teacher@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'fda00005-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'fd-parent1@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'fda00006-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'fd-student1@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'fda00007-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'fd-parent2@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'fdb00001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fd-admin-b@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('fda00000-0000-0000-0000-00000000000a', 'FD Tenant A', 'fd-tenant-a', 'active'),
  ('fdb00000-0000-0000-0000-00000000000b', 'FD Tenant B', 'fd-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('fda00001-0000-0000-0000-000000000001', 'fda00000-0000-0000-0000-00000000000a', 'school_admin', 'FD Admin',      'fd-admin@test.example'),
  ('fda00002-0000-0000-0000-000000000002', 'fda00000-0000-0000-0000-00000000000a', 'accountant',   'FD Accountant', 'fd-accountant@test.example'),
  ('fda00003-0000-0000-0000-000000000003', 'fda00000-0000-0000-0000-00000000000a', 'registrar',    'FD Registrar',  'fd-registrar@test.example'),
  ('fda00004-0000-0000-0000-000000000004', 'fda00000-0000-0000-0000-00000000000a', 'teacher',      'FD Teacher',    'fd-teacher@test.example'),
  ('fda00005-0000-0000-0000-000000000005', 'fda00000-0000-0000-0000-00000000000a', 'parent',       'FD Parent 1',   'fd-parent1@test.example'),
  ('fda00006-0000-0000-0000-000000000006', 'fda00000-0000-0000-0000-00000000000a', 'student',      'FD Student 1',  'fd-student1@test.example'),
  ('fda00007-0000-0000-0000-000000000007', 'fda00000-0000-0000-0000-00000000000a', 'parent',       'FD Parent 2',   'fd-parent2@test.example'),
  ('fdb00001-0000-0000-0000-000000000001', 'fdb00000-0000-0000-0000-00000000000b', 'school_admin', 'FD Admin B',    'fd-admin-b@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('fda10000-0000-0000-0000-000000000001', 'fda00000-0000-0000-0000-00000000000a', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('fda20000-0000-0000-0000-000000000001', 'fda00000-0000-0000-0000-00000000000a', 'fda10000-0000-0000-0000-000000000001', 'Grade 1', 'A');
insert into public.students (id, tenant_id, class_id, user_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('fda30000-0000-0000-0000-000000000001', 'fda00000-0000-0000-0000-00000000000a', 'fda20000-0000-0000-0000-000000000001', 'fda00006-0000-0000-0000-000000000006', 'ADM-FD-001', 'Stu', 'One', '2015-01-01', 'male'),
  ('fda30000-0000-0000-0000-000000000002', 'fda00000-0000-0000-0000-00000000000a', 'fda20000-0000-0000-0000-000000000001', null, 'ADM-FD-002', 'Stu', 'Two', '2015-01-01', 'male');
insert into public.guardians (id, tenant_id, student_id, user_id, relationship, phone) values
  ('fda40000-0000-0000-0000-000000000001', 'fda00000-0000-0000-0000-00000000000a', 'fda30000-0000-0000-0000-000000000001', 'fda00005-0000-0000-0000-000000000005', 'mother', '+251911000001'),
  ('fda40000-0000-0000-0000-000000000002', 'fda00000-0000-0000-0000-00000000000a', 'fda30000-0000-0000-0000-000000000002', 'fda00007-0000-0000-0000-000000000007', 'mother', '+251911000002');

insert into public.fee_structures (id, tenant_id, name_i18n, amount, billing_cycle) values
  ('fda50000-0000-0000-0000-000000000001', 'fda00000-0000-0000-0000-00000000000a', '{"en":"Tuition"}', 500, 'monthly');
insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, amount_paid, due_date, status) values
  ('fda60000-0000-0000-0000-000000000001', 'fda00000-0000-0000-0000-00000000000a', 'fda30000-0000-0000-0000-000000000001', 'fda50000-0000-0000-0000-000000000001', 500.00, 500.00, '2026-08-01', 'paid');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, provider_ref, status) values
  ('fda70000-0000-0000-0000-000000000001', 'fda00000-0000-0000-0000-00000000000a', 'fda60000-0000-0000-0000-000000000001', 500.00, 'cash', 'fd-pay-1', 'succeeded');

insert into public.fee_documents (id, tenant_id, kind, invoice_id, payment_id, doc_no, verify_code, amount, pdf_path) values
  ('fda80000-0000-0000-0000-000000000001', 'fda00000-0000-0000-0000-00000000000a', 'invoice', 'fda60000-0000-0000-0000-000000000001', null, 'INV-FD-001', repeat('a1', 24), 500.00, 'fda00000-0000-0000-0000-00000000000a/fda60000-0000-0000-0000-000000000001/inv.pdf'),
  ('fda80000-0000-0000-0000-000000000002', 'fda00000-0000-0000-0000-00000000000a', 'receipt', 'fda60000-0000-0000-0000-000000000001', 'fda70000-0000-0000-0000-000000000001', 'RCP-FD-001', repeat('b2', 24), 500.00, 'fda00000-0000-0000-0000-00000000000a/fda60000-0000-0000-0000-000000000001/rcp.pdf');

-- ---------- Constraint probes (as superuser, bypasses RLS) -------------------
select throws_ok(
  $stmt$ insert into public.fee_documents (tenant_id, kind, invoice_id, payment_id, doc_no, verify_code, amount, pdf_path)
         values ('fda00000-0000-0000-0000-00000000000a', 'receipt', 'fda60000-0000-0000-0000-000000000001', 'fda70000-0000-0000-0000-000000000001', 'RCP-FD-DUP', repeat('c3', 24), 500.00, 'x.pdf') $stmt$,
  '23505', null, 'duplicate payment_id for kind=receipt rejected (fee_documents_receipt_uq)');

select throws_ok(
  $stmt$ insert into public.fee_documents (tenant_id, kind, invoice_id, doc_no, verify_code, amount, pdf_path)
         values ('fda00000-0000-0000-0000-00000000000a', 'invoice', 'fda60000-0000-0000-0000-000000000001', 'INV-FD-DUP', repeat('d4', 24), 500.00, 'x.pdf') $stmt$,
  '23505', null, 'duplicate invoice_id for kind=invoice rejected (fee_documents_invoice_uq)');

select throws_ok(
  $stmt$ insert into public.fee_documents (tenant_id, kind, invoice_id, doc_no, verify_code, amount, pdf_path)
         values ('fda00000-0000-0000-0000-00000000000a', 'receipt', 'fda60000-0000-0000-0000-000000000001', 'RCP-FD-NOPAY', repeat('e5', 24), 500.00, 'x.pdf') $stmt$,
  '23514', null, 'receipt with null payment_id rejected (fee_documents_receipt_needs_payment)');

select throws_ok(
  $stmt$ insert into public.fee_documents (tenant_id, kind, invoice_id, doc_no, verify_code, amount, pdf_path)
         values ('fda00000-0000-0000-0000-00000000000a', 'invoice', 'fda60000-0000-0000-0000-000000000001', 'INV-FD-SHORT', 'short', 500.00, 'x.pdf') $stmt$,
  '23514', null, 'verify_code shorter than 24 chars rejected (entropy check)');

-- ---------- verify_document() ------------------------------------------------
select is(
  (select doc_no from public.verify_document(repeat('a1', 24)) limit 1),
  'INV-FD-001', 'verify_document() resolves the invoice doc_no for a real code');

select is(
  (select subject_type from public.verify_document(repeat('b2', 24)) limit 1),
  'receipt', 'verify_document() reports subject_type=receipt for the receipt code');

select is(
  (select count(*)::int from public.verify_document('0000000000000000000000000000000000000000000000')),
  0, 'verify_document() returns zero rows for a bogus code');

-- ---------- RLS: select ------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'fda00007-0000-0000-0000-000000000007'; -- parent2, different family

select is(
  (select count(*)::int from public.fee_documents where invoice_id = 'fda60000-0000-0000-0000-000000000001'),
  0, 'a different family in the same tenant sees 0 of this invoice''s documents');

set local request.jwt.claim.sub = 'fdb00001-0000-0000-0000-000000000001'; -- tenant B school_admin

select is(
  (select count(*)::int from public.fee_documents where invoice_id = 'fda60000-0000-0000-0000-000000000001'),
  0, 'cross-tenant school_admin sees 0');

set local request.jwt.claim.sub = 'fda00006-0000-0000-0000-000000000006'; -- student1, own record

select is(
  (select count(*)::int from public.fee_documents where invoice_id = 'fda60000-0000-0000-0000-000000000001'),
  2, 'the student on the invoice sees both documents via s.user_id = auth.uid()');

set local request.jwt.claim.sub = 'fda00004-0000-0000-0000-000000000004'; -- teacher

select is(
  (select count(*)::int from public.fee_documents where invoice_id = 'fda60000-0000-0000-0000-000000000001'),
  0, 'a teacher has no blanket read on fee_documents');

set local request.jwt.claim.sub = 'fda00003-0000-0000-0000-000000000003'; -- registrar

select is(
  (select count(*)::int from public.fee_documents where invoice_id = 'fda60000-0000-0000-0000-000000000001'),
  0, 'a registrar has no blanket read on fee_documents (only school_admin/accountant)');

set local request.jwt.claim.sub = 'fda00002-0000-0000-0000-000000000002'; -- accountant

select is(
  (select count(*)::int from public.fee_documents where invoice_id = 'fda60000-0000-0000-0000-000000000001'),
  2, 'accountant (staff bypass) sees both documents');

-- ---------- RLS: insert/update (service_role only) ---------------------------
set local request.jwt.claim.sub = 'fda00001-0000-0000-0000-000000000001'; -- school_admin

select throws_ok(
  $stmt$ insert into public.fee_documents (tenant_id, kind, invoice_id, doc_no, verify_code, amount, pdf_path)
         values ('fda00000-0000-0000-0000-00000000000a', 'invoice', 'fda60000-0000-0000-0000-000000000001', 'INV-FD-CLIENT', repeat('f6', 24), 500.00, 'x.pdf') $stmt$,
  '42501', null, 'an authenticated school_admin cannot insert a fee_documents row (service_role only)');

-- No update policy at all -> RLS filters the row rather than raising: the
-- UPDATE "succeeds" but matches zero rows. lives_ok proves the statement
-- runs without error; the following assertion proves nothing changed.
select lives_ok(
  $stmt$ update public.fee_documents set doc_no = 'HACKED' where id = 'fda80000-0000-0000-0000-000000000001' $stmt$,
  'update statement runs without error (RLS silently filters, does not raise)');

select is(
  (select doc_no from public.fee_documents where id = 'fda80000-0000-0000-0000-000000000001'),
  'INV-FD-001', 'doc_no is unchanged -- the school_admin update matched zero rows');

select * from finish();
rollback;
