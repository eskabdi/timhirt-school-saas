-- ============================================================================
-- Timetable periods restructure: the point of this migration was replacing
-- "nothing stops a double-booking" with real constraints, so that is what
-- gets proven here -- not just that rows can be inserted.
-- ============================================================================
begin;
select plan(10);

-- ---------- Fixtures ---------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'ec000001-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'tt-admin-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ec000002-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'tt-teacher1-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ec000003-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'tt-teacher2-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('ec000000-0000-0000-0000-00000000000a', 'Timetable Tenant A', 'tt-tenant-a', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('ec000001-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-00000000000a', 'school_admin', 'Admin A',    'tt-admin-a@test.example'),
  ('ec000002-0000-0000-0000-000000000002', 'ec000000-0000-0000-0000-00000000000a', 'teacher',      'Teacher A1', 'tt-teacher1-a@test.example'),
  ('ec000003-0000-0000-0000-000000000003', 'ec000000-0000-0000-0000-00000000000a', 'teacher',      'Teacher A2', 'tt-teacher2-a@test.example');

insert into public.academic_years (id, tenant_id, ec_year, label_i18n, starts_on, ends_on, status) values
  ('ec010000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-00000000000a', 2018,
   '{"en":"2018 E.C."}', '2025-09-01', '2026-07-01', 'active');

insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('ec020001-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-00000000000a', 'ec010000-0000-0000-0000-00000000000a', 'Grade 6', 'A'),
  ('ec020002-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-00000000000a', 'ec010000-0000-0000-0000-00000000000a', 'Grade 6', 'B');

insert into public.subjects (id, tenant_id, name_i18n, code) values
  ('ec030001-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-00000000000a', '{"en":"Mathematics"}', 'MATH'),
  ('ec030002-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-00000000000a', '{"en":"English"}', 'ENG');

insert into public.teachers (id, tenant_id, user_id, staff_no) values
  ('ec040001-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-00000000000a', 'ec000002-0000-0000-0000-000000000002', 'T-A1'),
  ('ec040002-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-00000000000a', 'ec000003-0000-0000-0000-000000000003', 'T-A2');

-- This tenant is created inside the test's own transaction, after migrations
-- already ran -- the migration's one-time backfill (and onboard-tenant's
-- matching seed for tenants created after it) cannot reach a fixture tenant
-- that did not exist yet, so the fixture provides its own periods, same as
-- it does for classes/subjects/teachers above.
insert into public.periods (id, tenant_id, period_no, label, starts_at, ends_at) values
  ('ec050001-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-00000000000a', 1, 'Period 1', '08:30', '09:10'),
  ('ec050002-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-00000000000a', 2, 'Period 2', '09:10', '09:50');

select is(
  (select count(*)::int from public.periods where tenant_id = 'ec000000-0000-0000-0000-00000000000a'),
  2, 'the fixture periods exist before any timetable_slots test runs');

-- ---------- As school_admin: place the first real slot -----------------------
set local role authenticated;
set local request.jwt.claim.sub = 'ec000001-0000-0000-0000-000000000001';

select lives_ok(
  $stmt$ insert into public.timetable_slots (tenant_id, class_id, subject_id, teacher_id, day_of_week, period_id, room)
         select 'ec000000-0000-0000-0000-00000000000a', 'ec020001-0000-0000-0000-00000000000a',
                'ec030001-0000-0000-0000-00000000000a', 'ec040001-0000-0000-0000-00000000000a',
                2, id, 'Room 101'
         from public.periods
         where tenant_id = 'ec000000-0000-0000-0000-00000000000a' and period_no = 1 $stmt$,
  'school_admin can place a slot: Grade 6-A, Monday, Period 1, Teacher A1, Room 101');

-- ---------- THE regression that matters: three ways to double-book -----------
select throws_ok(
  $stmt$ insert into public.timetable_slots (tenant_id, class_id, subject_id, teacher_id, day_of_week, period_id)
         select 'ec000000-0000-0000-0000-00000000000a', 'ec020002-0000-0000-0000-00000000000a',
                'ec030002-0000-0000-0000-00000000000a', 'ec040001-0000-0000-0000-00000000000a',
                2, id
         from public.periods
         where tenant_id = 'ec000000-0000-0000-0000-00000000000a' and period_no = 1 $stmt$,
  '23505', null,
  'the same teacher cannot be booked into a second class in the same day+period');

select throws_ok(
  $stmt$ insert into public.timetable_slots (tenant_id, class_id, subject_id, teacher_id, day_of_week, period_id)
         select 'ec000000-0000-0000-0000-00000000000a', 'ec020001-0000-0000-0000-00000000000a',
                'ec030002-0000-0000-0000-00000000000a', 'ec040002-0000-0000-0000-00000000000a',
                2, id
         from public.periods
         where tenant_id = 'ec000000-0000-0000-0000-00000000000a' and period_no = 1 $stmt$,
  '23505', null,
  'the same class cannot have a second subject in the same day+period');

select throws_ok(
  $stmt$ insert into public.timetable_slots (tenant_id, class_id, subject_id, teacher_id, day_of_week, period_id, room)
         select 'ec000000-0000-0000-0000-00000000000a', 'ec020002-0000-0000-0000-00000000000a',
                'ec030002-0000-0000-0000-00000000000a', 'ec040002-0000-0000-0000-00000000000a',
                2, id, 'Room 101'
         from public.periods
         where tenant_id = 'ec000000-0000-0000-0000-00000000000a' and period_no = 1 $stmt$,
  '23505', null,
  'the same room cannot host two different classes in the same day+period');

-- ---------- Positive controls: none of these are actually conflicts ----------
select lives_ok(
  $stmt$ insert into public.timetable_slots (tenant_id, class_id, subject_id, teacher_id, day_of_week, period_id, room)
         select 'ec000000-0000-0000-0000-00000000000a', 'ec020002-0000-0000-0000-00000000000a',
                'ec030002-0000-0000-0000-00000000000a', 'ec040002-0000-0000-0000-00000000000a',
                2, id, 'Room 102'
         from public.periods
         where tenant_id = 'ec000000-0000-0000-0000-00000000000a' and period_no = 1 $stmt$,
  'a different class, subject, teacher, and room in the same day+period is not a conflict');

select lives_ok(
  $stmt$ insert into public.timetable_slots (tenant_id, class_id, subject_id, teacher_id, day_of_week, period_id, room)
         select 'ec000000-0000-0000-0000-00000000000a', 'ec020001-0000-0000-0000-00000000000a',
                'ec030002-0000-0000-0000-00000000000a', 'ec040001-0000-0000-0000-00000000000a',
                2, id, 'Room 101'
         from public.periods
         where tenant_id = 'ec000000-0000-0000-0000-00000000000a' and period_no = 2 $stmt$,
  'the same class/teacher/room in a different period on the same day is not a conflict');

select lives_ok(
  $stmt$ insert into public.timetable_slots (tenant_id, class_id, subject_id, teacher_id, day_of_week, period_id, room)
         select 'ec000000-0000-0000-0000-00000000000a', 'ec020001-0000-0000-0000-00000000000a',
                'ec030001-0000-0000-0000-00000000000a', 'ec040001-0000-0000-0000-00000000000a',
                3, id, 'Room 101'
         from public.periods
         where tenant_id = 'ec000000-0000-0000-0000-00000000000a' and period_no = 1 $stmt$,
  'the same class/teacher/room/period on a different day is not a conflict');

select is(
  (select count(*)::int from public.timetable_slots where tenant_id = 'ec000000-0000-0000-0000-00000000000a'),
  4, 'exactly the four legitimate slots exist -- every conflicting attempt above was rejected');

-- ---------- periods_write is school_admin-only, same as timetable_write ------
set local request.jwt.claim.sub = 'ec000002-0000-0000-0000-000000000002';
select throws_ok(
  $stmt$ insert into public.periods (tenant_id, period_no, starts_at, ends_at)
         values ('ec000000-0000-0000-0000-00000000000a', 99, '15:00', '15:40') $stmt$,
  null, null,
  'a teacher cannot create a new period -- periods_write is school_admin-only');

select * from finish();
rollback;
