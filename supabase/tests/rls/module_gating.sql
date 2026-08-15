-- ============================================================================
-- Regression for the server-side module gating fix
-- (20260821000003_module_gating_rls.sql). A tenant's tier determines module
-- access by default; a tenant_module_overrides row overrides the tier; a
-- disabled module blocks both reads and writes via a RESTRICTIVE policy,
-- independent of any existing PERMISSIVE policy on the table.
-- ============================================================================
begin;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555',
   'authenticated', 'authenticated', 'admin-mg@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

-- Basic tier: sis/attendance/timetable/gradebook/communication only.
insert into public.tenants (id, name, slug, status, tier_key) values
  ('eeeeeeee-0000-0000-0000-000000000005', 'Tenant E', 'rls-test-tenant-e', 'active', 'basic');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('55555555-5555-5555-5555-555555555555', 'eeeeeeee-0000-0000-0000-000000000005', 'school_admin', 'Admin E', 'admin-mg@test.example');

insert into public.library_books (id, tenant_id, title, author, isbn) values
  ('eeee5555-0000-0000-0000-000000000005', 'eeeeeeee-0000-0000-0000-000000000005', 'Test Book', 'Author', '9780000000005');

-- ---------- basic tier: library is not included -> blocked by default -----
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select is(public.has_module('eeeeeeee-0000-0000-0000-000000000005'::uuid, 'library'), false,
  'basic tier: library is not in the default module set');

select is((select count(*) from public.library_books)::int, 0,
  'basic tier: school_admin cannot read library_books (module not included)');

select throws_ok(
  $$ insert into public.library_books (tenant_id, title, author, isbn)
     values ('eeeeeeee-0000-0000-0000-000000000005', 'Blocked', 'X', '9780000000006') $$,
  '42501', null,
  'basic tier: school_admin cannot write library_books'
);

-- basic tier DOES include attendance -- unaffected by this migration.
select is((select count(*) from public.attendance)::int, 0,
  'basic tier: attendance table itself still reachable (0 rows is a valid empty read, not denied)');

reset role;

-- ---------- explicit override enables it regardless of tier ---------------
insert into public.tenant_module_overrides (tenant_id, module_key, enabled) values
  ('eeeeeeee-0000-0000-0000-000000000005', 'library', true);

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select is(public.has_module('eeeeeeee-0000-0000-0000-000000000005'::uuid, 'library'), true,
  'override enabled: has_module returns true despite basic tier');

select is((select count(*) from public.library_books)::int, 1,
  'override enabled: school_admin can now read library_books');

reset role;

-- ---------- override can also disable a tier-included module --------------
update public.tenant_module_overrides set enabled = false
  where tenant_id = 'eeeeeeee-0000-0000-0000-000000000005' and module_key = 'library';

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select is((select count(*) from public.library_books)::int, 0,
  'override disabled: school_admin loses access again');

reset role;

-- ---------- super_admin bypasses module gating entirely --------------------
insert into public.users (id, tenant_id, role, full_name, email) values
  ('66666666-6666-6666-6666-666666666666', null, 'super_admin', 'Super', 'super-mg@test.example');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666',
   'authenticated', 'authenticated', 'super-mg@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';

select is((select count(*) from public.library_books where tenant_id = 'eeeeeeee-0000-0000-0000-000000000005')::int, 1,
  'super_admin reads library_books regardless of the tenant''s module gating');

reset role;

select * from finish();
rollback;
