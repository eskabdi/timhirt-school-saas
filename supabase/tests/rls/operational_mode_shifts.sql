-- ============================================================================
-- shift (20260811000001) on periods/classes/teachers, wiring operational_mode
-- into the timetable. Two things actually need proving beyond "the column
-- exists": the periods unique constraint genuinely allows the same period_no
-- under two different shifts (that's the whole reason a double-shift school
-- needs per-shift period rows) while still rejecting a true duplicate, and
-- that classes.shift/teachers.shift stay covered by the existing row-level
-- write policies (classes_write, teachers_write) with no new policy added.
-- ============================================================================
begin;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '9c000001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'oms-admin-a@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9c000002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'oms-hr-a@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9c000003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'oms-teacher-a@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9c000004-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'oms-admin-b@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('9c000000-0000-0000-0000-00000000000a', 'OMS Tenant A', 'oms-tenant-a', 'active'),
  ('9c000000-0000-0000-0000-00000000000b', 'OMS Tenant B', 'oms-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('9c000001-0000-0000-0000-000000000001', '9c000000-0000-0000-0000-00000000000a', 'school_admin', 'OMS Admin',    'oms-admin-a@test.example'),
  ('9c000002-0000-0000-0000-000000000002', '9c000000-0000-0000-0000-00000000000a', 'hr_officer',   'OMS HR',       'oms-hr-a@test.example'),
  ('9c000003-0000-0000-0000-000000000003', '9c000000-0000-0000-0000-00000000000a', 'teacher',      'OMS Teacher',  'oms-teacher-a@test.example'),
  ('9c000004-0000-0000-0000-000000000004', '9c000000-0000-0000-0000-00000000000b', 'school_admin', 'OMS Admin B',  'oms-admin-b@test.example');

insert into public.academic_years (id, tenant_id, ec_year, label_i18n, starts_on, ends_on, status) values
  ('9c010000-0000-0000-0000-00000000000a', '9c000000-0000-0000-0000-00000000000a', 2018, '{"en":"2018 E.C."}', '2025-09-01', '2026-07-01', 'active');

insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('9c020001-0000-0000-0000-00000000000a', '9c000000-0000-0000-0000-00000000000a', '9c010000-0000-0000-0000-00000000000a', 'Grade 7', 'A');

insert into public.teachers (id, tenant_id, user_id, staff_no) values
  ('9c040001-0000-0000-0000-00000000000a', '9c000000-0000-0000-0000-00000000000a', '9c000003-0000-0000-0000-000000000003', 'T-OMS1');

-- ---------- periods: same period_no, two different shifts coexist -----------
set local role authenticated;
set local request.jwt.claim.sub = '9c000001-0000-0000-0000-000000000001'; -- school_admin

select lives_ok(
  $stmt$ insert into public.periods (tenant_id, period_no, shift, starts_at, ends_at) values
         ('9c000000-0000-0000-0000-00000000000a', 1, 'morning', '07:30', '08:10') $stmt$,
  'school_admin creates period 1 for the morning shift');

select lives_ok(
  $stmt$ insert into public.periods (tenant_id, period_no, shift, starts_at, ends_at) values
         ('9c000000-0000-0000-0000-00000000000a', 1, 'afternoon', '12:30', '13:10') $stmt$,
  'the SAME period_no for the afternoon shift is not a conflict -- distinct clock times, distinct rows');

select throws_ok(
  $stmt$ insert into public.periods (tenant_id, period_no, shift, starts_at, ends_at) values
         ('9c000000-0000-0000-0000-00000000000a', 1, 'morning', '08:10', '08:50') $stmt$,
  '23505', null,
  'a true duplicate (same tenant, period_no, AND shift) is still rejected');

-- ---------- classes.shift: covered by the existing classes_write policy -----
select lives_ok(
  $stmt$ update public.classes set shift = 'morning' where id = '9c020001-0000-0000-0000-00000000000a' $stmt$,
  'school_admin can set shift on their own tenant''s class');

select is(
  (select shift::text from public.classes where id = '9c020001-0000-0000-0000-00000000000a'),
  'morning', 'classes.shift was actually persisted');

set local request.jwt.claim.sub = '9c000004-0000-0000-0000-000000000004'; -- school_admin, tenant B

select lives_ok(
  $stmt$ update public.classes set shift = 'afternoon' where id = '9c020001-0000-0000-0000-00000000000a' $stmt$,
  'cross-tenant school_admin''s write runs without error (RLS filters, does not raise)');

set local request.jwt.claim.sub = '9c000001-0000-0000-0000-000000000001';

select is(
  (select shift::text from public.classes where id = '9c020001-0000-0000-0000-00000000000a'),
  'morning', 'classes.shift is unchanged -- the cross-tenant update matched zero rows');

-- ---------- teachers.shift: covered by the existing teachers_write policy ---
-- (school_admin OR hr_officer, same as every other teachers.* column)
select lives_ok(
  $stmt$ update public.teachers set shift = 'afternoon' where id = '9c040001-0000-0000-0000-00000000000a' $stmt$,
  'school_admin can set shift on a teacher in their own tenant');

set local request.jwt.claim.sub = '9c000002-0000-0000-0000-000000000002'; -- hr_officer

select lives_ok(
  $stmt$ update public.teachers set shift = 'morning' where id = '9c040001-0000-0000-0000-00000000000a' $stmt$,
  'hr_officer can also set a teacher''s shift, same as school_admin');

select is(
  (select shift::text from public.teachers where id = '9c040001-0000-0000-0000-00000000000a'),
  'morning', 'teachers.shift reflects the hr_officer''s write');

select * from finish();
rollback;
