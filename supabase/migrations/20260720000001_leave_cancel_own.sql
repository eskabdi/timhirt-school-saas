-- ============================================================================
-- Allow employees to cancel their OWN pending leave requests.
--
-- The core policy set (20260713000005) only grants UPDATE on leave_requests to
-- school_admin / hr_officer (leave_decide). Employees could file (leave_file_own
-- INSERT) but never withdraw a request. This adds a narrow, permissive UPDATE
-- policy: the signed-in user may transition their own request from 'pending' to
-- 'cancelled' and nothing else. Permissive policies are OR'd, so leave_decide is
-- unaffected.
-- ============================================================================
create policy leave_cancel_own on public.leave_requests for update to authenticated
  using (
    tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
    and status = 'pending'
    and exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid())
  )
  with check (
    tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
    and status = 'cancelled'
    and exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid())
  );
