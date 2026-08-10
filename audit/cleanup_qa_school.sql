-- ============================================================================
-- cleanup_qa_school.sql
--
-- Removes ONLY the QA test tenant created during the live production audit
-- ("QA - Harar Model Secondary School", slug `qa-harar-model`) and every row
-- that hangs off it — nothing else. Every pre-existing tenant (Aw Abdal,
-- Abadir) is untouched; this script never references them and never deletes
-- by anything other than this one tenant's id, resolved by slug at the top
-- so it can't accidentally drift onto the wrong tenant if ids ever change.
--
-- Deletes are ordered children-before-parents to respect foreign keys (many
-- of which are RESTRICT, not CASCADE, in this schema — see e.g.
-- `students.tenant_id ... on delete restrict` in
-- 20260713000002_academic.sql). The whole thing runs as one transaction: if
-- any statement fails (e.g. a table this script didn't anticipate still
-- references a row), everything rolls back and nothing is half-deleted.
--
-- Also removes the real `auth.users` rows this audit created directly via
-- the product's own invite/portal-provisioning flows (real Supabase Auth
-- identities, not just `public.users` profile rows) — matched by the exact
-- email patterns used throughout the audit, which cannot match any other
-- tenant's real users.
--
-- Run this against the same production project the audit was performed
-- against (livqynxlibmccaycseer). Review before running, same discipline as
-- any other production SQL in this repo (see the `deploy` skill).
-- ============================================================================

begin;

do $$
declare
  v_tenant_id uuid;
begin
  select id into v_tenant_id from public.tenants where slug = 'qa-harar-model';

  if v_tenant_id is null then
    raise notice 'No tenant with slug qa-harar-model found — nothing to do.';
    return;
  end if;

  raise notice 'Cleaning up tenant % (qa-harar-model)', v_tenant_id;

  -- ---------- Payroll (leaf-most: payslip_lines -> payslips -> runs) -------
  delete from public.payslip_lines
    where payslip_id in (select id from public.payslips where tenant_id = v_tenant_id);
  delete from public.payslips where tenant_id = v_tenant_id;
  delete from public.payroll_runs where tenant_id = v_tenant_id;
  delete from public.employee_salary_components where tenant_id = v_tenant_id;
  delete from public.employment_contracts where tenant_id = v_tenant_id;

  -- ---------- HR / Leave ----------------------------------------------------
  delete from public.leave_requests where tenant_id = v_tenant_id;
  delete from public.leave_types where tenant_id = v_tenant_id;
  delete from public.hr_documents where tenant_id = v_tenant_id;
  delete from public.employees where tenant_id = v_tenant_id;

  -- ---------- Fees / Billing (leaf-most first) ------------------------------
  delete from public.bank_payment_verifications where tenant_id = v_tenant_id;
  delete from public.fee_documents where tenant_id = v_tenant_id;
  delete from public.payments where tenant_id = v_tenant_id;
  delete from public.fee_invoices where tenant_id = v_tenant_id;
  delete from public.invoice_headers where tenant_id = v_tenant_id;
  delete from public.fee_structures where tenant_id = v_tenant_id;

  -- ---------- Library --------------------------------------------------------
  delete from public.library_fines
    where checkout_id in (select id from public.library_checkouts where tenant_id = v_tenant_id);
  delete from public.library_checkouts where tenant_id = v_tenant_id;
  delete from public.library_holds where tenant_id = v_tenant_id;
  delete from public.library_book_copies where tenant_id = v_tenant_id;
  delete from public.library_books where tenant_id = v_tenant_id;
  delete from public.library_settings where tenant_id = v_tenant_id;

  -- ---------- Notifications / Communications ---------------------------------
  delete from public.portal_notifications where tenant_id = v_tenant_id;
  delete from public.announcements where tenant_id = v_tenant_id;
  delete from public.notification_log where tenant_id = v_tenant_id;
  delete from public.messages where tenant_id = v_tenant_id;

  -- ---------- ID cards ---------------------------------------------------------
  delete from public.id_cards where tenant_id = v_tenant_id;
  delete from public.id_card_batches where tenant_id = v_tenant_id;

  -- ---------- Academics: grades / exams / attendance / timetable --------------
  delete from public.grades where tenant_id = v_tenant_id;
  delete from public.exams where tenant_id = v_tenant_id;
  delete from public.attendance where tenant_id = v_tenant_id;
  delete from public.timetable_slots where tenant_id = v_tenant_id;
  delete from public.periods where tenant_id = v_tenant_id;
  delete from public.class_subject_teachers where tenant_id = v_tenant_id;
  delete from public.assignment_attachments where tenant_id = v_tenant_id;
  delete from public.assignment_sections where tenant_id = v_tenant_id;
  delete from public.assignments where tenant_id = v_tenant_id;
  delete from public.grading_scales where tenant_id = v_tenant_id;

  -- ---------- Admissions -------------------------------------------------------
  delete from public.admission_applications where tenant_id = v_tenant_id;

  -- ---------- Guardians, teachers (reference students/users) -------------------
  delete from public.guardians where tenant_id = v_tenant_id;
  delete from public.teachers where tenant_id = v_tenant_id;

  -- ---------- Students (RESTRICT — must be last among student-referencing) -----
  delete from public.students where tenant_id = v_tenant_id;

  -- ---------- Structural: classes / subjects / calendar / academic years -------
  delete from public.calendar_events where tenant_id = v_tenant_id;
  delete from public.subjects where tenant_id = v_tenant_id;
  delete from public.classes where tenant_id = v_tenant_id;
  delete from public.academic_terms where tenant_id = v_tenant_id;
  delete from public.academic_years where tenant_id = v_tenant_id;

  -- ---------- Platform-facing tenant config -------------------------------------
  delete from public.tenant_module_overrides where tenant_id = v_tenant_id;
  delete from public.tenant_configs where tenant_id = v_tenant_id;

  -- ---------- Audit log rows this tenant generated ------------------------------
  delete from public.audit_logs where tenant_id = v_tenant_id;

  -- ---------- Users (must come after teachers/employees, which reference it) ---
  delete from public.users where tenant_id = v_tenant_id;

  -- ---------- The tenant row itself ---------------------------------------------
  delete from public.tenants where id = v_tenant_id;

  raise notice 'Deleted tenant % and all its rows.', v_tenant_id;
end $$;

-- ============================================================================
-- Real Supabase Auth identities created for this audit (school_admin,
-- teacher/registrar/accountant/librarian invites, and the synthetic
-- no-email student/guardian portal accounts). Matched by exact email/domain
-- patterns that only ever appear for this tenant's test accounts.
-- ============================================================================
delete from auth.users
where email = 'rekonjo@gmail.com'
   or email like 'rekonjo+%@gmail.com'
   or email like '%@qa-harar-model.portal.local';

commit;

-- ============================================================================
-- Verification (run after commit): every query below should return 0 rows /
-- no tenant found.
-- ============================================================================
-- select * from public.tenants where slug = 'qa-harar-model';
-- select * from auth.users where email like '%qa-harar-model%' or email like 'rekonjo%';
