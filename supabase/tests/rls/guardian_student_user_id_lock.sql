-- ============================================================================
-- Privilege-escalation regression: guardians_write/students_write let a
-- registrar write any column, including user_id -- the column
-- is_guardian_of() and every "s.user_id = auth.uid()" check trusts
-- unconditionally to grant self/guardian read access to grades, attendance,
-- fee_invoices, payments, and library_checkouts. Before
-- 20260805000001_lock_guardian_student_user_id, a registrar could set
-- guardians.user_id / students.user_id to their own auth.uid() and read
-- data (e.g. grades, payments) their role has no direct policy for.
-- ============================================================================
begin;
select plan(6);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '9a000001-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'gsul-registrar@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9a000002-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'gsul-admin@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('9a000000-0000-0000-0000-00000000000a', 'GSUL Tenant', 'gsul-tenant', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('9a000001-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-00000000000a', 'registrar', 'GSUL Registrar', 'gsul-registrar@test.example'),
  ('9a000002-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-00000000000a', 'school_admin', 'GSUL Admin', 'gsul-admin@test.example');

insert into public.academic_years (id, tenant_id, ec_year, label_i18n, starts_on, ends_on) values
  ('9a000003-0000-0000-0000-000000000003', '9a000000-0000-0000-0000-00000000000a', 2018,
   '{"en":"2018","am":"2018","om":"2018"}'::jsonb, '2025-09-01', '2026-06-30');

insert into public.classes (id, tenant_id, academic_year_id, name) values
  ('9a000004-0000-0000-0000-000000000004', '9a000000-0000-0000-0000-00000000000a', '9a000003-0000-0000-0000-000000000003', 'Grade 1');

insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('9a000005-0000-0000-0000-000000000005', '9a000000-0000-0000-0000-00000000000a', '9a000004-0000-0000-0000-000000000004', 'ADM-GSUL-001', 'Test', 'Student', '2015-01-01', 'male');

insert into public.guardians (id, tenant_id, student_id, relationship, phone) values
  ('9a000006-0000-0000-0000-000000000006', '9a000000-0000-0000-0000-00000000000a', '9a000005-0000-0000-0000-000000000005', 'mother', '+251911000099');

set local role authenticated;
set local request.jwt.claim.sub = '9a000001-0000-0000-0000-000000000001';

-- ---------- registrar cannot self-link as guardian ----------
select throws_ok(
  $stmt$ update public.guardians set user_id = '9a000001-0000-0000-0000-000000000001'
         where id = '9a000006-0000-0000-0000-000000000006' $stmt$,
  'P0001',
  'guardian_user_id_immutable_for_role',
  'registrar cannot set guardians.user_id (self-link escalation blocked)');

-- ---------- registrar cannot self-link a student ----------
select throws_ok(
  $stmt$ update public.students set user_id = '9a000001-0000-0000-0000-000000000001'
         where id = '9a000005-0000-0000-0000-000000000005' $stmt$,
  'P0001',
  'student_user_id_immutable_for_role',
  'registrar cannot set students.user_id (self-link escalation blocked)');

-- ---------- registrar can still edit every other guardian/student column ----------
select lives_ok(
  $stmt$ update public.guardians set phone = '+251911000098'
         where id = '9a000006-0000-0000-0000-000000000006' $stmt$,
  'registrar can still edit non-identity guardian columns (phone)');

select lives_ok(
  $stmt$ update public.students set status = 'graduated'
         where id = '9a000005-0000-0000-0000-000000000005' $stmt$,
  'registrar can still edit non-identity student columns (status)');

-- ---------- school_admin can link (legitimate portal-provisioning path) ----------
set local request.jwt.claim.sub = '9a000002-0000-0000-0000-000000000002';

select lives_ok(
  $stmt$ update public.guardians set user_id = '9a000002-0000-0000-0000-000000000002'
         where id = '9a000006-0000-0000-0000-000000000006' $stmt$,
  'school_admin can set guardians.user_id (legitimate provisioning path)');

select lives_ok(
  $stmt$ update public.students set user_id = '9a000002-0000-0000-0000-000000000002'
         where id = '9a000005-0000-0000-0000-000000000005' $stmt$,
  'school_admin can set students.user_id (legitimate provisioning path)');

select * from finish();
rollback;
