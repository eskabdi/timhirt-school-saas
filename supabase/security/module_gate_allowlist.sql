-- ============================================================================
-- Tenant tables that are deliberately NOT module-gated (always-on core data).
-- Each row needs a reason. Empty until WP-06 classifies module_gate_known.sql.
-- Loaded by supabase/tests/rls/catalog_module_gate.sql.
-- ============================================================================
create temp table module_gate_allowlist (relname text primary key, reason text not null) on commit drop;
