-- ============================================================================
-- R4-D1: audited super-admin impersonation. Platform support needs to see
-- exactly what a school_admin sees to diagnose a reported problem; until
-- now that meant either trusting a screenshot or asking the tenant to share
-- their own login, neither of which this audit is willing to call
-- acceptable. impersonation_sessions is the audit trail: one row per
-- session, written by the two Edge Functions below (service_role) before
-- (start) and after (end) the actual identity swap, never by the client
-- directly -- same append-only-from-the-client model as audit_logs.
--
-- A super_admin can never impersonate another super_admin (role check in
-- impersonate-user, not just UI) -- impersonation exists to see a TENANT's
-- experience, not to quietly assume platform-staff authority.
-- ============================================================================
create table public.impersonation_sessions (
  id               uuid primary key default gen_random_uuid(),
  actor_id         uuid not null references public.users(id),
  target_user_id   uuid not null references public.users(id),
  target_tenant_id uuid references public.tenants(id),
  reason           text not null check (char_length(reason) between 3 and 500),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz
);
create index impersonation_sessions_actor on public.impersonation_sessions (actor_id, started_at desc);
create index impersonation_sessions_target on public.impersonation_sessions (target_user_id, started_at desc);

alter table public.impersonation_sessions enable row level security;
alter table public.impersonation_sessions force row level security;

-- Platform-level oversight data -- super_admin only, no tenant staff bypass.
-- No insert/update/delete policy: written exclusively by impersonate-user
-- and end-impersonation via service_role.
create policy impersonation_sessions_select on public.impersonation_sessions for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
