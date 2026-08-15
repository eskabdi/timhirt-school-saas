-- ============================================================================
-- Regression for get_class_rank() (20260821000008_class_rank.sql). Ranks
-- students within a class by GPA without ever exposing a classmate's raw
-- grades to a self-viewing student/guardian -- only rank + roster size come
-- back. Authorization mirrors grades_select's own branches (self, guardian,
-- teacher-of-class, or grades:read staff), re-derived here since this
-- function is SECURITY DEFINER and bypasses RLS to read every classmate's
-- grades in order to compute the rank.
-- ============================================================================
begin;
select plan(9);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '99971111-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin-rank@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99971111-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'top-rank@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99971111-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'other-teacher-rank@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('99970000-0000-0000-0000-000000000001', 'Rank Tenant P', 'rls-test-rank-p', 'active', 'premium');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('99971111-0000-0000-0000-000000000001', '99970000-0000-0000-0000-000000000001', 'school_admin', 'Rank Admin', 'admin-rank@test.example'),
  ('99971111-0000-0000-0000-000000000002', '99970000-0000-0000-0000-000000000001', 'teacher', 'Top Scorer Login', 'top-rank@test.example'),
  ('99971111-0000-0000-0000-000000000003', '99970000-0000-0000-0000-000000000001', 'teacher', 'Unrelated Teacher', 'other-teacher-rank@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('99972000-0000-0000-0000-000000000001', '99970000-0000-0000-0000-000000000001', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.academic_terms (id, tenant_id, academic_year_id, name_i18n, term_no, starts_on, ends_on) values
  ('99972999-0000-0000-0000-000000000001', '99970000-0000-0000-0000-000000000001', '99972000-0000-0000-0000-000000000001', '{"en":"Term 1"}', 1, '2025-09-11', '2026-01-10');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('99973000-0000-0000-0000-000000000001', '99970000-0000-0000-0000-000000000001', '99972000-0000-0000-0000-000000000001', 'Grade 7', 'A'),
  ('99973000-0000-0000-0000-000000000002', '99970000-0000-0000-0000-000000000001', '99972000-0000-0000-0000-000000000001', 'Grade 7', 'B');
insert into public.subjects (id, tenant_id, code, name_i18n) values
  ('99974000-0000-0000-0000-000000000001', '99970000-0000-0000-0000-000000000001', 'MATH', '{"en":"Math"}');

-- s1: 95 (rank 1). s2: 60 (rank 2). s3: no grades at all (rank 3, gpa=0).
-- s4: in a DIFFERENT class -- must not affect s1/s2/s3's ranking or roster size.
insert into public.students (id, tenant_id, class_id, user_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('99975000-0000-0000-0000-000000000001', '99970000-0000-0000-0000-000000000001', '99973000-0000-0000-0000-000000000001', '99971111-0000-0000-0000-000000000002', 'ADM-RK-001', 'Top', 'Scorer', '2013-01-01', 'male'),
  ('99975000-0000-0000-0000-000000000002', '99970000-0000-0000-0000-000000000001', '99973000-0000-0000-0000-000000000001', null,                                     'ADM-RK-002', 'Mid', 'Scorer', '2013-01-01', 'female'),
  ('99975000-0000-0000-0000-000000000003', '99970000-0000-0000-0000-000000000001', '99973000-0000-0000-0000-000000000001', null,                                     'ADM-RK-003', 'No', 'Grades', '2013-01-01', 'male'),
  ('99975000-0000-0000-0000-000000000004', '99970000-0000-0000-0000-000000000001', '99973000-0000-0000-0000-000000000002', null,                                     'ADM-RK-004', 'Other', 'Class', '2013-01-01', 'female');

insert into public.exams (id, tenant_id, academic_term_id, name_i18n, max_score, class_id) values
  ('99976000-0000-0000-0000-000000000001', '99970000-0000-0000-0000-000000000001', '99972999-0000-0000-0000-000000000001', '{"en":"Midterm"}', 100, '99973000-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claim.sub = '99971111-0000-0000-0000-000000000001'; -- school_admin

-- grade_guard's BEFORE INSERT trigger stamps entered_by := auth.uid(), so
-- these inserts must happen under a real authenticated role, not as the
-- superuser fixture-setup above (which has no auth.uid()).
insert into public.grades (tenant_id, student_id, exam_id, subject_id, score) values
  ('99970000-0000-0000-0000-000000000001', '99975000-0000-0000-0000-000000000001', '99976000-0000-0000-0000-000000000001', '99974000-0000-0000-0000-000000000001', 95),
  ('99970000-0000-0000-0000-000000000001', '99975000-0000-0000-0000-000000000002', '99976000-0000-0000-0000-000000000001', '99974000-0000-0000-0000-000000000001', 60);

select results_eq(
  $$ select rank, total_students from public.get_class_rank('99975000-0000-0000-0000-000000000001', '99973000-0000-0000-0000-000000000001') $$,
  $$ values (1, 3) $$,
  'top scorer (95) ranks 1st of 3 (the 4th student is in a different class, excluded)'
);
select results_eq(
  $$ select rank, total_students from public.get_class_rank('99975000-0000-0000-0000-000000000002', '99973000-0000-0000-0000-000000000001') $$,
  $$ values (2, 3) $$,
  'mid scorer (60) ranks 2nd of 3'
);
select results_eq(
  $$ select rank, total_students from public.get_class_rank('99975000-0000-0000-0000-000000000003', '99973000-0000-0000-0000-000000000001') $$,
  $$ values (3, 3) $$,
  'the student with zero grades (gpa=0) ranks last, 3rd of 3, not excluded from the roster'
);

reset role;

-- self: the top scorer's own login can see their own rank.
set local role authenticated;
set local request.jwt.claim.sub = '99971111-0000-0000-0000-000000000002'; -- top scorer's own login

select results_eq(
  $$ select rank, total_students from public.get_class_rank('99975000-0000-0000-0000-000000000001', '99973000-0000-0000-0000-000000000001') $$,
  $$ values (1, 3) $$,
  'a student can see their OWN rank via their own login'
);

reset role;

-- an unrelated teacher (not teacher-of-this-class, no grades:read grant)
-- gets nothing back -- not an exception, just an empty result, matching
-- how a genuinely-not-found row behaves elsewhere in this codebase.
set local role authenticated;
set local request.jwt.claim.sub = '99971111-0000-0000-0000-000000000003'; -- unrelated teacher

select is(
  (select count(*)::int from public.get_class_rank('99975000-0000-0000-0000-000000000001', '99973000-0000-0000-0000-000000000001')),
  0,
  'an unrelated teacher with no grades:read grant and not teacher-of-class gets an empty result, not an exception'
);

reset role;

-- cross-tenant: a student id + class id from a different tenant than the
-- caller's own must also yield nothing (get_tenant_id_for_user scoping).
set local role authenticated;
set local request.jwt.claim.sub = '99971111-0000-0000-0000-000000000001'; -- school_admin, tenant P

select is(
  (select count(*)::int from public.get_class_rank('11111111-1111-1111-1111-111111111111', '99973000-0000-0000-0000-000000000001')),
  0,
  'a nonexistent/foreign student id yields an empty result, not an exception'
);

-- the "other class" student's roster size proves classes are isolated:
-- their own class (section B) has just the 1 student.
select results_eq(
  $$ select rank, total_students from public.get_class_rank('99975000-0000-0000-0000-000000000004', '99973000-0000-0000-0000-000000000002') $$,
  $$ values (1, 1) $$,
  'a different section is scored as its own independent roster (1 of 1, unaffected by section A)'
);

reset role;

-- direct SQL sanity check: dense_rank ties correctly if two students share
-- the exact same GPA (both get the same rank number).
set local role authenticated;
set local request.jwt.claim.sub = '99971111-0000-0000-0000-000000000001';

insert into public.grades (tenant_id, student_id, exam_id, subject_id, score) values
  ('99970000-0000-0000-0000-000000000001', '99975000-0000-0000-0000-000000000003', '99976000-0000-0000-0000-000000000001', '99974000-0000-0000-0000-000000000001', 60);

select results_eq(
  $$ select rank, total_students from public.get_class_rank('99975000-0000-0000-0000-000000000003', '99973000-0000-0000-0000-000000000001') $$,
  $$ values (2, 3) $$,
  'a tie in GPA (60 == 60) shares the same rank number'
);
select results_eq(
  $$ select rank, total_students from public.get_class_rank('99975000-0000-0000-0000-000000000002', '99973000-0000-0000-0000-000000000001') $$,
  $$ values (2, 3) $$,
  'the other tied student shares that same rank number too'
);

reset role;

select * from finish();
rollback;
