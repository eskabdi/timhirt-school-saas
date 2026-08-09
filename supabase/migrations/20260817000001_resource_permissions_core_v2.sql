-- ============================================================================
-- Role/user permissions matrix -- Phase 2 core: resource-aware defaults.
--
-- 20260816000001 (the pilot) hardcoded has_resource_permission()'s fallback
-- to one universal default: read = open to anyone in the tenant, write =
-- school_admin only. That was true for all 4 tables the pilot touched, but
-- research across the rest of the schema (done before this migration was
-- written) found it is NOT true broadly:
--   - moe_exports, hostel_visitor_logs, clinic_visits, health_conditions,
--     notification_log restrict READ to school_admin only today -- reusing
--     the old "read = true" fallback on these would silently expose
--     clinic/health/ministry-export data tenant-wide the moment they're
--     converted.
--   - teachers, id_cards/id_card_batches, library_books,
--     assignment_sections/assignment_attachments have a WRITE population
--     wider than "school_admin only" (school_admin+hr_officer, or
--     school_admin+librarian, or school_admin+teacher).
--   - Several tables have NO super_admin bypass at all today
--     (employee_salary_components, leave_balances, staff_attendance,
--     payroll_runs, clinic_visits, health_conditions, hostel_visitor_logs,
--     student_route_assignments, id_cards, id_card_batches,
--     notification_log) -- that absence is preserved by later migrations,
--     not "fixed" here; this migration only adds the machinery that lets
--     each resource carry its own accurate default.
--
-- This migration replaces the one-size-fits-all fallback with two lookup
-- tables the resolution function consults per resource+action:
--   - resource_open_actions: "any authenticated tenant member passes,
--     regardless of role" -- for actions that are genuinely unrestricted
--     today (e.g. classes:read).
--   - resource_default_role_grants: "these specific roles pass" -- for
--     actions gated to a fixed staff-role list today (e.g.
--     fee_structures:create -> school_admin).
-- Every row inserted anywhere in this Phase-2 body of work is transcribed
-- literally from a table's CURRENT policy text (see the domain migrations
-- that follow this one) -- never invented or copied from a different
-- resource's shape.
--
-- Scope of THIS migration: only the 4 resources already wired by the pilot
-- (classes, subjects, fee_structures, calendar_events) get default rows
-- here, because those are the only ones whose RLS currently calls
-- has_resource_permission() at all -- rewriting the function is a pure
-- refactor for them, proven by re-running the pilot's own pgTAP assertions
-- against it. Every other resource gets its permissions/defaults/RLS rewire
-- together, atomically, in its own domain migration -- nothing is seeded
-- here that isn't already live.
-- ============================================================================

create table public.resource_open_actions (
  resource text not null,
  action   text not null,
  primary key (resource, action)
);

create table public.resource_default_role_grants (
  resource text not null,
  action   text not null,
  role     public.user_role not null,
  primary key (resource, action, role)
);

insert into public.resource_open_actions (resource, action) values
  ('classes', 'read'), ('subjects', 'read'), ('fee_structures', 'read'), ('calendar_events', 'read');

insert into public.resource_default_role_grants (resource, action, role) values
  ('classes', 'create', 'school_admin'), ('classes', 'update', 'school_admin'), ('classes', 'delete', 'school_admin'),
  ('subjects', 'create', 'school_admin'), ('subjects', 'update', 'school_admin'), ('subjects', 'delete', 'school_admin'),
  ('fee_structures', 'create', 'school_admin'), ('fee_structures', 'update', 'school_admin'), ('fee_structures', 'delete', 'school_admin'),
  ('calendar_events', 'create', 'school_admin'), ('calendar_events', 'update', 'school_admin'), ('calendar_events', 'delete', 'school_admin');

-- Rewritten resolution function. Same override -> role-grant precedence as
-- before; only the final fallback changes shape. Each sub-select returns
-- NULL (not false) when it doesn't apply, so coalesce falls through to the
-- next branch -- this is why the lookups are `select true ... limit 1`, not
-- `exists(...)` (exists always returns true/false, never null, which would
-- short-circuit the chain on the first non-match instead of falling
-- through).
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
    (select true from public.resource_open_actions
     where resource = p_resource and action = p_action limit 1),
    (select true from public.resource_default_role_grants
     where resource = p_resource and action = p_action
       and role = (public.get_role_for_user(p_user_id))::public.user_role limit 1)
  );
$$;
