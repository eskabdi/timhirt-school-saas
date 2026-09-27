REVIEWER: test-verifier
WP: WP-02 (round 3; implementation c4ecfac..7c81fd7, review fixes 67a627d..f4d5924, worktree at f4d5924)
VERDICT: PASS

FINDINGS:
  - id: TV3-1
    severity: minor
    location: audit/FIXES_VERIFIED_R6.md:568, :630-635
    evidence: The ledger's gate block is headed "Gate (local, round-1 fixes)". It says "65/65 suites; `definer_lockdown` 51/51, `catalog_definer_security` 7/7". It gives fail-before as "`definer_lockdown` fails 13/51, `catalog_definer_security` 3/7". Line 635 says "tsc 0, eslint 0/0, Vitest …, build, and the other gates: see the commit". None of the four fix commits contains any gate output. My run of f4d5924 gives 113 migrations and 66/66 suites, with `definer_lockdown` 58/58 and `catalog_definer_security` 8/8. I also ran the HEAD test files against the 67a627d migrations: `definer_lockdown` failed 20/58 (12, 16, 23, 26–31, 42–44, 48–55), `catalog_definer_security` 3/8 (1, 3, 7), `security_settings` 1/8 and `exam_seating_charts` 1/9. So this is the TV-8 class again: the recorded gate output is not from this commit. The H-01 row at line 568 repeats the stale 7/7 and 51/51.
    reference: §0A.2 test-verifier ("gate output genuine"); §0 Rule 5
    fix: Replace the gate block with the actual f4d5924 output: 66 suites, 58/58, 8/8, the fail-before counts above, and the literal tsc/eslint/vitest/build/deno/semgrep results. Correct the H-01 row.

  - id: TV3-2
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:488-493
    evidence: Mutation N17 replaced `alter default privileges for role postgres in schema extensions grant execute on functions to public` with `null;`, and all 66 suites stayed green. The harness has no `extensions` schema, so this branch never runs in CI. The production evidence file shows pgcrypto, uuid-ossp and pg_stat_statements are in `extensions`, owned by postgres. I checked the branch by hand in a rolled-back transaction: create the `extensions` schema, run the DO block, create a function; `has_function_privilege('anon', 'extensions.f()', 'execute')` returned `t`. The statement works, but no test protects it.
    reference: §0A test-verifier (fail before / pass after); CLAUDE.md "Prove a gate fails before trusting that it passed"
    fix: In definer_lockdown.sql or catalog_definer_security.sql, assert that postgres's default ACL for `extensions` grants EXECUTE to PUBLIC whenever the schema exists. Have shim.sql create an empty `extensions` schema, as Supabase does, so the branch runs in the harness.

  - id: TV3-3
    severity: info
    location: supabase/tests/rls/catalog_definer_security.sql:45
    evidence: The description still reads "executable by anon/authenticated/view owner unless allow-listed". The assertion now covers every grantee except the owner and service_role, PUBLIC included; mutation N10 (a grant to `pg_read_all_data`) fails it.
    reference: TV-12 follow-up
    fix: Reword it to "by any role but the owner and service_role".

  - id: TV3-4
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:66, :131
    evidence: Two mutations survived, neither affecting an acceptance criterion:
      - N16 removed `set local lock_timeout = '5s'`. That setting is operational and cannot be tested in the harness.
      - N19 removed the `v_role <> 'super_admin'` part of the suspended-tenant check in `get_tenant_id_for_user`. This is behaviour from before WP-02, and it cannot be reached today because super_admin rows have `tenant_id` null.
    reference: §0A test-verifier
    fix: None required. Optionally add a backlog note.

  - id: TV3-5
    severity: info
    location: supabase/tests/rls/definer_lockdown.sql:129-134; supabase/tests/rls/maker_checker.sql:71
    evidence: These are the only grants inside tests:
      - definer_lockdown creates `wp02_probe_role` and grants it EXECUTE. The role stands in for a context the trust allow-list must treat as an end user, and every assertion then expects the restricted answer. It is not a self-grant that gets around the control under test, and CREATE ROLE is rolled back with the suite.
      - `grant execute on function pg_temp.act_as(uuid)` is the test's role-switching helper, which CLAUDE.md documents.
    reference: reviewer brief ("probes that grant themselves privileges")
    fix: None.

CHECKED:
  - Read the WP-02 text, its tests and acceptance criteria (plan lines 329-385), §0A.4 and §0A.5, my round-1 verdict, and the diffs c4ecfac..7c81fd7 and 67a627d..f4d5924 (migration, allow-list, both catalog suites, definer_lockdown, security_settings, exam_seating_charts, maker_checker, shim, app-rpc-grants.py, ci.yml, useSecuritySettings.ts and its test).
  - Harness at f4d5924 on a fresh database: 113 migrations and 66/66 suites. definer_lockdown 58/58, catalog_definer_security 8/8, security_settings 8/8, exam_seating_charts 9/9, maker_checker 65/65. The only open TODOs are WP-05 and WP-06. A second run.sh on the same database was also green, so RG-1 is closed.
  - `app-rpc-grants.py` after run.sh: 23 app RPCs, 0 findings, exit 0. Its failure paths work:
      - A planted `supabase.rpc("wp02_no_such_fn")` is reported as missing, exit 1.
      - An unreachable database exits 1.
      - The regex misses no `rpc(` call site in src/; the only non-literal one is the wrapper's own definition.
  - The CI step runs after run.sh in the same rls-tests job, with the same PG* env.
  - Round-1 mutations that survived before, re-run on a copy of HEAD, all killed now:
      - M1 (has_resource_permission guard removed): definer_lockdown #39.
      - M2 (create_import_job guard `if false`): #24 and #38.
      - M2b (role check only): #38.
      - M3 (acknowledge_alert role check removed): #41 and #45.
      - M4 (has_module super_admin carve-out removed): #46.
      - M16 (revoke check_staff_employee_linkage, create_import_job and dashboard_alerts from authenticated and from the allow-list): definer_lockdown errors, and app-rpc-grants reports 3 "closed" findings with exit 1.
  - New mutations on the review fixes, all killed:
      - N1 (anon grant on get_security_settings restored): catalog #3, lockdown #12.
      - N2 and N2b (default-privilege revokes removed): catalog #7.
      - N3 (login thresholds to everyone): security_settings #6, lockdown #16 and #54.
      - N4 (attendance window, cross-tenant): #23 and #49.
      - N5 (data_jobs_admin_update kept): #31.
      - N6, N6b and N6c (INSERT policies kept): #42, #43, and #30/#31/#44.
      - N7 (deny-list trust restored in get_email_for_user): #48.
      - N8 and N8v (new closed function used by a policy or a security_invoker view): catalog #8.
      - N9 (search_path `extensions, public, pg_temp`): catalog #4.
      - N10 (grant to pg_read_all_data) and N10b (grant to PUBLIC): catalog #1, #3 and lockdown #8.
      - N11 (export entity validation removed): #29.
      - N12 (cross_tenant_denied message restored): exam_seating_charts #9.
      - N14 and N15 (caller check removed from get_tenant_id_for_user and get_role_for_user): #19/#51 and #18/#52.
      - N18 (suspended-tenant check removed): tenant_suspension_lockout #3-6.
      - N20 (has_module ignoring a false override): branding_extended_module #9.
  - Survived: N16, N17 and N19 (TV3-2, TV3-4).
  - Fail-before: I ran the HEAD test files, shim and allow-list against the 67a627d migrations. catalog_definer_security fails 1, 3 and 7; definer_lockdown fails 20 assertions; security_settings fails #6; exam_seating_charts fails #9. The probes carried over from round 1 (TV-1, TV-2, TV-7) pass on that code because the guards already existed there; their fail-before comes from M1-M4.
  - useSecuritySettings.test.tsx: passes at HEAD (2/2). Removing `enabled: !!userId` fails test 1, and dropping userId from the query key fails test 2. The only mocks are the supabase client and useSession, and no RLS path is involved. The prefix invalidation `["security-settings"]` in SecuritySettingsPage still matches the new key. AcceptInvitePage shows the form only when it has a session, so removing the anon grant does not break it.
  - Acceptance criteria mapped to tests:
      - "0 anon-executable definer functions": catalog #3 (hard, asserts `{}`).
      - "0 without search_path": catalog #4, pinned to exactly `public, pg_temp`.
      - A-1 anon probes: lockdown #1-14, which now pin the "permission denied for function …" message.
      - Tenant-A admin `create_export_job(B)` and `has_module(B)`: lockdown assertions, killed in round 1 (M11, M15).
      - "Full suite proves the allow-list": the full suite, app-rpc-grants.py and catalog #8 (M16, N8).
  - Round-1 findings:
      - Closed: TV-1 (M1), TV-2 (M2 and M3), TV-3 (M16 plus the CI step), TV-4 (anon 0), TV-6 (N4), TV-7 (M4), TV-9 (deviations row in the ledger), TV-10 (N9), TV-11 (messages pinned), TV-12 (N10), TV-13 ("Disabled (owner only)" class; .gitignore line justified).
      - TV-5: closed by audit/evidence/wp02-prod-owners-bypassrls-defacl-20260926T105624Z.txt, which shows postgres BYPASSRLS=True and owning all 11 tables. That file is implementer-written; I did not query production.
      - TV-8: recurs as TV3-1.
  - No `.only`, skip or todo was added in the new or changed tests. Every suite's assertion count matches its plan.
  - The inventory regenerates identically from the migrated database.
  - Other gates:
      - `tsc --noEmit`: exit 0.
      - `eslint src`: exit 0.
      - Vitest: 16 files, 98/98.
      - `check:i18n`: 0.
      - `check:locales`: passed.
      - `npm run build` (in a scratch copy): ok.
      - `deno-check.sh`: 28 functions, 3 baselined, ok.
      - `deno test supabase/functions`: 37 passed, 0 failed.
      - Semgrep 1.95.0 rule test: 16 expected, 0 missing, 0 unexpected.
  - Not verified: production state beyond the committed evidence file, the deploy, and the DM-1 performance figures (those belong to the performance-reviewer).
  - Cleanup: I dropped every rv3_wp02_tv* database and removed /tmp/rv3_wp02_tv. The worktree is unchanged at f4d5924, with no deno.lock or __pycache__. /home/user/rv-wp02/dist predates my run; I built only in the scratch copy.
