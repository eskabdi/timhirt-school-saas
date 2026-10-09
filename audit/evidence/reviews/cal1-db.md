REVIEWER: CAL-DB (database migration review)
WP: Academic Calendar Engine slice 1, commit 806c59b. Scope: /home/user/rv-wp09/supabase/migrations/20261008000001_academic_calendar_engine.sql, its pgTAP suite, supabase/security/*
VERDICT: FAIL. There is one confirmed Medium finding (CAL-DB-01).

FINDINGS

CAL-DB-01 (Medium). Hot-path performance. Lines 389-542.
- Cause: the set-returning functions have no ROWS estimate, so Postgres assumes 1000 rows for each. In effective_calendar_entries, the plan for the `school` CTE then hash-joins a sequential scan of the whole school_calendar_entries table (all tenants) and ignores `school_calendar_entries_calendar`. The calendar_days estimate comes out around 1e12, which also triggers JIT.
- Test volume: 45 authority calendars (MoE plus 14 regions, 2018-2020), 2,656 authority entries, 300 tenants, 60,798 school entries, and a school in a region with 499 entries. Run as the authenticated school admin on PG16 with the default `jit=on`:
  - effective_calendar_entries(2019): 1,182 ms, of which JIT is 856 ms.
  - calendar_days over 401 days: 6,004 ms.
  - calendar_day_status for one day: 3,677 ms.
  - instructional_days: 3,880 ms.
- With `jit=off` the same calls take 53, 174 and 55 ms. The sequential scan stays and grows with the size of the whole platform.
- With `alter function calendar_year_settings … rows 1` and `effective_calendar_entries … rows 100`, the index is used and effective_calendar_entries takes 22 ms. calendar_days still JITs (1.3 s).
- Whether production runs with JIT on is not verifiable from here.
- Fix: add `rows 1` to calendar_year_settings and realistic ROWS values to the others, and `set jit = off` on calendar_days, calendar_day_status and instructional_days (or rewrite calendar_days in plpgsql with scalar variables).

CAL-DB-02 (Low). The school-entry override guard can be bypassed. Line 599.
- `v_target.calendar_id not in (moe_id, coalesce(region_id, moe_id))` evaluates to NULL when the school's year has no published MoE calendar, so the check passes.
- Demonstrated: a 2020 school calendar and a 2018 school calendar were each allowed to override the 2019 MoE "Parents' Day" entry.
- Today such rows have no effect, but slice 2 authoring will rely on this guard.
- Fix: `v_target.calendar_id is distinct from` both ids, or `not coalesce(… in …, false)`.

CAL-DB-03 (Low). calendar_days gives different answers for the same day depending on the query range. Line 513.
- `session_known` looks across every year in the window, not the day's own year.
- Meskerem 10, 2017 (tenant with no academic year): queried alone it returns in_session NULL and blocks_student false. Inside a 400-day window it returns false and true.
- Fix: work out session_known per day's year (own_year).

CAL-DB-04 (Low). The SQL classification does not match grid.ts, despite the comment saying it does. Lines 498-503.
- The `ents` CTE pulls entries from every EC year in the range. grid.ts only uses the effective entries of the year it is drawing.
- Example: a published MoE 2020 session starting Nehase 25, 2019, plus a 2019 school "registration" entry on Nehase 26-30, 2019. SQL `instructional_days` for the 2020 lead-in returns 6; `buildYearGrid` for 2020 shows 9 in the lead-in row.
- Fix: limit `ents` to effective_calendar_entries(session year), or change the grid and document the rule.

CAL-DB-05 (Low). CHECK constraints that let bad rows through (verified by inserting each one):
- holiday_rules_params accepts `{}` and scalar params (the CASE gives NULL, which a CHECK allows), Pagume 30, Feb 31, and active_to_ec earlier than active_from_ec.
- weekend_days accepts duplicates `{6,6,6}`, an empty array and the 2-D array `{{6},{7}}`.
- authority_calendars sessions and entries are not tied to ec_year (a 2050 calendar with a 2030 session was accepted).
- school_calendars accepts status 'published' with no published_at.
- name_i18n accepts `{"en":null}` and `{"en":{…}}`.
- An authority entry's rule_code does not have to match its date.
- Today only service_role writes these. Tighten them before the slice-2 authoring RPCs: `coalesce(…, false)`, `jsonb_typeof(name_i18n->'en')='string'`, `array_ndims`, and a session/year tie.

CAL-DB-06 (Info). Migration safety on a populated DB.
- The `lock_timeout` setting works: with another session holding a lock on tenants, the apply failed at line 125 after 5 s and rolled back completely (`edu_authorities` did not exist afterwards).
- Applied with `psql -1` to a 114-migration DB holding 50 tenants and tenant_configs: tenant_configs content was unchanged (same md5).
- The normaliser trigger only runs on a write to `settings`; the next write adds `hijri_holidays:false`. No backfill is needed because parseCalendarPrefs defaults a missing key to false.
- The function comment from 20260925000002 is now stale.
- Applying the file a second time fails on the plain `create function`, as expected for a tracked migration.
- Minor index gaps: there is no index on tenants.edu_authority_id or on authority_calendar_entries.overrides_entry_id (both tables are small).

CHECKED
- run.sh on a fresh DB: 115 migrations applied, academic_calendar_engine 37/37, all suites passed.
- EC conversion: SQL gregorian_to_ec matches the TS toEthiopian for every day from 1900-01-01 to 2100-12-31 (73,414 days, byte-identical). ec_to_gregorian matches toGregorian for every valid EC date in 1892-2093 (73,780), including Pagume 6 of leap years.
- Seed: the 16 seeded entries and the session match moe2019.fixture.ts exactly. The holiday-rule dates match the seeded entries. The golden ድምር per month is 9,20,…,0,0 for a total of 210.
- plpgsql records: an override pointing at a missing entry raises `invalid_override`, not "record is not assigned yet". The previous_year/custom loops and the guard paths were exercised. Locked authority entries cannot be unlocked by UPDATE. Closed calendars refuse updates and deletes.
- Guards and limits checked: the tenant_id rewrite, the 1000-character name limit, the ±60-day window, and the check that a suppressed row must have an override target.
- RLS is enabled and forced on all 7 tables. Writes are revoked from authenticated and from anon.
- The definer function create_school_calendar has a pinned search_path, EXECUTE revoked from public, anon and authenticated, a grant to authenticated only, and an allow-list entry. The catalog guard passed.
- Nothing was edited in the worktree. Scratch databases rv_cal_db and rv_cal_db2 were dropped; scratch files are in /tmp/rv-cal-db/.