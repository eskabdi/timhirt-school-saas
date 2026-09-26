-- ============================================================================
-- R6 WP-02 — Lock down SECURITY DEFINER RPCs (H-01, L-07, G-10).
--
-- Production had 42 SECURITY DEFINER functions in `public` executable by anon
-- (Supabase's default privileges grant anon/authenticated/service_role an
-- explicit EXECUTE on every new function, and `revoke … from public` never
-- removed it) and 13 without a pinned search_path. Several also trusted a
-- caller-supplied tenant or user id:
--   * get_email_for_user(uuid)      any user's email, to anyone
--   * get_role_for_user / get_tenant_id_for_user(uuid)   any user's role/tenant
--   * create_export_job / create_import_job(p_tenant_id)  a job in any tenant
--   * acknowledge_alert(uuid)       any tenant's health alert
--   * get_config / is_feature_enabled(…, p_tenant_id)     any tenant's config
--   * has_module(p_tenant_id, …) / has_resource_permission(p_user_id, …)
--
-- This migration:
--   1. Revokes EXECUTE on every public SECURITY DEFINER function from PUBLIC,
--      anon and authenticated, and pins search_path = public, pg_temp
--      (pg_temp last, so a temp table cannot shadow a table name).
--   2. Re-grants from one allow-list (supabase/security/definer_allowlist.sql
--      is the reviewed copy; catalog_definer_security.sql asserts the catalog
--      matches it exactly):
--        authenticated — RLS helpers called by policies, and the RPCs the app
--                        calls directly;
--        anon          — nothing;
--        timhirt_view_owner — the three helpers its view policies call.
--      service_role keeps its explicit grant on everything (Edge Functions).
--      Trigger functions need no grant: EXECUTE is checked at CREATE TRIGGER.
--   3. Makes the helpers that take a user or tenant id answer only for the
--      caller (or for any id in a trusted context: service_role, cron,
--      migrations), scopes the job/alert RPCs to the caller's tenant and
--      validates their input, keeps the login thresholds from end users, and
--      drops the three table policies that let any role write what the
--      locked-down RPCs guard (health_alerts, system_health, data_jobs).
--   4. Makes future functions start closed: postgres's default privileges no
--      longer grant EXECUTE to PUBLIC, anon or authenticated in public.
--   5. FORCE ROW LEVEL SECURITY on the 11 tables that lacked it (their owner,
--      postgres, has BYPASSRLS in production, so migrations and cron are
--      unaffected; audit/evidence/wp02-prod-owners-bypassrls-defacl-*.txt).
--
-- Validated on the harness (Supabase-faithful grants, R6 WP-01): the full
-- pgTAP run stays green, which proves the allow-list is complete for every
-- policy and RPC path the suites exercise, and definer_lockdown.sql probes
-- each closed path as anon and cross-tenant.
-- Rollback: re-grant EXECUTE to the listed roles; the body changes only narrow
-- answers to other users/tenants and can be reverted by re-running the
-- previous CREATE OR REPLACE from the earlier migrations.
-- ============================================================================

-- 1. Close everything, pin search_path ------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

-- 3. Helpers that took someone else's id -----------------------------------
-- End users reach the database as the `authenticated` or `anon` role (PostgREST
-- SET ROLE). Inside a SECURITY DEFINER function current_user is the owner, but
-- the `role` setting still names the invoking role, so it tells an end user
-- apart from the trusted contexts: service_role (Edge Functions), and a
-- session that never SET ROLE ('none': migrations, cron, direct postgres
-- connections) or runs as postgres/supabase_admin. The trusted set is an
-- allow-list (review TI-5/SEC-6): any other role, including one added later,
-- gets the end-user answer. An end user only ever gets answers about
-- themselves, or (role/tenant) about a user in their own tenant, which is what
-- the messages recipient policy needs.

create or replace function public.get_email_for_user(user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.email from public.users u
  where u.id = user_id
    and (user_id = auth.uid() or coalesce(current_setting('role', true), 'none') in ('none', 'service_role', 'postgres', 'supabase_admin'))
$$;

create or replace function public.get_tenant_id_for_user(user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
    and (
      user_id = auth.uid()
      or coalesce(current_setting('role', true), 'none') in ('none', 'service_role', 'postgres', 'supabase_admin')
      or u.tenant_id = (select c.tenant_id from public.users c where c.id = auth.uid())
    )
$$;

create or replace function public.get_role_for_user(user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.role::text
  from public.users u
  where u.id = user_id
    and (
      user_id = auth.uid()
      or coalesce(current_setting('role', true), 'none') in ('none', 'service_role', 'postgres', 'supabase_admin')
      or u.tenant_id = (select c.tenant_id from public.users c where c.id = auth.uid())
    )
$$;

-- has_resource_permission: the current body (latest definition, from
-- 20260817000004 onwards) unchanged, answering only for the caller: policies
-- always pass auth.uid(); service_role/cron (no JWT) may ask about anyone.
create or replace function public.has_resource_permission(p_user_id uuid, p_resource text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when coalesce(current_setting('role', true), 'none') not in ('none', 'service_role', 'postgres', 'supabase_admin') and p_user_id is distinct from auth.uid() then null else coalesce(
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
  ) end
$$;

-- has_module: answers for the caller's own tenant only (a super_admin, or a
-- caller with no JWT, may ask about any tenant). Policies pass the row's
-- tenant_id, which is the caller's tenant for every row RLS lets them see.
create or replace function public.has_module(p_tenant_id uuid, p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when coalesce(current_setting('role', true), 'none') not in ('none', 'service_role', 'postgres', 'supabase_admin')
         and p_tenant_id is distinct from public.get_tenant_id_for_user(auth.uid())
         and public.get_role_for_user(auth.uid()) is distinct from 'super_admin'
      then false
    else coalesce(
      (select tmo.enabled from public.tenant_module_overrides tmo
       where tmo.tenant_id = p_tenant_id and tmo.module_key = p_module_key),
      (select true from public.tier_modules tm
       join public.tenants t on t.tier_key = tm.tier_key
       where t.id = p_tenant_id and tm.module_key = p_module_key),
      false)
  end
$$;

-- Job and alert RPCs: the tenant comes from the caller, never the argument
-- (mirrors the data_jobs/health_alerts policies and the school_admin-only
-- process-*-job Edge Functions).
create or replace function public.create_export_job(p_tenant_id uuid, p_entity_type text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_id uuid;
begin
  if p_tenant_id is distinct from public.get_tenant_id_for_user(auth.uid())
     or public.get_role_for_user(auth.uid()) is distinct from 'school_admin' then
    raise exception 'permission denied for tenant' using errcode = '42501';
  end if;
  -- The entity types process-export-job knows (review AC-6).
  if p_entity_type is null or p_entity_type not in ('students', 'teachers', 'fees') then
    raise exception 'invalid entity type' using errcode = '22023';
  end if;
  insert into public.data_jobs (tenant_id, user_id, job_type, entity_type, total_rows)
  values (p_tenant_id, auth.uid(), 'export', p_entity_type, 0)
  returning id into v_job_id;
  return v_job_id;
end;
$$;

create or replace function public.create_import_job(p_tenant_id uuid, p_entity_type text, p_file_size integer)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_id uuid;
begin
  if p_tenant_id is distinct from public.get_tenant_id_for_user(auth.uid())
     or public.get_role_for_user(auth.uid()) is distinct from 'school_admin' then
    raise exception 'permission denied for tenant' using errcode = '42501';
  end if;
  -- The entity types process-import-job knows, and the data-imports bucket's
  -- 5 MB object limit (review AC-6).
  if p_entity_type is null or p_entity_type not in ('students', 'teachers', 'fees') then
    raise exception 'invalid entity type' using errcode = '22023';
  end if;
  if p_file_size is null or p_file_size < 0 or p_file_size > 5242880 then
    raise exception 'invalid file size' using errcode = '22023';
  end if;
  insert into public.data_jobs (tenant_id, user_id, job_type, entity_type, file_size)
  values (p_tenant_id, auth.uid(), 'import', p_entity_type, p_file_size)
  returning id into v_job_id;
  return v_job_id;
end;
$$;

create or replace function public.acknowledge_alert(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.get_role_for_user(auth.uid()) is distinct from 'school_admin' then
    raise exception 'permission denied for alert' using errcode = '42501';
  end if;
  update public.health_alerts
  set acknowledged_at = now(),
      acknowledged_by = auth.uid()
  where id = p_alert_id
    and tenant_id = public.get_tenant_id_for_user(auth.uid());
end;
$$;

-- Signed-in users only (no anon grant: every page that shows the password
-- policy, invite acceptance included, has a session; reviews SEC-2/AZ-5). A
-- signed-in user gets what the app uses, the password policy and the session
-- timeout. The login lockout thresholds are an oracle for pacing a
-- password-guessing run (L-07), so only super_admin (who sets them) and the
-- trusted contexts get those (reviews SEC-3/AZ-4/AC-2/TI-4).
create or replace function public.get_security_settings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public.system_config
  where tenant_id is null
    and key in (
      'login_max_attempts', 'login_attempt_window_minutes',
      'login_ip_max_attempts', 'login_ip_window_minutes',
      'session_timeout_minutes',
      'password_min_length', 'password_require_uppercase',
      'password_require_numbers', 'password_require_special'
    )
    and (key like 'password\_%'
         or key = 'session_timeout_minutes'
         or coalesce(current_setting('role', true), 'none') in ('none', 'service_role', 'postgres', 'supabase_admin')
         or public.get_role_for_user(auth.uid()) = 'super_admin')
$$;

-- attendance_retroactive_edit_gate passes the row's tenant, which is always
-- the caller's own. Called directly with another tenant's id it answered with
-- that tenant's setting (review TI-1); an end user now gets the platform
-- default (7) for any tenant but their own.
create or replace function public.attendance_retroactive_edit_window_days(p_tenant_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select (tc.settings->>'attendance_retroactive_edit_days')::int
     from public.tenant_configs tc
     where tc.tenant_id = p_tenant_id
       and (coalesce(current_setting('role', true), 'none') in ('none', 'service_role', 'postgres', 'supabase_admin')
            or p_tenant_id = public.get_tenant_id_for_user(auth.uid()))),
    7
  );
$$;

-- auto_assign_exam_seats (20260825000001) answered 'exam_not_found' for a
-- missing id and 'cross_tenant_denied' for another tenant's, which confirmed
-- that the other tenant's exam exists (review TI-2/AC-7). Both are now
-- 'exam_not_found'; the body is otherwise unchanged.
create or replace function public.auto_assign_exam_seats(p_exam_id uuid, p_rows integer, p_cols integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid; v_class_id uuid; v_role text;
  v_student record; v_seq int := 0; v_assigned int := 0;
begin
  select tenant_id, class_id into v_tenant_id, v_class_id from public.exams where id = p_exam_id;
  if v_tenant_id is null
     or v_tenant_id is distinct from (select public.get_tenant_id_for_user(auth.uid())) then
    raise exception 'exam_not_found';
  end if;
  v_role := (select public.get_role_for_user(auth.uid()));
  if v_role is distinct from 'school_admin' and not public.is_teacher_of_class(v_class_id) then
    raise exception 'not_authorized';
  end if;
  if v_class_id is null then raise exception 'exam_has_no_class'; end if;
  if p_rows < 1 or p_cols < 1 then raise exception 'invalid_grid'; end if;

  delete from public.exam_seat_assignments where exam_id = p_exam_id;

  for v_student in
    select id from public.students where class_id = v_class_id
    order by nullif(roll_number, '')::int nulls last, last_name, first_name
  loop
    if v_seq >= p_rows * p_cols then exit; end if;
    insert into public.exam_seat_assignments (tenant_id, exam_id, student_id, seat_label)
    values (v_tenant_id, p_exam_id, v_student.id, format('R%sC%s', v_seq / p_cols + 1, v_seq % p_cols + 1));
    v_seq := v_seq + 1;
    v_assigned := v_assigned + 1;
  end loop;

  return v_assigned;
end;
$$;

-- RLS/RPC parity (review AZ-1/AC-5): the job and health RPCs are service_role
-- or school_admin only, but three table policies let any role in a tenant
-- write the same rows directly (a student could plant a "critical" alert, or
-- a "completed" export job pointing at any storage path the school admin's
-- page would then sign). Nothing in the app writes these tables directly:
-- create_*_job is the only client path for data_jobs, and alerts and metrics
-- come from service_role (which bypasses RLS).
drop policy if exists health_alerts_insert on public.health_alerts;
drop policy if exists system_health_insert on public.system_health;
drop policy if exists data_jobs_write on public.data_jobs;

-- CREATE OR REPLACE keeps existing grants, but step 1 already ran, so the
-- replaced functions are closed too. Re-close in case a body above was new.
revoke execute on function
  public.get_email_for_user(uuid), public.get_tenant_id_for_user(uuid), public.get_role_for_user(uuid),
  public.has_module(uuid, text), public.has_resource_permission(uuid, text, text), public.create_export_job(uuid, text),
  public.create_import_job(uuid, text, integer), public.acknowledge_alert(uuid),
  public.get_security_settings(), public.attendance_retroactive_edit_window_days(uuid),
  public.auto_assign_exam_seats(uuid, integer, integer)
from public, anon, authenticated;

-- 2. Re-grant from the allow-list (keep in step with
--    supabase/security/definer_allowlist.sql) -------------------------------
grant execute on function
  -- RLS helpers called by policies
  public.get_tenant_id_for_user(uuid),
  public.get_role_for_user(uuid),
  public.get_email_for_user(uuid),
  public.has_module(uuid, text),
  public.has_resource_permission(uuid, text, text),
  public.is_guardian_of(uuid),
  public.is_teacher_of_class(uuid),
  public.jwt_user_id(),
  public.attendance_retroactive_edit_window_days(uuid),
  -- RPCs the app calls
  public.acknowledge_alert(uuid),
  public.auto_assign_exam_seats(uuid, integer, integer),
  public.check_staff_employee_linkage(),
  public.create_export_job(uuid, text),
  public.create_import_job(uuid, text, integer),
  public.dashboard_alerts(date, date),
  public.dashboard_attendance_week(date),
  public.dashboard_billing(date, date),
  public.dashboard_high_absence(date, date, numeric, integer),
  public.dashboard_lowest_gpa(integer),
  public.dashboard_missing_attendance(date, date),
  public.dashboard_overview(uuid),
  public.get_class_rank(uuid, uuid),
  public.get_security_settings(),
  public.get_student_grade_history(uuid)
to authenticated;

-- The definer-rights HR/clinic views run their policies as their owner.
grant execute on function
  public.get_tenant_id_for_user(uuid), public.get_role_for_user(uuid), public.jwt_user_id()
to timhirt_view_owner;

-- 4. Future functions start closed (plan item 3; review SEC-1/TI-6) ----------
-- Production (audit/evidence/wp02-prod-owners-bypassrls-defacl-*.txt) grants
-- EXECUTE on every function postgres creates twice over: to PUBLIC through
-- the built-in global default, and to anon/authenticated/service_role through
-- Supabase's `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public`.
-- A schema-scoped default cannot remove the global PUBLIC grant, so:
--   * the global default for postgres stops granting EXECUTE to PUBLIC;
--   * the public-schema default stops granting it to anon and authenticated
--     (service_role keeps it, for Edge Functions);
--   * the `extensions` schema gets PUBLIC back explicitly, so an extension
--     postgres installs there later (pgcrypto, uuid-ossp and
--     pg_stat_statements are postgres-owned today) behaves exactly as before.
-- Every function postgres creates in public from now on, definer or invoker,
-- is callable only by service_role until its migration grants it; a definer
-- grant must also be in definer_allowlist.sql (catalog_definer_security.sql),
-- and catalog_definer_security.sql also asserts these defaults stay closed.
-- Functions that already exist keep their grants (step 1 handled definers).
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    execute 'alter default privileges for role postgres in schema extensions grant execute on functions to public';
  end if;
end $$;

-- 5. FORCE RLS everywhere ----------------------------------------------------
alter table public.backup_jobs      force row level security;
alter table public.data_jobs        force row level security;
alter table public.feature_flags    force row level security;
alter table public.health_alerts    force row level security;
alter table public.permissions      force row level security;
alter table public.restore_jobs     force row level security;
alter table public.role_permissions force row level security;
alter table public.roles            force row level security;
alter table public.system_config    force row level security;
alter table public.system_health    force row level security;
alter table public.user_roles       force row level security;
