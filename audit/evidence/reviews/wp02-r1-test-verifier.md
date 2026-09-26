REVIEWER: test-verifier
WP: WP-02 (round 1, commit 7c81fd7 against base c4ecfac)
VERDICT: FAIL

FINDINGS:
  - id: TV-1
    severity: major
    location: supabase/tests/rls/definer_lockdown.sql:57
    evidence: The only probe for the `has_resource_permission` change is `select is(public.has_resource_permission('…0d0a02' /*student*/, 'students', 'read'), null, …)`, run as admin A. It passes on the pre-change code. When I ran the new suite against base migrations, assertion 20 printed `ok`. The committed probe returns NULL before and after the change. Mutation M1 removed the new `case when … p_user_id is distinct from auth.uid() then null` guard (migration line ~135) and all 64 suites still passed. A probe that does discriminate is a student asking about the admin: it returns `true` on base and `NULL` on HEAD.
    reference: H-01 (the migration header lists has_resource_permission as trusting a caller-supplied id); §0A test-verifier "fail before / pass after"; §0 Rule 4
    fix: Change the probe so the target user actually holds the permission. For example, run as student A and assert `has_resource_permission('<admin A>','students','read') is null`. Add a positive control so admin A still gets `true` for their own id.

  - id: TV-2
    severity: major
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:215 (create_import_job), :235 (acknowledge_alert role check)
    evidence: Mutation M2 set the tenant/role guard in `create_import_job` to `if false` and 64/64 suites passed. No suite calls `create_import_job` at all. Mutation M3 removed the `school_admin` check in `acknowledge_alert` and 64/64 suites passed. Report 3 H-01 names `create_import_job(p_tenant_id)` as a cross-tenant write. `docs/insa/_pending-changes.md` claims both controls ("only in the caller's tenant and only for a school_admin").
    reference: H-01; OWASP A01; missing test for a documented control
    fix: Add probes to definer_lockdown.sql: admin A `create_import_job(<B>,…)` → 42501; student A `create_import_job(<A>,…)` → 42501; admin A in own tenant → a job id. Also: a non-admin in tenant A calls `acknowledge_alert` on a tenant-A alert → 42501, and the row stays unacknowledged.

  - id: TV-3
    severity: major
    location: supabase/tests/rls/catalog_definer_security.sql:32-37; acceptance criterion "Full existing suite still green (proves the allow-list is complete)"
    evidence: Mutation M16 revoked EXECUTE from `authenticated` on `check_staff_employee_linkage()`, `create_import_job(uuid,text,integer)` and `dashboard_alerts(date,date)`, and removed the same rows from definer_allowlist.sql. Every suite passed. No suite calls these three app RPCs as `authenticated`, so the claim that "the suite proves the allow-list is complete" is false for them. The Import page, the Health Monitoring card and the dashboard alerts would break without any test failing.
    reference: WP-02 acceptance criterion 4; §0A test-verifier
    fix: Add a guard (pgTAP or CI script) asserting that every definer function reached by `supabase.rpc('<name>')` in `src/` is allow-listed for `authenticated`. `scripts/db/definer-inventory.py` already computes the "App callers" column. Alternatively, add an authenticated smoke call for each of the three RPCs.

  - id: TV-4
    severity: major
    location: supabase/tests/rls/catalog_definer_security.sql:38-40; supabase/migrations/20260926000001_r6_definer_lockdown.sql:316
    evidence: The WP test criterion is "`0` anon-executable definer functions". The guard instead asserts `array['get_security_settings()']`, meaning exactly one, and the migration runs `grant execute on function public.get_security_settings() to anon`. FIXES_VERIFIED's "adjusted" table (items 3–5) does not record this deviation, and I found no recorded human acceptance.
    reference: WP-02 Tests bullet 1; §0A.4 severity rules (acceptance criterion / doc–control mismatch)
    fix: Either (a) make the anon path non-definer so the guard can assert 0. Examples: a SECURITY INVOKER function, or a view, plus an anon SELECT policy on `system_config` rows `tenant_id is null and key like 'password\_%'`. Or (b) get explicit human acceptance, record it in FIXES_VERIFIED and the residual-risk register, and amend the WP text.

  - id: TV-5
    severity: major (not verifiable)
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:335-345; audit/FIXES_VERIFIED_R6.md:571
    evidence: FORCE RLS on data_jobs, health_alerts, system_health, roles, user_roles and the other forced tables is only safe if the production owner (postgres) has BYPASSRLS. Postgres-owned definer functions write or read these tables without an end-user JWT: `complete_job`, `update_job_progress`, `fail_job`, `create_health_alert`, `record_health_metric`, and `has_resource_permission` reading roles and user_roles. FIXES_VERIFIED says "Production owner postgres has BYPASSRLS (read-only check)", but there is no evidence file in audit/evidence/. Locally, `pg_roles` shows `postgres|t|t` (superuser), so the harness cannot detect a FORCE-RLS breakage on this path in any test.
    reference: §0A.5 ("cannot verify → finding"); CLAUDE.md "Verification means running the thing"
    fix: Commit read-only production evidence covering `select rolname, rolsuper, rolbypassrls from pg_roles where rolname='postgres'` and `pg_get_userbyid(relowner)` for the 11 tables. Better still, add a harness probe that runs these definer paths with a non-superuser BYPASSRLS owner.

  - id: TV-6
    severity: minor
    location: supabase/security/definer_allowlist.sql:23
    evidence: `attendance_retroactive_edit_window_days(p_tenant_id)` is still granted to authenticated and returns any tenant's setting. WP item 4 says to "derive tenant internally in every function that still needs a p_tenant_id parameter for authenticated callers". No test covers it.
    reference: L-07 (cross-tenant oracle class)
    fix: Return the default unless `p_tenant_id = get_tenant_id_for_user(auth.uid())` for end users, and add a cross-tenant probe.

  - id: TV-7
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:180
    evidence: Mutation M4 removed the super_admin carve-out in `has_module` and 64/64 suites passed, so the branch is untested.
    reference: §0A test-verifier
    fix: Add a probe where a super_admin gets the real answer for another tenant. If nothing needs the branch, drop it.

  - id: TV-8
    severity: minor
    location: audit/FIXES_VERIFIED_R6.md:585-586
    evidence: The record says "110 migrations, 63/63 suites" and "definer_lockdown.sql fails 17 assertions" on the WP-01 head. My runs of this commit: 111 migrations and 64 suites, all green. Against base migrations, definer_lockdown fails 19/28 (1–10, 12, 15–17, 19, 21, 24–26). The gate output in the record is not from this commit.
    reference: §0A test-verifier ("gate output genuine"); Rule 5
    fix: Re-paste the actual gate output for 7c81fd7.

  - id: TV-9
    severity: minor
    location: audit/FIXES_VERIFIED_R6.md:573-580
    evidence: Some plan deviations are not in the "adjusted" table. `get_email_for_user` stays granted to authenticated; the plan says service_role only and revoke from authenticated. `create_export_job`, `create_import_job` and `acknowledge_alert` stay granted to authenticated; the plan and Report 3 H-01 say revoke job/health functions from authenticated entirely. The implementation's reasons (a policy caller and app callers) are sound, and the first two are tested.
    reference: §0 Rule 1 / Rule 10
    fix: List these as recorded adjustments with the reason.

  - id: TV-10
    severity: info
    location: supabase/tests/rls/catalog_definer_security.sql:42
    evidence: The regex `'^search_path=(""|.*\mpg_temp)$'` accepts any schema list that ends in pg_temp, for example `search_path=untrusted, pg_temp`.
    reference: G-10
    fix: Pin it to `^search_path=(""|public, pg_temp)$`, or an explicit trusted set.

  - id: TV-11
    severity: info
    location: supabase/tests/rls/definer_lockdown.sql:32-43
    evidence: `throws_ok(…, '42501', null, …)` would also pass on "permission denied for schema public" if the shim's USAGE grant regressed. It is backstopped today by catalog assertion 3, which uses `has_function_privilege`.
    reference: L-08 (vacuous anon probes)
    fix: Pin the message pattern, for example `'permission denied for function %'` via `throws_like`.

  - id: TV-12
    severity: info
    location: supabase/tests/rls/catalog_definer_security.sql:25-29
    evidence: The guard compares grants only for anon, authenticated and timhirt_view_owner. A grant to any other non-owner role would pass.
    reference: H-01
    fix: Compare every grantee except the owner and service_role.

  - id: TV-13
    severity: info
    location: .gitignore:21; supabase/security/definer_inventory.md
    evidence: The `node_modules` ignore entry is unrelated to WP-02 (it is there for a symlinked worktree). The inventory is reproducible (I regenerated it and the output was identical) but no CI check catches drift. `cleanup_old_audit_logs()` and `settle_gateway_payment(…)` are labelled "Internal (service_role)" even though no role has EXECUTE on them.
    reference: §0A regression-guardian scope; plan §1703 (generated docs checked in CI)
    fix: Drop or justify the .gitignore line. Add a "No grantee" class. Optionally add a CI drift check for the inventory.

CHECKED:
  - Read the WP-02 text and acceptance criteria, §0A.4, Report 3 H-01, L-07 and Appendix A-1, and the full diff c4ecfac..7c81fd7 (17 files; no changes under src/ or supabase/functions/).
  - pgTAP at HEAD on the fresh DB rv_wp02_tv: 111 migrations, 64/64 suites green. definer_lockdown 28/28, catalog_definer_security 6/6, catalog_rls_coverage 2/2. The only TODOs left are WP-05 and WP-06.
  - Fail-before: I ran the HEAD test files and shim against base migrations (DB rv_wp02_tv_base). catalog_definer_security failed 3/6, catalog_rls_coverage failed 1/2, and definer_lockdown failed 19/28. Assertion 20 (has_resource_permission) passed on base, which is TV-1. Assertion 11 (cleanup_old_audit_logs) passes on base because WP-00 already fixed it.
  - Mapping of acceptance criteria to tests:
    - "0 without search_path" → catalog test 4 (fails before).
    - "0 anon-executable" → catalog test 3 asserts 1, not 0 (TV-4).
    - A-1 anon probes (get_email_for_user, create_health_alert, complete_job, get_config) → definer_lockdown 1, 9, 10, 6.
    - Tenant-A admin probes create_export_job(B) → 21, and has_module(B) → 19.
    - "Full suite green proves the allow-list" → not proven for 3 RPCs (TV-3).
  - Mutation tests on cloned DBs:
    - Killed: M5/M6 (same-tenant arms, caught by messages.sql and definer_lockdown 18), M7 (acknowledge_alert tenant scope), M8 (anon filter in get_security_settings), M9 (get_email_for_user), M11 (create_export_job role check), M12 (role-GUC check changed to an auth.uid() check), M13 (FORCE removed), M14 (extra grant), M15 (has_module always false).
    - Survived: M1, M2, M3, M4, M16.
  - Migration re-run: I applied the migration a second time on a migrated DB and all 64 suites stayed green.
  - Replaced function bodies compared with base: only the new guards were added. Volatility and return types are unchanged, and the has_resource_permission body is identical apart from the CASE wrapper.
  - No non-definer function, view, policy, column default or CHECK constraint calls a function that is now revoked. The dashboard_*, get_class_rank and library callers are all definer functions.
  - Every call site of the identity helpers passes auth.uid() or jwt_user_id(), except messages_insert (recipient_id, same-tenant arm, killed by M5/M6).
  - Every app `.rpc()` target that is a definer function is allow-listed. Every Edge Function RPC to a service-role-only function uses a service-role client (adminClient, admin, db with SERVICE_ROLE_KEY, the rate limiter).
  - Policies that apply to PUBLIC and call helpers anon can no longer execute (9 tables): only authenticated app pages query those tables. The anon 42501 behaviour change is logged in the backlog.
  - No skip, only or self-granting probes in the new or changed suites; probes use `set local role anon`, `authenticated` and `service_role`.
  - Inventory script re-run in a scratch copy: output identical to the committed file.
  - Other gates: `tsc --noEmit` exit 0; `eslint src` exit 0; `vitest run` 14 files and 88 tests passed; `deno-check.sh` covers 28 functions with 3 baselined, ok; `deno test supabase/functions` 37 passed, 0 failed; `check:i18n` 0; `check:locales` passed.
  - Not verified: whether production postgres has BYPASSRLS (TV-5); deploy to production; `npm run build` and semgrep (no src changes); EXPLAIN on the extra lookups `has_module` now does per row (left to performance-reviewer).
  - Cleanup: the worktree is clean (no deno.lock or __pycache__), and I dropped every rv_wp02_tv* database and removed /tmp/rv_wp02_testverifier.
