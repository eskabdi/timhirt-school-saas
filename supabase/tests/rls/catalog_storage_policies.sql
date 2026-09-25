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
select plan(16);
\ir ../../security/storage_tenant_only_known.sql
\ir ../../security/storage_policy_allowlist.sql

-- A role term narrows access: an equality against a role literal or list, a
-- permission helper, a relationship helper, or an ownership comparison on a
-- user_id/owner column. A bare EXISTS, `auth.uid() = auth.uid()`,
-- `get_role_for_user(…) <> 'x'` or a string literal does not count (review
-- TI-R2-2). String literals are blanked first so 'has_permission(' in a
-- literal cannot pass. Cross-tenant exposure is proven behaviourally by
-- catalog_storage_probe.sql; this classifier is about least privilege.
create function pg_temp.storage_has_role_term(e text) returns boolean language sql immutable as $fn$
  select regexp_replace(e, $q$'[^']*'$q$, $q$''$q$, 'g')
         ~ $re$(AS get_role_for_user\) = |\mhas_permission\(|\mhas_resource_permission\(|\mis_teacher_of_class\(|\mis_guardian_of\(|\m(user_id|owner|owner_id)\s*=\s*auth\.uid\(\)|auth\.uid\(\)\s*=\s*[a-z_]+\.(user_id|owner|owner_id)\M)$re$
$fn$;
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
create function pg_temp.storage_policy_fingerprint(p pg_policy) returns text language sql stable as $fn$
  select md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
             || '|' || p.polcmd::text || '|'
             || array_to_string(array(select case when r = 0 then 'public' else r::regrole::text end from unnest(p.polroles) r order by 1), ','))
$fn$;
select is(array(select a.polname || ' is now ' || pg_temp.storage_policy_fingerprint(p)
                from storage_policy_allowlist a
                join pg_policy p on p.polname = a.polname and p.polrelid = 'storage.objects'::regclass
                where a.fingerprint <> pg_temp.storage_policy_fingerprint(p) order by 1), '{}'::text[],
  'every allow-listed storage policy is unchanged since it was reviewed (fingerprint)');

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

-- Review TI-R2-2: terms that look like role checks but narrow nothing.
create policy "zz bare exists" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
         and exists (select 1 from public.users p where p.id = auth.uid()));
create policy "zz uid tautology" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
         and auth.uid() = auth.uid());
create policy "zz role not equal" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
         and (select public.get_role_for_user(auth.uid())) <> 'nobody' and name <> 'has_permission(');
select ok('zz bare exists' in (select polname from storage_no_role), 'detector: a bare EXISTS on users is not a role term');
select ok('zz uid tautology' in (select polname from storage_no_role), 'detector: auth.uid() = auth.uid() is not a role term');
select ok('zz role not equal' in (select polname from storage_no_role),
  'detector: get_role_for_user(…) <> literal, and a helper name inside a string literal, are not role terms');

-- Review TI-R2-4: widening an allow-listed policy breaks its fingerprint.
alter policy "public read branding" on storage.objects using (bucket_id in ('branding', 'documents'));
select ok(exists (select 1 from storage_policy_allowlist a join pg_policy p on p.polname = a.polname and p.polrelid = 'storage.objects'::regclass
                  where a.fingerprint <> pg_temp.storage_policy_fingerprint(p)),
  'detector: editing an allow-listed policy changes its fingerprint');

select * from finish();
rollback;
