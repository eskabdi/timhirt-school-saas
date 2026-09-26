-- ============================================================================
-- R6 catalog guard: SECURITY DEFINER functions (H-01, L-07). Hard since WP-02:
--   * EXECUTE for every grantee other than the owner and service_role
--     (PUBLIC included) matches supabase/security/definer_allowlist.sql
--     exactly, in both directions (review TV-12);
--   * anon can execute no definer function at all;
--   * every definer function pins search_path to exactly public, pg_temp
--     (review TV-10);
--   * no definer function exists outside public (review AZ-2);
--   * postgres's default privileges keep new functions closed: no EXECUTE to
--     PUBLIC globally, none to anon/authenticated/PUBLIC in public (review
--     SEC-1);
--   * nothing a policy, view, default or constraint calls is closed to the
--     role that evaluates it (review SEC-R2-3).
-- Needs the Supabase-faithful grants in shim.sql, otherwise anon cannot reach
-- the schema and every "anon cannot execute" check passes vacuously (L-08).
-- ============================================================================
begin;
select plan(8);
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
-- Read the ACL itself (NULL means the built-in default, EXECUTE to PUBLIC), so
-- a grant to any role, or to PUBLIC, is seen.
create temp view definer_grant as
  select replace(regexp_replace(f.sig, '^public\.', ''), ', ', ',') as sig,
         case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee
  from definer_fn f
  join pg_proc p on p.oid = f.oid
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where a.privilege_type = 'EXECUTE'
    and a.grantee <> p.proowner
    and (a.grantee = 0 or a.grantee::regrole::text <> 'service_role');

select is(array(select sig || ' -> ' || grantee from definer_grant
                except select sig || ' -> ' || grantee from definer_allowlist order by 1), '{}'::text[],
  'no SECURITY DEFINER function is executable by anon/authenticated/view owner unless allow-listed');
select is(array(select sig || ' -> ' || grantee from definer_allowlist
                except select sig || ' -> ' || grantee from definer_grant order by 1), '{}'::text[],
  'every allow-list entry is a real grant (remove stale entries)');
select is(array(select replace(regexp_replace(sig, '^public\.', ''), ', ', ',') from definer_fn
                where has_function_privilege('anon', oid, 'execute') order by 1),
  '{}'::text[], 'anon can execute no SECURITY DEFINER function');
select is(array(select sig from definer_fn
                where not exists (select 1 from unnest(coalesce(proconfig, '{}')) c
                                  where c ~ '^search_path=(""|public, pg_temp)$') order by 1), '{}'::text[],
  'every SECURITY DEFINER function pins search_path to exactly public, pg_temp');
select is(array(select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where p.prosecdef and n.nspname not in ('public', 'pg_catalog', 'information_schema')
                  and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
                order by 1), '{}'::text[],
  'no SECURITY DEFINER function outside public (extensions aside)');
select is(array(select reason from definer_allowlist where coalesce(btrim(reason), '') = ''), '{}'::text[],
  'every allow-list entry states a reason');
select is(array(
    select 'global default grants PUBLIC' where not exists (
      select 1 from pg_default_acl d
      where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f'
        and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
    union all
    select 'public default grants ' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
    from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
      and d.defaclobjtype = 'f' and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))
    order by 1), '{}'::text[],
  'new functions postgres creates in public start closed to PUBLIC, anon and authenticated');

-- Every function a policy, view, column default or CHECK calls is executable
-- by the role that evaluates it (review SEC-R2-3): new functions start
-- closed, and app-rpc-grants.py only sees the app's .rpc() calls. Policies
-- are checked for authenticated (anon on the 9 PUBLIC-scoped admin tables is
-- the known WP-06 backlog row, so anon is not checked here).
select is((with deps as (
  select 'policy ' || c.relname || '.' || p.polname as what, f.oid as fn,
         case when p.polroles @> array[0::oid] or p.polroles @> array['authenticated'::regrole::oid] then 'authenticated' end as needs
  from pg_depend d join pg_policy p on p.oid = d.objid join pg_class c on c.oid = p.polrelid
  join pg_proc f on f.oid = d.refobjid
  where d.classid = 'pg_policy'::regclass and d.refclassid = 'pg_proc'::regclass and f.pronamespace = 'public'::regnamespace
  union all
  select 'view ' || v.relname, f.oid,
         case when coalesce(v.reloptions::text, '') like '%security_invoker=true%' then 'authenticated' else v.relowner::regrole::text end
  from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class
  join pg_proc f on f.oid = d.refobjid
  where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_proc'::regclass and f.pronamespace = 'public'::regnamespace
    and v.relnamespace = 'public'::regnamespace
  union all
  select 'default ' || c.relname || '.' || a.attname, f.oid, 'authenticated'
  from pg_depend d join pg_attrdef ad on ad.oid = d.objid join pg_class c on c.oid = ad.adrelid
  join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
  join pg_proc f on f.oid = d.refobjid
  where d.classid = 'pg_attrdef'::regclass and d.refclassid = 'pg_proc'::regclass and f.pronamespace = 'public'::regnamespace
  union all
  select 'constraint ' || con.conname, f.oid, 'authenticated'
  from pg_depend d join pg_constraint con on con.oid = d.objid join pg_proc f on f.oid = d.refobjid
  where d.classid = 'pg_constraint'::regclass and d.refclassid = 'pg_proc'::regclass and f.pronamespace = 'public'::regnamespace
)
select array(select distinct what || ' -> ' || fn::regprocedure::text || ' (' || needs || ')'
             from deps where needs is not null and needs <> 'postgres' and not has_function_privilege(needs, fn, 'execute')
             order by 1)), '{}'::text[],
  'every function a policy, view, default or constraint calls is executable by the role that evaluates it');

select * from finish();
rollback;
