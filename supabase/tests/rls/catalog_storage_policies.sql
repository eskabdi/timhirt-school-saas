-- ============================================================================
-- R6 WP-01 catalog guard: no storage.objects SELECT (or ALL) policy may check
-- only the bucket and the tenant folder, which lets every role in a tenant
-- (students, guardians) read every file in that bucket. The deparsed predicate
-- is matched by exact shape (pg_get_expr is deterministic). Exceptions need a
-- reason in storage_policy_allowlist.sql. Hard: no new offender; baseline only
-- shrinks. TODO WP-05: zero offenders.
-- ============================================================================
begin;
select plan(4);
\ir ../../security/storage_tenant_only_known.sql
\ir ../../security/storage_policy_allowlist.sql

create temp view tenant_only_read as
  select polname::text as polname
  from pg_policy
  where polrelid = 'storage.objects'::regclass and polcmd in ('r', '*')
    and (
      pg_get_expr(polqual, polrelid) ~ $re$^\(bucket_id = '[^']+'::text\)$$re$
      or pg_get_expr(polqual, polrelid) ~ $re$^\(\(bucket_id = '[^']+'::text\) AND \(\(storage\.foldername\(name\)\)\[1\] = \(\( SELECT get_tenant_id_for_user\(auth\.uid\(\)\) AS get_tenant_id_for_user\)\)::text\)\)$$re$
    )
    and polname not in (select polname from storage_policy_allowlist);

select is(array(select polname from tenant_only_read except select polname from known_storage_tenant_only order by 1), '{}'::text[],
  'no storage SELECT policy outside the WP-05 baseline checks only bucket + tenant folder');
select is(array(select polname from known_storage_tenant_only except select polname from tenant_only_read order by 1), '{}'::text[],
  'every baselined storage policy still offends: remove fixed ones from storage_tenant_only_known.sql');
select is(array(select polname from storage_policy_allowlist where coalesce(btrim(reason), '') = '' order by 1), '{}'::text[],
  'every storage policy allow-list entry states a reason');

select todo('WP-05: add role/relationship predicates to tenant-only storage read policies', 1);
select is((select count(*)::int from tenant_only_read), 0, 'no storage SELECT policy checks only bucket + tenant folder');

select * from finish();
rollback;
