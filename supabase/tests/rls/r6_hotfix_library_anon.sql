-- ============================================================================
-- R6 WP-00 addendum (20260924000002_r6_hotfix_library_anon.sql): the four
-- library circulation RPCs are executable by service_role only.
--
-- The harness shim does not reproduce Supabase's default grants (L-08, fixed
-- in WP-01), so the suite first grants EXECUTE to anon/authenticated exactly as
-- production had it, then re-applies the migration, proving the revoke happens
-- rather than passing vacuously.
-- ============================================================================
begin;
select plan(12);

grant execute on function public.library_checkout(uuid, uuid, uuid, public.library_checkout_type, date) to anon, authenticated;
grant execute on function public.library_return(uuid, uuid) to anon, authenticated;
grant execute on function public.library_renew(uuid, uuid) to anon, authenticated;
grant execute on function public.library_bulk_return(uuid, uuid) to anon, authenticated;

\ir ../../migrations/20260924000002_r6_hotfix_library_anon.sql

select ok(not has_function_privilege('anon', 'public.library_checkout(uuid, uuid, uuid, public.library_checkout_type, date)', 'execute'), 'anon cannot execute library_checkout');
select ok(not has_function_privilege('anon', 'public.library_return(uuid, uuid)', 'execute'), 'anon cannot execute library_return');
select ok(not has_function_privilege('anon', 'public.library_renew(uuid, uuid)', 'execute'), 'anon cannot execute library_renew');
select ok(not has_function_privilege('anon', 'public.library_bulk_return(uuid, uuid)', 'execute'), 'anon cannot execute library_bulk_return');

select ok(not has_function_privilege('authenticated', 'public.library_checkout(uuid, uuid, uuid, public.library_checkout_type, date)', 'execute'), 'authenticated cannot execute library_checkout');
select ok(not has_function_privilege('authenticated', 'public.library_return(uuid, uuid)', 'execute'), 'authenticated cannot execute library_return');
select ok(not has_function_privilege('authenticated', 'public.library_renew(uuid, uuid)', 'execute'), 'authenticated cannot execute library_renew');
select ok(not has_function_privilege('authenticated', 'public.library_bulk_return(uuid, uuid)', 'execute'), 'authenticated cannot execute library_bulk_return');

select ok(has_function_privilege('service_role', 'public.library_checkout(uuid, uuid, uuid, public.library_checkout_type, date)', 'execute'), 'service_role keeps library_checkout (process-library-circulation)');
select ok(has_function_privilege('service_role', 'public.library_return(uuid, uuid)', 'execute'), 'service_role keeps library_return');
select ok(has_function_privilege('service_role', 'public.library_renew(uuid, uuid)', 'execute'), 'service_role keeps library_renew');
select ok(has_function_privilege('service_role', 'public.library_bulk_return(uuid, uuid)', 'execute'), 'service_role keeps library_bulk_return');

select * from finish();
rollback;
