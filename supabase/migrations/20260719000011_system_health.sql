-- ============================================================================
-- System health monitoring and alerts
-- ============================================================================

-- Track system health metrics for each tenant
create table if not exists system_health (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  metric_type text not null,  -- e.g., "storage_used", "failed_jobs", "error_rate", "db_connections"
  value numeric not null,
  unit text,  -- e.g., "bytes", "count", "percent", "ms"
  threshold_warning numeric,  -- alert if exceeds this
  threshold_critical numeric,  -- critical if exceeds this
  status text default 'healthy' check (status in ('healthy', 'warning', 'critical')),
  recorded_at timestamp with time zone not null default now(),

  unique(tenant_id, metric_type, recorded_at)
);

create index idx_system_health_tenant_id on system_health(tenant_id);
create index idx_system_health_metric_type on system_health(metric_type);
create index idx_system_health_recorded_at on system_health(recorded_at);

-- Health alerts for critical issues
create table if not exists health_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  alert_type text not null,  -- e.g., "storage_full", "database_error", "high_error_rate"
  severity text not null check (severity in ('warning', 'critical')),
  message text not null,
  acknowledged_at timestamp with time zone,
  acknowledged_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone
);

create index idx_health_alerts_tenant_id on health_alerts(tenant_id);
create index idx_health_alerts_severity on health_alerts(severity);
create index idx_health_alerts_created_at on health_alerts(created_at);

-- Enable RLS
alter table system_health enable row level security;
alter table health_alerts enable row level security;

-- RLS policies
create policy "system_health_read" on system_health
  for select using (tenant_id = auth.jwt()->'app_metadata'->>'tenant_id'::uuid);

create policy "system_health_insert" on system_health
  for insert with check (tenant_id = auth.jwt()->'app_metadata'->>'tenant_id'::uuid);

create policy "health_alerts_read" on health_alerts
  for select using (tenant_id = auth.jwt()->'app_metadata'->>'tenant_id'::uuid);

create policy "health_alerts_insert" on health_alerts
  for insert with check (tenant_id = auth.jwt()->'app_metadata'->>'tenant_id'::uuid);

create policy "health_alerts_admin_update" on health_alerts
  for update using (
    tenant_id = auth.jwt()->'app_metadata'->>'tenant_id'::uuid
    and auth.jwt()->'app_metadata'->>'role' = 'school_admin'
  );

create policy "health_alerts_admin_delete" on health_alerts
  for delete using (
    tenant_id = auth.jwt()->'app_metadata'->>'tenant_id'::uuid
    and auth.jwt()->'app_metadata'->>'role' = 'school_admin'
  );

-- Function to record health metric
create or replace function record_health_metric(
  p_tenant_id uuid,
  p_metric_type text,
  p_value numeric,
  p_unit text default null,
  p_threshold_warning numeric default null,
  p_threshold_critical numeric default null
)
returns void as $$
declare
  v_status text := 'healthy';
begin
  if p_threshold_critical is not null and p_value >= p_threshold_critical then
    v_status := 'critical';
  elsif p_threshold_warning is not null and p_value >= p_threshold_warning then
    v_status := 'warning';
  end if;

  insert into system_health (tenant_id, metric_type, value, unit, threshold_warning, threshold_critical, status)
  values (p_tenant_id, p_metric_type, p_value, p_unit, p_threshold_warning, p_threshold_critical, v_status)
  on conflict (tenant_id, metric_type, recorded_at) do update
  set value = p_value, status = v_status;
end;
$$ language plpgsql security definer;

-- Function to create health alert
create or replace function create_health_alert(
  p_tenant_id uuid,
  p_alert_type text,
  p_severity text,
  p_message text
)
returns void as $$
begin
  insert into health_alerts (tenant_id, alert_type, severity, message)
  values (p_tenant_id, p_alert_type, p_severity, p_message);
end;
$$ language plpgsql security definer;

-- Function to acknowledge alert
create or replace function acknowledge_alert(p_alert_id uuid)
returns void as $$
begin
  update health_alerts
  set acknowledged_at = now(),
      acknowledged_by = auth.uid()
  where id = p_alert_id;
end;
$$ language plpgsql security definer;

-- Grant necessary permissions
grant select on system_health to authenticated;
grant select on health_alerts to authenticated;
grant usage on function record_health_metric to authenticated;
grant usage on function create_health_alert to authenticated;
grant usage on function acknowledge_alert to authenticated;

comment on table system_health is 'Track system health metrics for monitoring';
comment on table health_alerts is 'Alert on critical system health issues';
