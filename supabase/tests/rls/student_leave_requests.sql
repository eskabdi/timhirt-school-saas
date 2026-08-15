-- ============================================================================
-- student_leave_requests + decide_student_leave_request (20260828000001).
-- Proves: a guardian can create a request only for their own child, in
-- pending status; a different family in the same tenant sees 0; the
-- teacher of the student's class and school_admin both see it and can
-- decide it; a guardian can cancel their own pending request but cannot
-- forge an approval; approving inserts excused attendance for the whole
-- range, skipping a holiday inside it; deciding twice is refused; and
-- rejecting writes no attendance at all.
-- ============================================================================
begin;
select plan(12);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '99961111-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin-slr@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99961111-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'teacher-slr@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99961111-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'parent-slr@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99961111-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'other-parent-slr@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('99960000-0000-0000-0000-000000000001', 'SLR Tenant', 'rls-test-slr', 'active', 'premium');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('99961111-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', 'school_admin', 'SLR Admin', 'admin-slr@test.example'),
  ('99961111-0000-0000-0000-000000000002', '99960000-0000-0000-0000-000000000001', 'teacher', 'SLR Teacher', 'teacher-slr@test.example'),
  ('99961111-0000-0000-0000-000000000003', '99960000-0000-0000-0000-000000000001', 'parent', 'SLR Parent', 'parent-slr@test.example'),
  ('99961111-0000-0000-0000-000000000004', '99960000-0000-0000-0000-000000000001', 'parent', 'SLR Other Parent', 'other-parent-slr@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('99962000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section, grade_level) values
  ('99963000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', '99962000-0000-0000-0000-000000000001', 'Grade 4', 'A', 4);
insert into public.teachers (id, tenant_id, user_id, staff_no) values
  ('99964000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', '99961111-0000-0000-0000-000000000002', 'STF-SLR-001');
insert into public.subjects (id, tenant_id, code, name_i18n) values
  ('99964000-0000-0000-0000-000000000002', '99960000-0000-0000-0000-000000000001', 'MATH-SLR', '{"en":"Math"}');
insert into public.class_subject_teachers (id, tenant_id, class_id, teacher_id, subject_id) values
  ('99965000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', '99963000-0000-0000-0000-000000000001', '99964000-0000-0000-0000-000000000001', '99964000-0000-0000-0000-000000000002');

insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('99966000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', '99963000-0000-0000-0000-000000000001', 'ADM-SLR-001', 'Stu', 'One', '2016-01-01', 'male');
insert into public.guardians (id, tenant_id, student_id, user_id, relationship) values
  ('99967000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', '99966000-0000-0000-0000-000000000001', '99961111-0000-0000-0000-000000000003', 'mother');

-- A holiday in the middle of the requested range -- must not get an
-- excused attendance row (attendance_guard would reject it anyway).
insert into public.calendar_events (id, tenant_id, name_i18n, event_date, event_type) values
  ('99968000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', '{"en":"Holiday"}', '2026-01-02', 'holiday');

set local role authenticated;
set local request.jwt.claim.sub = '99961111-0000-0000-0000-000000000003'; -- the parent/guardian

-- ---------- insert: guardian can request leave for their own child --------
select lives_ok(
  $$ insert into public.student_leave_requests (id, tenant_id, student_id, requested_by, starts_on, ends_on, reason)
     values ('99969000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001',
             '99966000-0000-0000-0000-000000000001', '99961111-0000-0000-0000-000000000003',
             '2026-01-01', '2026-01-03', 'Family travel') $$,
  'a guardian can create a leave request for their own child'
);

select throws_ok(
  $$ insert into public.student_leave_requests (tenant_id, student_id, requested_by, starts_on, ends_on, reason)
     values ('99960000-0000-0000-0000-000000000001', '99966000-0000-0000-0000-000000000001',
             '99961111-0000-0000-0000-000000000004', '2026-02-01', '2026-02-01', 'Not my child') $$,
  '42501', null, 'a different guardian cannot request leave for a child not theirs'
);

-- ---------- select: different family sees 0, teacher/admin see it --------
set local request.jwt.claim.sub = '99961111-0000-0000-0000-000000000004'; -- other parent, same tenant
select is(
  (select count(*)::int from public.student_leave_requests where id = '99969000-0000-0000-0000-000000000001'),
  0, 'a different family in the same tenant sees 0');

set local request.jwt.claim.sub = '99961111-0000-0000-0000-000000000002'; -- the class teacher
select is(
  (select count(*)::int from public.student_leave_requests where id = '99969000-0000-0000-0000-000000000001'),
  1, 'the student''s class teacher can see the request');

-- ---------- decide: teacher approves -> excused attendance backfilled -----
select is(
  (select public.decide_student_leave_request('99969000-0000-0000-0000-000000000001'::uuid, true)),
  2, 'approving excuses 2 of the 3 requested days (one is a holiday, correctly skipped)');

select is(
  (select count(*)::int from public.attendance where student_id = '99966000-0000-0000-0000-000000000001' and status = 'excused'),
  2, 'exactly 2 excused attendance rows exist (2026-01-01 and 2026-01-03, not the holiday 2026-01-02)');

select is(
  (select status from public.student_leave_requests where id = '99969000-0000-0000-0000-000000000001'),
  'approved'::public.leave_status, 'the request itself is now marked approved');

-- ---------- deciding twice is refused --------------------------------------
select throws_ok(
  $$ select public.decide_student_leave_request('99969000-0000-0000-0000-000000000001'::uuid, true) $$,
  'P0001', 'leave_request_already_decided', 'deciding an already-decided request is refused'
);

-- ---------- reject writes no attendance at all -----------------------------
set local role postgres;
insert into public.student_leave_requests (id, tenant_id, student_id, requested_by, starts_on, ends_on, reason) values
  ('99969000-0000-0000-0000-000000000002', '99960000-0000-0000-0000-000000000001', '99966000-0000-0000-0000-000000000001', '99961111-0000-0000-0000-000000000003', '2026-03-01', '2026-03-01', 'Second request');
set local role authenticated;
set local request.jwt.claim.sub = '99961111-0000-0000-0000-000000000001'; -- school_admin

select is(
  (select public.decide_student_leave_request('99969000-0000-0000-0000-000000000002'::uuid, false)),
  0, 'rejecting returns 0 (no attendance touched)');

select is(
  (select count(*)::int from public.attendance where attendance_date = '2026-03-01'),
  0, 'rejecting a request writes no attendance row at all');

-- ---------- guardian can cancel their own pending request, nothing else ---
set local role postgres;
insert into public.student_leave_requests (id, tenant_id, student_id, requested_by, starts_on, ends_on, reason) values
  ('99969000-0000-0000-0000-000000000003', '99960000-0000-0000-0000-000000000001', '99966000-0000-0000-0000-000000000001', '99961111-0000-0000-0000-000000000003', '2026-04-01', '2026-04-01', 'Third request');
set local role authenticated;
set local request.jwt.claim.sub = '99961111-0000-0000-0000-000000000003'; -- the guardian

select lives_ok(
  $$ update public.student_leave_requests set status = 'cancelled' where id = '99969000-0000-0000-0000-000000000003' $$,
  'the requesting guardian can cancel their own pending request'
);

-- ---------- guardian cannot forge an approval on their own request --------
set local role postgres;
insert into public.student_leave_requests (id, tenant_id, student_id, requested_by, starts_on, ends_on, reason) values
  ('99969000-0000-0000-0000-000000000004', '99960000-0000-0000-0000-000000000001', '99966000-0000-0000-0000-000000000001', '99961111-0000-0000-0000-000000000003', '2026-06-01', '2026-06-01', 'Fourth request');
set local role authenticated;
set local request.jwt.claim.sub = '99961111-0000-0000-0000-000000000003'; -- the guardian

select throws_ok(
  $$ update public.student_leave_requests set status = 'approved' where id = '99969000-0000-0000-0000-000000000004' $$,
  '42501', null, 'a guardian cannot set their own request straight to approved'
);

reset role;
select * from finish();
rollback;
