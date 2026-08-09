-- ============================================================================
-- Wires the previously-decorative roles/role_permissions/user_roles system
-- (20260719000008) into has_resource_permission() (20260817000006). Proves:
--   1. Zero custom-role assignment reproduces today's exact behavior (load-
--      bearing compatibility guarantee -- almost every user has none).
--   2. Creating a role and granting it a permission has NO effect until a
--      user is actually assigned to it via user_roles.
--   3. Assigning a user to a role that grants a permission their fixed role
--      doesn't have by default actually grants it; unassigning revokes it.
--   4. An explicit user_permission_overrides deny still wins over an
--      additive custom-role grant (precedence).
--   5. Cross-tenant defense in depth: a school_admin cannot assign one of
--      their users to another tenant's role (write policy), and even a
--      pre-existing mismatched row (simulating a bypass) is not honored by
--      the resolution function's own independent tenant re-check.
-- ============================================================================
begin;
select plan(9);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'c1000001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'cr-admin@test.example',   crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'c1000002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'cr-teacher@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'c1000003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'cr-admin-b@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('c1000000-0000-0000-0000-00000000000a', 'CR Tenant A', 'cr-tenant-a', 'active'),
  ('c1000000-0000-0000-0000-00000000000b', 'CR Tenant B', 'cr-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('c1000001-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000a', 'school_admin', 'CR Admin',    'cr-admin@test.example'),
  ('c1000002-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-00000000000a', 'teacher',      'CR Teacher',  'cr-teacher@test.example'),
  ('c1000003-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-00000000000b', 'school_admin', 'CR Admin B',  'cr-admin-b@test.example');

insert into public.employees (id, tenant_id, employee_no, employee_type, full_name, hire_date) values
  ('c1000000-0000-0000-0000-00000000e001', 'c1000000-0000-0000-0000-00000000000a', 'CR-EMP-01', 'teacher', 'Fixture Employee', '2020-01-01');

-- ---------- 1. unconfigured: teacher cannot read employees (baseline) ------
set local role authenticated;
set local request.jwt.claim.sub = 'c1000002-0000-0000-0000-000000000002'; -- teacher
select is(
  (select count(*)::int from public.employees where tenant_id = 'c1000000-0000-0000-0000-00000000000a'), 0,
  'unconfigured: teacher cannot read employees (not in the default population)');
reset role;

-- ---------- 2. role created + granted, but not yet assigned -> no effect ---
set local role authenticated;
set local request.jwt.claim.sub = 'c1000001-0000-0000-0000-000000000001'; -- school_admin
insert into public.roles (id, tenant_id, name, description, is_builtin)
values ('c1000000-0000-0000-0000-0000000f0001', 'c1000000-0000-0000-0000-00000000000a', 'Substitute Teacher', 'Covers HR read access temporarily', false);
insert into public.role_permissions (role_id, permission_id)
select 'c1000000-0000-0000-0000-0000000f0001', id from public.permissions where resource = 'employees' and action = 'read';
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'c1000002-0000-0000-0000-000000000002'; -- teacher, role exists but not assigned to them
select is(
  (select count(*)::int from public.employees where tenant_id = 'c1000000-0000-0000-0000-00000000000a'), 0,
  'a role with a granted permission has zero effect until a user is actually assigned to it');
reset role;

-- ---------- 3. assign the role -> access granted ----------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'c1000001-0000-0000-0000-000000000001'; -- school_admin
insert into public.user_roles (user_id, tenant_id, role_id)
values ('c1000002-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-0000000f0001');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'c1000002-0000-0000-0000-000000000002'; -- teacher
select is(
  (select count(*)::int from public.employees where tenant_id = 'c1000000-0000-0000-0000-00000000000a'), 1,
  'assigning the custom role grants the permission it carries, even though teacher is not in the default population');
reset role;

-- ---------- 4. unassign -> access revoked -----------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'c1000001-0000-0000-0000-000000000001'; -- school_admin
delete from public.user_roles where user_id = 'c1000002-0000-0000-0000-000000000002' and role_id = 'c1000000-0000-0000-0000-0000000f0001';
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'c1000002-0000-0000-0000-000000000002'; -- teacher
select is(
  (select count(*)::int from public.employees where tenant_id = 'c1000000-0000-0000-0000-00000000000a'), 0,
  'unassigning the custom role revokes the access it had granted');
reset role;

-- re-assign for the remaining tests
set local role authenticated;
set local request.jwt.claim.sub = 'c1000001-0000-0000-0000-000000000001';
insert into public.user_roles (user_id, tenant_id, role_id)
values ('c1000002-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-0000000f0001');
reset role;

-- ---------- 5. explicit per-user override deny still wins -------------------
set local role authenticated;
set local request.jwt.claim.sub = 'c1000001-0000-0000-0000-000000000001'; -- school_admin
insert into public.user_permission_overrides (tenant_id, user_id, permission_id, granted)
select 'c1000000-0000-0000-0000-00000000000a', 'c1000002-0000-0000-0000-000000000002', id, false
from public.permissions where resource = 'employees' and action = 'read';
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'c1000002-0000-0000-0000-000000000002'; -- teacher, has both an override deny AND a granting custom role
select is(
  (select count(*)::int from public.employees where tenant_id = 'c1000000-0000-0000-0000-00000000000a'), 0,
  'an explicit per-user override deny still wins over an additive custom-role grant');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'c1000001-0000-0000-0000-000000000001'; -- school_admin
delete from public.user_permission_overrides where user_id = 'c1000002-0000-0000-0000-000000000002';
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'c1000002-0000-0000-0000-000000000002'; -- teacher, override removed, custom role still assigned
select is(
  (select count(*)::int from public.employees where tenant_id = 'c1000000-0000-0000-0000-00000000000a'), 1,
  'removing the override restores the custom-role-granted access');
reset role;

-- ---------- 6. cross-tenant: cannot assign a user to another tenant's role --
set local role authenticated;
set local request.jwt.claim.sub = 'c1000003-0000-0000-0000-000000000003'; -- school_admin, tenant B
insert into public.roles (id, tenant_id, name, is_builtin)
values ('c1000000-0000-0000-0000-0000000f0002', 'c1000000-0000-0000-0000-00000000000b', 'Tenant B Role', false);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'c1000001-0000-0000-0000-000000000001'; -- school_admin, tenant A
select throws_ok(
  $stmt$ insert into public.user_roles (user_id, tenant_id, role_id)
         values ('c1000002-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-0000000f0002') $stmt$,
  '42501', null, 'a tenant-A school_admin cannot assign a tenant-A user to a tenant-B role');
reset role;

-- ---------- 7. defense in depth: a pre-existing mismatched row is ignored --
-- Grant tenant B's role read access to employees too, then simulate a bad
-- row (as if written before this migration, or by any other insert path)
-- directly as superuser, bypassing the write policy just proven above.
insert into public.role_permissions (role_id, permission_id)
select 'c1000000-0000-0000-0000-0000000f0002', id from public.permissions where resource = 'employees' and action = 'read';
insert into public.user_roles (user_id, tenant_id, role_id)
values ('c1000002-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-0000000f0002');

select is(
  coalesce(public.has_resource_permission('c1000002-0000-0000-0000-000000000002', 'employees', 'read'), false), true,
  'sanity: this employees:read grant still resolves true via the legitimate tenant-A role (c1000000...r001) already assigned'
);

delete from public.user_roles where user_id = 'c1000002-0000-0000-0000-000000000002' and role_id = 'c1000000-0000-0000-0000-0000000f0001';

select is(
  coalesce(public.has_resource_permission('c1000002-0000-0000-0000-000000000002', 'employees', 'read'), false), false,
  'defense in depth: a user_roles row whose role_id belongs to a different tenant is not honored, even though the row itself passed the write policy previously (bypass simulation)'
);

select * from finish();
rollback;
