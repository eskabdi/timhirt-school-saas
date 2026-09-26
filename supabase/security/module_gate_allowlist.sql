-- ============================================================================
-- Tenant tables that are deliberately NOT module-gated (always-on core data).
-- Each row needs a reason. Empty until WP-06 classifies module_gate_known.sql.
-- Loaded by supabase/tests/rls/catalog_module_gate.sql.
-- ============================================================================
create temp table module_gate_allowlist (relname text primary key, reason text not null) on commit drop;
insert into module_gate_allowlist values
  ('approval_requests', 'R6 WP-09: cross-module maker-checker queue. Rows only exist for enforced actions, which are created and executed by RPCs that act on the module-gated entity tables; reads are limited to the maker and permitted checkers.');
