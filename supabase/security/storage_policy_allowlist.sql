-- ============================================================================
-- storage.objects SELECT/ALL policies allowed to check only the bucket (and
-- optionally the tenant folder), each with a reason.
-- Loaded by supabase/tests/rls/catalog_storage_policies.sql.
-- ============================================================================
create temp table storage_policy_allowlist (polname text primary key, reason text not null) on commit drop;
insert into storage_policy_allowlist values
  ('public read branding', 'Public school logos/letterheads on the public admission form and verify pages; bucket is public by design (only bucket with public = true).');
