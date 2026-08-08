-- ============================================================================
-- Role/user permissions matrix (pilot).
--
-- 20260719000008 ("Advanced role and permission management") built
-- roles/permissions/role_permissions/user_roles plus a
-- has_permission(p_user_id, p_permission_key) function, but it was never
-- actually wired anywhere: has_permission() is called by no RLS policy, no
-- Edge Function, and no frontend code, and user_roles (which would assign a
-- user to one of RolesPage's custom roles) has no UI at all -- a
-- school_admin can build a custom role and grant it permissions but can
-- never put anyone in it. That system is left completely untouched here;
-- fixing it is a separate, unrelated gap. This migration builds the
-- genuinely-wired version the user asked for, under different names so
-- nothing collides with the existing (inert) tables/function.
--
-- Reuses the existing `permissions` catalog table (key/module/resource/
-- action, no CHECK on action) rather than inventing a parallel one -- a
-- clean, additive extension.
--
-- Two new tables:
--   - builtin_role_permission_grants: per-tenant, per-BUILT-IN-role (the
--     public.user_role enum everything else in this app's RLS already
--     keys on) grant, distinct from the existing role_permissions (which
--     keys off custom roles.id that nothing can be assigned to).
--   - user_permission_overrides: per-user exception layered on top of the
--     role grant. A row's existence IS the override signal; no row means
--     "use the role default."
--
-- Pilot resources: classes, subjects, fee_structures, calendar_events --
-- the four tables 20260713000005's generic role-loop macro gave the
-- identical policy shape (read = same tenant; write = school_admin only).
-- That uniformity makes them a clean, low-risk, representative slice to
-- convert to matrix-driven RLS; every other table's RLS (including
-- academic_years/academic_terms, also in that original array) is
-- untouched. Extending coverage to higher-value/higher-risk resources
-- (students, grades, attendance, payroll) is the same mechanical pattern,
-- deliberately left for later once this pilot is proven.
--
-- Compatibility guarantee: a tenant that never configures either new table
-- must see EXACTLY today's behavior -- read stays open tenant-wide, writes
-- stay school_admin-only. has_resource_permission()'s third COALESCE branch
-- is what makes that true; the pgTAP suite proves it as a regression check,
-- not an assumption.
-- ============================================================================

insert into public.permissions (key, module, resource, action, description) values
  ('classes:create', 'academics', 'classes', 'create', 'Create classes'),
  ('classes:read',   'academics', 'classes', 'read',   'View classes'),
  ('classes:update', 'academics', 'classes', 'update', 'Edit classes'),
  ('classes:delete', 'academics', 'classes', 'delete', 'Delete classes'),
  ('subjects:create', 'academics', 'subjects', 'create', 'Create subjects'),
  ('subjects:read',   'academics', 'subjects', 'read',   'View subjects'),
  ('subjects:update', 'academics', 'subjects', 'update', 'Edit subjects'),
  ('subjects:delete', 'academics', 'subjects', 'delete', 'Delete subjects'),
  ('fee_structures:create', 'fees', 'fee_structures', 'create', 'Create fee structures'),
  ('fee_structures:read',   'fees', 'fee_structures', 'read',   'View fee structures'),
  ('fee_structures:update', 'fees', 'fee_structures', 'update', 'Edit fee structures'),
  ('fee_structures:delete', 'fees', 'fee_structures', 'delete', 'Delete fee structures'),
  ('calendar_events:create', 'calendar', 'calendar_events', 'create', 'Create calendar events'),
  ('calendar_events:read',   'calendar', 'calendar_events', 'read',   'View calendar events'),
  ('calendar_events:update', 'calendar', 'calendar_events', 'update', 'Edit calendar events'),
  ('calendar_events:delete', 'calendar', 'calendar_events', 'delete', 'Delete calendar events')
on conflict (key) do nothing;

create table public.builtin_role_permission_grants (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  role          public.user_role not null,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  granted       boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (tenant_id, role, permission_id)
);
create index builtin_role_permission_grants_tenant_idx on public.builtin_role_permission_grants (tenant_id);

create table public.user_permission_overrides (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  user_id       uuid not null references public.users(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  granted       boolean not null,
  created_at    timestamptz not null default now(),
  unique (tenant_id, user_id, permission_id)
);
create index user_permission_overrides_tenant_idx on public.user_permission_overrides (tenant_id);
create index user_permission_overrides_user_idx on public.user_permission_overrides (user_id);

alter table public.builtin_role_permission_grants enable row level security;
alter table public.builtin_role_permission_grants force row level security;
create policy builtin_role_permission_grants_select on public.builtin_role_permission_grants for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
create policy builtin_role_permission_grants_write on public.builtin_role_permission_grants for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin');

alter table public.user_permission_overrides enable row level security;
alter table public.user_permission_overrides force row level security;
create policy user_permission_overrides_select on public.user_permission_overrides for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
create policy user_permission_overrides_write on public.user_permission_overrides for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin');

-- security definer mirrors get_tenant_id_for_user/get_role_for_user's own
-- pattern -- avoids RLS recursion when called from inside another table's
-- policy (this function is queried FROM the pilot resources' own RLS).
create or replace function public.has_resource_permission(p_user_id uuid, p_resource text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select upo.granted
     from public.user_permission_overrides upo
     join public.permissions p on p.id = upo.permission_id
     where upo.user_id = p_user_id and p.resource = p_resource and p.action = p_action),
    (select brpg.granted
     from public.builtin_role_permission_grants brpg
     join public.permissions p on p.id = brpg.permission_id
     where brpg.tenant_id = public.get_tenant_id_for_user(p_user_id)
       and brpg.role::text = public.get_role_for_user(p_user_id)
       and p.resource = p_resource and p.action = p_action),
    case when p_action = 'read' then true
         else public.get_role_for_user(p_user_id) = 'school_admin' end
  );
$$;

-- ---------- rewire the 4 pilot resources onto the matrix --------------------
do $$
declare t text;
begin
  foreach t in array array['classes', 'subjects', 'fee_structures', 'calendar_events']
  loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('drop policy if exists %1$s_write on public.%1$I', t);

    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated using (
        (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
         and public.has_resource_permission(auth.uid(), %1$L, 'read'))
        or (select public.get_role_for_user(auth.uid())) = 'super_admin')$f$, t);
    execute format($f$
      create policy %1$s_insert on public.%1$I for insert to authenticated with check (
        tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        and public.has_resource_permission(auth.uid(), %1$L, 'create'))$f$, t);
    execute format($f$
      create policy %1$s_update on public.%1$I for update to authenticated
      using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and public.has_resource_permission(auth.uid(), %1$L, 'update'))
      with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and public.has_resource_permission(auth.uid(), %1$L, 'update'))$f$, t);
    execute format($f$
      create policy %1$s_delete on public.%1$I for delete to authenticated using (
        tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        and public.has_resource_permission(auth.uid(), %1$L, 'delete'))$f$, t);
  end loop;
end $$;
