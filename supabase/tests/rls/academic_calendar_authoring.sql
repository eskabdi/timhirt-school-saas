-- ============================================================================
-- Academic Calendar Engine, slice 2a (20261022000001_academic_calendar_authoring):
-- draft authoring, publishing and changing a published calendar through
-- maker-checker, the guards behind them, closing with the academic year, and
-- tenant isolation of all of it. Runs in the current EC year (the engine
-- accepts the current year ± 1) with its own regional calendar; every
-- fixture date lies inside that year's session.
-- ============================================================================
begin;
select plan(96);

create function pg_temp.y() returns integer language sql stable as $$
  select (public.gregorian_to_ec((now() at time zone 'Africa/Addis_Ababa')::date)).ec_year
$$;
grant execute on function pg_temp.y() to authenticated;
create function pg_temp.ec(m integer, d integer, dy integer default 0) returns date language sql stable as $$
  select public.ec_to_gregorian(pg_temp.y() + dy, m, d)
$$;
grant execute on function pg_temp.ec(integer, integer, integer) to authenticated;
create function pg_temp.act_as(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  execute 'set local role ' || case when p is null then 'anon' else 'authenticated' end;
end $$;
grant execute on function pg_temp.act_as(uuid) to anon, authenticated;
-- A definer function that writes the calendar tables directly: what a future
-- RPC that forgot the approval would do. Only the guards stand in its way.
create function pg_temp.rogue(p_sql text) returns void language plpgsql security definer as $$
begin
  execute p_sql;
end $$;
grant execute on function pg_temp.rogue(text) to authenticated;
create function pg_temp.req(p_action text, p_tenant uuid) returns public.approval_requests language sql as $$
  select * from public.approval_requests where action = p_action and tenant_id = p_tenant order by created_at desc, id limit 1
$$;
grant execute on function pg_temp.req(text, uuid) to authenticated;

insert into auth.users (id, email) values
  ('0000000d-0000-0000-0000-0000000a0001', 'ca-admin-a1@example.test'),
  ('0000000d-0000-0000-0000-0000000a0002', 'ca-admin-a2@example.test'),
  ('0000000d-0000-0000-0000-0000000a0003', 'ca-teacher-a@example.test'),
  ('0000000d-0000-0000-0000-0000000a0004', 'ca-checker-a@example.test'),
  ('0000000d-0000-0000-0000-0000000a0005', 'ca-editor-a@example.test'),
  ('0000000d-0000-0000-0000-0000000b0001', 'ca-admin-b1@example.test'),
  ('0000000d-0000-0000-0000-0000000b0002', 'ca-admin-b2@example.test'),
  ('0000000d-0000-0000-0000-0000000c0001', 'ca-admin-c@example.test');
insert into public.tenants (id, name, slug, status, tier_key, edu_authority_id) values
  ('0000000d-0000-0000-0000-00000000000a', 'CA School A (Oromia)', 'ca-a', 'active', 'premium',
   (select id from public.edu_authorities where code = 'OR')),
  ('0000000d-0000-0000-0000-00000000000b', 'CA School B (MoE)', 'ca-b', 'active', 'premium', null),
  ('0000000d-0000-0000-0000-00000000000c', 'CA School C (no events module)', 'ca-c', 'active', 'basic', null);
insert into public.users (id, tenant_id, role, full_name, email) values
  ('0000000d-0000-0000-0000-0000000a0001', '0000000d-0000-0000-0000-00000000000a', 'school_admin', 'CA Admin A1', 'ca-admin-a1@example.test'),
  ('0000000d-0000-0000-0000-0000000a0002', '0000000d-0000-0000-0000-00000000000a', 'school_admin', 'CA Admin A2', 'ca-admin-a2@example.test'),
  ('0000000d-0000-0000-0000-0000000a0003', '0000000d-0000-0000-0000-00000000000a', 'teacher', 'CA Teacher A', 'ca-teacher-a@example.test'),
  ('0000000d-0000-0000-0000-0000000a0004', '0000000d-0000-0000-0000-00000000000a', 'teacher', 'CA Checker A', 'ca-checker-a@example.test'),
  ('0000000d-0000-0000-0000-0000000a0005', '0000000d-0000-0000-0000-00000000000a', 'teacher', 'CA Editor A', 'ca-editor-a@example.test'),
  ('0000000d-0000-0000-0000-0000000b0001', '0000000d-0000-0000-0000-00000000000b', 'school_admin', 'CA Admin B1', 'ca-admin-b1@example.test'),
  ('0000000d-0000-0000-0000-0000000b0002', '0000000d-0000-0000-0000-00000000000b', 'school_admin', 'CA Admin B2', 'ca-admin-b2@example.test'),
  ('0000000d-0000-0000-0000-0000000c0001', '0000000d-0000-0000-0000-00000000000c', 'school_admin', 'CA Admin C', 'ca-admin-c@example.test');
-- A teacher who may approve calendar requests but not edit (the policy's
-- approve branch).
insert into public.user_permission_overrides (tenant_id, user_id, permission_id, granted)
select '0000000d-0000-0000-0000-00000000000a', '0000000d-0000-0000-0000-0000000a0004', p.id, true
  from public.permissions p where p.key = 'academic_calendar:approve';
-- A teacher who may edit but neither publish nor approve (sees no requests through RLS).
insert into public.user_permission_overrides (tenant_id, user_id, permission_id, granted)
select '0000000d-0000-0000-0000-00000000000a', '0000000d-0000-0000-0000-0000000a0005', p.id, true
  from public.permissions p where p.key = 'academic_calendar:update';

-- The MoE calendar for the current year (2019 is seeded) and an Oromia
-- calendar with a locked regional holiday and an unlocked mid-term break.
insert into public.authority_calendars (authority_id, ec_year, session_starts_on, session_ends_on, status, published_at)
select (select id from public.edu_authorities where code = 'MOE'), pg_temp.y(), pg_temp.ec(12, 25, -1), pg_temp.ec(10, 30), 'published', now()
where not exists (select 1 from public.authority_calendars c join public.edu_authorities a on a.id = c.authority_id
                  where a.code = 'MOE' and c.ec_year = pg_temp.y());
insert into public.authority_calendars (id, authority_id, ec_year, session_starts_on, session_ends_on, status, published_at)
values ('0000000d-0000-0000-0001-000000000001', (select id from public.edu_authorities where code = 'OR'), pg_temp.y(),
        pg_temp.ec(12, 25, -1), pg_temp.ec(10, 30), 'published', now());
insert into public.authority_calendar_entries (id, calendar_id, day_type_code, starts_on, ends_on, name_i18n) values
  ('0000000d-0000-0000-0002-000000000001', '0000000d-0000-0000-0001-000000000001', 'regional_holiday', pg_temp.ec(3, 10), pg_temp.ec(3, 10), '{"en": "R holiday"}'),
  ('0000000d-0000-0000-0002-000000000002', '0000000d-0000-0000-0001-000000000001', 'mid_term_break',   pg_temp.ec(3, 20), pg_temp.ec(3, 24), '{"en": "R mid-term"}'),
  ('0000000d-0000-0000-0002-000000000003', '0000000d-0000-0000-0001-000000000001', 'parent_meeting',   pg_temp.ec(4, 5),  pg_temp.ec(4, 5),  '{"en": "R parents"}');

-- Each school chooses the MoE calendar (a draft with no entries of its own).
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0001');
select public.create_school_calendar(pg_temp.y(), 'moe');
select pg_temp.act_as('0000000d-0000-0000-0000-0000000b0001');
select public.create_school_calendar(pg_temp.y(), 'moe');
reset role;
create temp table cal on commit drop as
select tenant_id, id from public.school_calendars
 where tenant_id in ('0000000d-0000-0000-0000-00000000000a', '0000000d-0000-0000-0000-00000000000b') and ec_year = pg_temp.y();
grant select on cal to authenticated, anon;
create function pg_temp.cal(p_tenant uuid) returns uuid language sql stable as $$ select id from cal where tenant_id = p_tenant $$;
grant execute on function pg_temp.cal(uuid) to authenticated, anon;
create temp table ids (k text primary key, id uuid) on commit drop;
grant select, insert, update on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql stable as $$ select id from ids where k = p_k $$;
grant execute on function pg_temp.id(text) to authenticated;
select is((select count(*)::integer from cal), 2, 'both schools hold a draft calendar (fixtures)');

-- ======================================================== draft authoring ==
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0001');
insert into ids values ('a_hol', public.save_school_calendar_entry(
  pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null, 'school_holiday', pg_temp.ec(2, 10), pg_temp.ec(2, 11),
  '{"en": " Founders'' Day ", "am": "የመሥራቾች ቀን"}'));
select is((select row(day_type_code, starts_on, ends_on, name_i18n ->> 'en', created_by)::text
             from public.school_calendar_entries where id = pg_temp.id('a_hol')),
  row('school_holiday', pg_temp.ec(2, 10), pg_temp.ec(2, 11), 'Founders'' Day', '0000000d-0000-0000-0000-0000000a0001'::uuid)::text,
  'an editor adds an entry to the draft (name trimmed, created_by the caller)');
select is(public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), pg_temp.id('a_hol'),
            'school_holiday', pg_temp.ec(2, 10), pg_temp.ec(2, 12), '{"am": "የመሥራቾች ቀን"}'), pg_temp.id('a_hol'),
  '... and changes it');
select is((select row(ends_on, name_i18n)::text from public.school_calendar_entries where id = pg_temp.id('a_hol')),
  row(pg_temp.ec(2, 12), '{"am": "የመሥራቾች ቀን", "en": "የመሥራቾች ቀን"}'::jsonb)::text,
  'a name given only in Amharic is copied to en');
select throws_ok($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'school_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 15), '{"en": "  "}') $$, '22023', 'invalid_name', 'a blank name is refused');
select throws_ok($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'school_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 15), '{"en": "x", "fr": "y"}') $$, '22023', 'invalid_name', '... a name in another key');
select throws_ok(format($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'school_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 15), '{"en": "%s"}') $$, repeat('x', 201)), '22023', 'invalid_name',
  '... a name over 200 characters');
select throws_ok($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'school_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 14), '{"en": "x"}') $$, '22023', 'invalid_range', '... an end before the start');
select throws_ok($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'national_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 15), '{"en": "x"}') $$, '22023', 'invalid_day_type',
  '... a type only an authority enters (the guard)');
select throws_ok($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'regional_holiday', pg_temp.ec(3, 10), pg_temp.ec(3, 10), '{"en": "x"}', '0000000d-0000-0000-0002-000000000001', true) $$,
  '42501', 'calendar_entry_locked', '... removing a locked regional holiday');
insert into ids values ('a_supp', public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'mid_term_break', pg_temp.ec(3, 20), pg_temp.ec(3, 24), '{"en": "R mid-term"}', '0000000d-0000-0000-0002-000000000002', true));
select is((select count(*)::integer from public.effective_calendar_entries(pg_temp.y()) where entry_id = '0000000d-0000-0000-0002-000000000002'), 0,
  'an editor removes the unlocked regional mid-term for the school');
select throws_ok($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'mid_term_break', pg_temp.ec(3, 20), pg_temp.ec(3, 24), '{"en": "again"}', '0000000d-0000-0000-0002-000000000002', true) $$,
  '22023', 'already_overridden', '... once: the same date cannot be replaced or removed twice');
select throws_ok(format($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'school_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 15), %L) $$,
  jsonb_build_object('en', repeat('"', 200), 'am', repeat('"', 200), 'om', repeat('"', 200))), '22023', 'invalid_name',
  'a name whose stored form would exceed the column limit is refused as invalid_name, not a raw CHECK error');
insert into ids values ('a_tmp', public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'parent_meeting', pg_temp.ec(4, 2), pg_temp.ec(4, 2), '{"en": "Temp"}'));
select lives_ok($$ select public.delete_school_calendar_entry(pg_temp.id('a_tmp')) $$, 'an editor deletes a draft entry');
select is((select count(*)::integer from public.school_calendar_entries where id = pg_temp.id('a_tmp')), 0, '... and it is gone');
reset role;

select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0003');
select throws_ok($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'school_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 15), '{"en": "x"}') $$, '42501', 'not_allowed',
  'a teacher cannot edit the calendar');
select throws_ok($$ select public.delete_school_calendar_entry(pg_temp.id('a_hol')) $$, '42501', 'not_allowed', '... or delete from it');
select is((select count(*)::integer from public.school_calendars where tenant_id = '0000000d-0000-0000-0000-00000000000a'), 0,
  'a teacher does not see the draft calendar');
select is((select count(*)::integer from public.school_calendar_entries where tenant_id = '0000000d-0000-0000-0000-00000000000a'), 0,
  '... or its entries');
reset role;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0004');
select is((select count(*)::integer from public.school_calendars where tenant_id = '0000000d-0000-0000-0000-00000000000a'), 1,
  'a checker (academic_calendar:approve only) sees the draft they are asked to publish');
select is((select count(*)::integer from public.school_calendar_entries where tenant_id = '0000000d-0000-0000-0000-00000000000a'), 2,
  '... and its entries');
select throws_ok($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'school_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 15), '{"en": "x"}') $$, '42501', 'not_allowed',
  '... but cannot edit it');
reset role;

-- ------------------------------------------------------ tenant isolation --
select pg_temp.act_as('0000000d-0000-0000-0000-0000000b0001');
select is((select count(*)::integer from public.school_calendar_entries where tenant_id = '0000000d-0000-0000-0000-00000000000a'), 0,
  'school B reads none of A''s entries');
select throws_ok($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'school_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 15), '{"en": "x"}') $$, '42501', 'not_allowed',
  'school B cannot add to A''s calendar');
select throws_ok($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000b'), pg_temp.id('a_hol'),
  'school_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 15), '{"en": "x"}') $$, '42501', 'not_allowed',
  '... or change A''s entry through its own calendar');
select throws_ok($$ select public.delete_school_calendar_entry(pg_temp.id('a_hol')) $$, '42501', 'not_allowed',
  '... or delete A''s entry');
select throws_ok($$ select public.submit_approval('academic_calendar_publish', pg_temp.cal('0000000d-0000-0000-0000-00000000000a')) $$,
  '42501', 'not_allowed', '... or ask to publish A''s calendar');
insert into ids values ('b_hol', public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000b'), null,
  'school_holiday', pg_temp.ec(2, 20), pg_temp.ec(2, 20), '{"en": "B day"}'));
reset role;
select is((select row(ends_on, name_i18n ->> 'en')::text from public.school_calendar_entries where id = pg_temp.id('a_hol')),
  row(pg_temp.ec(2, 12), 'የመሥራቾች ቀን')::text, 'A''s entry is unchanged by B''s attempts (and exists)');
-- School C lost the events module after choosing a calendar.
insert into public.school_calendars (id, tenant_id, ec_year, origin) values
  ('0000000d-0000-0000-0003-00000000000c', '0000000d-0000-0000-0000-00000000000c', pg_temp.y(), 'moe');
insert into public.school_calendar_entries (id, tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n) values
  ('0000000d-0000-0000-0004-00000000000c', '0000000d-0000-0000-0000-00000000000c', '0000000d-0000-0000-0003-00000000000c',
   'school_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 15), '{"en": "C day"}');
select pg_temp.act_as('0000000d-0000-0000-0000-0000000c0001');
select throws_ok($$ select public.save_school_calendar_entry('0000000d-0000-0000-0003-00000000000c', null,
  'school_holiday', pg_temp.ec(2, 16), pg_temp.ec(2, 16), '{"en": "x"}') $$, '42501', 'not_allowed',
  'a school without the events module cannot edit its own calendar');
select throws_ok($$ select public.delete_school_calendar_entry('0000000d-0000-0000-0004-00000000000c') $$, '42501', 'not_allowed',
  '... or delete from it');
reset role;
select pg_temp.act_as(null);
select throws_ok($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'school_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 15), '{"en": "x"}') $$, '42501', null, 'anon cannot call the editor RPC');
reset role;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0001');
select throws_ok($$ insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n)
  values ('0000000d-0000-0000-0000-00000000000a', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), 'school_holiday',
          pg_temp.ec(2, 15), pg_temp.ec(2, 15), '{"en": "x"}') $$, '42501', null, 'an editor cannot write the table directly');
reset role;

-- A draft never applies without a signed-in user who may see it.
select set_config('request.jwt.claim.sub', '', true);
select is((select school_calendar_id from public.calendar_year_settings(pg_temp.y(), '0000000d-0000-0000-0000-00000000000a')), null,
  'with no user (a job, service_role) the draft school layer does not apply');
select is((select count(*)::integer from public.effective_calendar_entries(pg_temp.y(), '0000000d-0000-0000-0000-00000000000a') where level = 'school'), 0,
  '... so none of its entries do');

-- ================================================================ publish ==
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0003');
select throws_ok($$ select public.submit_approval('academic_calendar_publish', pg_temp.cal('0000000d-0000-0000-0000-00000000000a')) $$,
  '42501', 'not_allowed', 'a teacher cannot ask to publish');
reset role;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0001');
select throws_ok($$ select public.submit_approval('academic_calendar_publish', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), '{"status": "published"}') $$,
  '22023', 'invalid_changes', 'a publish request carries no changes');
insert into ids values ('a_pub', public.submit_approval('academic_calendar_publish', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), '{}', 'Ready'));
reset role;
select is((select row(entity_id, payload ->> 'entry_count', payload -> 'to' ->> 'status', status)::text
             from public.approval_requests where id = pg_temp.id('a_pub')),
  row(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), '2', 'published', 'pending')::text,
  'an editor asks to publish: a pending request for the draft and its 2 entries');
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0001');
select throws_ok($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'school_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 15), '{"en": "x"}') $$, '22023', 'approval_already_pending',
  'the draft is frozen while its publish request waits');
select throws_ok($$ select public.delete_school_calendar_entry(pg_temp.id('a_hol')) $$, '22023', 'approval_already_pending',
  '... deletes included');
select throws_ok(format($$ select public.decide_approval(%L, 'approved', %L) $$, pg_temp.id('a_pub'),
  (pg_temp.req('academic_calendar_publish', '0000000d-0000-0000-0000-00000000000a')).payload_hash), '42501', 'maker_cannot_decide',
  'the maker cannot approve their own publish request');
select throws_ok($$ select public.create_school_calendar(pg_temp.y(), 'custom') $$, '22023', 'approval_already_pending',
  '... and cannot rebuild the frozen draft with Choose Calendar either (the guard holds the freeze)');
reset role;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0005');
select is((select count(*)::integer from public.approval_requests where tenant_id = '0000000d-0000-0000-0000-00000000000a'), 0,
  'an editor who neither made nor may approve the request cannot read it');
select is((select string_agg(action, ',') from public.school_calendar_pending(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'))),
  'academic_calendar_publish', '... but learns that a publish waits (school_calendar_pending)');
reset role;
alter table public.approval_requests disable trigger approval_requests_transition_guard;
update public.approval_requests set expires_at = now() - interval '1 minute' where id = pg_temp.id('a_pub');
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0005');
select is((select count(*)::integer from public.school_calendar_pending(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'))), 0,
  '... and not once it has expired');
reset role;
update public.approval_requests set expires_at = now() + interval '7 days' where id = pg_temp.id('a_pub');
alter table public.approval_requests enable trigger approval_requests_transition_guard;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0003');
select is((select count(*)::integer from public.school_calendar_pending(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'))), 0,
  'a teacher without the calendar permissions learns nothing');
reset role;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000b0001');
select is((select count(*)::integer from public.school_calendar_pending(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'))), 0,
  '... nor does another school''s editor');
reset role;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0003');
select is((select count(*)::integer from public.approval_requests where tenant_id = '0000000d-0000-0000-0000-00000000000a'), 0,
  'a teacher does not see the calendar requests');
reset role;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000b0002');
select is((select count(*)::integer from public.approval_requests where tenant_id = '0000000d-0000-0000-0000-00000000000a'), 0,
  '... nor does another school''s checker');
select throws_ok(format($$ select public.decide_approval(%L, 'approved', %L) $$, pg_temp.id('a_pub'),
  (pg_temp.req('academic_calendar_publish', '0000000d-0000-0000-0000-00000000000a')).payload_hash), '42501', 'not_allowed',
  '... who cannot approve it either');
reset role;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0002');
select is((select count(*)::integer from public.approval_requests where id = pg_temp.id('a_pub')), 1,
  'the school''s other admin (academic_calendar:approve) sees the request');
select is(public.decide_approval(pg_temp.id('a_pub'), 'approved',
            (pg_temp.req('academic_calendar_publish', '0000000d-0000-0000-0000-00000000000a')).payload_hash), 'executed',
  '... and approves it');
reset role;
select is((select row(status, version, published_by)::text from public.school_calendars where id = pg_temp.cal('0000000d-0000-0000-0000-00000000000a')),
  row('published', 1, '0000000d-0000-0000-0000-0000000a0002'::uuid)::text,
  'the calendar is published, by the checker, version 1');
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0003');
select is((select count(*)::integer from public.effective_calendar_entries(pg_temp.y()) where level = 'school'), 1,
  'the whole school now sees the published calendar (the holiday; the removal hides the mid-term)');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select school_calendar_id from public.calendar_year_settings(pg_temp.y(), '0000000d-0000-0000-0000-00000000000a')),
  pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), '... and so does a job with no user');

-- The checker approves exactly what they saw: B's draft changes after B asks.
select pg_temp.act_as('0000000d-0000-0000-0000-0000000b0001');
insert into ids values ('b_pub', public.submit_approval('academic_calendar_publish', pg_temp.cal('0000000d-0000-0000-0000-00000000000b')));
reset role;
update public.school_calendar_entries set ends_on = ends_on + 1 where id = pg_temp.id('b_hol');
select pg_temp.act_as('0000000d-0000-0000-0000-0000000b0002');
select throws_ok(format($$ select public.decide_approval(%L, 'approved', %L) $$, pg_temp.id('b_pub'),
  (pg_temp.req('academic_calendar_publish', '0000000d-0000-0000-0000-00000000000b')).payload_hash), '40001', 'entity_changed',
  'a draft that changed after the publish request is not published');
reset role;
select is((select status from public.school_calendars where id = pg_temp.cal('0000000d-0000-0000-0000-00000000000b')), 'draft',
  '... it stays a draft');

-- ====================================================== published changes ==
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0001');
select throws_ok($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), null,
  'school_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 15), '{"en": "x"}') $$, '42501', 'approval_required',
  'a published calendar is not edited directly');
select throws_ok($$ select public.delete_school_calendar_entry(pg_temp.id('a_hol')) $$, '42501', 'approval_required',
  '... nor deleted from');
select throws_ok($$ select public.submit_approval('academic_calendar_change', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'),
  '{"op": "add", "day_type_code": "school_holiday", "starts_on": "2000-01-01", "ends_on": "2000-01-01", "name_i18n": {"en": "x"}, "locked": true}') $$,
  '22023', 'invalid_changes', 'a change request with an unknown field is refused');
select throws_ok($$ select public.submit_approval('academic_calendar_change', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), '{"op": "move"}') $$,
  '22023', 'invalid_changes', '... and one with an unknown op');
select throws_ok(format($$ select public.submit_approval('academic_calendar_change', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), %L) $$,
  jsonb_build_object('op', 'add', 'day_type_code', 'regional_holiday', 'starts_on', pg_temp.ec(3, 10), 'ends_on', pg_temp.ec(3, 10),
                     'name_i18n', '{"en": "x"}'::jsonb, 'overrides_entry_id', '0000000d-0000-0000-0002-000000000001', 'suppressed', true)),
  '42501', 'calendar_entry_locked', 'a change the guards would refuse is refused when asked, not at approval');
select is((select count(*)::integer from public.school_calendar_entries where calendar_id = pg_temp.cal('0000000d-0000-0000-0000-00000000000a')), 2,
  '... and trying it left nothing behind');
select throws_ok(format($$ select public.submit_approval('academic_calendar_change', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), %L) $$,
  jsonb_build_object('op', 'add', 'day_type_code', 'mid_term_break', 'starts_on', pg_temp.ec(3, 20), 'ends_on', pg_temp.ec(3, 24),
                     'name_i18n', '{"en": "x"}'::jsonb, 'overrides_entry_id', '0000000d-0000-0000-0002-000000000002', 'suppressed', true)),
  '22023', 'already_overridden', 'a date the published calendar already removes cannot be removed again by request');
insert into ids values ('a_s1', public.submit_approval('academic_calendar_change', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'),
  jsonb_build_object('op', 'add', 'day_type_code', 'parent_meeting', 'starts_on', pg_temp.ec(4, 5), 'ends_on', pg_temp.ec(4, 5),
                     'name_i18n', '{"en": "R parents"}'::jsonb, 'overrides_entry_id', '0000000d-0000-0000-0002-000000000003', 'suppressed', true)));
select throws_ok(format($$ select public.submit_approval('academic_calendar_change', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), %L) $$,
  jsonb_build_object('op', 'add', 'day_type_code', 'parent_meeting', 'starts_on', pg_temp.ec(4, 5), 'ends_on', pg_temp.ec(4, 5),
                     'name_i18n', '{"en": "R parents"}'::jsonb, 'overrides_entry_id', '0000000d-0000-0000-0002-000000000003', 'suppressed', true)),
  '22023', 'already_overridden', '... nor by a second request while the first waits');
select is((select payload -> 'to' ->> 'overrides' from public.approval_requests where id = pg_temp.id('a_s1')), '{"en": "R parents"}',
  'the checker sees which MoE/regional date the request removes');
select is((select string_agg(overrides_entry_id::text, ',') from public.school_calendar_pending(pg_temp.cal('0000000d-0000-0000-0000-00000000000a'))),
  '0000000d-0000-0000-0002-000000000003', '... and the editor which date a request waits on');
select is(public.cancel_approval(pg_temp.id('a_s1')), 'cancelled', 'the maker withdraws it');
insert into ids values ('a_add', public.submit_approval('academic_calendar_change', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'),
  jsonb_build_object('op', 'add', 'day_type_code', 'special_closure', 'starts_on', pg_temp.ec(5, 2), 'ends_on', pg_temp.ec(5, 3),
                     'name_i18n', '{"en": "Water outage"}'::jsonb)));
select is(coalesce(current_setting('timhirt.calendar_change', true), ''), '',
  'the request''s trial run does not leave the approval flag set');
reset role;
select is((select count(*)::integer from public.school_calendar_entries where calendar_id = pg_temp.cal('0000000d-0000-0000-0000-00000000000a')), 2,
  'an add request changes nothing until it is approved');
select pg_temp.act_as('0000000d-0000-0000-0000-0000000b0001');
select throws_ok(format($$ select public.submit_approval('academic_calendar_change', %L, '{"op": "delete"}') $$, pg_temp.id('a_hol')),
  '42501', 'not_allowed', 'school B cannot ask to change A''s entry');
select throws_ok(format($$ select public.submit_approval('academic_calendar_change', pg_temp.cal('0000000d-0000-0000-0000-00000000000b'), %L) $$,
  jsonb_build_object('op', 'add', 'day_type_code', 'school_holiday', 'starts_on', pg_temp.ec(2, 22), 'ends_on', pg_temp.ec(2, 22),
                     'name_i18n', '{"en": "x"}'::jsonb)), '22023', 'approval_not_needed', 'a draft is edited directly, not by request');
reset role;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0002');
select is(public.decide_approval(pg_temp.id('a_add'), 'approved',
            (select payload_hash from public.approval_requests where id = pg_temp.id('a_add'))), 'executed',
  'the other admin approves the closure');
reset role;
select is((select row(id, day_type_code, created_by)::text from public.school_calendar_entries
            where calendar_id = pg_temp.cal('0000000d-0000-0000-0000-00000000000a') and day_type_code = 'special_closure'),
  row((select entity_id from public.approval_requests where id = pg_temp.id('a_add')), 'special_closure',
      '0000000d-0000-0000-0000-0000000a0001'::uuid)::text,
  '... the entry is added (the id the request named; created_by the maker)');
select is((select version from public.school_calendars where id = pg_temp.cal('0000000d-0000-0000-0000-00000000000a')), 2,
  '... and the calendar''s version moves on');
select is((select day_type_code from public.calendar_day_status(pg_temp.ec(5, 2), '0000000d-0000-0000-0000-00000000000a')), 'special_closure',
  '... which the day status now reports');

-- An update approved after the entry moved on applies nothing.
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0001');
insert into ids values ('a_upd', public.submit_approval('academic_calendar_change', pg_temp.id('a_hol'),
  jsonb_build_object('op', 'update', 'day_type_code', 'school_holiday', 'starts_on', pg_temp.ec(2, 10), 'ends_on', pg_temp.ec(2, 13),
                     'name_i18n', '{"en": "Founders'' Day"}'::jsonb)));
select throws_ok(format($$ select public.submit_approval('academic_calendar_change', %L, '{"op": "delete"}') $$, pg_temp.id('a_hol')),
  '22023', 'approval_already_pending', 'one open request per entry');
reset role;
update public.school_calendar_entries set name_i18n = '{"en": "Renamed meanwhile"}' where id = pg_temp.id('a_hol');
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0002');
select throws_ok(format($$ select public.decide_approval(%L, 'approved', %L) $$, pg_temp.id('a_upd'),
  (select payload_hash from public.approval_requests where id = pg_temp.id('a_upd'))), '40001', 'entity_changed',
  'an update approved after the entry changed applies nothing');
reset role;
select is((select row(ends_on, name_i18n ->> 'en')::text from public.school_calendar_entries where id = pg_temp.id('a_hol')),
  row(pg_temp.ec(2, 12), 'Renamed meanwhile')::text, '... the entry is as it was');
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0001');
select is(public.cancel_approval(pg_temp.id('a_upd')), 'cancelled', 'the maker withdraws the stale request');
insert into ids values ('a_del', public.submit_approval('academic_calendar_change', pg_temp.id('a_hol'), '{"op": "delete"}'));
reset role;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0004');
select is(public.decide_approval(pg_temp.id('a_del'), 'approved',
            (select payload_hash from public.approval_requests where id = pg_temp.id('a_del'))), 'executed',
  'a checker with academic_calendar:approve only approves a removal');
reset role;
select is((select count(*)::integer from public.school_calendar_entries where id = pg_temp.id('a_hol')), 0, '... the entry is removed');
select is((select version from public.school_calendars where id = pg_temp.cal('0000000d-0000-0000-0000-00000000000a')), 3, '... version 3');

-- ========================================================= second line ==
-- A definer function (current_user owner, role authenticated) that skips the
-- approval is refused by the guards.
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0001');
select throws_ok(format($$ select pg_temp.rogue(%L) $$, format(
  'insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n) values (%L, %L, %L, %L, %L, %L)',
  '0000000d-0000-0000-0000-00000000000a', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), 'school_holiday',
  pg_temp.ec(6, 2), pg_temp.ec(6, 2), '{"en": "rogue"}')), '42501', 'approval_required',
  'a definer function cannot add to a published calendar without an approval');
select throws_ok(format($$ select pg_temp.rogue(%L) $$, format(
  'update public.school_calendars set version = version + 1 where id = %L', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'))),
  '42501', 'approval_required', '... or change the published calendar itself');
select throws_ok(format($$ select pg_temp.rogue(%L) $$, format(
  'update public.school_calendars set status = %L, published_at = now() where id = %L', 'published', pg_temp.cal('0000000d-0000-0000-0000-00000000000b'))),
  '42501', 'approval_required', '... or publish a draft');
select throws_ok(format($$ select pg_temp.rogue(%L) $$, format(
  'update public.school_calendars set status = %L, closed_at = now() where id = %L', 'closed', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'))),
  '42501', 'approval_required', '... or close a calendar');
reset role;

-- ============================================================= year close ==
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0001');
insert into ids values ('a_late', public.submit_approval('academic_calendar_change', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'),
  jsonb_build_object('op', 'add', 'day_type_code', 'parent_meeting', 'starts_on', pg_temp.ec(6, 5), 'ends_on', pg_temp.ec(6, 5),
                     'name_i18n', '{"en": "Late meeting"}'::jsonb)));
reset role;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000b0001');
select is(public.cancel_approval(pg_temp.id('b_pub')), 'cancelled', 'B withdraws its stale publish request');
insert into ids values ('b_pub2', public.submit_approval('academic_calendar_publish', pg_temp.cal('0000000d-0000-0000-0000-00000000000b')));
reset role;
insert into public.academic_years (tenant_id, ec_year, label_i18n, starts_on, ends_on, status) values
  ('0000000d-0000-0000-0000-00000000000a', pg_temp.y(), '{"en": "A year"}', pg_temp.ec(1, 1), pg_temp.ec(10, 30), 'active'),
  ('0000000d-0000-0000-0000-00000000000b', pg_temp.y(), '{"en": "B year"}', pg_temp.ec(1, 1), pg_temp.ec(10, 30), 'active');
update public.academic_years set status = 'closed'
 where tenant_id in ('0000000d-0000-0000-0000-00000000000a', '0000000d-0000-0000-0000-00000000000b') and ec_year = pg_temp.y();
select is((select row(status, closed_at is not null)::text from public.school_calendars where id = pg_temp.cal('0000000d-0000-0000-0000-00000000000a')),
  '(closed,t)', 'closing the academic year closes its published calendar');
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0002');
select throws_ok(format($$ select public.decide_approval(%L, 'approved', %L) $$, pg_temp.id('a_late'),
  (select payload_hash from public.approval_requests where id = pg_temp.id('a_late'))), '40001', 'entity_changed',
  'a change still waiting when the year closed cannot be approved');
reset role;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0001');
select throws_ok($$ select public.submit_approval('academic_calendar_change', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'),
  '{"op": "add", "day_type_code": "school_holiday", "starts_on": "2000-01-01", "ends_on": "2000-01-01", "name_i18n": {"en": "x"}}') $$,
  '42501', 'calendar_closed', 'no change is asked of a closed calendar');
reset role;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000b0001');
select throws_ok($$ select public.save_school_calendar_entry(pg_temp.cal('0000000d-0000-0000-0000-00000000000b'), null,
  'school_holiday', pg_temp.ec(2, 15), pg_temp.ec(2, 15), '{"en": "x"}') $$, '42501', 'calendar_closed',
  'a draft whose year has closed is not edited');
reset role;
select pg_temp.act_as('0000000d-0000-0000-0000-0000000b0002');
select throws_ok(format($$ select public.decide_approval(%L, 'approved', %L) $$, pg_temp.id('b_pub2'),
  (select payload_hash from public.approval_requests where id = pg_temp.id('b_pub2'))), '40001', 'entity_changed',
  '... nor published by a request made before the year closed');
reset role;
select is((select status from public.school_calendars where id = pg_temp.cal('0000000d-0000-0000-0000-00000000000b')), 'draft',
  '... (it was never published, so it stays a draft)');
select throws_ok(format($$ update public.school_calendars set weekend_days = '{7}' where id = %L $$, pg_temp.cal('0000000d-0000-0000-0000-00000000000a')),
  '42501', 'calendar_closed', 'a closed calendar never changes, not even for the platform');
select throws_ok(format($$ insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n)
  values (%L, %L, 'school_holiday', %L, %L, '{"en": "late"}') $$, '0000000d-0000-0000-0000-00000000000a',
  pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), pg_temp.ec(6, 9), pg_temp.ec(6, 9)),
  '42501', 'calendar_closed', '... nor do its entries');
select pg_temp.act_as('0000000d-0000-0000-0000-0000000a0001');
select set_config('timhirt.calendar_change', 'approved', true);
select throws_ok(format($$ select pg_temp.rogue(%L) $$, format(
  'insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n) values (%L, %L, %L, %L, %L, %L)',
  '0000000d-0000-0000-0000-00000000000a', pg_temp.cal('0000000d-0000-0000-0000-00000000000a'), 'school_holiday',
  pg_temp.ec(6, 9), pg_temp.ec(6, 9), '{"en": "rogue"}')), '42501', 'calendar_closed',
  '... even for a definer function holding the approval flag');
select set_config('timhirt.calendar_change', '', true);
reset role;

select * from finish();
rollback;
