-- ============================================================================
-- Staff profile schema: column grants and RLS on the five new tables.
--
-- The first assertion is the important one. A column added to `employees` is
-- unreadable by `authenticated` unless explicitly granted, because
-- 20260713000010's column-level REVOKE on tin_number expanded the table-wide
-- GRANT SELECT into one grant per column existing at that moment. Missing one
-- does not degrade a field — it makes every query naming it fail with
-- "permission denied for table employees", so the whole staff profile page
-- dies. That cannot be caught by reading the migration, so it is asserted by
-- actually selecting all thirty-three columns as `authenticated`.
-- ============================================================================
begin;
select plan(17);

-- ---------- Fixtures ---------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'ef000001-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'staff-hr-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ef000002-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'staff-teacher-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ef000003-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'staff-teacher2-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ef000004-0000-0000-0000-000000000004',
   'authenticated', 'authenticated', 'staff-hr-b@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ef000005-0000-0000-0000-000000000005',
   'authenticated', 'authenticated', 'staff-acct-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('ea000000-0000-0000-0000-00000000000a', 'Staff Tenant A', 'staff-tenant-a', 'active'),
  ('eb000000-0000-0000-0000-00000000000b', 'Staff Tenant B', 'staff-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('ef000001-0000-0000-0000-000000000001', 'ea000000-0000-0000-0000-00000000000a', 'hr_officer', 'HR A',        'staff-hr-a@test.example'),
  ('ef000002-0000-0000-0000-000000000002', 'ea000000-0000-0000-0000-00000000000a', 'teacher',    'Teacher A',   'staff-teacher-a@test.example'),
  ('ef000003-0000-0000-0000-000000000003', 'ea000000-0000-0000-0000-00000000000a', 'teacher',    'Teacher A2',  'staff-teacher2-a@test.example'),
  ('ef000004-0000-0000-0000-000000000004', 'eb000000-0000-0000-0000-00000000000b', 'hr_officer', 'HR B',        'staff-hr-b@test.example'),
  ('ef000005-0000-0000-0000-000000000005', 'ea000000-0000-0000-0000-00000000000a', 'accountant', 'Accountant A','staff-acct-a@test.example');

insert into public.employees (
  id, tenant_id, user_id, employee_no, employee_type, full_name, hire_date, status,
  first_name, father_name, last_name, gender, date_of_birth, nationality,
  national_id, phone, job_title, department, languages
) values
  ('ea400001-0000-0000-0000-00000000000a', 'ea000000-0000-0000-0000-00000000000a',
   'ef000002-0000-0000-0000-000000000002', 'EA-001', 'teacher', 'Abebech Tadesse', '2020-01-01', 'active',
   'Abebech', 'Tadesse', 'Bekele', 'female', '1990-03-04', 'Ethiopian',
   '1234567890', '+251911000001', 'Senior Mathematics Educator', 'Science & Engineering',
   array['Amharic', 'English']),
  ('ea400002-0000-0000-0000-00000000000a', 'ea000000-0000-0000-0000-00000000000a',
   'ef000003-0000-0000-0000-000000000003', 'EA-002', 'teacher', 'Kebede Alemu', '2021-01-01', 'active',
   'Kebede', 'Alemu', 'Girma', 'male', '1988-05-06', 'Ethiopian',
   '1234567891', '+251911000002', 'Physics Educator', 'Science & Engineering', null),
  ('eb400001-0000-0000-0000-00000000000b', 'eb000000-0000-0000-0000-00000000000b',
   null, 'EB-001', 'teacher', 'Marta Tesfaye', '2020-01-01', 'active',
   'Marta', 'Tesfaye', 'Haile', 'female', '1991-01-01', 'Ethiopian',
   '1234567892', '+251911000003', 'Chemistry Educator', 'Science', null);

-- A half-finished registration. It has to be storable so step 4 has an
-- employee_id to attach uploads to, and so "Save as Draft" can resume.
insert into public.employees (id, tenant_id, employee_no, employee_type, full_name, hire_date, status)
values ('ea400003-0000-0000-0000-00000000000a', 'ea000000-0000-0000-0000-00000000000a',
        'EA-003', 'admin_staff', 'Partly Entered', '2026-01-01', 'draft');

insert into public.employee_emergency_contacts (tenant_id, employee_id, full_name, relationship, phone) values
  ('ea000000-0000-0000-0000-00000000000a', 'ea400001-0000-0000-0000-00000000000a', 'Tadesse Bekele', 'father', '+251911000009'),
  ('eb000000-0000-0000-0000-00000000000b', 'eb400001-0000-0000-0000-00000000000b', 'Tesfaye Haile', 'father', '+251911000010');

insert into public.employee_qualifications (tenant_id, employee_id, name, issuer, issued_on, expires_on) values
  ('ea000000-0000-0000-0000-00000000000a', 'ea400001-0000-0000-0000-00000000000a',
   'STEM Pedagogy Certification', 'Ministry of Education', '2022-06-01', '2027-06-01');

insert into public.subjects (id, tenant_id, name_i18n, code) values
  ('ea700000-0000-0000-0000-00000000000a', 'ea000000-0000-0000-0000-00000000000a', '{"en":"Mathematics"}', 'MATH');

insert into public.employee_subjects (tenant_id, employee_id, subject_id) values
  ('ea000000-0000-0000-0000-00000000000a', 'ea400001-0000-0000-0000-00000000000a', 'ea700000-0000-0000-0000-00000000000a');

insert into public.employee_documents (tenant_id, employee_id, category, doc_type, storage_path, verified) values
  ('ea000000-0000-0000-0000-00000000000a', 'ea400001-0000-0000-0000-00000000000a',
   'qualifications', 'degree_certificate', 'ea000000-0000-0000-0000-00000000000a/staff/ea400001/degree.pdf', true),
  ('eb000000-0000-0000-0000-00000000000b', 'eb400001-0000-0000-0000-00000000000b',
   'identification', 'national_id', 'eb000000-0000-0000-0000-00000000000b/staff/eb400001/id.pdf', false);

insert into public.staff_performance_reviews (tenant_id, employee_id, ec_year, rating, notes) values
  ('ea000000-0000-0000-0000-00000000000a', 'ea400001-0000-0000-0000-00000000000a', 2017, 4.5, 'Strong year'),
  ('ea000000-0000-0000-0000-00000000000a', 'ea400002-0000-0000-0000-00000000000a', 2017, 3.0, 'Colleague review');

-- The Employment step shows Staff ID as read-only and auto-generated, so an
-- insert that omits employee_no must still satisfy its NOT NULL constraint —
-- the BEFORE trigger fills it before constraints are evaluated.
insert into public.employees (tenant_id, employee_type, full_name, hire_date, status)
values ('ea000000-0000-0000-0000-00000000000a', 'support', 'Auto Numbered', '2026-02-01', 'draft');

select matches(
  (select employee_no from public.employees where full_name = 'Auto Numbered'),
  '^EMP-[0-9]{4}$',
  'omitting employee_no mints one rather than violating NOT NULL');

-- Per tenant, so two schools never collide and neither sees the other's count.
insert into public.employees (tenant_id, employee_type, full_name, hire_date, status)
values ('eb000000-0000-0000-0000-00000000000b', 'support', 'Other Tenant Auto', '2026-02-01', 'draft');

select is(
  (select employee_no from public.employees where full_name = 'Other Tenant Auto'),
  (select employee_no from public.employees where full_name = 'Auto Numbered'),
  'the staff-number sequence is per tenant, so both tenants start at the same number');

-- ---------- Constraints ------------------------------------------------------
select throws_ok(
  $stmt$ update public.employees
         set reporting_manager_id = 'ea400001-0000-0000-0000-00000000000a'
         where id = 'ea400001-0000-0000-0000-00000000000a' $stmt$,
  '23514', null,
  'an employee cannot be their own reporting manager');

select throws_ok(
  $stmt$ insert into public.staff_performance_reviews
           (tenant_id, employee_id, ec_year, rating)
         values ('ea000000-0000-0000-0000-00000000000a',
                 'ea400002-0000-0000-0000-00000000000a', 2018, 7.5) $stmt$,
  '23514', null,
  'a performance rating above five is rejected');

-- ---------- As Tenant A's HR officer -----------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'ef000001-0000-0000-0000-000000000001';

-- THE regression that matters. Naming all thirty-three new columns at once: if
-- any single grant select is missing, this errors rather than returning a row.
select lives_ok(
  $stmt$ select first_name, first_name_am, father_name, father_name_am,
                last_name, last_name_am, gender, date_of_birth, nationality,
                national_id, phone, personal_email, photo_path,
                region, zone, woreda, city, kebele, house_number,
                highest_qualification, major, institution_name,
                graduation_year_ec, languages,
                job_title, department, office_location, campus,
                institutional_email, work_phone, reporting_manager_id,
                probation_status, notice_period_days
         from public.employees $stmt$,
  'every new employees column is readable by authenticated (column-grant regression)');

select is(
  (select job_title from public.employees where employee_no = 'EA-001'),
  'Senior Mathematics Educator', 'HR reads a newly added column''s value');

select is(
  (select count(*)::int from public.employees where tenant_id = 'eb000000-0000-0000-0000-00000000000b'),
  0, 'HR sees no employees from another tenant');

select is(
  (select count(*)::int from public.employee_emergency_contacts),
  1, 'emergency contacts are tenant-scoped');

select is(
  (select count(*)::int from public.employee_documents),
  1, 'employee documents are tenant-scoped');

select is(
  (select count(*)::int from public.employee_qualifications),
  1, 'qualifications are tenant-scoped');

select is(
  (select count(*)::int from public.employee_subjects),
  1, 'teaching specializations are tenant-scoped');

-- A draft is a real row HR can still see; the UI filters it out of headcounts.
select is(
  (select status::text from public.employees where employee_no = 'EA-003'),
  'draft', 'a half-finished registration persists as a draft');

-- ---------- As a teacher: their own record only -------------------------------
set local request.jwt.claim.sub = 'ef000002-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.staff_performance_reviews),
  1, 'a teacher sees exactly one review — their own');

select is(
  (select rating from public.staff_performance_reviews),
  4.5::numeric, 'and it is theirs, not the colleague''s');

select throws_ok(
  $stmt$ insert into public.staff_performance_reviews
           (tenant_id, employee_id, ec_year, rating)
         values ('ea000000-0000-0000-0000-00000000000a',
                 'ea400002-0000-0000-0000-00000000000a', 2016, 5.0) $stmt$,
  '42501', null,
  'a teacher cannot write a performance review');

select is(
  (select count(*)::int from public.employee_emergency_contacts),
  1, 'a teacher sees their own emergency contact');

-- ---------- As an accountant: payroll, but not appraisals ---------------------
-- Deliberate: accountant is in the employees/documents read set because payroll
-- needs the person, and out of the reviews set because pay is not performance.
set local request.jwt.claim.sub = 'ef000005-0000-0000-0000-000000000005';

select is(
  (select count(*)::int from public.staff_performance_reviews),
  0, 'an accountant sees no performance reviews at all');

rollback;
