-- ============================================================================
-- HIGH fix: attendance was the only governance-sensitive table in this
-- schema without audit_trigger attached (students, grades, employees all
-- have it), and any teacher or school_admin could silently rewrite a past
-- date's record with no restriction beyond "same tenant, own class."
--
-- Part 1 -- audit trail: attach the same audit_trigger already used on
-- grades/students/fee_invoices/payments. No new mechanism.
--
-- Part 2 -- retroactive-edit gate: reuses has_resource_permission(), the
-- resource-permission system attendance is already wired into
-- (20260817000002_resource_permissions_academics.sql -- 'attendance:read'/
-- 'create'/'update' already gate the three existing permissive policies).
-- A new action, 'override_retroactive', is added the same way: a
-- `permissions` catalog row (so it's visible/manageable through the
-- existing Access Management UI, consistent with attendance's other three
-- actions) plus a resource_default_role_grants row giving school_admin the
-- override by default, matching who already has full 'update' access
-- today -- no role gains anything it doesn't already effectively have; this
-- only takes something away from everyone else (plain teachers) for edits
-- past the window.
--
-- Enforcement is one additional RESTRICTIVE policy on UPDATE only --
-- exactly the pattern proven in 20260821000003 (module gating): it ANDs
-- against the three existing PERMISSIVE policies without editing any of
-- them. INSERT is untouched -- a teacher backdating a *first* entry for a
-- day they forgot to mark is normal school operation and already
-- attributed/audited (recorded_by is server-stamped, audit_trigger logs
-- the insert); the finding is specifically about *rewriting* an
-- already-recorded day, which is only ever an UPDATE.
--
-- The window is configurable per-tenant via
-- tenant_configs.settings->>'attendance_retroactive_edit_days' (the same
-- jsonb settings blob CalendarPreferencesPage.tsx already writes to),
-- defaulting to 7 when unset -- reuses that existing per-tenant config
-- store rather than adding a new settings table for one number.
-- ============================================================================

create trigger audit_attendance after insert or update or delete on public.attendance
for each row execute function public.audit_trigger();

create or replace function public.attendance_retroactive_edit_window_days(p_tenant_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (tc.settings->>'attendance_retroactive_edit_days')::int
     from public.tenant_configs tc where tc.tenant_id = p_tenant_id),
    7
  );
$$;

insert into public.permissions (key, module, resource, action, description) values
  ('attendance:override_retroactive', 'attendance', 'attendance', 'override_retroactive',
   'Edit an attendance record older than the tenant''s retroactive-edit window')
on conflict (key) do nothing;

insert into public.resource_default_role_grants (resource, action, role) values
  ('attendance', 'override_retroactive', 'school_admin')
on conflict (resource, action, role) do nothing;

create policy attendance_retroactive_edit_gate on public.attendance
as restrictive for update to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or attendance_date >= current_date - (public.attendance_retroactive_edit_window_days(tenant_id) || ' days')::interval
  or public.has_resource_permission(auth.uid(), 'attendance', 'override_retroactive')
);
