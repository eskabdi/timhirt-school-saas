REVIEWER: CAL-DB2 (database migration review, round 2)
WP: Academic Calendar Engine slice 1. Commit c8a388d in the read-only worktree /home/user/rv-wp09.
Files reviewed: /home/user/rv-wp09/supabase/migrations/20261008000001_academic_calendar_engine.sql and /home/user/rv-wp09/supabase/tests/rls/academic_calendar_engine.sql

VERDICT: PASS. All six round-1 findings are fixed and I re-verified each one by running it. I found no blocker or major issue. There are three new minor findings, which should be fixed before slice 2 and before 2027-09-12, plus three info items.

FINDINGS

CAL-DB2-01 (minor). The golden pgTAP assertion will start failing on 2027-09-12.
- Location: supabase/tests/rls/academic_calendar_engine.sql:45-48 and :66-72. The cause is the session-year rule at supabase/migrations/20261008000001_academic_calendar_engine.sql:550-553.
- Why it will fail: the setup inserts a published MoE calendar for the current EC year `y()`, with a session starting on Nehase 25 of `y()-1`. From Meskerem 1, 2020 (2027-09-12), that is a 2020 calendar whose session starts on Nehase 25, 2019. Those Nehase days then belong to the 2020 session, so `instructional_days(Nehase 1–30, 2019)` counts them.
- Evidence 1: I ran a copy of the suite with `pg_temp.y()` pinned to 2020. Result: `not ok 1 … have: 9,20,21,22,21,14,20,22,19,21,21,0,4 / want: …,0,0`.
- Evidence 2: I reproduced the same result directly by publishing a MoE 2020 calendar. The yearly total of 210 is unaffected.
- Fix: compute the golden row totals with the grid's row rule (each row counts only days in the 2019 session). Alternatively, skip the current-year MoE insert when `y()` is 2020, or assert against a fixed 2019 setup that has no 2020 calendar.

CAL-DB2-02 (minor). The previous year's grid and SQL disagree on that year's last Nehase days.
- Location: migration lines 510-519 (the comment says "classified exactly as the grid engine does") against grid.ts lines 165-176.
- Background: CAL-DB-04 is fixed for the session-year grid. I compared the 2020 grid with `calendar_days` over 372 days: 0 differences, and the lead-in totals 8 in both.
- The problem: `buildYearGrid(2019)` still draws the 2019 Nehase row from the 2019 entries and the 2019 session. SQL assigns Nehase 25–30 to the 2020 session and applies only the 2020 entries to those days.
- Evidence: the scenario has a 2019 school calendar with "registration" on Nehase 26–30, 2019, and a MoE 2020 session starting on Nehase 25, 2019.
  - The 2019 grid shows 2027-09-01…05 as `registration`, counts=f, row ድምር "–".
  - SQL gives `instructional/t` and `school_holiday/f`, and `instructional_days(Nehase 2019)` = 3.
- Why it matters:
  - A school sees "registration" on its 2019 sheet, but the attendance gate (`calendar_day_status`) treats the day as a 2020 school day.
  - The entry guard's ±60-day window accepts 2019 entries on those days, and SQL never applies them.
  - `create_school_calendar('previous_year')` can copy entries onto Nehase 25+ of year Y, and SQL then ignores them once Y+1's lead-in is published.
- Fix: choose one of the following and document it.
  - The grid hides or greys session days that belong to the next session.
  - The guard refuses school entries for days that fall in another year's published session.

CAL-DB2-03 (minor). The CHECK on authority sessions is looser than the fix description says.
- Location: migration :194-197 (`authority_calendars_session`).
- FIXES_VERIFIED_R6 says "an authority session must lie in its EC year". The CHECK only bounds the Gregorian years, from ec+6 to ec+8.
- Evidence: an ec_year 2025 calendar with session 2031-09-06..2032-07-08 was accepted. That session lies entirely in EC 2024 (Pagume 1, 2023 to Hamle 1, 2024).
- Consequence: `calendar_days` would then assign EC 2024 days to session 2025 (`order by s.y desc`) and apply the 2025 entries and weekend to them.
- Related: authority entries are not bounded to their calendar's year either. An entry dated 2000-01-01 was accepted into the 2019 MoE calendar. Only rule_code is in the backlog.
- Only service_role writes these tables in slice 1, so this is minor.
- Fix: bound the session with the immutable `ec_to_gregorian`, for example `session_starts_on between ec_to_gregorian(ec_year-1,12,1) and ec_to_gregorian(ec_year,2,30)` and `session_ends_on <= ec_to_gregorian(ec_year,13,…)`. Give authority entries a ±60-day window, as school entries have. Do this before the slice-2 authoring RPCs.

CAL-DB2-04 (info). The restrictive module gate runs once per row.
- Location: migration :309-312.
- Evidence: auto_explain of a single `calendar_day_status` call for a school with 499 entries showed 1,006 nested `has_module` evaluations. That is the main remaining cost of the call (about 30 ms).
- It is acceptable at the current volume. If schools approach the 500-entry cap, consider a cheaper gate, such as a module check on the calendar.

CAL-DB2-05 (info). Two small CHECK edge cases.
- `{"en": ""}` passes every `*_i18n` CHECK.
- `params {"month": 1.5}` or `1e12` is rejected with a cast error (22P02 or out of range) instead of 23514. The row is still refused.

CAL-DB2-06 (info). Unindexed FK columns.
- `created_by`, `published_by` and `copied_from_calendar_id` are unindexed, as are the backlogged `tenants.edu_authority_id` and `authority_calendar_entries.overrides_entry_id`. The tables are small, so this does not matter today.

CHECKED
- Harness on a fresh database (rv_cal_db3), run as pgtest:
  - 115 migrations applied, all 67 suites passed.
  - academic_calendar_engine 51/51.
  - Only the two existing TODOs (catalog_module_gate, catalog_storage_policies) remain.
  - app-rpc-grants.py: 27 RPCs, 0 findings.
- CAL-DB-01, volume test, JIT on, as an authenticated school admin:
  - Data: 300 tenants, 60,798 school entries, 2,656 authority entries, and a school in a region with 499 entries.
  - effective_calendar_entries(2019): 16–29 ms (was 1,182 ms).
  - calendar_days over 401 days: 163–166 ms (was 6,004 ms).
  - calendar_day_status: 30–49 ms (was 3,677 ms).
  - instructional_days for the year: 101–111 ms (was 3,880 ms).
  - Plans: school entries are read through a bitmap index scan on `school_calendar_entries_calendar`, with no seq scan. With `jit_above_cost=0` forced, only the outer statements JIT-compile and none of the nested function statements do, so `set jit = off` takes effect.
- Grants and security after the `rows` and `jit` changes:
  - proacl is unchanged: authenticated and service_role only, no anon, no PUBLIC.
  - The guards have no client EXECUTE.
  - create_school_calendar is still the only definer function, with search_path pinned.
  - The catalog_definer_security suite passed.
- CAL-DB-02: an override with no published layer and a cross-year override each raise `invalid_override`.
- CAL-DB-03: Meskerem 10, 2017 gives in_session NULL and blocks=f both alone and inside a 400-day window.
- CAL-DB-04: the 2020 lead-in now gives SQL 9, matching the grid's 9. The full 2020 grid matches SQL on every one of 372 days.
- CAL-DB-05, every tightened CHECK tested by insert:
  - Rejected: empty params, scalar params, `"1"`, Pagume 30, Apr 31, Feb 31, active_to < active_from; weekend `{}`, `{6,6}`, `{7,6,7}`, `{6,NULL}`, `{{6},{7}}`, `[0:1]`; published or closed calendars without their timestamps; `en` null or an object.
  - Still accepted, as they should be: Pagume 6, Feb 29, weekends of 1 and 3 days, the MoE-style lead-in session.
- MoE 2019 golden result: 9,20,21,22,21,14,20,22,19,21,21,0,0, total 210. Same result as postgres, as an authenticated MoE school admin, as an Oromia teacher (no OR 2019 calendar) and as service_role naming the tenant. Ginbot 20 is an instructional day (counts=t).
- Seed:
  - The seed passes every CHECK on both the fresh and the populated database.
  - The 16 entries plus the session match moe2019.fixture.ts byte for byte.
  - holiday_rules (7, no Ginbot 20) match NATIONAL_HOLIDAY_RULES.
- Regressions from the p_tenant refusal; nothing broke:
  - An authenticated admin can run create_school_calendar 'custom', then recreate it as 'moe', then 'custom' again. The guard calls calendar_year_settings with its own tenant and passes.
  - service_role inserting an override and calling calendar_days for a named tenant works.
  - super_admin may name a school.
  - An authenticated user with no users row naming a school gets `not_allowed`.
  - anon gets permission denied.
- Range limits: calendar_days returns `invalid_range` for 1899-12-31 and 2200-01-02, and works for 1900-01 and 2199-12.
- Migration safety on a populated database (114 migrations, 2,000 tenants with tenant_configs and academic_years):
  - With another session holding ACCESS SHARE on tenants, the apply with `psql -1` failed at line 128 after 5.09 s with "lock timeout" and rolled back completely (no edu_authorities, no column, no functions).
  - A clean single-transaction apply took 0.12 s.
  - tenant_configs md5 was unchanged and the tenants count unchanged; edu_authority_id is NULL for all rows; the migration has no UPDATE or DELETE on existing tables.
  - Re-applying the file fails at line 45 and rolls back, which is expected for a tracked migration.
  - The deploy path wraps each migration in its own transaction (audit/evidence/wp01-wp02-deploy-20260927T165645Z.txt), so `set local lock_timeout` applies there.
- Round-1 probe files re-run: /tmp/rv-cal-db/attack.sql, attack2.sql and sem.sql. The tenant spoof now raises `invalid_calendar`. The other probes behave as listed above.
- Housekeeping:
  - I did not edit the worktree (git status is clean at c8a388d).
  - Scratch databases rv_cal_db3, rv_cal_db4, rv_cal_db5 and rv_cal_db6 are dropped, and the server is still running.
  - I wrote no review file under /tmp. My scratch scripts are in /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/.