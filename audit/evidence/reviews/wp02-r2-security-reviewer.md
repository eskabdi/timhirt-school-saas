REVIEWER: security-reviewer
WP: WP-02 (round 2: implementation 7c81fd7 plus round-1 fix commit 16548ba)
VERDICT: PASS

All nine of my round-1 findings are closed, fixed in code or moved to the backlog (SEC-10 is partly verified; SEC-7 and SEC-11 are in `audit/backlog.md`, SEC-8 and SEC-9 are fixed). Both majors (SEC-1 and SEC-2) are fixed in code and tested, and each new assertion fails without the fix. The full harness is green on my own database. The five findings below are minor or info only.

FINDINGS:
  - id: SEC-R2-1
    severity: info
    location: audit/evidence/wp02-prod-owners-bypassrls-defacl-20260926T105624Z.txt:1
    evidence: Not verifiable by me, because I was not allowed to contact production. The migration depends on three production facts, and they appear only in a file the implementer wrote:
      (a) postgres has BYPASSRLS, which the 11 tables now forced into row-level security rely on;
      (b) all 76 public functions are owned by postgres;
      (c) production's default privileges for postgres (a `public | f` entry granting anon, authenticated and service_role, and no global entry).
      My round-1 point SEC-10(c) is now low risk. Storage and Realtime were never checked for the `role` setting they use, but trust is now an allow-list, so an unexpected role gets the end-user answer (fails closed). The worst case is a broken feature, not an exposure.
    reference: §0A.5 "not verifiable" rule; SEC-10 (round 1)
    fix: The release-gatekeeper should re-run the three read-only queries from that file on the deploy day and attach the output to the deploy record.
  - id: SEC-R2-2
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:439-446
    evidence: The migration removes the global EXECUTE-to-PUBLIC default for postgres, and gives PUBLIC back only in the `extensions` schema. My probe on the migrated harness shows the effect: a new function postgres creates in another schema has ACL `{postgres=X/postgres}`, and a new function in public has `{postgres=X/postgres,service_role=X/postgres}`. So an extension that postgres installs into a schema other than `extensions`, or into `public`, now starts closed to anon and authenticated. The harness has no `extensions` schema, so the re-grant branch never runs in CI. Not verifiable locally: whether Supabase's extension installer creates functions as postgres, so that these defaults apply to them.
    reference: WP-02 item 3; availability
    fix: Add a line to docs/DEPLOYMENT.md: after any `create extension` outside `extensions`, check EXECUTE on the new functions. Optionally, create an `extensions` schema in shim.sql so the DO branch runs in CI.
  - id: SEC-R2-3
    severity: minor
    location: supabase/tests/rls/catalog_definer_security.sql:1-20 (no guard exists; this is a missing control)
    evidence: New functions now start closed to authenticated, even non-definer ones. `app-rpc-grants.py` only covers functions the app calls by name. It does not cover a future invoker helper that a policy, view, column default or check constraint calls. Such a helper would fail at runtime with 42501 unless a pgTAP suite happens to exercise it. My pg_depend query today finds no such dependent for authenticated. The only hits are anon on 9 admin tables, which is the known backlog item (SEC-11).
    reference: CLAUDE.md "Verification means running the thing"; availability
    fix: Add a catalog assertion. For every pg_policy, pg_rewrite, pg_attrdef or pg_constraint that depends on a public function, the roles it serves (authenticated, and timhirt_view_owner for its views) must have EXECUTE on that function. Keep the current anon rows as a ratchet baseline until WP-06.
  - id: SEC-R2-4
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:305-320
    evidence: `attendance_retroactive_edit_window_days` now calls `get_tenant_id_for_user(auth.uid())` inside its body, and the attendance gate policy runs it once per row. This adds to the per-row cost already logged for `has_module` (SEC-7/TI-8/AC-14 in audit/backlog.md). This is a performance cost, not a security gap.
    reference: SEC-7 (round 1), performance-reviewer
    fix: Add this function to the existing SEC-7 backlog row, for the move to evaluating once per statement (initplan).
  - id: SEC-R2-5
    severity: info
    location: docs/insa/_pending-changes.md:165
    evidence: The doc says "Every SECURITY DEFINER function in `public` (65)". The catalog at HEAD has 74 (`select count(*) … prosecdef` → 74), and the committed inventory says "74 functions". The allow-list count in the same section (29 = 24 + 5) is correct.
    reference: L-10 (docs accuracy)
    fix: Say "65 at WP-02; 74 with WP-09", or drop the number.

ROUND-1 CLOSURE:
  - SEC-1 (major) closed. The global default and the public-schema default for postgres are both revoked; my new-function probe shows anon and authenticated false, service_role true. Catalog guard #7 fails on the round-1 schema ("global default grants PUBLIC", "public default grants anon/authenticated"). docs/DEPLOYMENT.md adds a drift query.
  - SEC-2 (major) closed. There is no anon grant, and the allow-list row is removed. On the migrated catalog, anon can execute 0 definer functions. Test 12 in definer_lockdown and catalog tests 1 and 3 fail on the round-1 schema. The hook is off until there is a session, and AcceptInvitePage only shows the form once it has a session.
  - SEC-3 (minor) closed. My probe as a student returned only `password_*` and `session_timeout_minutes`. The global rows in `system_config` are readable only by super_admin, so the table is not a way around this. Tests 16 in definer_lockdown and 6 in security_settings fail before the fix.
  - SEC-4 (minor) closed. A student asking for tenant B's attendance window gets 7 (B's real value is 45); service_role gets 45. Test 23 fails before the fix.
  - SEC-5 (minor) closed. Tests 38 and 39 fail on the WP-01-head schema (38 of 51 fail there in total) and pass at HEAD. My probe as a student asking about admin A returned NULL.
  - SEC-6 (minor) closed. Trust is now an allow-list in all 10 places that check the `role` setting (7 in WP-02, 3 in WP-09). grep and a prosrc query find no deny-list left. The unexpected-role tests 47 and 48 fail before the fix.
  - SEC-7 (minor) moved to audit/backlog.md; see also SEC-R2-4.
  - SEC-8 (minor) closed. The ledger now says 113 migrations, 65/65 suites, and fail-before counts of 13/51, 3/7, 1/8 and 1/9. I reproduced every one of those numbers.
  - SEC-9 (info) closed. The shim comment is fixed. The query key includes the user id and the query is enabled only with a session; the vitest file passes (2/2).
  - SEC-10 (info) partly closed: evidence file added (see SEC-R2-1).
  - SEC-11 (info): in the backlog for WP-06, and my dependency query confirms the same 9 tables.

CHECKED:
  - Read WP-02 (plan lines 329-385, including acceptance criteria), §0A.4 and §0A.5, my round-1 verdict, the diffs c4ecfac..7c81fd7 and 67a627d..16548ba (27 files), and the whole migration at HEAD.
  - Ran the full harness on rv2_wp02_sec: 113 migrations and 65 suites, "All suites passed". definer_lockdown is 51/51, catalog_definer_security 7/7, security_settings 8/8, exam_seating_charts 9/9 and maker_checker 65/65. The only TODOs left are WP-05 and WP-06.
  - Fail-before, against the round-1 code: I built a copy of the tree with the 7c81fd7 and 67a627d versions of the two edited migrations (rv2_wp02_sec_pre). HEAD's tests fail as follows: definer_lockdown 13/51, catalog_definer_security 3/7, security_settings 1/8, exam_seating_charts 1/9.
  - Fail-before, against the WP-01 head: 110 migrations from `git archive c4ecfac` (rv2_wp02_sec_wp01); definer_lockdown fails 38/51.
  - Catalog at HEAD: 74 definer functions; 0 executable by anon; 0 without a pinned search_path; the only non-owner grantees are authenticated, service_role and timhirt_view_owner; 0 tables without enabled plus forced RLS. The default privileges are the global entry `{postgres=X}` and the public-schema function entry `{service_role=X}`.
  - Regenerated definer_inventory.md from my database in a scratch copy: identical to the committed file (74 rows; 29, 23, 2 and 20 per class).
  - app-rpc-grants.py: 23 RPCs, 0 findings. After I revoked create_import_job from authenticated in my own database, it failed (exit 1) naming ImportExportPage.tsx:63. The SQL it builds only interpolates names that already matched `[A-Za-z_][A-Za-z0-9_]*`, so there is no injection risk. No app `.rpc(` call is split across lines. The one call with a variable name goes through the dashboard `rpc<T>` wrapper, which the script covers.
  - Dependents: no view, default, check constraint or invoker function (callable or trigger) calls a public function that authenticated cannot execute. Policies that do so exist only for anon (backlog).
  - My own probes, rolled back: as a student, the settings keys, attendance(B)=7, has_resource_permission(admin A)=NULL, get_email_for_user(admin A)=NULL, has_module(B)=false; as service_role with a leftover JWT sub, attendance(B)=45; as anon, 0 executable definer functions.
  - Allow-listed functions that take a uuid (dashboard_overview, get_class_rank, get_student_grade_history, is_guardian_of, is_teacher_of_class, check_staff_employee_linkage) take the tenant and the user from auth.uid().
  - Dropped INSERT policies: no app code or Edge Function inserts into data_jobs, health_alerts or system_health with a user client. claimJob uses adminClient. The resolve-alert UPDATE is still covered by health_alerts_admin_update.
  - Error text is generic ('permission denied for tenant', 'invalid entity type', 'exam_not_found'); the cross-tenant exam oracle is removed. There are no secrets in the diff.
  - Frontend: `npx tsc --noEmit` exits 0, `npx eslint src` exits 0, `vitest run src/lib/useSecuritySettings.test.tsx` passes 2/2. I did not run the full vitest suite, build, the i18n/locale checks, deno-check or semgrep.
  - Not applicable in this diff (confirmed from the file list): XSS, CSRF, SSRF, uploads beyond the new 5 MB and entity-type checks, crypto, Edge Function rate limits.
  - Cleanup: dropped rv2_wp02_sec, rv2_wp02_sec_pre and rv2_wp02_sec_wp01; no wp02_probe_role is left over; `git status` in /home/user/rv-wp02 is clean, with no deno.lock or __pycache__. Scratch copies are under /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/.
