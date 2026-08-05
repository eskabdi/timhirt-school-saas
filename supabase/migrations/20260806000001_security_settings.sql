-- ============================================================================
-- Platform-admin-configurable security settings.
--
-- Login attempt limiting (check-login-attempt) and the idle auto-logout
-- (useIdleLogout) shipped hardcoded (5/15min per account, 20/15min per IP,
-- 60min idle). This backs both by public.system_config's existing
-- system-wide rows (tenant_id is null), reusing the table/RLS that already
-- exists for exactly this purpose rather than inventing a new one --
-- system_config_write already restricts writes on tenant_id-null rows to
-- super_admin (20260719000009), which is exactly "platform admin console
-- only" with no policy change needed.
--
-- session_timeout_minutes already existed (seeded 120) but nothing ever read
-- it -- dead configuration. Its value is set to 60 here to match the idle
-- logout behaviour already shipped, so wiring it up doesn't silently change
-- effective session length for anyone before an admin ever touches this page.
--
-- get_security_settings() below is the one thing every authenticated role
-- (not just super_admin) needs read access to -- system_config_read only
-- lets school_admin/super_admin see tenant_id-null rows directly, but every
-- signed-in user needs to know the idle timeout and password policy.
-- ============================================================================
insert into public.system_config (tenant_id, key, value, value_type, description) values
  (null, 'login_max_attempts', '5'::jsonb, 'number', 'Failed sign-in attempts allowed per account before lockout'),
  (null, 'login_attempt_window_minutes', '15'::jsonb, 'number', 'Minutes a login lockout lasts, per account'),
  (null, 'login_ip_max_attempts', '20'::jsonb, 'number', 'Sign-in attempts allowed per IP address before lockout'),
  (null, 'login_ip_window_minutes', '15'::jsonb, 'number', 'Minutes a login lockout lasts, per IP address')
on conflict (tenant_id, key) do nothing;

update public.system_config
  set value = '60'::jsonb
  where tenant_id is null and key = 'session_timeout_minutes';

-- ---------------------------------------------------------------------------
-- Single round-trip for every consumer of these settings (useIdleLogout,
-- password policy validation on AcceptInvitePage/ChangePasswordModal). These
-- are policy numbers, not secrets -- security definer + explicit search_path:
-- reads only, never writes, and system_config_write's super_admin-only check
-- on tenant_id-null rows is untouched, so this cannot be used to escalate a
-- write.
--
-- `authenticated` only, not `anon`: 20260715000011 revoked schema-level USAGE
-- on public from anon as part of that migration's hardening pass, so an
-- EXECUTE grant to anon here would resolve to "permission denied for schema
-- public" and never actually work -- granting it would be a no-op that looks
-- like a real control. Every real caller (useIdleLogout inside RequireAuth,
-- AcceptInvitePage -- which already has a session by the time it needs this,
-- from the invite-token magic link -- and ChangePasswordModal) is
-- authenticated by the time it calls this, so nothing needs anon.
-- ---------------------------------------------------------------------------
create or replace function public.get_security_settings()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public.system_config
  where tenant_id is null
    and key in (
      'login_max_attempts', 'login_attempt_window_minutes',
      'login_ip_max_attempts', 'login_ip_window_minutes',
      'session_timeout_minutes',
      'password_min_length', 'password_require_uppercase',
      'password_require_numbers', 'password_require_special'
    );
$$;

revoke all on function public.get_security_settings() from public;
grant execute on function public.get_security_settings() to authenticated;

comment on function public.get_security_settings() is
  'Read-only: the platform-wide login/idle-timeout/password-policy values set '
  'at /platform/security, for any authenticated user. Writes still go through '
  'system_config directly, gated by system_config_write (super_admin only for '
  'tenant_id is null).';
