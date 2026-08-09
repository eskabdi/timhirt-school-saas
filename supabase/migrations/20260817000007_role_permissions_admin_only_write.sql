-- CRITICAL, found by independent review of 20260817000006 minutes after it
-- deployed: role_permissions_tenant_isolation (20260719000008) was `for all`
-- (covers select/insert/update/delete) and checked only that role_id
-- belonged to the caller's own tenant -- never that the caller was
-- school_admin. Every sibling table already has that check: roles_admin_manage,
-- user_roles_admin_manage, builtin_role_permission_grants_write,
-- user_permission_overrides_write all require school_admin on writes.
-- role_permissions never got it.
--
-- Before 20260817000006 this was inert: role_permissions was read only by
-- the dead has_permission() function, which no RLS policy called, so writing
-- to it had zero effect on real access. 20260817000006 wired role_permissions
-- into has_resource_permission()'s live resolution -- making its contents
-- authoritative for ~65 tenant-business tables -- without re-auditing this
-- policy alongside the other write-path fix it did make (user_roles_admin_manage).
--
-- Concrete exploit (live-proven against real Postgres before this fix): any
-- tenant member holding ANY custom role (assigned via user_roles, the normal
-- state once a school uses this feature) can directly insert/delete
-- role_permissions rows for that same role_id -- which `roles_tenant_isolation`
-- lets any tenant member discover via a plain select -- granting themselves,
-- or any other user assigned that role_id, arbitrary catalog permissions
-- (payroll:approve, backups:manage, users:manage, etc.) within their tenant.
--
-- Split into a public tenant-scoped read (matching roles_tenant_isolation's
-- own precedent -- which role has which permission is not sensitive) and an
-- admin-only write, exactly mirroring roles_admin_manage's shape.
drop policy if exists "role_permissions_tenant_isolation" on public.role_permissions;

create policy "role_permissions_tenant_isolation" on public.role_permissions for select to authenticated using (
  role_id in (select id from public.roles where tenant_id = (select public.get_tenant_id_for_user(auth.uid())))
);

create policy "role_permissions_admin_manage" on public.role_permissions for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'school_admin'
  and role_id in (select id from public.roles where tenant_id = (select public.get_tenant_id_for_user(auth.uid())))
)
with check (
  (select public.get_role_for_user(auth.uid())) = 'school_admin'
  and role_id in (select id from public.roles where tenant_id = (select public.get_tenant_id_for_user(auth.uid())))
);
