-- ============================================================================
-- R6 WP-01 catalog guard: SECURITY DEFINER functions in public (H-01, L-07).
-- Ratchet against supabase/security/definer_*_known.sql:
--   * hard: no definer function outside the baseline is anon-executable or
--     lacks a pinned search_path (a new one is a regression, fail now);
--   * hard: every baselined entry still offends (the list only shrinks);
--   * TODO WP-02: zero offenders. When WP-02 lands these pass, the runner fails
--     on the passing TODO, and WP-02 flips them to hard assertions.
-- Needs the Supabase-faithful grants in shim.sql, otherwise anon cannot reach
-- the schema and every "anon cannot execute" check passes vacuously (L-08).
-- ============================================================================
begin;
select plan(6);
\ir ../../security/definer_anon_known.sql
\ir ../../security/definer_search_path_known.sql

create temp view definer_fn as
  select p.oid, p.oid::regprocedure::text as sig, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
create temp view anon_exec as
  select sig from definer_fn where has_function_privilege('anon', oid, 'execute');
create temp view no_search_path as
  select sig from definer_fn
  where not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%');

select is(array(select sig from anon_exec except select sig from known_definer_anon order by 1), '{}'::text[],
  'no SECURITY DEFINER function outside the WP-02 baseline is executable by anon');
select is(array(select sig from known_definer_anon except select sig from anon_exec order by 1), '{}'::text[],
  'every baselined anon-executable definer function still is: remove fixed ones from definer_anon_known.sql');
select is(array(select sig from no_search_path except select sig from known_definer_no_search_path order by 1), '{}'::text[],
  'every SECURITY DEFINER function outside the WP-02 baseline pins search_path');
select is(array(select sig from known_definer_no_search_path except select sig from no_search_path order by 1), '{}'::text[],
  'every baselined definer function still lacks search_path: remove fixed ones from definer_search_path_known.sql');

select todo('WP-02: revoke EXECUTE from anon on every SECURITY DEFINER function', 1);
select is((select count(*)::int from anon_exec), 0, 'no SECURITY DEFINER function in public is executable by anon');
select todo('WP-02: pin search_path on every SECURITY DEFINER function', 1);
select is((select count(*)::int from no_search_path), 0, 'every SECURITY DEFINER function in public pins search_path');

select * from finish();
rollback;
