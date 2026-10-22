-- ============================================================================
-- Invite state of a school's admins, for the platform console (2026-10-17
-- code review, invite-tenant-admin status/resend).
--
-- "Accepted" used to mean email_confirmed_at or last_sign_in_at was set, but
-- GoTrue sets both when the invite link is OPENED, before any password exists:
-- a mail scanner that prefetches the link (Outlook Safe Links), or an invitee
-- who closes /accept-invite, used up the single-use link and left an admin
-- with no password who read as Active and could not be re-invited. The real
-- signal is whether a password was set (or the admin signs in through the
-- school's SSO, which never sets one), which the Auth admin API does not
-- expose, so the Edge Function asks here: one query instead of one
-- getUserById call per admin, or one row for a resend (p_user).
--
-- service_role only (WP-02: closed by default, not in the definer
-- allow-list); it refuses any other role even if granted by mistake. It
-- returns no address, hash or token: only whether each is set.
--
-- Forward fix: drop the function; invite-tenant-admin then fails its status
-- and resend actions closed (500), invites are unaffected.
-- ============================================================================
create function public.tenant_admin_invite_states(p_tenant uuid, p_user uuid default null)
returns table (user_id uuid, password_set boolean, sso_user boolean, email_confirmed boolean, invited_at timestamptz)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('role', true), 'none') not in ('none', 'service_role', 'postgres', 'supabase_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select p.id, coalesce(u.encrypted_password, '') <> '', coalesce(u.is_sso_user, false),
           u.email_confirmed_at is not null, u.invited_at
      from public.users p
      join auth.users u on u.id = p.id
     where p.tenant_id = p_tenant and p.role = 'school_admin'
       and (p_user is null or p.id = p_user)
     order by p.id
     limit 200;
end;
$$;

revoke execute on function public.tenant_admin_invite_states(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tenant_admin_invite_states(uuid, uuid) to service_role;
