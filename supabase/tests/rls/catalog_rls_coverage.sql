-- ============================================================================
-- R6 catalog guard: every public table has RLS enabled AND forced (hard since
-- WP-02). FORCE matters for any table owner without BYPASSRLS; the owner in
-- production, postgres, has BYPASSRLS, so migrations and cron are unaffected.
-- ============================================================================
begin;
select plan(2);

create temp view app_table as
  select c.relname::text as relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e');

select is(array(select relname from app_table where not relrowsecurity order by 1), '{}'::text[],
  'every table in public has row level security enabled');
select is(array(select relname from app_table where not relforcerowsecurity order by 1), '{}'::text[],
  'every table in public has FORCE ROW LEVEL SECURITY');

select * from finish();
rollback;
