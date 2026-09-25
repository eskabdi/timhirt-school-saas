-- ============================================================================
-- R6 (owner decision 2026-09-25, pulled forward from WP-14 / M-11 / L-09):
-- remove the per-tenant "Use Ge'ez numerals" option and replace it with
--   settings.calendar.numerals           'latn' (0-9, default) | 'arab' (٠-٩)
--   settings.calendar.show_hijri         Hijri date shown beside EC dates
--   settings.calendar.secondary_visible  Gregorian date shown beside EC dates
-- jsonb keys are snake_case (fix plan §0 Rule 8); the camelCase keys the old
-- clients write (secondaryVisible, geezNumerals) are mapped, never rejected.
-- Ge'ez numerals are banned (Rule 8), so geezNumerals is dropped whatever its
-- value, and a tenant never falls back to Ge'ez.
--
-- Design (reviews DM-1/2, SEC-WP01-1/2, M-1): one immutable normaliser used by
-- both the backfill and a BEFORE INSERT/UPDATE trigger. Every write, including
-- the production frontend and onboard-tenant still live at da6055e, is
-- normalised instead of failing, so deploy order does not matter. Any stored
-- shape is handled: calendar absent (left absent), not an object (reset to
-- defaults), unknown/invalid values (defaulted), extra keys (kept).
--
-- Pre-apply production count (audit/evidence/wp01-prod-calendar-and-schema-
-- grants-*.txt): 3 rows, all objects {secondaryVisible, geezNumerals=false}.
-- Expected after: 3 rows {secondary_visible, numerals:'latn', show_hijri:false},
-- 0 rows with any camelCase key. Idempotent: a second run updates 0 rows.
-- Forward-fix: drop trigger tenant_configs_normalize_calendar and function
-- normalize_calendar_settings; the data stays valid for both old and new
-- readers. Restoring Ge'ez numerals is intentionally not supported.
-- ============================================================================

create or replace function public.normalize_calendar_settings(p_settings jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_settings is null or jsonb_typeof(p_settings) <> 'object' or not (p_settings ? 'calendar')
      then p_settings
    else jsonb_set(p_settings, '{calendar}', (
      with c as (
        select case when jsonb_typeof(p_settings->'calendar') = 'object'
                    then p_settings->'calendar' else '{}'::jsonb end as cal
      )
      select (c.cal - 'geezNumerals' - 'secondaryVisible' - 'showHijri'
                    - 'numerals' - 'show_hijri' - 'secondary_visible')
             || jsonb_build_object(
                  'secondary_visible',
                    case when jsonb_typeof(c.cal->'secondary_visible') = 'boolean' then c.cal->'secondary_visible'
                         when jsonb_typeof(c.cal->'secondaryVisible') = 'boolean' then c.cal->'secondaryVisible'
                         else 'true'::jsonb end,
                  'numerals',
                    case when c.cal->>'numerals' in ('latn', 'arab') and jsonb_typeof(c.cal->'numerals') = 'string'
                         then c.cal->'numerals' else '"latn"'::jsonb end,
                  'show_hijri',
                    case when jsonb_typeof(c.cal->'show_hijri') = 'boolean' then c.cal->'show_hijri'
                         when jsonb_typeof(c.cal->'showHijri') = 'boolean' then c.cal->'showHijri'
                         else 'false'::jsonb end)
      from c))
  end
$$;

comment on function public.normalize_calendar_settings(jsonb) is
  'R6: canonical tenant_configs.settings.calendar (snake_case keys, numerals latn|arab, no Ge''ez). Used by the backfill and trigger in 20260925000002.';

-- Pure function over its argument; no table access, nothing to protect.
revoke execute on function public.normalize_calendar_settings(jsonb) from public, anon;

update public.tenant_configs
set settings = public.normalize_calendar_settings(settings)
where settings is distinct from public.normalize_calendar_settings(settings);

create or replace function public.tenant_configs_normalize_calendar()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.settings := public.normalize_calendar_settings(new.settings);
  return new;
end
$$;
revoke execute on function public.tenant_configs_normalize_calendar() from public, anon, authenticated;

drop trigger if exists tenant_configs_normalize_calendar on public.tenant_configs;
create trigger tenant_configs_normalize_calendar
  before insert or update of settings on public.tenant_configs
  for each row execute function public.tenant_configs_normalize_calendar();
