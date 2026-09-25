-- ============================================================================
-- Known offenders: public tables with RLS enabled but not FORCEd.
-- Loaded by supabase/tests/rls/catalog_rls_coverage.sql (\ir). This list may only SHRINK:
-- the suite fails on any offender not listed here (a regression) and on any
-- listed entry that no longer offends (so the list stays exact). WP-02 fixes
-- these and deletes this file's rows as it goes. Generated 2026-09-25 from the
-- harness DB with Supabase-faithful grants (R6 WP-01), which matches production
-- (audit/evidence/wp01-acl-parity-*.txt).
-- ============================================================================
create temp table known_rls_no_force (relname text primary key) on commit drop;
insert into known_rls_no_force values
  ('backup_jobs'),
  ('data_jobs'),
  ('feature_flags'),
  ('health_alerts'),
  ('permissions'),
  ('restore_jobs'),
  ('role_permissions'),
  ('roles'),
  ('system_config'),
  ('system_health'),
  ('user_roles');
