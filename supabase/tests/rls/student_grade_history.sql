-- ============================================================================
-- Regression for get_student_grade_history() (20260822000001_student_grade_
-- history.sql). Reconstructs a student's real grade-tab history from
-- audit_logs (audit_students has captured every class_id write since the
-- table's creation) rather than a hardcoded array, without handing audit_logs
-- access itself to anyone who wouldn't otherwise have it.
-- ============================================================================
begin;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '99981111-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin-gh@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99981111-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'student-gh@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99981111-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'guardian-gh@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99981111-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'other-teacher-gh@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99981111-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'admin-q-gh@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('99980000-0000-0000-0000-000000000001', 'GH Tenant P', 'rls-test-gh-p', 'active', 'premium'),
  ('99980000-0000-0000-0000-000000000002', 'GH Tenant Q', 'rls-test-gh-q', 'active', 'premium');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('99981111-0000-0000-0000-000000000001', '99980000-0000-0000-0000-000000000001', 'school_admin', 'GH Admin', 'admin-gh@test.example'),
  ('99981111-0000-0000-0000-000000000002', '99980000-0000-0000-0000-000000000001', 'student', 'GH Student Login', 'student-gh@test.example'),
  ('99981111-0000-0000-0000-000000000003', '99980000-0000-0000-0000-000000000001', 'parent', 'GH Guardian Login', 'guardian-gh@test.example'),
  ('99981111-0000-0000-0000-000000000004', '99980000-0000-0000-0000-000000000001', 'teacher', 'GH Unrelated Teacher', 'other-teacher-gh@test.example'),
  ('99981111-0000-0000-0000-000000000005', '99980000-0000-0000-0000-000000000002', 'school_admin', 'GH Tenant Q Admin', 'admin-q-gh@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('99982000-0000-0000-0000-000000000001', '99980000-0000-0000-0000-000000000001', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section, grade_level) values
  ('99983000-0000-0000-0000-000000000001', '99980000-0000-0000-0000-000000000001', '99982000-0000-0000-0000-000000000001', 'Grade 3', 'A', 3),
  ('99983000-0000-0000-0000-000000000002', '99980000-0000-0000-0000-000000000001', '99982000-0000-0000-0000-000000000001', 'Grade 4', 'A', 4),
  ('99983000-0000-0000-0000-000000000003', '99980000-0000-0000-0000-000000000001', '99982000-0000-0000-0000-000000000001', 'Grade 4', 'B', 4);

-- the student starts in Grade 3 A.
insert into public.students (id, tenant_id, class_id, user_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('99984000-0000-0000-0000-000000000001', '99980000-0000-0000-0000-000000000001', '99983000-0000-0000-0000-000000000001', '99981111-0000-0000-0000-000000000002', 'ADM-GH-001', 'Grade', 'History', '2015-01-01', 'female');
insert into public.guardians (tenant_id, student_id, user_id, relationship) values
  ('99980000-0000-0000-0000-000000000001', '99984000-0000-0000-0000-000000000001', '99981111-0000-0000-0000-000000000003', 'mother');

set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000001'; -- school_admin
select is(
  (select public.get_student_grade_history('99984000-0000-0000-0000-000000000001')),
  array[3]::smallint[],
  'before any promotion: history is just the current grade (3), not a hardcoded range'
);

-- promote: Grade 3 A -> Grade 4 A. audit_students captures this UPDATE
-- automatically (trigger has existed since the table's creation).
update public.students set class_id = '99983000-0000-0000-0000-000000000002' where id = '99984000-0000-0000-0000-000000000001';
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000001'; -- school_admin
select is(
  (select public.get_student_grade_history('99984000-0000-0000-0000-000000000001')),
  array[3,4]::smallint[],
  'after promotion 3->4: history includes both grades, in order, nothing beyond current'
);

-- a same-grade section move (Grade 4 A -> Grade 4 B) must not duplicate "4"
-- in the result -- proves the DISTINCT, not just an append.
set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000001';
update public.students set class_id = '99983000-0000-0000-0000-000000000003' where id = '99984000-0000-0000-0000-000000000001';
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000001'; -- school_admin
select is(
  (select public.get_student_grade_history('99984000-0000-0000-0000-000000000001')),
  array[3,4]::smallint[],
  'a same-grade section move does not duplicate the grade level in the history'
);
reset role;

-- self: the student's own login can see their own history.
set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000002'; -- student's own login
select is(
  (select public.get_student_grade_history('99984000-0000-0000-0000-000000000001')),
  array[3,4]::smallint[],
  'a student can see their OWN grade history via their own login'
);
reset role;

-- guardian: linked guardian can see it too.
set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000003'; -- guardian
select is(
  (select public.get_student_grade_history('99984000-0000-0000-0000-000000000001')),
  array[3,4]::smallint[],
  'a linked guardian can see the student''s grade history'
);
reset role;

-- an unrelated teacher (not teacher-of-class, no students:read grant) gets
-- an empty array, not an exception.
set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000004'; -- unrelated teacher
select is(
  (select public.get_student_grade_history('99984000-0000-0000-0000-000000000001')),
  array[]::smallint[],
  'an unrelated teacher with no grant gets an empty array, not an exception'
);
reset role;

-- nonexistent student id -> empty array, not an exception.
set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000001'; -- school_admin
select is(
  (select public.get_student_grade_history('11111111-1111-1111-1111-111111111111')),
  array[]::smallint[],
  'a nonexistent student id yields an empty array, not an exception'
);
reset role;

-- cross-tenant: a different tenant's school_admin gets nothing for tenant
-- P's student -- get_tenant_id_for_user scoping, not just role checks.
set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000005'; -- tenant Q's school_admin
select is(
  (select public.get_student_grade_history('99984000-0000-0000-0000-000000000001')),
  array[]::smallint[],
  'a different tenant''s school_admin gets an empty array for a foreign-tenant student'
);
reset role;

select * from finish();
rollback;
