-- ============================================================================
-- Known offenders: SECURITY DEFINER functions in public that anon can EXECUTE (H-01).
-- Loaded by supabase/tests/rls/catalog_definer_security.sql (\ir). This list may only SHRINK:
-- the suite fails on any offender not listed here (a regression) and on any
-- listed entry that no longer offends (so the list stays exact). WP-02 fixes
-- these and deletes this file's rows as it goes. Generated 2026-09-25 from the
-- harness DB with Supabase-faithful grants (R6 WP-01), which matches production
-- (audit/evidence/wp01-acl-parity-*.txt).
-- ============================================================================
create temp table known_definer_anon (sig text primary key) on commit drop;
insert into known_definer_anon values
  ('acknowledge_alert(uuid)'),
  ('apply_payment_to_invoice()'),
  ('attendance_guard()'),
  ('attendance_notify_guardians()'),
  ('attendance_retroactive_edit_window_days(uuid)'),
  ('audit_trigger()'),
  ('auto_assign_exam_seats(uuid,integer,integer)'),
  ('cleanup_expired_backups()'),
  ('complete_job(uuid,integer,text)'),
  ('create_export_job(uuid,text)'),
  ('create_health_alert(uuid,text,text,text)'),
  ('create_import_job(uuid,text,integer)'),
  ('exam_guard()'),
  ('fail_job(uuid,text)'),
  ('get_class_rank(uuid,uuid)'),
  ('get_config(text,uuid)'),
  ('get_email_for_user(uuid)'),
  ('get_role_for_user(uuid)'),
  ('get_security_settings()'),
  ('get_student_grade_history(uuid)'),
  ('get_tenant_id_for_user(uuid)'),
  ('grade_guard()'),
  ('grade_point_for(uuid,numeric)'),
  ('guardians_lock_user_id()'),
  ('has_module(uuid,text)'),
  ('has_permission(uuid,text)'),
  ('has_resource_permission(uuid,text,text)'),
  ('is_feature_enabled(text,uuid)'),
  ('is_guardian_of(uuid)'),
  ('is_teacher_of_class(uuid)'),
  ('jwt_user_id()'),
  ('leave_decision_trigger()'),
  ('library_checkout_tenant_guard()'),
  ('library_hold_tenant_guard()'),
  ('payroll_run_transition()'),
  ('record_health_metric(uuid,text,numeric,text,numeric,numeric)'),
  ('student_capture_graduation_year()'),
  ('student_clear_transfer_fields()'),
  ('students_lock_user_id()'),
  ('timeout_stalled_backups()'),
  ('update_job_progress(uuid,integer,integer,jsonb)'),
  ('users_lock_identity()');
