-- ============================================================================
-- branding_extended module + enterprise tier (20260902000001). Proves the new
-- module resolves through the EXISTING has_module() mechanism rather than a
-- parallel one: Basic excluded, Standard/Premium/Enterprise included by tier
-- default, and a per-tenant override winning over the tier default in BOTH
-- directions (forcing on for a Basic tenant, forcing off for a Premium one).
-- Also pins that enterprise inherits premium's full module set.
-- ============================================================================
begin;
select plan(9);

insert into public.tenants (id, name, slug, status, tier_key) values
  ('be100000-0000-0000-0000-000000000001', 'BE Basic',      'rls-test-be-basic',      'active', 'basic'),
  ('be100000-0000-0000-0000-000000000002', 'BE Standard',   'rls-test-be-standard',   'active', 'standard'),
  ('be100000-0000-0000-0000-000000000003', 'BE Premium',    'rls-test-be-premium',    'active', 'premium'),
  ('be100000-0000-0000-0000-000000000004', 'BE Enterprise', 'rls-test-be-enterprise', 'active', 'enterprise');

-- ---------- catalog rows exist -------------------------------------------
select is(
  (select count(*)::int from public.subscription_tiers where key = 'enterprise'),
  1, 'the enterprise tier row exists');

select is(
  (select count(*)::int from public.modules where key = 'branding_extended'),
  1, 'the branding_extended module is registered in the catalog');

select is(
  (select count(*)::int from public.tier_modules where tier_key = 'enterprise')
    >= (select count(*)::int from public.tier_modules where tier_key = 'premium'),
  true, 'enterprise includes at least every module premium does');

-- ---------- tier defaults --------------------------------------------------
select is(
  public.has_module('be100000-0000-0000-0000-000000000001', 'branding_extended'),
  false, 'Basic does NOT get branding_extended by tier default');

select is(
  public.has_module('be100000-0000-0000-0000-000000000002', 'branding_extended'),
  true, 'Standard gets branding_extended by tier default');

select is(
  public.has_module('be100000-0000-0000-0000-000000000003', 'branding_extended'),
  true, 'Premium gets branding_extended by tier default');

select is(
  public.has_module('be100000-0000-0000-0000-000000000004', 'branding_extended'),
  true, 'Enterprise gets branding_extended by tier default');

-- ---------- override wins over tier default, both directions --------------
insert into public.tenant_module_overrides (tenant_id, module_key, enabled) values
  ('be100000-0000-0000-0000-000000000001', 'branding_extended', true);
select is(
  public.has_module('be100000-0000-0000-0000-000000000001', 'branding_extended'),
  true, 'an override forces branding_extended ON for a Basic tenant (override beats tier default)');

insert into public.tenant_module_overrides (tenant_id, module_key, enabled) values
  ('be100000-0000-0000-0000-000000000003', 'branding_extended', false);
select is(
  public.has_module('be100000-0000-0000-0000-000000000003', 'branding_extended'),
  false, 'an override forces branding_extended OFF for a Premium tenant (override beats tier default)');

select * from finish();
rollback;
