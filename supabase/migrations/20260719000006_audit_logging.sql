-- ============================================================================
-- Audit logging system: track all data changes for compliance and debugging
-- ============================================================================

-- Create audit_logs table to store all changes
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name text not null,
  record_id uuid not null,
  old_values jsonb,
  new_values jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamp with time zone not null default now(),

  constraint audit_logs_id_primary_key primary key (id)
) partition by range (created_at) (
  partition audit_logs_recent values from ('2024-01-01') to ('2025-01-01'),
  partition audit_logs_archive values from ('2025-01-01') to (maxvalue)
);

create index idx_audit_logs_tenant_id on audit_logs(tenant_id);
create index idx_audit_logs_user_id on audit_logs(user_id);
create index idx_audit_logs_table_name on audit_logs(table_name);
create index idx_audit_logs_record_id on audit_logs(record_id);
create index idx_audit_logs_created_at on audit_logs(created_at);

-- Enable RLS on audit_logs
alter table audit_logs enable row level security;

-- RLS policy: users can only see audit logs for their tenant
create policy "audit_logs_tenant_isolation" on audit_logs
  for select using (tenant_id = auth.jwt()->'app_metadata'->>'tenant_id'::uuid);

-- Super admin and school admin can read all audit logs for their tenant
create policy "audit_logs_admin_read" on audit_logs
  for select using (
    auth.jwt()->'app_metadata'->>'role' in ('super_admin', 'school_admin')
    and tenant_id = auth.jwt()->'app_metadata'->>'tenant_id'::uuid
  );

-- Function to log changes
create or replace function audit_log_trigger_fn()
returns trigger as $$
declare
  v_tenant_id uuid;
  v_user_id uuid;
  v_old_values jsonb;
  v_new_values jsonb;
begin
  -- Get tenant_id based on context
  -- Different tables have tenant_id in different ways
  if TG_TABLE_NAME in ('students', 'classes', 'subjects', 'teachers', 'class_subject_teachers', 'timetable_slots') then
    if TG_OP = 'DELETE' then
      v_tenant_id := old.tenant_id;
      v_user_id := (auth.jwt()->'sub')::uuid;
      v_old_values := row_to_json(old.*);
      v_new_values := null;
    else
      v_tenant_id := new.tenant_id;
      v_user_id := (auth.jwt()->'sub')::uuid;
      v_old_values := case when TG_OP = 'INSERT' then null else row_to_json(old.*) end;
      v_new_values := row_to_json(new.*);
    end if;
  elsif TG_TABLE_NAME in ('student_grades', 'attendance', 'assignments', 'invoice_payments') then
    -- These tables may not have direct tenant_id, need to get through joins
    if TG_OP = 'DELETE' then
      v_user_id := (auth.jwt()->'sub')::uuid;
      v_old_values := row_to_json(old.*);
      v_new_values := null;
    else
      v_user_id := (auth.jwt()->'sub')::uuid;
      v_old_values := case when TG_OP = 'INSERT' then null else row_to_json(old.*) end;
      v_new_values := row_to_json(new.*);
    end if;
    -- Get tenant_id from current session
    v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  else
    -- For other tables, try to get tenant_id from new row
    if TG_OP = 'DELETE' then
      v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
      v_user_id := (auth.jwt()->'sub')::uuid;
      v_old_values := row_to_json(old.*);
      v_new_values := null;
    else
      v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
      v_user_id := (auth.jwt()->'sub')::uuid;
      v_old_values := case when TG_OP = 'INSERT' then null else row_to_json(old.*) end;
      v_new_values := row_to_json(new.*);
    end if;
  end if;

  insert into audit_logs (
    tenant_id, user_id, action, table_name, record_id,
    old_values, new_values, ip_address, user_agent, created_at
  ) values (
    v_tenant_id, v_user_id, TG_OP, TG_TABLE_NAME,
    case when TG_OP = 'DELETE' then old.id else new.id end,
    v_old_values, v_new_values,
    inet_client_addr(), current_setting('application_name', true),
    now()
  );

  return case when TG_OP = 'DELETE' then old else new end;
end;
$$ language plpgsql security definer;

-- Create triggers for key tables
create trigger audit_students_trigger after insert or update or delete on students
  for each row execute function audit_log_trigger_fn();

create trigger audit_teachers_trigger after insert or update or delete on teachers
  for each row execute function audit_log_trigger_fn();

create trigger audit_classes_trigger after insert or update or delete on classes
  for each row execute function audit_log_trigger_fn();

create trigger audit_student_grades_trigger after insert or update or delete on student_grades
  for each row execute function audit_log_trigger_fn();

create trigger audit_attendance_trigger after insert or update or delete on attendance
  for each row execute function audit_log_trigger_fn();

create trigger audit_class_subject_teachers_trigger after insert or update or delete on class_subject_teachers
  for each row execute function audit_log_trigger_fn();

create trigger audit_invoice_payments_trigger after insert or update or delete on invoice_payments
  for each row execute function audit_log_trigger_fn();

create trigger audit_admission_applications_trigger after insert or update or delete on admission_applications
  for each row execute function audit_log_trigger_fn();

-- Cleanup old logs (older than 1 year) via scheduled job
-- This would normally be handled by a pg_cron task, but can also be run manually
create or replace function cleanup_old_audit_logs()
returns void as $$
begin
  delete from audit_logs where created_at < now() - interval '1 year';
end;
$$ language plpgsql security definer;

-- Grant necessary permissions
grant select on audit_logs to authenticated;
grant usage on schema public to authenticated;

comment on table audit_logs is 'Audit log of all data changes for compliance and troubleshooting';
comment on function audit_log_trigger_fn is 'Automatically logs INSERT, UPDATE, DELETE operations on core tables';
