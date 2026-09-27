-- ============================================================================
-- Known offenders: tenant tables (tenant_id) without a restrictive *_module_gate policy. Not yet classified: WP-06 either adds the gate or moves the table to module_gate_allowlist.sql with a reason.
-- Loaded by supabase/tests/rls/catalog_module_gate.sql (\ir). This list may only SHRINK:
-- the suite fails on any offender not listed here (a regression) and on any
-- listed entry that no longer offends (so the list stays exact). WP-06 fixes
-- these and deletes this file's rows as it goes. Generated 2026-09-25 from the
-- harness DB with Supabase-faithful grants (R6 WP-01), which matches production
-- (audit/evidence/wp01-acl-parity-*.txt).
-- ============================================================================
create temp table known_no_module_gate (relname text primary key) on commit drop;
insert into known_no_module_gate values
  ('academic_terms'),
  ('academic_years'),
  ('asset_register'),
  ('audit_logs'),
  ('backup_jobs'),
  ('bank_payment_verifications'),
  ('builtin_role_permission_grants'),
  ('class_subject_teachers'),
  ('classes'),
  ('data_jobs'),
  ('document_templates'),
  ('employee_emergency_contacts'),
  ('employee_qualifications'),
  ('employee_subjects'),
  ('exam_seat_assignments'),
  ('feature_flags'),
  ('grade_bands'),
  ('grading_scales'),
  ('health_alerts'),
  ('messages'),
  ('portal_notifications'),
  ('promotion_run_students'),
  ('promotion_runs'),
  ('report_templates'),
  ('restore_jobs'),
  ('roles'),
  ('student_leave_requests'),
  ('subjects'),
  ('system_config'),
  ('system_health'),
  ('teachers'),
  ('tenant_configs'),
  ('tenant_module_overrides'),
  ('tenant_sso_providers'),
  ('user_permission_overrides'),
  ('user_roles'),
  ('users');
