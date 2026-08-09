-- ============================================================================
-- 005 RLS — fail-closed policies on every tenant table (INSA authorization core)
-- Pattern: tenant_id match + role scoping; super_admin bypass is an EXPLICIT
-- policy clause (visible, versioned, testable). FORCE RLS so owners obey too.
-- ============================================================================

-- Convenience macros as inline SQL (kept verbose intentionally for auditability)

-- ---------- tenants / users / configs ----------------------------------------
alter table public.tenants enable row level security;
alter table public.tenants force row level security;
create policy tenants_select on public.tenants for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or id = (select public.get_tenant_id_for_user(auth.uid()))
);
create policy tenants_write on public.tenants for all to authenticated
using ((select public.get_role_for_user(auth.uid())) = 'super_admin')
with check ((select public.get_role_for_user(auth.uid())) = 'super_admin');

alter table public.users enable row level security;
alter table public.users force row level security;
create policy users_select on public.users for select to authenticated using (
  id = auth.uid()
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
      and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer','registrar'))
);
create policy users_self_update on public.users for update to authenticated
using (id = auth.uid()) with check (id = auth.uid() and role = (select public.get_role_for_user(auth.uid()))::public.user_role);
-- role changes & user creation happen via service_role (onboard/invite functions) only

alter table public.tenant_configs enable row level security;
alter table public.tenant_configs force row level security;
create policy configs_select on public.tenant_configs for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
create policy configs_write on public.tenant_configs for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin');

-- ---------- generic tenant-admin tables ---------------------------------------
-- academic_years, academic_terms, calendar_events, classes, subjects,
-- fee_structures, salary_components, leave_types: read = same tenant;
-- write = school_admin (HR tables also hr_officer where noted).
do $$
declare t text;
begin
  foreach t in array array['academic_years','academic_terms','calendar_events',
                           'classes','subjects','fee_structures']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated using (
        tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        or (select public.get_role_for_user(auth.uid())) = 'super_admin')$f$, t);
    execute format($f$
      create policy %1$s_write on public.%1$I for all to authenticated
      using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and (select public.get_role_for_user(auth.uid())) = 'school_admin')
      with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and (select public.get_role_for_user(auth.uid())) = 'school_admin')$f$, t);
  end loop;
end $$;

-- ---------- students (§7.3 pattern) -------------------------------------------
alter table public.students enable row level security;
alter table public.students force row level security;
create policy students_select on public.students for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar')
        or public.is_teacher_of_class(class_id)
        or user_id = auth.uid()
        or public.is_guardian_of(id)))
);
create policy students_write on public.students for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'));

alter table public.guardians enable row level security;
alter table public.guardians force row level security;
create policy guardians_select on public.guardians for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar')
        or user_id = auth.uid()))
);
create policy guardians_write on public.guardians for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'));

alter table public.teachers enable row level security;
alter table public.teachers force row level security;
create policy teachers_select on public.teachers for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin');
create policy teachers_write on public.teachers for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'));

alter table public.class_subject_teachers enable row level security;
alter table public.class_subject_teachers force row level security;
create policy cst_select on public.class_subject_teachers for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin');
create policy cst_write on public.class_subject_teachers for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin');

-- ---------- attendance: teachers write ONLY their own classes ----------------
alter table public.attendance enable row level security;
alter table public.attendance force row level security;
create policy attendance_select on public.attendance for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) = 'school_admin'
        or public.is_teacher_of_class(class_id)
        or exists (select 1 from public.students s where s.id = student_id
                   and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy attendance_write on public.attendance
for insert to authenticated
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and ((select public.get_role_for_user(auth.uid())) = 'school_admin'
       or public.is_teacher_of_class(class_id)));
create policy attendance_update on public.attendance
for update to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and ((select public.get_role_for_user(auth.uid())) = 'school_admin'
       or public.is_teacher_of_class(class_id)))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

-- ---------- exams & grades ----------------------------------------------------
alter table public.exams enable row level security;
alter table public.exams force row level security;
create policy exams_select on public.exams for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin');
create policy exams_write on public.exams for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin');

alter table public.grades enable row level security;
alter table public.grades force row level security;
create policy grades_select on public.grades for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) = 'school_admin'
        or exists (select 1 from public.students s where s.id = student_id
                   and (public.is_teacher_of_class(s.class_id)
                        or s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy grades_write on public.grades for insert to authenticated
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and ((select public.get_role_for_user(auth.uid())) = 'school_admin'
       or exists (select 1 from public.students s where s.id = student_id
                  and public.is_teacher_of_class(s.class_id))));
create policy grades_update on public.grades for update to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and ((select public.get_role_for_user(auth.uid())) = 'school_admin'
       or exists (select 1 from public.students s where s.id = student_id
                  and public.is_teacher_of_class(s.class_id))))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

-- ---------- fees & payments ---------------------------------------------------
alter table public.fee_invoices enable row level security;
alter table public.fee_invoices force row level security;
create policy invoices_select on public.fee_invoices for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) in ('school_admin','accountant')
        or exists (select 1 from public.students s where s.id = student_id
                   and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy invoices_write on public.fee_invoices for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','accountant'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','accountant'));

alter table public.payments enable row level security;
alter table public.payments force row level security;
create policy payments_select on public.payments for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) in ('school_admin','accountant')
        or exists (select 1 from public.fee_invoices i
                   join public.students s on s.id = i.student_id
                   where i.id = invoice_id
                     and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
-- Cash/bank receipts entered by accountant; gateway payments flip ONLY via webhook (service_role)
create policy payments_manual_insert on public.payments for insert to authenticated
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','accountant')
  and provider in ('cash','bank'));

alter table public.webhook_events enable row level security;
alter table public.webhook_events force row level security;
-- no policies: service_role only (replay-protection table)

-- ---------- HR & payroll (§18.5) ----------------------------------------------
alter table public.employees enable row level security;
alter table public.employees force row level security;
create policy employees_select on public.employees for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer','accountant')
        or user_id = auth.uid()))
);
create policy employees_write on public.employees for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'));

alter table public.employment_contracts enable row level security;
alter table public.employment_contracts force row level security;
create policy contracts_select on public.employment_contracts for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer','accountant')
        or exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid())))
);
create policy contracts_write on public.employment_contracts for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'));

do $$
declare t text;
begin
  foreach t in array array['salary_components','leave_types']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated using (
        tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        or (select public.get_role_for_user(auth.uid())) = 'super_admin')$f$, t);
    execute format($f$
      create policy %1$s_write on public.%1$I for all to authenticated
      using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'))
      with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'))$f$, t);
  end loop;
end $$;

alter table public.employee_salary_components enable row level security;
alter table public.employee_salary_components force row level security;
create policy esc_select on public.employee_salary_components for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer','accountant'));
create policy esc_write on public.employee_salary_components for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'));

-- Statutory tables: read-all authenticated; write = super_admin only
alter table public.tax_brackets enable row level security;
alter table public.tax_brackets force row level security;
create policy tax_read  on public.tax_brackets  for select to authenticated using (true);
create policy tax_write on public.tax_brackets  for all to authenticated
using ((select public.get_role_for_user(auth.uid())) = 'super_admin')
with check ((select public.get_role_for_user(auth.uid())) = 'super_admin');
alter table public.pension_rates enable row level security;
alter table public.pension_rates force row level security;
create policy pension_read  on public.pension_rates for select to authenticated using (true);
create policy pension_write on public.pension_rates for all to authenticated
using ((select public.get_role_for_user(auth.uid())) = 'super_admin')
with check ((select public.get_role_for_user(auth.uid())) = 'super_admin');

-- Leave: employees file their OWN requests; HR decides
alter table public.leave_requests enable row level security;
alter table public.leave_requests force row level security;
create policy leave_select on public.leave_requests for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer')
        or exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid())))
);
create policy leave_file_own on public.leave_requests for insert to authenticated
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid())
  and status = 'pending');
create policy leave_decide on public.leave_requests for update to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

alter table public.leave_balances enable row level security;
alter table public.leave_balances force row level security;
create policy balances_select on public.leave_balances for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer')
    or exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid())));
create policy balances_write on public.leave_balances for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'));

alter table public.staff_attendance enable row level security;
alter table public.staff_attendance force row level security;
create policy staff_att_select on public.staff_attendance for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer')
    or exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid())));
create policy staff_att_write on public.staff_attendance for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'));

-- Payroll runs: HR/admin read + create drafts; approve/pay = accountant (SoD by check constraint)
alter table public.payroll_runs enable row level security;
alter table public.payroll_runs force row level security;
create policy runs_select on public.payroll_runs for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer','accountant'));
create policy runs_insert on public.payroll_runs for insert to authenticated
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer')
  and status = 'draft' and prepared_by = auth.uid());
create policy runs_approve on public.payroll_runs for update to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('accountant','school_admin'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

-- §18.5 Payslips: NO client-writable policy exists — mutations only via
-- the run-payroll Edge Function (service_role). Read: finance roles or self.
alter table public.payslips enable row level security;
alter table public.payslips force row level security;
create policy payslips_select on public.payslips for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and ((select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer','accountant')
       or exists (select 1 from public.employees e
                  where e.id = payslips.employee_id and e.user_id = auth.uid()))
);

alter table public.payslip_lines enable row level security;
alter table public.payslip_lines force row level security;
create policy payslip_lines_select on public.payslip_lines for select to authenticated using (
  exists (select 1 from public.payslips p where p.id = payslip_id)  -- inherits payslip RLS
);
