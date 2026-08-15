-- ============================================================================
-- Result publication gate (20260831000001_result_publication_gate.sql).
-- Proves: a student/guardian cannot see grades for an unpublished term,
-- CAN see them once published, and staff (school_admin, the class
-- teacher, a role with grades:read) see grades regardless of publication
-- status either way.
-- ============================================================================
begin;
select plan(6);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '99931111-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin-rpg@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99931111-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'teacher-rpg@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99931111-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'student-rpg@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('99930000-0000-0000-0000-000000000001', 'RPG Tenant', 'rls-test-rpg', 'active', 'premium');
insert into public.users (id, tenant_id, role, full_name, email) values
  ('99931111-0000-0000-0000-000000000001', '99930000-0000-0000-0000-000000000001', 'school_admin', 'RPG Admin', 'admin-rpg@test.example'),
  ('99931111-0000-0000-0000-000000000002', '99930000-0000-0000-0000-000000000001', 'teacher', 'RPG Teacher', 'teacher-rpg@test.example'),
  ('99931111-0000-0000-0000-000000000003', '99930000-0000-0000-0000-000000000001', 'student', 'RPG Student', 'student-rpg@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('99932000-0000-0000-0000-000000000001', '99930000-0000-0000-0000-000000000001', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.academic_terms (id, tenant_id, academic_year_id, name_i18n, term_no, starts_on, ends_on, results_published) values
  ('99932000-0000-0000-0000-00000000ea01', '99930000-0000-0000-0000-000000000001', '99932000-0000-0000-0000-000000000001', '{"en":"Term 1"}', 1, '2025-09-11', '2026-01-10', false);
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('99933000-0000-0000-0000-000000000001', '99930000-0000-0000-0000-000000000001', '99932000-0000-0000-0000-000000000001', 'Grade 7', 'A');
insert into public.subjects (id, tenant_id, code, name_i18n) values
  ('99934000-0000-0000-0000-000000000001', '99930000-0000-0000-0000-000000000001', 'MATH-RPG', '{"en":"Math"}');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender, user_id) values
  ('99935000-0000-0000-0000-000000000001', '99930000-0000-0000-0000-000000000001', '99933000-0000-0000-0000-000000000001', 'ADM-RPG-001', 'S1', 'Student', '2013-01-01', 'male', '99931111-0000-0000-0000-000000000003');

insert into public.teachers (id, tenant_id, user_id, staff_no) values
  ('99936000-0000-0000-0000-000000000001', '99930000-0000-0000-0000-000000000001', '99931111-0000-0000-0000-000000000002', 'STF-RPG-001');
insert into public.class_subject_teachers (id, tenant_id, class_id, teacher_id, subject_id) values
  ('99937000-0000-0000-0000-000000000001', '99930000-0000-0000-0000-000000000001', '99933000-0000-0000-0000-000000000001', '99936000-0000-0000-0000-000000000001', '99934000-0000-0000-0000-000000000001');

insert into public.exams (id, tenant_id, academic_term_id, name_i18n, max_score) values
  ('99938000-0000-0000-0000-000000000001', '99930000-0000-0000-0000-000000000001', '99932000-0000-0000-0000-00000000ea01', '{"en":"Midterm"}', 100);

-- grade_guard() stamps entered_by from auth.uid() server-side, overriding
-- any client value -- set the JWT claim so the row lands as expected.
set local role authenticated;
set local request.jwt.claim.sub = '99931111-0000-0000-0000-000000000001';
insert into public.grades (id, tenant_id, student_id, exam_id, subject_id, score, entered_by) values
  ('99939000-0000-0000-0000-000000000001', '99930000-0000-0000-0000-000000000001', '99935000-0000-0000-0000-000000000001', '99938000-0000-0000-0000-000000000001', '99934000-0000-0000-0000-000000000001', 88, '99931111-0000-0000-0000-000000000001');

-- ---------- unpublished term: student cannot see their own grade ----------
set local request.jwt.claim.sub = '99931111-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from public.grades where id = '99939000-0000-0000-0000-000000000001'),
  0, 'a student cannot see their own grade for an unpublished term');

-- ---------- unpublished term: staff still see it ---------------------------
set local request.jwt.claim.sub = '99931111-0000-0000-0000-000000000001'; -- school_admin
select is(
  (select count(*)::int from public.grades where id = '99939000-0000-0000-0000-000000000001'),
  1, 'school_admin sees the grade regardless of publication status');

set local request.jwt.claim.sub = '99931111-0000-0000-0000-000000000002'; -- the class teacher
select is(
  (select count(*)::int from public.grades where id = '99939000-0000-0000-0000-000000000001'),
  1, 'the class teacher sees the grade regardless of publication status');

-- ---------- admin publishes the term ----------------------------------------
set local role postgres;
update public.academic_terms set results_published = true, results_published_at = now(),
  results_published_by = '99931111-0000-0000-0000-000000000001' where id = '99932000-0000-0000-0000-00000000ea01';
set local role authenticated;

select is(
  (select results_published from public.academic_terms where id = '99932000-0000-0000-0000-00000000ea01'),
  true, 'the term is now marked published');

-- ---------- published term: student can now see the grade ------------------
set local request.jwt.claim.sub = '99931111-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from public.grades where id = '99939000-0000-0000-0000-000000000001'),
  1, 'the student can now see their own grade once the term is published');

select is(
  (select score from public.grades where id = '99939000-0000-0000-0000-000000000001'),
  88::numeric, 'and the score value itself is readable');

reset role;
select * from finish();
rollback;
