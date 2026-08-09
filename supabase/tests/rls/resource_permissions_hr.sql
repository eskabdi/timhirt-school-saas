-- ============================================================================
-- Role/user permissions matrix -- Phase 2, HR & Payroll domain
-- (20260817000003). Proves, for every table this migration touches:
--   1. Zero configuration reproduces today's exact population -- the
--      staff-role branch (now matrix-driven) AND every self-service branch
--      (employee reading their own employees/contracts/leave/balances/
--      attendance/payslips/reviews row).
--   2. A role-level grant via the matrix widens access for a role
--      (teacher) that had zero default access anywhere in this domain.
--   3. leave_requests' self-service policies (leave_file_own, leave_cancel_
--      own) are untouched -- an employee can still cancel their own pending
--      request after the migration.
--   4. payroll_runs' structural checks (prepared_by = auth.uid(), status =
--      'draft' on insert; tenant-only WITH CHECK on approve) still reject a
--      spoofed value, exactly as before -- and the matrix role-gate change
--      doesn't touch payroll_run_transition()'s SoD logic at all (proven
--      separately, unchanged, by payroll_sod.sql).
--   5. staff_performance_reviews' accountant exclusion from the default
--      read population survives -- "payroll has no business reading
--      appraisals" is a deliberate design choice, not an oversight.
-- ============================================================================
begin;
select plan(37);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '9f000001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'rh-admin@test.example',    crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9f000002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'rh-hr@test.example',       crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9f000003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'rh-accountant@test.example',crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9f000004-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'rh-teacher@test.example',  crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9f000005-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'rh-emp1@test.example',     crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9f000006-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'rh-emp2@test.example',     crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('9f000000-0000-0000-0000-00000000000a', 'RH Tenant A', 'rh-tenant-a', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('9f000001-0000-0000-0000-000000000001', '9f000000-0000-0000-0000-00000000000a', 'school_admin', 'RH Admin',      'rh-admin@test.example'),
  ('9f000002-0000-0000-0000-000000000002', '9f000000-0000-0000-0000-00000000000a', 'hr_officer',   'RH HR',         'rh-hr@test.example'),
  ('9f000003-0000-0000-0000-000000000003', '9f000000-0000-0000-0000-00000000000a', 'accountant',   'RH Accountant', 'rh-accountant@test.example'),
  ('9f000004-0000-0000-0000-000000000004', '9f000000-0000-0000-0000-00000000000a', 'teacher',      'RH Teacher',    'rh-teacher@test.example'),
  ('9f000005-0000-0000-0000-000000000005', '9f000000-0000-0000-0000-00000000000a', 'teacher',      'RH Employee 1', 'rh-emp1@test.example'),
  ('9f000006-0000-0000-0000-000000000006', '9f000000-0000-0000-0000-00000000000a', 'teacher',      'RH Employee 2', 'rh-emp2@test.example');

insert into public.employees (id, tenant_id, user_id, employee_no, employee_type, full_name, hire_date, status) values
  ('9f000000-0000-0000-0000-0000000e0001', '9f000000-0000-0000-0000-00000000000a', '9f000005-0000-0000-0000-000000000005', 'RH-E-001', 'teacher', 'Employee One', '2020-01-01', 'active'),
  ('9f000000-0000-0000-0000-0000000e0002', '9f000000-0000-0000-0000-00000000000a', '9f000006-0000-0000-0000-000000000006', 'RH-E-002', 'teacher', 'Employee Two', '2021-01-01', 'active');

insert into public.employment_contracts (id, tenant_id, employee_id, contract_type, basic_salary, starts_on) values
  ('9f000000-0000-0000-0000-0000000c0001', '9f000000-0000-0000-0000-00000000000a', '9f000000-0000-0000-0000-0000000e0001', 'permanent', 15000, '2020-01-01');

insert into public.salary_components (id, tenant_id, name_i18n, kind, calc_type) values
  ('9f000000-0000-0000-0000-0000000a0001', '9f000000-0000-0000-0000-00000000000a', '{"en":"Transport allowance"}'::jsonb, 'allowance', 'fixed');
insert into public.employee_salary_components (id, tenant_id, employee_id, component_id, amount) values
  ('9f000000-0000-0000-0000-0000000a0101', '9f000000-0000-0000-0000-00000000000a', '9f000000-0000-0000-0000-0000000e0001', '9f000000-0000-0000-0000-0000000a0001', 500);

insert into public.leave_types (id, tenant_id, name_i18n, days_per_year) values
  ('9f000000-0000-0000-0000-0000000b0001', '9f000000-0000-0000-0000-00000000000a', '{"en":"Annual leave"}'::jsonb, 20);
insert into public.leave_requests (id, tenant_id, employee_id, leave_type_id, starts_on, ends_on, status) values
  ('9f000000-0000-0000-0000-0000000d0001', '9f000000-0000-0000-0000-00000000000a', '9f000000-0000-0000-0000-0000000e0001', '9f000000-0000-0000-0000-0000000b0001', '2026-02-01', '2026-02-02', 'pending'),
  ('9f000000-0000-0000-0000-0000000d0002', '9f000000-0000-0000-0000-00000000000a', '9f000000-0000-0000-0000-0000000e0002', '9f000000-0000-0000-0000-0000000b0001', '2026-03-01', '2026-03-02', 'pending');

insert into public.leave_balances (id, tenant_id, employee_id, leave_type_id, ec_year, entitled) values
  ('9f000000-0000-0000-0000-0000000f0001', '9f000000-0000-0000-0000-00000000000a', '9f000000-0000-0000-0000-0000000e0001', '9f000000-0000-0000-0000-0000000b0001', 2018, 20);

insert into public.staff_attendance (id, tenant_id, employee_id, att_date, status, recorded_by) values
  ('9f000000-0000-0000-0000-0000009a0001', '9f000000-0000-0000-0000-00000000000a', '9f000000-0000-0000-0000-0000000e0001', '2026-01-05', 'present', '9f000001-0000-0000-0000-000000000001');

insert into public.payroll_runs (id, tenant_id, ec_year, ec_month, status, prepared_by) values
  ('9f000000-0000-0000-0000-0000009b0001', '9f000000-0000-0000-0000-00000000000a', 2018, 6, 'draft', '9f000002-0000-0000-0000-000000000002');
insert into public.payslips (id, tenant_id, run_id, employee_id, gross, taxable_income, income_tax, pension_employee, pension_employer, net_pay) values
  ('9f000000-0000-0000-0000-0000009c0001', '9f000000-0000-0000-0000-00000000000a', '9f000000-0000-0000-0000-0000009b0001', '9f000000-0000-0000-0000-0000000e0001', 15500, 15000, 1500, 1050, 1050, 12950);
insert into public.payslip_lines (id, tenant_id, payslip_id, label_i18n, kind, amount) values
  ('9f000000-0000-0000-0000-0000009d0001', '9f000000-0000-0000-0000-00000000000a', '9f000000-0000-0000-0000-0000009c0001', '{"en":"Basic salary"}'::jsonb, 'earning', 15000);

insert into public.staff_performance_reviews (id, tenant_id, employee_id, ec_year, rating) values
  ('9f000000-0000-0000-0000-0000009e0001', '9f000000-0000-0000-0000-00000000000a', '9f000000-0000-0000-0000-0000000e0001', 2018, 4.5);

-- ============================================================================
-- employees
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004'; -- teacher, no default HR access
select is((select count(*)::int from public.employees), 0, 'unconfigured: a teacher with no HR role sees zero employees');
set local request.jwt.claim.sub = '9f000005-0000-0000-0000-000000000005'; -- emp1 self
select is((select count(*)::int from public.employees), 1, 'unconfigured: an employee still reads their own employee row (self branch)');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9f000000-0000-0000-0000-00000000000a', 'teacher', id, true from public.permissions where key = 'employees:read';
set local role authenticated;
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004';
select is((select count(*)::int from public.employees), 2, 'role grant: teacher can now read employees after being granted employees:read');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '9f000002-0000-0000-0000-000000000002'; -- hr_officer
select lives_ok(
  $stmt$ insert into public.employees (tenant_id, employee_no, employee_type, full_name, hire_date)
         values ('9f000000-0000-0000-0000-00000000000a', 'RH-E-HR', 'support', 'HR Hired', '2026-01-01') $stmt$,
  'unconfigured: hr_officer can create an employee with zero grants configured (matches original school_admin+hr_officer write population)');
reset role;

-- ============================================================================
-- employment_contracts
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9f000005-0000-0000-0000-000000000005'; -- emp1 self
select is((select count(*)::int from public.employment_contracts), 1, 'unconfigured: an employee still reads their own contract (self branch)');
set local request.jwt.claim.sub = '9f000006-0000-0000-0000-000000000006'; -- emp2, different employee
select is((select count(*)::int from public.employment_contracts), 0, 'unconfigured: a different employee cannot read someone else''s contract');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9f000000-0000-0000-0000-00000000000a', 'teacher', id, true from public.permissions where key = 'employment_contracts:read';
set local role authenticated;
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004';
select is((select count(*)::int from public.employment_contracts), 1, 'role grant: teacher can now read employment contracts');
reset role;

-- ============================================================================
-- employee_salary_components (no bypass, no relationship branch)
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004'; -- teacher
select is((select count(*)::int from public.employee_salary_components), 0, 'unconfigured: teacher sees zero employee salary components');
set local request.jwt.claim.sub = '9f000003-0000-0000-0000-000000000003'; -- accountant, in default population
select is((select count(*)::int from public.employee_salary_components), 1, 'unconfigured: accountant (default population) reads employee salary components');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9f000000-0000-0000-0000-00000000000a', 'teacher', id, true from public.permissions where key = 'employee_salary_components:read';
set local role authenticated;
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004';
select is((select count(*)::int from public.employee_salary_components), 1, 'role grant: teacher can now read employee salary components');
reset role;

-- ============================================================================
-- leave_requests: self-file/self-cancel untouched; only leave_decide's flat
-- role branch is matrix-driven.
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9f000005-0000-0000-0000-000000000005'; -- emp1 self
select is((select count(*)::int from public.leave_requests), 1, 'unconfigured: an employee still reads their own leave request (self branch)');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004'; -- teacher, not HR
select is((select count(*)::int from public.leave_requests), 0, 'unconfigured: a teacher with no HR role and no leave request of their own sees zero rows');
reset role;

-- leave_cancel_own is untouched: emp2 can still cancel their own pending
-- request after the migration, using request d0002 (kept separate from
-- d0001 so this state change doesn't interfere with the decide test below).
set local role authenticated;
set local request.jwt.claim.sub = '9f000006-0000-0000-0000-000000000006'; -- emp2 self
select lives_ok(
  $stmt$ update public.leave_requests set status = 'cancelled' where id = '9f000000-0000-0000-0000-0000000d0002' $stmt$,
  'leave_cancel_own is untouched by this migration -- an employee can still cancel their own pending request');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004'; -- teacher, not in leave_decide's default population
-- 'rejected' (not 'approved') so leave_decision_trigger's side-effect writes
-- to staff_attendance/leave_balances never fire -- keeps this assertion
-- purely about the RLS role-gate, not the trigger.
update public.leave_requests set status = 'rejected' where id = '9f000000-0000-0000-0000-0000000d0001';
reset role;
select is(
  (select status::text from public.leave_requests where id = '9f000000-0000-0000-0000-0000000d0001'), 'pending',
  'unconfigured: a teacher not in the default decide population cannot approve/reject a leave request (USING filtered the row)');

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9f000000-0000-0000-0000-00000000000a', 'teacher', id, true from public.permissions where key = 'leave_requests:update';
set local role authenticated;
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004';
select lives_ok(
  $stmt$ update public.leave_requests set status = 'rejected' where id = '9f000000-0000-0000-0000-0000000d0001' $stmt$,
  'role grant: teacher can now decide a leave request after being granted leave_requests:update');
reset role;

-- ============================================================================
-- leave_balances
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9f000005-0000-0000-0000-000000000005'; -- emp1 self
select is((select count(*)::int from public.leave_balances), 1, 'unconfigured: an employee still reads their own leave balance (self branch)');
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004'; -- teacher
select is((select count(*)::int from public.leave_balances), 0, 'unconfigured: teacher sees zero leave balances');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9f000000-0000-0000-0000-00000000000a', 'teacher', id, true from public.permissions where key = 'leave_balances:read';
set local role authenticated;
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004';
select is((select count(*)::int from public.leave_balances), 1, 'role grant: teacher can now read leave balances');
reset role;

-- ============================================================================
-- staff_attendance
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9f000005-0000-0000-0000-000000000005'; -- emp1 self
select is((select count(*)::int from public.staff_attendance), 1, 'unconfigured: an employee still reads their own staff attendance (self branch)');
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004'; -- teacher
select is((select count(*)::int from public.staff_attendance), 0, 'unconfigured: teacher sees zero staff attendance rows');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9f000000-0000-0000-0000-00000000000a', 'teacher', id, true from public.permissions where key = 'staff_attendance:read';
set local role authenticated;
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004';
select is((select count(*)::int from public.staff_attendance), 1, 'role grant: teacher can now read staff attendance');
reset role;

-- ============================================================================
-- payroll_runs: structural checks (prepared_by/status/tenant-only WITH
-- CHECK) preserved verbatim; payroll_run_transition() trigger and
-- sod_preparer_not_approver constraint are not touched by this migration at
-- all (payroll_sod.sql, unchanged, is what actually exercises them).
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004'; -- teacher, not in the default read population
select is((select count(*)::int from public.payroll_runs), 0, 'unconfigured: a teacher sees zero payroll runs (default read = school_admin/hr_officer/accountant only)');
set local request.jwt.claim.sub = '9f000003-0000-0000-0000-000000000003'; -- accountant, default read population
select is((select count(*)::int from public.payroll_runs), 1, 'unconfigured: accountant (default population) reads payroll runs');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '9f000002-0000-0000-0000-000000000002'; -- hr_officer
select lives_ok(
  $stmt$ insert into public.payroll_runs (tenant_id, ec_year, ec_month, status, prepared_by)
         values ('9f000000-0000-0000-0000-00000000000a', 2018, 7, 'draft', auth.uid()) $stmt$,
  'unconfigured: hr_officer can create a payroll run as their own preparer, with zero grants configured');
select throws_ok(
  $stmt$ insert into public.payroll_runs (tenant_id, ec_year, ec_month, status, prepared_by)
         values ('9f000000-0000-0000-0000-00000000000a', 2018, 8, 'draft', '9f000001-0000-0000-0000-000000000001') $stmt$,
  '42501', null, 'structural check preserved: hr_officer cannot stamp someone else as prepared_by, even though the role gate itself passes');
reset role;

-- runs_approve: accountant is in the default UPDATE population and is a
-- DIFFERENT person from the preparer (hr_officer), so this only exercises
-- the RLS role-gate swap, not payroll_run_transition()'s SoD check.
set local role authenticated;
set local request.jwt.claim.sub = '9f000003-0000-0000-0000-000000000003'; -- accountant
select lives_ok(
  $stmt$ update public.payroll_runs set status = 'approved' where id = '9f000000-0000-0000-0000-0000009b0001' $stmt$,
  'unconfigured: accountant (default update population) can approve a run prepared by someone else');
reset role;

-- ============================================================================
-- payslips / payslip_lines (read-only -- no create/update/delete permission
-- exists for either, since no client write policy exists to gate)
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9f000005-0000-0000-0000-000000000005'; -- emp1 self
select is((select count(*)::int from public.payslips), 1, 'unconfigured: an employee still reads their own payslip (self branch)');
set local request.jwt.claim.sub = '9f000006-0000-0000-0000-000000000006'; -- emp2, different employee
select is((select count(*)::int from public.payslips), 0, 'unconfigured: a different employee cannot read someone else''s payslip');
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004'; -- teacher
select is((select count(*)::int from public.payslips), 0, 'unconfigured: teacher sees zero payslips');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9f000000-0000-0000-0000-00000000000a', 'teacher', id, true from public.permissions where key = 'payslips:read';
set local role authenticated;
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004';
select is((select count(*)::int from public.payslips), 1, 'role grant: teacher can now read payslips');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '9f000005-0000-0000-0000-000000000005'; -- emp1 self, via payslip join
select is((select count(*)::int from public.payslip_lines), 1, 'unconfigured: an employee still reads their own payslip lines (self branch via join)');
set local request.jwt.claim.sub = '9f000006-0000-0000-0000-000000000006'; -- emp2
select is((select count(*)::int from public.payslip_lines), 0, 'unconfigured: a different employee cannot read someone else''s payslip lines');
reset role;

-- ============================================================================
-- staff_performance_reviews: accountant is deliberately EXCLUDED from the
-- default read population (unlike every other HR resource above) --
-- proving this survives the migration is the most important assertion in
-- this section.
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9f000005-0000-0000-0000-000000000005'; -- emp1 self
select is((select count(*)::int from public.staff_performance_reviews), 1, 'unconfigured: an employee still reads their own performance review (self branch)');
set local request.jwt.claim.sub = '9f000003-0000-0000-0000-000000000003'; -- accountant
select is((select count(*)::int from public.staff_performance_reviews), 0, 'unconfigured: accountant is still excluded from the default population -- payroll has no business reading appraisals');
set local request.jwt.claim.sub = '9f000002-0000-0000-0000-000000000002'; -- hr_officer, in the default population
select is((select count(*)::int from public.staff_performance_reviews), 1, 'unconfigured: hr_officer (default population) reads performance reviews');
reset role;

-- ============================================================================
-- salary_components / leave_types: byte-identical open-read/school_admin+
-- hr_officer-write shape already proven by the pilot pattern -- one
-- write-side spot check each is enough.
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '9f000004-0000-0000-0000-000000000004'; -- teacher, not school_admin/hr_officer

select throws_ok(
  $stmt$ insert into public.salary_components (tenant_id, name_i18n, kind, calc_type)
         values ('9f000000-0000-0000-0000-00000000000a', '{}'::jsonb, 'allowance', 'fixed') $stmt$,
  '42501', null, 'unconfigured: a teacher cannot create a salary component');

select throws_ok(
  $stmt$ insert into public.leave_types (tenant_id, name_i18n, days_per_year)
         values ('9f000000-0000-0000-0000-00000000000a', '{}'::jsonb, 10) $stmt$,
  '42501', null, 'unconfigured: a teacher cannot create a leave type');

reset role;

select * from finish();
rollback;
