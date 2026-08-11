-- ============================================================================
-- leave_file_own is the ONLY insert policy on leave_requests -- an employee
-- with no portal login (or one who simply calls in sick) has no way to get
-- leave on file at all; someone in HR has to be able to file on their
-- behalf. This adds an ADDITIONAL insert policy for that -- leave_file_own
-- itself is untouched in intent (self-filing still works exactly as before)
-- and only hardened to also protect the new filed_by column below from
-- being spoofed, which is not a loosening of who may self-file.
--
-- filed_by distinguishes "whose leave this is" (employee_id) from "who
-- actually typed it into the system" (filed_by) -- defaults to auth.uid()
-- so every future insert, self-filed or on-behalf-of, stamps itself
-- automatically. audit_logs.actor_id (via the existing audit_leave
-- trigger, see 20260713000004_hr_payroll.sql:168-169) already records the
-- real caller on every insert regardless of this column; filed_by exists
-- so the UI can show "Filed by: <name>" without a join through audit_logs.
-- ============================================================================
alter table public.leave_requests
  add column filed_by uuid references auth.users(id);
alter table public.leave_requests
  alter column filed_by set default auth.uid();

-- Backfill: every existing row was necessarily self-filed (leave_file_own
-- was the only path), so filed_by = the employee's own user.
update public.leave_requests lr
set filed_by = e.user_id
from public.employees e
where e.id = lr.employee_id and lr.filed_by is null;

insert into public.permissions (key, module, resource, action, description) values
  ('leave_requests:create', 'hr_payroll', 'leave_requests', 'create', 'File leave on behalf of an employee')
on conflict (key) do nothing;

insert into public.resource_default_role_grants (resource, action, role) values
  ('leave_requests', 'create', 'school_admin'), ('leave_requests', 'create', 'hr_officer');

-- Re-create leave_file_own with its ORIGINAL conditions unchanged, plus one
-- addition: filed_by, if supplied at all, must be the caller's own id. This
-- does not loosen who may self-file (every original clause is identical);
-- it only stops a self-filer from writing someone else's id into the new
-- audit column.
drop policy if exists leave_file_own on public.leave_requests;
create policy leave_file_own on public.leave_requests for insert to authenticated
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid())
  and status = 'pending'
  and (filed_by is null or filed_by = auth.uid()));

-- New: school_admin, or a caller with the leave_requests:create resource
-- permission (hr_officer by default, or a custom role/override grant), may
-- file a pending leave request for any employee in their own tenant.
create policy leave_file_on_behalf on public.leave_requests for insert to authenticated
with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and exists (select 1 from public.employees e where e.id = employee_id and e.tenant_id = tenant_id)
  and status = 'pending'
  and (filed_by is null or filed_by = auth.uid())
  and (
    (select public.get_role_for_user(auth.uid())) = 'school_admin'
    or public.has_resource_permission(auth.uid(), 'leave_requests', 'create')
  )
);
