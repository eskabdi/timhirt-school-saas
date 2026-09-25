-- ============================================================================
-- R6 WP-01 catalog guard over every storage.objects policy (all commands).
--
-- Two exposure classes, classified by what the predicate CONTAINS rather than
-- by its exact text (review TI-1: an exact-shape match missed the same class
-- written without the `( SELECT … )` wrapper, `auth.role() = 'authenticated'`
-- and `bucket_id in (…)`):
--   * no role term: the USING or WITH CHECK expression names no role or
--     relationship check (get_role_for_user, has_permission,
--     has_resource_permission, is_teacher_of_class, an EXISTS subquery, or an
--     ownership comparison `= auth.uid()`), so every role in the tenant
--     (students, guardians) gets the command on every file in the bucket;
--   * no tenant term: the expression never compares the first path segment to
--     get_tenant_id_for_user(), so the policy spans tenants.
-- Exceptions need a reason in storage_policy_allowlist.sql. Hard: no new
-- offender in either class; the WP-05 baseline only shrinks. The detector is
-- proven on planted policies at the end. TODO WP-05: zero offenders.
-- ============================================================================
begin;
select plan(11);
\ir ../../security/storage_tenant_only_known.sql
\ir ../../security/storage_policy_allowlist.sql

-- The tenant-folder call itself contains auth.uid(); strip it before looking
-- for an ownership comparison so it cannot count as a role term.
create function pg_temp.storage_has_role_term(e text) returns boolean language sql immutable as $$
  select regexp_replace(e, 'get_tenant_id_for_user\(auth\.uid\(\)\)', '', 'g')
         ~* '(get_role_for_user|has_permission|has_resource_permission|is_teacher_of_class|\mEXISTS\M|=\s*auth\.uid\(\)|auth\.uid\(\)\s*=)'
$$;
create function pg_temp.storage_has_tenant_term(e text) returns boolean language sql immutable as $$
  select e ~ 'storage\.foldername\(name\)\)\[1\] = .*get_tenant_id_for_user\(auth\.uid\(\)\)'
$$;

create temp view storage_policy_exprs as
  select p.polname::text as polname, x.e
  from pg_policy p
  cross join lateral (values (pg_get_expr(p.polqual, p.polrelid)), (pg_get_expr(p.polwithcheck, p.polrelid))) x(e)
  where p.polrelid = 'storage.objects'::regclass and x.e is not null;

create temp view storage_no_role as
  select distinct polname from storage_policy_exprs
  where not pg_temp.storage_has_role_term(e)
    and polname not in (select polname from storage_policy_allowlist);

create temp view storage_no_tenant as
  select distinct polname from storage_policy_exprs
  where not pg_temp.storage_has_tenant_term(e)
    and polname not in (select polname from storage_policy_allowlist);

select is(array(select polname from storage_no_role except select polname from known_storage_tenant_only order by 1), '{}'::text[],
  'no storage policy outside the WP-05 baseline lacks a role or relationship check');
select is(array(select polname from known_storage_tenant_only except select polname from storage_no_role order by 1), '{}'::text[],
  'every baselined storage policy still offends: remove fixed ones from storage_tenant_only_known.sql');
select is(array(select polname from storage_no_tenant order by 1), '{}'::text[],
  'every storage policy is scoped to the caller''s tenant folder');
select is(array(select polname from storage_policy_allowlist where coalesce(btrim(reason), '') = '' order by 1), '{}'::text[],
  'every storage policy allow-list entry states a reason');
select is(array(select polname from storage_policy_allowlist except select polname::text from pg_policy where polrelid = 'storage.objects'::regclass order by 1), '{}'::text[],
  'every storage policy allow-list entry names a real policy');

select todo('WP-05: add role/relationship predicates to tenant-only storage policies', 1);
select is((select count(*)::int from storage_no_role), 0, 'no storage policy checks only bucket + tenant folder');

-- Detector self-test (review TI-1): each planted shape must be caught.
create policy "zz tenant only unwrapped" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = public.get_tenant_id_for_user(auth.uid())::text);
create policy "zz any authenticated" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and auth.role() = 'authenticated');
create policy "zz bucket list" on storage.objects for select to authenticated
  using (bucket_id in ('documents', 'avatars'));
create policy "zz write tenant only" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text);
create policy "zz role but cross tenant" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (select public.get_role_for_user(auth.uid())) = 'school_admin');

select is(array(select polname from storage_no_role where polname like 'zz %' order by 1),
  array['zz any authenticated', 'zz bucket list', 'zz tenant only unwrapped', 'zz write tenant only'],
  'detector: every role-less planted policy is flagged, reads and writes alike');
select ok('zz role but cross tenant' in (select polname from storage_no_tenant),
  'detector: a role-checked policy with no tenant folder is flagged as cross-tenant');
select ok('zz any authenticated' in (select polname from storage_no_tenant)
  and 'zz bucket list' in (select polname from storage_no_tenant),
  'detector: bucket-only and auth.role() policies are flagged as cross-tenant');
select ok(not ('zz tenant only unwrapped' in (select polname from storage_no_tenant)),
  'detector: an unwrapped tenant-folder check still counts as tenant-scoped');
select ok(not ('zz role but cross tenant' in (select polname from storage_no_role)),
  'detector: a get_role_for_user check counts as a role term');

select * from finish();
rollback;
