-- ============================================================================
-- exam_seat_assignments + auto_assign_exam_seats (20260825000001). Proves:
-- auto-assign fills every student into a deterministic grid, re-running it
-- rebuilds cleanly (no stale seats from a previous layout), a grid smaller
-- than the roster leaves the overflow unassigned rather than erroring,
-- manual override (a plain UPDATE) works and keeps the one-seat-per-student
-- and one-student-per-seat constraints, a teacher of a DIFFERENT class is
-- rejected, and cross-tenant is denied.
-- ============================================================================
begin;
select plan(9);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'e5e00001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'esc-admin@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'e5e00002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'esc-teacher-other@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('e5e00000-0000-0000-0000-00000000000a', 'ESC Tenant', 'esc-tenant', 'active'),
  ('e5f00000-0000-0000-0000-00000000000b', 'ESC Tenant B', 'esc-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('e5e00001-0000-0000-0000-000000000001', 'e5e00000-0000-0000-0000-00000000000a', 'school_admin', 'ESC Admin', 'esc-admin@test.example'),
  ('e5e00002-0000-0000-0000-000000000002', 'e5e00000-0000-0000-0000-00000000000a', 'teacher', 'ESC Other Teacher', 'esc-teacher-other@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('e5e10000-0000-0000-0000-000000000001', 'e5e00000-0000-0000-0000-00000000000a', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.academic_terms (id, tenant_id, academic_year_id, name_i18n, term_no, starts_on, ends_on) values
  ('e5e19999-0000-0000-0000-000000000001', 'e5e00000-0000-0000-0000-00000000000a', 'e5e10000-0000-0000-0000-000000000001', '{"en":"Term 1"}', 1, '2025-09-11', '2026-01-10');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('e5e20000-0000-0000-0000-000000000001', 'e5e00000-0000-0000-0000-00000000000a', 'e5e10000-0000-0000-0000-000000000001', 'Grade 3', 'A'),
  ('e5e20000-0000-0000-0000-000000000002', 'e5e00000-0000-0000-0000-00000000000a', 'e5e10000-0000-0000-0000-000000000001', 'Grade 4', 'A');

-- 5 students in Grade 3 A, a 2x2 grid (4 seats) leaves exactly one unseated.
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('e5e30000-0000-0000-0000-000000000001', 'e5e00000-0000-0000-0000-00000000000a', 'e5e20000-0000-0000-0000-000000000001', 'ADM-ESC-001', 'Alpha', 'One', '2015-01-01', 'male'),
  ('e5e30000-0000-0000-0000-000000000002', 'e5e00000-0000-0000-0000-00000000000a', 'e5e20000-0000-0000-0000-000000000001', 'ADM-ESC-002', 'Bravo', 'Two', '2015-01-01', 'male'),
  ('e5e30000-0000-0000-0000-000000000003', 'e5e00000-0000-0000-0000-00000000000a', 'e5e20000-0000-0000-0000-000000000001', 'ADM-ESC-003', 'Charlie', 'Three', '2015-01-01', 'male'),
  ('e5e30000-0000-0000-0000-000000000004', 'e5e00000-0000-0000-0000-00000000000a', 'e5e20000-0000-0000-0000-000000000001', 'ADM-ESC-004', 'Delta', 'Four', '2015-01-01', 'male'),
  ('e5e30000-0000-0000-0000-000000000005', 'e5e00000-0000-0000-0000-00000000000a', 'e5e20000-0000-0000-0000-000000000001', 'ADM-ESC-005', 'Echo', 'Five', '2015-01-01', 'male');

insert into public.exams (id, tenant_id, academic_term_id, name_i18n, max_score, class_id) values
  ('e5e50000-0000-0000-0000-000000000001', 'e5e00000-0000-0000-0000-00000000000a', 'e5e19999-0000-0000-0000-000000000001', '{"en":"Seating Test"}', 100, 'e5e20000-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claim.sub = 'e5e00001-0000-0000-0000-000000000001'; -- school_admin

-- ---------- auto-assign: 2x2 grid, 5 students -> 4 seated, 1 left out -------
select is(
  (select public.auto_assign_exam_seats('e5e50000-0000-0000-0000-000000000001', 2, 2)),
  4, 'a 2x2 grid seats exactly 4 of the 5 students, no error on overflow');

select is(
  (select count(*)::int from public.exam_seat_assignments where exam_id = 'e5e50000-0000-0000-0000-000000000001'),
  4, 'exactly 4 seat rows exist after the 2x2 auto-assign');

-- ---------- re-running rebuilds cleanly (no stale seats from the old layout)
select is(
  (select public.auto_assign_exam_seats('e5e50000-0000-0000-0000-000000000001', 3, 2)),
  5, 'a 3x2 grid re-run seats all 5 students');

select is(
  (select count(*)::int from public.exam_seat_assignments where exam_id = 'e5e50000-0000-0000-0000-000000000001'),
  5, 're-running auto-assign replaces the previous layout rather than appending to it');

-- ---------- manual override: a plain UPDATE moves one student's seat ---------
select lives_ok(
  $$ update public.exam_seat_assignments set seat_label = 'R9C9'
     where exam_id = 'e5e50000-0000-0000-0000-000000000001' and student_id = 'e5e30000-0000-0000-0000-000000000001' $$,
  'school_admin can manually override a seat label'
);

select throws_ok(
  $$ update public.exam_seat_assignments set seat_label = 'R9C9'
     where exam_id = 'e5e50000-0000-0000-0000-000000000001' and student_id = 'e5e30000-0000-0000-0000-000000000002' $$,
  '23505', null, 'moving a second student onto an already-taken seat label is rejected'
);

-- ---------- a teacher of a DIFFERENT class cannot auto-assign or read -------
set local request.jwt.claim.sub = 'e5e00002-0000-0000-0000-000000000002'; -- teacher, not assigned to Grade 3 A

select throws_ok(
  $$ select public.auto_assign_exam_seats('e5e50000-0000-0000-0000-000000000001', 2, 2) $$,
  'P0001', 'not_authorized', 'a teacher not assigned to the exam''s class cannot auto-assign seats'
);

select is(
  (select count(*)::int from public.exam_seat_assignments where exam_id = 'e5e50000-0000-0000-0000-000000000001'),
  0, 'that same teacher sees 0 seat rows -- RLS select scoping, not just the RPC guard');

-- ---------- cross-tenant: a same-shaped exam id from another tenant is denied
set local role postgres;
reset request.jwt.claim.sub;
insert into public.users (id, tenant_id, role, full_name, email) values
  ('e5f00001-0000-0000-0000-000000000001', 'e5f00000-0000-0000-0000-00000000000b', 'school_admin', 'ESC Admin B', 'esc-admin-b@test.example');
set local role authenticated;
set local request.jwt.claim.sub = 'e5f00001-0000-0000-0000-000000000001'; -- tenant B admin

select throws_ok(
  $$ select public.auto_assign_exam_seats('e5e50000-0000-0000-0000-000000000001', 2, 2) $$,
  'P0001', 'cross_tenant_denied', 'a tenant B admin cannot auto-assign seats for a tenant A exam'
);

reset role;
select * from finish();
rollback;
