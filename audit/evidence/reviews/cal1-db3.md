REVIEWER: CAL-DB3 (database migration review, round 3)
WP: Academic Calendar Engine slice 1, at 6133b48 in the read-only worktree /home/user/rv-wp09. I reviewed the changes since c8a388d in these files:
- /home/user/rv-wp09/supabase/migrations/20261008000001_academic_calendar_engine.sql
- /home/user/rv-wp09/supabase/tests/rls/academic_calendar_engine.sql
- /home/user/rv-wp09/src/features/academic-calendar/grid.ts

VERDICT: PASS. CAL-DB2-01, CAL-DB2-02 (for the scenario I built in round 2) and CAL-DB2-03 are fixed, and I verified each by running it. I found no blocker or major issue. There are three new minor findings and two info items.

FINDINGS

CAL-DB3-01 (minor). Assertion 51 will fail CI for all of EC 2020 (2027-09-12 to 2028-09-10). It is the same kind of time bomb as CAL-DB2-01, and I missed it in round 2.
- Location: supabase/tests/rls/academic_calendar_engine.sql:251-254, "a day's session status does not depend on the window it is asked in".
- The assertion expects Meskerem 10 of last year (`pg_temp.ec(1,10,-1)`) to have no session. In EC 2020 that day is Meskerem 10, 2019 (2026-09-20), which lies inside the seeded MoE 2019 session (2026-08-31 to 2027-07-07). So `in_session` is `t`, not NULL.
- Evidence: I ran the suite with `pg_temp.y()` and `create_school_calendar`'s `v_now_year` both set to 2020, which is the only place the engine reads `now()`. Result: 52/53, `not ok 51`. With 2021, 2022, 2024 and 2025 it is 53/53. The c8a388d suite failed the same assertion under 2020 (its #49).
- Fix: use a day that no seeded session covers for any year, such as Hamle 15 of y-1 (between Sene 30 and the Nehase 25 lead-in). Alternatively, pick the probe year so that it is never 2019.

CAL-DB3-02 (minor). When two consecutive sessions overlap, the grid and SQL still disagree, and the new bounds allow that overlap.
- Location: grid.ts:125 (`iso >= nextSessionStartsOn && iso > sessionEndsOn`) against migration :596 (`order by s.y desc limit 1`, so the later year wins on overlap) and the guard at :412-417 (ends up to Pagume end of y, the next session starts from Nehase 1 of y).
- Evidence 1, which is the round-2 scenario now fixed: a MoE school, 2019 registration on Nehase 24-30, MoE 2020 lead-in from Nehase 25. Over 371 cells there are 0 differences between `buildYearGrid` (with `nextSessionStartsOn`) and `calendar_days`, and both totals are 210.
- Evidence 2, an overlapping scenario accepted by the guard: an Oromia school with OR 2019 session Nehase 25 2018 to Pagume 3 2019, and MoE 2020 starting Nehase 25 2019.
  - 9 differences on 2027-08-31 to 09-08. The grid shows them as this year's days (instructional/registration, counted); SQL puts them in ec_year 2020.
  - The grid total is 253; SQL counts 248 for 2019. The 2020 grid's lead-in counts the same days again.
- Same-authority overlap is accepted too: updating MoE 2019 to end on Pagume 5 and inserting MoE 2020 from Nehase 1 2019 both succeed.
- Only service_role writes authority calendars in slice 1, hence minor.
- Fix (either one): make the grid follow SQL (next_session whenever the next session covers the day, drop `iso > sessionEndsOn`), or refuse overlapping sessions when authoring, including the region-vs-MoE fallback, before slice 2.

CAL-DB3-03 (minor). The academic_years fallback session has no bounds, so a school can capture another year's days and drop a locked MoE holiday from the SQL answer.
- Location: migration :482-485 and :489-490 (`coalesce(..., v_year_from)`). academic_years has only `CHECK (starts_on < ends_on)`, and school admins can write it under RLS (`academic_years:create`).
- Evidence: acting as school admin A (MoE school, MoE 2019 and 2020 published, MoE 2020 locked national holiday on 2028-04-04):
  - `calendar_day_status('2028-04-04')` returned `(2028-04-04,2020,national_holiday,holiday,t,f,t,t)`.
  - I then inserted `academic_years(ec_year 2021, 2028-03-01..2029-07-01)`.
  - The same call then returned `(2028-04-04,2021,instructional,teaching,t,t,f,f)`. The locked holiday is gone from SQL, while the 2020 grid still shows it.
- The rationale for the CAL-DB2-03 guard ("a session in the wrong year would capture another year's days") applies to this layer too.
- Impact today:
  - It affects only the school's own data, and nothing in slice 1 consumes calendar_day_status yet.
  - The app creates academic years as Meskerem 1 to Pagume 5 (onboard-tenant/index.ts:91-94, AcademicYearsPage.tsx:68-71), which is in-year.
  - I could not verify whether legacy production academic_years rows satisfy the bounds. Before deploy, run a query on production for rows whose `starts_on`/`ends_on` fall outside the new bounds for their `ec_year`.
- Fix: in calendar_year_settings, ignore (or clamp) an academic_years span that breaks the same Nehase 1 y-1 / Tikimt 30 / Ginbot 1 / Pagume-end bounds. That avoids a backfill or CHECK on an existing table. Do this before the attendance gate uses calendar_day_status.

CAL-DB3-04 (info). Changing a draft calendar's ec_year (with the session moved to match) is accepted and leaves its entries outside the new year's ±60-day window.
- Evidence: AA 2021 changed to 2024 with an entry on 2028-11-12. The entry guard runs only on entry writes.
- It is harmless in calculations. Consider forbidding ec_year changes in authority_calendars_guard.

CAL-DB3-05 (info). A huge ec_year (2147483647) is refused with 22003 from ec_to_gregorian rather than 22023 invalid_range, because the BEFORE trigger runs before the CHECK. The row is still refused.

Round-2 items CAL-DB2-04, 05 and 06 (info) are unchanged.

CHECKED
- Harness on a fresh database (rv_caldb3_a), run as pgtest:
  - 115 migrations applied, 67/67 suites passed.
  - academic_calendar_engine 53/53, maker_checker_hardening 93/93.
  - Only the two existing TODOs remain (WP-06 module gate, WP-05 storage policies).
  - app-rpc-grants: 28 RPCs, 0 findings.
- Golden assertions (CAL-DB2-01):
  - With the engine year faked to 2020, 2021, 2022, 2024 and 2025, assertions 1-6 pass every time.
  - The c8a388d ordering under 2020 fails `not ok 1` with `...,0,4`, which proves the reorder is what fixes it.
- CAL-DB2-03 guard boundaries, all tested:
  - Accepted: Nehase 1 y-1, Tikimt 30, Ginbot 1, Pagume 5, Pagume 6 in a leap year.
  - Refused with 22023 invalid_range: Hamle 30 y-1, Hidar 1, Miyazia 30, Pagume 6 in a non-leap year, a negative ec_year, and 2031-09-06..2032-07-08 for ec 2025.
  - Updating the seeded session out of range is refused. Closing the seed is allowed; after that, UPDATE and DELETE are refused with 42501 calendar_closed.
  - Entries: Meskerem 1 −60 and Pagume end +60 accepted; −61 and +61 refused; moving an entry out by UPDATE refused.
- The trigger is now BEFORE INSERT OR UPDATE OR DELETE (tgtype 31). Neither guard is definer, `search_path` is pinned, and EXECUTE is limited to postgres and service_role (no anon, authenticated or PUBLIC).
- The seed is inserted after the triggers are created, so it passes through the guards:
  - MoE 2019 session is inside the bounds, and all 16 entries are inside the window.
  - The 2030 draft fixture is inside the bounds.
  - Every year-parametrised fixture passes for years 2019 to 2025.
  - special_closure is `#595959`.
- DB2-02: grid vs SQL for the round-2 scenario has 0 differences (see CAL-DB3-02). grid.test.ts and AcademicYearGridPage.test.tsx pass (14 tests).
- Round-2 probes in /tmp/rv-cal-db (attack.sql, attack2.sql, sem.sql) were re-run.
  - The session probes now raise invalid_range.
  - The "school published w/o published_at accepted" line is vacuous on an empty database. A direct insert is refused by `school_calendars_published`.
  - The rule_code mismatch is the known backlog item.
- Migration safety on a populated database (rv_caldb3_c: 114 migrations, 2,000 tenants, 2,000 tenant_configs, 3,111 academic_years):
  - With another session holding ACCESS SHARE on tenants, the `psql -1` apply failed at line 128 after 5.05 s with a lock timeout and rolled back fully (no table, function or column left).
  - A clean single-transaction apply took 0.14 s.
  - Checksums are unchanged for tenant_configs and academic_years, and for tenants once the new column is excluded.
  - edu_authority_id is NULL for every row, and no existing rows are updated or deleted.
  - Re-applying the file fails at line 45 and rolls back.
  - FORCE RLS is on for all 7 new tables.
  - The header contains a forward-fix plan.
- Housekeeping:
  - The worktree was not edited (git status clean at 6133b48).
  - My databases rv_caldb3_a, b and c are dropped, and the server is still accepting connections.
  - No /tmp review file was written. Scratch scripts are in /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/db3/; the faked-year suites are /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/db3_t2020.sql and its siblings.