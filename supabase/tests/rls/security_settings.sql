-- ============================================================================
-- Platform-wide security settings (/platform/security, 20260806000001):
-- get_security_settings() must be readable by any authenticated role (every
-- signed-in user needs to know the idle timeout and password policy, not
-- just school_admin/super_admin), while writes to the underlying
-- system_config rows (tenant_id is null) must stay restricted to
-- super_admin -- the whole point of putting this in the platform console
-- instead of a tenant-level settings page.
-- ============================================================================
begin;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '8a000001-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'ssec-admin@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '8a000002-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'ssec-registrar@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('8a000000-0000-0000-0000-00000000000a', 'SSEC Tenant', 'ssec-tenant', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('8a000001-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-00000000000a', 'super_admin', 'SSEC Super Admin', 'ssec-admin@test.example'),
  ('8a000002-0000-0000-0000-000000000002', '8a000000-0000-0000-0000-00000000000a', 'registrar', 'SSEC Registrar', 'ssec-registrar@test.example');

set local role authenticated;
set local request.jwt.claim.sub = '8a000002-0000-0000-0000-000000000002';

-- ---------- get_security_settings() works for a plain registrar ----------
select is(
  (select (get_security_settings()->>'login_max_attempts')::int),
  5,
  'a registrar (not school_admin/super_admin) can call get_security_settings() and gets the seeded default'
);

select ok(
  (select get_security_settings() ? 'password_min_length'),
  'get_security_settings() includes password_min_length for a registrar'
);

-- ---------- ...precisely because system_config_read denies it direct access ----------
select is(
  (select count(*)::int from public.system_config where tenant_id is null and key = 'login_max_attempts'),
  0,
  'a registrar cannot directly SELECT the tenant_id-null row (system_config_read still gates the table; get_security_settings() is doing real security-definer work, not redundant)'
);

-- ---------- writes to tenant_id-null system_config stay super_admin-only ----------
-- RLS filters rows rather than raising: a registrar's UPDATE against a row
-- system_config_write's USING clause excludes them from just matches zero
-- rows and "succeeds" as a no-op, it does not throw 42501. The real
-- assertion is the next one -- the value is provably unchanged.
select lives_ok(
  $stmt$ update public.system_config set value = '999'::jsonb
         where tenant_id is null and key = 'login_max_attempts' $stmt$,
  'registrar''s write to a tenant_id-null row runs but (per RLS) matches nothing'
);

select is(
  (select (get_security_settings()->>'login_max_attempts')::int),
  5,
  'login_max_attempts is unchanged after the blocked registrar write'
);

-- ---------- super_admin can write (the actual /platform/security save path) ----------
set local request.jwt.claim.sub = '8a000001-0000-0000-0000-000000000001';

select lives_ok(
  $stmt$ update public.system_config set value = '7'::jsonb
         where tenant_id is null and key = 'login_max_attempts' $stmt$,
  'super_admin can write a tenant_id-null system_config row'
);

select is(
  (select (get_security_settings()->>'login_max_attempts')::int),
  7,
  'get_security_settings() reflects the super_admin''s change immediately (no cache)'
);

select * from finish();
rollback;
