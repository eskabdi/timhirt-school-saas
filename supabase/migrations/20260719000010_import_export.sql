-- ============================================================================
-- Bulk data import/export system for CSV operations
-- ============================================================================

-- Track import/export jobs
create table if not exists data_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete set null,
  job_type text not null check (job_type in ('import', 'export')),  -- import or export
  entity_type text not null,  -- e.g., "students", "teachers", "fees"
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  progress_percent integer default 0,
  total_rows integer,
  processed_rows integer default 0,
  error_count integer default 0,
  error_log jsonb,  -- array of {row: N, error: "message"}
  storage_path text,  -- s3 or bucket path for file
  file_size integer,  -- bytes
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index idx_data_jobs_tenant_id on data_jobs(tenant_id);
create index idx_data_jobs_status on data_jobs(status);
create index idx_data_jobs_job_type on data_jobs(job_type);

-- Enable RLS
alter table data_jobs enable row level security;

-- RLS policies: users can only see their tenant's jobs, admins can see all
create policy "data_jobs_read" on data_jobs
  for select using (
    tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
    and (user_id = auth.uid()
         or (select public.get_role_for_user(auth.uid())) = 'school_admin')
  );

create policy "data_jobs_write" on data_jobs
  for insert with check (
    tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
    and user_id = auth.uid()
  );

create policy "data_jobs_admin_update" on data_jobs
  for update using (
    tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
    and (select public.get_role_for_user(auth.uid())) = 'school_admin'
  )
  with check (
    tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
    and (select public.get_role_for_user(auth.uid())) = 'school_admin'
  );

-- Function to create import job
create or replace function create_import_job(
  p_tenant_id uuid,
  p_entity_type text,
  p_file_size integer
)
returns uuid as $$
declare
  v_job_id uuid;
begin
  insert into data_jobs (tenant_id, user_id, job_type, entity_type, file_size)
  values (p_tenant_id, auth.uid(), 'import', p_entity_type, p_file_size)
  returning id into v_job_id;

  return v_job_id;
end;
$$ language plpgsql security definer;

-- Function to create export job
create or replace function create_export_job(
  p_tenant_id uuid,
  p_entity_type text
)
returns uuid as $$
declare
  v_job_id uuid;
begin
  insert into data_jobs (tenant_id, user_id, job_type, entity_type, total_rows)
  values (p_tenant_id, auth.uid(), 'export', p_entity_type, 0)
  returning id into v_job_id;

  return v_job_id;
end;
$$ language plpgsql security definer;

-- Function to update job progress
create or replace function update_job_progress(
  p_job_id uuid,
  p_processed_rows integer,
  p_progress_percent integer,
  p_error_log jsonb default null
)
returns void as $$
begin
  update data_jobs
  set processed_rows = p_processed_rows,
      progress_percent = p_progress_percent,
      error_log = coalesce(p_error_log, error_log),
      updated_at = now()
  where id = p_job_id;
end;
$$ language plpgsql security definer;

-- Function to mark job as completed
create or replace function complete_job(
  p_job_id uuid,
  p_total_rows integer default null,
  p_storage_path text default null
)
returns void as $$
begin
  update data_jobs
  set status = 'completed',
      total_rows = coalesce(p_total_rows, total_rows),
      storage_path = coalesce(p_storage_path, storage_path),
      completed_at = now(),
      updated_at = now()
  where id = p_job_id;
end;
$$ language plpgsql security definer;

-- Function to mark job as failed
create or replace function fail_job(
  p_job_id uuid,
  p_error_message text
)
returns void as $$
begin
  update data_jobs
  set status = 'failed',
      error_log = jsonb_build_array(jsonb_build_object('error', p_error_message)),
      completed_at = now(),
      updated_at = now()
  where id = p_job_id;
end;
$$ language plpgsql security definer;

-- Grant necessary permissions
grant select on data_jobs to authenticated;
grant usage on function create_import_job to authenticated;
grant usage on function create_export_job to authenticated;
grant usage on function update_job_progress to authenticated;
grant usage on function complete_job to authenticated;
grant usage on function fail_job to authenticated;

comment on table data_jobs is 'Track import/export jobs for bulk data operations';
comment on function create_import_job is 'Create a new import job';
comment on function create_export_job is 'Create a new export job';
