-- ============================================================================
-- RLS cross-tenant matrix — regression test for the review's Critical/High
-- findings C1 and the general "tenant isolation" review area. As Tenant-A's
-- school_admin, every query against Tenant-B's sensitive tables (students,
-- payslips, fee_invoices, employees) — including via embedded relations —
-- must return zero rows. A direct attempt to flip tenant_id via self-update
-- must fail (C-1 regression).
-- ============================================================================
begin;
select plan(7);

-- ---------- Fixtures ---------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'admin-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'admin-b@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Tenant A', 'rls-test-tenant-a', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Tenant B', 'rls-test-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'school_admin', 'Admin A', 'admin-a@test.example'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000002', 'school_admin', 'Admin B', 'admin-b@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('aaaa1111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 2018, '2025-09-11', '2026-09-10', 'active'),
  ('bbbb1111-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 2018, '2025-09-11', '2026-09-10', 'active');

insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('aaaa2222-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa1111-0000-0000-0000-000000000001', 'Grade 5', 'A'),
  ('bbbb2222-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'bbbb1111-0000-0000-0000-000000000002', 'Grade 5', 'A');

insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('aaaa3333-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa2222-0000-0000-0000-000000000001', 'ADM-A-001', 'Abebe', 'Bekele', '2015-01-01', 'male'),
  ('bbbb3333-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'bbbb2222-0000-0000-0000-000000000002', 'ADM-B-001', 'Chaltu', 'Girma', '2015-01-01', 'female');

insert into public.employees (id, tenant_id, employee_no, employee_type, full_name, hire_date) values
  ('aaaa4444-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'EMP-A-001', 'teacher', 'Kebede Alemu', '2020-01-01'),
  ('bbbb4444-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'EMP-B-001', 'teacher', 'Marta Tesfaye', '2020-01-01');

insert into public.fee_structures (id, tenant_id, name_i18n, amount, billing_cycle) values
  ('aaaa5555-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '{"en":"Tuition"}', 1000, 'monthly'),
  ('bbbb5555-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', '{"en":"Tuition"}', 1000, 'monthly');

insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, due_date) values
  ('aaaa6666-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa3333-0000-0000-0000-000000000001', 'aaaa5555-0000-0000-0000-000000000001', 1000, '2026-08-01'),
  ('bbbb6666-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'bbbb3333-0000-0000-0000-000000000002', 'bbbb5555-0000-0000-0000-000000000002', 1000, '2026-08-01');

-- ---------- Act as Tenant-A's school_admin -----------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*) from public.students where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0::bigint, 'Tenant A admin sees 0 Tenant B students (direct filter)');

select is(
  (select count(*) from public.students),
  1::bigint, 'Tenant A admin sees exactly their own 1 student (RLS default, no filter needed)');

select is(
  (select count(*) from public.employees where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0::bigint, 'Tenant A admin sees 0 Tenant B employees');

select is(
  (select count(*) from public.fee_invoices where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0::bigint, 'Tenant A admin sees 0 Tenant B fee invoices');

-- Embedded-relation check: a join across two RLS-protected tables must not
-- widen access — selecting students with an embedded fee_invoices join scoped
-- to Tenant B's student id must still return nothing.
select is(
  (select count(*) from public.students s join public.fee_invoices i on i.student_id = s.id
   where s.id = 'bbbb3333-0000-0000-0000-000000000002'),
  0::bigint, 'Embedded join cannot surface Tenant B student+invoice rows');

-- C-1 regression: Tenant A admin cannot flip their own tenant_id to Tenant B.
select throws_ok(
  $stmt$ update public.users set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002'
         where id = '11111111-1111-1111-1111-111111111111' $stmt$,
  'identity_fields_immutable',
  'Self-service tenant_id change is rejected (C-1 regression)');

-- C-1 regression (role escalation variant): cannot self-promote to super_admin.
select throws_ok(
  $stmt$ update public.users set role = 'super_admin'
         where id = '11111111-1111-1111-1111-111111111111' $stmt$,
  'identity_fields_immutable',
  'Self-service role change is rejected (C-1 regression)');

select * from finish();
rollback;
