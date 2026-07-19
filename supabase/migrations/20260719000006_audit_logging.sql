-- ============================================================================
-- Audit logging system: track all data changes for compliance and debugging
-- ============================================================================

-- Create audit_logs table to store all changes
-- Drop and recreate to ensure clean schema
drop table if exists audit_logs cascade;

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name text not null,
  record_id uuid not null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamp with time zone not null default now()
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

-- Function to log changes (only during authenticated operations, not migrations/tests)
create or replace function audit_log_trigger_fn()
returns trigger as $$
declare
  v_tenant_id uuid;
  v_user_id uuid;
begin
  -- Only log if we have valid auth context (skip during migrations, tests, seed)
  if auth.jwt() is null or auth.jwt()->>'app_metadata' is null then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;

  -- Extract tenant_id and user_id from different table structures
  if TG_TABLE_NAME in ('students', 'classes', 'subjects', 'teachers', 'class_subject_teachers', 'timetable_slots', 'admission_applications') then
    v_tenant_id := case when TG_OP = 'DELETE' then old.tenant_id else new.tenant_id end;
  else
    v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  end if;

  -- Only log if tenant_id is valid
  if v_tenant_id is null then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;

  v_user_id := (auth.jwt()->>'sub')::uuid;

  insert into audit_logs (
    tenant_id, user_id, action, table_name, record_id,
    old_values, new_values, created_at
  ) values (
    v_tenant_id, v_user_id, TG_OP, TG_TABLE_NAME,
    case when TG_OP = 'DELETE' then old.id else new.id end,
    case when TG_OP = 'INSERT' then null else to_jsonb(old) end,
    case when TG_OP = 'DELETE' then null else to_jsonb(new) end,
    now()
  ) on conflict do nothing;

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
