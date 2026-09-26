-- ============================================================================
-- R6 WP-01 round 3 (reviews CQ M-1, i18n N-01):
-- merge_tenant_settings (20260925000003) replaces one settings section and
-- leaves every other section alone, only for the caller's own tenant, and only
-- for its school_admin.
-- ============================================================================
begin;
select plan(10);

insert into public.tenants (id, name, slug) values
  ('00000000-0000-0000-0000-00000000d5a0', 'Merge A', 'merge-a'),
  ('00000000-0000-0000-0000-00000000d5b0', 'Merge B', 'merge-b');
insert into public.users (id, tenant_id, role, full_name, email) values
  ('00000000-0000-0000-0000-00000000d5a1', '00000000-0000-0000-0000-00000000d5a0', 'school_admin', 'Admin A', 'merge-a@example.test'),
  ('00000000-0000-0000-0000-00000000d5a2', '00000000-0000-0000-0000-00000000d5a0', 'teacher', 'Teacher A', 'merge-t@example.test'),
  ('00000000-0000-0000-0000-00000000d5b1', '00000000-0000-0000-0000-00000000d5b0', 'school_admin', 'Admin B', 'merge-b@example.test');
insert into public.tenant_configs (tenant_id, settings) values
  ('00000000-0000-0000-0000-00000000d5a0', '{"branding": {"schoolName": "A"}, "idCardTemplate": {"x": 1}, "billing": {"blockUnpaidBalance": true}}'),
  ('00000000-0000-0000-0000-00000000d5b0', '{"branding": {"schoolName": "B"}}');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d5a1';
select lives_ok($$ select public.merge_tenant_settings('calendar', '{"numerals": "arab"}') $$, 'admin A saves the calendar section');
reset role;
select is((select settings - 'calendar' from public.tenant_configs where tenant_id = '00000000-0000-0000-0000-00000000d5a0'),
  '{"branding": {"schoolName": "A"}, "idCardTemplate": {"x": 1}, "billing": {"blockUnpaidBalance": true}}'::jsonb,
  'every other section is left exactly as it was');
select is((select settings -> 'calendar' ->> 'numerals' from public.tenant_configs where tenant_id = '00000000-0000-0000-0000-00000000d5a0'), 'arab',
  'the calendar section is stored (and normalised by the calendar trigger)');
select is((select settings from public.tenant_configs where tenant_id = '00000000-0000-0000-0000-00000000d5b0'),
  '{"branding": {"schoolName": "B"}}'::jsonb, 'tenant B is untouched');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d5a1';
select throws_ok($$ select public.merge_tenant_settings('approvals', '{"x": 1}') $$, '22023', 'unknown_settings_section',
  'only known sections can be written');
select throws_ok($$ select public.merge_tenant_settings('branding', '"wipe"') $$, '22023', 'invalid_settings_value',
  'a section must be an object');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d5a2';
select throws_ok($$ select public.merge_tenant_settings('branding', '{"schoolName": "Hacked"}') $$, '42501', null,
  'a teacher cannot write settings (RLS configs_write)');
reset role;
select is((select settings -> 'branding' ->> 'schoolName' from public.tenant_configs where tenant_id = '00000000-0000-0000-0000-00000000d5a0'), 'A',
  '... and nothing changed');

-- Release gate GK-4: a malformed (non-object) settings value becomes an object.
update public.tenant_configs set settings = '[1]' where tenant_id = '00000000-0000-0000-0000-00000000d5b0';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d5b1';
select is(public.merge_tenant_settings('billing', '{"blockUnpaidBalance": false}'), '{"billing": {"blockUnpaidBalance": false}}'::jsonb,
  'a non-object settings value is replaced by an object, not turned into an array');
reset role;

set local role anon;
set local request.jwt.claim.sub = '';
select throws_ok($$ select public.merge_tenant_settings('branding', '{}') $$, '42501', null, 'anon cannot call it');
reset role;

select * from finish();
rollback;
