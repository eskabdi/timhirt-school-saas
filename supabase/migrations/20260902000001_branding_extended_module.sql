-- ============================================================================
-- R5-B1: `branding_extended` as a Standard-tier-and-above module, plus the
-- `enterprise` tier row it (and R5-C1's document_templates) needs.
--
-- Read from production before writing this: subscription_tiers held exactly
-- basic/standard/premium -- `standard` already existed and did NOT need
-- creating, `enterprise` genuinely did. sort_order 4 continues the existing
-- 1/2/3 sequence, and display_name follows the same Capitalized convention.
--
-- Module registration extends the existing catalog (modules + tier_modules,
-- 20260715000016) rather than introducing a parallel tier-ranking system:
-- presence of a (tier_key, module_key) row means included, exactly as every
-- other module works, so has_module()'s override-then-tier-then-false
-- resolution picks these up with no change to that function at all.
--
-- Enterprise gets the full module set (every module premium has, plus the
-- two new ones), matching premium's own "gets everything" seeding.
--
-- What this deliberately does NOT touch: the branding that already renders
-- on ID cards and transcripts today. Verified against production before
-- writing -- `gradebook` IS in Basic, so a Basic tenant generates branded
-- transcripts right now, and that must not regress. `branding_extended`
-- gates only the three documents that carry NO branding today (invoice,
-- receipt, payslip); it is never consulted for ID cards or transcripts.
-- ============================================================================

insert into public.subscription_tiers (key, display_name, sort_order) values
  ('enterprise', 'Enterprise', 4)
on conflict (key) do nothing;

-- Enterprise inherits premium's full module set (idempotent: re-running adds
-- only what's missing, same discipline as the original seeding).
insert into public.tier_modules (tier_key, module_key)
select 'enterprise', module_key from public.tier_modules where tier_key = 'premium'
on conflict do nothing;

insert into public.modules (key, display_name, sort_order) values
  ('branding_extended', 'Extended Branding', 19)
on conflict (key) do nothing;

-- Standard and above. Basic is deliberately excluded -- below Standard the
-- three gated documents render exactly as they do today, unbranded.
insert into public.tier_modules (tier_key, module_key)
select key, 'branding_extended' from public.subscription_tiers
where key in ('standard', 'premium', 'enterprise')
on conflict do nothing;
