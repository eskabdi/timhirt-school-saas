-- ============================================================================
-- R6 / WP-00 containment hotfix (20260924000001_r6_hotfix_contain.sql)
--
--  (1) cleanup_old_audit_logs() is executable by no API role. audit_logs is
--      the only source of grade history until the WP-08 ledger lands (RV-05).
--  (2) Telebirr gateway decommissioned (C-01, fix plan WP-03.1):
--      settle_gateway_payment() is unreachable from every API role, the token
--      cache is gone, the Telebirr integration row and Vault secrets are gone,
--      and the provider CHECK rejects 'telebirr'.
--  (3) The migration is re-runnable (fix plan Rule 3). Re-applying it voids a
--      newly-pending Telebirr order and deletes re-created Telebirr secrets,
--      and leaves manual bank payments untouched.
--
-- Replaces telebirr_gateway.sql, whose subject (the token cache and the
-- Telebirr integration row) this migration deliberately removes. Settlement
-- allocation stays covered by webhook_settlement.sql and
-- invoice_consolidation.sql.
-- ============================================================================
begin;
select plan(15);

-- ---------- (1) audit-log purge contained ----------------------------------
select ok(not has_function_privilege('anon', 'public.cleanup_old_audit_logs()', 'execute'),
  'anon cannot execute cleanup_old_audit_logs()');
select ok(not has_function_privilege('authenticated', 'public.cleanup_old_audit_logs()', 'execute'),
  'authenticated cannot execute cleanup_old_audit_logs()');
select ok(not has_function_privilege('service_role', 'public.cleanup_old_audit_logs()', 'execute'),
  'service_role cannot execute cleanup_old_audit_logs() until WP-08/WP-10 land');

-- ---------- (2) gateway settlement unreachable -----------------------------
select ok(not has_function_privilege('anon', 'public.settle_gateway_payment(text, public.payment_provider, numeric)', 'execute'),
  'anon cannot execute settle_gateway_payment()');
select ok(not has_function_privilege('authenticated', 'public.settle_gateway_payment(text, public.payment_provider, numeric)', 'execute'),
  'authenticated cannot execute settle_gateway_payment()');
select ok(not has_function_privilege('service_role', 'public.settle_gateway_payment(text, public.payment_provider, numeric)', 'execute'),
  'service_role cannot execute settle_gateway_payment() -- no Edge Function can settle a gateway order');

select hasnt_table('public', 'telebirr_token_cache', 'telebirr_token_cache (cached fabric tokens) is dropped');

select is((select count(*)::int from public.platform_integrations where provider = 'telebirr'), 0,
  'no Telebirr platform_integrations row remains');

select throws_ok(
  $stmt$ insert into public.platform_integrations (provider, display_name) values ('telebirr', 'Telebirr') $stmt$,
  '23514', null, 'provider CHECK rejects telebirr');
select throws_ok(
  $stmt$ insert into public.platform_integrations (provider, display_name) values ('chapa', 'Chapa') $stmt$,
  '23514', null, 'provider CHECK still rejects chapa');

-- ---------- fixtures for the re-run proof ----------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'e6000001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'r6-super@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('e6000000-0000-0000-0000-00000000000a', 'R6 Hotfix Tenant', 'r6-hotfix-tenant', 'active');
insert into public.users (id, tenant_id, role, full_name, email) values
  ('e6000001-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-00000000000a', 'super_admin', 'R6 Super', 'r6-super@test.example');
insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('e6001111-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-00000000000a', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('e6002222-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-00000000000a', 'e6001111-0000-0000-0000-000000000001', 'Grade 1', 'A');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('e6003333-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-00000000000a', 'e6002222-0000-0000-0000-000000000001', 'ADM-R6-001', 'Abebe', 'Kebede', '2015-01-01', 'male');
insert into public.invoice_headers (id, tenant_id, student_id, due_date) values
  ('e6009999-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-00000000000a', 'e6003333-0000-0000-0000-000000000001', '2026-08-01');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, provider_ref, status) values
  ('e6006666-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-00000000000a', 'e6009999-0000-0000-0000-000000000001', 500.00, 'telebirr', 'r6-tb-pending', 'pending'),
  ('e6007777-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-00000000000a', 'e6009999-0000-0000-0000-000000000001', 300.00, 'bank',     'r6-bank-pending', 'pending');
insert into vault.secrets (name, secret) values
  ('telebirr_fabric_app_secret', 'should-be-deleted'),
  ('telebirr_private_key_pem',   'should-be-deleted'),
  ('sms_smsala_api_key',         'must-survive');

-- ---------- (3) re-apply the migration inside this transaction -------------
\ir ../../migrations/20260924000001_r6_hotfix_contain.sql

select is((select status::text from public.payments where id = 'e6006666-0000-0000-0000-000000000001'), 'failed',
  'a pending Telebirr gateway order is voided, so it can never settle');
select is((select status::text from public.payments where id = 'e6007777-0000-0000-0000-000000000002'), 'pending',
  'a pending manual bank payment is untouched');
select is((select count(*)::int from vault.secrets where name like 'telebirr%'), 0,
  'Telebirr Vault secrets are deleted');
select is((select count(*)::int from vault.secrets where name = 'sms_smsala_api_key'), 1,
  'unrelated Vault secrets survive');

set local role authenticated;
set local request.jwt.claim.sub = 'e6000001-0000-0000-0000-000000000001';
select is((select count(*)::int from public.platform_integrations), 3,
  'super_admin sees exactly the 3 SMS providers');
reset role;

select * from finish();
rollback;
