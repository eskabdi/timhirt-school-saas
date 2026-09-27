-- ============================================================================
-- R6 WP-01 catalog guard: every tenant table (has tenant_id) carries a
-- restrictive *_module_gate policy, or is listed in module_gate_allowlist.sql
-- with a reason. A gate counts only if it covers every command (polcmd '*')
-- and its USING calls has_module( (review TI-2: a name-only match accepted a
-- `restrictive for insert … with check (true)` policy). Hard: no new ungated
-- table; baseline only shrinks; the detector is proven on planted tables.
-- TODO WP-06: every tenant table gated or allow-listed.
-- ============================================================================
begin;
select plan(9);
\ir ../../security/module_gate_known.sql
\ir ../../security/module_gate_allowlist.sql

-- A gate must be one of the exact shapes the gating migrations generate
-- (review TI-R2-3: "has_module( appears somewhere" accepted `… or true`,
-- `not has_module(…) is null` and a gate that applies only to service_role):
--   has_module(tenant_id, '<module>')
--   (super_admin) OR has_module(tenant_id, '<module>')
--   (super_admin) OR EXISTS (SELECT 1 FROM <parent> <a> WHERE <a>.id = <fk> AND has_module(<a>.tenant_id, '<module>'))
create function pg_temp.is_module_gate_expr(e text) returns boolean language sql immutable as $fn$
  select e ~ $re$^(has_module\(tenant_id, '[a-z_]+'::text\)|\(\(\( SELECT get_role_for_user\(auth\.uid\(\)\) AS get_role_for_user\) = 'super_admin'::text\) OR (has_module\(tenant_id, '[a-z_]+'::text\)|\(EXISTS \( SELECT 1\s+FROM [a-z_]+ ([a-z_]+)\s+WHERE \(\(\3\.id = [a-z_]+\.[a-z_]+\) AND has_module\(\3\.tenant_id, '[a-z_]+'::text\)\)\)\))\))$$re$
$fn$;

create temp view ungated as
  select c.relname::text as relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and not exists (select 1 from pg_policy p
                    where p.polrelid = c.oid and not p.polpermissive and p.polname like '%module_gate%'
                      and p.polcmd = '*'
                      and (p.polroles = '{0}' or (select oid from pg_roles where rolname = 'authenticated') = any(p.polroles))
                      and pg_temp.is_module_gate_expr(pg_get_expr(p.polqual, p.polrelid)))
    and c.relname not in (select relname from module_gate_allowlist);

select is(array(select relname from ungated except select relname from known_no_module_gate order by 1), '{}'::text[],
  'no tenant table outside the WP-06 baseline lacks a restrictive module-gate policy');
select is(array(select relname from known_no_module_gate except select relname from ungated order by 1), '{}'::text[],
  'every baselined table is still ungated: remove gated or allow-listed ones from module_gate_known.sql');
select is(array(select relname from module_gate_allowlist where coalesce(btrim(reason), '') = '' order by 1), '{}'::text[],
  'every module-gate allow-list entry states a reason');

select todo('WP-06: add a restrictive module gate (or an allow-list reason) to every tenant table', 1);
select is((select count(*)::int from ungated), 0, 'every tenant table is module-gated or allow-listed');

-- Detector self-test: a fake gate (insert-only, no has_module) is not a gate;
-- a real one is.
create table public.zz_fake_gate (id int, tenant_id uuid);
create policy zz_fake_gate_module_gate on public.zz_fake_gate as restrictive for insert to authenticated with check (true);
create table public.zz_real_gate (id int, tenant_id uuid);
create policy zz_real_gate_module_gate on public.zz_real_gate as restrictive to authenticated
  using (public.has_module(tenant_id, 'library'));
select ok('zz_fake_gate' in (select relname from ungated), 'detector: an insert-only gate without has_module() does not count');
select ok(not ('zz_real_gate' in (select relname from ungated)), 'detector: a restrictive all-command has_module() gate counts');

-- Review TI-R2-3 planted bypasses: each must still count as ungated.
create table public.zz_gate_sr (id int, tenant_id uuid);
create policy zz_gate_sr_module_gate on public.zz_gate_sr as restrictive to service_role using (public.has_module(tenant_id, 'library'));
create table public.zz_gate_or (id int, tenant_id uuid);
create policy zz_gate_or_module_gate on public.zz_gate_or as restrictive to authenticated using (public.has_module(tenant_id, 'library') or true);
create table public.zz_gate_null (id int, tenant_id uuid);
create policy zz_gate_null_module_gate on public.zz_gate_null as restrictive to authenticated using (not public.has_module(tenant_id, 'library') is null);
select ok('zz_gate_sr' in (select relname from ungated), 'detector: a gate that only applies to service_role does not count');
select ok('zz_gate_or' in (select relname from ungated), 'detector: has_module(…) OR true does not count');
select ok('zz_gate_null' in (select relname from ungated), 'detector: NOT has_module(…) IS NULL does not count');

select * from finish();
rollback;
