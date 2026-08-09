-- ============================================================================
-- Backup and restore system: data protection and recovery
-- ============================================================================

-- Create backup_jobs table to track backups
create table backup_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  backup_type text not null check (backup_type in ('full', 'incremental')) default 'full',
  size_bytes bigint,
  records_backed_up integer,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  error_message text,
  storage_path text,
  checksum text,
  retention_days integer default 365,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index idx_backup_jobs_tenant_id on backup_jobs(tenant_id);
create index idx_backup_jobs_status on backup_jobs(status);
create index idx_backup_jobs_created_at on backup_jobs(created_at);

-- Enable RLS
alter table backup_jobs enable row level security;

-- RLS policy: school admins can only see their tenant's backups
create policy "backup_jobs_tenant_isolation" on backup_jobs
  for select using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

create policy "backup_jobs_admin_access" on backup_jobs
  for all using (
    (select public.get_role_for_user(auth.uid())) = 'school_admin'
    and tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  )
  with check (
    (select public.get_role_for_user(auth.uid())) = 'school_admin'
    and tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  );

-- Table to track restore operations
create table restore_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  backup_job_id uuid not null references backup_jobs(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'verifying', 'completed', 'failed', 'rolled_back')),
  dry_run boolean default false,
  records_restored integer,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  error_message text,
  initiated_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now()
);

create index idx_restore_jobs_tenant_id on restore_jobs(tenant_id);
create index idx_restore_jobs_backup_job_id on restore_jobs(backup_job_id);
create index idx_restore_jobs_status on restore_jobs(status);

-- Enable RLS
alter table restore_jobs enable row level security;

create policy "restore_jobs_tenant_isolation" on restore_jobs
  for select using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

create policy "restore_jobs_admin_access" on restore_jobs
  for all using (
    (select public.get_role_for_user(auth.uid())) = 'school_admin'
    and tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  )
  with check (
    (select public.get_role_for_user(auth.uid())) = 'school_admin'
    and tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  );

-- Function to cleanup expired backups
create or replace function cleanup_expired_backups()
returns void as $$
declare
  v_expired_count integer;
begin
  delete from backup_jobs
  where status = 'completed'
    and created_at < now() - (retention_days || ' days')::interval;

  get diagnostics v_expired_count = row_count;
  raise notice 'Cleaned up % expired backups', v_expired_count;
end;
$$ language plpgsql security definer;

-- Function to mark backup as failed if stuck
create or replace function timeout_stalled_backups()
returns void as $$
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
$$ language plpgsql security definer;

-- Grant permissions
grant select on backup_jobs to authenticated;
grant select on restore_jobs to authenticated;

comment on table backup_jobs is 'Tracks backup operations and metadata for point-in-time recovery';
comment on table restore_jobs is 'Tracks restore operations initiated by admins';
