REVIEWER: CAL-TV (test verification)
WP: Academic Calendar Engine slice 1 (F-01), worktree /home/user/rv-wp09 at 6133b48
VERDICT: FAIL

Summary: All 53 pgTAP assertions and all 25 frontend tests passed on the unmodified tree. For every assertion the brief named, I changed the code it protects, and each one then failed. I found no vacuous security assertion among the 53. The FAIL is for two other reasons: there is no test at all for school-entry tenant isolation, draft-entry visibility, the module gate on entries, authority draft entries, or authority closed/override guards, and one owner-revision assertion is vacuous ("tentative Hijri holidays never counted"). Seven findings are major, so the verdict is FAIL.

How I tested: database `caltv` (now dropped; the server is still running). For each mutation I ran `begin; <mutation>; <suite>`; the suite's own rollback undoes the mutation. Frontend changes were made in a scratch `git archive` copy, never in the worktree. One problem along the way: another agent overwrote the shared scratchpad `mut/` directory partway through. My surviving scripts are in /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/caltv_x7q/ (run_mut.sh, femut.sh, suite2020.sql, probe_prev.sql). The mutations that ran from the lost files are each described below.

FINDINGS

CAL-TV-01 | major | supabase/migrations/20261008000001_academic_calendar_engine.sql:305-312
- Gap: no test covers the select policy or the module gate on school_calendar_entries.
- Mutation 1: `school_calendar_entries_select using (true)` plus `school_calendar_entries_module_gate using (true)`. Result: 53/53 still pass.
- Probe in the same state, after A's custom draft exists: school B reads A's entries (0 normally, 3 when mutated), and teacher A reads the draft's entries (0 normally, 3 when mutated).
- Mutation 2: `select using (tenant_id = own)`, dropping the `exists(school_calendars)` draft filter. Result: 53/53 pass, and the teacher reads 3 draft entries.
- Reference: plan B8 (cross-tenant isolation), B7 (module gate); brief items "draft visibility" and "module gate".
- Fix: add assertions that B counts 0 rows in school_calendar_entries, that teacher A counts 0 while A's calendar is a draft, and that school C (no events module) counts 0 entries.

CAL-TV-02 | major | migration:293-295 (authority_calendar_entries_select)
- Mutation: `using (true)`. Result: 53/53 pass.
- Why: the 2030 draft in the suite (test file :83-84) has no entries, so the policy never filters anything.
- Fix: give the 2030 draft one entry and assert that school admin A counts 0 entries for that calendar.

CAL-TV-03 | major | migration:352-422 (authority guards)
None of these four mutations fails a test:
- a4: the regional-override lock check becomes `if false` (calendar_entry_locked).
- a6: the override target check (`kind <> 'moe' or ec_year <> v_year`) becomes `if false`.
- a7: the closed check in authority_calendar_entries_guard becomes `if false`.
- a8: the closed check in authority_calendars_guard becomes `if false`.

Plan B1 and B8 require both "a closed calendar is immutable" and "a locked override is refused"; the suite proves both only for school rows.
- Fix: assert that a regional entry overriding a locked MoE entry fails with calendar_entry_locked; that one targeting a non-MoE or other-year entry fails with invalid_override; and that insert, update and delete on a closed authority calendar or its entries fail with calendar_closed.

CAL-TV-04 | major | migration:559-560, 588-597 (calendar_days precedence)
- Mutation d4: swap the holiday and break ranks. Result: 53/53.
- Mutation d6: drop holiday below milestone (rank 7.5). Result: 53/53.
- What is covered: only "entry beats weekend". Mutation d8 fails #3 and #4.
- Why it matters: plan B8 asks the pgTAP suite for precedence, and the grid's TS precedence has no SQL twin test.
- Fix: assert calendar_day_status(ec(2019,10,30)) = school_holiday (Parents' Day over the closing milestone), and add a holiday-inside-a-break overlap on a fixture calendar.

CAL-TV-05 | major | src/features/academic-calendar/grid.test.ts:109-120 (vacuous assertion)
- Claim: "never counts them" (tentative Hijri holidays).
- Problem: the only tentative day kept is 2027-07-20 (Hamle 13). That is after the session ends (Sene 30 = 2027-07-07), so `g.total === 210` holds whatever the code does.
- Mutation F13c: in grid.ts, make a tentative day not count (`&& tentative.every(h => h.date !== iso)`). Result: 10/10 pass.
- Reference: owner revision "display only, never stored or counted".
- Fix: add an in-session tentative date with no published holiday near it (for example a Tikimt weekday) and assert total 210 and that cell's `counts === true`.

CAL-TV-06 | major | src/features/academic-calendar/dayTypes.ts:3-4; contrast.test.ts:7-11
- False claim: the comment says "`catalog parity` in grid.test.ts keeps the two in step with the SQL seed". No such test exists (grep finds only that comment).
- Why it matters: the WCAG 4.5:1 test checks the TypeScript copy of the colours, but the page renders the database's colours (fetchDayTypes). A seed colour such as #808080 would fail contrast with no test catching it.
- Today the two do match: I diffed all 18 rows (code, colour, category and six flags) and they are identical. Nothing enforces it.
- Fix: add a parity test (for example a pgTAP assertion comparing `calendar_day_types` to a literal generated from DAY_TYPES, or a Vitest that parses the migration seed).

CAL-TV-07 | major | src/features/academic-calendar/AcademicYearGridPage.tsx (several plan B4 criteria with no test)
Each mutation below leaves AcademicYearGridPage.test.tsx at 4/4:
- F18: the Present/Closed badge always reads "other" (line 185-189).
- F19: the legend and holiday list are removed (line 285).
- F20: the inspector never renders (line 279).
- F17: weekend header shading is removed (line 221).
- F21: the today outline class is removed (line 252). Only aria-current is asserted.
- F24: the cell type marks are removed (line 254). The contrast test checks the marks map, not the render.
- F22: the error `role=alert` is removed (line 433).
- F25: the query-key tenant/user scope is removed (line 70, §6.3).
- Fix: add page tests for badge text (present, closed), legend items and holiday list, inspector content (source level and lock badge), marks in cells, and the error alert. Add a scope test that remounts with another tenant_id and expects new fetches.

CAL-TV-08 | minor | supabase/tests/rls/academic_calendar_engine.sql:251-254 (#51 time bomb)
- This is the same class of problem as CAL-DB2-01, which 6133b48 fixed for the golden assertion only.
- Simulation: current EC year 2020 (`pg_temp.y()` = 2020 and create_school_calendar's `v_now_year` = 2020). Result: 52/53, with "not ok 51". "Last year" is then 2019, and the seeded MoE 2019 session makes in_session true rather than null.
- When: 2027-09-12 to 2028-09-10. The 2021 simulation passes 53/53.
- Fix: pick a year with no seeded session (for example `y()-1` only when it is not 2019, or a fixed year such as 2015).

CAL-TV-09 | minor | migration:548-551 (CAL-SEC-04 has no test)
- Mutation d5: remove the 1900–2199 bound. Result: 53/53.
- Mutation d7: remove the 400-day limit. Result: 53/53.
- Fix: add throws_ok for `invalid_range` on calendar_days('1899-12-31', …) and on a 401-day window.

CAL-TV-10 | minor | migration:653-656, 668-670 (school-entry input limits, B7)
- Mutation g6: remove the ±60-day range check. Result: 53/53.
- Mutation g7: remove the 500-entry cap. Result: 53/53.
- Only the authority-side range is tested (#50; mutation a3 fails it).
- Fix: add one assertion each.

CAL-TV-11 | minor | migration:161-172, 181-184, 198, 241-242, 252-253 (CAL-DB-05 CHECKs, partly tested)
- Proven: k1 (no coalesce) fails #45, k2 (Pagume 30) fails #46, and k3 (duplicate weekend day) fails #47.
- Not tested: a non-numeric month or day, an impossible Gregorian day (Feb 30), active_to < active_from, weekend ndims/lower bound/cardinality 0 or 4, published without published_at, closed without closed_at, a non-string name_i18n.en, the 1000-character school name cap, and the colour and code regexes.

CAL-TV-12 | minor | migration:764-786 ("Use Previous School Calendar")
- Plan B1 says a copied entry that falls "outside the year is dropped and listed". It is not implemented and not tested.
- Probe: a 2019 school calendar holding a valid entry on Hamle 6, 2018. `create_school_calendar(2020,'previous_year')` aborts the whole call with `ERROR: invalid_range` instead of dropping the entry; 2020's window starts Hamle 7 because 2019 has a 6-day Pagume. The UI then shows "unknown", since calendarErrorKey has no invalid_range.
- The Pagume-6 clamp is also untested.
- Fix: drop the entry with reason `outside_year`, and add tests for this and for the clamp.

CAL-TV-13 | minor | migration:511-516 (effective_calendar_entries locked defence)
- The comment says "a locked target is never replaced or removed, whatever the rows say". Mutation e1 removes `not t.locked`: 53/53 pass.
- The write guard covers this today, but the read-side defence itself is unproven.
- Fix: as owner, insert a suppression row with the guard trigger disabled, then assert the locked entry is still returned.

CAL-TV-14 | minor | src/features/academic-calendar/AcademicYearGridPage.test.tsx:62
- The mock answers has_resource_permission without checking its arguments.
- Mutation F33: `p_action: "read"` (an open action, so everyone would get the chooser). Result: 4/4 pass.
- Fix: assert `args.p_action === "create"` and `args.p_resource === "academic_calendar"` in the mock.

CAL-TV-15 | info | test :154, :162 (#26, #31) and migration:297-300
- Mutation p4: remove the tenant predicate from school_calendars_select. Result: still 53/53, because has_module's caller-only rule makes the restrictive gate hide other schools' rows. Removing both (p6) fails #26, #31, #34 and #36.
- The assertion is real, but it is double-covered, so the policy's own tenant predicate is unproven. Optionally add a probe that disables the gate.

CAL-TV-16 | info | test :121-123 (#20)
- Mutation n3: restore the INSERT grant alone. Result: still passes, because there is no INSERT policy.
- Mutation n4: grant plus a permissive policy. Result: #20 fails.
- So the assertion holds, protected by two layers.

CAL-TV-17 | info | plan B4/B8, not in slice 1
- Not built and not tested: the per-option preview grid in Choose Calendar. Plan B9 slice 1 does not obviously defer it.
- Deferred by the plan to slices 2–3, so not counted against this slice: the attendance-blocking regression, publish needs approval, maker ≠ checker, school hijri_holidays wiring on the page, and SQL-side precedence parity with grid.ts.

MUTATION PROOF (each one fails the named assertion, so they are not vacuous)
- Draft visibility:
  - authority_calendars_select `using(true)` fails #7.
  - school_calendars_select without the update/draft clause fails #16.
- Module gate:
  - school_calendars_module_gate `using(true)` fails #34.
  - create_school_calendar without has_module fails #35, so the permission check passes and the module check is the one that refuses.
- Entry guard:
  - lock check off fails #21.
  - authority_only off fails #22.
  - closed check off fails #38.
  - school_calendars_guard closed check off fails #39.
- Tenant mismatch: re-homing (`new.tenant_id := v_cal.tenant_id`) fails #23 (CAL-TI-1).
- Override target NULL-safety: coalesce removed fails #33 (CAL-SEC-02).
- p_tenant refusal: removed fails #27, #28 and #29 (TI-3).
- Create-only cannot recreate: update check removed fails #24 and #25 (SEC-01). Published recreate allowed fails #37.
- Other create_school_calendar checks:
  - create permission off fails #10.
  - year bound off fails #12.
  - custom branch off fails #18.
  - locked-drop off fails #40 and #41.
- Authority bounds:
  - session guard off fails #48 and #49.
  - trigger limited to update fails #48 and #49 (the "now also on insert" claim).
  - entry range off fails #50.
  - auto-lock off, or regional_holiday made not lockable, fails #9, #19 and #21.
- CHECKs: k1, k2 and k3 fail #45, #46 and #47. Each throws_ok matches on errcode only, but these mutations show each one hits its own constraint.
- Per-year sessions and entries:
  - pre-fix calendar_days from 57093b4 fails #51 and #52.
  - DB-03 alone fails #51.
  - DB-04 alone fails #52, so the lead-in count n is not 0.
- Golden 210: `counts` ignoring all_count fails #1, #2 and #3.
- CAL-DB2-01 ordering: with y()=2020 the golden block in place passes. Moved after the fixtures, #1 fails with `…,0,4`; #2 does not catch it.
- Other: the hijri_holidays normalizer loosened fails #43, and an anon EXECUTE grant fails #44.

Frontend mutations (each fails its test):
- F1: notice rendered only with the chooser fails "keeps the outcome".
- F2: tabIndex 0 everywhere fails with 371 stops.
- F3: substring match (`includes`) and F3b `startsWith` fail api.test.
- F4: a #808080 type fill, F4c a #808080 out-of-session fill, F4b always-dark text, and F4d a wrong luminance formula all fail the contrast test.
- F5: chooser shown without the permission fails test 1.
- F6: "previous" enabled fails test 3.
- F10: no focus to the notice fails.
- F11: ArrowRight +2, and F11b no focus move, fail.
- F12: 3-digit hex accepted fails.
- F14: duplicate mark fails.
- F16: type dropped from the cell name fails.
- Grid: F7 column offset, F8 Pagume always shown, F9 today never set, F13 tentative not filtered, F26 weekend over entries, F27 holiday below milestone, F28 next session ignored, F29 lead-in packing and F30 Hijri always on all fail.
- Holidays: F15 Ginbot 20 rule added, F31 Genna as an EC-fixed date and F32 Eid off by two all fail.
- Benign survivor: F3c (trim plus lowercase exact match) passes and is harmless.

CHECKED
- Read the plan (B1, B3, B4, B8 and the owner revisions), the FIXES_VERIFIED_R6 F-01 section, the cal1-* reviews, the migration, the pgTAP suite and every frontend test and source file in scope.
- Gates:
  - supabase/tests/run.sh: 115 migrations, all suites passed, academic_calendar_engine 53/53, catalog_definer_security 10/10.
  - app-rpc-grants: 28 RPCs, 0 findings.
  - tsc and eslint (max-warnings 0) both exit 0.
  - check:i18n: 0.
  - check:locales passed in the worktree.
  - vitest: 24 files, 132 tests passed.
  - deno test supabase/functions: 39 passed. The slice changes no Edge Functions.
- No .only, .skip, todo() or skip in the scoped tests.
- Probes do not grant themselves privileges beyond the shim. pg_temp helpers are granted only EXECUTE. The copy_result temp table is the only extra grant, and it is a result sink.
- Roles: owner-level checks (#21-#23, #33, #38-#39, #45-#52) run as postgres on purpose, as a future RPC would. #51 runs as postgres but with B's jwt sub still set, so it reads B's tenant implicitly. That is correct but undocumented.
- The worktree is unchanged (git status clean). The caltv database was dropped and the Postgres server is still running.
