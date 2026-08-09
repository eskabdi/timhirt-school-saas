-- ============================================================================
-- Fix for a regression introduced by migration 011, caught by post-deploy
-- verification: in Postgres, a column-level REVOKE cannot subtract from a
-- table-level GRANT — `revoke select (medical_notes) ...` only removes
-- column-level grants and is a silent no-op while `grant select on students`
-- is in force. So 011's blanket grant made every 🔒 column readable by any
-- authenticated user (row-limited by RLS, but the M1 column design was void).
--
-- The correct pattern, applied here: REVOKE table-level SELECT on the four
-- tables with 🔒 columns, then GRANT an explicit column list containing
-- everything EXCEPT the sensitive columns. Fail-closed corollary: columns
-- added to these tables later are unreadable until a migration grants them.
--
-- Second problem this migration fixes: with real column grants in place, the
-- M1 re-exposing views (hr_employee_sensitive, clinic_visit_detail) can no
-- longer be security_invoker — an invoker-rights view checks the CALLER's
-- base-table column privileges, which is precisely what we just revoked, so
-- the views would fail for everyone including HR. They are switched to
-- owner-rights views owned by a dedicated NOLOGIN, non-BYPASSRLS role
-- (timhirt_view_owner) that holds SELECT on exactly the view columns, with
-- mirrored RLS policies on the base tables `TO timhirt_view_owner` that keep
-- rows tenant-scoped and gated to the authorized app roles (evaluated from
-- the caller's JWT, which is session state independent of the running role).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Real column-level SELECT restrictions (supersedes the no-op revokes in
--    migrations 002/004/007/011). INSERT/UPDATE/DELETE stay table-wide as
--    granted by 011 — the original design only restricted reads, and writers
--    of these fields (registrar, school_admin) are already gated by RLS.
-- ---------------------------------------------------------------------------
revoke select on public.students from authenticated;

grant select (id, tenant_id, user_id, class_id, admission_no, first_name,
              last_name, date_of_birth, gender, avatar_path, status,
              search_vector, created_at, updated_at)
  on public.students to authenticated;

-- 🔒 medical_notes

revoke select on public.employees from authenticated;

grant select (id, tenant_id, user_id, employee_no, employee_type, full_name,
              hire_date, status, created_at, updated_at)
  on public.employees to authenticated;

-- 🔒 tin_number, pension_no, bank_account

revoke select on public.clinic_visits from authenticated;

grant select (id, tenant_id, student_id, visit_date, guardian_notified, recorded_by)
  on public.clinic_visits to authenticated;

-- 🔒 complaint, treatment, medication

revoke select on public.health_conditions from authenticated;

grant select (id, tenant_id, student_id, effective_from, effective_to)
  on public.health_conditions to authenticated;

-- 🔒 condition

-- ---------------------------------------------------------------------------
-- 2. JWT accessor callable by the view-owner role. auth.uid() lives in the
--    auth schema, which custom roles have no USAGE on; this SECURITY DEFINER
--    wrapper (owned by postgres, which does) reads the same JWT claim. It
--    exposes nothing but the caller's own user id, so PUBLIC execute is fine.
-- ---------------------------------------------------------------------------
create or replace function public.jwt_user_id()
returns uuid language sql stable security definer set search_path = public as
$$ select auth.uid() $$;

-- ---------------------------------------------------------------------------
-- 3. Dedicated view-owner role: NOLOGIN, no BYPASSRLS, holding SELECT on
--    exactly the columns the two sensitive views project.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'timhirt_view_owner') then
    create role timhirt_view_owner nologin;
  end if;
end $$;

grant timhirt_view_owner to postgres;

grant usage on schema public to timhirt_view_owner;

grant execute on function public.jwt_user_id() to timhirt_view_owner;

grant execute on function public.get_role_for_user(uuid) to timhirt_view_owner;

grant execute on function public.get_tenant_id_for_user(uuid) to timhirt_view_owner;

grant select (id, tenant_id, user_id, tin_number, pension_no, bank_account)
  on public.employees to timhirt_view_owner;

grant select (id, tenant_id, student_id, visit_date, complaint, treatment,
              medication, guardian_notified, recorded_by)
  on public.clinic_visits to timhirt_view_owner;

-- ---------------------------------------------------------------------------
-- 4. Mirrored row policies for the view owner. These duplicate the
--    role-and-tenant gates of employees_select / clinic_select, but evaluated
--    through jwt_user_id() so they work when the executing role is
--    timhirt_view_owner rather than authenticated. This is where the
--    "only authorized roles see sensitive columns" guarantee actually lives:
--    every authenticated user may query the views, but unauthorized roles
--    get zero rows.
-- ---------------------------------------------------------------------------
drop policy if exists hr_sensitive_view_read on public.employees;

create policy hr_sensitive_view_read on public.employees for select to timhirt_view_owner
using (
  tenant_id = public.get_tenant_id_for_user(public.jwt_user_id())
  and ( public.get_role_for_user(public.jwt_user_id()) in ('school_admin','hr_officer','accountant')
        or user_id = public.jwt_user_id() )
);

drop policy if exists clinic_detail_view_read on public.clinic_visits;

create policy clinic_detail_view_read on public.clinic_visits for select to timhirt_view_owner
using (
  tenant_id = public.get_tenant_id_for_user(public.jwt_user_id())
  and public.get_role_for_user(public.jwt_user_id()) = 'school_admin'
);

-- ---------------------------------------------------------------------------
-- 5. Flip the views to owner-rights (+ security_barrier so a hostile
--    function in a caller's WHERE clause can't observe rows before the
--    policy filter) and hand them to the dedicated owner. Existing view
--    grants (select to authenticated, nothing to anon) carry over unchanged.
-- ---------------------------------------------------------------------------
alter view public.hr_employee_sensitive set (security_invoker = false, security_barrier = true);

alter view public.clinic_visit_detail set (security_invoker = false, security_barrier = true);

-- Ownership transfer requires the incoming owner to hold CREATE on the
-- schema; grant it only for the transfer, then revoke — the role's steady
-- state is USAGE + the column SELECTs above, nothing more.
grant create on schema public to timhirt_view_owner;

alter view public.hr_employee_sensitive owner to timhirt_view_owner;

alter view public.clinic_visit_detail owner to timhirt_view_owner;

revoke create on schema public from timhirt_view_owner;
