-- ============================================================================
-- Academic Calendar Engine, slice 1 (20261008000001_academic_calendar_engine):
-- the MoE 2019 golden sheet, MoE → Region → School resolution, locked dates,
-- Choose Calendar, closed calendars, tenant isolation and the module gate.
-- Runs in the current EC year (the engine accepts the current year ± 1), with
-- its own regional calendar, so it does not depend on the 2019 seed except
-- for the golden-sheet assertions.
-- ============================================================================
begin;
select plan(37);

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

-- ============================================================ golden sheet ==
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

-- ================================================================ layers ==
select pg_temp.act_as('0000000c-0000-0000-0000-0000000a0001');
select is((select count(*)::integer from public.authority_calendars where ec_year = 2030), 0,
  'an authority''s draft is invisible to a school');
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

-- ======================================================= tenant isolation ==
select pg_temp.act_as('0000000c-0000-0000-0000-0000000b0001');
select is((select count(*)::integer from public.school_calendars), 0, 'school B sees none of school A''s calendars');
select is((select count(*)::integer from public.effective_calendar_entries(pg_temp.y(), '0000000c-0000-0000-0000-00000000000a')
            where level in ('school', 'region')), 0,
  'asking for school A''s calendar shows B neither A''s entries nor A''s region');
select lives_ok($$ select public.create_school_calendar(pg_temp.y(), 'moe') $$, 'school B chooses its own calendar');
select is((select count(*)::integer from public.school_calendars), 1, '... and sees only its own');
reset role;

-- ============================================================ module gate ==
insert into public.school_calendars (tenant_id, ec_year, origin, status)
values ('0000000c-0000-0000-0000-00000000000c', pg_temp.y(), 'moe', 'published');
select pg_temp.act_as('0000000c-0000-0000-0000-0000000c0001');
select is((select count(*)::integer from public.school_calendars), 0, 'without the events module a school reads no calendar');
select throws_ok($$ select public.create_school_calendar(pg_temp.y() + 1, 'moe') $$, '42501', 'not_allowed',
  '... and cannot choose one');
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
create temp table copy_result (r jsonb);
grant all on copy_result to authenticated;
select pg_temp.act_as('0000000c-0000-0000-0000-0000000b0001');
insert into copy_result select public.create_school_calendar(pg_temp.y(), 'previous_year');
reset role;
select is((select (r ->> 'copied')::integer from copy_result), 1, 'one entry copied from last year');
select is((select r -> 'dropped' -> 0 ->> 'reason' from copy_result), 'locked_date', 'the one landing on a locked date is dropped and reported');
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

select * from finish();
rollback;
