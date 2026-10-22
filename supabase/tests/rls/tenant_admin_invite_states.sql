-- ============================================================================
-- 20261017000001_tenant_admin_invite_states.sql: the platform console's invite
-- status reads whether each school admin has SET A PASSWORD, not whether the
-- link was opened (a prefetched link confirms the email and signs in, with no
-- password). Only that tenant's school_admins; no address or hash returned;
-- service_role only, and the function refuses an end-user role even if a
-- grant slipped in.
-- ============================================================================
begin;
select plan(11);

insert into public.tenants (id, name, slug) values
  ('00000000-0000-0000-0000-0000000017a0', 'Invite A', 'invite-a'),
  ('00000000-0000-0000-0000-0000000017b0', 'Invite B', 'invite-b');
insert into auth.users (id, email, encrypted_password, email_confirmed_at, last_sign_in_at, invited_at) values
  -- accepted: set a password on /accept-invite
  ('00000000-0000-0000-0000-0000000017a1', 'set@example.test', '$2a$10$hash', now(), now(), now() - interval '1 day'),
  -- link opened (or prefetched by a scanner): confirmed and signed in, no password
  ('00000000-0000-0000-0000-0000000017a2', 'opened@example.test', '', now(), now(), now() - interval '1 hour'),
  -- never opened
  ('00000000-0000-0000-0000-0000000017a3', 'new@example.test', '', null, null, now()),
  ('00000000-0000-0000-0000-0000000017a4', 'teacher@example.test', '', null, null, now()),
  ('00000000-0000-0000-0000-0000000017b1', 'other@example.test', '', null, null, now());
-- signs in through the school's SSO: never a password, but accepted
insert into auth.users (id, email, encrypted_password, email_confirmed_at, last_sign_in_at, invited_at, is_sso_user) values
  ('00000000-0000-0000-0000-0000000017a5', 'sso@example.test', '', now(), now(), null, true),
-- confirmed but never signed in (email_confirmed must not be read from last_sign_in_at)
  ('00000000-0000-0000-0000-0000000017a6', 'confirmed@example.test', '', now(), null, now(), false);
insert into public.users (id, tenant_id, role, full_name, email) values
  ('00000000-0000-0000-0000-0000000017a1', '00000000-0000-0000-0000-0000000017a0', 'school_admin', 'Set Admin Person', 'set@example.test'),
  ('00000000-0000-0000-0000-0000000017a2', '00000000-0000-0000-0000-0000000017a0', 'school_admin', 'Opened Admin Person', 'opened@example.test'),
  ('00000000-0000-0000-0000-0000000017a3', '00000000-0000-0000-0000-0000000017a0', 'school_admin', 'New Admin Person', 'new@example.test'),
  ('00000000-0000-0000-0000-0000000017a4', '00000000-0000-0000-0000-0000000017a0', 'teacher', 'A Teacher Person', 'teacher@example.test'),
  ('00000000-0000-0000-0000-0000000017b1', '00000000-0000-0000-0000-0000000017b0', 'school_admin', 'Other Admin Person', 'other@example.test'),
  ('00000000-0000-0000-0000-0000000017a5', '00000000-0000-0000-0000-0000000017a0', 'school_admin', 'Sso Admin Person', 'sso@example.test'),
  ('00000000-0000-0000-0000-0000000017a6', '00000000-0000-0000-0000-0000000017a0', 'school_admin', 'Confirmed Admin Person', 'confirmed@example.test');

set local role service_role;
select is(
  (select array_agg(user_id::text || ':' || password_set || ':' || sso_user || ':' || email_confirmed order by user_id)
     from public.tenant_admin_invite_states('00000000-0000-0000-0000-0000000017a0')),
  array['00000000-0000-0000-0000-0000000017a1:true:false:true',
        '00000000-0000-0000-0000-0000000017a2:false:false:true',
        '00000000-0000-0000-0000-0000000017a3:false:false:false',
        '00000000-0000-0000-0000-0000000017a5:false:true:true',
        '00000000-0000-0000-0000-0000000017a6:false:false:true'],
  'only tenant A''s school_admins; an opened link without a password is not accepted');
select is((select count(*)::int from public.tenant_admin_invite_states('00000000-0000-0000-0000-0000000017b0')), 1,
  'tenant B sees only its own admin');
select is((select array_agg(user_id::text) from public.tenant_admin_invite_states('00000000-0000-0000-0000-0000000017a0', '00000000-0000-0000-0000-0000000017a2')),
  array['00000000-0000-0000-0000-0000000017a2'], 'p_user narrows to that one admin (a resend reads one row)');
select is((select count(*)::int from public.tenant_admin_invite_states('00000000-0000-0000-0000-0000000017b0', '00000000-0000-0000-0000-0000000017a2')), 0,
  '... and only within the named tenant');
select ok((select invited_at is not null from public.tenant_admin_invite_states('00000000-0000-0000-0000-0000000017a0') limit 1),
  'invited_at is returned');
reset role;

select is(
  (select array_agg(a order by a) from unnest((select proargnames from pg_proc where proname = 'tenant_admin_invite_states')) a),
  array['email_confirmed', 'invited_at', 'p_tenant', 'p_user', 'password_set', 'sso_user', 'user_id'],
  'returns no email, password hash or token column');

select ok(not has_function_privilege('anon', 'public.tenant_admin_invite_states(uuid, uuid)', 'execute'), 'anon cannot execute');
select ok(not has_function_privilege('authenticated', 'public.tenant_admin_invite_states(uuid, uuid)', 'execute'), 'authenticated cannot execute');
select ok(has_function_privilege('service_role', 'public.tenant_admin_invite_states(uuid, uuid)', 'execute'), 'service_role (invite-tenant-admin) can');

-- Defence in depth: even with a stray grant, an end user is refused.
grant execute on function public.tenant_admin_invite_states(uuid, uuid) to authenticated;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000017a1';
select throws_ok($c$ select * from public.tenant_admin_invite_states('00000000-0000-0000-0000-0000000017b0') $c$,
  '42501', 'forbidden', 'an end user is refused even with EXECUTE');
reset role;
select lives_ok($c$ select * from public.tenant_admin_invite_states('00000000-0000-0000-0000-0000000017a0') $c$,
  'the owner (postgres) context may call it');

select * from finish();
rollback;
