-- ============================================================================
-- CRITICAL fix: tenant suspension did not restrict anything. No RLS policy
-- anywhere checks tenants.status -- live-verified before this fix: a
-- suspended QA tenant's school_admin could still log in, read, and write
-- every table.
--
-- Every tenant-scoped RLS policy in the schema (362 of them) resolves the
-- caller's tenant through get_tenant_id_for_user(auth.uid()) and matches
-- rows with `tenant_id = get_tenant_id_for_user(...)`. Rather than touch
-- those 362 policies individually (large, separately-risked surface), this
-- narrows the single shared helper: for a non-super_admin caller whose
-- tenant is suspended, it now returns NULL instead of the real tenant_id.
-- Every policy of the form `tenant_id = get_tenant_id_for_user(...)` then
-- compares each row's real tenant_id to NULL, which is never true (NULL
-- comparisons are neither true nor false in SQL, so the row is excluded) --
-- so a suspended tenant's users get zero rows on every read and are
-- rejected on every write, with no policy rewritten.
--
-- super_admin is unaffected: that role's own tenant_id is already NULL
-- (platform staff aren't tenant members), so the `u.role = 'super_admin'`
-- branch below is a no-op for it in practice -- included for clarity, not
-- because it changes behavior for that role.
--
-- Login itself is untouched (GoTrue does not consult this function), so a
-- suspended tenant's admin can still authenticate -- matching the fix
-- description: "login itself may still succeed", it's tenant data access
-- (every RLS-gated table) that is now empty/denied.
-- ============================================================================

create or replace function public.get_tenant_id_for_user(user_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select u.tenant_id
  from public.users u
  where u.id = user_id
    and (
      u.role = 'super_admin'
      or not exists (
        select 1 from public.tenants t
        where t.id = u.tenant_id and t.status = 'suspended'
      )
    )
$$;
