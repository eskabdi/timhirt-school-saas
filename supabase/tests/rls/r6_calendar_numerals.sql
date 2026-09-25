-- ============================================================================
-- 20260925000002_r6_calendar_numerals.sql: the Ge'ez-numerals tenant option is
-- migrated away (to 'latn', never Ge'ez) and cannot be written back.
-- ============================================================================
begin;
select plan(7);

alter table public.tenant_configs drop constraint if exists tenant_configs_calendar_numerals_chk;
insert into public.tenants (id, name, slug) values
  ('00000000-0000-0000-0000-00000000c001', 'Calendar A', 'cal-a'),
  ('00000000-0000-0000-0000-00000000c002', 'Calendar B', 'cal-b'),
  ('00000000-0000-0000-0000-00000000c003', 'Calendar C', 'cal-c');
insert into public.tenant_configs (tenant_id, settings) values
  ('00000000-0000-0000-0000-00000000c001', '{"calendar": {"secondaryVisible": false, "geezNumerals": true}, "branding": {"x": 1}}'),
  ('00000000-0000-0000-0000-00000000c002', '{"calendar": {"secondaryVisible": true, "numerals": "arab", "showHijri": true}}'),
  ('00000000-0000-0000-0000-00000000c003', '{"branding": {"y": 2}}');

\ir ../../migrations/20260925000002_r6_calendar_numerals.sql

select is((select settings->'calendar' from public.tenant_configs where tenant_id = '00000000-0000-0000-0000-00000000c001'),
  '{"secondaryVisible": false, "numerals": "latn", "showHijri": false}'::jsonb,
  'a tenant with Ge''ez numerals on falls back to Western digits; its other calendar settings survive');
select is((select settings->'branding' from public.tenant_configs where tenant_id = '00000000-0000-0000-0000-00000000c001'),
  '{"x": 1}'::jsonb, 'non-calendar settings are untouched');
select is((select settings->'calendar' from public.tenant_configs where tenant_id = '00000000-0000-0000-0000-00000000c002'),
  '{"secondaryVisible": true, "numerals": "arab", "showHijri": true}'::jsonb, 'an explicit Eastern Arabic + Hijri choice is kept');
select is((select settings from public.tenant_configs where tenant_id = '00000000-0000-0000-0000-00000000c003'),
  '{"branding": {"y": 2}}'::jsonb, 'a tenant with no calendar settings is untouched');

select throws_ok($$ update public.tenant_configs set settings = '{"calendar": {"geezNumerals": true}}'
                    where tenant_id = '00000000-0000-0000-0000-00000000c003' $$,
  '23514', null, 'the geezNumerals key cannot be written back');
select throws_ok($$ update public.tenant_configs set settings = '{"calendar": {"numerals": "ethi"}}'
                    where tenant_id = '00000000-0000-0000-0000-00000000c003' $$,
  '23514', null, 'an unknown digit system is rejected');
select lives_ok($$ update public.tenant_configs set settings = '{"calendar": {"numerals": "arab", "showHijri": true}}'
                   where tenant_id = '00000000-0000-0000-0000-00000000c003' $$,
  'a valid calendar setting saves');

select * from finish();
rollback;
