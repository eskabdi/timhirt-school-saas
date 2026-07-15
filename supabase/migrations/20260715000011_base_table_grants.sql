-- ============================================================================
-- CRITICAL fix: base table privileges were never granted to `authenticated`
-- or `service_role`.
--
-- RLS policies (migrations 005/008) define which ROWS a role may see, but
-- Postgres checks the coarse-grained table-level GRANT before RLS is
-- evaluated at all. Migrations 001-010 never issued a blanket
-- `GRANT ... ON TABLES ... TO authenticated, service_role`, and tables
-- created by the migration-running role do not inherit the platform's
-- default grants (those only apply to objects created by `supabase_admin`).
-- The net effect: every direct table query — from the frontend via
-- PostgREST as `authenticated`, and from every Edge Function's admin client
-- as `service_role` (onboard-tenant, run-payroll, process-fee-payment,
-- generate-payslip-pdf) — fails with "permission denied for table X"
-- before RLS, `security_invoker` views (hr_employee_sensitive,
-- clinic_visit_detail, migration 010's M1 fix), and SECURITY DEFINER
-- functions that read/write base tables directly ever get a chance to run.
-- `service_role` has BYPASSRLS but is not a superuser and is not exempt
-- from this table-level check either.
--
-- `anon` is intentionally NOT granted base table access here: every public
-- (unauthenticated) flow in this codebase (submit-admission, verify-id)
-- goes through an Edge Function using the service_role key server-side,
-- never the anon key directly against PostgREST — so anon keeps the
-- pre-existing default-deny plus its narrow `verify_id_card` EXECUTE grant
-- (migration 008/010) and nothing else.
-- ============================================================================

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

-- Re-apply the column-level denials from migrations 002/004/007: the blanket
-- table-wide GRANT SELECT above supersedes the narrower column-level REVOKEs
-- that migrations 002/004/007 issued against a role that, at the time, held
-- no table-wide SELECT to narrow in the first place. Reissue them here, after
-- the table grant, so they take effect for real.
revoke select (medical_notes) on public.students from authenticated;

revoke select (tin_number, pension_no, bank_account) on public.employees from authenticated;

revoke select (complaint, treatment, medication) on public.clinic_visits from authenticated;

revoke select (condition) on public.health_conditions from authenticated;
