-- ============================================================================
-- Audit logging — builds on the core audit system (20260713000001_core.sql).
--
-- The core schema already provides a complete, append-only audit trail:
--   * public.audit_logs(id, tenant_id, actor_id, action, table_name, row_id,
--     old_data, new_data, created_at) with RLS (super_admin sees all;
--     school_admin sees own tenant) and no update/delete policies.
--   * public.audit_trigger() — SECURITY DEFINER, redacts PII (medical_notes,
--     phone, email, tin_number, pension_no, bank_account) before persisting,
--     already attached to the compliance-relevant tables: students, grades,
--     payments, fee_invoices, payroll_runs, payslips, employees,
--     employment_contracts, leave_requests, guardians, clinic_visits,
--     discipline_incidents, admission_applications, platform_integrations.
--
-- This migration EXTENDS that coverage to two low-volume configuration tables
-- that were not yet audited, and adds a retention helper. It intentionally does
-- NOT drop or recreate audit_logs / audit_trigger(), so existing audit data and
-- triggers survive the upgrade (dropping them would break every existing
-- audited table on the next write).
-- ============================================================================

-- Extend audit coverage to class + teacher configuration changes. Both are
-- low-volume, compliance-relevant tables (who altered class structure / staff
-- records) and carry id + tenant_id, so the core trigger records them cleanly.
drop trigger if exists audit_classes on public.classes;
create trigger audit_classes after insert or update or delete on public.classes
  for each row execute function public.audit_trigger();

drop trigger if exists audit_teachers on public.teachers;
create trigger audit_teachers after insert or update or delete on public.teachers
  for each row execute function public.audit_trigger();

-- Retention helper: purge audit rows older than one year. Intended to be run on
-- a schedule (pg_cron) or manually by an operator; safe to call repeatedly.
create or replace function public.cleanup_old_audit_logs()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.audit_logs where created_at < now() - interval '1 year';
end $$;

comment on function public.cleanup_old_audit_logs is
  'Purge audit_logs entries older than one year (retention).';
