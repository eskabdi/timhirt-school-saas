-- ============================================================================
-- R6 WP-02 (H-01, L-07, G-10): SECURITY DEFINER lockdown, probed with real
-- calls (20260926000001_r6_definer_lockdown.sql). Anon gets permission denied
-- on every formerly open RPC; an authenticated user can no longer read another
-- user's email, role or tenant, act on another tenant's jobs or alerts, or
-- learn another tenant's modules; service_role (no end-user JWT) still can.
-- ============================================================================
begin;
select plan(28);

insert into public.tenants (id, name, slug) values
  ('00000000-0000-0000-0000-0000000d0a00', 'Lockdown A', 'lockdown-a'),
  ('00000000-0000-0000-0000-0000000d0b00', 'Lockdown B', 'lockdown-b');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d0a01', 'admin-a@example.test'),
  ('00000000-0000-0000-0000-0000000d0a02', 'student-a@example.test'),
  ('00000000-0000-0000-0000-0000000d0b01', 'admin-b@example.test');
insert into public.users (id, tenant_id, role, full_name, email) values
  ('00000000-0000-0000-0000-0000000d0a01', '00000000-0000-0000-0000-0000000d0a00', 'school_admin', 'Admin A', 'admin-a@example.test'),
  ('00000000-0000-0000-0000-0000000d0a02', '00000000-0000-0000-0000-0000000d0a00', 'student', 'Student A', 'student-a@example.test'),
  ('00000000-0000-0000-0000-0000000d0b01', '00000000-0000-0000-0000-0000000d0b00', 'school_admin', 'Admin B', 'admin-b@example.test');
insert into public.health_alerts (id, tenant_id, alert_type, severity, message)
values ('00000000-0000-0000-0000-0000000d0b0a', '00000000-0000-0000-0000-0000000d0b00', 'probe', 'warning', 'tenant B alert');
insert into public.tenant_module_overrides (tenant_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000d0b00', 'library', true);

-- ---------------------------------------------------------------- anon ----
set local role anon;
set local request.jwt.claim.sub = '';
select throws_ok($$ select public.get_email_for_user('00000000-0000-0000-0000-0000000d0a01') $$, '42501', null, 'anon: get_email_for_user is denied');
select throws_ok($$ select public.get_role_for_user('00000000-0000-0000-0000-0000000d0a01') $$, '42501', null, 'anon: get_role_for_user is denied');
select throws_ok($$ select public.get_tenant_id_for_user('00000000-0000-0000-0000-0000000d0a01') $$, '42501', null, 'anon: get_tenant_id_for_user is denied');
select throws_ok($$ select public.create_export_job('00000000-0000-0000-0000-0000000d0b00', 'students') $$, '42501', null, 'anon: create_export_job is denied');
select throws_ok($$ select public.acknowledge_alert('00000000-0000-0000-0000-0000000d0b0a') $$, '42501', null, 'anon: acknowledge_alert is denied');
select throws_ok($$ select public.get_config('password_min_length', null) $$, '42501', null, 'anon: get_config is denied');
select throws_ok($$ select public.has_module('00000000-0000-0000-0000-0000000d0b00', 'library') $$, '42501', null, 'anon: has_module is denied');
select throws_ok($$ select public.fail_job(gen_random_uuid(), 'x') $$, '42501', null, 'anon: fail_job is denied');
-- Report 3 Appendix A-1 probes that worked as anon before the lockdown.
select throws_ok($$ select public.create_health_alert('00000000-0000-0000-0000-0000000d0b00', 'critical', 'probe', 'Your account is locked, call +251') $$, '42501', null, 'A-1: anon can no longer plant a health alert in another tenant');
select throws_ok($$ select public.complete_job(gen_random_uuid(), 999, 'attacker/path.csv') $$, '42501', null, 'A-1: anon can no longer complete another tenant''s job');
select throws_ok($$ select public.cleanup_old_audit_logs() $$, '42501', null, 'A-1: anon can no longer purge the audit log');
select ok((select count(*) from jsonb_object_keys(public.get_security_settings()) k) > 0
          and not exists (select 1 from jsonb_object_keys(public.get_security_settings()) k where k not like 'password\_%'),
  'anon: get_security_settings returns the password policy and nothing else');
reset role;

-- ------------------------------------------------- tenant A school admin ----
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000d0a01';
select is(public.get_email_for_user('00000000-0000-0000-0000-0000000d0a01'), 'admin-a@example.test', 'admin A reads their own email');
select ok(public.get_security_settings() ? 'login_max_attempts', 'a signed-in user also gets the login and session settings');
select is(public.get_email_for_user('00000000-0000-0000-0000-0000000d0a02'), null, 'admin A cannot read another user''s email');
select is(public.get_role_for_user('00000000-0000-0000-0000-0000000d0b01'), null, 'admin A cannot read a tenant-B user''s role');
select is(public.get_tenant_id_for_user('00000000-0000-0000-0000-0000000d0b01'), null, 'admin A cannot read a tenant-B user''s tenant');
select is(public.get_role_for_user('00000000-0000-0000-0000-0000000d0a02'), 'student', 'admin A reads a same-tenant user''s role (messages policy)');
select is(public.has_module('00000000-0000-0000-0000-0000000d0b00', 'library'), false, 'admin A cannot learn tenant B''s modules');
select is(public.has_resource_permission('00000000-0000-0000-0000-0000000d0a02', 'students', 'read'), null, 'has_resource_permission answers only for the caller');
select throws_ok($$ select public.create_export_job('00000000-0000-0000-0000-0000000d0b00', 'students') $$, '42501', null, 'admin A cannot create a job in tenant B');
select isnt(public.create_export_job('00000000-0000-0000-0000-0000000d0a00', 'students'), null, 'admin A creates a job in their own tenant');
select lives_ok($$ select public.acknowledge_alert('00000000-0000-0000-0000-0000000d0b0a') $$, 'acknowledging a tenant-B alert does not error ...');
select throws_ok($$ select public.complete_job(gen_random_uuid(), 0, null) $$, '42501', null, 'authenticated: complete_job is service_role only');
reset role;
select is((select acknowledged_at from public.health_alerts where id = '00000000-0000-0000-0000-0000000d0b0a'), null, '... and leaves it untouched');

-- ------------------------------------------------------ tenant A student ----
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000d0a02';
select throws_ok($$ select public.create_export_job('00000000-0000-0000-0000-0000000d0a00', 'students') $$, '42501', null, 'a student cannot create an export job');
reset role;

-- ------------------------------------------- service_role (Edge Functions) ----
set local role service_role;
set local request.jwt.claim.sub = '';
select is(public.get_email_for_user('00000000-0000-0000-0000-0000000d0b01'), 'admin-b@example.test', 'service_role (no end-user JWT) reads any email');
select is(public.has_module('00000000-0000-0000-0000-0000000d0b00', 'library'), true, 'service_role reads any tenant''s modules');
reset role;

select * from finish();
rollback;
