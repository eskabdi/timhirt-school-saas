-- ============================================================================
-- Regression for 20260822000002_per_period_attendance.sql. Proves the daily
-- "whole day" uniqueness invariant survives byte-for-byte (a plain widened
-- UNIQUE constraint would NOT, since Postgres treats every NULL as distinct
-- from every other NULL), that per-period rows can coexist without
-- colliding, and that a cross-tenant period_id is rejected.
-- ============================================================================
begin;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '99991111-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin-pp@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('99990000-0000-0000-0000-000000000001', 'PP Tenant P', 'rls-test-pp-p', 'active', 'premium'),
  ('99990000-0000-0000-0000-000000000002', 'PP Tenant Q', 'rls-test-pp-q', 'active', 'premium');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('99991111-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000001', 'school_admin', 'PP Admin', 'admin-pp@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('99992000-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000001', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('99993000-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000001', '99992000-0000-0000-0000-000000000001', 'PP Daily Class', 'A'),
  ('99993000-0000-0000-0000-000000000002', '99990000-0000-0000-0000-000000000001', '99992000-0000-0000-0000-000000000001', 'PP Period Class', 'A');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('99994000-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000001', '99993000-0000-0000-0000-000000000001', 'ADM-PP-001', 'Daily', 'Student', '2013-01-01', 'male'),
  ('99994000-0000-0000-0000-000000000002', '99990000-0000-0000-0000-000000000001', '99993000-0000-0000-0000-000000000002', 'ADM-PP-002', 'Period', 'Student', '2013-01-01', 'female');
insert into public.periods (id, tenant_id, period_no, starts_at, ends_at) values
  ('99995000-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000001', 1, '08:00', '08:45'),
  ('99995000-0000-0000-0000-000000000002', '99990000-0000-0000-0000-000000000001', 2, '08:45', '09:30');
insert into public.periods (id, tenant_id, period_no, starts_at, ends_at) values
  ('99995000-0000-0000-0000-000000000003', '99990000-0000-0000-0000-000000000002', 1, '08:00', '08:45');

set local role authenticated;
set local request.jwt.claim.sub = '99991111-0000-0000-0000-000000000001'; -- school_admin

-- 1: default attendance_mode on a newly created class is 'daily'.
select is(
  (select attendance_mode::text from public.classes where id = '99993000-0000-0000-0000-000000000001'),
  'daily',
  'a newly created class defaults to attendance_mode=daily'
);

-- 2: exactly-as-before daily insert (no period_id) succeeds.
insert into public.attendance (tenant_id, student_id, class_id, attendance_date, status) values
  ('99990000-0000-0000-0000-000000000001', '99994000-0000-0000-0000-000000000001', '99993000-0000-0000-0000-000000000001', '2025-10-01', 'present');
select is(
  (select count(*)::int from public.attendance where student_id = '99994000-0000-0000-0000-000000000001' and attendance_date = '2025-10-01'),
  1,
  'a plain daily attendance insert (period_id null) works exactly as before'
);

-- 3: the daily uniqueness invariant survives -- a second whole-day row for
-- the same tenant/student/date/class is still rejected.
select throws_ok(
  $$ insert into public.attendance (tenant_id, student_id, class_id, attendance_date, status) values
     ('99990000-0000-0000-0000-000000000001', '99994000-0000-0000-0000-000000000001', '99993000-0000-0000-0000-000000000001', '2025-10-01', 'absent') $$,
  '23505',
  null,
  'a second whole-day (period_id null) row for the same student/date/class is still rejected, byte-for-byte as before'
);

-- 4: per-period mode -- the SAME student/date/class can now record two
-- DIFFERENT periods without colliding with each other or with a daily-mode
-- class's data.
update public.classes set attendance_mode = 'per_period' where id = '99993000-0000-0000-0000-000000000002';
select is(
  (select attendance_mode::text from public.classes where id = '99993000-0000-0000-0000-000000000002'),
  'per_period',
  'a class can be switched to attendance_mode=per_period'
);

insert into public.attendance (tenant_id, student_id, class_id, attendance_date, status, period_id) values
  ('99990000-0000-0000-0000-000000000001', '99994000-0000-0000-0000-000000000002', '99993000-0000-0000-0000-000000000002', '2025-10-01', 'present', '99995000-0000-0000-0000-000000000001'),
  ('99990000-0000-0000-0000-000000000001', '99994000-0000-0000-0000-000000000002', '99993000-0000-0000-0000-000000000002', '2025-10-01', 'absent', '99995000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.attendance where student_id = '99994000-0000-0000-0000-000000000002' and attendance_date = '2025-10-01'),
  2,
  'per-period rows for two different periods, same student/date/class, coexist without colliding'
);

-- 5: the same student/date/class/period combination twice is still rejected.
select throws_ok(
  $$ insert into public.attendance (tenant_id, student_id, class_id, attendance_date, status, period_id) values
     ('99990000-0000-0000-0000-000000000001', '99994000-0000-0000-0000-000000000002', '99993000-0000-0000-0000-000000000002', '2025-10-01', 'late', '99995000-0000-0000-0000-000000000001') $$,
  '23505',
  null,
  'a duplicate (student, date, class, period) row is rejected'
);

-- 6: the per-period class's data never collided with the daily-mode class's
-- own row from step 2 -- still exactly 1 row there.
select is(
  (select count(*)::int from public.attendance where student_id = '99994000-0000-0000-0000-000000000001' and attendance_date = '2025-10-01'),
  1,
  'the daily-mode class''s data is unaffected by the per-period class''s activity'
);

-- 7: a period_id from a DIFFERENT tenant is rejected.
select throws_ok(
  $$ insert into public.attendance (tenant_id, student_id, class_id, attendance_date, status, period_id) values
     ('99990000-0000-0000-0000-000000000001', '99994000-0000-0000-0000-000000000002', '99993000-0000-0000-0000-000000000002', '2025-10-02', 'present', '99995000-0000-0000-0000-000000000003') $$,
  'P0001',
  'period_id must belong to the same tenant',
  'a period_id belonging to a different tenant is rejected'
);

reset role;

select * from finish();
rollback;
