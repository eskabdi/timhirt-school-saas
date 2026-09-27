-- ============================================================================
-- RPC authorization hardening (§6.2 "RLS is the authorization layer")
--
-- The 20260719* batch shipped 13 SECURITY DEFINER functions that were granted
-- to `authenticated` (or left on Postgres's default EXECUTE-to-PUBLIC) while
-- performing no tenant or role check of their own. SECURITY DEFINER runs as the
-- owner, so RLS does not apply inside them: each one re-exposed exactly what the
-- policies next to it were written to prevent.
--
-- Reproduced on the migration harness before this fix. As a *student* in
-- Tenant A — a user for whom `select * from data_jobs` and `select * from
-- health_alerts` both correctly return 0 rows:
--
--   create_export_job(<tenant B uuid>, 'students')  -> inserted a row into tenant B
--   complete_job(<tenant B job>, 999, 'attacker/controlled/path.csv')
--                                                  -> tenant B's job marked
--                                                     completed, storage_path
--                                                     replaced
--   acknowledge_alert(<tenant B alert>)            -> acknowledged_by set to the
--                                                     attacker, bypassing the
--                                                     school_admin-only
--                                                     health_alerts_admin_update
--   get_config('secret_key', <tenant B uuid>)      -> returned tenant B's value
--
-- Three defects, fixed together here because they share one root cause:
--
--   1. Caller-supplied p_tenant_id was trusted. Tenant now comes from
--      get_tenant_id_for_user(auth.uid()); a p_tenant_id argument is kept for
--      signature compatibility (the client passes its own tenant, and
--      database.types.ts is generated from these signatures) but must match.
--   2. Row-addressed updates (p_job_id / p_alert_id) carried no tenant or role
--      predicate. Every UPDATE is now scoped to the caller's tenant and gated on
--      the same role the table's own UPDATE policy names.
--   3. search_path was unpinned on all 13. Now `public, pg_temp`, matching the
--      other 35 SECURITY DEFINER functions in this schema.
--
-- Grants follow the convention already used by settle_gateway_payment,
-- consume_rate_limit and set_student_number: revoke from public + anon, then
-- grant back only to the roles that actually call in.
--
-- Callable surface is unchanged for legitimate users: the three client-facing
-- RPCs (create_import_job, create_export_job, acknowledge_alert) all sit behind
-- `RequireRole roles={["school_admin"]}` in router.tsx and pass their own
-- tenant_id, so a correct caller sees identical behaviour.
-- ============================================================================

-- ---------- shared guard -----------------------------------------------------
-- Returns the caller's tenant, or raises. Used by every function below so the
-- failure mode is one consistent, non-leaky error rather than eight variants.
create or replace function public.require_tenant_role(p_roles text[])
returns uuid language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_tenant uuid;
  v_role   text;
begin
  if auth.uid() is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  v_tenant := public.get_tenant_id_for_user(auth.uid());
  v_role   := public.get_role_for_user(auth.uid());
  if v_tenant is null or v_role is null or not (v_role = any(p_roles)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return v_tenant;
end;
$$;
revoke all on function public.require_tenant_role(text[]) from public, anon;
grant execute on function public.require_tenant_role(text[]) to authenticated;

-- ---------- import / export jobs (20260719000010) ---------------------------
create or replace function public.create_import_job(
  p_tenant_id uuid,
  p_entity_type text,
  p_file_size integer
)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_tenant uuid;
  v_job_id uuid;
begin
  v_tenant := public.require_tenant_role(array['school_admin']);
  if p_tenant_id is distinct from v_tenant then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  insert into data_jobs (tenant_id, user_id, job_type, entity_type, file_size)
  values (v_tenant, auth.uid(), 'import', p_entity_type, p_file_size)
  returning id into v_job_id;

  return v_job_id;
end;
$$;

create or replace function public.create_export_job(
  p_tenant_id uuid,
  p_entity_type text
)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_tenant uuid;
  v_job_id uuid;
begin
  v_tenant := public.require_tenant_role(array['school_admin']);
  if p_tenant_id is distinct from v_tenant then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  insert into data_jobs (tenant_id, user_id, job_type, entity_type, total_rows)
  values (v_tenant, auth.uid(), 'export', p_entity_type, 0)
  returning id into v_job_id;

  return v_job_id;
end;
$$;

-- The three progress/end-state mutators are addressed by job id. Scoping the
-- UPDATE to the caller's tenant is what stops id-guessing from crossing a
-- tenant boundary; the role check restores data_jobs_admin_update, which
-- SECURITY DEFINER had been skipping.
create or replace function public.update_job_progress(
  p_job_id uuid,
  p_processed_rows integer,
  p_progress_percent integer,
  p_error_log jsonb default null
)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.require_tenant_role(array['school_admin']);
  update data_jobs
  set processed_rows = p_processed_rows,
      progress_percent = p_progress_percent,
      error_log = coalesce(p_error_log, error_log),
      updated_at = now()
  where id = p_job_id and tenant_id = v_tenant;
end;
$$;

create or replace function public.complete_job(
  p_job_id uuid,
  p_total_rows integer default null,
  p_storage_path text default null
)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.require_tenant_role(array['school_admin']);
  update data_jobs
  set status = 'completed',
      total_rows = coalesce(p_total_rows, total_rows),
      storage_path = coalesce(p_storage_path, storage_path),
      completed_at = now(),
      updated_at = now()
  where id = p_job_id and tenant_id = v_tenant;
end;
$$;

create or replace function public.fail_job(
  p_job_id uuid,
  p_error_message text
)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.require_tenant_role(array['school_admin']);
  update data_jobs
  set status = 'failed',
      error_log = jsonb_build_array(jsonb_build_object('error', p_error_message)),
      completed_at = now(),
      updated_at = now()
  where id = p_job_id and tenant_id = v_tenant;
end;
$$;

revoke all on function public.create_import_job(uuid, text, integer) from public, anon;
revoke all on function public.create_export_job(uuid, text) from public, anon;
revoke all on function public.update_job_progress(uuid, integer, integer, jsonb) from public, anon;
revoke all on function public.complete_job(uuid, integer, text) from public, anon;
revoke all on function public.fail_job(uuid, text) from public, anon;
grant execute on function public.create_import_job(uuid, text, integer) to authenticated;
grant execute on function public.create_export_job(uuid, text) to authenticated;
grant execute on function public.update_job_progress(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.complete_job(uuid, integer, text) to authenticated;
grant execute on function public.fail_job(uuid, text) to authenticated;

-- ---------- system health (20260719000011) ----------------------------------
create or replace function public.record_health_metric(
  p_tenant_id uuid,
  p_metric_type text,
  p_value numeric,
  p_unit text default null,
  p_threshold_warning numeric default null,
  p_threshold_critical numeric default null
)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_status text := 'healthy';
  v_tenant uuid;
begin
  v_tenant := public.require_tenant_role(array['school_admin']);
  if p_tenant_id is distinct from v_tenant then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if p_threshold_critical is not null and p_value >= p_threshold_critical then
    v_status := 'critical';
  elsif p_threshold_warning is not null and p_value >= p_threshold_warning then
    v_status := 'warning';
  end if;

  insert into system_health (tenant_id, metric_type, value, unit, threshold_warning, threshold_critical, status)
  values (v_tenant, p_metric_type, p_value, p_unit, p_threshold_warning, p_threshold_critical, v_status)
  on conflict (tenant_id, metric_type, recorded_at) do update
  set value = p_value, status = v_status;
end;
$$;

create or replace function public.create_health_alert(
  p_tenant_id uuid,
  p_alert_type text,
  p_severity text,
  p_message text
)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.require_tenant_role(array['school_admin']);
  if p_tenant_id is distinct from v_tenant then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  insert into health_alerts (tenant_id, alert_type, severity, message)
  values (v_tenant, p_alert_type, p_severity, p_message);
end;
$$;

create or replace function public.acknowledge_alert(p_alert_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.require_tenant_role(array['school_admin']);
  update health_alerts
  set acknowledged_at = now(),
      acknowledged_by = auth.uid()
  where id = p_alert_id and tenant_id = v_tenant;
end;
$$;

revoke all on function public.record_health_metric(uuid, text, numeric, text, numeric, numeric) from public, anon;
revoke all on function public.create_health_alert(uuid, text, text, text) from public, anon;
revoke all on function public.acknowledge_alert(uuid) from public, anon;
grant execute on function public.record_health_metric(uuid, text, numeric, text, numeric, numeric) to authenticated;
grant execute on function public.create_health_alert(uuid, text, text, text) to authenticated;
grant execute on function public.acknowledge_alert(uuid) to authenticated;

-- ---------- system config / feature flags (20260719000009) ------------------
-- These are reads, but SECURITY DEFINER reads bypass system_config_read /
-- feature_flags_read just as surely as the writes above bypassed their policies.
-- A null p_tenant_id still means "system-wide row" and stays allowed.
create or replace function public.get_config(p_key text, p_tenant_id uuid default null)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_config system_config;
  v_tenant uuid;
begin
  v_tenant := public.get_tenant_id_for_user(auth.uid());
  if p_tenant_id is not null and p_tenant_id is distinct from v_tenant then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select * into v_config from system_config
    where key = p_key
    and (tenant_id = p_tenant_id or (p_tenant_id is not null and tenant_id is null))
    order by tenant_id desc nulls last
    limit 1;

  return coalesce(v_config.value, null);
end;
$$;

create or replace function public.is_feature_enabled(p_flag_key text, p_tenant_id uuid default null)
returns boolean language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_flag feature_flags;
  v_tenant uuid;
begin
  if p_tenant_id is null then
    return false;
  end if;
  v_tenant := public.get_tenant_id_for_user(auth.uid());
  if p_tenant_id is distinct from v_tenant then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select * into v_flag from feature_flags
    where tenant_id = p_tenant_id
    and flag_key = p_flag_key;

  return coalesce(v_flag.enabled, false);
end;
$$;

revoke all on function public.get_config(text, uuid) from public, anon;
revoke all on function public.is_feature_enabled(text, uuid) from public, anon;
grant execute on function public.get_config(text, uuid) to authenticated;
grant execute on function public.is_feature_enabled(text, uuid) to authenticated;

-- ---------- role permissions (20260719000008) -------------------------------
-- Answering "what may this other user do?" is itself an authorization question:
-- a caller may ask about themselves, or a school_admin about a user in their
-- own tenant.
create or replace function public.has_permission(p_user_id uuid, p_permission_key text)
returns boolean language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_tenant_id uuid;
  v_has_permission boolean;
begin
  if auth.uid() is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  v_tenant_id := public.get_tenant_id_for_user(p_user_id);

  if p_user_id is distinct from auth.uid()
     and not (public.get_role_for_user(auth.uid()) = 'school_admin'
              and v_tenant_id = public.get_tenant_id_for_user(auth.uid())) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select exists(
    select 1 from role_permissions rp
    join permissions p on rp.permission_id = p.id
    join roles r on rp.role_id = r.id
    where r.tenant_id = v_tenant_id
    and rp.role_id in (
      select role_id from user_roles where user_id = p_user_id and tenant_id = v_tenant_id
    )
    and p.key = p_permission_key
  ) into v_has_permission;

  return v_has_permission;
end;
$$;
revoke all on function public.has_permission(uuid, text) from public, anon;
grant execute on function public.has_permission(uuid, text) to authenticated;

-- ---------- backup maintenance (20260719000007) -----------------------------
-- Neither is called from the client. Both were left on Postgres's default
-- EXECUTE-to-PUBLIC while deleting and rewriting backup_jobs rows across every
-- tenant at once, so any caller who could reach the schema could invoke them.
-- Scheduled maintenance runs as service_role.
create or replace function public.cleanup_expired_backups()
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_expired_count integer;
begin
  delete from backup_jobs
  where status = 'completed'
    and created_at < now() - (retention_days || ' days')::interval;

  get diagnostics v_expired_count = row_count;
  raise notice 'Cleaned up % expired backups', v_expired_count;
end;
$$;

create or replace function public.timeout_stalled_backups()
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_timed_out_count integer;
begin
  update backup_jobs
  set status = 'failed',
      error_message = 'Backup timed out after 24 hours',
      updated_at = now()
  where status = 'running'
    and started_at < now() - interval '24 hours';

  get diagnostics v_timed_out_count = row_count;
  raise notice 'Marked % timed-out backups as failed', v_timed_out_count;
end;
$$;

revoke all on function public.cleanup_expired_backups() from public, anon, authenticated;
revoke all on function public.timeout_stalled_backups() from public, anon, authenticated;
grant execute on function public.cleanup_expired_backups() to service_role;
grant execute on function public.timeout_stalled_backups() to service_role;

-- ---------- storage: branding bucket must not serve active content ----------
-- `branding` is the one public bucket (logos render on the anonymous /apply and
-- /verify pages, so it cannot be private). It accepted image/svg+xml: an SVG is
-- a script-bearing document, and any tenant's school_admin could upload one and
-- hand out a supabase.co URL that executes script on that origin. Raster only —
-- every legitimate logo/seal format is still accepted.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'branding';
