REVIEWER: regression-guardian
WP: WP-02 (round 2; head 16548ba; implementation c4ecfac..7c81fd7, fixes 67a627d..16548ba)
VERDICT: FAIL

FINDINGS:
  - id: RG-1
    severity: major
    location: supabase/tests/shim.sql:15-16 and supabase/tests/shim.sql:54 (triggered by supabase/migrations/20260926000001_r6_definer_lockdown.sql:439); the claim is at audit/FIXES_VERIFIED_R6.md:579
    evidence: |
      Running the harness a second time on the same database fails 55 of 65 suites. The first run on a fresh DB passed.
        psql:.../definer_lockdown.sql:40: ERROR:  permission denied for function throws_ok
        --- FAIL: admission_refund.sql ... --- FAIL: timetable_periods.sql   ==> FAILURES, EXIT 1
      Root cause: the migration runs `alter default privileges for role postgres revoke execute on functions from public`. pg_default_acl is stored per database, so this survives run.sh's `drop schema public cascade`. The shim then runs `create extension pgcrypto/pgtap` (lines 15-16) before it restores the default (line 54). pgtap is therefore created with proacl `{postgres=X/postgres}`, and anon/authenticated cannot call throws_ok, is, ok and the rest.
      FIXES_VERIFIED_R6.md:579 says: "The shim restores the built-in default at the start of every harness run, so a re-run is unaffected." That statement is false.
      I confirmed the fix: a scratch copy of the shim with the restore line moved above the `create extension` lines re-ran green on the same DB (113 migrations, all suites passed).
      CI is not affected, because it uses a fresh service container. The local gate in CLAUDE.md is affected. This is new with 16548ba: the pre-WP-02 base never revoked the global default.
    reference: §0A.4 severity (broken tests; doc/control mismatch); CLAUDE.md "Prove a gate fails before trusting that it passed"
    fix: In shim.sql, move `alter default privileges for role postgres grant execute on functions to public;` above `create extension if not exists pgcrypto; create extension if not exists pgtap;`. Correct the ledger sentence at FIXES_VERIFIED_R6.md:579. Optionally add a CI or local check that runs run.sh twice.

  - id: RG-2
    severity: minor
    location: docs/DEPLOYMENT.md:263
    evidence: The post-deploy check says the global default row must be "without `=X/`". After this migration the global row is `{postgres=X/postgres}` (harness pg_default_acl: `postgres|-|f|{postgres=X/postgres}`), which contains `=X/`. An operator following the doc will report a failure on a correct deploy. The mistake can only cause a false alarm, never a false pass.
    reference: §0A.2 insa-docs / runbook accuracy
    fix: Reword it as "the global row has no PUBLIC entry (no element beginning with `=X/`)", or give the exact query: `select not exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a where d.defaclrole='postgres'::regrole and d.defaclnamespace=0 and d.defaclobjtype='f' and a.grantee=0)`.

  - id: RG-3
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:372-374, :244, :339
    evidence: |
      These behaviour changes were not in the WP-02 text. Each is recorded in FIXES_VERIFIED as a review fix, and I found no regression from any of them:
      (a) The migration drops the INSERT policies `health_alerts_insert`, `system_health_insert` and `data_jobs_write`. No app code inserts into these tables: ImportExportPage and HealthMonitoringPage only SELECT, UPDATE through `data_jobs_admin_update`, or call RPCs. The Edge Functions write data_jobs through adminClient.
      (b) `create_*_job` now allow-lists the entity type (`students`/`teachers`/`fees`, same as ImportExportPage) and caps file size at 5 MB (same as the data-imports bucket's `file_size_limit`).
      (c) `auto_assign_exam_seats` now raises `exam_not_found` instead of `cross_tenant_denied`. Nothing in src/ matches either string.
      (d) `get_security_settings` has no anon grant and gives the login thresholds only to super_admin. check-login-attempt reads system_config through service_role, and the only consumers (AcceptInvitePage, ChangePasswordModal, useIdleLogout) read only passwordPolicy and sessionTimeoutMinutes.
    reference: regression-guardian mandate: flag behaviour changes the WP did not ask for
    fix: None required.

  - id: RG-4
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:439; supabase/migrations/20260927000002_r6_maker_checker.sql:158
    evidence: The global default revoke also closes EXECUTE on invoker functions that later migrations create. WP-09's `approval_payload_hash(jsonb)` (`revoke … from public, anon`, so its author meant authenticated to keep it) now has auth=false. `grade_point_for`, `dashboard_can_read`, `dashboard_can_read_finance` and `verify_id_card` lost authenticated EXECUTE compared with the c4ecfac baseline. I checked every caller in views, policies, functions, src/ and supabase/functions. All callers are SECURITY DEFINER or service_role, so nothing breaks. service_role lost no grant; I diffed every public function's privileges between base and head.
    reference: WP-02 plan item 3 ("future functions start closed")
    fix: None required. Optionally change WP-09's revoke to also name `authenticated`, so the file states the intent.

  - id: RG-5
    severity: info
    location: audit/backlog.md:69
    evidence: My anon SELECT probe over every public table (base vs head) shows 11 tables that returned 0 rows before and now return 42501: backup_jobs, data_jobs, feature_flags, health_alerts, restore_jobs, roles, system_config, system_health, user_roles. These are the tables with `{public}` policies. The app queries them only from authenticated settings and platform pages. The change is already in the backlog (WP-06).
    reference: behaviour change (deny path only)
    fix: Already tracked. Scope those policies `to authenticated`.

  - id: RG-6
    severity: minor
    location: .github/workflows/ci.yml:124-143 (semgrep/gitleaks gates)
    evidence: Not verifiable. semgrep 1.95.0 and gitleaks are not installed in this environment, so I did not run `scripts/ci/semgrep-rule-test.py`, the semgrep scan or the secret scan. WP-02 changes only one src file (src/lib/useSecuritySettings.ts) and adds one test.
    reference: §0A.5 ("cannot verify → finding")
    fix: Confirm the security-scan CI job is green on 16548ba.

  - id: RG-7
    severity: info
    location: docs/audits/timhirt-production-fix-plan.md:1869-1873 (§7)
    evidence: Some §7 guards do not exist yet, so I could not re-run them: "Vitest for AcademicRecordTab" (no test in src/), `grade_history_ledger.sql` (WP-08), the `export-bank-transfer` tests (WP-12.2) and the WP-14.1 runtime numerals test. None is caused by WP-02. The DB side of GPA and class rank is covered by class_rank.sql (green), and the conventions gate covers numerals (green).
    reference: §7 Regression Guard
    fix: None for WP-02. The AcademicRecordTab Vitest gap belongs in the backlog if it was expected to exist already.

CHECKED:
  - Read WP-02 (plan §4, lines 329-385), §0A.4, §5 and §7, and both diffs (c4ecfac..7c81fd7 and 67a627d..16548ba), including 16548ba's edits to the WP-09 migration (`approval_required`, `exam_results_published`) and to the maker_checker.sql helper.
  - Full harness on a fresh DB (rv2_wp02_regr): 113 migrations, 65/65 suites green. definer_lockdown 51/51, catalog_definer_security 7/7, catalog_rls_coverage 2/2, maker_checker 65/65, security_settings 8/8, exam_seating_charts 9/9. The only open TODOs are WP-05 and WP-06.
  - §7 guards re-run: resource_permissions* (4 suites), catalog_rls_coverage, catalog_module_gate (1 expected WP-06 TODO), class_rank, grading_scales_lookup and payroll_sod are all green. `conventions.py` and `--self-test` both pass (0 Ge'ez digits).
  - Catalog guards fail on planted offenders: a definer function granted to anon without search_path fails tests 1, 3 and 4; an un-FORCEd table fails rls_coverage #2; an `authenticated` default ACL on public fails #7. All recover after cleanup.
  - app-rpc-grants.py: 23 app RPCs, 0 findings. After revoking `create_import_job` from authenticated it exits 1, and it passes again once re-granted. The dashboard `.rpc(name)` wrapper is covered by the `rpc<T>("…")` pattern.
  - §5 query 1 (anon or unpinned definer functions) and query 2 (tables without RLS/FORCE, including partitioned) return 0 rows. Query 5 (Ge'ez in config) returns 0 rows.
  - Base (c4ecfac) vs head: function privilege diff across all public functions (no service_role loss, and no app-called RPC lost authenticated) and anon SELECT probe on every table (RG-5).
  - All policies and functions that call the narrowed helpers with a non-caller argument: `has_module(tenant_id)` ×58, `messages.recipient_id`, `attendance_retroactive_edit_window_days(tenant_id)` (short-circuits for super_admin), and `v_uid := auth.uid()` in the WP-09 RPCs. The only Edge caller, `_shared/branding.ts` `admin.rpc("has_module")`, runs as service_role and is trusted.
  - WP-00 closures kept: `settle_gateway_payment` and `cleanup_old_audit_logs` have proacl `{postgres=X/postgres}` in both base and head (C-01, RV-05).
  - `definer_inventory.md` regenerated from the head DB with a scratch copy of the generator: byte-identical (74 functions).
  - The migration re-applies without error (idempotent drops and replaces). No already-applied migration was edited: only the pending 20260926000001 and 20260927000001/02 changed.
  - auto_assign_exam_seats body diffed against 20260825000001: only the not-found/cross-tenant merge and the search_path changed.
  - Frontend: useSecuritySettings consumers and the SecuritySettingsPage cache invalidation (prefix key still matches); AcceptInvitePage requires a session, so dropping the anon grant does not break it.
  - Gates: `tsc --noEmit` 0, `eslint src` 0, vitest 16 files / 98 tests, check:i18n 0, check:locales parity OK, build OK. `deno-check.sh` (deno 2.9.6): 28 functions, 3 baselined, OK.
  - Harness re-run on the same DB fails (RG-1). A scratch shim with the reordering fix re-runs green.
  - Cleanup: rv2_wp02_regr and rv2_wp02_regr_base dropped. No deno.lock or __pycache__ left, and `git status` shows no tracked changes (only the ignored `dist/` and `tsconfig.tsbuildinfo` remain).
