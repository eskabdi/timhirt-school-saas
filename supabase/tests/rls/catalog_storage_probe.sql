-- ============================================================================
-- R6 WP-01 (review TI-R2-1): behavioural cross-tenant storage probe.
--
-- catalog_storage_policies.sql classifies policy text; text can lie (an
-- AND/OR precedence slip passes any "does the predicate mention the tenant
-- folder" check). This suite does not read policies at all. It seeds one
-- tenant-B object in every non-public bucket, then, as a tenant-A user of
-- every role (and as anon), tries to read, update, delete and insert tenant-B
-- objects. Any success is a cross-tenant path, whatever the policy says.
-- Each write attempt runs in a rolled-back sub-transaction, so roles cannot
-- disturb each other. The probe is proven on planted policies at the end.
-- ============================================================================
begin;
select plan(10);

insert into public.tenants (id, name, slug) values
  ('0000000a-0000-0000-0000-00000000aaaa', 'Probe Tenant A', 'probe-a'),
  ('0000000b-0000-0000-0000-00000000bbbb', 'Probe Tenant B', 'probe-b');

-- One tenant-A user per role (super_admin included: storage never exempts it).
insert into public.users (id, tenant_id, role, full_name, email)
select gen_random_uuid(), '0000000a-0000-0000-0000-00000000aaaa', r, 'Probe ' || r::text, 'probe-' || r::text || '@example.test'
from unnest(enum_range(null::public.user_role)) r;

-- One tenant-B object in every non-public bucket (inserted as the table owner,
-- so RLS does not apply to the seed).
insert into storage.objects (bucket_id, name)
select b.id, '0000000b-0000-0000-0000-00000000bbbb/' || b.id || '/secret.pdf'
from storage.buckets b where not coalesce(b.public, false);

create function pg_temp.storage_cross_tenant_probe() returns text[] language plpgsql as $$
declare
  b_folder constant text := '0000000b-0000-0000-0000-00000000bbbb';
  v text[] := '{}';
  who record;
  bkt record;
  hit text;
  n bigint;
begin
  for who in
    select u.id, u.role::text as label from public.users u where u.tenant_id = '0000000a-0000-0000-0000-00000000aaaa'
    union all select null::uuid, 'anon'
    order by 2
  loop
    if who.id is null then
      execute 'set local role anon';
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    else
      execute 'set local role authenticated';
      perform set_config('request.jwt.claim.sub', who.id::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub', who.id, 'role', 'authenticated')::text, true);
    end if;

    select string_agg(distinct bucket_id, ',' order by bucket_id) into hit
      from storage.objects where (storage.foldername(name))[1] = b_folder;
    if hit is not null then v := v || format('%s reads tenant B in %s', who.label, hit); end if;

    -- No WHERE and no RETURNING: then only the UPDATE/DELETE policy applies,
    -- not the SELECT one, which is exactly how an attacker would write it.
    -- Only tenant-B objects exist in this transaction, so any row touched is
    -- a cross-tenant write.
    n := 0;
    begin
      update storage.objects set metadata = '{"probe": true}'::jsonb;
      get diagnostics n = row_count;
      raise exception using errcode = 'P0R01';
    exception when sqlstate 'P0R01' then null;
    end;
    if n > 0 then v := v || format('%s updates tenant B objects', who.label); end if;

    n := 0;
    begin
      delete from storage.objects;
      get diagnostics n = row_count;
      raise exception using errcode = 'P0R01';
    exception when sqlstate 'P0R01' then null;
    end;
    if n > 0 then v := v || format('%s deletes tenant B objects', who.label); end if;

    for bkt in select id from storage.buckets order by id loop
      begin
        insert into storage.objects (bucket_id, name, owner)
        values (bkt.id, b_folder || '/probe/' || who.label || '.pdf', who.id);
        v := v || format('%s writes into tenant B in %s', who.label, bkt.id);
        raise exception using errcode = 'P0R01';
      exception
        when sqlstate 'P0R01' then null;
        when insufficient_privilege or check_violation or foreign_key_violation then null;
      end;
    end loop;

    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

select is((select count(*)::int from storage.objects where name like '0000000b-%'),
  (select count(*)::int from storage.buckets where not coalesce(public, false)),
  'the probe has a tenant-B object in every non-public bucket (it is not vacuous)');
select is((select count(*)::int from storage.objects where name not like '0000000b-%'), 0,
  'tenant-B objects are the only objects, so any row an update/delete touches is cross-tenant');
select is((select count(*)::int from public.users where tenant_id = '0000000a-0000-0000-0000-00000000aaaa'),
  (select cardinality(enum_range(null::public.user_role))), 'the probe acts as every role');

select is(pg_temp.storage_cross_tenant_probe(), '{}'::text[],
  'no role in tenant A (nor anon) can read, update, delete or write tenant-B storage objects');

-- Probe self-test (review TI-R2-1): shapes that fooled the text classifier.
create policy "zz or precedence" on storage.objects for select to authenticated
  using (bucket_id = 'documents' or (bucket_id = 'avatars'
         and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
         and (select public.get_role_for_user(auth.uid())) = 'school_admin'));
select ok('student reads tenant B in documents' = any(pg_temp.storage_cross_tenant_probe()),
  'probe: an AND/OR precedence slip is caught as a cross-tenant read');
drop policy "zz or precedence" on storage.objects;

create policy "zz tenant or role" on storage.objects for select to authenticated
  using (bucket_id = 'report-cards' and ((storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
         or (select public.get_role_for_user(auth.uid())) is not null));
select ok('teacher reads tenant B in report-cards' = any(pg_temp.storage_cross_tenant_probe()),
  'probe: a tenant term inside an OR branch is caught');
drop policy "zz tenant or role" on storage.objects;

create policy "zz write anywhere" on storage.objects for insert to authenticated with check (bucket_id = 'evidence');
select ok('parent writes into tenant B in evidence' = any(pg_temp.storage_cross_tenant_probe()),
  'probe: a cross-tenant insert is caught');
drop policy "zz write anywhere" on storage.objects;

create policy "zz update anywhere" on storage.objects for update to authenticated using (bucket_id = 'payslips');
select ok('accountant updates tenant B objects' = any(pg_temp.storage_cross_tenant_probe()),
  'probe: a cross-tenant update is caught');
drop policy "zz update anywhere" on storage.objects;

create policy "zz delete anywhere" on storage.objects for delete to authenticated using (bucket_id = 'id-cards');
select ok('registrar deletes tenant B objects' = any(pg_temp.storage_cross_tenant_probe()),
  'probe: a cross-tenant delete is caught');
drop policy "zz delete anywhere" on storage.objects;

select is(pg_temp.storage_cross_tenant_probe(), '{}'::text[], 'after dropping the planted policies the probe is clean again');

select * from finish();
rollback;
