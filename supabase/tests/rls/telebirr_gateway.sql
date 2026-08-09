-- ============================================================================
-- Telebirr gateway migration (20260818000001): proves
-- (1) settle_gateway_payment is genuinely provider-agnostic -- the exact
--     same replay-guard/amount-check/credit contract webhook_settlement.sql
--     proves for 'chapa' also holds for 'telebirr', with no code change to
--     the function itself;
-- (2) platform_integrations.config (the new jsonb column carrying Telebirr's
--     non-secret credentials) is gated by the SAME existing super_admin-only
--     select policy -- a whole-row select, so no new policy was needed, but
--     that's an assumption worth proving rather than trusting;
-- (3) the stricter provider CHECK genuinely rejects 'chapa'/'stripe' inserts
--     now that they're canceled, and the migration's own
--     `delete ... where provider in ('chapa','stripe')` really did run
--     before the constraint was added (an ordering bug here would have left
--     the old rows in place, violating the new CHECK at migration time --
--     the fact this migration applied at all is *some* evidence, but this
--     suite re-proves the end state directly);
-- (4) telebirr_token_cache (service_role-only, zero policies, same shape as
--     webhook_events) is unreachable via PostgREST for every authenticated
--     role, super_admin included -- fabric tokens must never be client-
--     readable.
-- ============================================================================
begin;
select plan(18);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'fb000001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'tb-admin@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'fb000002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'tb-registrar@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('fb000000-0000-0000-0000-00000000000a', 'TB Tenant', 'tb-tenant', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('fb000001-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-00000000000a', 'super_admin', 'TB Super Admin', 'tb-admin@test.example'),
  ('fb000002-0000-0000-0000-000000000002', 'fb000000-0000-0000-0000-00000000000a', 'registrar', 'TB Registrar', 'tb-registrar@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('fb001111-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-00000000000a', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('fb002222-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-00000000000a', 'fb001111-0000-0000-0000-000000000001', 'Grade 1', 'A');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('fb003333-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-00000000000a', 'fb002222-0000-0000-0000-000000000001', 'ADM-TB-001', 'Test', 'Student', '2015-01-01', 'male');
insert into public.fee_structures (id, tenant_id, name_i18n, amount, billing_cycle) values
  ('fb004444-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-00000000000a', '{"en":"Tuition"}', 500, 'monthly');
insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, amount_paid, due_date, status) values
  ('fb005555-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-00000000000a', 'fb003333-0000-0000-0000-000000000001', 'fb004444-0000-0000-0000-000000000001', 500.00, 0.00, '2026-08-01', 'pending');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, provider_ref, status) values
  ('fb006666-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-00000000000a', 'fb005555-0000-0000-0000-000000000001', 500.00, 'telebirr', 'tb-ref-correct', 'pending'),
  ('fb007777-0000-0000-0000-000000000002', 'fb000000-0000-0000-0000-00000000000a', 'fb005555-0000-0000-0000-000000000001', 250.00, 'telebirr', 'tb-ref-mismatch', 'pending');

-- ---------- (1) settle_gateway_payment is provider-agnostic: 'telebirr' ----------
select is(
  public.settle_gateway_payment('tb-ref-does-not-exist', 'telebirr', 500.00),
  'not_found', 'Unknown tx_ref reports not_found for provider=telebirr, same as chapa');

select is(
  public.settle_gateway_payment('tb-ref-correct', 'telebirr', 500.00),
  'ok', 'Correct-amount telebirr settlement returns ok');

select is(
  (select status from public.payments where provider_ref = 'tb-ref-correct'),
  'succeeded', 'Telebirr payment flips to succeeded exactly once');

select is(
  (select amount_paid from public.fee_invoices where id = 'fb005555-0000-0000-0000-000000000001'),
  500.00::numeric, 'Invoice amount_paid credited exactly once for a telebirr settlement');

select is(
  (select status from public.fee_invoices where id = 'fb005555-0000-0000-0000-000000000001'),
  'paid', 'Invoice status flips to paid once a telebirr payment fully covers it');

select is(
  public.settle_gateway_payment('tb-ref-correct', 'telebirr', 500.00),
  'duplicate', 'Replaying the same telebirr tx_ref reports duplicate, not ok');

select is(
  (select amount_paid from public.fee_invoices where id = 'fb005555-0000-0000-0000-000000000001'),
  500.00::numeric, 'Replay does NOT double-credit the invoice');

select is(
  public.settle_gateway_payment('tb-ref-mismatch', 'telebirr', 999.00),
  'amount_mismatch', 'Gateway-reported amount mismatch is rejected for telebirr too, not credited');

-- ---------- (2) platform_integrations.config gating ----------
set local role authenticated;
set local request.jwt.claim.sub = 'fb000001-0000-0000-0000-000000000001'; -- super_admin

select is(
  (select config from public.platform_integrations where provider = 'telebirr'),
  '{}'::jsonb, 'super_admin can select the new config column on the telebirr row');

select is(
  (select count(*)::int from public.platform_integrations),
  4, 'super_admin sees all 4 remaining providers (telebirr + 3 sms) -- chapa/stripe are gone');

set local request.jwt.claim.sub = 'fb000002-0000-0000-0000-000000000002'; -- registrar

select is(
  (select count(*)::int from public.platform_integrations),
  0, 'a registrar (not super_admin) sees zero platform_integrations rows, config column included');

-- ---------- (3) provider CHECK genuinely rejects chapa/stripe ----------
set local role postgres;
reset request.jwt.claim.sub;

select throws_ok(
  $stmt$ insert into public.platform_integrations (provider, display_name) values ('chapa', 'Chapa (ETB payments)') $stmt$,
  '23514', null, 'inserting provider=chapa is rejected by the stricter post-migration CHECK');

select throws_ok(
  $stmt$ insert into public.platform_integrations (provider, display_name) values ('stripe', 'Stripe (international)') $stmt$,
  '23514', null, 'inserting provider=stripe is rejected by the stricter post-migration CHECK');

select is(
  (select count(*)::int from public.platform_integrations where provider in ('chapa', 'stripe')),
  0, 'no chapa/stripe rows survived the migration -- the delete genuinely ran before the CHECK was added');

-- ---------- (4) telebirr_token_cache unreachable by any authenticated role ----------
insert into public.telebirr_token_cache (token, effective_at, expires_at)
values ('test-token', now(), now() + interval '1 hour');

set local role authenticated;
set local request.jwt.claim.sub = 'fb000001-0000-0000-0000-000000000001'; -- super_admin, even

select is(
  (select count(*)::int from public.telebirr_token_cache),
  0, 'telebirr_token_cache is invisible even to super_admin -- zero policies means zero access for every non-service_role');

select throws_ok(
  $stmt$ insert into public.telebirr_token_cache (token, effective_at, expires_at)
         values ('forged-token', now(), now() + interval '1 hour') $stmt$,
  '42501', null, 'super_admin cannot insert into telebirr_token_cache -- fabric tokens are service_role-only, no exceptions');

-- RLS filters rather than raises for UPDATE with no matching USING policy
-- (same "runs, but matches nothing" behavior security_settings.sql already
-- documents for system_config) -- the real assertion is that the value is
-- provably unchanged afterward, proven with a service_role read below.
select lives_ok(
  $stmt$ update public.telebirr_token_cache set token = 'hijacked' $stmt$,
  'super_admin''s update to telebirr_token_cache runs but (per RLS) matches nothing');

set local role postgres;
reset request.jwt.claim.sub;

select is(
  (select token from public.telebirr_token_cache limit 1),
  'test-token', 'telebirr_token_cache''s token is unchanged after the blocked super_admin update attempt');

select * from finish();
rollback;
