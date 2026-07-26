-- ============================================================================
-- Staff → employee linkage check.
--
-- Payroll and leave self-service authorize through employees.user_id: the
-- payslip and leave_request policies in 20260713000005 all read
--   exists (select 1 from public.employees e
--            where e.id = employee_id and e.user_id = auth.uid())
-- so a staff member whose auth account was never linked to an employees row is
-- not denied with an error — they simply see an empty list. Their own payslips
-- and leave requests are invisible to them, and nothing anywhere says why.
--
-- That failure is silent by construction, which is exactly the kind that
-- survives to production. This surfaces it as a health check instead.
-- ============================================================================

create or replace function public.check_staff_employee_linkage()
returns table (
  user_id     uuid,
  full_name   text,
  email       text,
  role        public.user_role
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.full_name, u.email, u.role
  from public.users u
  where u.tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
    -- Roles that can hold a payslip or file leave. Students and parents are
    -- never employees; super_admin is a platform account, not tenant staff.
    and u.role in ('school_admin', 'teacher', 'hr_officer', 'accountant', 'registrar')
    and not exists (
      select 1 from public.employees e
      where e.user_id = u.id and e.tenant_id = u.tenant_id
    )
    -- Only an admin should see a roster of colleagues; anyone else gets nothing
    -- rather than an error, so the card simply reads clean for them.
    and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'hr_officer', 'super_admin')
  order by u.role, u.full_name;
$$;

revoke all on function public.check_staff_employee_linkage() from public, anon;
grant execute on function public.check_staff_employee_linkage() to authenticated;

comment on function public.check_staff_employee_linkage() is
  'Staff users in the caller''s tenant with no matching employees.user_id row. '
  'Such users silently see no payslips and cannot use leave self-service, '
  'because those RLS policies join through employees.user_id. '
  'Returns no rows unless the caller is school_admin, hr_officer or super_admin.';
