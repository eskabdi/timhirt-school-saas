-- ============================================================================
-- Advanced role and permission management system
-- ============================================================================

-- Store custom roles (extends built-in roles: school_admin, teacher, registrar, etc.)
create table roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  description text,
  is_builtin boolean default false,
  parent_role text,  -- inherit permissions from built-in role
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  unique(tenant_id, name)
);

create index idx_roles_tenant_id on roles(tenant_id);
create index idx_roles_is_builtin on roles(is_builtin);

-- Store permissions (granular access control per module/feature)
create table permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,  -- e.g., "students:read", "grades:write", "payroll:approve"
  module text not null,  -- e.g., "sis", "gradebook", "hr_payroll"
  resource text not null,  -- e.g., "students", "grades", "payroll_runs"
  action text not null,  -- e.g., "read", "write", "delete", "approve"
  description text,
  created_at timestamp with time zone not null default now()
);

create index idx_permissions_module on permissions(module);
create index idx_permissions_resource on permissions(resource);

-- Junction table: which permissions each role has
create table role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  created_at timestamp with time zone not null default now(),

  unique(role_id, permission_id)
);

create index idx_role_permissions_role_id on role_permissions(role_id);
create index idx_role_permissions_permission_id on role_permissions(permission_id);

-- Store which users have which custom roles (many-to-many)
create table user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  role_id uuid references roles(id) on delete cascade,  -- NULL = use default from users.role
  assigned_at timestamp with time zone not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,

  unique(user_id, tenant_id, role_id)
);

create index idx_user_roles_user_id on user_roles(user_id);
create index idx_user_roles_tenant_id on user_roles(tenant_id);
create index idx_user_roles_role_id on user_roles(role_id);

-- Enable RLS
alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;
alter table user_roles enable row level security;

-- RLS policies
create policy "roles_tenant_isolation" on roles
  for select using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

create policy "roles_admin_manage" on roles
  for all using (
    (select public.get_role_for_user(auth.uid())) = 'school_admin'
    and tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  )
  with check (
    (select public.get_role_for_user(auth.uid())) = 'school_admin'
    and tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  );

create policy "permissions_public_read" on permissions
  for select using (true);  -- All authenticated users can see permission definitions

create policy "role_permissions_tenant_isolation" on role_permissions
  for all using (
    role_id in (select id from roles where tenant_id = (select public.get_tenant_id_for_user(auth.uid())))
  )
  with check (
    role_id in (select id from roles where tenant_id = (select public.get_tenant_id_for_user(auth.uid())))
  );

create policy "user_roles_tenant_isolation" on user_roles
  for select using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

create policy "user_roles_admin_manage" on user_roles
  for all using (
    (select public.get_role_for_user(auth.uid())) = 'school_admin'
    and tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  )
  with check (
    (select public.get_role_for_user(auth.uid())) = 'school_admin'
    and tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  );

-- Insert default permissions for all modules
insert into permissions (key, module, resource, action, description) values
-- SIS Permissions
('students:read', 'sis', 'students', 'read', 'View student records'),
('students:write', 'sis', 'students', 'write', 'Create/edit student records'),
('students:delete', 'sis', 'students', 'delete', 'Delete student records'),

-- Admissions Permissions
('admissions:read', 'admissions', 'applications', 'read', 'View admission applications'),
('admissions:write', 'admissions', 'applications', 'write', 'Change application status'),
('admissions:enroll', 'admissions', 'applications', 'approve', 'Convert applicants to students'),

-- ID Cards Permissions
('id_cards:read', 'id_cards', 'id_cards', 'read', 'View ID card templates'),
('id_cards:write', 'id_cards', 'id_cards', 'write', 'Create/edit ID card templates'),
('id_cards:generate', 'id_cards', 'id_cards', 'approve', 'Generate ID cards'),

-- Attendance Permissions
('attendance:read', 'attendance', 'attendance', 'read', 'View attendance records'),
('attendance:write', 'attendance', 'attendance', 'write', 'Mark attendance'),

-- Gradebook Permissions
('gradebook:read', 'gradebook', 'grades', 'read', 'View grades'),
('gradebook:write', 'gradebook', 'grades', 'write', 'Enter/edit grades'),
('gradebook:publish', 'gradebook', 'grades', 'approve', 'Publish grade reports'),

-- Assignments Permissions
('assignments:read', 'assignments', 'assignments', 'read', 'View assignments'),
('assignments:write', 'assignments', 'assignments', 'write', 'Create/edit assignments'),

-- Fees Permissions
('fees:read', 'fees', 'invoices', 'read', 'View invoices'),
('fees:write', 'fees', 'invoices', 'write', 'Create/edit invoices'),
('fees:approve', 'fees', 'invoices', 'approve', 'Approve payment records'),

-- HR/Payroll Permissions
('hr:read', 'hr_payroll', 'employees', 'read', 'View employee records'),
('hr:write', 'hr_payroll', 'employees', 'write', 'Create/edit employee records'),
('payroll:read', 'hr_payroll', 'payroll', 'read', 'View payroll runs'),
('payroll:approve', 'hr_payroll', 'payroll', 'approve', 'Approve/run payroll'),
('leave:approve', 'hr_payroll', 'leave', 'approve', 'Approve leave requests'),

-- System Admin Permissions
('audit:read', 'audit', 'audit_logs', 'read', 'View audit logs'),
('backups:manage', 'backups', 'backups', 'approve', 'Create/restore backups'),
('config:manage', 'config', 'settings', 'write', 'Manage system configuration'),
('users:manage', 'users', 'users', 'write', 'Manage user accounts and roles')
on conflict (key) do nothing;

-- Function to check if user has permission
create or replace function has_permission(p_user_id uuid, p_permission_key text)
returns boolean as $$
declare
  v_tenant_id uuid;
  v_has_permission boolean;
begin
  -- Get tenant_id from user record
  v_tenant_id := public.get_tenant_id_for_user(p_user_id);

  -- Check if user has the permission through custom role or built-in role
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
$$ language plpgsql security definer;

grant select on roles to authenticated;
grant select on permissions to authenticated;
grant select on role_permissions to authenticated;
grant select on user_roles to authenticated;

comment on table roles is 'Custom role definitions per tenant';
comment on table permissions is 'Granular permission definitions for modules and features';
comment on function has_permission is 'Check if user has a specific permission';
