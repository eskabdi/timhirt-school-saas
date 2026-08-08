-- ============================================================================
-- Role/user permissions matrix (20260816000001) -- pilot on classes,
-- subjects, fee_structures, calendar_events. Proves:
--   1. Zero configuration reproduces pre-matrix behavior exactly (the
--      load-bearing compatibility guarantee -- a tenant that never opens
--      the new page must see no change).
--   2. A role-level grant actually widens access; a role-level deny
--      actually narrows it.
--   3. A per-user override wins over the role default in both directions.
--   4. The two new tables' own RLS (tenant isolation, school_admin-only
--      writes) holds.
--   5. super_admin's cross-tenant read bypass survives the rewrite.
--   6. An un-piloted table (academic_years) is completely unaffected.
--   7. The existing, untouched has_permission()/role_permissions/user_roles
--      system (20260719000008) still works, unrelated to any of this --
--      confirms nothing collided.
-- ============================================================================
begin;
select plan(16);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '9d000001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'rp-admin@test.example',   crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9d000002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'rp-teacher@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9d000003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'rp-teacher2@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9d000004-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'rp-super@test.example',   crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9d000005-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'rp-admin-b@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('9d000000-0000-0000-0000-00000000000a', 'RP Tenant A', 'rp-tenant-a', 'active'),
  ('9d000000-0000-0000-0000-00000000000b', 'RP Tenant B', 'rp-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('9d000001-0000-0000-0000-000000000001', '9d000000-0000-0000-0000-00000000000a', 'school_admin', 'RP Admin',     'rp-admin@test.example'),
  ('9d000002-0000-0000-0000-000000000002', '9d000000-0000-0000-0000-00000000000a', 'teacher',      'RP Teacher',   'rp-teacher@test.example'),
  ('9d000003-0000-0000-0000-000000000003', '9d000000-0000-0000-0000-00000000000a', 'teacher',      'RP Teacher 2', 'rp-teacher2@test.example'),
  ('9d000004-0000-0000-0000-000000000004', null,                                    'super_admin',  'RP Super',     'rp-super@test.example'),
  ('9d000005-0000-0000-0000-000000000005', '9d000000-0000-0000-0000-00000000000b', 'school_admin', 'RP Admin B',   'rp-admin-b@test.example');

insert into public.academic_years (id, tenant_id, ec_year, label_i18n, starts_on, ends_on, status) values
  ('9d000000-0000-0000-0000-00000000ea01', '9d000000-0000-0000-0000-00000000000a', 2018, '{}'::jsonb, '2025-09-01', '2026-06-30', 'active');

insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('9d000000-0000-0000-0000-00000000c001', '9d000000-0000-0000-0000-00000000000a', '9d000000-0000-0000-0000-00000000ea01', 'Grade 1', 'A'),
  ('9d000000-0000-0000-0000-00000000c002', '9d000000-0000-0000-0000-00000000000a', '9d000000-0000-0000-0000-00000000ea01', 'Grade 1', 'B');

insert into public.subjects (id, tenant_id, name_i18n, code) values
  ('9d000000-0000-0000-0000-00000000f001', '9d000000-0000-0000-0000-00000000000a', '{"en":"Math"}'::jsonb, 'RP-MATH');

-- ---------- 1. regression: zero configuration = today's exact behavior -----
set local role authenticated;
set local request.jwt.claim.sub = '9d000002-0000-0000-0000-000000000002'; -- teacher, no grants configured

select is(
  (select count(*)::int from public.classes where tenant_id = '9d000000-0000-0000-0000-00000000000a'), 2,
  'unconfigured: teacher can still read classes (fallback read = open)');

select throws_ok(
  $stmt$ insert into public.classes (tenant_id, academic_year_id, name, section)
         values ('9d000000-0000-0000-0000-00000000000a', '9d000000-0000-0000-0000-00000000ea01', 'Grade 2', 'A') $stmt$,
  '42501', null, 'unconfigured: teacher cannot insert a class (fallback create = school_admin only)');

set local request.jwt.claim.sub = '9d000001-0000-0000-0000-000000000001'; -- school_admin

select lives_ok(
  $stmt$ insert into public.classes (id, tenant_id, academic_year_id, name, section)
         values ('9d000000-0000-0000-0000-00000000c003', '9d000000-0000-0000-0000-00000000000a', '9d000000-0000-0000-0000-00000000ea01', 'Grade 2', 'A') $stmt$,
  'unconfigured: school_admin can still insert a class (matches pre-matrix behavior)');

select is(
  (select count(*)::int from public.classes where tenant_id = '9d000000-0000-0000-0000-00000000000a'), 3,
  'the school_admin insert actually persisted');

reset role;

-- ---------- 2. role-level grant widens access -------------------------------
insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9d000000-0000-0000-0000-00000000000a', 'teacher', id, true
from public.permissions where key = 'classes:create';

set local role authenticated;
set local request.jwt.claim.sub = '9d000002-0000-0000-0000-000000000002'; -- teacher

select lives_ok(
  $stmt$ insert into public.classes (id, tenant_id, academic_year_id, name, section)
         values ('9d000000-0000-0000-0000-00000000c004', '9d000000-0000-0000-0000-00000000000a', '9d000000-0000-0000-0000-00000000ea01', 'Grade 3', 'A') $stmt$,
  'role grant: teacher can now insert a class after being granted classes:create');

reset role;

-- ---------- 3. role-level deny narrows access -------------------------------
insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select '9d000000-0000-0000-0000-00000000000a', 'school_admin', id, false
from public.permissions where key = 'subjects:read';

set local role authenticated;
set local request.jwt.claim.sub = '9d000001-0000-0000-0000-000000000001'; -- school_admin

select is(
  (select count(*)::int from public.subjects where tenant_id = '9d000000-0000-0000-0000-00000000000a'), 0,
  'role deny: school_admin explicitly denied subjects:read now sees zero rows');
select is(
  (select count(*)::int from public.classes where tenant_id = '9d000000-0000-0000-0000-00000000000a'), 4,
  'the deny on subjects does not leak into classes -- still sees all 4 classes');

reset role;

-- ---------- 4a. per-user override grants on top of a role deny -------------
-- teacher2 has no role grant for classes:create (still defaults to deny);
-- give teacher2 personally an override.
insert into public.user_permission_overrides (tenant_id, user_id, permission_id, granted)
select '9d000000-0000-0000-0000-00000000000a', '9d000003-0000-0000-0000-000000000003', id, true
from public.permissions where key = 'classes:create';

set local role authenticated;
set local request.jwt.claim.sub = '9d000003-0000-0000-0000-000000000003'; -- teacher2, has the override

select lives_ok(
  $stmt$ insert into public.classes (id, tenant_id, academic_year_id, name, section)
         values ('9d000000-0000-0000-0000-00000000c005', '9d000000-0000-0000-0000-00000000000a', '9d000000-0000-0000-0000-00000000ea01', 'Grade 4', 'A') $stmt$,
  'user override: teacher2 can insert despite no role grant, via a personal override');

reset role;

-- ---------- 4b. per-user override denies on top of a role grant ------------
-- teacher (not teacher2) already has classes:create via the role grant from
-- step 2 -- give teacher personally an override that takes it away.
insert into public.user_permission_overrides (tenant_id, user_id, permission_id, granted)
select '9d000000-0000-0000-0000-00000000000a', '9d000002-0000-0000-0000-000000000002', id, false
from public.permissions where key = 'classes:create';

set local role authenticated;
set local request.jwt.claim.sub = '9d000002-0000-0000-0000-000000000002'; -- teacher, role grants create but override denies it

select throws_ok(
  $stmt$ insert into public.classes (tenant_id, academic_year_id, name, section)
         values ('9d000000-0000-0000-0000-00000000000a', '9d000000-0000-0000-0000-00000000ea01', 'Grade 5', 'A') $stmt$,
  '42501', null, 'user override: a personal deny overrides the role-level grant');

reset role;

-- ---------- 5. the two new tables' own RLS ----------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '9d000002-0000-0000-0000-000000000002'; -- teacher, not school_admin

-- Unlike an UPDATE/DELETE whose USING clause just filters which rows are
-- touched (0 rows, no error), an INSERT's WITH CHECK failing is a hard
-- 42501 -- there's no "existing row" for USING to filter against.
select throws_ok(
  $stmt$ insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
         select '9d000000-0000-0000-0000-00000000000a', 'registrar', id, true from public.permissions where key = 'classes:read' $stmt$,
  '42501', null, 'teacher cannot write to builtin_role_permission_grants (school_admin only)');

set local request.jwt.claim.sub = '9d000001-0000-0000-0000-000000000001'; -- school_admin, verifying

select is(
  (select count(*)::int from public.builtin_role_permission_grants
     where tenant_id = '9d000000-0000-0000-0000-00000000000a' and role = 'registrar'), 0,
  'the teacher''s write to builtin_role_permission_grants matched zero rows');

set local request.jwt.claim.sub = '9d000005-0000-0000-0000-000000000005'; -- school_admin, tenant B

select is(
  (select count(*)::int from public.builtin_role_permission_grants
     where tenant_id = '9d000000-0000-0000-0000-00000000000a'), 0,
  'a school_admin in tenant B cannot see tenant A''s role grants');

reset role;

-- ---------- 6. super_admin cross-tenant read bypass survives ---------------
set local role authenticated;
set local request.jwt.claim.sub = '9d000004-0000-0000-0000-000000000004'; -- super_admin

-- 5 by now: 2 seeded + school_admin's c003 + teacher's c004 (step 2) +
-- teacher2's c005 (step 4a) -- step 4b's insert was rejected, added none.
select is(
  (select count(*)::int from public.classes where tenant_id = '9d000000-0000-0000-0000-00000000000a'), 5,
  'super_admin still sees tenant A''s classes despite having no tenant of their own');

reset role;

-- ---------- 7. a resource not yet touched by any permissions-matrix --------
-- ---------- migration is unaffected. (academic_years was the control here --
-- ---------- until 20260817000002 brought it into the matrix too; library_-
-- ---------- books stays untouched until 20260817000004.) -----------------
set local role authenticated;
set local request.jwt.claim.sub = '9d000002-0000-0000-0000-000000000002'; -- teacher

select is(
  (select count(*)::int from public.academic_years where tenant_id = '9d000000-0000-0000-0000-00000000000a'), 1,
  'academic_years now reads through the matrix too, but zero configuration reproduces the same open-read count as before');

reset role;

-- ---------- 8. the existing, untouched permission system still works -------
select is(
  public.has_permission('9d000002-0000-0000-0000-000000000002', 'students:read'), false,
  'the pre-existing has_permission() (20260719000008) is unaffected -- still returns false with no role_permissions configured');
select is(
  (select count(*)::int from public.roles where tenant_id = '9d000000-0000-0000-0000-00000000000a'), 0,
  'the pre-existing roles table is untouched -- still empty, nothing collided');

select * from finish();
rollback;
