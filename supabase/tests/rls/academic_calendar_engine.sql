-- ============================================================================
-- Academic Calendar Engine, slice 1 (20261008000001_academic_calendar_engine):
-- the MoE 2019 golden sheet, MoE → Region → School resolution, locked dates,
-- Choose Calendar, closed calendars, tenant isolation and the module gate.
-- Runs in the current EC year (the engine accepts the current year ± 1), with
-- its own regional calendar, so it does not depend on the 2019 seed except
-- for the golden-sheet assertions.
-- ============================================================================
begin;
select plan(76);

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

insert into auth.users (id, email) values
  ('0000000c-0000-0000-0000-0000000a0001', 'ce-admin-a@example.test'),
  ('0000000c-0000-0000-0000-0000000a0002', 'ce-teacher-a@example.test'),
  ('0000000c-0000-0000-0000-0000000b0001', 'ce-admin-b@example.test'),
  ('0000000c-0000-0000-0000-0000000c0001', 'ce-admin-c@example.test');
insert into public.tenants (id, name, slug, status, tier_key, edu_authority_id) values
  ('0000000c-0000-0000-0000-00000000000a', 'CE School A (Oromia)', 'ce-a', 'active', 'premium',
   (select id from public.edu_authorities where code = 'OR')),
  ('0000000c-0000-0000-0000-00000000000b', 'CE School B (MoE)', 'ce-b', 'active', 'premium', null),
  ('0000000c-0000-0000-0000-00000000000c', 'CE School C (no events module)', 'ce-c', 'active', 'basic', null);
insert into public.users (id, tenant_id, role, full_name, email) values
  ('0000000c-0000-0000-0000-0000000a0001', '0000000c-0000-0000-0000-00000000000a', 'school_admin', 'CE Admin A', 'ce-admin-a@example.test'),
  ('0000000c-0000-0000-0000-0000000a0002', '0000000c-0000-0000-0000-00000000000a', 'teacher', 'CE Teacher A', 'ce-teacher-a@example.test'),
  ('0000000c-0000-0000-0000-0000000b0001', '0000000c-0000-0000-0000-00000000000b', 'school_admin', 'CE Admin B', 'ce-admin-b@example.test'),
  ('0000000c-0000-0000-0000-0000000c0001', '0000000c-0000-0000-0000-00000000000c', 'school_admin', 'CE Admin C', 'ce-admin-c@example.test');

-- ============================================================ golden sheet ==
-- First, before any fixture adds a calendar for the current year: from
-- 2020 EC on, that calendar's lead-in would claim 2019's Nehase (CAL-DB2-01).
select is((select string_agg(n::text, ',' order by ord) from (
             select 0 as ord, public.instructional_days(public.ec_to_gregorian(2018, 12, 25), public.ec_to_gregorian(2018, 13, 5)) as n
             union all
             select m, public.instructional_days(public.ec_to_gregorian(2019, m, 1), public.ec_to_gregorian(2019, m, 30))
               from generate_series(1, 12) m) x),
  '9,20,21,22,21,14,20,22,19,21,21,0,0',
  'the MoE 2019 EC sheet: ድምር per row, exactly as published');
select is(public.instructional_days(public.ec_to_gregorian(2018, 12, 25), public.ec_to_gregorian(2019, 10, 30)), 210,
  '... 210 school days in the year');
select is((select row(day_type_code, counts, blocks_student_attendance, blocks_staff_attendance)::text
             from public.calendar_day_status(public.ec_to_gregorian(2019, 5, 25))),
  '(semester_break,f,t,f)', 'a semester-break day blocks students, not staff, and is not a school day');
select is((select row(day_type_code, counts)::text from public.calendar_day_status(public.ec_to_gregorian(2019, 5, 22))),
  '(examination,f)', 'an exam on a Saturday shows as an exam but does not count (same as the grid engine)');
select is((select row(ec_year, ec_month, ec_day)::text from public.gregorian_to_ec('2026-09-11')), '(2019,1,1)',
  'SQL EC conversion: 2026-09-11 is Meskerem 1, 2019');
select is(public.ec_to_gregorian(2019, 13, 6), '2027-09-11'::date, 'SQL EC conversion: Pagume 6 of a leap year');
-- Precedence (CAL-TV-04), as in grid.ts: a holiday beats a break, and a
-- school holiday (Parents' Day) beats the closing milestone on Sene 30.
select is((select day_type_code from public.calendar_day_status(public.ec_to_gregorian(2019, 10, 30))), 'school_holiday',
  'Parents'' Day (school holiday) outranks the closing milestone on Sene 30, 2019');
insert into public.authority_calendar_entries (calendar_id, day_type_code, starts_on, ends_on, name_i18n)
select c.id, 'national_holiday', public.ec_to_gregorian(2019, 5, 26), public.ec_to_gregorian(2019, 5, 26), '{"en": "Probe holiday"}'
  from public.authority_calendars c join public.edu_authorities a on a.id = c.authority_id where a.code = 'MOE' and c.ec_year = 2019;
select is((select day_type_code from public.calendar_day_status(public.ec_to_gregorian(2019, 5, 26))), 'national_holiday',
  'a holiday inside the semester break shows as the holiday');
-- calendar_days refuses a window outside its range (CAL-SEC-04, CAL-TV-09).
select throws_ok($$ select count(*) from public.calendar_days('1899-12-31', '1900-01-05') $$, '22023', 'invalid_range',
  'calendar_days refuses a date before 1900');
select throws_ok($$ select count(*) from public.calendar_days('2026-01-01', '2026-01-01'::date + 401) $$, '22023', 'invalid_range',
  '... and a window longer than 400 days');

-- The MoE calendar for the current year (2019 is seeded; another year gets a
-- minimal one) and an Oromia calendar with one locked and two unlocked entries.
insert into public.authority_calendars (authority_id, ec_year, session_starts_on, session_ends_on, status, published_at)
select (select id from public.edu_authorities where code = 'MOE'), pg_temp.y(), pg_temp.ec(12, 25, -1), pg_temp.ec(10, 30), 'published', now()
where not exists (select 1 from public.authority_calendars c join public.edu_authorities a on a.id = c.authority_id
                  where a.code = 'MOE' and c.ec_year = pg_temp.y());
insert into public.authority_calendar_entries (calendar_id, day_type_code, starts_on, ends_on, name_i18n)
select c.id, 'national_holiday', pg_temp.ec(1, 1), pg_temp.ec(1, 1), '{"en": "Enkutatash"}'
  from public.authority_calendars c join public.edu_authorities a on a.id = c.authority_id
 where a.code = 'MOE' and c.ec_year = pg_temp.y()
   and not exists (select 1 from public.authority_calendar_entries e where e.calendar_id = c.id and e.starts_on = pg_temp.ec(1, 1));
insert into public.authority_calendars (id, authority_id, ec_year, session_starts_on, session_ends_on, status, published_at)
values ('0000000c-0000-0000-0001-000000000001', (select id from public.edu_authorities where code = 'OR'), pg_temp.y(),
        pg_temp.ec(12, 25, -1), pg_temp.ec(10, 30), 'published', now());
insert into public.authority_calendar_entries (id, calendar_id, day_type_code, starts_on, ends_on, name_i18n) values
  ('0000000c-0000-0000-0002-000000000001', '0000000c-0000-0000-0001-000000000001', 'regional_holiday', pg_temp.ec(3, 10), pg_temp.ec(3, 10), '{"en": "R holiday"}'),
  ('0000000c-0000-0000-0002-000000000002', '0000000c-0000-0000-0001-000000000001', 'mid_term_break',   pg_temp.ec(3, 20), pg_temp.ec(3, 24), '{"en": "R mid-term"}'),
  ('0000000c-0000-0000-0002-000000000003', '0000000c-0000-0000-0001-000000000001', 'parent_meeting',   pg_temp.ec(4, 5),  pg_temp.ec(4, 5),  '{"en": "R parents"}');
-- An authority draft for a far year: not visible to schools.
insert into public.authority_calendars (authority_id, ec_year, session_starts_on, session_ends_on)
values ((select id from public.edu_authorities where code = 'MOE'), 2030, '2037-08-31', '2038-07-07');
insert into public.authority_calendar_entries (calendar_id, day_type_code, starts_on, ends_on, name_i18n)
select c.id, 'national_holiday', '2037-09-20', '2037-09-20', '{"en": "Draft holiday"}' from public.authority_calendars c where c.ec_year = 2030;
select is((select count(*)::integer from public.authority_calendar_entries where starts_on = '2037-09-20'), 1,
  'the authority draft holds an entry (so the next probe is not vacuous)');

-- ================================================================ layers ==
select pg_temp.act_as('0000000c-0000-0000-0000-0000000a0001');
select is((select count(*)::integer from public.authority_calendars where ec_year = 2030), 0,
  'an authority''s draft is invisible to a school');
select is((select count(*)::integer from public.authority_calendar_entries where starts_on = '2037-09-20'), 0,
  '... and so are its entries (CAL-TV-02)');
select is((select count(*)::integer from public.effective_calendar_entries(pg_temp.y()) where level = 'region'), 3,
  'school A (Oromia) inherits its regional bureau''s entries live');
select ok((select bool_and(locked) from public.effective_calendar_entries(pg_temp.y()) where day_type_code = 'regional_holiday'),
  'a regional holiday is locked when the bureau enters it');
reset role;

-- ======================================================= Choose Calendar ==
select pg_temp.act_as('0000000c-0000-0000-0000-0000000a0002');
select throws_ok($$ select public.create_school_calendar(pg_temp.y(), 'moe') $$, '42501', 'not_allowed',
  'a teacher cannot choose the school''s calendar');
reset role;
select pg_temp.act_as('0000000c-0000-0000-0000-0000000a0001');
select throws_ok($$ select public.create_school_calendar(pg_temp.y(), 'other') $$, '22023', 'invalid_origin', 'unknown origin refused');
select throws_ok($$ select public.create_school_calendar(pg_temp.y() + 5, 'moe') $$, '22023', 'invalid_year', 'a far year refused');
select throws_ok($$ select public.create_school_calendar(pg_temp.y(), 'previous_year') $$, '22023', 'no_previous_calendar',
  '"Use Previous School Calendar" needs a published calendar for last year');
select lives_ok($$ select public.create_school_calendar(pg_temp.y(), 'moe') $$, '"Use MoE Calendar" creates a draft');
select is((select count(*)::integer from public.school_calendars), 1, 'the admin sees the draft');
reset role;
select pg_temp.act_as('0000000c-0000-0000-0000-0000000a0002');
select is((select count(*)::integer from public.school_calendars), 0, 'a teacher does not see the draft');
reset role;

-- "Create Custom Calendar": a draft may be recreated; unlocked national and
-- regional items are removed, locked ones stay.
select pg_temp.act_as('0000000c-0000-0000-0000-0000000a0001');
select lives_ok($$ select public.create_school_calendar(pg_temp.y(), 'custom') $$, 'the draft is recreated as a custom calendar');
select is((select count(*)::integer from public.effective_calendar_entries(pg_temp.y()) where level <> 'school' and not locked), 0,
  'a custom calendar keeps no unlocked MoE or regional item');
select ok(exists (select 1 from public.effective_calendar_entries(pg_temp.y()) where name_i18n ->> 'en' = 'R holiday'),
  '... but keeps the locked regional holiday');
select throws_ok($$ insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n)
                    select tenant_id, id, 'school_holiday', pg_temp.ec(2, 2), pg_temp.ec(2, 2), '{"en": "x"}' from public.school_calendars $$,
  '42501', null, 'no client writes school entries directly in this slice');
reset role;

-- Locks hold whatever the writer (here the table owner, as a future RPC would).
select throws_ok($$ insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n, overrides_entry_id, suppressed)
                    select tenant_id, id, 'regional_holiday', pg_temp.ec(3, 10), pg_temp.ec(3, 10), '{"en": "x"}', '0000000c-0000-0000-0002-000000000001', true
                      from public.school_calendars where tenant_id = '0000000c-0000-0000-0000-00000000000a' $$,
  '42501', 'calendar_entry_locked', 'a school cannot remove a locked regional holiday');
select throws_ok($$ insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n)
                    select tenant_id, id, 'national_holiday', pg_temp.ec(2, 2), pg_temp.ec(2, 2), '{"en": "x"}'
                      from public.school_calendars where tenant_id = '0000000c-0000-0000-0000-00000000000a' $$,
  '22023', 'invalid_day_type', 'a school cannot declare a national holiday');
select throws_ok($$ insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n)
                    select '0000000c-0000-0000-0000-00000000000b', id, 'school_holiday', pg_temp.ec(2, 2), pg_temp.ec(2, 2), '{"en": "x"}'
                      from public.school_calendars where tenant_id = '0000000c-0000-0000-0000-00000000000a' $$,
  '22023', 'invalid_calendar', 'an entry naming another school is refused, not silently re-homed (CAL-TI-1)');

-- A user granted only academic_calendar:create cannot see the draft, so may
-- not discard it by recreating it (CAL-SEC-01).
insert into public.user_permission_overrides (tenant_id, user_id, permission_id, granted)
select '0000000c-0000-0000-0000-00000000000a', '0000000c-0000-0000-0000-0000000a0002', id, true
  from public.permissions where key = 'academic_calendar:create';
select pg_temp.act_as('0000000c-0000-0000-0000-0000000a0002');
select throws_ok($$ select public.create_school_calendar(pg_temp.y(), 'moe') $$, '23505', 'calendar_exists',
  'create without update cannot recreate an existing draft');
reset role;
select is((select origin from public.school_calendars where tenant_id = '0000000c-0000-0000-0000-00000000000a'), 'custom',
  '... and the draft is untouched');
-- School entries follow their calendar (CAL-TV-01): A's custom draft holds
-- suppression rows; only someone who may edit the draft reads them, and no
-- other school ever does.
select ok((select count(*) from public.school_calendar_entries where tenant_id = '0000000c-0000-0000-0000-00000000000a') > 0,
  'the custom draft holds entries (so the next probes are not vacuous)');
select pg_temp.act_as('0000000c-0000-0000-0000-0000000a0002');
select is((select count(*)::integer from public.school_calendar_entries), 0, 'a teacher reads none of a draft''s entries');
reset role;
select pg_temp.act_as('0000000c-0000-0000-0000-0000000a0001');
select ok((select count(*) from public.school_calendar_entries) > 0, '... the admin reads them');
reset role;
select pg_temp.act_as('0000000c-0000-0000-0000-0000000b0001');
select is((select count(*)::integer from public.school_calendar_entries), 0, 'school B reads none of school A''s entries');
reset role;

-- ======================================================= tenant isolation ==
select pg_temp.act_as('0000000c-0000-0000-0000-0000000b0001');
select is((select count(*)::integer from public.school_calendars), 0, 'school B sees none of school A''s calendars');
select throws_ok($$ select count(*) from public.effective_calendar_entries(pg_temp.y(), '0000000c-0000-0000-0000-00000000000a') $$,
  '42501', 'not_allowed', 'B cannot ask for school A''s calendar');
select throws_ok($$ select count(*) from public.calendar_days(pg_temp.ec(1, 1), pg_temp.ec(1, 30), '0000000c-0000-0000-0000-00000000000a') $$,
  '42501', 'not_allowed', '... nor for A''s days (CAL-TI-3)');
select throws_ok($$ select public.instructional_days(pg_temp.ec(1, 1), pg_temp.ec(1, 30), '0000000c-0000-0000-0000-00000000000a') $$,
  '42501', 'not_allowed', '... nor for A''s school-day count');
select lives_ok($$ select public.create_school_calendar(pg_temp.y(), 'moe') $$, 'school B chooses its own calendar');
select is((select count(*)::integer from public.school_calendars), 1, '... and sees only its own');
select lives_ok($$ select public.create_school_calendar(pg_temp.y() + 1, 'moe') $$, 'school B drafts next year, which no authority has published');
reset role;
-- With no published layer for that year, nothing is a valid override target
-- (CAL-SEC-02: the check used to be NULL and let it through).
select throws_ok($$ insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n, overrides_entry_id, suppressed)
                    select tenant_id, id, 'mid_term_break', pg_temp.ec(3, 20, 1), pg_temp.ec(3, 24, 1), '{"en": "x"}', '0000000c-0000-0000-0002-000000000002', true
                      from public.school_calendars where tenant_id = '0000000c-0000-0000-0000-00000000000b' and ec_year = pg_temp.y() + 1 $$,
  '22023', 'invalid_override', 'an override of an entry outside the school''s published layers is refused');

-- ============================================================ module gate ==
insert into public.school_calendars (tenant_id, ec_year, origin, status, published_at)
values ('0000000c-0000-0000-0000-00000000000c', pg_temp.y(), 'moe', 'published', now());
select pg_temp.act_as('0000000c-0000-0000-0000-0000000c0001');
select is((select count(*)::integer from public.school_calendars), 0, 'without the events module a school reads no calendar');
select throws_ok($$ select public.create_school_calendar(pg_temp.y() + 1, 'moe') $$, '42501', 'not_allowed',
  '... and cannot choose one');
reset role;
insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n)
select tenant_id, id, 'school_holiday', pg_temp.ec(2, 2), pg_temp.ec(2, 2), '{"en": "C day"}' from public.school_calendars where tenant_id = '0000000c-0000-0000-0000-00000000000c';
select pg_temp.act_as('0000000c-0000-0000-0000-0000000c0001');
select is((select count(*)::integer from public.school_calendar_entries), 0, '... nor its entries (module gate on entries)');
reset role;

-- ================================================== publish, exists, close ==
update public.school_calendars set status = 'published', published_at = now()
 where tenant_id = '0000000c-0000-0000-0000-00000000000a';
select pg_temp.act_as('0000000c-0000-0000-0000-0000000a0002');
select is((select count(*)::integer from public.school_calendars), 1, 'a published calendar is visible to the whole school');
reset role;
select pg_temp.act_as('0000000c-0000-0000-0000-0000000a0001');
select throws_ok($$ select public.create_school_calendar(pg_temp.y(), 'moe') $$, '23505', 'calendar_exists',
  'a published calendar cannot be recreated');
reset role;
update public.school_calendars set status = 'closed', closed_at = now()
 where tenant_id = '0000000c-0000-0000-0000-00000000000a';
select throws_ok($$ insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n)
                    select tenant_id, id, 'school_holiday', pg_temp.ec(2, 2), pg_temp.ec(2, 2), '{"en": "x"}'
                      from public.school_calendars where tenant_id = '0000000c-0000-0000-0000-00000000000a' $$,
  '42501', 'calendar_closed', 'a closed calendar takes no new entry');
select throws_ok($$ update public.school_calendars set weekend_days = '{7}' where tenant_id = '0000000c-0000-0000-0000-00000000000a' $$,
  '42501', 'calendar_closed', '... and does not change');

-- ============================================ "Use Previous School Calendar" ==
-- Last year's school B calendar: a parents' meeting is copied to the same EC
-- date; a school holiday that now lands on Enkutatash (locked) is dropped.
insert into public.school_calendars (id, tenant_id, ec_year, origin, status, published_at)
values ('0000000c-0000-0000-0003-000000000001', '0000000c-0000-0000-0000-00000000000b', pg_temp.y() - 1, 'moe', 'published', now());
insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n) values
  ('0000000c-0000-0000-0000-00000000000b', '0000000c-0000-0000-0003-000000000001', 'parent_meeting', pg_temp.ec(4, 5, -1), pg_temp.ec(4, 5, -1), '{"en": "Parents"}'),
  ('0000000c-0000-0000-0000-00000000000b', '0000000c-0000-0000-0003-000000000001', 'school_holiday', pg_temp.ec(1, 1, -1), pg_temp.ec(1, 1, -1), '{"en": "Founders"}');
-- A row the guard would refuse today (as a legacy or hand-fixed row could
-- be): its copy lands outside this year's window and is left out, rather
-- than aborting the whole copy (CAL-TV-12).
alter table public.school_calendar_entries disable trigger school_calendar_entries_guard;
insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n) values
  ('0000000c-0000-0000-0000-00000000000b', '0000000c-0000-0000-0003-000000000001', 'school_holiday', pg_temp.ec(1, 1, -1) - 200, pg_temp.ec(1, 1, -1) - 200, '{"en": "Old"}');
alter table public.school_calendar_entries enable trigger school_calendar_entries_guard;
create temp table copy_result (r jsonb);
grant all on copy_result to authenticated;
select pg_temp.act_as('0000000c-0000-0000-0000-0000000b0001');
insert into copy_result select public.create_school_calendar(pg_temp.y(), 'previous_year');
reset role;
select is((select (r ->> 'copied')::integer from copy_result), 1, 'one entry copied from last year');
select is((select string_agg(d ->> 'reason', ',' order by d ->> 'reason') from copy_result, jsonb_array_elements(r -> 'dropped') d),
  'locked_date,outside_year', 'one landing on a locked date and one outside the year are dropped and reported, not an error');
select ok(exists (select 1 from public.school_calendar_entries e join public.school_calendars c on c.id = e.calendar_id
                   where c.tenant_id = '0000000c-0000-0000-0000-00000000000b' and c.ec_year = pg_temp.y()
                     and e.starts_on = pg_temp.ec(4, 5)),
  'the copy keeps the EC month and day');

-- ============================================================ settings ==
select is(public.normalize_calendar_settings('{"calendar": {"hijri_holidays": "yes"}}') #> '{calendar,hijri_holidays}', 'false'::jsonb,
  'the optional Hijri holidays flag is a strict boolean (junk is off)');
select ok(not has_function_privilege('anon', 'public.effective_calendar_entries(integer, uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.create_school_calendar(integer, text)', 'EXECUTE'),
  'anon reaches no calendar function');

-- ===================================================== CHECKs (CAL-DB-05) ==
select throws_ok($$ insert into public.holiday_rules (code, kind, params, day_type_code, name_i18n)
                    values ('x_rule', 'ec_fixed', '{}', 'national_holiday', '{"en": "x"}') $$,
  '23514', null, 'a holiday rule without a month and day is refused (NULL does not pass the CHECK)');
select throws_ok($$ insert into public.holiday_rules (code, kind, params, day_type_code, name_i18n)
                    values ('x_rule', 'ec_fixed', '{"month": 13, "day": 30}', 'national_holiday', '{"en": "x"}') $$,
  '23514', null, '... nor Pagume 30');
select throws_ok($$ insert into public.authority_calendars (authority_id, ec_year, weekend_days, session_starts_on, session_ends_on)
                    values ((select id from public.edu_authorities where code = 'AA'), 2031, '{6,6}', '2038-09-01', '2039-07-01') $$,
  '23514', null, 'a weekend listing a day twice is refused');
select throws_ok($$ insert into public.authority_calendars (authority_id, ec_year, session_starts_on, session_ends_on)
                    values ((select id from public.edu_authorities where code = 'AA'), 2050, '2037-09-01', '2038-07-01') $$,
  '22023', 'invalid_range', 'a session outside its EC year is refused');
select throws_ok($$ insert into public.authority_calendars (authority_id, ec_year, session_starts_on, session_ends_on)
                    values ((select id from public.edu_authorities where code = 'AA'), 2025, '2031-09-06', '2032-07-08') $$,
  '22023', 'invalid_range', '... including one inside the right Gregorian years but in another EC year (CAL-DB2-03)');
select throws_ok($$ insert into public.authority_calendar_entries (calendar_id, day_type_code, starts_on, ends_on, name_i18n)
                    select c.id, 'regional_holiday', '2000-01-01', '2000-01-01', '{"en": "x"}'
                      from public.authority_calendars c where c.id = '0000000c-0000-0000-0001-000000000001' $$,
  '22023', 'invalid_range', 'an authority entry far outside its calendar''s year is refused');

-- ==================================== one day, one answer (CAL-DB-03/04) ==
-- Hamle 15 of last year has no session (after last year's Sene, before this
-- year's Nehase lead-in; for every year, the 2019 seed included, CAL-DB3-01):
-- alone or inside a window reaching this year's session, it is "session
-- unknown".
select ok((select in_session from public.calendar_day_status(pg_temp.ec(11, 15, -1))) is null
          and (select in_session from public.calendar_days(pg_temp.ec(11, 15, -1), pg_temp.ec(11, 15, -1) + 400)
                where day = pg_temp.ec(11, 15, -1)) is null,
  'a day''s session status does not depend on the window it is asked in');
-- Last year's school entries do not reach into this year's session (its
-- lead-in starts in last year's Nehase), as in the grid.
create temp table leadin as select public.instructional_days(pg_temp.ec(12, 25, -1), pg_temp.ec(12, 30, -1), '0000000c-0000-0000-0000-00000000000b') as n;
insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n) values
  ('0000000c-0000-0000-0000-00000000000b', '0000000c-0000-0000-0003-000000000001', 'registration', pg_temp.ec(12, 25, -1), pg_temp.ec(12, 30, -1), '{"en": "Registration"}');
select is(public.instructional_days(pg_temp.ec(12, 25, -1), pg_temp.ec(12, 30, -1), '0000000c-0000-0000-0000-00000000000b'), (select n from leadin),
  'a day in this year''s session counts by this year''s entries only');

-- Owner, 2026-10-09: follow the MoE. Ginbot 20 is a school day, so no rule
-- generates it.
select is((select count(*)::integer from public.holiday_rules
            where kind = 'ec_fixed' and (params ->> 'month')::int = 9 and (params ->> 'day')::int = 20), 0,
  'Ginbot 20 is not a national holiday rule (the MoE counts it as a school day)');

-- ====================================== authority guards (CAL-TV-03) ==
-- As the table owner, as a future platform RPC would write.
select throws_ok($c$ insert into public.authority_calendar_entries (calendar_id, day_type_code, starts_on, ends_on, name_i18n, overrides_entry_id, suppressed)
                     select '0000000c-0000-0000-0001-000000000001', 'regional_holiday', e.starts_on, e.ends_on, '{"en": "x"}', e.id, true
                       from public.authority_calendar_entries e join public.authority_calendars c on c.id = e.calendar_id
                       join public.edu_authorities a on a.id = c.authority_id
                      where a.code = 'MOE' and c.ec_year = pg_temp.y() and e.locked limit 1 $c$,
  '42501', 'calendar_entry_locked', 'a regional bureau cannot remove a locked MoE entry');
select throws_ok($c$ insert into public.authority_calendar_entries (calendar_id, day_type_code, starts_on, ends_on, name_i18n, overrides_entry_id, suppressed)
                     values ('0000000c-0000-0000-0001-000000000001', 'mid_term_break', pg_temp.ec(3, 20), pg_temp.ec(3, 24), '{"en": "x"}',
                             '0000000c-0000-0000-0002-000000000002', true) $c$,
  '22023', 'invalid_override', 'a regional override must target the MoE calendar of the same year');
select throws_ok($c$ update public.authority_calendars set ec_year = 2031, session_starts_on = '2038-08-31', session_ends_on = '2039-07-07'
                      where ec_year = 2030 $c$,
  '22023', 'invalid_range', 'an authority calendar''s year never changes, even with a matching session (CAL-DB3-04)');
update public.authority_calendars set status = 'closed', closed_at = now() where id = '0000000c-0000-0000-0001-000000000001';
select throws_ok($c$ insert into public.authority_calendar_entries (calendar_id, day_type_code, starts_on, ends_on, name_i18n)
                     values ('0000000c-0000-0000-0001-000000000001', 'regional_holiday', pg_temp.ec(2, 2), pg_temp.ec(2, 2), '{"en": "x"}') $c$,
  '42501', 'calendar_closed', 'a closed authority calendar takes no new entry');
select throws_ok($c$ update public.authority_calendar_entries set name_i18n = '{"en": "y"}' where id = '0000000c-0000-0000-0002-000000000003' $c$,
  '42501', 'calendar_closed', '... changes no entry');
select throws_ok($c$ delete from public.authority_calendar_entries where id = '0000000c-0000-0000-0002-000000000003' $c$,
  '42501', 'calendar_closed', '... deletes no entry');
select throws_ok($c$ update public.authority_calendars set weekend_days = '{7}' where id = '0000000c-0000-0000-0001-000000000001' $c$,
  '42501', 'calendar_closed', '... and does not change itself');

-- ================================ school entry limits (CAL-TV-10) ==
select throws_ok($c$ insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n)
                     select tenant_id, id, 'school_holiday', pg_temp.ec(1, 1, 1) - 61, pg_temp.ec(1, 1, 1) - 61, '{"en": "x"}'
                       from public.school_calendars where tenant_id = '0000000c-0000-0000-0000-00000000000b' and ec_year = pg_temp.y() + 1 $c$,
  '22023', 'invalid_range', 'a school entry more than 60 days before its year is refused');
insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n)
select c.tenant_id, c.id, 'school_holiday', pg_temp.ec(2, 1, 1), pg_temp.ec(2, 1, 1), jsonb_build_object('en', 'n' || g)
  from public.school_calendars c, generate_series(1, 500 - (select count(*)::integer from public.school_calendar_entries e
                                                           join public.school_calendars c2 on c2.id = e.calendar_id
                                                          where c2.tenant_id = '0000000c-0000-0000-0000-00000000000b' and c2.ec_year = pg_temp.y() + 1)) g
 where c.tenant_id = '0000000c-0000-0000-0000-00000000000b' and c.ec_year = pg_temp.y() + 1;
select throws_ok($c$ insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n)
                     select tenant_id, id, 'school_holiday', pg_temp.ec(2, 2, 1), pg_temp.ec(2, 2, 1), '{"en": "x"}'
                       from public.school_calendars where tenant_id = '0000000c-0000-0000-0000-00000000000b' and ec_year = pg_temp.y() + 1 $c$,
  '22023', 'too_many_entries', '... and a calendar holds at most 500 entries');

-- ===================== a locked entry survives whatever the rows say (CAL-TV-13) ==
-- A suppression of a locked regional entry, written past the guard: the
-- read side still returns the locked entry.
alter table public.school_calendar_entries disable trigger school_calendar_entries_guard;
insert into public.school_calendar_entries (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n, overrides_entry_id, suppressed)
select tenant_id, id, 'regional_holiday', pg_temp.ec(3, 10), pg_temp.ec(3, 10), '{"en": "x"}', '0000000c-0000-0000-0002-000000000001', true
  from public.school_calendars where tenant_id = '0000000c-0000-0000-0000-00000000000a' and ec_year = pg_temp.y();
alter table public.school_calendar_entries enable trigger school_calendar_entries_guard;
select ok(exists (select 1 from public.effective_calendar_entries(pg_temp.y(), '0000000c-0000-0000-0000-00000000000a') where entry_id = '0000000c-0000-0000-0002-000000000001'),
  'a suppression row never removes a locked entry from the effective calendar');

-- ======== a school's own academic year counts only inside its EC year (CAL-DB3-03) ==
-- No authority has a calendar for y+3; school B's academic year is used,
-- unless it reaches into another year.
insert into public.academic_years (tenant_id, ec_year, starts_on, ends_on)
values ('0000000c-0000-0000-0000-00000000000b', pg_temp.y() + 3, pg_temp.ec(1, 1, 3), pg_temp.ec(13, 5, 3));
select is((select session_starts_on from public.calendar_year_settings(pg_temp.y() + 3, '0000000c-0000-0000-0000-00000000000b')), pg_temp.ec(1, 1, 3),
  'a school''s academic year inside its EC year is its session when no authority has one');
update public.academic_years set ends_on = pg_temp.ec(6, 1, 4) where tenant_id = '0000000c-0000-0000-0000-00000000000b' and ec_year = pg_temp.y() + 3;
select is((select session_starts_on from public.calendar_year_settings(pg_temp.y() + 3, '0000000c-0000-0000-0000-00000000000b')), null,
  '... and is ignored when it reaches into the next year');

select * from finish();
rollback;
