-- ============================================================================
-- hr_employee_sensitive / clinic_visit_detail — regression test for the M1
-- re-exposing views (§ security_hardening migration 010, fixed for real in
-- column_level_grants migration 013).
--
-- Both views are intentionally SECURITY DEFINER (security_invoker = false),
-- owned by a dedicated `timhirt_view_owner` role rather than the querying
-- user — flagged by Supabase's linter as such by design. Once migration 013
-- made the column-level REVOKE on employees/clinic_visits real, an
-- invoker-rights view would deny these 🔒 columns to everyone, including the
-- HR/clinic roles the M1 fix exists for. The two RLS policies on
-- `timhirt_view_owner` (hr_sensitive_view_read, clinic_detail_view_read) are
-- now the ENTIRE security boundary for these columns — a bug in either one
-- is a direct cross-tenant or role-escalation leak of TIN/bank/medical data,
-- with no base-table RLS behind it to catch the mistake.
--
-- This test exercises both halves of that boundary: authorized readers must
-- still see the real values (the M1 fix actually working — a regression that
-- made the view always return zero rows would slip past a cross-tenant-only
-- test), and every other actor — wrong tenant, wrong role, or both — must
-- see zero rows through the view.
-- ============================================================================
begin;
select plan(12);

-- ---------- Fixtures ---------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'f1111111-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'school-admin-f@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'f2222222-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'hr-officer-f@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'f3333333-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'teacher-f@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'f4444444-0000-0000-0000-000000000004',
   'authenticated', 'authenticated', 'school-admin-g@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('ffffffff-0000-0000-0000-000000000001', 'Tenant F', 'rls-test-tenant-f', 'active'),
  ('99999999-0000-0000-0000-000000000009', 'Tenant G', 'rls-test-tenant-g', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('f1111111-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 'school_admin', 'Admin F', 'school-admin-f@test.example'),
  ('f2222222-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001', 'hr_officer', 'HR F', 'hr-officer-f@test.example'),
  ('f3333333-0000-0000-0000-000000000003', 'ffffffff-0000-0000-0000-000000000001', 'teacher', 'Teacher F', 'teacher-f@test.example'),
  ('f4444444-0000-0000-0000-000000000004', '99999999-0000-0000-0000-000000000009', 'school_admin', 'Admin G', 'school-admin-g@test.example');

-- Employee in Tenant F, linked to the teacher (self-access clause) and
-- carrying the 🔒 columns the view exists to re-expose.
insert into public.employees (id, tenant_id, user_id, employee_no, employee_type, full_name, hire_date,
  tin_number, pension_no, bank_account) values
  ('f5555555-0000-0000-0000-000000000005', 'ffffffff-0000-0000-0000-000000000001', 'f3333333-0000-0000-0000-000000000003',
   'EMP-F-001', 'teacher', 'Teacher F', '2020-01-01', '1000000001', 'PEN-F-001', '100000001');

-- A second, unrelated Tenant F employee (no user_id link) so the "teacher
-- sees exactly their own row" assertion below is actually meaningful --
-- without this, Tenant F would only ever have one employee row total, and
-- "sees 1 row" would pass whether the self-access clause was scoped
-- correctly or the view was accidentally exposing the whole tenant.
insert into public.employees (id, tenant_id, employee_no, employee_type, full_name, hire_date,
  tin_number, pension_no, bank_account) values
  ('f5555556-0000-0000-0000-000000000006', 'ffffffff-0000-0000-0000-000000000001',
   'EMP-F-002', 'admin_staff', 'Colleague F', '2020-01-01', '1000000003', 'PEN-F-002', '100000003');

-- Employee in Tenant G, for the cross-tenant checks.
insert into public.employees (id, tenant_id, employee_no, employee_type, full_name, hire_date,
  tin_number, pension_no, bank_account) values
  ('99955555-0000-0000-0000-000000000005', '99999999-0000-0000-0000-000000000009',
   'EMP-G-001', 'teacher', 'Teacher G', '2020-01-01', '2000000002', 'PEN-G-001', '200000002');

-- Clinic visits, one per tenant (needs a student -> class -> academic year).
insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('f6666666-0000-0000-0000-000000000006', 'ffffffff-0000-0000-0000-000000000001', 2018, '2025-09-11', '2026-09-10', 'active'),
  ('99966666-0000-0000-0000-000000000006', '99999999-0000-0000-0000-000000000009', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('f7777777-0000-0000-0000-000000000007', 'ffffffff-0000-0000-0000-000000000001', 'f6666666-0000-0000-0000-000000000006', 'Grade 3', 'A'),
  ('99977777-0000-0000-0000-000000000007', '99999999-0000-0000-0000-000000000009', '99966666-0000-0000-0000-000000000006', 'Grade 3', 'A');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('f8888888-0000-0000-0000-000000000008', 'ffffffff-0000-0000-0000-000000000001', 'f7777777-0000-0000-0000-000000000007', 'ADM-F-001', 'Sara', 'Tadesse', '2016-01-01', 'female'),
  ('99988888-0000-0000-0000-000000000008', '99999999-0000-0000-0000-000000000009', '99977777-0000-0000-0000-000000000007', 'ADM-G-001', 'Dawit', 'Fikru', '2016-01-01', 'male');
insert into public.clinic_visits (id, tenant_id, student_id, visit_date, complaint, treatment, medication, recorded_by) values
  ('f9999999-0000-0000-0000-000000000009', 'ffffffff-0000-0000-0000-000000000001', 'f8888888-0000-0000-0000-000000000008', now(), 'Headache', 'Rest', 'Paracetamol', 'f1111111-0000-0000-0000-000000000001'),
  ('99999998-0000-0000-0000-000000000009', '99999999-0000-0000-0000-000000000009', '99988888-0000-0000-0000-000000000008', now(), 'Fever', 'Fluids', 'Ibuprofen', 'f4444444-0000-0000-0000-000000000004');

-- ---------- Act as Tenant F's school_admin (authorized for both views) ------
set local role authenticated;
set local request.jwt.claim.sub = 'f1111111-0000-0000-0000-000000000001';

-- Positive case first: the M1 fix must actually work for an authorized
-- reader in the same tenant. A regression that made the view always return
-- zero rows would otherwise slip straight past a cross-tenant-only test.
select is(
  (select tin_number from public.hr_employee_sensitive where id = 'f5555555-0000-0000-0000-000000000005'),
  '1000000001', 'school_admin sees the real tin_number for their own tenant''s employee');

select is(
  (select complaint from public.clinic_visit_detail where id = 'f9999999-0000-0000-0000-000000000009'),
  'Headache', 'school_admin sees the real clinic complaint for their own tenant''s visit');

-- Cross-tenant: the SECURITY DEFINER view must not leak past tenant scoping.
select is(
  (select count(*) from public.hr_employee_sensitive where tenant_id = '99999999-0000-0000-0000-000000000009'),
  0::bigint, 'Tenant F school_admin sees 0 Tenant G rows via hr_employee_sensitive');

select is(
  (select count(*) from public.clinic_visit_detail where tenant_id = '99999999-0000-0000-0000-000000000009'),
  0::bigint, 'Tenant F school_admin sees 0 Tenant G rows via clinic_visit_detail');

-- ---------- Act as Tenant F's hr_officer -------------------------------------
set local request.jwt.claim.sub = 'f2222222-0000-0000-0000-000000000002';

select is(
  (select tin_number from public.hr_employee_sensitive where id = 'f5555555-0000-0000-0000-000000000005'),
  '1000000001', 'hr_officer sees the real tin_number for their own tenant''s employee');

-- Per-view role scoping: hr_officer is on the allow-list for
-- hr_employee_sensitive but NOT clinic_visit_detail (school_admin only) — a
-- shared "any staff role" check here would over-expose clinic data to HR.
select is(
  (select count(*) from public.clinic_visit_detail),
  0::bigint, 'hr_officer sees 0 rows via clinic_visit_detail (school_admin-only view)');

-- ---------- Act as Tenant F's teacher (self-access only) --------------------
set local request.jwt.claim.sub = 'f3333333-0000-0000-0000-000000000003';

-- Self-access clause: an employee may see their OWN sensitive row even
-- though their role (teacher) isn't on the staff allow-list.
select is(
  (select tin_number from public.hr_employee_sensitive where id = 'f5555555-0000-0000-0000-000000000005'),
  '1000000001', 'Employee sees their own tin_number via the self-access clause');

select is(
  (select count(*) from public.hr_employee_sensitive),
  1::bigint, 'Teacher sees exactly their own row via hr_employee_sensitive, not the whole tenant');

-- No clinic access at all for a teacher, own tenant's visit or not.
select is(
  (select count(*) from public.clinic_visit_detail),
  0::bigint, 'Teacher sees 0 rows via clinic_visit_detail');

-- ---------- Act as Tenant G's school_admin (mirror-direction cross-tenant) --
set local request.jwt.claim.sub = 'f4444444-0000-0000-0000-000000000004';

select is(
  (select count(*) from public.hr_employee_sensitive where tenant_id = 'ffffffff-0000-0000-0000-000000000001'),
  0::bigint, 'Tenant G school_admin sees 0 Tenant F rows via hr_employee_sensitive');

select is(
  (select count(*) from public.clinic_visit_detail where tenant_id = 'ffffffff-0000-0000-0000-000000000001'),
  0::bigint, 'Tenant G school_admin sees 0 Tenant F rows via clinic_visit_detail');

select is(
  (select complaint from public.clinic_visit_detail where id = '99999998-0000-0000-0000-000000000009'),
  'Fever', 'Tenant G school_admin still sees their own tenant''s real clinic data');

select * from finish();
rollback;
