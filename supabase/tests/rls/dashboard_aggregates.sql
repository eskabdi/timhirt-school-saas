-- ============================================================================
-- Dashboard aggregate functions.
--
-- Every one of these is SECURITY DEFINER, which means RLS is switched off
-- inside them and the tenant scope is something the function body has to get
-- right by hand. A missed `tenant_id =` in one of them is a silent cross-tenant
-- leak that no policy will catch, so tenant isolation is asserted per function
-- rather than assumed from the migration reading correctly.
--
-- The role gates are checked the same way: a teacher must get zeros from the
-- finance card, not an error, and a parent must get zeros from all of it.
-- ============================================================================
begin;
select plan(22);

-- ---------- Fixtures ---------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'd0000001-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'dash-admin-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd0000002-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'dash-admin-b@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd0000003-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'dash-teacher-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd0000004-0000-0000-0000-000000000004',
   'authenticated', 'authenticated', 'dash-parent-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('da000000-0000-0000-0000-00000000000a', 'Dash Tenant A', 'dash-tenant-a', 'active', 'premium'),
  ('db000000-0000-0000-0000-00000000000b', 'Dash Tenant B', 'dash-tenant-b', 'active', 'premium');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('d0000001-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-00000000000a', 'school_admin', 'Dash Admin A', 'dash-admin-a@test.example'),
  ('d0000002-0000-0000-0000-000000000002', 'db000000-0000-0000-0000-00000000000b', 'school_admin', 'Dash Admin B', 'dash-admin-b@test.example'),
  ('d0000003-0000-0000-0000-000000000003', 'da000000-0000-0000-0000-00000000000a', 'teacher',      'Dash Teacher A', 'dash-teacher-a@test.example'),
  ('d0000004-0000-0000-0000-000000000004', 'da000000-0000-0000-0000-00000000000a', 'parent',       'Dash Parent A', 'dash-parent-a@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('da100000-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 2018, '2025-09-11', '2026-09-10', 'active'),
  ('da100001-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 2017, '2024-09-11', '2025-09-10', 'closed'),
  ('db100000-0000-0000-0000-00000000000b', 'db000000-0000-0000-0000-00000000000b', 2018, '2025-09-11', '2026-09-10', 'active');

insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('da200000-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'da100000-0000-0000-0000-00000000000a', 'Grade 5', 'A'),
  ('da200001-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'da100001-0000-0000-0000-00000000000a', 'Grade 4', 'A'),
  ('db200000-0000-0000-0000-00000000000b', 'db000000-0000-0000-0000-00000000000b', 'db100000-0000-0000-0000-00000000000b', 'Grade 5', 'B');

-- Tenant A: three active students in the current year, one in the prior year,
-- one graduated. Tenant B gets five, so any missing tenant filter shows up as
-- an inflated count rather than as an equal one.
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender, ethnicity, status) values
  ('da300001-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'da200000-0000-0000-0000-00000000000a', 'DA-001', 'Abebe',  'Bekele',  '2015-01-01', 'male',   'oromo',  'active'),
  ('da300002-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'da200000-0000-0000-0000-00000000000a', 'DA-002', 'Chaltu', 'Girma',   '2015-01-02', 'female', 'amhara', 'active'),
  ('da300003-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'da200000-0000-0000-0000-00000000000a', 'DA-003', 'Sara',   'Tesfaye', '2015-01-03', 'female', null,     'active'),
  -- Deliberately a group outside the largest handful. An earlier version of the
  -- constraint enumerated only the fourteen biggest and would have rejected
  -- this row — which is backwards for a column whose purpose is finding
  -- under-served communities.
  ('da300004-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'da200001-0000-0000-0000-00000000000a', 'DA-004', 'Yonas',  'Haile',   '2014-01-01', 'male',   'gumuz',  'active'),
  ('da300005-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'da200000-0000-0000-0000-00000000000a', 'DA-005', 'Meron',  'Assefa',  '2013-01-01', 'female', 'gurage', 'graduated'),
  ('db300001-0000-0000-0000-00000000000b', 'db000000-0000-0000-0000-00000000000b', 'db200000-0000-0000-0000-00000000000b', 'DB-001', 'Bereket', 'Solomon', '2015-01-01', 'male',   'somali', 'active'),
  ('db300002-0000-0000-0000-00000000000b', 'db000000-0000-0000-0000-00000000000b', 'db200000-0000-0000-0000-00000000000b', 'DB-002', 'Hanna',   'Mekonnen','2015-01-01', 'female', 'somali', 'active');

-- The ethnicity constraint checks shape, not membership: the list of groups
-- lives in src/lib/ethnic-groups.ts so a school can be offered a new one
-- without a migration. Shape is still enforced, so the column cannot become a
-- dumping ground for free text.
select throws_ok(
  $stmt$ insert into public.students
           (tenant_id, class_id, admission_no, first_name, last_name,
            date_of_birth, gender, ethnicity)
         values ('da000000-0000-0000-0000-00000000000a',
                 'da200000-0000-0000-0000-00000000000a', 'DA-BAD', 'Bad', 'Row',
                 '2015-01-01', 'male', 'Not A Key!') $stmt$,
  '23514', null,
  'a malformed ethnicity value is still rejected');

insert into public.guardians (tenant_id, student_id, relationship, phone) values
  ('da000000-0000-0000-0000-00000000000a', 'da300001-0000-0000-0000-00000000000a', 'mother', '+251911000001'),
  ('da000000-0000-0000-0000-00000000000a', 'da300002-0000-0000-0000-00000000000a', 'father', '+251911000002'),
  ('db000000-0000-0000-0000-00000000000b', 'db300001-0000-0000-0000-00000000000b', 'mother', '+251911000003');

insert into public.employees (id, tenant_id, employee_no, employee_type, full_name, hire_date, status) values
  ('da400001-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'DA-E-01', 'teacher', 'Kebede Alemu', '2020-01-01', 'active'),
  ('da400002-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'DA-E-02', 'teacher', 'Tigist Bekele', '2020-01-01', 'terminated'),
  ('db400001-0000-0000-0000-00000000000b', 'db000000-0000-0000-0000-00000000000b', 'DB-E-01', 'teacher', 'Marta Tesfaye', '2020-01-01', 'active');

-- 2026-07-20 is a Monday. attendance_guard() overwrites recorded_by with
-- auth.uid() rather than trusting the client, so a claim has to be in place
-- before these inserts or the column lands NULL and the not-null bites. Still
-- the setup role here, so RLS is not in play yet.
set local request.jwt.claim.sub = 'd0000001-0000-0000-0000-000000000001';

insert into public.attendance (tenant_id, student_id, class_id, attendance_date, status, recorded_by) values
  ('da000000-0000-0000-0000-00000000000a', 'da300001-0000-0000-0000-00000000000a', 'da200000-0000-0000-0000-00000000000a', '2026-07-20', 'present',  'd0000001-0000-0000-0000-000000000001'),
  ('da000000-0000-0000-0000-00000000000a', 'da300002-0000-0000-0000-00000000000a', 'da200000-0000-0000-0000-00000000000a', '2026-07-20', 'late',     'd0000001-0000-0000-0000-000000000001'),
  ('da000000-0000-0000-0000-00000000000a', 'da300003-0000-0000-0000-00000000000a', 'da200000-0000-0000-0000-00000000000a', '2026-07-20', 'half_day', 'd0000001-0000-0000-0000-000000000001'),
  ('da000000-0000-0000-0000-00000000000a', 'da300001-0000-0000-0000-00000000000a', 'da200000-0000-0000-0000-00000000000a', '2026-07-21', 'absent',   'd0000001-0000-0000-0000-000000000001'),
  ('da000000-0000-0000-0000-00000000000a', 'da300002-0000-0000-0000-00000000000a', 'da200000-0000-0000-0000-00000000000a', '2026-07-21', 'present',  'd0000001-0000-0000-0000-000000000001'),
  ('da000000-0000-0000-0000-00000000000a', 'da300003-0000-0000-0000-00000000000a', 'da200000-0000-0000-0000-00000000000a', '2026-07-21', 'present',  'd0000001-0000-0000-0000-000000000001'),
  -- Tenant B records on the same day; it must never reach Tenant A's chart.
  ('db000000-0000-0000-0000-00000000000b', 'db300001-0000-0000-0000-00000000000b', 'db200000-0000-0000-0000-00000000000b', '2026-07-20', 'present',  'd0000002-0000-0000-0000-000000000002'),
  ('db000000-0000-0000-0000-00000000000b', 'db300002-0000-0000-0000-00000000000b', 'db200000-0000-0000-0000-00000000000b', '2026-07-20', 'present',  'd0000002-0000-0000-0000-000000000002');

-- DA-001 is absent 1 of 2 recorded days = 50%, comfortably over any threshold.
-- DA-002 and DA-003 are never absent, so they must not appear at all.

insert into public.academic_terms (id, tenant_id, academic_year_id, name_i18n, term_no, starts_on, ends_on) values
  ('da500000-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'da100000-0000-0000-0000-00000000000a', '{"en":"Term 1"}', 1, '2025-09-11', '2026-01-31');

insert into public.exams (id, tenant_id, academic_term_id, name_i18n, max_score) values
  ('da600000-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'da500000-0000-0000-0000-00000000000a', '{"en":"Midterm"}', 100);

insert into public.subjects (id, tenant_id, name_i18n, code) values
  ('da700000-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', '{"en":"Maths"}', 'MATH');

insert into public.grading_scales (id, tenant_id, name, is_default) values
  ('da800000-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'Default', true);

insert into public.grade_bands (scale_id, tenant_id, letter, min_percent, gpa_points, sort_order) values
  ('da800000-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'A', 90, 4.00, 1),
  ('da800000-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'B', 80, 3.00, 2),
  ('da800000-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'C', 60, 2.00, 3),
  ('da800000-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'F',  0, 0.00, 4);

-- 95 -> A -> 4.0, 65 -> C -> 2.0, 30 -> F -> 0.0. Lowest-GPA must order
-- DA-003 (0.0) before DA-002 (2.0) before DA-001 (4.0).
insert into public.grades (tenant_id, student_id, exam_id, subject_id, score, entered_by) values
  ('da000000-0000-0000-0000-00000000000a', 'da300001-0000-0000-0000-00000000000a', 'da600000-0000-0000-0000-00000000000a', 'da700000-0000-0000-0000-00000000000a', 95, 'd0000001-0000-0000-0000-000000000001'),
  ('da000000-0000-0000-0000-00000000000a', 'da300002-0000-0000-0000-00000000000a', 'da600000-0000-0000-0000-00000000000a', 'da700000-0000-0000-0000-00000000000a', 65, 'd0000001-0000-0000-0000-000000000001'),
  ('da000000-0000-0000-0000-00000000000a', 'da300003-0000-0000-0000-00000000000a', 'da600000-0000-0000-0000-00000000000a', 'da700000-0000-0000-0000-00000000000a', 30, 'd0000001-0000-0000-0000-000000000001');

insert into public.fee_structures (id, tenant_id, name_i18n, amount, billing_cycle) values
  ('da900000-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', '{"en":"Tuition"}', 1000, 'monthly'),
  ('db900000-0000-0000-0000-00000000000b', 'db000000-0000-0000-0000-00000000000b', '{"en":"Tuition"}', 1000, 'monthly');

insert into public.invoice_headers (id, tenant_id, student_id, due_date) values
  ('dac00001-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'da300001-0000-0000-0000-00000000000a', '2026-01-31'),
  ('dac00002-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'da300002-0000-0000-0000-00000000000a', '2026-12-31'),
  ('dbc00001-0000-0000-0000-00000000000b', 'db000000-0000-0000-0000-00000000000b', 'db300001-0000-0000-0000-00000000000b', '2026-01-31');

insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, amount_paid, due_date, status, invoice_header_id) values
  -- Past due, part paid: 400 outstanding must land in "overdue", not 1000.
  ('daa00001-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'da300001-0000-0000-0000-00000000000a', 'da900000-0000-0000-0000-00000000000a', 1000, 600, '2026-01-31', 'partial', 'dac00001-0000-0000-0000-00000000000a'),
  -- Not yet due: belongs in "to be collected".
  ('daa00002-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a', 'da300002-0000-0000-0000-00000000000a', 'da900000-0000-0000-0000-00000000000a', 1000, 0,   '2026-12-31', 'pending', 'dac00002-0000-0000-0000-00000000000a'),
  ('dbb00001-0000-0000-0000-00000000000b', 'db000000-0000-0000-0000-00000000000b', 'db300001-0000-0000-0000-00000000000b', 'db900000-0000-0000-0000-00000000000b', 5000, 0,   '2026-01-31', 'pending', 'dbc00001-0000-0000-0000-00000000000b');

insert into public.payments (tenant_id, invoice_id, amount, provider, status, paid_at) values
  ('da000000-0000-0000-0000-00000000000a', 'dac00001-0000-0000-0000-00000000000a', 600, 'chapa', 'succeeded', '2026-02-10T09:00:00Z'),
  -- A failed attempt must not be counted as collected.
  ('da000000-0000-0000-0000-00000000000a', 'dac00002-0000-0000-0000-00000000000a', 250, 'chapa', 'failed',    '2026-02-11T09:00:00Z'),
  ('db000000-0000-0000-0000-00000000000b', 'dbc00001-0000-0000-0000-00000000000b', 999, 'chapa', 'succeeded', '2026-02-10T09:00:00Z');

insert into public.admission_applications (tenant_id, applicant_name, date_of_birth, guardian_name, stage) values
  ('da000000-0000-0000-0000-00000000000a', 'Applicant One',   '2018-01-01', 'Guardian One',   'applied'),
  ('da000000-0000-0000-0000-00000000000a', 'Applicant Two',   '2018-01-01', 'Guardian Two',   'applied'),
  ('da000000-0000-0000-0000-00000000000a', 'Applicant Three', '2018-01-01', 'Guardian Three', 'shortlisted'),
  ('db000000-0000-0000-0000-00000000000b', 'Applicant B',     '2018-01-01', 'Guardian B',     'applied');

-- An application carrying an ethnicity, ready to enrol. The whole point of
-- collecting it on the application is that enrolment carries it onto the
-- student row; before 20260729000003 the RPC copied names, date of birth and
-- gender only, so the answer the family gave was silently dropped at the exact
-- moment it became a student record.
insert into public.admission_applications (
  id, tenant_id, applicant_name, date_of_birth, guardian_name, stage, ethnicity,
  applicant_first_name, applicant_first_name_am,
  applicant_middle_name, applicant_middle_name_am,
  applicant_last_name, applicant_last_name_am,
  gender, guardian_relationship, guardian_phone
) values (
  'dac00001-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-00000000000a',
  'Nyakuoth Deng', '2016-05-05', 'Deng Bol', 'registered', 'nuer',
  'Nyakuoth', 'ንያኩኦት', 'Deng', 'ደንግ', 'Bol', 'ቦል',
  'female', 'father', '+251911000009'
);

-- A national holiday inside the test week, to prove teaching days skip it.
insert into public.calendar_events (tenant_id, event_date, name_i18n, event_type) values
  ('da000000-0000-0000-0000-00000000000a', '2026-07-22', '{"en":"Test Holiday"}', 'national');

-- ---------- As Tenant A's school_admin ---------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'd0000001-0000-0000-0000-000000000001';

select is(
  (public.dashboard_overview(null) ->> 'students')::int, 4,
  'overview counts only Tenant A active students (graduated excluded, Tenant B excluded)');

select is(
  (public.dashboard_overview('da100000-0000-0000-0000-00000000000a') ->> 'students')::int, 3,
  'overview academic-year filter drops the student enrolled in the prior year');

select is(
  (public.dashboard_overview(null) ->> 'staff')::int, 1,
  'overview counts only active employees of Tenant A');

select is(
  (public.dashboard_overview(null) ->> 'parents')::int, 2,
  'overview counts only guardians of Tenant A students');

-- Three of the four active students have an ethnicity; the fourth is bucketed
-- as 'unrecorded' rather than dropped, so the pie sums to the headline count.
select is(
  (select sum((e ->> 'count')::int)::int
   from jsonb_array_elements(public.dashboard_overview(null) -> 'by_ethnicity') e),
  4, 'ethnicity slices sum to the active student count (nulls bucketed)');

select is(
  (select (e ->> 'count')::int
   from jsonb_array_elements(public.dashboard_overview(null) -> 'by_ethnicity') e
   where e ->> 'key' = 'unrecorded'),
  1, 'a student with no ethnicity recorded lands in the unrecorded bucket');

-- The reason the constraint does not enumerate groups: a smaller community has
-- to show up as itself, not folded into "other", or the breakdown cannot do the
-- job it exists for.
select is(
  (select (e ->> 'count')::int
   from jsonb_array_elements(public.dashboard_overview(null) -> 'by_ethnicity') e
   where e ->> 'key' = 'gumuz'),
  1, 'a minority group appears as its own slice rather than as other');

-- 2026-07-19 is a Sunday, so the week runs Sun..Sat.
select is(
  (select present from public.dashboard_attendance_week('2026-07-19') where day = '2026-07-20'),
  2, 'attendance week counts a late arrival as present, and excludes Tenant B');

select is(
  (select half_day from public.dashboard_attendance_week('2026-07-19') where day = '2026-07-20'),
  1, 'attendance week reports half_day as its own series');

select is(
  (select absent from public.dashboard_attendance_week('2026-07-19') where day = '2026-07-21'),
  1, 'attendance week counts absences on the right day');

-- dashboard_teaching_days takes a tenant id as an argument, so calling it
-- directly would be a cross-tenant read. It is revoked from authenticated and
-- reached only through the definer functions that pass the caller's own tenant.
select throws_ok(
  $stmt$ select public.dashboard_teaching_days(
           'db000000-0000-0000-0000-00000000000b', '2026-07-19', '2026-07-25') $stmt$,
  '42501',
  'permission denied for function dashboard_teaching_days',
  'the tenant-argument helper is not callable directly by a client');

-- Reaches teaching-day counting through its caller. Sun 19 is excluded and
-- Wed 22 is a national holiday, leaving Mon, Tue, Thu, Fri, Sat = 5 days over
-- 4 active students = 20 expected, against 6 rows actually recorded.
-- Without the holiday skip this would read 18, not 14.
select is(
  public.dashboard_missing_attendance('2026-07-19', '2026-07-25'),
  14, 'missing attendance skips Sunday and the national holiday');

select is(
  (select count(*)::int from public.dashboard_high_absence('2026-07-01', '2026-07-31', 10, 10)),
  1, 'only the student over the absence threshold is returned');

select is(
  (select admission_no from public.dashboard_high_absence('2026-07-01', '2026-07-31', 10, 10)),
  'DA-001', 'high absence names the right student');

select is(
  (select array_agg(admission_no order by cgpa)
   from public.dashboard_lowest_gpa(10)),
  array['DA-003', 'DA-002', 'DA-001'],
  'lowest GPA orders by the grading scale''s points, worst first');

select is(
  (public.dashboard_billing('2026-01-01', '2026-12-31') ->> 'collected')::numeric,
  600::numeric, 'billing counts succeeded payments only, and only this tenant''s');

select is(
  (public.dashboard_billing('2026-01-01', '2026-12-31') ->> 'overdue')::numeric,
  400::numeric, 'overdue is the outstanding balance, not the invoice face value');

-- ---------- Enrolment carries ethnicity across -------------------------------
select lives_ok(
  $stmt$ select public.enroll_admission_application(
           'dac00001-0000-0000-0000-00000000000a',
           'da200000-0000-0000-0000-00000000000a') $stmt$,
  'an application at the registered stage enrols');

select is(
  (select s.ethnicity from public.students s
   join public.admission_applications a on a.converted_student_id = s.id
   where a.id = 'dac00001-0000-0000-0000-00000000000a'),
  'nuer',
  'enrolment copies the ethnicity the family declared onto the student row');

-- And it reaches the chart: the enrolled student is now a fifth active student
-- in the tenant, showing as their own slice.
select is(
  (select (e ->> 'count')::int
   from jsonb_array_elements(public.dashboard_overview(null) -> 'by_ethnicity') e
   where e ->> 'key' = 'nuer'),
  1, 'the enrolled student appears in the ethnicity breakdown');

-- ---------- Role gates -------------------------------------------------------
-- A teacher legitimately sees the attendance cards, so the finance card has to
-- return zeros rather than throwing — the dashboard renders either way.
set local request.jwt.claim.sub = 'd0000003-0000-0000-0000-000000000003';

select is(
  (public.dashboard_billing('2026-01-01', '2026-12-31') ->> 'collected')::numeric,
  0::numeric, 'a teacher gets zeroed finance figures rather than an error');

rollback;
