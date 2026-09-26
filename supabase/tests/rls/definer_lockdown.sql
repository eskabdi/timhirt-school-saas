-- ============================================================================
-- R6 WP-02 (H-01, L-07, G-10): SECURITY DEFINER lockdown, probed with real
-- calls (20260926000001_r6_definer_lockdown.sql). Anon gets permission denied
-- on every formerly open RPC; an authenticated user can no longer read another
-- user's email, role or tenant, act on another tenant's jobs or alerts, or
-- learn another tenant's modules; service_role (no end-user JWT) still can.
-- ============================================================================
begin;
select plan(51);

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
-- Round-1 review probes: a platform super_admin, a tenant-A alert, and a
-- tenant-B attendance window that differs from the default 7 (TI-1).
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000d0c01', 'platform@example.test');
insert into public.users (id, tenant_id, role, full_name, email)
values ('00000000-0000-0000-0000-0000000d0c01', null, 'super_admin', 'Platform', 'platform@example.test');
insert into public.health_alerts (id, tenant_id, alert_type, severity, message)
values ('00000000-0000-0000-0000-0000000d0a0a', '00000000-0000-0000-0000-0000000d0a00', 'probe', 'warning', 'tenant A alert');
insert into public.tenant_configs (tenant_id, settings)
values ('00000000-0000-0000-0000-0000000d0b00', '{"attendance_retroactive_edit_days": 30}')
on conflict (tenant_id) do update set settings = excluded.settings;

-- ---------------------------------------------------------------- anon ----
set local role anon;
set local request.jwt.claim.sub = '';
select throws_ok($$ select public.get_email_for_user('00000000-0000-0000-0000-0000000d0a01') $$, '42501', 'permission denied for function get_email_for_user', 'anon: get_email_for_user is denied');
select throws_ok($$ select public.get_role_for_user('00000000-0000-0000-0000-0000000d0a01') $$, '42501', 'permission denied for function get_role_for_user', 'anon: get_role_for_user is denied');
select throws_ok($$ select public.get_tenant_id_for_user('00000000-0000-0000-0000-0000000d0a01') $$, '42501', 'permission denied for function get_tenant_id_for_user', 'anon: get_tenant_id_for_user is denied');
select throws_ok($$ select public.create_export_job('00000000-0000-0000-0000-0000000d0b00', 'students') $$, '42501', 'permission denied for function create_export_job', 'anon: create_export_job is denied');
select throws_ok($$ select public.acknowledge_alert('00000000-0000-0000-0000-0000000d0b0a') $$, '42501', 'permission denied for function acknowledge_alert', 'anon: acknowledge_alert is denied');
select throws_ok($$ select public.get_config('password_min_length', null) $$, '42501', 'permission denied for function get_config', 'anon: get_config is denied');
select throws_ok($$ select public.has_module('00000000-0000-0000-0000-0000000d0b00', 'library') $$, '42501', 'permission denied for function has_module', 'anon: has_module is denied');
select throws_ok($$ select public.fail_job(gen_random_uuid(), 'x') $$, '42501', 'permission denied for function fail_job', 'anon: fail_job is denied');
-- Report 3 Appendix A-1 probes that worked as anon before the lockdown.
select throws_ok($$ select public.create_health_alert('00000000-0000-0000-0000-0000000d0b00', 'critical', 'probe', 'Your account is locked, call +251') $$, '42501', 'permission denied for function create_health_alert', 'A-1: anon can no longer plant a health alert in another tenant');
select throws_ok($$ select public.complete_job(gen_random_uuid(), 999, 'attacker/path.csv') $$, '42501', 'permission denied for function complete_job', 'A-1: anon can no longer complete another tenant''s job');
select throws_ok($$ select public.cleanup_old_audit_logs() $$, '42501', 'permission denied for function cleanup_old_audit_logs', 'A-1: anon can no longer purge the audit log');
select throws_ok($$ select public.get_security_settings() $$, '42501', 'permission denied for function get_security_settings', 'anon: get_security_settings is denied (no anon definer at all)');
select throws_ok($$ select public.attendance_retroactive_edit_window_days('00000000-0000-0000-0000-0000000d0b00') $$, '42501', 'permission denied for function attendance_retroactive_edit_window_days', 'anon: attendance_retroactive_edit_window_days is denied');
reset role;

-- ------------------------------------------------- tenant A school admin ----
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000d0a01';
select is(public.get_email_for_user('00000000-0000-0000-0000-0000000d0a01'), 'admin-a@example.test', 'admin A reads their own email');
select ok(public.get_security_settings() ?& array['password_min_length', 'session_timeout_minutes'],
  'a signed-in user gets the password policy and the session timeout');
select ok(not (public.get_security_settings() ?| array['login_max_attempts', 'login_attempt_window_minutes', 'login_ip_max_attempts', 'login_ip_window_minutes']),
  'a school admin does not get the platform login thresholds (L-07)');
select is(public.get_email_for_user('00000000-0000-0000-0000-0000000d0a02'), null, 'admin A cannot read another user''s email');
select is(public.get_role_for_user('00000000-0000-0000-0000-0000000d0b01'), null, 'admin A cannot read a tenant-B user''s role');
select is(public.get_tenant_id_for_user('00000000-0000-0000-0000-0000000d0b01'), null, 'admin A cannot read a tenant-B user''s tenant');
select is(public.get_role_for_user('00000000-0000-0000-0000-0000000d0a02'), 'student', 'admin A reads a same-tenant user''s role (messages policy)');
select is(public.has_module('00000000-0000-0000-0000-0000000d0b00', 'library'), false, 'admin A cannot learn tenant B''s modules');
select is(public.has_resource_permission('00000000-0000-0000-0000-0000000d0a01', 'students', 'read'), true, 'has_resource_permission answers for the caller (positive control)');
select is(public.attendance_retroactive_edit_window_days('00000000-0000-0000-0000-0000000d0b00'), 7, 'admin A gets the default, not tenant B''s attendance window (TI-1)');
select throws_ok($$ select public.create_import_job('00000000-0000-0000-0000-0000000d0b00', 'students', 100) $$, '42501', null, 'admin A cannot create an import job in tenant B');
select isnt(public.create_import_job('00000000-0000-0000-0000-0000000d0a00', 'students', 100), null, 'admin A creates an import job in their own tenant');
select throws_ok($$ select public.create_import_job('00000000-0000-0000-0000-0000000d0a00', 'evil', 100) $$, '22023', null, 'create_import_job refuses an unknown entity type');
select throws_ok($$ select public.create_import_job('00000000-0000-0000-0000-0000000d0a00', 'students', -1) $$, '22023', null, 'create_import_job refuses a negative file size');
select throws_ok($$ select public.create_import_job('00000000-0000-0000-0000-0000000d0a00', 'students', 5242881) $$, '22023', null, 'create_import_job refuses a file over 5 MB');
select throws_ok($$ select public.create_export_job('00000000-0000-0000-0000-0000000d0a00', repeat('x', 5000)) $$, '22023', null, 'create_export_job refuses an unknown entity type');
select throws_ok($$ insert into public.data_jobs (tenant_id, user_id, job_type, entity_type, status, storage_path)
                    values ('00000000-0000-0000-0000-0000000d0a00', '00000000-0000-0000-0000-0000000d0a01', 'export', 'students', 'completed', 'x/evil.csv') $$,
  '42501', null, 'even a school admin cannot insert a data_jobs row directly (the RPC is the only path)');
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
select throws_ok($$ select public.create_import_job('00000000-0000-0000-0000-0000000d0a00', 'students', 100) $$, '42501', null, 'a student cannot create an import job');
select is(public.has_resource_permission('00000000-0000-0000-0000-0000000d0a01', 'students', 'read'), null,
  'a student cannot learn a same-tenant admin''s permissions (has_resource_permission answers only for the caller)');
select is(public.has_resource_permission('00000000-0000-0000-0000-0000000d0b01', 'students', 'read'), null,
  'a student cannot learn a tenant-B admin''s permissions');
select throws_ok($$ select public.acknowledge_alert('00000000-0000-0000-0000-0000000d0a0a') $$, '42501', null, 'a student cannot acknowledge their own tenant''s alert');
select throws_ok($$ insert into public.health_alerts (tenant_id, alert_type, severity, message)
                    values ('00000000-0000-0000-0000-0000000d0a00', 'security', 'critical', 'Your account is locked, call +251') $$,
  '42501', null, 'a student cannot plant a health alert by a direct insert (A-1 through the table)');
select throws_ok($$ insert into public.system_health (tenant_id, metric_type, value, status)
                    values ('00000000-0000-0000-0000-0000000d0a00', 'cpu', 99, 'critical') $$,
  '42501', null, 'a student cannot write a health metric by a direct insert');
select throws_ok($$ insert into public.data_jobs (tenant_id, user_id, job_type, entity_type, status, storage_path)
                    values ('00000000-0000-0000-0000-0000000d0a00', '00000000-0000-0000-0000-0000000d0a02', 'export', 'students', 'completed', 'x/evil.csv') $$,
  '42501', null, 'a student cannot forge a completed data job by a direct insert');
reset role;
select is((select acknowledged_at from public.health_alerts where id = '00000000-0000-0000-0000-0000000d0a0a'), null, '... and the tenant-A alert stays unacknowledged');

-- ------------------------------------------------- platform super_admin ----
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000d0c01';
select is(public.has_module('00000000-0000-0000-0000-0000000d0b00', 'library'), true, 'super_admin reads any tenant''s modules');
select ok(public.get_security_settings() ? 'login_max_attempts', 'super_admin (who sets them) gets the login thresholds');
reset role;

-- ------------------------------------- any other role is an end user (TI-5) ----
-- Trust is an allow-list of contexts, so a role nobody planned for gets the
-- caller-only answer, not the service answer.
create role wp02_probe_role nologin;
grant usage on schema public to wp02_probe_role;
grant execute on function public.get_email_for_user(uuid), public.attendance_retroactive_edit_window_days(uuid) to wp02_probe_role;
set local role wp02_probe_role;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000d0a01';
select is(public.get_email_for_user('00000000-0000-0000-0000-0000000d0b01'), null, 'an unexpected role cannot read another user''s email');
select is(public.attendance_retroactive_edit_window_days('00000000-0000-0000-0000-0000000d0b00'), 7, 'an unexpected role gets the default attendance window for another tenant');
reset role;

-- ------------------------------------------- service_role (Edge Functions) ----
set local role service_role;
set local request.jwt.claim.sub = '';
select is(public.get_email_for_user('00000000-0000-0000-0000-0000000d0b01'), 'admin-b@example.test', 'service_role (no end-user JWT) reads any email');
select is(public.has_module('00000000-0000-0000-0000-0000000d0b00', 'library'), true, 'service_role reads any tenant''s modules');
select is(public.attendance_retroactive_edit_window_days('00000000-0000-0000-0000-0000000d0b00'), 30, 'service_role reads tenant B''s real attendance window');
reset role;

select * from finish();
rollback;
