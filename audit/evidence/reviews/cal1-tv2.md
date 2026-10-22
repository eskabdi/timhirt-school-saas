REVIEWER: CAL-TV2 (test verification, round 2)
WP: Academic Calendar Engine slice 1 + invite-state change. Worktree /home/user/rv-wp09 at 0129fef, diff 6133b48..0129fef.
VERDICT: FAIL

Summary: Most of the round-1 gaps are closed, and I checked this by mutating the code myself, not by reading the claims. Every round-1 survivor now fails a test: a4, a6, a7, a8, d4, d5, d6, d7, g6, g7, e1, F13c, F17–F25 and F33.
- On the base migrations (6133b48), both new pgTAP suites fail.
- On the base frontend source, 7 of the new or changed frontend tests fail. The rest guard behaviour that already existed, and a mutation proves each of them.
- All gates pass.

The verdict is FAIL for two major findings:
1. The TV-08 time bomb is still there, so the claimed fix does not work.
2. The Edge Function changes for the invite state have no test at all.

Environment note: when I resumed, the Postgres server at /tmp/pgsock:5433 was down. There was no process, only a stale socket and lock file; the log ends at 16:01 UTC. I restarted it with `pg_ctl -D /tmp/pgval -o '-p 5433 -k /tmp/pgsock' start` as pgtest, and I did not stop it. My restart left out the original `-h ""`, so it may now also listen on localhost TCP 5433. Re-add that flag at the next restart if it matters.

FINDINGS

CAL-TV2-01 | major | supabase/tests/rls/academic_calendar_engine.sql:296-303 (assertion #62; this is TV-08, not fixed)
- Evidence: I faked the current EC year by patching the suite's `pg_temp.y()` and the `v_now_year` expression in create_school_calendar.
  - 2018, 2019, 2021–2029 and 2031: 76/76.
  - 2020: 75/76, `not ok 62 - a day's session status does not depend on the window it is asked in`.
- Cause: "last year" is then 2019, and the seeded MoE 2019 session (2026-08-31..2027-07-07) makes the day's own year have a session. So `calendar_day_status(Hamle 15, 2019).in_session` is `false`, not null. Direct probe: `2027-07-22|2019|out_of_session||f|f|t|f`.
- The new comment "for every year, the 2019 seed included (CAL-DB3-01)" is false.
- CI goes red from 2027-09-12 to 2028-09-10. This was reported in round 1 and is claimed fixed, so I raised it from minor to major.
- Fix: assert that the single-day value and the windowed value are the same (`is not distinct from`) and that neither is `true`, instead of asserting `is null`. Or use a day in a year with no seed and no fixture.

CAL-TV2-02 | major | supabase/functions/invite-tenant-admin/index.ts:48-118 (coverage gap)
- Untested new behaviour:
  - status maps `pending: !password_set`
  - resend returns 409 when `password_set`
  - resend chooses `inviteUserByEmail` versus `resetPasswordForEmail` (recovery) by `email_confirmed`
  - the rate-limit bucket split: status 60/min, invite/resend 10/min
- No Deno test exists: there is no test file in the function directory, and `deno test supabase/functions` runs 39 tests, none for this function.
- TenantDetailPage.test.tsx mocks the endpoint, so it tests the UI only.
- Also not verifiable: whether a recovery link landing on /accept-invite gives a session there. There is no live GoTrue and no evidence file for that path.
- Fix: move the state→response and branch logic into a pure helper and give it Deno tests, or add an evidence run against staging Auth.

CAL-TV2-03 | minor | migration authority_calendar_entries_guard, `or v_target.ec_year <> v_year` (TV-03 partly closed)
- Mutation a6b: drop only the other-year condition. Result: 76/76.
- #66 targets a regional entry, so only the `kind <> 'moe'` arm is exercised; mutation a6c fails #66.
- Fix: add a regional override that targets a MoE entry of another year.

CAL-TV2-04 | minor | migration school_calendar_entries_guard, upper bound of ±60 (TV-10 partly closed)
- Mutation g6hi: remove `or new.ends_on > … + 60`. Result: 76/76.
- The lower bound is covered: g6lo fails #72.

CAL-TV2-05 | minor | migration ec_session_in_year (CAL-DB3-03 partly closed)
- Mutation sessfn: loosen p_from's upper bound (Tikimt 30 → next year). Result: 76/76.
- Mutation sessfn2: loosen p_to's lower bound (Ginbot 1 → the year before). Result: 76/76.
- Covered so far: p_from's lower bound (#61, #62-era tests at :284-289) and p_to's upper bound (#76; db303 fails it).

CAL-TV2-06 | minor | create_school_calendar, Pagume-6 clamp (TV-12 remainder)
- Mutation tv12clamp: replace `least(v_from.ec_day, ec_days_in_month(...))` with `v_from.ec_day`. Result: 76/76.
- The outside_year branch itself is covered. Removing it makes the suite abort with `ERROR: invalid_range`, which run.sh counts as a failure. It is caught by the error rather than by an assertion.

CAL-TV2-07 | minor | supabase/tests/rls/tenant_admin_invite_states.sql fixtures
- Mutation inv_conf: compute `email_confirmed` from `last_sign_in_at`. Result: 9/9. Every fixture sets both together.
- This matters because `email_confirmed` chooses the invite or recovery branch in the Edge Function.
- Fix: add a user who is confirmed but has never signed in, or the reverse.
- Mutations that were killed: inv_pw and inv_pw2 (#1), inv_tenant (#1, #2), inv_sa (#1), inv_role and inv_auth (#8), inv_grant (#6), inv_grant_anon (#5). inv_revoke_sr makes the suite error.

CAL-TV2-08 | minor | src/features/academic-calendar/AcademicYearGridPage.tsx:217 (load-failure alert)
- Mutation F22b: remove `role="alert"` from the `failed` paragraph. Result: 9/9.
- Round-1 F22, the Choose Calendar alert, is now covered.

CAL-TV2-09 | minor | src/features/platform/TenantDetailPage.tsx:181 (RESEND_ERRORS filter)
- Mutation T2: `t(key)` without the allow-list. Result: 4/4.
- No test covers a non-HTTP error, such as a network failure or an expired session, showing the generic message.
- The 429 mapping is covered: T1 fails.

CAL-TV2-10 | info | entries policies are covered twice
- tv01_gate: school_calendar_entries_module_gate set to `using (true)` alone. Result: 76/76.
- tv01_notenant: tenant predicate removed from school_calendar_entries_select. Result: 76/76.
- Both still hold because the `exists(school_calendars)` filter inherits the calendar's gate and tenant isolation. So #46 ("module gate on entries") does not prove that policy on its own.
- Killed: the combined mutation tv01_both (#33, #35, #46) and tv01_nodraft (#33).

CAL-TV2-11 | info | the suite breaks when y() = 2030 (a 2037 date)
- The 2030 MoE draft fixture collides with the current-year MoE insert (`authority_calendars_authority_id_ec_year_key`).

CAL-TV2-12 | info | benign survivor
- I3 (tField without the object type-check) behaves identically for every input, so it is an equivalent mutant.
- The invite suite's `grant execute … to authenticated` (line 55) is a deliberate stray-grant probe, placed after the privilege assertions.
- The calendar suite disables a trigger to plant legacy rows (TV-12, TV-13). This is done as the owner and is a fixture, not privilege escalation for the actor under test.

CHECKED
Gates:
- supabase/tests/run.sh on a fresh database (caltv2): 116 migrations, 68 suites, all ok. academic_calendar_engine 76/76, tenant_admin_invite_states 9/9, catalog_definer_security 10/10. Output: /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/caltv2_r9k/run_full.txt
- app-rpc-grants: 28 RPCs, 0 findings.
- tsc and eslint (`--max-warnings 0`): exit 0.
- vitest: 26 files, 145 tests passed.
- check:i18n: 0. check:locales passed in the worktree.
- deno test supabase/functions: 39 passed.
- deno-check: 28 functions, 3 baselined, ok.

Tests fail on the pre-change code:
- New pgTAP suites against the 6133b48 migrations: both FAIL. academic_calendar_engine aborts at `invalid_range` in the copy; tenant_admin_invite_states fails because the function does not exist.
- New frontend tests against the 6133b48 source: 7 fail. They are the overlap grid test, the a11y names and up/down keys, the dropped-reason notice, the badge/legend/marks/today test, the inspector test, and both TenantDetailPage resend tests.

pgTAP mutations: each ran in `begin; <mutation>; <suite>` and was rolled back.
- Killed:
  - a4 → #65; a6 and a6c → #66
  - a7 → #68, #69, #70; a8 → #71
  - d4 → #8; d6 → #7, #8; d5 and d5b → #9; d7 and d7b → #10
  - g6 and g6lo → #72; g7 and g7b (`> 500`) → #73
  - e1 → #74; db303 → #76; db304 → #67
  - tv02 → #13
- Survived: a6b, g6hi, sessfn, sessfn2, tv12clamp, tv01_gate, tv01_notenant, and inv_conf in the invite suite.

Frontend mutations, run in a git-archive scratch copy:
- Killed: F13c, F17, F18, F18b (closed badge), F19, F19b (holiday list), F19c (legend Today), F20, F20b (lock badge), F20c (level badge), F21, F22, F24, F25, F25b (user scope only), F33 (p_action), F33b (p_resource).
- Day-type parity, killed: P1 (seed colour), P2 (TS colour, also caught by contrast), P3 (flag), P4 (order), P5 (code).
- tField, killed: I1 (non-string passthrough), I2 (am/om order).
- Grid overlap rule, killed: G1 and G2.
- TenantDetailPage: T1 killed.
- Survived: F22b and T2 (minor), and I3 (equivalent mutant).

Time-bomb simulation, faking the current EC year: 2018, 2019, 2021–2029 and 2031 pass. 2020 fails #62 (finding 01). 2030 fails on a fixture collision (finding 11).

Also checked:
- No .only, .skip, todo() or skip in the scoped test files.
- The worktree is clean at 0129fef.
- Databases caltv2 and caltv2b are dropped. The server is still running.

Scripts are in /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/caltv2_r9k/:
- run_mut.sh and timesim.sh
- femut.sh and the m/*.sql mutation files
- run_base_newtests.txt (the run against base migrations)
