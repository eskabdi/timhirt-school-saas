-- ============================================================================
-- R6 WP-00 addendum (20260924000002_r6_hotfix_library_anon.sql): the four
-- library circulation RPCs are executable by service_role only.
--
-- The suite grants EXECUTE to anon/authenticated exactly as production had it
-- (Supabase default privileges, which the shim mirrors since R6 WP-01), then
-- re-applies the migration, proving the revoke happens rather than passing
-- vacuously. Assertions 14-15 make real anon calls (backlog DM-2).
-- ============================================================================
begin;
select plan(15);

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

-- Real calls as anon (backlog DM-2). Since R6 WP-01 the shim grants anon USAGE
-- on public like Supabase does, so a refusal here is the function's own ACL,
-- not the schema being unreachable.
-- The exact message is asserted: "permission denied for schema public" is
-- also 42501 and would pass a code-only check under the pre-WP-01 shim
-- (review TI-3).
select ok(has_schema_privilege('anon', 'public', 'usage'), 'anon reaches schema public, as on Supabase');
set local role anon;
select throws_ok($c$ select public.library_return(gen_random_uuid(), gen_random_uuid()) $c$, '42501', 'permission denied for function library_return',
  'a real anon call to library_return is refused (permission denied)');
select throws_ok($c$ select public.library_checkout(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'lending', current_date) $c$, '42501', 'permission denied for function library_checkout',
  'a real anon call to library_checkout is refused (permission denied)');
reset role;

select * from finish();
rollback;
