-- ============================================================================
-- SECURITY DEFINER RPC authorization — regression for 20260730000001.
--
-- The 20260719* batch granted 13 SECURITY DEFINER functions to `authenticated`
-- with no tenant or role check inside. SECURITY DEFINER skips RLS, so each one
-- re-opened what the policy beside it closed. Before the fix, every assertion
-- below that now expects "permission denied" instead SUCCEEDED, as a *student*.
--
-- The attacker here is deliberately the weakest authenticated principal: a
-- student in Tenant A, for whom a direct select against either table returns
-- zero rows. Anything they can still reach through an RPC is a real bypass.
-- ============================================================================
begin;
select plan(15);

-- ---------- Fixtures ---------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'rpc-admin-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'rpc-student-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'rpc-admin-b@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'RPC Tenant A', 'rpc-test-tenant-a', 'active'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'RPC Tenant B', 'rpc-test-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-00000000000a', 'school_admin', 'Admin A', 'rpc-admin-a@test.example'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-00000000000a', 'student',      'Student A', 'rpc-student-a@test.example'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-00000000000b', 'school_admin', 'Admin B', 'rpc-admin-b@test.example');

-- Tenant B's own private rows.
insert into public.data_jobs (id, tenant_id, user_id, job_type, entity_type, status)
values ('dddddddd-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000000b',
        '22222222-2222-2222-2222-222222222222', 'export', 'students', 'processing');

insert into public.health_alerts (id, tenant_id, alert_type, severity, message)
values ('eeeeeeee-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000000b',
        'disk', 'critical', 'Tenant B private alert');

insert into public.system_config (key, value, value_type, tenant_id)
values ('rpc_secret_key', '"tenant-B-only-value"'::jsonb, 'string', 'bbbbbbbb-0000-0000-0000-00000000000b');

insert into public.feature_flags (tenant_id, flag_key, enabled)
values ('bbbbbbbb-0000-0000-0000-00000000000b', 'rpc_secret_flag', true);

-- ---------- Attacker: a student in Tenant A ---------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

-- Baseline: RLS itself is doing its job. If these two ever fail, the RPC
-- assertions below are testing nothing.
select is(
  (select count(*)::int from public.data_jobs), 0,
  'RLS: student sees no data_jobs rows at all');
select is(
  (select count(*)::int from public.health_alerts), 0,
  'RLS: student sees no health_alerts rows at all');

-- Cross-tenant writes through the job RPCs.
select throws_ok(
  $$ select public.create_import_job('bbbbbbbb-0000-0000-0000-00000000000b'::uuid, 'students', 10) $$,
  '42501',
  'permission denied',
  'create_import_job rejects a forged p_tenant_id');

select throws_ok(
  $$ select public.create_export_job('bbbbbbbb-0000-0000-0000-00000000000b'::uuid, 'students') $$,
  '42501',
  'permission denied',
  'create_export_job rejects a forged p_tenant_id');

-- A student may not create jobs even inside their own tenant: data_jobs writes
-- belong to school_admin, which is what the settings route enforces in the UI.
select throws_ok(
  $$ select public.create_export_job('aaaaaaaa-0000-0000-0000-00000000000a'::uuid, 'students') $$,
  '42501',
  'permission denied',
  'create_export_job rejects a non-admin caller in their own tenant');

select throws_ok(
  $$ select public.fail_job('dddddddd-0000-0000-0000-00000000000b'::uuid, 'pwned') $$,
  '42501',
  'permission denied',
  'fail_job rejects a non-admin caller');

select throws_ok(
  $$ select public.complete_job('dddddddd-0000-0000-0000-00000000000b'::uuid, 999, 'attacker/path.csv') $$,
  '42501',
  'permission denied',
  'complete_job rejects a non-admin caller');

select throws_ok(
  $$ select public.update_job_progress('dddddddd-0000-0000-0000-00000000000b'::uuid, 1, 50, null) $$,
  '42501',
  'permission denied',
  'update_job_progress rejects a non-admin caller');

select throws_ok(
  $$ select public.acknowledge_alert('eeeeeeee-0000-0000-0000-00000000000b'::uuid) $$,
  '42501',
  'permission denied',
  'acknowledge_alert rejects a non-admin caller');

-- Cross-tenant reads.
select throws_ok(
  $$ select public.get_config('rpc_secret_key', 'bbbbbbbb-0000-0000-0000-00000000000b'::uuid) $$,
  '42501',
  'permission denied',
  'get_config rejects a cross-tenant p_tenant_id');

select throws_ok(
  $$ select public.is_feature_enabled('rpc_secret_flag', 'bbbbbbbb-0000-0000-0000-00000000000b'::uuid) $$,
  '42501',
  'permission denied',
  'is_feature_enabled rejects a cross-tenant p_tenant_id');

-- Global maintenance is service_role-only now.
select throws_ok(
  $$ select public.cleanup_expired_backups() $$,
  '42501',
  'permission denied for function cleanup_expired_backups',
  'cleanup_expired_backups is not executable by authenticated');

-- Tenant B's rows are untouched after every attempt above.
reset role;
select is(
  (select status from public.data_jobs where id = 'dddddddd-0000-0000-0000-00000000000b'),
  'processing',
  'Tenant B job survived the attack unchanged');
select is(
  (select acknowledged_by from public.health_alerts where id = 'eeeeeeee-0000-0000-0000-00000000000b'),
  null,
  'Tenant B alert was never acknowledged');

-- ---------- The legitimate caller still works -------------------------------
-- Tenant A's school_admin passing their own tenant is the real client path
-- (ImportExportPage.tsx). Hardening must not have broken it.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select isnt(
  (select public.create_export_job('aaaaaaaa-0000-0000-0000-00000000000a'::uuid, 'students')),
  null,
  'school_admin can still create an export job in their own tenant');

select finish();
rollback;
