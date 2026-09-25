-- ============================================================================
-- Known offenders: storage.objects SELECT policies whose only predicate is the bucket plus the tenant folder, so any role in the tenant (student, parent) reads every file (M-xx storage least privilege).
-- Loaded by supabase/tests/rls/catalog_storage_policies.sql (\ir). This list may only SHRINK:
-- the suite fails on any offender not listed here (a regression) and on any
-- listed entry that no longer offends (so the list stays exact). WP-05 fixes
-- these and deletes this file's rows as it goes. Generated 2026-09-25 from the
-- harness DB with Supabase-faithful grants (R6 WP-01), which matches production
-- (audit/evidence/wp01-acl-parity-*.txt).
-- ============================================================================
create temp table known_storage_tenant_only (polname text primary key) on commit drop;
insert into known_storage_tenant_only values
  ('tenant read assignment attachments'),
  ('tenant read avatars'),
  ('tenant read documents'),
  ('tenant read report cards');
