-- ============================================================================
-- System configuration and feature toggles
-- ============================================================================

-- Store system-wide and tenant-level configurations
create table if not exists system_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,  -- null = system-wide config
  key text not null,  -- e.g., "email_provider", "backup_retention_days", "session_timeout_minutes"
  value jsonb not null,  -- stores any JSON value: boolean, string, number, object, array
  value_type text not null,  -- "boolean", "string", "number", "json" for type safety
  description text,  -- e.g., "Days to retain audit logs"
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  unique(tenant_id, key),
  check (key ~ '^[a-z0-9_]+$')
);

create index idx_system_config_tenant_id on system_config(tenant_id);
create index idx_system_config_key on system_config(key);

-- Store feature flags (on/off toggles per tenant)
create table if not exists feature_flags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  flag_key text not null,  -- e.g., "enable_admissions", "enable_payroll_approval_workflow"
  enabled boolean not null default false,
  description text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  unique(tenant_id, flag_key)
);

create index idx_feature_flags_tenant_id on feature_flags(tenant_id);
create index idx_feature_flags_enabled on feature_flags(enabled);

-- Enable RLS
alter table system_config enable row level security;
alter table feature_flags enable row level security;

-- RLS policies: school_admin can manage tenant config, super_admin can manage system config
create policy "system_config_read" on system_config
  for select using (
    (tenant_id is null and (select public.get_role_for_user(auth.uid())) = 'super_admin')
    or (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'super_admin'))
  );

create policy "system_config_write" on system_config
  for all using (
    (tenant_id is null and (select public.get_role_for_user(auth.uid())) = 'super_admin')
    or (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        and (select public.get_role_for_user(auth.uid())) = 'school_admin')
  )
  with check (
    (tenant_id is null and (select public.get_role_for_user(auth.uid())) = 'super_admin')
    or (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        and (select public.get_role_for_user(auth.uid())) = 'school_admin')
  );

create policy "feature_flags_read" on feature_flags
  for select using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

create policy "feature_flags_write" on feature_flags
  for all using (
    tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
    and (select public.get_role_for_user(auth.uid())) = 'school_admin'
  )
  with check (
    tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
    and (select public.get_role_for_user(auth.uid())) = 'school_admin'
  );

-- Helper function to get config value
create or replace function get_config(p_key text, p_tenant_id uuid default null)
returns jsonb as $$
declare
  v_config system_config;
begin
  -- Try tenant-specific config first, then fall back to system-wide
  select * into v_config from system_config
    where key = p_key
    and (tenant_id = p_tenant_id or (p_tenant_id is not null and tenant_id is null))
    order by tenant_id desc nulls last
    limit 1;

  return coalesce(v_config.value, null);
end;
$$ language plpgsql security definer stable;

-- Helper function to check if feature is enabled
create or replace function is_feature_enabled(p_flag_key text, p_tenant_id uuid default null)
returns boolean as $$
declare
  v_flag feature_flags;
begin
  if p_tenant_id is null then
    return false;
  end if;

  select * into v_flag from feature_flags
    where tenant_id = p_tenant_id
    and flag_key = p_flag_key;

  return coalesce(v_flag.enabled, false);
end;
$$ language plpgsql security definer stable;

-- Pre-populate system-wide config defaults (no tenant_id)
insert into system_config (key, value, value_type, description) values
  ('backup_retention_days', '365'::jsonb, 'number', 'Days to retain backups'),
  ('audit_log_retention_days', '365'::jsonb, 'number', 'Days to retain audit logs'),
  ('session_timeout_minutes', '120'::jsonb, 'number', 'Session inactivity timeout in minutes'),
  ('email_provider', '"smtp"'::jsonb, 'string', 'Email provider: smtp, mailgun, sendgrid'),
  ('smtp_host', '""'::jsonb, 'string', 'SMTP server hostname'),
  ('smtp_port', '587'::jsonb, 'number', 'SMTP server port'),
  ('enable_student_portal', 'true'::jsonb, 'boolean', 'Enable student self-service portal'),
  ('enable_parent_portal', 'true'::jsonb, 'boolean', 'Enable parent self-service portal'),
  ('password_min_length', '8'::jsonb, 'number', 'Minimum password length'),
  ('password_require_uppercase', 'true'::jsonb, 'boolean', 'Require uppercase letters'),
  ('password_require_numbers', 'true'::jsonb, 'boolean', 'Require numbers in passwords'),
  ('password_require_special', 'false'::jsonb, 'boolean', 'Require special characters in passwords')
on conflict (tenant_id, key) do nothing;

-- Grant necessary permissions
grant select on system_config to authenticated;
grant select on feature_flags to authenticated;
grant usage on function get_config to authenticated;
grant usage on function is_feature_enabled to authenticated;

comment on table system_config is 'System-wide and tenant-level configuration settings';
comment on table feature_flags is 'Feature toggles for enabling/disabling functionality per tenant';
comment on function get_config is 'Retrieve configuration value by key';
comment on function is_feature_enabled is 'Check if a feature flag is enabled for a tenant';
