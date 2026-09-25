-- ============================================================================
-- R6 WP-01 catalog guard: every public table has RLS enabled AND forced.
-- Hard: RLS enabled everywhere (already true); no table outside the baseline
-- lacks FORCE; the baseline only shrinks. TODO WP-02: FORCE on every table.
-- ============================================================================
begin;
select plan(4);
\ir ../../security/rls_force_known.sql

create temp view app_table as
  select c.relname::text as relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e');

select is(array(select relname from app_table where not relrowsecurity order by 1), '{}'::text[],
  'every table in public has row level security enabled');
select is(array(select relname from app_table where not relforcerowsecurity
                except select relname from known_rls_no_force order by 1), '{}'::text[],
  'no table outside the WP-02 baseline lacks FORCE ROW LEVEL SECURITY');
select is(array(select relname from known_rls_no_force
                except select relname from app_table where not relforcerowsecurity order by 1), '{}'::text[],
  'every baselined table still lacks FORCE: remove fixed ones from rls_force_known.sql');

select todo('WP-02: FORCE ROW LEVEL SECURITY on every public table', 1);
select is((select count(*)::int from app_table where not relforcerowsecurity), 0,
  'every table in public has FORCE ROW LEVEL SECURITY');

select * from finish();
rollback;
