-- ============================================================================
-- R6 WP-00 containment addendum: library circulation RPCs callable by anon.
--
-- 20260813000002_library_rebuild.sql revoked these four SECURITY DEFINER
-- functions from `public, authenticated` and granted them to service_role, but
-- Supabase's default privileges (ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN
-- SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role)
-- had already given `anon` an explicit EXECUTE, which `revoke … from public`
-- does not remove. Verified on production 2026-09-24 (read-only):
--   library_checkout / library_return / library_renew / library_bulk_return
--   proacl = {postgres=X,anon=X,service_role=X}
-- Each takes a caller-supplied p_tenant_id and writes library_checkouts,
-- library_book_copies, library_holds and fines, so an anonymous caller holding
-- the public anon key and a few UUIDs could write into any tenant.
--
-- The only caller is the process-library-circulation Edge Function, which uses
-- the service-role client, so revoking anon changes no legitimate path.
-- The general fix (every definer function, default privileges) is WP-02; this
-- closes the four write paths found by the WP-01 recon now.
-- Re-runnable: revoke is idempotent.
-- ============================================================================

revoke execute on function public.library_checkout(uuid, uuid, uuid, public.library_checkout_type, date)
  from public, anon, authenticated;
revoke execute on function public.library_return(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.library_renew(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.library_bulk_return(uuid, uuid) from public, anon, authenticated;

grant execute on function public.library_checkout(uuid, uuid, uuid, public.library_checkout_type, date) to service_role;
grant execute on function public.library_return(uuid, uuid) to service_role;
grant execute on function public.library_renew(uuid, uuid) to service_role;
grant execute on function public.library_bulk_return(uuid, uuid) to service_role;
