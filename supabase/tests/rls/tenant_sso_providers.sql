-- ============================================================================
-- tenant_sso_providers (20260817000009) -- the tenant<->SAML-IdP mapping
-- table backing per-tenant SSO (Edge Functions: manage-sso-provider,
-- complete-sso-login, activate-sso-user; not covered here -- no Deno test
-- harness exists in this repo, see supabase/functions/*).
--
-- Applies the role_permissions_admin_manage lesson (20260817000007 found a
-- live cross-tenant self-escalation because that policy checked tenant but
-- not role on a `for all` policy) from day one: proves BOTH a same-tenant
-- non-admin AND a cross-tenant admin are rejected, not just one axis.
-- ============================================================================
begin;
select plan(13);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '9d000001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'sso-admin-a@test.example',   crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9d000002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'sso-teacher-a@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9d000003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'sso-admin-b@test.example',   crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('9d000000-0000-0000-0000-00000000000a', 'SSO Tenant A', 'sso-tenant-a', 'active'),
  ('9d000000-0000-0000-0000-00000000000b', 'SSO Tenant B', 'sso-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('9d000001-0000-0000-0000-000000000001', '9d000000-0000-0000-0000-00000000000a', 'school_admin', 'SSO Admin A',   'sso-admin-a@test.example'),
  ('9d000002-0000-0000-0000-000000000002', '9d000000-0000-0000-0000-00000000000a', 'teacher',      'SSO Teacher A', 'sso-teacher-a@test.example'),
  ('9d000003-0000-0000-0000-000000000003', '9d000000-0000-0000-0000-00000000000b', 'school_admin', 'SSO Admin B',   'sso-admin-b@test.example');

-- ---------- 1. school_admin can register their own tenant's provider -------
set local role authenticated;
set local request.jwt.claim.sub = '9d000001-0000-0000-0000-000000000001'; -- school_admin, tenant A

insert into public.tenant_sso_providers (tenant_id, domain, metadata_url, created_by)
values ('9d000000-0000-0000-0000-00000000000a', 'sso-tenant-a.example.edu.et', 'https://idp.example.edu.et/metadata', '9d000001-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.tenant_sso_providers where tenant_id = '9d000000-0000-0000-0000-00000000000a'), 1,
  'school_admin can insert their own tenant''s SSO provider row');
reset role;

-- ---------- 2. same-tenant non-admin cannot insert (role check on write) ---
set local role authenticated;
set local request.jwt.claim.sub = '9d000002-0000-0000-0000-000000000002'; -- teacher, tenant A

select throws_ok(
  $stmt$ insert into public.tenant_sso_providers (tenant_id, domain, metadata_url)
         values ('9d000000-0000-0000-0000-00000000000a', 'other-domain.example.edu.et', 'https://idp2.example.edu.et/metadata') $stmt$,
  '42501', null, 'a same-tenant teacher cannot insert a tenant_sso_providers row (school_admin-only write)');

-- ---------- 3. read is unrestricted within the tenant -----------------------
select is(
  (select domain from public.tenant_sso_providers where tenant_id = '9d000000-0000-0000-0000-00000000000a'),
  'sso-tenant-a.example.edu.et',
  'a same-tenant teacher can read the tenant''s SSO provider row (domain routing is not sensitive)');
reset role;

-- ---------- 4. cross-tenant read is blocked ---------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '9d000003-0000-0000-0000-000000000003'; -- school_admin, tenant B

select is(
  (select count(*)::int from public.tenant_sso_providers where tenant_id = '9d000000-0000-0000-0000-00000000000a'), 0,
  'a tenant-B school_admin cannot read tenant A''s SSO provider row');

-- ---------- 5. cross-tenant admin write is filtered, not honored ------------
select lives_ok(
  $stmt$ update public.tenant_sso_providers set enabled = true where tenant_id = '9d000000-0000-0000-0000-00000000000a' $stmt$,
  'a tenant-B school_admin''s update against tenant A''s row runs without error (RLS filters, does not raise)');

reset role;

set local role authenticated;
set local request.jwt.claim.sub = '9d000001-0000-0000-0000-000000000001'; -- school_admin, tenant A

select is(
  (select enabled from public.tenant_sso_providers where tenant_id = '9d000000-0000-0000-0000-00000000000a'), false,
  'enabled is unchanged -- the cross-tenant admin''s update matched zero rows');

-- ---------- 6. same-tenant admin CAN update their own row -------------------
select lives_ok(
  $stmt$ update public.tenant_sso_providers set enabled = true where tenant_id = '9d000000-0000-0000-0000-00000000000a' $stmt$,
  'the owning tenant''s school_admin can update their own SSO provider row');

select is(
  (select enabled from public.tenant_sso_providers where tenant_id = '9d000000-0000-0000-0000-00000000000a'), true,
  'enabled was actually persisted for the owning tenant''s admin');
reset role;

-- ---------- 7. same-tenant non-admin delete is filtered, not honored -------
set local role authenticated;
set local request.jwt.claim.sub = '9d000002-0000-0000-0000-000000000002'; -- teacher, tenant A

select lives_ok(
  $stmt$ delete from public.tenant_sso_providers where tenant_id = '9d000000-0000-0000-0000-00000000000a' $stmt$,
  'a same-tenant teacher''s delete runs without error (RLS filters, does not raise)');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '9d000001-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.tenant_sso_providers where tenant_id = '9d000000-0000-0000-0000-00000000000a'), 1,
  'the row still exists -- the non-admin''s delete matched zero rows');

-- ---------- 8. domain is globally unique across tenants ---------------------
-- Must be attempted as tenant B against tenant B's own tenant_id -- inserting
-- a second row under tenant A's own tenant_id (as the earlier version of
-- this test did) only proves the `unique (tenant_id)` constraint, not that
-- the domain itself is globally exclusive, which is the actual guarantee
-- this migration's comment claims (two tenants cannot register the same
-- email domain).
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '9d000003-0000-0000-0000-000000000003'; -- school_admin, tenant B

select throws_ok(
  $stmt$ insert into public.tenant_sso_providers (tenant_id, domain, metadata_url)
         values ('9d000000-0000-0000-0000-00000000000b', 'sso-tenant-a.example.edu.et', 'https://idp3.example.edu.et/metadata') $stmt$,
  '23505', null, 'tenant B cannot claim a domain already registered to tenant A -- a genuine cross-tenant collision, not a same-tenant retry');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '9d000001-0000-0000-0000-000000000001'; -- school_admin, tenant A

-- ---------- 9. domain/metadata_url format constraints are enforced ---------
select throws_ok(
  $stmt$ insert into public.tenant_sso_providers (tenant_id, domain, metadata_url)
         values ('9d000000-0000-0000-0000-00000000000a', 'not a domain', 'https://idp.example.edu.et/metadata') $stmt$,
  '23514', null, 'a malformed domain is rejected by the format check constraint');

select throws_ok(
  $stmt$ insert into public.tenant_sso_providers (tenant_id, domain, metadata_url)
         values ('9d000000-0000-0000-0000-00000000000a', 'another-domain.example.edu.et', 'http://insecure.example.edu.et/metadata') $stmt$,
  '23514', null, 'a non-https metadata_url is rejected by the format check constraint');
reset role;

select * from finish();
rollback;
