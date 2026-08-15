-- ============================================================================
-- Regression for the suspended-tenant-lockout fix
-- (20260821000002_suspended_tenant_lockout.sql). A suspended tenant's own
-- school_admin must lose read AND write access to tenant-scoped tables via
-- get_tenant_id_for_user() returning NULL; reactivating the tenant must
-- restore access with no other change.
-- ============================================================================
begin;
select plan(6);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'admin-susp@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('cccccccc-0000-0000-0000-000000000003', 'Tenant C', 'rls-test-tenant-c', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('33333333-3333-3333-3333-333333333333', 'cccccccc-0000-0000-0000-000000000003', 'school_admin', 'Admin C', 'admin-susp@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('cccc1111-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003', 2018, '2025-09-11', '2026-09-10', 'active');

insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('cccc2222-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003', 'cccc1111-0000-0000-0000-000000000003', 'Grade 5', 'A');

insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('cccc3333-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003', 'cccc2222-0000-0000-0000-000000000003', 'ADM-C-001', 'Dawit', 'Tesema', '2015-01-01', 'male');

-- ---------- Baseline: active tenant, access works ----------------------------
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select is(public.get_tenant_id_for_user('33333333-3333-3333-3333-333333333333'::uuid),
  'cccccccc-0000-0000-0000-000000000003'::uuid, 'active tenant: get_tenant_id_for_user returns real tenant_id');

select is((select count(*) from public.students)::int, 1, 'active tenant: school_admin can read own student');

reset role;

-- ---------- Suspend the tenant -------------------------------------------
update public.tenants set status = 'suspended' where id = 'cccccccc-0000-0000-0000-000000000003';

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select is(public.get_tenant_id_for_user('33333333-3333-3333-3333-333333333333'::uuid),
  null, 'suspended tenant: get_tenant_id_for_user returns NULL');

select is((select count(*) from public.students)::int, 0, 'suspended tenant: school_admin read returns zero rows');

select throws_ok(
  $$ insert into public.students (tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender)
     values ('cccccccc-0000-0000-0000-000000000003', 'cccc2222-0000-0000-0000-000000000003', 'ADM-C-002', 'X', 'Y', '2015-01-01', 'male') $$,
  '42501',
  null,
  'suspended tenant: school_admin write is rejected'
);

reset role;

-- ---------- Reactivate: access restored ---------------------------------
update public.tenants set status = 'active' where id = 'cccccccc-0000-0000-0000-000000000003';

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select is((select count(*) from public.students)::int, 1, 'reactivated tenant: access restored');

reset role;

select * from finish();
rollback;
