-- ============================================================================
-- R6 WP-02: who may EXECUTE each SECURITY DEFINER function in public, besides
-- service_role (which keeps its grant on everything, for Edge Functions) and
-- the owner. The single reviewed source for re-grants: migration
-- 20260926000001_r6_definer_lockdown.sql grants exactly these, and
-- supabase/tests/rls/catalog_definer_security.sql asserts the catalog matches
-- this table exactly, in both directions. A new definer function therefore
-- fails CI until it is added here with a reason (or its grant is revoked).
-- Every other definer function is service_role-only; trigger functions need
-- no grant at all (EXECUTE is checked at CREATE TRIGGER, not when it fires).
-- ============================================================================
create temp table definer_allowlist (sig text, grantee text, reason text not null, primary key (sig, grantee)) on commit drop;
insert into definer_allowlist values
  -- RLS helpers: policies call them as the querying user.
  ('get_tenant_id_for_user(uuid)', 'authenticated', 'RLS helper (321 policies); answers only for the caller or a user in the caller''s tenant'),
  ('get_role_for_user(uuid)', 'authenticated', 'RLS helper (215 policies); answers only for the caller or a user in the caller''s tenant'),
  ('get_email_for_user(uuid)', 'authenticated', 'users_self_update policy; returns only the caller''s own email'),
  ('has_module(uuid,text)', 'authenticated', 'module-gate policies; answers only for the caller''s tenant (super_admin: any)'),
  ('has_resource_permission(uuid,text,text)', 'authenticated', 'permission policies; answers only for the caller'),
  ('is_guardian_of(uuid)', 'authenticated', 'relationship policies; uses auth.uid()'),
  ('is_teacher_of_class(uuid)', 'authenticated', 'relationship policies; uses auth.uid()'),
  ('jwt_user_id()', 'authenticated', 'HR/clinic view policies; returns the caller''s own id'),
  ('attendance_retroactive_edit_window_days(uuid)', 'authenticated', 'attendance_retroactive_edit_gate policy; end users get their own tenant''s window, the default 7 for any other'),
  -- RPCs the app calls; each derives tenant and role from auth.uid().
  ('acknowledge_alert(uuid)', 'authenticated', 'Health monitoring page; school_admin, own tenant only'),
  ('auto_assign_exam_seats(uuid,integer,integer)', 'authenticated', 'Exams page; own tenant, school_admin or the class teacher; another tenant''s exam reads as not found'),
  ('check_staff_employee_linkage()', 'authenticated', 'HR dashboard card; school_admin/hr_officer, own tenant'),
  ('create_export_job(uuid,text)', 'authenticated', 'Import/Export page; school_admin, own tenant only'),
  ('create_import_job(uuid,text,integer)', 'authenticated', 'Import/Export page; school_admin, own tenant only'),
  ('dashboard_alerts(date,date)', 'authenticated', 'Dashboard; gated by dashboard_can_read inside'),
  ('dashboard_attendance_week(date)', 'authenticated', 'Dashboard; gated inside'),
  ('dashboard_billing(date,date)', 'authenticated', 'Dashboard; gated by dashboard_can_read_finance inside'),
  ('dashboard_high_absence(date,date,numeric,integer)', 'authenticated', 'Dashboard; gated inside'),
  ('dashboard_lowest_gpa(integer)', 'authenticated', 'Dashboard; gated inside'),
  ('dashboard_missing_attendance(date,date)', 'authenticated', 'Dashboard; gated inside'),
  ('dashboard_overview(uuid)', 'authenticated', 'Dashboard; gated inside'),
  ('get_class_rank(uuid,uuid)', 'authenticated', 'Report card / academic record; checks the caller may see the student'),
  ('get_security_settings()', 'authenticated', 'Session timeout and password policy for signed-in users; login thresholds only for super_admin'),
  ('get_student_grade_history(uuid)', 'authenticated', 'Academic record; checks the caller may see the student'),
  -- R6 WP-09 maker-checker. Each derives tenant and role from auth.uid().
  ('submit_approval(text,uuid,jsonb,text)', 'authenticated', 'Maker submits a request; own tenant, needs the underlying write permission'),
  ('decide_approval(uuid,text,text,text)', 'authenticated', 'Checker decides; own tenant, <resource>:approve, never the maker, payload hash must match'),
  ('set_approval_settings(boolean,numeric)', 'authenticated', 'Approval rules page; school_admin, own tenant, merges only settings.approvals'),
  ('approval_required(uuid,text,numeric)', 'authenticated', 'Called by the invoker payments gate as the inserting user; answers only for the caller''s tenant'),
  ('exam_results_published(uuid)', 'authenticated', 'Called by the invoker grades gate as the editing user; answers only for the caller''s tenant'),
  ('get_tenant_id_for_user(uuid)', 'timhirt_view_owner', 'hr_sensitive_view_read / clinic_detail_view_read run as the view owner'),
  ('get_role_for_user(uuid)', 'timhirt_view_owner', 'same view policies'),
  ('jwt_user_id()', 'timhirt_view_owner', 'same view policies');
