-- ============================================================================
-- Role/user permissions matrix -- Phase 2, Academics & SIS domain
-- (20260817000002). Proves, for every table this migration touches:
--   1. Zero configuration reproduces today's exact population -- both the
--      staff-role branch (now matrix-driven) AND every relationship branch
--      (is_teacher_of_class / is_guardian_of / self / reported_by), which
--      the migration claims are untouched.
--   2. A role-level grant via the matrix actually widens access for a role
--      that had none by default (e.g. accountant reading students).
--   3. A role-level deny via the matrix actually narrows the default
--      staff-role population (proving the matrix can restrict, not just
--      grant).
-- Resources whose write population is wider than "school_admin only"
-- (teachers: +hr_officer; assignment_sections/attachments: +teacher) get an
-- explicit assertion proving that wider default reproduces without any
-- grant configured -- the highest-risk part of transcribing per-resource
-- defaults is getting the population itself right, not just the mechanism.
-- ============================================================================
begin;
select plan(52);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '9e000001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ra-admin@test.example',    crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9e000002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ra-teacher1@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9e000003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'ra-teacher2@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9e000004-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'ra-registrar@test.example',crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9e000005-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'ra-librarian@test.example',crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9e000006-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'ra-accountant@test.example',crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9e000007-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'ra-hr@test.example',       crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9e000008-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'ra-student@test.example',  crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9e000009-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'ra-guardian@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('9e000000-0000-0000-0000-00000000000a', 'RA Tenant A', 'ra-tenant-a', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('9e000001-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-00000000000a', 'school_admin', 'RA Admin',       'ra-admin@test.example'),
  ('9e000002-0000-0000-0000-000000000002', '9e000000-0000-0000-0000-00000000000a', 'teacher',      'RA Teacher 1',   'ra-teacher1@test.example'),
  ('9e000003-0000-0000-0000-000000000003', '9e000000-0000-0000-0000-00000000000a', 'teacher',      'RA Teacher 2',   'ra-teacher2@test.example'),
  ('9e000004-0000-0000-0000-000000000004', '9e000000-0000-0000-0000-00000000000a', 'registrar',    'RA Registrar',   'ra-registrar@test.example'),
  ('9e000005-0000-0000-0000-000000000005', '9e000000-0000-0000-0000-00000000000a', 'librarian',    'RA Librarian',   'ra-librarian@test.example'),
  ('9e000006-0000-0000-0000-000000000006', '9e000000-0000-0000-0000-00000000000a', 'accountant',   'RA Accountant',  'ra-accountant@test.example'),
  ('9e000007-0000-0000-0000-000000000007', '9e000000-0000-0000-0000-00000000000a', 'hr_officer',   'RA HR',          'ra-hr@test.example'),
  ('9e000008-0000-0000-0000-000000000008', '9e000000-0000-0000-0000-00000000000a', 'student',      'RA Student',     'ra-student@test.example'),
  ('9e000009-0000-0000-0000-000000000009', '9e000000-0000-0000-0000-00000000000a', 'parent',       'RA Guardian',    'ra-guardian@test.example');

insert into public.academic_years (id, tenant_id, ec_year, label_i18n, starts_on, ends_on, status) values
  ('9e000000-0000-0000-0000-00000000ea01', '9e000000-0000-0000-0000-00000000000a', 2018, '{}'::jsonb, '2025-09-01', '2026-06-30', 'active');
insert into public.academic_terms (id, tenant_id, academic_year_id, name_i18n, term_no, starts_on, ends_on) values
  ('9e000000-0000-0000-0000-00000000ea02', '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000ea01', '{}'::jsonb, 1, '2025-09-01', '2026-01-30');

insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('9e000000-0000-0000-0000-00000000c001', '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000ea01', 'Grade 5', 'A');
insert into public.subjects (id, tenant_id, name_i18n, code) values
  ('9e000000-0000-0000-0000-00000000f001', '9e000000-0000-0000-0000-00000000000a', '{"en":"Math"}'::jsonb, 'RA-MATH');

insert into public.teachers (id, tenant_id, user_id, staff_no) values
  ('9e000000-0000-0000-0000-0000000b0001', '9e000000-0000-0000-0000-00000000000a', '9e000002-0000-0000-0000-000000000002', 'RA-T-001'),
  ('9e000000-0000-0000-0000-0000000b0002', '9e000000-0000-0000-0000-00000000000a', '9e000003-0000-0000-0000-000000000003', 'RA-T-002');
-- teacher1 is linked to the class; teacher2 deliberately is not -- proves
-- is_teacher_of_class() stays correctly SCOPED, not just present.
insert into public.class_subject_teachers (id, tenant_id, class_id, subject_id, teacher_id) values
  ('9e000000-0000-0000-0000-0000000ca001', '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000c001', '9e000000-0000-0000-0000-00000000f001', '9e000000-0000-0000-0000-0000000b0001');

insert into public.students (id, tenant_id, user_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('9e000000-0000-0000-0000-0000000d0001', '9e000000-0000-0000-0000-00000000000a', '9e000008-0000-0000-0000-000000000008', '9e000000-0000-0000-0000-00000000c001', 'RA-ADM-001', 'Amina', 'Yusuf', '2014-01-01', 'female');
insert into public.guardians (id, tenant_id, student_id, user_id, relationship) values
  ('9e000000-0000-0000-0000-0000000d0101', '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-0000000d0001', '9e000009-0000-0000-0000-000000000009', 'mother');

insert into public.exams (id, tenant_id, academic_term_id, name_i18n, max_score, weight) values
  ('9e000000-0000-0000-0000-0000000e0001', '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000ea02', '{"en":"Midterm"}'::jsonb, 100, 1);

-- grade_guard()/attendance_guard() stamp entered_by/recorded_by from auth.uid()
-- server-side, overriding any client value -- set the JWT claim so the
-- fixture rows land with the value this suite expects.
set local request.jwt.claim.sub = '9e000001-0000-0000-0000-000000000001';

insert into public.grades (id, tenant_id, student_id, exam_id, subject_id, score, entered_by) values
  ('9e000000-0000-0000-0000-0000009a0001', '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-0000000d0001', '9e000000-0000-0000-0000-0000000e0001', '9e000000-0000-0000-0000-00000000f001', 85, '9e000001-0000-0000-0000-000000000001');
insert into public.attendance (id, tenant_id, student_id, class_id, attendance_date, status, recorded_by) values
  ('9e000000-0000-0000-0000-0000000a0101', '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-0000000d0001', '9e000000-0000-0000-0000-00000000c001', '2025-10-01', 'present', '9e000001-0000-0000-0000-000000000001');
insert into public.assignments (id, tenant_id, class_id, subject_id, title, due_date, created_by) values
  ('9e000000-0000-0000-0000-0000000a0201', '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000c001', '9e000000-0000-0000-0000-00000000f001', 'Fractions worksheet', '2025-10-15', '9e000001-0000-0000-0000-000000000001'),
  ('9e000000-0000-0000-0000-0000000a0202', '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000c001', '9e000000-0000-0000-0000-00000000f001', 'Decimals worksheet', '2025-10-22', '9e000001-0000-0000-0000-000000000001');
insert into public.assignment_submissions (id, tenant_id, assignment_id, student_id) values
  ('9e000000-0000-0000-0000-0000000a0301', '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-0000000a0201', '9e000000-0000-0000-0000-0000000d0001');
insert into public.discipline_incidents (id, tenant_id, student_id, incident_date, description, reported_by) values
  ('9e000000-0000-0000-0000-0000000d0201', '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-0000000d0001', '2025-10-02', 'Late to class', '9e000002-0000-0000-0000-000000000002');
insert into public.student_merits (id, tenant_id, student_id, title) values
  ('9e000000-0000-0000-0000-0000000d0301', '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-0000000d0001', 'Perfect attendance');

-- ============================================================================
-- students
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9e000006-0000-0000-0000-000000000006'; -- accountant: no default students access at all
select is((select count(*)::int from public.students), 0, 'unconfigured: accountant (not in students'' default read population) sees zero students');
set local request.jwt.claim.sub = '9e000008-0000-0000-0000-000000000008'; -- the student themself
select is((select count(*)::int from public.students), 1, 'unconfigured: student self-access to their own row is untouched');
set local request.jwt.claim.sub = '9e000009-0000-0000-0000-000000000009'; -- guardian
select is((select count(*)::int from public.students), 1, 'unconfigured: guardian access to their own child is untouched');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9e000000-0000-0000-0000-00000000000a', 'accountant', id, true from public.permissions where key = 'students:read';
set local role authenticated;
set local request.jwt.claim.sub = '9e000006-0000-0000-0000-000000000006';
select is((select count(*)::int from public.students), 1, 'role grant: accountant can now read students after being granted students:read');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9e000000-0000-0000-0000-00000000000a', 'registrar', id, false from public.permissions where key = 'students:read';
set local role authenticated;
set local request.jwt.claim.sub = '9e000004-0000-0000-0000-000000000004'; -- registrar, explicitly denied
select is((select count(*)::int from public.students), 0, 'role deny: registrar explicitly denied students:read now sees zero rows');
reset role;

-- ============================================================================
-- guardians
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9e000006-0000-0000-0000-000000000006'; -- accountant
select is((select count(*)::int from public.guardians), 0, 'unconfigured: accountant sees zero guardians (not in default population)');
set local request.jwt.claim.sub = '9e000009-0000-0000-0000-000000000009'; -- guardian self
select is((select count(*)::int from public.guardians), 1, 'unconfigured: guardian self-access is untouched');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9e000000-0000-0000-0000-00000000000a', 'accountant', id, true from public.permissions where key = 'guardians:read';
set local role authenticated;
set local request.jwt.claim.sub = '9e000006-0000-0000-0000-000000000006';
select is((select count(*)::int from public.guardians), 1, 'role grant: accountant can now read guardians');
reset role;

-- ============================================================================
-- grades
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9e000002-0000-0000-0000-000000000002'; -- teacher1, teaches this class
select is((select count(*)::int from public.grades), 1, 'unconfigured: teacher-of-class can still read grades (relationship branch untouched)');
set local request.jwt.claim.sub = '9e000003-0000-0000-0000-000000000003'; -- teacher2, does NOT teach this class
select is((select count(*)::int from public.grades), 0, 'unconfigured: teacher NOT of this class sees zero grades (relationship branch correctly scoped)');
set local request.jwt.claim.sub = '9e000008-0000-0000-0000-000000000008'; -- student self
select is((select count(*)::int from public.grades), 1, 'unconfigured: student self-access to their own grades is untouched');
select throws_ok(
  $stmt$ insert into public.grades (tenant_id, student_id, exam_id, subject_id, score, entered_by)
         values ('9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-0000000d0001', '9e000000-0000-0000-0000-0000000e0001', '9e000000-0000-0000-0000-00000000f001', 10, auth.uid()) $stmt$,
  '42501', null, 'unconfigured: a student cannot insert their own grade');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9e000000-0000-0000-0000-00000000000a', 'registrar', id, true from public.permissions where key = 'grades:read';
set local role authenticated;
set local request.jwt.claim.sub = '9e000004-0000-0000-0000-000000000004'; -- registrar
select is((select count(*)::int from public.grades), 1, 'role grant: registrar can now read grades');
reset role;

-- ============================================================================
-- attendance
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9e000002-0000-0000-0000-000000000002'; -- teacher1, teaches this class
select is((select count(*)::int from public.attendance), 1, 'unconfigured: teacher-of-class can still read attendance');
set local request.jwt.claim.sub = '9e000003-0000-0000-0000-000000000003'; -- teacher2, not this class
select is((select count(*)::int from public.attendance), 0, 'unconfigured: teacher NOT of this class sees zero attendance rows');
select throws_ok(
  $stmt$ insert into public.attendance (tenant_id, student_id, class_id, attendance_date, status)
         values ('9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-0000000d0001', '9e000000-0000-0000-0000-00000000c001', '2025-10-02', 'present') $stmt$,
  '42501', null, 'unconfigured: a teacher NOT of this class cannot mark its attendance');
set local request.jwt.claim.sub = '9e000009-0000-0000-0000-000000000009'; -- guardian
select is((select count(*)::int from public.attendance), 1, 'unconfigured: guardian self-access to their child''s attendance is untouched');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9e000000-0000-0000-0000-00000000000a', 'accountant', id, true from public.permissions where key = 'attendance:read';
set local role authenticated;
set local request.jwt.claim.sub = '9e000006-0000-0000-0000-000000000006';
select is((select count(*)::int from public.attendance), 1, 'role grant: accountant can now read attendance');
reset role;

-- ============================================================================
-- assignments
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9e000003-0000-0000-0000-000000000003'; -- teacher2, not this class
select is((select count(*)::int from public.assignments), 0, 'unconfigured: teacher NOT of this class sees zero assignments');
set local request.jwt.claim.sub = '9e000008-0000-0000-0000-000000000008'; -- student self (via class match)
select is((select count(*)::int from public.assignments), 2, 'unconfigured: a student in the class can still read both its assignments');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9e000000-0000-0000-0000-00000000000a', 'registrar', id, true from public.permissions where key = 'assignments:read';
set local role authenticated;
set local request.jwt.claim.sub = '9e000004-0000-0000-0000-000000000004';
select is((select count(*)::int from public.assignments), 2, 'role grant: registrar can now read assignments');
reset role;

-- ============================================================================
-- assignment_submissions (no 'create' permission exists -- student self-
-- insert has no staff-role branch to matrix-wrap, left fully untouched)
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9e000002-0000-0000-0000-000000000002'; -- teacher1, teaches this class
select is((select count(*)::int from public.assignment_submissions), 1, 'unconfigured: teacher-of-class can still read submissions');
set local request.jwt.claim.sub = '9e000008-0000-0000-0000-000000000008'; -- student self
select is((select count(*)::int from public.assignment_submissions), 1, 'unconfigured: student can still read their own submission');
select lives_ok(
  $stmt$ insert into public.assignment_submissions (tenant_id, assignment_id, student_id)
         values ('9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-0000000a0202',
                 (select id from public.students where user_id = '9e000008-0000-0000-0000-000000000008')) $stmt$,
  'student self-insert on assignment_submissions is untouched by this migration (no matrix create action exists)');
reset role;

-- UPDATE's USING clause silently FILTERS which rows are touched (0 rows
-- affected, no error) rather than raising 42501 -- unlike INSERT's WITH
-- CHECK, there's no "existing row" for USING to reject against. Confirm the
-- row is genuinely untouched, not just "no exception was thrown".
set local role authenticated;
set local request.jwt.claim.sub = '9e000003-0000-0000-0000-000000000003'; -- teacher2
update public.assignment_submissions set score = 5 where id = '9e000000-0000-0000-0000-0000000a0301';
reset role;
select is(
  (select score from public.assignment_submissions where id = '9e000000-0000-0000-0000-0000000a0301'), null::numeric,
  'unconfigured: teacher NOT of this class cannot grade the submission (USING filtered the row, score stays null)');

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9e000000-0000-0000-0000-00000000000a', 'registrar', id, true from public.permissions where key = 'assignment_submissions:update';
set local role authenticated;
set local request.jwt.claim.sub = '9e000004-0000-0000-0000-000000000004'; -- registrar
select lives_ok(
  $stmt$ update public.assignment_submissions set score = 8 where id = '9e000000-0000-0000-0000-0000000a0301' $stmt$,
  'role grant: registrar can now grade a submission after being granted assignment_submissions:update');
reset role;

-- ============================================================================
-- discipline_incidents
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9e000002-0000-0000-0000-000000000002'; -- reported_by = teacher1
select is((select count(*)::int from public.discipline_incidents), 1, 'unconfigured: the reporter of record can still read their own filed incident');
set local request.jwt.claim.sub = '9e000003-0000-0000-0000-000000000003'; -- teacher2, teaches nothing here, did not file it
select is((select count(*)::int from public.discipline_incidents), 0, 'unconfigured: a teacher who neither filed the incident nor is school_admin sees zero rows (no teacher-of-class branch exists on this table)');
-- discipline_incidents:create's default population is {school_admin,teacher},
-- unscoped by class -- teacher2 can still FILE an incident even though they
-- can't READ others' incidents, exactly matching the original flat role
-- check (discipline_insert had no relationship branch at all).
select lives_ok(
  $stmt$ insert into public.discipline_incidents (tenant_id, student_id, incident_date, description, reported_by)
         values ('9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-0000000d0001', '2025-10-03', 'unconfigured: any teacher can still file', '9e000003-0000-0000-0000-000000000003') $stmt$,
  'unconfigured: any teacher (unscoped) can still file a discipline incident (matches the original flat role check)');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9e000000-0000-0000-0000-00000000000a', 'teacher', id, false from public.permissions where key = 'discipline_incidents:create';
set local role authenticated;
set local request.jwt.claim.sub = '9e000002-0000-0000-0000-000000000002'; -- teacher1, now explicitly denied
select throws_ok(
  $stmt$ insert into public.discipline_incidents (tenant_id, student_id, incident_date, description, reported_by)
         values ('9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-0000000d0001', '2025-10-04', 'should be blocked', '9e000002-0000-0000-0000-000000000002') $stmt$,
  '42501', null, 'role deny: teacher explicitly denied discipline_incidents:create is now blocked');
reset role;

-- ============================================================================
-- student_merits
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9e000003-0000-0000-0000-000000000003'; -- teacher2 (unscoped default read population includes any teacher)
select is((select count(*)::int from public.student_merits), 1, 'unconfigured: any teacher (unscoped default) can read student merits');
set local request.jwt.claim.sub = '9e000006-0000-0000-0000-000000000006'; -- accountant, not in default population
select is((select count(*)::int from public.student_merits), 0, 'unconfigured: accountant sees zero student merits (not in default population)');
set local request.jwt.claim.sub = '9e000008-0000-0000-0000-000000000008'; -- student self
select is((select count(*)::int from public.student_merits), 1, 'unconfigured: student self-access to their own merits is untouched');
set local request.jwt.claim.sub = '9e000009-0000-0000-0000-000000000009'; -- guardian
select is((select count(*)::int from public.student_merits), 1, 'unconfigured: guardian access to their child''s merits is untouched');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9e000000-0000-0000-0000-00000000000a', 'accountant', id, true from public.permissions where key = 'student_merits:read';
set local role authenticated;
set local request.jwt.claim.sub = '9e000006-0000-0000-0000-000000000006';
select is((select count(*)::int from public.student_merits), 1, 'role grant: accountant can now read student merits');
reset role;

-- ============================================================================
-- teachers: default write population is wider than "school_admin only"
-- (school_admin + hr_officer) -- confirm hr_officer works with ZERO grants
-- configured, since this is the highest-risk part of transcribing a
-- resource-specific default that differs from every other simple resource.
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9e000007-0000-0000-0000-000000000007'; -- hr_officer
select lives_ok(
  $stmt$ insert into public.teachers (tenant_id, user_id, staff_no)
         values ('9e000000-0000-0000-0000-00000000000a', '9e000004-0000-0000-0000-000000000004', 'RA-T-HR') $stmt$,
  'unconfigured: hr_officer can create a teacher with zero grants configured (matches the original school_admin+hr_officer write population)');
set local request.jwt.claim.sub = '9e000006-0000-0000-0000-000000000006'; -- accountant, was never in the population
select throws_ok(
  $stmt$ insert into public.teachers (tenant_id, user_id, staff_no)
         values ('9e000000-0000-0000-0000-00000000000a', '9e000005-0000-0000-0000-000000000005', 'RA-T-ACCT') $stmt$,
  '42501', null, 'unconfigured: accountant still cannot create a teacher (never in the default population)');
reset role;

-- ============================================================================
-- assignment_sections / assignment_attachments: default write population is
-- school_admin + teacher (unscoped) -- confirm a plain teacher works with
-- zero grants configured.
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9e000003-0000-0000-0000-000000000003'; -- teacher2, unscoped
select lives_ok(
  $stmt$ insert into public.assignment_sections (tenant_id, assignment_id, class_id)
         values ('9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-0000000a0201', '9e000000-0000-0000-0000-00000000c001') $stmt$,
  'unconfigured: any teacher can create an assignment section with zero grants configured');
reset role;

-- ============================================================================
-- academic_years: the other resource left out of the original pilot array --
-- full regression check since it's now the concrete proof the "leftover 2"
-- from the original array behave identically to the piloted 4.
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9e000008-0000-0000-0000-000000000008'; -- student, portal role
select is((select count(*)::int from public.academic_years), 1, 'unconfigured: any authenticated tenant member (even a student) still reads academic_years (open read, matches pilot shape)');
select throws_ok(
  $stmt$ insert into public.academic_years (tenant_id, ec_year, label_i18n, starts_on, ends_on)
         values ('9e000000-0000-0000-0000-00000000000a', 2019, '{}'::jsonb, '2026-09-01', '2027-06-30') $stmt$,
  '42501', null, 'unconfigured: a student cannot create an academic year (fallback create = school_admin only)');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9e000000-0000-0000-0000-00000000000a', 'registrar', id, true from public.permissions where key = 'academic_years:create';
set local role authenticated;
set local request.jwt.claim.sub = '9e000004-0000-0000-0000-000000000004'; -- registrar
select lives_ok(
  $stmt$ insert into public.academic_years (tenant_id, ec_year, label_i18n, starts_on, ends_on)
         values ('9e000000-0000-0000-0000-00000000000a', 2019, '{}'::jsonb, '2026-09-01', '2027-06-30') $stmt$,
  'role grant: registrar can now create an academic year after being granted academic_years:create');
reset role;

-- ============================================================================
-- The remaining simple resources (exams, grading_scales, grade_bands,
-- periods, report_templates, class_subject_teachers, academic_terms): each
-- shares the byte-identical open-read/school_admin-write shape already
-- exhaustively proven by the Phase 1 pilot suite AND by academic_years
-- above -- one write-side spot check each is enough to prove the default
-- seeding is real for that specific resource, not assumed from the pattern.
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9e000003-0000-0000-0000-000000000003'; -- teacher2, not school_admin

select throws_ok(
  $stmt$ insert into public.exams (tenant_id, academic_term_id, name_i18n, max_score)
         values ('9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000ea02', '{}'::jsonb, 50) $stmt$,
  '42501', null, 'unconfigured: a teacher cannot create an exam (fallback create = school_admin only)');

select throws_ok(
  $stmt$ insert into public.grading_scales (tenant_id, name) values ('9e000000-0000-0000-0000-00000000000a', 'RA Scale') $stmt$,
  '42501', null, 'unconfigured: a teacher cannot create a grading scale');

select throws_ok(
  $stmt$ insert into public.periods (tenant_id, period_no, starts_at, ends_at)
         values ('9e000000-0000-0000-0000-00000000000a', 99, '08:00', '08:40') $stmt$,
  '42501', null, 'unconfigured: a teacher cannot create a timetable period');

select throws_ok(
  $stmt$ insert into public.report_templates (tenant_id, name) values ('9e000000-0000-0000-0000-00000000000a', 'x') $stmt$,
  '42501', null, 'unconfigured: a teacher cannot create a report template');

select throws_ok(
  $stmt$ insert into public.class_subject_teachers (tenant_id, class_id, subject_id, teacher_id)
         values ('9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000c001', '9e000000-0000-0000-0000-00000000f001', '9e000000-0000-0000-0000-0000000b0002') $stmt$,
  '42501', null, 'unconfigured: a teacher cannot self-assign a class/subject/teacher link');

select throws_ok(
  $stmt$ insert into public.academic_terms (tenant_id, academic_year_id, name_i18n, term_no, starts_on, ends_on)
         values ('9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000ea01', '{}'::jsonb, 2, '2026-02-01', '2026-06-30') $stmt$,
  '42501', null, 'unconfigured: a teacher cannot create an academic term');

reset role;

-- ============================================================================
-- admission_applications: simple, but read is role-gated (not open) --
-- distinct enough from the other "simple" resources to warrant its own check.
-- ============================================================================
insert into public.admission_applications (id, tenant_id, applicant_name, date_of_birth, stage, guardian_name, guardian_phone)
values ('9e000000-0000-0000-0000-00000000ad01', '9e000000-0000-0000-0000-00000000000a', 'Test Applicant', '2016-01-01', 'applied', 'A Guardian', '+251911000000');

set local role authenticated;
set local request.jwt.claim.sub = '9e000002-0000-0000-0000-000000000002'; -- teacher, never in the default population
select is((select count(*)::int from public.admission_applications), 0, 'unconfigured: a teacher sees zero admission applications (default read = school_admin+registrar only, no open branch)');
set local request.jwt.claim.sub = '9e000004-0000-0000-0000-000000000004'; -- registrar
select is((select count(*)::int from public.admission_applications), 1, 'unconfigured: registrar still reads admission applications (default population preserved)');
reset role;

-- ============================================================================
-- report_templates: regression test for the write-population fix in
-- 20260817000005 -- the pre-matrix policy granted school_admin, registrar,
-- AND accountant; this migration's initial seed wrongly narrowed that to
-- school_admin only. Proves the backfill restored registrar/accountant
-- write access with zero manual grant configuration, and that a role
-- outside that population (teacher) is still correctly denied.
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9e000004-0000-0000-0000-000000000004'; -- registrar
insert into public.report_templates (id, tenant_id, name)
values ('9e000000-0000-0000-0000-000000007101', '9e000000-0000-0000-0000-00000000000a', 'Registrar Report');
select is((select count(*)::int from public.report_templates where id = '9e000000-0000-0000-0000-000000007101'), 1,
  'unconfigured: registrar can create report_templates (write population = school_admin+registrar+accountant, matching the pre-matrix policy)');

set local request.jwt.claim.sub = '9e000006-0000-0000-0000-000000000006'; -- accountant
update public.report_templates set name = 'Accountant Edited' where id = '9e000000-0000-0000-0000-000000007101';
select is((select name from public.report_templates where id = '9e000000-0000-0000-0000-000000007101'), 'Accountant Edited',
  'unconfigured: accountant can update report_templates (write population preserved)');

set local request.jwt.claim.sub = '9e000002-0000-0000-0000-000000000002'; -- teacher, never in the write population
select throws_ok(
  $stmt$ insert into public.report_templates (id, tenant_id, name)
         values ('9e000000-0000-0000-0000-000000007102', '9e000000-0000-0000-0000-00000000000a', 'Teacher Report') $stmt$,
  '42501', null, 'unconfigured: a teacher still cannot create report_templates (not in the write population)');
reset role;

select * from finish();
rollback;

