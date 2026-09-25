-- ============================================================================
-- R6 (owner decision 2026-09-25, pulled forward from WP-14 / M-11): remove the
-- per-tenant "Use Ge'ez numerals" option and replace it with
--   settings.calendar.numerals  'latn' (0-9, default) | 'arab' (٠-٩)
--   settings.calendar.showHijri boolean (Hijri date shown beside EC dates)
-- Ge'ez numerals are banned project-wide (fix plan §0 Rule 8), so a tenant
-- that had them on falls back to 'latn', never to Ge'ez.
--
-- Idempotent. tenant_configs.settings is presentation-only jsonb; no other
-- key is touched. The CHECK stops a client (the settings page upserts the
-- whole object) from writing the old key or an unknown digit system back.
-- ============================================================================

update public.tenant_configs
set settings = jsonb_set(
      settings,
      '{calendar}',
      (coalesce(settings->'calendar', '{}'::jsonb) - 'geezNumerals')
        || jsonb_build_object(
             'numerals',  case when settings #>> '{calendar,numerals}' in ('latn', 'arab')
                               then settings #>> '{calendar,numerals}' else 'latn' end,
             'showHijri', coalesce((settings #>> '{calendar,showHijri}')::boolean, false)))
where settings ? 'calendar'
  and (settings->'calendar' ? 'geezNumerals'
       or not (settings->'calendar' ? 'numerals')
       or not (settings->'calendar' ? 'showHijri'));

alter table public.tenant_configs
  drop constraint if exists tenant_configs_calendar_numerals_chk;
alter table public.tenant_configs
  add constraint tenant_configs_calendar_numerals_chk check (
    not coalesce(settings->'calendar' ? 'geezNumerals', false)
    and coalesce(settings #>> '{calendar,numerals}', 'latn') in ('latn', 'arab')
  );
