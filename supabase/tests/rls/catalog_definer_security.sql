-- ============================================================================
-- R6 catalog guard: SECURITY DEFINER functions (H-01, L-07). Hard since WP-02:
--   * EXECUTE for anon, authenticated and timhirt_view_owner matches
--     supabase/security/definer_allowlist.sql exactly (a new definer function,
--     which Supabase's default privileges make authenticated-executable, fails
--     until it is reviewed and listed);
--   * every definer function pins search_path, with pg_temp last (review AZ-1);
--   * no definer function exists outside public (review AZ-2).
-- Needs the Supabase-faithful grants in shim.sql, otherwise anon cannot reach
-- the schema and every "anon cannot execute" check passes vacuously (L-08).
-- ============================================================================
begin;
select plan(6);
\ir ../../security/definer_allowlist.sql

create temp view definer_fn as
  select p.oid, regexp_replace(p.oid::regprocedure::text, '^public\.|, ', '', 'g') as sig_raw,
         p.oid::regprocedure::text as sig, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
-- regprocedure prints "public.f(uuid, text)" only when public is not on the
-- search_path; normalise to "f(uuid,text)" to compare with the allow-list.
create temp view definer_grant as
  select replace(regexp_replace(f.sig, '^public\.', ''), ', ', ',') as sig, r.rolname::text as grantee
  from definer_fn f cross join (values ('anon'), ('authenticated'), ('timhirt_view_owner')) r(rolname)
  where exists (select 1 from pg_roles x where x.rolname = r.rolname)
    and has_function_privilege(r.rolname, f.oid, 'execute');

select is(array(select sig || ' -> ' || grantee from definer_grant
                except select sig || ' -> ' || grantee from definer_allowlist order by 1), '{}'::text[],
  'no SECURITY DEFINER function is executable by anon/authenticated/view owner unless allow-listed');
select is(array(select sig || ' -> ' || grantee from definer_allowlist
                except select sig || ' -> ' || grantee from definer_grant order by 1), '{}'::text[],
  'every allow-list entry is a real grant (remove stale entries)');
select is(array(select replace(regexp_replace(sig, '^public\.', ''), ', ', ',') from definer_fn
                where has_function_privilege('anon', oid, 'execute') order by 1),
  array['get_security_settings()'], 'anon can execute exactly one SECURITY DEFINER function (the password policy)');
select is(array(select sig from definer_fn
                where not exists (select 1 from unnest(coalesce(proconfig, '{}')) c
                                  where c ~ '^search_path=(""|.*\mpg_temp)$') order by 1), '{}'::text[],
  'every SECURITY DEFINER function pins search_path with pg_temp last');
select is(array(select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where p.prosecdef and n.nspname not in ('public', 'pg_catalog', 'information_schema')
                  and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
                order by 1), '{}'::text[],
  'no SECURITY DEFINER function outside public (extensions aside)');
select is(array(select reason from definer_allowlist where coalesce(btrim(reason), '') = ''), '{}'::text[],
  'every allow-list entry states a reason');

select * from finish();
rollback;
