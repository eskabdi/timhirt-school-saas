-- ============================================================================
-- Regression for the exam class-scoping fix
-- (20260821000004_exam_class_scoping.sql). An exam with a class_id only
-- accepts grades for students in that class; a legacy exam with class_id
-- IS NULL is unaffected (accepts any student in the tenant, as before);
-- exam_guard rejects a class from a different tenant.
-- ============================================================================
begin;
select plan(5);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777',
   'authenticated', 'authenticated', 'admin-ecs@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('ffffffff-0000-0000-0000-000000000006', 'Tenant F', 'rls-test-tenant-f', 'active', 'premium'),
  ('11110000-0000-0000-0000-000000000007', 'Tenant G', 'rls-test-tenant-g', 'active', 'premium');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('77777777-7777-7777-7777-777777777777', 'ffffffff-0000-0000-0000-000000000006', 'school_admin', 'Admin F', 'admin-ecs@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('ffff1111-0000-0000-0000-000000000006', 'ffffffff-0000-0000-0000-000000000006', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.academic_terms (id, tenant_id, academic_year_id, name_i18n, term_no, starts_on, ends_on) values
  ('ffff9999-0000-0000-0000-000000000006', 'ffffffff-0000-0000-0000-000000000006', 'ffff1111-0000-0000-0000-000000000006', '{"en":"Term 1"}', 1, '2025-09-11', '2026-01-10');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('ffff2222-0000-0000-0000-000000000006', 'ffffffff-0000-0000-0000-000000000006', 'ffff1111-0000-0000-0000-000000000006', 'Grade 5', 'A'),
  ('ffff2223-0000-0000-0000-000000000006', 'ffffffff-0000-0000-0000-000000000006', 'ffff1111-0000-0000-0000-000000000006', 'Grade 6', 'A');
insert into public.subjects (id, tenant_id, code, name_i18n) values
  ('ffff3333-0000-0000-0000-000000000006', 'ffffffff-0000-0000-0000-000000000006', 'MATH', '{"en":"Math"}');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('ffff4444-0000-0000-0000-000000000006', 'ffffffff-0000-0000-0000-000000000006', 'ffff2222-0000-0000-0000-000000000006', 'ADM-F-001', 'InClass', 'Student', '2015-01-01', 'male'),
  ('ffff4445-0000-0000-0000-000000000006', 'ffffffff-0000-0000-0000-000000000006', 'ffff2223-0000-0000-0000-000000000006', 'ADM-F-002', 'OutOfClass', 'Student', '2015-01-01', 'male');

-- a class belonging to a different tenant, for the exam_guard cross-tenant check
insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('11119999-0000-0000-0000-000000000007', '11110000-0000-0000-0000-000000000007', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('11112222-0000-0000-0000-000000000007', '11110000-0000-0000-0000-000000000007', '11119999-0000-0000-0000-000000000007', 'Grade 1', 'A');

-- ---------- exam_guard: cross-tenant class_id is rejected -------------------
select throws_ok(
  $$ insert into public.exams (tenant_id, academic_term_id, name_i18n, max_score, class_id)
     values ('ffffffff-0000-0000-0000-000000000006', 'ffff9999-0000-0000-0000-000000000006', '{"en":"Bad"}', 100,
             '11112222-0000-0000-0000-000000000007') $$,
  'P0001', 'class_not_in_tenant',
  'exam_guard rejects a class_id belonging to a different tenant'
);

-- ---------- scoped exam: class-matched insert works, mismatched fails ------
insert into public.exams (id, tenant_id, academic_term_id, name_i18n, max_score, class_id) values
  ('ffff5555-0000-0000-0000-000000000006', 'ffffffff-0000-0000-0000-000000000006', 'ffff9999-0000-0000-0000-000000000006', '{"en":"Midterm"}', 100, 'ffff2222-0000-0000-0000-000000000006');

set local role authenticated;
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';

select lives_ok(
  $$ insert into public.grades (tenant_id, student_id, exam_id, subject_id, score)
     values ('ffffffff-0000-0000-0000-000000000006', 'ffff4444-0000-0000-0000-000000000006',
             'ffff5555-0000-0000-0000-000000000006', 'ffff3333-0000-0000-0000-000000000006', 88) $$,
  'a student in the exam''s own class can be scored'
);

select throws_ok(
  $$ insert into public.grades (tenant_id, student_id, exam_id, subject_id, score)
     values ('ffffffff-0000-0000-0000-000000000006', 'ffff4445-0000-0000-0000-000000000006',
             'ffff5555-0000-0000-0000-000000000006', 'ffff3333-0000-0000-0000-000000000006', 75) $$,
  'P0001', 'student_not_in_exam_class',
  'a student NOT in the exam''s class is rejected'
);

reset role;

-- ---------- legacy unscoped exam (class_id IS NULL): any student accepted --
insert into public.exams (id, tenant_id, academic_term_id, name_i18n, max_score, class_id) values
  ('ffff6666-0000-0000-0000-000000000006', 'ffffffff-0000-0000-0000-000000000006', 'ffff9999-0000-0000-0000-000000000006', '{"en":"Legacy Exam"}', 100, null);

set local role authenticated;
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';

select lives_ok(
  $$ insert into public.grades (tenant_id, student_id, exam_id, subject_id, score)
     values ('ffffffff-0000-0000-0000-000000000006', 'ffff4445-0000-0000-0000-000000000006',
             'ffff6666-0000-0000-0000-000000000006', 'ffff3333-0000-0000-0000-000000000006', 60) $$,
  'a legacy unscoped exam (class_id IS NULL) still accepts any tenant student'
);

-- score-exceeds-max still enforced (grade_guard's original check, untouched by this fix)
select throws_ok(
  $$ insert into public.grades (tenant_id, student_id, exam_id, subject_id, score)
     values ('ffffffff-0000-0000-0000-000000000006', 'ffff4444-0000-0000-0000-000000000006',
             'ffff6666-0000-0000-0000-000000000006', 'ffff3333-0000-0000-0000-000000000006', 999) $$,
  'P0001', 'score_exceeds_max',
  'score_exceeds_max is still enforced after this fix'
);

reset role;

select * from finish();
rollback;
