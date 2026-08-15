-- ============================================================================
-- impersonation_sessions (20260901000001_impersonation.sql). Proves: only
-- super_admin can read the audit trail (not even the tenant's own
-- school_admin, not even the impersonated user themselves); no
-- authenticated role -- including super_admin -- can insert/update/delete
-- directly (client-side is read-only; the two Edge Functions write via
-- service_role, which bypasses RLS entirely and isn't exercised by pgTAP).
-- ============================================================================
begin;
select plan(6);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '99921111-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'super-imp@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99921111-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'admin-imp@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99921111-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'target-imp@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('99920000-0000-0000-0000-000000000001', 'IMP Tenant', 'rls-test-imp', 'active', 'premium');
insert into public.users (id, tenant_id, role, full_name, email) values
  ('99921111-0000-0000-0000-000000000001', null, 'super_admin', 'IMP Super', 'super-imp@test.example'),
  ('99921111-0000-0000-0000-000000000002', '99920000-0000-0000-0000-000000000001', 'school_admin', 'IMP Admin', 'admin-imp@test.example'),
  ('99921111-0000-0000-0000-000000000003', '99920000-0000-0000-0000-000000000001', 'school_admin', 'IMP Target', 'target-imp@test.example');

-- Written as postgres (simulating the service-role Edge Function) since
-- there's deliberately no client-side insert policy.
insert into public.impersonation_sessions (id, actor_id, target_user_id, target_tenant_id, reason) values
  ('99929000-0000-0000-0000-000000000001', '99921111-0000-0000-0000-000000000001', '99921111-0000-0000-0000-000000000003', '99920000-0000-0000-0000-000000000001', 'Investigating reported bug #123');

set local role authenticated;

-- ---------- select: super_admin sees it, nobody else does -------------------
set local request.jwt.claim.sub = '99921111-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.impersonation_sessions where id = '99929000-0000-0000-0000-000000000001'),
  1, 'super_admin can read the impersonation audit trail');

set local request.jwt.claim.sub = '99921111-0000-0000-0000-000000000002'; -- a different school_admin, same tenant
select is(
  (select count(*)::int from public.impersonation_sessions),
  0, 'a school_admin in the same tenant sees zero impersonation records');

set local request.jwt.claim.sub = '99921111-0000-0000-0000-000000000003'; -- the impersonated user themselves
select is(
  (select count(*)::int from public.impersonation_sessions),
  0, 'the impersonated user cannot read their own impersonation record either');

-- ---------- write: no authenticated role can insert/update directly --------
set local request.jwt.claim.sub = '99921111-0000-0000-0000-000000000001'; -- super_admin

select throws_ok(
  $$ insert into public.impersonation_sessions (actor_id, target_user_id, target_tenant_id, reason)
     values ('99921111-0000-0000-0000-000000000001', '99921111-0000-0000-0000-000000000003', '99920000-0000-0000-0000-000000000001', 'Direct client insert attempt') $$,
  '42501', null, 'even super_admin cannot insert an impersonation record directly from the client'
);

-- No UPDATE policy means an implicit "USING false" -- the statement matches
-- zero rows and succeeds without error, same RLS-filters-not-raises
-- behavior documented in portal_notifications.sql, rather than throwing.
select lives_ok(
  $$ update public.impersonation_sessions set ended_at = now() where id = '99929000-0000-0000-0000-000000000001' $$,
  'the client-side UPDATE itself runs without error (RLS filters, does not raise)'
);

select is(
  (select ended_at from public.impersonation_sessions where id = '99929000-0000-0000-0000-000000000001'),
  null, 'ended_at is still null -- the update matched zero rows under RLS');

reset role;
select * from finish();
rollback;
