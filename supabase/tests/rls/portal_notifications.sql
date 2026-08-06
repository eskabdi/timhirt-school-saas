-- ============================================================================
-- portal_notifications (20260807000001): in-app billing alerts. Deliberately
-- NO school_admin bypass on select -- a notification is personal to its
-- recipient, same model as the `messages` table. Proves: recipient-only
-- read (not even staff in the same tenant), cross-tenant isolation, the
-- recipient can mark their own read but a non-recipient cannot, insert is
-- service_role only, and the replay-guard unique index actually rejects a
-- duplicate event.
-- ============================================================================
begin;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'cda00001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'pn-admin@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'cda00002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'pn-parent1@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'cda00003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'pn-parent2@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'cdb00001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'pn-admin-b@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('cda00000-0000-0000-0000-00000000000a', 'PN Tenant A', 'pn-tenant-a', 'active'),
  ('cdb00000-0000-0000-0000-00000000000b', 'PN Tenant B', 'pn-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('cda00001-0000-0000-0000-000000000001', 'cda00000-0000-0000-0000-00000000000a', 'school_admin', 'PN Admin',    'pn-admin@test.example'),
  ('cda00002-0000-0000-0000-000000000002', 'cda00000-0000-0000-0000-00000000000a', 'parent',       'PN Parent 1', 'pn-parent1@test.example'),
  ('cda00003-0000-0000-0000-000000000003', 'cda00000-0000-0000-0000-00000000000a', 'parent',       'PN Parent 2', 'pn-parent2@test.example'),
  ('cdb00001-0000-0000-0000-000000000001', 'cdb00000-0000-0000-0000-00000000000b', 'school_admin', 'PN Admin B',  'pn-admin-b@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('cda10000-0000-0000-0000-000000000001', 'cda00000-0000-0000-0000-00000000000a', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('cda20000-0000-0000-0000-000000000001', 'cda00000-0000-0000-0000-00000000000a', 'cda10000-0000-0000-0000-000000000001', 'Grade 1', 'A');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('cda30000-0000-0000-0000-000000000001', 'cda00000-0000-0000-0000-00000000000a', 'cda20000-0000-0000-0000-000000000001', 'ADM-PN-001', 'Stu', 'One', '2015-01-01', 'male');
insert into public.fee_structures (id, tenant_id, name_i18n, amount, billing_cycle) values
  ('cda40000-0000-0000-0000-000000000001', 'cda00000-0000-0000-0000-00000000000a', '{"en":"Tuition"}', 500, 'monthly');
insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, amount_paid, due_date, status) values
  ('cda50000-0000-0000-0000-000000000001', 'cda00000-0000-0000-0000-00000000000a', 'cda30000-0000-0000-0000-000000000001', 'cda40000-0000-0000-0000-000000000001', 500.00, 0, '2026-08-01', 'pending');

insert into public.portal_notifications (id, tenant_id, recipient_id, student_id, kind, invoice_id, amount) values
  ('cda60000-0000-0000-0000-000000000001', 'cda00000-0000-0000-0000-00000000000a', 'cda00002-0000-0000-0000-000000000002', 'cda30000-0000-0000-0000-000000000001', 'invoice_issued', 'cda50000-0000-0000-0000-000000000001', 500.00);

-- ---------- replay guard -------------------------------------------------------
select throws_ok(
  $stmt$ insert into public.portal_notifications (tenant_id, recipient_id, student_id, kind, invoice_id, amount)
         values ('cda00000-0000-0000-0000-00000000000a', 'cda00002-0000-0000-0000-000000000002', 'cda30000-0000-0000-0000-000000000001', 'invoice_issued', 'cda50000-0000-0000-0000-000000000001', 500.00) $stmt$,
  '23505', null, 'duplicate (recipient, kind, invoice_id) event rejected by the replay guard');

-- ---------- RLS: select --------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'cda00002-0000-0000-0000-000000000002'; -- the recipient

select is(
  (select count(*)::int from public.portal_notifications where id = 'cda60000-0000-0000-0000-000000000001'),
  1, 'the recipient sees their own notification');

set local request.jwt.claim.sub = 'cda00003-0000-0000-0000-000000000003'; -- a different family, same tenant

select is(
  (select count(*)::int from public.portal_notifications where id = 'cda60000-0000-0000-0000-000000000001'),
  0, 'a different family in the same tenant sees 0');

set local request.jwt.claim.sub = 'cdb00001-0000-0000-0000-000000000001'; -- cross-tenant

select is(
  (select count(*)::int from public.portal_notifications where id = 'cda60000-0000-0000-0000-000000000001'),
  0, 'cross-tenant user sees 0');

set local request.jwt.claim.sub = 'cda00001-0000-0000-0000-000000000001'; -- school_admin, same tenant

select is(
  (select count(*)::int from public.portal_notifications where id = 'cda60000-0000-0000-0000-000000000001'),
  0, 'school_admin in the same tenant sees 0 -- deliberate, no staff bypass on portal_notifications');

-- ---------- RLS: update (mark read) --------------------------------------------
set local request.jwt.claim.sub = 'cda00003-0000-0000-0000-000000000003'; -- non-recipient

select lives_ok(
  $stmt$ update public.portal_notifications set read_at = now() where id = 'cda60000-0000-0000-0000-000000000001' $stmt$,
  'a non-recipient''s update runs without error (RLS filters, does not raise)');

select is(
  (select read_at from public.portal_notifications where id = 'cda60000-0000-0000-0000-000000000001'),
  null, 'read_at is still null -- the non-recipient''s update matched zero rows');

set local request.jwt.claim.sub = 'cda00002-0000-0000-0000-000000000002'; -- the recipient

select lives_ok(
  $stmt$ update public.portal_notifications set read_at = now() where id = 'cda60000-0000-0000-0000-000000000001' $stmt$,
  'the recipient can mark their own notification read');

select isnt(
  (select read_at from public.portal_notifications where id = 'cda60000-0000-0000-0000-000000000001'),
  null, 'read_at is now set for the recipient''s own update');

-- ---------- RLS: insert (service_role only) -------------------------------
select throws_ok(
  $stmt$ insert into public.portal_notifications (tenant_id, recipient_id, student_id, kind, invoice_id, amount)
         values ('cda00000-0000-0000-0000-00000000000a', 'cda00002-0000-0000-0000-000000000002', 'cda30000-0000-0000-0000-000000000001', 'payment_received', 'cda50000-0000-0000-0000-000000000001', 100.00) $stmt$,
  '42501', null, 'an authenticated recipient cannot insert their own portal_notifications row (service_role only)');

select * from finish();
rollback;
