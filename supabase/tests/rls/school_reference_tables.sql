-- ============================================================================
-- school_types / operational_modes (20260810000001) -- platform-global
-- reference catalogs, same shape and same RLS pattern as
-- modules/subscription_tiers (20260715000016): readable by anyone
-- authenticated, writable only by super_admin. tenant_configs gains two
-- nullable FK columns (school_type_key, operational_mode_key); no new
-- policy was added there because configs_write already lets a school_admin
-- write any column on their own tenant's row -- this suite proves that
-- coverage actually extends to the two new columns, that the FK rejects a
-- bogus key, and that cross-tenant writes still get filtered.
-- ============================================================================
begin;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '8b000001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'srt-admin@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '8b000002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'srt-teacher@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '8b000003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'srt-super@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '8b000004-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'srt-admin-b@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('8b000000-0000-0000-0000-00000000000a', 'SRT Tenant A', 'srt-tenant-a', 'active'),
  ('8b000000-0000-0000-0000-00000000000b', 'SRT Tenant B', 'srt-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('8b000001-0000-0000-0000-000000000001', '8b000000-0000-0000-0000-00000000000a', 'school_admin', 'SRT Admin',     'srt-admin@test.example'),
  ('8b000002-0000-0000-0000-000000000002', '8b000000-0000-0000-0000-00000000000a', 'teacher',      'SRT Teacher',   'srt-teacher@test.example'),
  ('8b000003-0000-0000-0000-000000000003', '8b000000-0000-0000-0000-00000000000a', 'super_admin',  'SRT Super',     'srt-super@test.example'),
  ('8b000004-0000-0000-0000-000000000004', '8b000000-0000-0000-0000-00000000000b', 'school_admin', 'SRT Admin B',   'srt-admin-b@test.example');

insert into public.tenant_configs (tenant_id, settings) values
  ('8b000000-0000-0000-0000-00000000000a', '{}'::jsonb),
  ('8b000000-0000-0000-0000-00000000000b', '{}'::jsonb);

set local role authenticated;
set local request.jwt.claim.sub = '8b000002-0000-0000-0000-000000000002'; -- teacher, not admin

-- ---------- any authenticated role can read both catalogs -------------------
select is(
  (select count(*)::int from public.school_types), 4,
  'a teacher can read all 4 seeded school_types');

select is(
  (select count(*)::int from public.operational_modes), 2,
  'a teacher can read both seeded operational_modes');

-- ---------- writes to the catalogs are super_admin-only ---------------------
select lives_ok(
  $stmt$ update public.school_types set display_name = 'Hacked' where key = 'public' $stmt$,
  'teacher''s write to school_types runs without error (RLS filters, does not raise)');

set local request.jwt.claim.sub = '8b000003-0000-0000-0000-000000000003'; -- super_admin, verifying read

select is(
  (select display_name from public.school_types where key = 'public'), 'Public',
  'display_name is unchanged -- the teacher''s write matched zero rows');

set local request.jwt.claim.sub = '8b000003-0000-0000-0000-000000000003';

select lives_ok(
  $stmt$ update public.operational_modes set display_name = 'Renamed' where key = 'full_day' $stmt$,
  'super_admin can write operational_modes');

select is(
  (select display_name from public.operational_modes where key = 'full_day'), 'Renamed',
  'operational_modes write actually took effect for super_admin');

-- ---------- school_admin can set their own tenant_configs FK columns --------
set local request.jwt.claim.sub = '8b000001-0000-0000-0000-000000000001'; -- school_admin, tenant A

select lives_ok(
  $stmt$ update public.tenant_configs set school_type_key = 'private', operational_mode_key = 'double_shift'
         where tenant_id = '8b000000-0000-0000-0000-00000000000a' $stmt$,
  'school_admin can set school_type_key/operational_mode_key on their own tenant_configs row');

select is(
  (select school_type_key from public.tenant_configs where tenant_id = '8b000000-0000-0000-0000-00000000000a'),
  'private', 'school_type_key was actually persisted for tenant A');

-- ---------- the FK actually constrains the value, not just any text --------
select throws_ok(
  $stmt$ update public.tenant_configs set school_type_key = 'nonexistent'
         where tenant_id = '8b000000-0000-0000-0000-00000000000a' $stmt$,
  '23503', null, 'an unknown school_type_key is rejected by the foreign key');

-- ---------- cross-tenant school_admin cannot touch tenant A's row -----------
set local request.jwt.claim.sub = '8b000004-0000-0000-0000-000000000004'; -- school_admin, tenant B

select lives_ok(
  $stmt$ update public.tenant_configs set school_type_key = 'community'
         where tenant_id = '8b000000-0000-0000-0000-00000000000a' $stmt$,
  'cross-tenant school_admin''s write runs without error (RLS filters, does not raise)');

set local request.jwt.claim.sub = '8b000001-0000-0000-0000-000000000001';

select is(
  (select school_type_key from public.tenant_configs where tenant_id = '8b000000-0000-0000-0000-00000000000a'),
  'private', 'school_type_key is unchanged -- the cross-tenant update matched zero rows');

select * from finish();
rollback;
