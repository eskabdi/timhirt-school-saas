-- Wires the previously-decorative custom-role system (roles/role_permissions/
-- user_roles, 20260719000008) into real enforcement. Until now, has_permission()
-- was the only function reading these tables, and nothing ever called it from
-- any RLS policy -- a school_admin could build a custom role's permission set
-- via the Roles page and it would have zero effect on actual access.
--
-- get_role_for_user() (20260713000001) cannot be extended to also resolve
-- custom roles: it's called directly by ~218 create policy statements across
-- the schema (bypasses/hard-gates on tables the permissions-matrix project
-- never touched -- tenants, system_config, backups, etc.), and its result is
-- cast back to the public.user_role enum in at least one policy, so returning
-- an arbitrary custom-role string from it would throw an invalid-enum-input
-- error. Custom roles therefore only ever widen access on the resources
-- already wired through has_resource_permission() -- the same scope boundary
-- every prior phase of this feature has had, not a new limitation.
--
-- Added as one new coalesce branch, additive/existence-only (role_permissions
-- is a plain membership join, same as has_permission() always assumed -- no
-- deny concept for custom roles). Placed between the per-user-override branch
-- and the fixed-role builtin_role_permission_grants branch: a role a
-- school_admin specifically assigned to this one user is more specific than
-- the blanket per-fixed-role default, same reasoning as why per-user
-- overrides already outrank role-level grants.
--
-- A third, more severe bug surfaced while writing pgTAP for this: the
-- user_permission_overrides and builtin_role_permission_grants branches
-- were the only two of the four coalesce branches missing `limit 1` on
-- their subquery. A scalar subquery that returns more than one row is a
-- hard SQL error ("more than one row returned by a subquery used as an
-- expression"), not a silent pick-one -- and the permissions catalog
-- already has two duplicate (resource, action) rows in production today
-- (employees:read and grades:read, confirmed live: one row is a leftover
-- from the older, unrelated 20260719000008 catalog seed whose key differs
-- but whose resource+action collides). Any hr_officer checking
-- employees:read, or accountant checking grades:read, already throws this
-- error in production the moment two rows exist for the same (resource,
-- action, role) in builtin_role_permission_grants -- which they now do,
-- since a prior operational task populated per-tenant default grants from
-- resource_default_role_grants by joining through `permissions`, and that
-- join fans out across the duplicate catalog rows. Fixed by adding
-- `limit 1` to both branches, matching the other two branches, which
-- already had it for exactly this reason.
--
-- A second cross-tenant gap surfaced while writing this, same class as the
-- one fixed in 20260817000005 for user_permission_overrides:
-- user_roles_admin_manage (20260719000008) only ever checked that the
-- ASSIGNMENT row's own tenant_id matched the caller's tenant -- it never
-- checked that role_id itself belongs to that same tenant. A school_admin
-- of tenant A who knew (or guessed) a tenant-B role's uuid could assign it
-- to one of their own tenant-A users via user_roles(tenant_id = A,
-- role_id = <tenant B's role>), and this new resolution branch would then
-- honor tenant B's role_permissions grants for a tenant-A user. Fixed both
-- ways (defense in depth, same pattern as 20260817000005): the write policy
-- now requires role_id to belong to the tenant being written, and the
-- resolution branch re-joins roles to independently verify the role's own
-- tenant_id matches before trusting its role_permissions.
drop policy if exists "user_roles_admin_manage" on public.user_roles;
create policy "user_roles_admin_manage" on public.user_roles for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'school_admin'
  and tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (role_id is null or exists (select 1 from public.roles r where r.id = role_id and r.tenant_id = user_roles.tenant_id))
)
with check (
  (select public.get_role_for_user(auth.uid())) = 'school_admin'
  and tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (role_id is null or exists (select 1 from public.roles r where r.id = role_id and r.tenant_id = user_roles.tenant_id))
);

create or replace function public.has_resource_permission(p_user_id uuid, p_resource text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select upo.granted
     from public.user_permission_overrides upo
     join public.permissions p on p.id = upo.permission_id
     where upo.user_id = p_user_id
       and upo.tenant_id = public.get_tenant_id_for_user(p_user_id)
       and p.resource = p_resource and p.action = p_action
     limit 1),
    (select true
     from public.user_roles ur
     join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
     join public.role_permissions rp on rp.role_id = ur.role_id
     join public.permissions p on p.id = rp.permission_id
     where ur.user_id = p_user_id
       and ur.tenant_id = public.get_tenant_id_for_user(p_user_id)
       and p.resource = p_resource and p.action = p_action
     limit 1),
    (select brpg.granted
     from public.builtin_role_permission_grants brpg
     join public.permissions p on p.id = brpg.permission_id
     where brpg.tenant_id = public.get_tenant_id_for_user(p_user_id)
       and brpg.role::text = public.get_role_for_user(p_user_id)
       and p.resource = p_resource and p.action = p_action
     limit 1),
    (select true from public.resource_open_actions
     where resource = p_resource and action = p_action limit 1),
    (select true from public.resource_default_role_grants
     where resource = p_resource and action = p_action
       and role = (public.get_role_for_user(p_user_id))::public.user_role limit 1)
  );
$$;
