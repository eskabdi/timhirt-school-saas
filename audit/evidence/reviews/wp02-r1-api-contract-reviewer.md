REVIEWER: api-contract-reviewer
WP: WP-02 (round 1, commit 7c81fd7 vs c4ecfac)
VERDICT: FAIL

The fail comes from one major (AC-1): a tenant-id helper still granted to signed-in users answers for any tenant. Everything else is minor or info. The harness is green, and the new tests really do fail without the fix.

FINDINGS:
  - id: AC-1
    severity: major
    location: /home/user/rv-wp02/supabase/migrations/20260926000001_r6_definer_lockdown.sql:297 and /home/user/rv-wp02/supabase/security/definer_allowlist.sql:23
    evidence: `attendance_retroactive_edit_window_days(p_tenant_id uuid)` is granted to `authenticated`. Its body reads `tenant_configs` for whatever tenant id it is given. I probed it as a tenant-A student, with tenant B's setting at 30: `student A reads tenant B edit window = 30`. This contradicts three things: plan WP-02 item 4 ("Derive tenant internally in every function that still needs a p_tenant_id parameter for authenticated callers"), the migration header at :30 ("Makes the helpers that take a user or tenant id answer only for the caller"), and /home/user/rv-wp02/docs/insa/_pending-changes.md:167 ("Functions never trust a caller-supplied identity"). The allow-list reason is "a non-sensitive tenant setting".
    reference: finding L-07 (cross-tenant oracle) / OWASP A01 / INSA Phase 3 Access Control / §0A.4 (doc/control mismatch)
    fix: Use the same guard as `has_module`. When `current_setting('role')` is `authenticated` or `anon` and `p_tenant_id is distinct from get_tenant_id_for_user(auth.uid())`, return the default (7) or null. Add a cross-tenant probe to definer_lockdown.sql and update the allow-list reason. The only caller is the `attendance_retroactive_edit_gate` policy, which passes the row's tenant, so behaviour is unchanged for it.
  - id: AC-2
    severity: minor
    location: /home/user/rv-wp02/supabase/migrations/20260926000001_r6_definer_lockdown.sql:256-270
    evidence: `get_security_settings()` still returns the four platform login-lockout thresholds (`login_max_attempts`, `login_attempt_window_minutes`, `login_ip_max_attempts`, `login_ip_window_minutes`) to every signed-in user in every tenant, students and parents included. No client code reads them. A grep of `loginMaxAttempts|loginIp…` outside useSecuritySettings.ts returns nothing, and the super_admin SecuritySettingsPage reads `system_config` directly. Plan item 5 wanted "a service-role-only reader for security thresholds", and L-07 names those thresholds as the oracle. /home/user/rv-wp02/audit/FIXES_VERIFIED_R6.md:569 marks L-07 fixed on the strength of `get_config` alone.
    reference: finding L-07 / INSA data minimisation
    fix: Return the `login_*` keys only to super_admin, and keep `password_*` and `session_timeout_minutes` for other signed-in users. Update security_settings.sql (it asserts a registrar gets `login_max_attempts`) and definer_lockdown.sql:51. Otherwise, record this as an accepted residual.
  - id: AC-3
    severity: minor
    location: /home/user/rv-wp02/supabase/tests/rls/definer_lockdown.sql:57
    evidence: Assertion #20, "has_resource_permission answers only for the caller", also passes on the pre-WP-02 schema. The student has no `students.read` grant, so the old body already returned NULL (probe on the c4ecfac schema: `NULL`). The pair `classes.read` is an open action and does discriminate: I checked that the admin asking about the student gets `NULL` on the new schema, and the student asking about themselves gets `true`.
    reference: plan Rule 4 (failing-then-passing test)
    fix: Probe `('…d0a02','classes','read')` expecting NULL, plus a self-check expecting true.
  - id: AC-4
    severity: minor
    location: /home/user/rv-wp02/audit/FIXES_VERIFIED_R6.md:579
    evidence: Plan step 3 (fix-plan:355-361) and the H-01 fix in Report 3 revoke `create_import_job`, `create_export_job` and `acknowledge_alert` from `authenticated` entirely. The implementation keeps all three callable by signed-in users (the Private class) and adds tenant and school_admin checks inside them. The reason is sound: ImportExportPage.tsx:63/97 and HealthMonitoringPage.tsx:147 call them directly. But this deviation is not in the "recon adjustments" table.
    reference: §0 Rule 10 / §0A.4 (a major must be fixed or accepted and logged)
    fix: Add the deviation as a row with its rationale and get the owner's acceptance.
  - id: AC-5
    severity: minor
    location: /home/user/rv-wp02/supabase/migrations/20260926000001_r6_definer_lockdown.sql:195-233 (policy `data_jobs_write`, predates this commit)
    evidence: The new school_admin gate on `create_export_job`/`create_import_job` is bypassed by a direct PostgREST insert. As a tenant-A student, the RPC gives `rpc denied 42501`, but `insert into data_jobs (… status 'completed', storage_path '<tenant>/evil.csv', entity_type repeat('x',5000))` gives `direct insert ok | 5000 | completed`. The effect stays inside the tenant, and processing still needs the school_admin Edge Function.
    reference: plan WP-06 (authorization parity) / OWASP A01
    fix: Limit `data_jobs_write` to school_admin, and remove INSERT on `status`/`storage_path`, or remove table INSERT entirely so the RPC is the only way to create a job. Add to audit/backlog.md for WP-06.
  - id: AC-6
    severity: minor
    location: /home/user/rv-wp02/supabase/migrations/20260926000001_r6_definer_lockdown.sql:209,229
    evidence: The rewritten create RPCs do not validate input. `p_entity_type` is unbounded text, and `data_jobs` has no CHECK on `entity_type`. `p_file_size` has no bounds and can be negative. process-*-job later rejects unknown entity types with a 400, but the queued row stays behind. There is also no idempotency key, so a double submit creates two jobs.
    reference: plan Rule 6 (allow-list on every input) / api-contract (idempotency for creates)
    fix: Raise `22023` unless `p_entity_type in ('students','teachers','fees')` and `p_file_size` is between 0 and a cap. Put idempotency on the backlog (WP-12).
  - id: AC-7
    severity: minor
    location: `auto_assign_exam_seats` (re-granted at /home/user/rv-wp02/supabase/migrations/20260926000001_r6_definer_lockdown.sql:300 region); `acknowledge_alert` at :235-250
    evidence: The error contract is inconsistent across the allow-listed RPCs.
      - The rewritten functions raise `42501`, which PostgREST turns into 403/401.
      - `auto_assign_exam_seats` raises `P0001` with 'exam_not_found' or 'cross_tenant_denied' (probe: `sqlstate=P0001 msg=exam_not_found`). PostgREST turns that into a 400, and the two messages tell another tenant's exam apart from a missing one.
      - `acknowledge_alert` with a foreign or missing id returns success and changes nothing.
    reference: api-contract status codes (403/404, generic bodies)
    fix: Use one errcode (`42501`, or `P0002` for not found) with the same message for "missing" and "other tenant". Backlog for WP-12.
  - id: AC-8
    severity: minor
    location: /home/user/rv-wp02/supabase/security/definer_inventory.md:21,68 and /home/user/rv-wp02/scripts/db/definer-inventory.py:48
    evidence: `cleanup_old_audit_logs()` and `settle_gateway_payment(…)` are classed "Internal (service_role)" but their EXECUTE column is "—", so service_role cannot call them. The script's `else` branch labels every function with no grantee as Internal.
    reference: plan WP-02 Docs (RPC classification)
    fix: Add a "Disabled (owner only)" class for functions with no grantee.
  - id: AC-9
    severity: minor
    location: /home/user/rv-wp02/supabase/security/definer_inventory.md
    evidence: The RPC classification covers SECURITY DEFINER functions only. Of the 9 other (invoker) RPCs in `public`, 7 are still callable by anon and are in no inventory. Examples: `enroll_admission_application`, `promote_students_batch`, `revert_promotion_run`, `decide_student_leave_request`. RLS still applies to them, so I found no hole.
    reference: plan WP-02 Docs ("API inventory → RPCs classified") / WP-18
    fix: Extend the inventory to every function PostgREST exposes, and revoke anon on the app-only invoker RPCs (WP-06/WP-18).
  - id: AC-10
    severity: minor
    location: /home/user/rv-wp02/audit/FIXES_VERIFIED_R6.md:585-586
    evidence: The evidence says "110 migrations, 63/63 suites" and "fails 17 assertions". My runs show 111 migrations and 64 suites, and 19 of 28 assertions fail on the WP-01 head.
    reference: plan Rule 5 / Rule 10
    fix: Correct the numbers and paste the actual gate output.
  - id: AC-11
    severity: info
    location: repository (no OpenAPI file exists)
    evidence: Not verifiable: there is no OpenAPI spec, so no path, examples or x-insa-category to check for the changed RPCs. Classification is recorded in definer_inventory.md and _pending-changes.md, as Rule 7 allows until WP-18.
    reference: WP-18
    fix: Generate the RPC paths and categories from definer_inventory.md in WP-18.
  - id: AC-12
    severity: info
    location: /home/user/rv-wp02/supabase/migrations/20260926000001_r6_definer_lockdown.sql:46-60
    evidence: Not verifiable: who owns the 65 definer functions in production. `ALTER FUNCTION … SET search_path` needs ownership, so any function not owned by the deploying role aborts the migration. No evidence file records the owners.
    reference: deploy safety
    fix: Before applying, run a read-only query in production for `prosecdef` functions in `public` whose owner is not `postgres`.
  - id: AC-13
    severity: info
    location: /home/user/rv-wp02/src/lib/useSecuritySettings.ts:36 and /home/user/rv-wp02/src/features/auth/useSession.ts:26
    evidence: The query key `["security-settings"]` is not tied to the session, and the cache is cleared only on sign-out. A password-keys-only response fetched as anon can be reused after sign-in, so useIdleLogout uses the default 60-minute timeout until the next refetch (at most 5 minutes).
    reference: client parity
    fix: Include the session user id in the query key.
  - id: AC-14
    severity: info
    location: /home/user/rv-wp02/supabase/migrations/20260926000001_r6_definer_lockdown.sql:173-190
    evidence: `has_module` now also calls `get_tenant_id_for_user` and `get_role_for_user` on every evaluation, and it appears in 57 module-gate policies. I did not measure the cost.
    reference: for the performance-reviewer
    fix: Run EXPLAIN ANALYZE on a module-gated list query.
CHECKED:
  - Read the WP-02 text, §0A.4, Appendix B.12, Report 3 H-01/L-07 and Appendix A-1, and the full diff c4ecfac..7c81fd7 (17 files; no changes under supabase/functions or src).
  - Ran the harness on my own database `rv_wp02_api`: 111 migrations, all 64 suites pass. definer_lockdown 28/28, catalog_definer_security 6/6, catalog_rls_coverage hard.
  - Showed the tests fail without the fix: migrated to the c4ecfac tree (110 migrations) and ran the new definer_lockdown.sql, 19 of 28 fail. #20 passes vacuously (AC-3).
  - Re-applied the migration a second time: no error, guard still 6/6.
  - Regenerated the inventory from a scratch copy of the script: identical to the committed file (65 rows).
  - Nothing still calls the 23 definer functions closed to signed-in users: no invoker function, view, policy, column default or CHECK in public or storage. The detection query was checked against a known helper (it found 255 policy uses).
  - Where a changed helper gets another user's id: in policies only `messages_insert` (same-tenant case still works); in function bodies only `has_permission`/`has_resource_permission`, both guarded.
  - Policies that apply to anon and call helpers anon lost: 20 policies on 9 tables, matching the backlog row. Every app read of those tables is on a signed-in admin page, and check-login-attempt uses the service role.
  - Every Edge Function call to a service_role-only function uses a service-role client: process-*-job, the failJobQuietly callers, the rateLimit client, verify-id, process-library-circulation, and branding `has_module`.
  - The 15 frontend RPC call sites: every definer RPC called is allow-listed, argument names of the changed RPCs are unchanged, and no generated Database types exist.
  - Role parity for the job RPCs: school_admin in the database, in process-*-job `requireRole(["school_admin"])`, and in the DashboardShell nav.
  - Rewritten RPCs return `42501` with a generic message and no ids. For anon, `get_security_settings` returns password_* keys only, and the client falls back to defaults for missing keys.
  - Probes: a student calling `create_export_job` gets 42501; `get_email_for_user` for another user returns NULL; same-tenant `get_role_for_user` returns the role; cross-tenant `has_resource_permission` returns NULL.
  - Nothing can change the `role` setting the helpers rely on: no application function uses dynamic SQL or `set_config('role')` (only pgTAP does), there is no PostgREST pre-request hook, no auth hook, no trigger on `auth.users`, and no storage policy reachable by anon calls a closed helper.
  - `timhirt_view_owner` is created by the already-applied migration 20260715000013, and no migration schedules pg_cron jobs.
  - Not run: tsc, eslint, vitest, build, deno (the diff changes nothing under src or supabase/functions).
  - Cleanup: dropped `rv_wp02_api`; the worktree is clean at 7c81fd7 with no deno.lock or __pycache__.
