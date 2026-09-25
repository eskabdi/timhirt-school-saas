-- ============================================================================
-- 20260925000002_r6_calendar_numerals.sql: the Ge'ez-numerals tenant option is
-- migrated away (to 'latn', never Ge'ez), keys become snake_case, every stored
-- shape is handled, the migration is idempotent, and writes from the old
-- clients still live in production are normalised instead of failing
-- (reviews DM-1/2/4, SEC-WP01-1/2, M-1).
-- ============================================================================
begin;
select plan(15);

drop trigger if exists tenant_configs_normalize_calendar on public.tenant_configs;
insert into public.tenants (id, name, slug) values
  ('00000000-0000-0000-0000-00000000c001', 'Calendar A', 'cal-a'),
  ('00000000-0000-0000-0000-00000000c002', 'Calendar B', 'cal-b'),
  ('00000000-0000-0000-0000-00000000c003', 'Calendar C', 'cal-c'),
  ('00000000-0000-0000-0000-00000000c004', 'Calendar D', 'cal-d'),
  ('00000000-0000-0000-0000-00000000c005', 'Calendar E', 'cal-e'),
  ('00000000-0000-0000-0000-00000000c006', 'Calendar F', 'cal-f'),
  ('00000000-0000-0000-0000-00000000c007', 'Calendar G', 'cal-g');
insert into public.tenant_configs (tenant_id, settings) values
  -- production shape (all 3 live rows)
  ('00000000-0000-0000-0000-00000000c001', '{"calendar": {"secondaryVisible": false, "geezNumerals": true}, "branding": {"x": 1}}'),
  ('00000000-0000-0000-0000-00000000c002', '{"calendar": {"secondary_visible": true, "numerals": "arab", "show_hijri": true}}'),
  ('00000000-0000-0000-0000-00000000c003', '{"branding": {"y": 2}}'),
  ('00000000-0000-0000-0000-00000000c004', '{"calendar": "x"}'),
  ('00000000-0000-0000-0000-00000000c005', '{"calendar": ["geezNumerals"]}'),
  ('00000000-0000-0000-0000-00000000c006', '{"calendar": {"numerals": "geez", "showHijri": "maybe", "extra": 7}}'),
  ('00000000-0000-0000-0000-00000000c007', '{"calendar": null}');

\ir ../../migrations/20260925000002_r6_calendar_numerals.sql

create temp table cal_after_first as select tenant_id, settings from public.tenant_configs where tenant_id::text like '00000000-0000-0000-0000-00000000c00%';
create function pg_temp.cal(p text) returns jsonb language sql as
  $$ select settings from public.tenant_configs where tenant_id = ('00000000-0000-0000-0000-00000000c00' || p)::uuid $$;

select is(pg_temp.cal('1'), '{"calendar": {"secondary_visible": false, "numerals": "latn", "show_hijri": false}, "branding": {"x": 1}}'::jsonb,
  'production shape: Ge''ez on falls back to 0-9, secondaryVisible becomes secondary_visible, other settings survive');
select is(pg_temp.cal('2')->'calendar', '{"secondary_visible": true, "numerals": "arab", "show_hijri": true}'::jsonb,
  'an explicit Eastern Arabic + Hijri choice is kept');
select is(pg_temp.cal('3'), '{"branding": {"y": 2}}'::jsonb, 'a tenant with no calendar settings is untouched');
select is(pg_temp.cal('4')->'calendar', '{"secondary_visible": true, "numerals": "latn", "show_hijri": false}'::jsonb,
  'a scalar calendar is reset to defaults instead of aborting the migration');
select is(pg_temp.cal('5')->'calendar', '{"secondary_visible": true, "numerals": "latn", "show_hijri": false}'::jsonb,
  'an array calendar is reset to defaults, not appended to');
select is(pg_temp.cal('6')->'calendar', '{"extra": 7, "secondary_visible": true, "numerals": "latn", "show_hijri": false}'::jsonb,
  'invalid numerals and a non-boolean showHijri are defaulted; unknown keys are kept');
select is(pg_temp.cal('7')->'calendar', '{"secondary_visible": true, "numerals": "latn", "show_hijri": false}'::jsonb,
  'a JSON null calendar is reset to defaults');

-- Idempotent: a second run changes nothing.
\ir ../../migrations/20260925000002_r6_calendar_numerals.sql
select is((select count(*)::int from public.tenant_configs t join cal_after_first a using (tenant_id) where t.settings is distinct from a.settings), 0,
  'running the migration twice changes nothing');

-- Old clients still live in production keep working (normalised, not rejected).
select lives_ok($$ update public.tenant_configs set settings = '{"calendar": {"secondaryVisible": true, "geezNumerals": false}}'
                   where tenant_id = '00000000-0000-0000-0000-00000000c003' $$,
  'the old settings page write (secondaryVisible, geezNumerals) still saves');
select is(pg_temp.cal('3')->'calendar', '{"secondary_visible": true, "numerals": "latn", "show_hijri": false}'::jsonb,
  '... and is stored normalised, without geezNumerals');
select lives_ok($$ insert into public.tenants (id, name, slug) values ('00000000-0000-0000-0000-00000000c008', 'Calendar H', 'cal-h');
                   insert into public.tenant_configs (tenant_id, settings)
                   values ('00000000-0000-0000-0000-00000000c008', '{"calendar": {"secondaryVisible": true, "geezNumerals": false}, "locale": "am"}') $$,
  'the old onboard-tenant insert still succeeds');
select is(pg_temp.cal('8'), '{"calendar": {"secondary_visible": true, "numerals": "latn", "show_hijri": false}, "locale": "am"}'::jsonb,
  '... and is stored normalised');
select lives_ok($$ update public.tenant_configs set settings = '{"calendar": {"geezNumerals": true, "numerals": "ethi"}}'
                   where tenant_id = '00000000-0000-0000-0000-00000000c003' $$,
  'a write asking for Ge''ez or an unknown digit system does not fail ...');
select is(pg_temp.cal('3')->'calendar'->>'numerals', 'latn', '... but is stored as Western digits');
select ok(not exists (select 1 from public.tenant_configs where settings::text ~ '[\u1369-\u137C]' or settings->'calendar' ? 'geezNumerals'),
  'no Ge''ez digits or geezNumerals key anywhere (fix plan §5 query 5)');

select * from finish();
rollback;
