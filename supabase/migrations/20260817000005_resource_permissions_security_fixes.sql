-- Two bugs found in code review of 20260816000001/20260817000001-4:
--
-- 1. CRITICAL: user_permission_overrides_write's USING/WITH CHECK verified
--    only that tenant_id matched the caller's own tenant and that the caller
--    was school_admin -- it never verified the override row's target
--    user_id actually belonged to that tenant. has_resource_permission()'s
--    override branch then resolved purely on `upo.user_id = p_user_id`,
--    ignoring the override row's own tenant_id entirely. A school_admin of
--    tenant A could upsert an override row with tenant_id = A but
--    user_id = a user in tenant B, and that grant/deny would apply the
--    moment the tenant-B user's own permission checks ran -- a cross-tenant
--    privilege-escalation path with no RLS violation raised anywhere.
--    Fixed two ways (defense in depth): the write policy now requires the
--    target user to belong to the tenant being written, AND the resolution
--    function additionally re-scopes the override lookup by the *acting*
--    user's real tenant, so even a pre-existing bad row (or any future
--    insert path that bypasses this policy) can't grant across tenants.
--
-- 2. report_templates write access was seeded as school_admin-only in
--    20260817000002, but the pre-existing policy
--    (20260720000002_profile_and_screen_fields.sql:67-71) granted
--    school_admin, registrar, AND accountant -- contradicting that
--    migration's own "transcribed literally, never invented" claim.
--    Every registrar/accountant would have silently lost Custom Report
--    Builder write access the moment 20260817000002 deployed. Backfilled.

drop policy if exists user_permission_overrides_write on public.user_permission_overrides;
create policy user_permission_overrides_write on public.user_permission_overrides for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin'
       and exists (select 1 from public.users u where u.id = user_id and u.tenant_id = user_permission_overrides.tenant_id))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin'
       and exists (select 1 from public.users u where u.id = user_id and u.tenant_id = user_permission_overrides.tenant_id));

create or replace function public.has_resource_permission(p_user_id uuid, p_resource text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select upo.granted
     from public.user_permission_overrides upo
     join public.permissions p on p.id = upo.permission_id
     where upo.user_id = p_user_id
       and upo.tenant_id = public.get_tenant_id_for_user(p_user_id)
       and p.resource = p_resource and p.action = p_action),
    (select brpg.granted
     from public.builtin_role_permission_grants brpg
     join public.permissions p on p.id = brpg.permission_id
     where brpg.tenant_id = public.get_tenant_id_for_user(p_user_id)
       and brpg.role::text = public.get_role_for_user(p_user_id)
       and p.resource = p_resource and p.action = p_action),
    (select true from public.resource_open_actions
     where resource = p_resource and action = p_action limit 1),
    (select true from public.resource_default_role_grants
     where resource = p_resource and action = p_action
       and role = (public.get_role_for_user(p_user_id))::public.user_role limit 1)
  );
$$;

insert into public.resource_default_role_grants (resource, action, role) values
  ('report_templates', 'create', 'registrar'), ('report_templates', 'create', 'accountant'),
  ('report_templates', 'update', 'registrar'), ('report_templates', 'update', 'accountant'),
  ('report_templates', 'delete', 'registrar'), ('report_templates', 'delete', 'accountant')
on conflict do nothing;
