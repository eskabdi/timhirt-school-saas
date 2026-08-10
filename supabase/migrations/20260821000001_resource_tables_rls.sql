-- ============================================================================
-- CRITICAL fix: resource_open_actions / resource_default_role_grants had no
-- RLS at all. Migration 20260817000001_resource_permissions_core_v2.sql
-- created them and 20260715000011_base_table_grants.sql's blanket
-- `grant ... on all tables in schema public to authenticated` (which predates
-- both tables but applies to everything, including tables created later --
-- see that migration's own header, "tables created by the migration-running
-- role do not inherit the platform's default grants," which is exactly why
-- that grant exists and is blanket) left them writable by table-level
-- privilege alone, with nothing narrowing which ROWS an `authenticated` user
-- may touch.
--
-- These two tables are the final fallback branch of
-- has_resource_permission() -- the function every resource-aware RLS policy
-- in the schema calls. A row inserted here (e.g.
-- ('payroll_runs','create','student')) changes authorization platform-wide,
-- for every tenant, immediately. Live-verified before this fix: a plain
-- school_admin token could POST directly to either table and get 201.
--
-- Fix follows the same shape as modules/subscription_tiers
-- (20260715000016_module_permission_matrix.sql): read is open (this is
-- global reference data describing the product's own default permission
-- shape, not tenant data -- nothing sensitive leaks by reading it), write is
-- not available to any authenticated-role policy at all. Unlike
-- modules/subscription_tiers (super_admin-editable via the platform console
-- UI), these two tables have no admin UI and are only ever meant to be
-- seeded by migrations -- so, matching the existing idiom for tables like
-- `webhook_events` and `fee_documents` (see those migrations' "no
-- insert/update/delete policy: service_role only" comments), no write
-- policy is added at all. `service_role` has BYPASSRLS
-- (20260715000011_base_table_grants.sql:18) so it is unaffected either way;
-- every other role now has zero matching policy for insert/update/delete
-- and FORCE RLS means even the table owner doesn't get a silent bypass.
-- ============================================================================

alter table public.resource_open_actions enable row level security;
alter table public.resource_open_actions force row level security;

create policy resource_open_actions_select on public.resource_open_actions
  for select to authenticated using (true);

alter table public.resource_default_role_grants enable row level security;
alter table public.resource_default_role_grants force row level security;

create policy resource_default_role_grants_select on public.resource_default_role_grants
  for select to authenticated using (true);
