-- ============================================================================
-- Regression for grade_point_for() and the updated get_class_rank()
-- (20260821000009_grading_scales_lookup.sql). Proves the GPA/rank
-- computation genuinely reads a tenant's configured grading_scales/
-- grade_bands once one exists, not just the fallback ladder -- using a
-- deliberately unusual scale (an inverted point assignment) so a passing
-- result can only come from the real lookup, never from coincidentally
-- matching the fallback.
-- ============================================================================
begin;
select plan(6);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '99961111-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin-gsl@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('99960000-0000-0000-0000-000000000001', 'GSL Tenant P', 'rls-test-gsl-p', 'active', 'premium'),
  ('99960000-0000-0000-0000-000000000002', 'GSL Tenant Q (no scale)', 'rls-test-gsl-q', 'active', 'premium');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('99961111-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', 'school_admin', 'GSL Admin', 'admin-gsl@test.example');

-- ---------- 1: no default scale configured -> fallback ladder, unchanged ----
select is(
  public.grade_point_for('99960000-0000-0000-0000-000000000002', 92),
  4.0,
  'no grading_scales row at all: falls back to the old ladder (92 -> 4.0)'
);

-- ---------- 2: a configured default scale is used for real ------------------
-- Deliberately inverted vs. the fallback: a LOW score (40) is worth the
-- MOST points (5.0) here, a HIGH score (95) the LEAST (0.5) -- a result
-- that can only come from actually reading this scale, never from
-- accidentally falling through to the hardcoded ladder.
insert into public.grading_scales (id, tenant_id, name, is_default) values
  ('99962000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', 'GSL Inverted Scale', true);
insert into public.grade_bands (scale_id, tenant_id, letter, min_percent, gpa_points, sort_order) values
  ('99962000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', 'Z', 90, 0.5, 1),
  ('99962000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', 'Y', 60, 2.0, 2),
  ('99962000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', 'X', 0,  5.0, 3);

select is(
  public.grade_point_for('99960000-0000-0000-0000-000000000001', 95),
  0.5,
  'with a configured scale, a 95 is worth what THIS scale says (0.5), not the fallback ladder''s 4.0'
);
select is(
  public.grade_point_for('99960000-0000-0000-0000-000000000001', 40),
  5.0,
  'with a configured scale, a 40 is worth what THIS scale says (5.0) -- the inverted band'
);
select is(
  public.grade_point_for('99960000-0000-0000-0000-000000000002', 95),
  4.0,
  'a DIFFERENT tenant with no scale of its own still gets the fallback (95 -> 4.0), unaffected by tenant P''s scale'
);

-- ---------- 3: get_class_rank() picks up the configured scale too, so a ----
-- ---------- lower raw score can genuinely outrank a higher one -------------
insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('99963000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.academic_terms (id, tenant_id, academic_year_id, name_i18n, term_no, starts_on, ends_on) values
  ('99963999-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', '99963000-0000-0000-0000-000000000001', '{"en":"Term 1"}', 1, '2025-09-11', '2026-01-10');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('99964000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', '99963000-0000-0000-0000-000000000001', 'Grade 6', 'A');
insert into public.subjects (id, tenant_id, code, name_i18n) values
  ('99965000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', 'MATH', '{"en":"Math"}');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('99966000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', '99964000-0000-0000-0000-000000000001', 'ADM-GSL-001', 'HighRaw', 'Student', '2013-01-01', 'male'),
  ('99966000-0000-0000-0000-000000000002', '99960000-0000-0000-0000-000000000001', '99964000-0000-0000-0000-000000000001', 'ADM-GSL-002', 'LowRaw', 'Student', '2013-01-01', 'female');

set local role authenticated;
set local request.jwt.claim.sub = '99961111-0000-0000-0000-000000000001'; -- school_admin

insert into public.exams (id, tenant_id, academic_term_id, name_i18n, max_score, class_id) values
  ('99967000-0000-0000-0000-000000000001', '99960000-0000-0000-0000-000000000001', '99963999-0000-0000-0000-000000000001', '{"en":"Midterm"}', 100, '99964000-0000-0000-0000-000000000001');
insert into public.grades (tenant_id, student_id, exam_id, subject_id, score) values
  ('99960000-0000-0000-0000-000000000001', '99966000-0000-0000-0000-000000000001', '99967000-0000-0000-0000-000000000001', '99965000-0000-0000-0000-000000000001', 95),
  ('99960000-0000-0000-0000-000000000001', '99966000-0000-0000-0000-000000000002', '99967000-0000-0000-0000-000000000001', '99965000-0000-0000-0000-000000000001', 40);

select results_eq(
  $$ select rank, total_students from public.get_class_rank('99966000-0000-0000-0000-000000000002', '99964000-0000-0000-0000-000000000001') $$,
  $$ values (1, 2) $$,
  'with the inverted scale live, the LOWER raw score (40, worth 5.0 pts) ranks 1st -- proves get_class_rank() reads the real scale, not the fallback ladder'
);
select results_eq(
  $$ select rank, total_students from public.get_class_rank('99966000-0000-0000-0000-000000000001', '99964000-0000-0000-0000-000000000001') $$,
  $$ values (2, 2) $$,
  'the HIGHER raw score (95, worth only 0.5 pts under this scale) ranks 2nd'
);

reset role;

select * from finish();
rollback;
