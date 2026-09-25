-- ============================================================================
-- storage.objects policies exempt from the role/tenant classifier, each with a
-- reason and a fingerprint of the reviewed policy.
-- Loaded by supabase/tests/rls/catalog_storage_policies.sql.
--
-- `fingerprint` is md5(USING | WITH CHECK | command | sorted roles). Editing an
-- allow-listed policy (for example widening 'public read branding' to another
-- bucket) changes it and fails the suite until someone re-reviews it (review
-- TI-R2-4); the failing assertion prints the new value.
-- ============================================================================
create temp table storage_policy_allowlist (polname text primary key, reason text not null, fingerprint text not null) on commit drop;
insert into storage_policy_allowlist values
  ('public read branding', 'Public school logos/letterheads on the public admission form and verify pages; bucket is public by design (only bucket with public = true).',
   '0b2a8a760ed421a76dd14a19f01becb7');
