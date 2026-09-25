-- ============================================================================
-- Known offenders: SECURITY DEFINER functions in public without a pinned search_path (L-07).
-- Loaded by supabase/tests/rls/catalog_definer_security.sql (\ir). This list may only SHRINK:
-- the suite fails on any offender not listed here (a regression) and on any
-- listed entry that no longer offends (so the list stays exact). WP-02 fixes
-- these and deletes this file's rows as it goes. Generated 2026-09-25 from the
-- harness DB with Supabase-faithful grants (R6 WP-01), which matches production
-- (audit/evidence/wp01-acl-parity-*.txt).
-- ============================================================================
create temp table known_definer_no_search_path (sig text primary key) on commit drop;
insert into known_definer_no_search_path values
  ('acknowledge_alert(uuid)'),
  ('cleanup_expired_backups()'),
  ('complete_job(uuid,integer,text)'),
  ('create_export_job(uuid,text)'),
  ('create_health_alert(uuid,text,text,text)'),
  ('create_import_job(uuid,text,integer)'),
  ('fail_job(uuid,text)'),
  ('get_config(text,uuid)'),
  ('has_permission(uuid,text)'),
  ('is_feature_enabled(text,uuid)'),
  ('record_health_metric(uuid,text,numeric,text,numeric,numeric)'),
  ('timeout_stalled_backups()'),
  ('update_job_progress(uuid,integer,integer,jsonb)');
