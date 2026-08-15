-- ============================================================================
-- HIGH fix: module/plan gating was UI-only. RequireModule.tsx gated only the
-- React route; the API served disabled modules regardless of
-- tenant_module_overrides / the tenant's subscription tier. Live-verified
-- before this fix: disabling 'library' via tenant_module_overrides still
-- allowed full read/write on library_books through direct PostgREST calls.
--
-- has_module(p_tenant_id, p_module_key) resolves the same precedence
-- useEnabledModules.ts already uses client-side: a tenant_module_overrides
-- row wins if present (enabled true/false), else the tenant's tier_key's
-- tier_modules membership, else false (fail closed). Subselects return NULL
-- (not false) when they don't apply, so coalesce falls through correctly --
-- same idiom as has_resource_permission()
-- (20260817000001_resource_permissions_core_v2.sql).
--
-- Enforcement is one RESTRICTIVE policy per module-gated table (FOR ALL, so
-- it applies to select/insert/update/delete alike) rather than editing any
-- of the schema's ~362 existing PERMISSIVE policies. Postgres requires a row
-- to pass at least one PERMISSIVE policy for its command AND every
-- RESTRICTIVE policy -- so this is a pure additional AND condition, exactly
-- as intended, and cannot loosen anything an existing policy already
-- narrows. super_admin bypasses (platform staff aren't subject to a
-- tenant's own subscription), matching RequireModule.tsx's own bypass.
--
-- Table -> module mapping, resolved from router.tsx's actual RequireModule
-- usage (the ground truth for what each subscription module gates), not the
-- separate fine-grained permissions-matrix taxonomy (permissions.module),
-- which groups tables differently (e.g. "academics" vs "gradebook") for an
-- unrelated per-action permission system.
--
-- Deliberately NOT gated here, with reasons:
--   - messages: router.tsx's own comment -- "messaging isn't a toggleable
--     module, RLS (sender/recipient only) is the real access gate."
--   - classes, subjects, teachers, class_subject_teachers, academic_years,
--     academic_terms, tenant_configs, grading_scales: router.tsx marks
--     these "core tenant configuration, not one of the 18 subscription
--     modules."
--   - tax_brackets, pension_rates, notification_templates: platform-wide
--     reference data with no tenant_id column at all -- there is no
--     per-tenant module state to check.
--   - asset_register: no frontend route or query references this table at
--     all today; gating an orphan table with nothing to verify against
--     would be untestable, not a real fix.
--   - bank_payment_verifications: read from both the 'admissions' bank
--     verification UI and the 'fees' invoice UI; gating it to only one
--     module would break the other for any tenant with just one enabled.
--     Left as-is (its existing RLS is unchanged).
--
-- payslip_lines has no tenant_id column (only payslip_id) -- its policy
-- joins through payslips to reach the tenant, unlike every other table here.
-- ============================================================================

create or replace function public.has_module(p_tenant_id uuid, p_module_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select tmo.enabled from public.tenant_module_overrides tmo
     where tmo.tenant_id = p_tenant_id and tmo.module_key = p_module_key),
    (select true from public.tier_modules tm
     join public.tenants t on t.tier_key = tm.tier_key
     where t.id = p_tenant_id and tm.module_key = p_module_key),
    false
  );
$$;

-- ---------- sis ---------------------------------------------------------
create policy students_module_gate on public.students as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'sis')
);
create policy guardians_module_gate on public.guardians as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'sis')
);
create policy student_merits_module_gate on public.student_merits as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'sis')
);

-- ---------- admissions ---------------------------------------------------------
create policy admission_applications_module_gate on public.admission_applications as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'admissions')
);

-- ---------- id_cards ---------------------------------------------------------
create policy id_cards_module_gate on public.id_cards as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'id_cards')
);
create policy id_card_batches_module_gate on public.id_card_batches as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'id_cards')
);

-- ---------- fees ---------------------------------------------------------
create policy fee_structures_module_gate on public.fee_structures as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'fees')
);
create policy fee_invoices_module_gate on public.fee_invoices as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'fees')
);
create policy payments_module_gate on public.payments as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'fees')
);
create policy invoice_headers_module_gate on public.invoice_headers as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'fees')
);
create policy fee_documents_module_gate on public.fee_documents as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'fees')
);

-- ---------- communication ---------------------------------------------------------
create policy announcements_module_gate on public.announcements as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'communication')
);
create policy notices_module_gate on public.notices as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'communication')
);
create policy notification_log_module_gate on public.notification_log as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'communication')
);

-- ---------- hostel ---------------------------------------------------------
create policy hostel_buildings_module_gate on public.hostel_buildings as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hostel')
);
create policy hostel_rooms_module_gate on public.hostel_rooms as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hostel')
);
create policy hostel_allocations_module_gate on public.hostel_allocations as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hostel')
);
create policy hostel_visitor_logs_module_gate on public.hostel_visitor_logs as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hostel')
);

-- ---------- discipline ---------------------------------------------------------
create policy discipline_incidents_module_gate on public.discipline_incidents as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'discipline')
);

-- ---------- clinic ---------------------------------------------------------
create policy clinic_visits_module_gate on public.clinic_visits as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'clinic')
);
create policy health_conditions_module_gate on public.health_conditions as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'clinic')
);

-- ---------- transport ---------------------------------------------------------
create policy transport_routes_module_gate on public.transport_routes as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'transport')
);
create policy transport_stops_module_gate on public.transport_stops as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'transport')
);
create policy student_route_assignments_module_gate on public.student_route_assignments as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'transport')
);

-- ---------- events ---------------------------------------------------------
create policy calendar_events_module_gate on public.calendar_events as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'events')
);

-- ---------- inventory ---------------------------------------------------------
create policy inventory_items_module_gate on public.inventory_items as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'inventory')
);
create policy inventory_movements_module_gate on public.inventory_movements as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'inventory')
);

-- ---------- reporting ---------------------------------------------------------
create policy moe_exports_module_gate on public.moe_exports as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'reporting')
);

-- ---------- library ---------------------------------------------------------
create policy library_books_module_gate on public.library_books as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'library')
);
create policy library_book_copies_module_gate on public.library_book_copies as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'library')
);
create policy library_checkouts_module_gate on public.library_checkouts as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'library')
);
create policy library_fines_module_gate on public.library_fines as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'library')
);
create policy library_holds_module_gate on public.library_holds as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'library')
);
create policy library_settings_module_gate on public.library_settings as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'library')
);

-- ---------- attendance ---------------------------------------------------------
create policy attendance_module_gate on public.attendance as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'attendance')
);

-- ---------- timetable ---------------------------------------------------------
create policy timetable_slots_module_gate on public.timetable_slots as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'timetable')
);
create policy periods_module_gate on public.periods as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'timetable')
);

-- ---------- gradebook ---------------------------------------------------------
create policy exams_module_gate on public.exams as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'gradebook')
);
create policy grades_module_gate on public.grades as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'gradebook')
);

-- ---------- assignments ---------------------------------------------------------
create policy assignments_module_gate on public.assignments as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'assignments')
);
create policy assignment_submissions_module_gate on public.assignment_submissions as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'assignments')
);
create policy assignment_sections_module_gate on public.assignment_sections as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'assignments')
);
create policy assignment_attachments_module_gate on public.assignment_attachments as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'assignments')
);

-- ---------- hr_payroll ---------------------------------------------------------
create policy employees_module_gate on public.employees as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hr_payroll')
);
create policy employment_contracts_module_gate on public.employment_contracts as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hr_payroll')
);
create policy salary_components_module_gate on public.salary_components as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hr_payroll')
);
create policy employee_salary_components_module_gate on public.employee_salary_components as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hr_payroll')
);
create policy leave_types_module_gate on public.leave_types as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hr_payroll')
);
create policy leave_requests_module_gate on public.leave_requests as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hr_payroll')
);
create policy leave_balances_module_gate on public.leave_balances as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hr_payroll')
);
create policy staff_attendance_module_gate on public.staff_attendance as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hr_payroll')
);
create policy payroll_runs_module_gate on public.payroll_runs as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hr_payroll')
);
create policy payslips_module_gate on public.payslips as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hr_payroll')
);
create policy staff_performance_reviews_module_gate on public.staff_performance_reviews as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hr_payroll')
);
create policy employee_documents_module_gate on public.employee_documents as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'hr_payroll')
);

-- ---------- hr_payroll (payslip_lines has no tenant_id -- join through payslips) ----
create policy payslip_lines_module_gate on public.payslip_lines as restrictive for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or exists (
    select 1 from public.payslips ps
    where ps.id = payslip_lines.payslip_id
      and public.has_module(ps.tenant_id, 'hr_payroll')
  )
);
