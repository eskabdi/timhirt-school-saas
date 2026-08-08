-- ============================================================================
-- Role/user permissions matrix -- Phase 2, HR & Payroll domain.
--
-- Same rule as the academics migration: only the flat staff-role-list branch
-- of a policy is ever replaced. Every self-service branch (employee reading
-- their own employees/contracts/leave/balances/attendance/payslips/reviews
-- row) is copied verbatim. Where a table has no super_admin bypass today
-- (employee_salary_components, leave_balances, staff_attendance,
-- payroll_runs, payslips, payslip_lines, staff_performance_reviews -- most
-- of this domain), none is added.
--
-- leave_requests has TWO permissive UPDATE policies today: leave_decide
-- (HR staff, flat role check) and leave_cancel_own (the requesting employee,
-- pending-only, self-cancel-only). Only leave_decide's flat role branch is
-- matrix-wrapped; leave_file_own (insert) and leave_cancel_own are pure
-- self-service with no staff-role branch at all and are left untouched --
-- there is no 'create' permission for this resource.
--
-- payroll_runs is the one table in this migration with real
-- separation-of-duties logic, and none of it lives in the RLS text being
-- touched here: payroll_run_transition() (the BEFORE UPDATE trigger that
-- stamps approved_by from auth.uid(), rejects a preparer approving their
-- own run, enforces the draft/approved/paid state machine, and makes a
-- paid run fully immutable) and the sod_preparer_not_approver CHECK
-- constraint are not modified by this migration at all. Only the coarse
-- RLS role-gate on runs_insert/runs_approve is matrix-wrapped; the
-- structural checks (status='draft', prepared_by=auth.uid() on insert;
-- tenant-only WITH CHECK on approve) stay exactly as they are.
--
-- payslips and payslip_lines have no write policy of ANY kind -- both are
-- service_role/Edge-Function-only writes -- so both are read-only
-- resources here: only a 'read' permission row exists, no create/update/
-- delete.
-- ============================================================================

insert into public.permissions (key, module, resource, action, description) values
  ('employees:create', 'hr_payroll', 'employees', 'create', 'Create employees'),
  ('employees:read',   'hr_payroll', 'employees', 'read',   'View employees'),
  ('employees:update', 'hr_payroll', 'employees', 'update', 'Edit employees'),
  ('employees:delete', 'hr_payroll', 'employees', 'delete', 'Delete employees'),
  ('employment_contracts:create', 'hr_payroll', 'employment_contracts', 'create', 'Create employment contracts'),
  ('employment_contracts:read',   'hr_payroll', 'employment_contracts', 'read',   'View employment contracts'),
  ('employment_contracts:update', 'hr_payroll', 'employment_contracts', 'update', 'Edit employment contracts'),
  ('employment_contracts:delete', 'hr_payroll', 'employment_contracts', 'delete', 'Delete employment contracts'),
  ('salary_components:create', 'hr_payroll', 'salary_components', 'create', 'Create salary components'),
  ('salary_components:read',   'hr_payroll', 'salary_components', 'read',   'View salary components'),
  ('salary_components:update', 'hr_payroll', 'salary_components', 'update', 'Edit salary components'),
  ('salary_components:delete', 'hr_payroll', 'salary_components', 'delete', 'Delete salary components'),
  ('employee_salary_components:create', 'hr_payroll', 'employee_salary_components', 'create', 'Assign salary components to employees'),
  ('employee_salary_components:read',   'hr_payroll', 'employee_salary_components', 'read',   'View employee salary components'),
  ('employee_salary_components:update', 'hr_payroll', 'employee_salary_components', 'update', 'Edit employee salary components'),
  ('employee_salary_components:delete', 'hr_payroll', 'employee_salary_components', 'delete', 'Remove employee salary components'),
  ('leave_types:create', 'hr_payroll', 'leave_types', 'create', 'Create leave types'),
  ('leave_types:read',   'hr_payroll', 'leave_types', 'read',   'View leave types'),
  ('leave_types:update', 'hr_payroll', 'leave_types', 'update', 'Edit leave types'),
  ('leave_types:delete', 'hr_payroll', 'leave_types', 'delete', 'Delete leave types'),
  ('leave_requests:read',   'hr_payroll', 'leave_requests', 'read',   'View leave requests'),
  ('leave_requests:update', 'hr_payroll', 'leave_requests', 'update', 'Approve or reject leave requests'),
  ('leave_balances:create', 'hr_payroll', 'leave_balances', 'create', 'Create leave balances'),
  ('leave_balances:read',   'hr_payroll', 'leave_balances', 'read',   'View leave balances'),
  ('leave_balances:update', 'hr_payroll', 'leave_balances', 'update', 'Edit leave balances'),
  ('leave_balances:delete', 'hr_payroll', 'leave_balances', 'delete', 'Delete leave balances'),
  ('staff_attendance:create', 'hr_payroll', 'staff_attendance', 'create', 'Mark staff attendance'),
  ('staff_attendance:read',   'hr_payroll', 'staff_attendance', 'read',   'View staff attendance'),
  ('staff_attendance:update', 'hr_payroll', 'staff_attendance', 'update', 'Edit staff attendance'),
  ('staff_attendance:delete', 'hr_payroll', 'staff_attendance', 'delete', 'Delete staff attendance'),
  ('payroll_runs:create', 'hr_payroll', 'payroll_runs', 'create', 'Create a payroll run'),
  ('payroll_runs:read',   'hr_payroll', 'payroll_runs', 'read',   'View payroll runs'),
  ('payroll_runs:update', 'hr_payroll', 'payroll_runs', 'update', 'Approve/pay a payroll run'),
  ('payslips:read', 'hr_payroll', 'payslips', 'read', 'View payslips'),
  ('payslip_lines:read', 'hr_payroll', 'payslip_lines', 'read', 'View payslip line items'),
  ('staff_performance_reviews:create', 'hr_payroll', 'staff_performance_reviews', 'create', 'Create staff performance reviews'),
  ('staff_performance_reviews:read',   'hr_payroll', 'staff_performance_reviews', 'read',   'View staff performance reviews'),
  ('staff_performance_reviews:update', 'hr_payroll', 'staff_performance_reviews', 'update', 'Edit staff performance reviews'),
  ('staff_performance_reviews:delete', 'hr_payroll', 'staff_performance_reviews', 'delete', 'Delete staff performance reviews')
on conflict (key) do nothing;

insert into public.resource_open_actions (resource, action) values
  ('salary_components', 'read'), ('leave_types', 'read');

insert into public.resource_default_role_grants (resource, action, role) values
  ('salary_components', 'create', 'school_admin'), ('salary_components', 'create', 'hr_officer'),
  ('salary_components', 'update', 'school_admin'), ('salary_components', 'update', 'hr_officer'),
  ('salary_components', 'delete', 'school_admin'), ('salary_components', 'delete', 'hr_officer'),
  ('leave_types', 'create', 'school_admin'), ('leave_types', 'create', 'hr_officer'),
  ('leave_types', 'update', 'school_admin'), ('leave_types', 'update', 'hr_officer'),
  ('leave_types', 'delete', 'school_admin'), ('leave_types', 'delete', 'hr_officer'),
  ('employees', 'read', 'school_admin'), ('employees', 'read', 'hr_officer'), ('employees', 'read', 'accountant'),
  ('employees', 'create', 'school_admin'), ('employees', 'create', 'hr_officer'),
  ('employees', 'update', 'school_admin'), ('employees', 'update', 'hr_officer'),
  ('employees', 'delete', 'school_admin'), ('employees', 'delete', 'hr_officer'),
  ('employment_contracts', 'read', 'school_admin'), ('employment_contracts', 'read', 'hr_officer'), ('employment_contracts', 'read', 'accountant'),
  ('employment_contracts', 'create', 'school_admin'), ('employment_contracts', 'create', 'hr_officer'),
  ('employment_contracts', 'update', 'school_admin'), ('employment_contracts', 'update', 'hr_officer'),
  ('employment_contracts', 'delete', 'school_admin'), ('employment_contracts', 'delete', 'hr_officer'),
  ('employee_salary_components', 'read', 'school_admin'), ('employee_salary_components', 'read', 'hr_officer'), ('employee_salary_components', 'read', 'accountant'),
  ('employee_salary_components', 'create', 'school_admin'), ('employee_salary_components', 'create', 'hr_officer'),
  ('employee_salary_components', 'update', 'school_admin'), ('employee_salary_components', 'update', 'hr_officer'),
  ('employee_salary_components', 'delete', 'school_admin'), ('employee_salary_components', 'delete', 'hr_officer'),
  ('leave_requests', 'read', 'school_admin'), ('leave_requests', 'read', 'hr_officer'),
  ('leave_requests', 'update', 'school_admin'), ('leave_requests', 'update', 'hr_officer'),
  ('leave_balances', 'read', 'school_admin'), ('leave_balances', 'read', 'hr_officer'),
  ('leave_balances', 'create', 'school_admin'), ('leave_balances', 'create', 'hr_officer'),
  ('leave_balances', 'update', 'school_admin'), ('leave_balances', 'update', 'hr_officer'),
  ('leave_balances', 'delete', 'school_admin'), ('leave_balances', 'delete', 'hr_officer'),
  ('staff_attendance', 'read', 'school_admin'), ('staff_attendance', 'read', 'hr_officer'),
  ('staff_attendance', 'create', 'school_admin'), ('staff_attendance', 'create', 'hr_officer'),
  ('staff_attendance', 'update', 'school_admin'), ('staff_attendance', 'update', 'hr_officer'),
  ('staff_attendance', 'delete', 'school_admin'), ('staff_attendance', 'delete', 'hr_officer'),
  ('payroll_runs', 'read', 'school_admin'), ('payroll_runs', 'read', 'hr_officer'), ('payroll_runs', 'read', 'accountant'),
  ('payroll_runs', 'create', 'school_admin'), ('payroll_runs', 'create', 'hr_officer'),
  ('payroll_runs', 'update', 'school_admin'), ('payroll_runs', 'update', 'accountant'),
  ('payslips', 'read', 'school_admin'), ('payslips', 'read', 'hr_officer'), ('payslips', 'read', 'accountant'),
  ('payslip_lines', 'read', 'school_admin'), ('payslip_lines', 'read', 'hr_officer'), ('payslip_lines', 'read', 'accountant'),
  ('staff_performance_reviews', 'read', 'school_admin'), ('staff_performance_reviews', 'read', 'hr_officer'),
  ('staff_performance_reviews', 'create', 'school_admin'), ('staff_performance_reviews', 'create', 'hr_officer'),
  ('staff_performance_reviews', 'update', 'school_admin'), ('staff_performance_reviews', 'update', 'hr_officer'),
  ('staff_performance_reviews', 'delete', 'school_admin'), ('staff_performance_reviews', 'delete', 'hr_officer');

-- ---------- open-read resources: write = school_admin + hr_officer --------
do $$
declare t text;
begin
  foreach t in array array['salary_components', 'leave_types']
  loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('drop policy if exists %1$s_write on public.%1$I', t);
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated using (
        (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
         and public.has_resource_permission(auth.uid(), %1$L, 'read'))
        or (select public.get_role_for_user(auth.uid())) = 'super_admin')$f$, t);
    execute format($f$
      create policy %1$s_insert on public.%1$I for insert to authenticated with check (
        tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        and public.has_resource_permission(auth.uid(), %1$L, 'create'))$f$, t);
    execute format($f$
      create policy %1$s_update on public.%1$I for update to authenticated
      using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and public.has_resource_permission(auth.uid(), %1$L, 'update'))
      with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and public.has_resource_permission(auth.uid(), %1$L, 'update'))$f$, t);
    execute format($f$
      create policy %1$s_delete on public.%1$I for delete to authenticated using (
        tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        and public.has_resource_permission(auth.uid(), %1$L, 'delete'))$f$, t);
  end loop;
end $$;

-- ---------- employees: self branch preserved --------------------------------
drop policy if exists employees_select on public.employees;
drop policy if exists employees_write on public.employees;
create policy employees_select on public.employees for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'employees', 'read')
        or user_id = auth.uid()))
);
create policy employees_insert on public.employees for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'employees', 'create'));
create policy employees_update on public.employees for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'employees', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'employees', 'update'));
create policy employees_delete on public.employees for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'employees', 'delete'));

-- ---------- employment_contracts: self branch (via employees) preserved ----
drop policy if exists contracts_select on public.employment_contracts;
drop policy if exists contracts_write on public.employment_contracts;
create policy contracts_select on public.employment_contracts for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'employment_contracts', 'read')
        or exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid())))
);
create policy contracts_insert on public.employment_contracts for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'employment_contracts', 'create'));
create policy contracts_update on public.employment_contracts for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'employment_contracts', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'employment_contracts', 'update'));
create policy contracts_delete on public.employment_contracts for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'employment_contracts', 'delete'));

-- ---------- employee_salary_components: no bypass, no relationship branch --
drop policy if exists esc_select on public.employee_salary_components;
drop policy if exists esc_write on public.employee_salary_components;
create policy esc_select on public.employee_salary_components for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'employee_salary_components', 'read'));
create policy esc_insert on public.employee_salary_components for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'employee_salary_components', 'create'));
create policy esc_update on public.employee_salary_components for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'employee_salary_components', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'employee_salary_components', 'update'));
create policy esc_delete on public.employee_salary_components for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'employee_salary_components', 'delete'));

-- ---------- leave_requests: leave_file_own + leave_cancel_own untouched ----
-- ---------- (self-service only, no staff-role branch); only leave_decide's -
-- ---------- flat role check is matrix-wrapped. ----------------------------
drop policy if exists leave_select on public.leave_requests;
drop policy if exists leave_decide on public.leave_requests;
create policy leave_select on public.leave_requests for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'leave_requests', 'read')
        or exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid())))
);
create policy leave_decide on public.leave_requests for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
         and public.has_resource_permission(auth.uid(), 'leave_requests', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

-- ---------- leave_balances: self branch preserved, no bypass ---------------
drop policy if exists balances_select on public.leave_balances;
drop policy if exists balances_write on public.leave_balances;
create policy balances_select on public.leave_balances for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    public.has_resource_permission(auth.uid(), 'leave_balances', 'read')
    or exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid())));
create policy balances_insert on public.leave_balances for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'leave_balances', 'create'));
create policy balances_update on public.leave_balances for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'leave_balances', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'leave_balances', 'update'));
create policy balances_delete on public.leave_balances for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'leave_balances', 'delete'));

-- ---------- staff_attendance: self branch preserved, no bypass -------------
drop policy if exists staff_att_select on public.staff_attendance;
drop policy if exists staff_att_write on public.staff_attendance;
create policy staff_att_select on public.staff_attendance for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    public.has_resource_permission(auth.uid(), 'staff_attendance', 'read')
    or exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid())));
create policy staff_att_insert on public.staff_attendance for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'staff_attendance', 'create'));
create policy staff_att_update on public.staff_attendance for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'staff_attendance', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'staff_attendance', 'update'));
create policy staff_att_delete on public.staff_attendance for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'staff_attendance', 'delete'));

-- ---------- payroll_runs: structural checks (status/prepared_by/tenant-only
-- ---------- WITH CHECK) preserved verbatim; payroll_run_transition()
-- ---------- trigger and sod_preparer_not_approver constraint untouched. ---
drop policy if exists runs_select on public.payroll_runs;
drop policy if exists runs_insert on public.payroll_runs;
drop policy if exists runs_approve on public.payroll_runs;
create policy runs_select on public.payroll_runs for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'payroll_runs', 'read'));
create policy runs_insert on public.payroll_runs for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'payroll_runs', 'create')
  and status = 'draft' and prepared_by = auth.uid());
create policy runs_approve on public.payroll_runs for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
         and public.has_resource_permission(auth.uid(), 'payroll_runs', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

-- ---------- payslips / payslip_lines: read-only, self branch preserved -----
drop policy if exists payslips_select on public.payslips;
create policy payslips_select on public.payslips for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (public.has_resource_permission(auth.uid(), 'payslips', 'read')
       or exists (select 1 from public.employees e where e.id = payslips.employee_id and e.user_id = auth.uid()))
);

drop policy if exists payslip_lines_select on public.payslip_lines;
create policy payslip_lines_select on public.payslip_lines for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (public.has_resource_permission(auth.uid(), 'payslip_lines', 'read')
       or exists (select 1 from public.payslips p join public.employees e on e.id = p.employee_id
                  where p.id = payslip_lines.payslip_id and e.user_id = auth.uid()))
);

-- ---------- staff_performance_reviews: self branch preserved; accountant --
-- ---------- deliberately excluded from the default read population, ------
-- ---------- matching the original "payroll has no business reading -------
-- ---------- appraisals" design. --------------------------------------------
drop policy if exists staff_reviews_select on public.staff_performance_reviews;
drop policy if exists staff_reviews_write on public.staff_performance_reviews;
create policy staff_reviews_select on public.staff_performance_reviews for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    public.has_resource_permission(auth.uid(), 'staff_performance_reviews', 'read')
    or exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid())));
create policy staff_reviews_insert on public.staff_performance_reviews for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'staff_performance_reviews', 'create'));
create policy staff_reviews_update on public.staff_performance_reviews for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'staff_performance_reviews', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'staff_performance_reviews', 'update'));
create policy staff_reviews_delete on public.staff_performance_reviews for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'staff_performance_reviews', 'delete'));
