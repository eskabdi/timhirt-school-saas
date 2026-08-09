-- SAML SSO, part 1: new enum label only.
--
-- Standalone file because a new enum label cannot be used in the same
-- transaction that adds it (same reason 20260813000001 added 'librarian'
-- this way). The next migration's RLS/table work doesn't reference
-- 'pending' in SQL, but the JIT-provisioning Edge Function (complete-sso-login)
-- inserts rows with this role, so it must exist and be committed first.
alter type public.user_role add value 'pending';
