-- ============================================================================
-- Regression for the on-behalf-of leave filing fix
-- (20260821000007_leave_file_on_behalf.sql). leave_file_own used to be the
-- ONLY insert policy on leave_requests, so an employee with no portal
-- login had no way to get leave on file. leave_file_on_behalf adds a
-- second, additive insert policy: school_admin, or a caller with the
-- leave_requests:create permission (hr_officer by default), can file a
-- pending leave request for any employee in their own tenant -- for an
-- employee with no auth.users identity at all, not just one who has an
-- account but didn't file it themselves. leave_file_own itself must still
-- behave exactly as before (self-filing only), and filed_by must land
-- correctly and not be spoofable by either path.
-- ============================================================================
begin;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '99981111-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'admin-lfb@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99981111-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'hr-lfb@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99981111-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'teacher-lfb@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99981111-0000-0000-0000-000000000004',
   'authenticated', 'authenticated', 'selfemp-lfb@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('99980000-0000-0000-0000-000000000001', 'LFB Tenant P', 'rls-test-lfb-p', 'active', 'premium'),
  ('99980000-0000-0000-0000-000000000002', 'LFB Tenant Q', 'rls-test-lfb-q', 'active', 'premium');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('99981111-0000-0000-0000-000000000001', '99980000-0000-0000-0000-000000000001', 'school_admin', 'LFB Admin', 'admin-lfb@test.example'),
  ('99981111-0000-0000-0000-000000000002', '99980000-0000-0000-0000-000000000001', 'hr_officer', 'LFB HR', 'hr-lfb@test.example'),
  ('99981111-0000-0000-0000-000000000003', '99980000-0000-0000-0000-000000000001', 'teacher', 'LFB Teacher', 'teacher-lfb@test.example'),
  ('99981111-0000-0000-0000-000000000004', '99980000-0000-0000-0000-000000000001', 'teacher', 'LFB Self Employee', 'selfemp-lfb@test.example');

-- emp1: has NO auth.users identity at all -- exactly the case the audit
-- finding cited ("a QA employee with no auth.users identity").
-- emp2 (self-employee): DOES have a login, linked to user 99981111-...004.
-- emp-other-tenant: belongs to tenant Q, for the cross-tenant rejection test.
insert into public.employees (id, tenant_id, employee_no, employee_type, full_name, hire_date, status) values
  ('99982222-0000-0000-0000-000000000001', '99980000-0000-0000-0000-000000000001', 'LFB-E-001', 'teacher', 'NoLogin Employee', '2024-01-01', 'active'),
  ('99982222-0000-0000-0000-000000000002', '99980000-0000-0000-0000-000000000001', 'LFB-E-002', 'teacher', 'Self Employee', '2024-01-01', 'active'),
  ('99982222-0000-0000-0000-000000000009', '99980000-0000-0000-0000-000000000002', 'LFB-E-Q01', 'teacher', 'Other Tenant', '2024-01-01', 'active');
update public.employees set user_id = '99981111-0000-0000-0000-000000000004' where id = '99982222-0000-0000-0000-000000000002';

insert into public.leave_types (id, tenant_id, name_i18n, days_per_year) values
  ('99983333-0000-0000-0000-000000000001', '99980000-0000-0000-0000-000000000001', '{"en":"Annual leave"}'::jsonb, 20);

-- ---------- 1: school_admin files on behalf of an employee with NO login --
set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000001'; -- school_admin

select lives_ok(
  $$ insert into public.leave_requests (tenant_id, employee_id, leave_type_id, starts_on, ends_on, status)
     values ('99980000-0000-0000-0000-000000000001', '99982222-0000-0000-0000-000000000001',
             '99983333-0000-0000-0000-000000000001', '2026-02-01', '2026-02-03', 'pending') $$,
  'school_admin can file a pending leave request for an employee with no auth.users identity'
);
select is(
  (select filed_by from public.leave_requests where employee_id = '99982222-0000-0000-0000-000000000001'),
  '99981111-0000-0000-0000-000000000001'::uuid,
  'filed_by defaults to the actual filer (school_admin), not the employee'
);
select is(
  (select status::text from public.leave_requests where employee_id = '99982222-0000-0000-0000-000000000001'),
  'pending',
  'the on-behalf-of request is inserted as pending like any other'
);

reset role;

-- ---------- 2: hr_officer (leave_requests:create via default grant) can too
set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000002'; -- hr_officer

select lives_ok(
  $$ insert into public.leave_requests (tenant_id, employee_id, leave_type_id, starts_on, ends_on, status)
     values ('99980000-0000-0000-0000-000000000001', '99982222-0000-0000-0000-000000000002',
             '99983333-0000-0000-0000-000000000001', '2026-03-01', '2026-03-02', 'pending') $$,
  'hr_officer (leave_requests:create grant) can file on behalf of an employee who DOES have a login'
);

reset role;

-- ---------- 3: employee's OWN leave history shows the HR-filed request ----
set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000004'; -- the employee themselves (emp2's login)

select is(
  (select count(*)::int from public.leave_requests where employee_id = '99982222-0000-0000-0000-000000000002'),
  1,
  'the request filed by HR on the employee''s behalf shows up in the employee''s own leave history'
);

reset role;

-- ---------- 4: a plain teacher (no permission, not school_admin) cannot ---
set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000003'; -- teacher, no leave_requests:create

select throws_ok(
  $$ insert into public.leave_requests (tenant_id, employee_id, leave_type_id, starts_on, ends_on, status)
     values ('99980000-0000-0000-0000-000000000001', '99982222-0000-0000-0000-000000000001',
             '99983333-0000-0000-0000-000000000001', '2026-04-01', '2026-04-02', 'pending') $$,
  '42501', null,
  'a teacher with no leave_requests:create grant and no school_admin role cannot file on behalf of anyone'
);

-- ---------- 5: leave_file_own is untouched -- self-filing still works -----
set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000004'; -- emp2's own login

select lives_ok(
  $$ insert into public.leave_requests (tenant_id, employee_id, leave_type_id, starts_on, ends_on, status)
     values ('99980000-0000-0000-0000-000000000001', '99982222-0000-0000-0000-000000000002',
             '99983333-0000-0000-0000-000000000001', '2026-06-01', '2026-06-02', 'pending') $$,
  'leave_file_own is untouched: an employee can still self-file exactly as before'
);
select is(
  (select filed_by from public.leave_requests where employee_id = '99982222-0000-0000-0000-000000000002' and starts_on = '2026-06-01'),
  '99981111-0000-0000-0000-000000000004'::uuid,
  'a self-filed request stamps filed_by = the employee''s own auth uid'
);

select throws_ok(
  $$ insert into public.leave_requests (tenant_id, employee_id, leave_type_id, starts_on, ends_on, status)
     values ('99980000-0000-0000-0000-000000000001', '99982222-0000-0000-0000-000000000001',
             '99983333-0000-0000-0000-000000000001', '2026-07-01', '2026-07-02', 'pending') $$,
  '42501', null,
  'leave_file_own is untouched: an employee still cannot self-file a request naming a DIFFERENT employee_id'
);

reset role;

-- ---------- 6: cross-tenant employee_id is rejected -----------------------
set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000001'; -- school_admin, tenant P

select throws_ok(
  $$ insert into public.leave_requests (tenant_id, employee_id, leave_type_id, starts_on, ends_on, status)
     values ('99980000-0000-0000-0000-000000000001', '99982222-0000-0000-0000-000000000009',
             '99983333-0000-0000-0000-000000000001', '2026-08-01', '2026-08-02', 'pending') $$,
  '42501', null,
  'school_admin cannot file on behalf of an employee belonging to a different tenant'
);

-- ---------- 7: filed_by cannot be spoofed to a different user -------------
select throws_ok(
  $$ insert into public.leave_requests (tenant_id, employee_id, leave_type_id, starts_on, ends_on, status, filed_by)
     values ('99980000-0000-0000-0000-000000000001', '99982222-0000-0000-0000-000000000001',
             '99983333-0000-0000-0000-000000000001', '2026-09-01', '2026-09-02', 'pending',
             '99981111-0000-0000-0000-000000000002') $$,
  '42501', null,
  'filed_by cannot be spoofed to a different user''s id, even by school_admin'
);

reset role;

select * from finish();
rollback;
