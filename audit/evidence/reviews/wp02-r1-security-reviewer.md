REVIEWER: security-reviewer
WP: WP-02 (round 1, commit 7c81fd7 vs c4ecfac)
VERDICT: FAIL

The main fix works: I re-ran every Appendix A-1 probe myself and each one is now denied, and the full harness is green. It fails on two majors: a planned control is missing without recorded owner acceptance, and one acceptance criterion is not met.

FINDINGS:
  - id: SEC-1
    severity: major
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:323 (also docs/insa/_pending-changes.md:174)
    evidence: WP-02 item 3 requires "future functions start closed" (ALTER DEFAULT PRIVILEGES). The migration drops this ("4. Future functions: guarded in CI, not by default privileges"). The INSA doc confirms the gap: "A new definer function therefore starts open, and CI fails it until its migration revokes and re-grants". The CI guard (catalog_definer_security.sql) only sees functions that reach the harness through repo migrations. Nothing detects a definer function created on production outside that path (SQL editor, drift). This residual is prose only. It has no D-xx entry with owner acceptance in the decisions register (_pending-changes.md:88-89 is where D-03/D-04 live).
    reference: WP-02 item 3; OWASP A05; H-01; §0A.4 severity rule (a missing control needs a fix or human acceptance)
    fix: Either (a) add `alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;` plus the global `alter default privileges for role postgres revoke execute on functions from public;`, and adjust the shim/pgTAP install order so harness extensions still work; or (b) record an owner-accepted D-xx entry for this residual and add a read-only production drift check (catalog grants vs definer_allowlist.sql) to the deploy runbook.
  - id: SEC-2
    severity: major
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:316, supabase/security/definer_allowlist.sql:40, supabase/tests/rls/catalog_definer_security.sql:39
    evidence: The acceptance criterion is "`0` anon-executable definer functions". The migration adds a new `grant execute on function public.get_security_settings() to anon;`. The original 20260806000001 revoked it from PUBLIC and granted authenticated only; anon reached it solely through Supabase's default grant. The catalog test was rewritten to pin `array['get_security_settings()']`. The stated reason ("invite page shows the password policy before a session exists") does not match the code. AcceptInvitePage.tsx renders the form only when `hasSession` is true. supabase-js `_getAccessToken` → `auth.getSession()` waits for `initializePromise` (which includes detectSessionInUrl) before sending the RPC, so the call already carries the invited user's token.
    reference: WP-02 acceptance tests bullet 1; H-01; OWASP A01
    fix: Revoke from anon, remove the anon branch at line 273 and the allow-list row, and assert zero anon-executable definer functions.
  - id: SEC-3
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:261-274; supabase/tests/rls/definer_lockdown.sql:51
    evidence: My probe as a tenant-A student returned `{"login_max_attempts": 5, "login_ip_max_attempts": 20, "login_ip_window_minutes": 15, "login_attempt_window_minutes": 15, ...}`. The app only reads `sessionTimeoutMinutes` and `passwordPolicy` from useSecuritySettings. The platform page reads system_config directly. So the "platform security thresholds" disclosure from L-07 is still open to every signed-in user in every tenant, against WP-02 item 5 ("service-role-only reader for security thresholds"). A test enshrines it.
    reference: L-07; WP-02 item 5; OWASP A01/A04 (information exposure)
    fix: Return login_* keys only to super_admin or service contexts; for other users return session_timeout_minutes and password_* only. Invert test 14.
  - id: SEC-4
    severity: minor
    location: supabase/security/definer_allowlist.sql:23 (function attendance_retroactive_edit_window_days(uuid))
    evidence: The function body is `... from public.tenant_configs tc where tc.tenant_id = p_tenant_id` with no caller check, and it is granted to authenticated. My probe: a tenant-A student calling `attendance_retroactive_edit_window_days('<tenant B>')` got `7`. This contradicts plan item 4 ("derive tenant internally in every function that still needs a p_tenant_id parameter for authenticated callers"). It also contradicts _pending-changes.md:167 ("Functions never trust a caller-supplied identity").
    reference: L-07; WP-02 item 4
    fix: Use the same guard as has_module (for end-user roles, a p_tenant_id other than the caller's tenant falls back to the default), or derive the tenant internally. Add a cross-tenant probe.
  - id: SEC-5
    severity: minor
    location: supabase/tests/rls/definer_lockdown.sql:57
    evidence: `has_resource_permission('<student A>', 'students', 'read')` as admin A, expecting null, passed on the pre-fix database ("ok 20") because the student has no students.read. A pre-fix probe of a student asking about admin A returned `t`. So the new "answers only for the caller" guard has no test that fails without the fix.
    reference: CLAUDE.md "Prove a gate fails before trusting that it passed"; WP-02 tests
    fix: Probe as student A asking about admin A (expect null), and as service_role asking about admin A (expect true).
  - id: SEC-6
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:81,103,120,135,178
    evidence: Trust is a deny-list: `coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon')` means "trusted with any id". Any other role that can reach these helpers counts as a service context and fails open, for example a future custom JWT role set by an access-token hook, or a role granted EXECUTE. The catalog guard only checks EXECUTE for anon, authenticated and timhirt_view_owner. The model is sound for today's roles: end users cannot change the role GUC, authenticated has no role memberships, and `public.set_config` does not exist.
    reference: OWASP A01 (fail-closed design); PostgreSQL "Writing SECURITY DEFINER functions safely"
    fix: Allow-list the trusted contexts instead (`in ('service_role','none')`). Extend the catalog guard to flag EXECUTE on definer functions for any role outside {postgres, service_role, allow-listed}.
  - id: SEC-7
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:170-188
    evidence: 58 module-gate policies call `has_module(tenant_id, …)` once per row. The new guard adds get_tenant_id_for_user and get_role_for_user lookups on every call. 20,000 calls took 2,572 ms as authenticated vs 274 ms as service_role. On a real table, `select count(*) from students` (5,000 rows, school_admin) took 1,863–2,070 ms with the old body and 2,664–2,848 ms with the new one (about +40%). This is an availability cost for the performance reviewer. The plan's tenant-less `has_module(p_module)` could be wrapped as `(select …)` in policies and run once per statement instead of once per row.
    reference: WP-02 item 4; availability (performance-reviewer)
    fix: Implement item 4 as specified (tenant-less has_module in initplan form in policies, keeping the service-only tenant_has_module), or make the guard evaluate once per statement.
  - id: SEC-8
    severity: minor
    location: audit/FIXES_VERIFIED_R6.md:585-586
    evidence: The recorded gate reads "pgTAP: 110 migrations, 63/63 suites" and "definer_lockdown.sql fails 17 assertions". The tree has 111 migrations and 64 suites, and on the WP-01 head I saw 19 of 28 assertions fail. The recorded evidence is not the output for this commit.
    reference: §0A.5 (release-gatekeeper requires genuine gate output)
    fix: Re-run the gates on 7c81fd7 and record the actual output.
  - id: SEC-9
    severity: info
    location: supabase/tests/shim.sql:47; src/features/auth/RequireAuth.tsx:7
    evidence: (a) The shim comment still points to the deleted `supabase/security/definer_anon_known.sql`. (b) useIdleLogout calls useSecuritySettings before auth, under the shared key ["security-settings"]. An anon result (now password_* only, with no session_timeout_minutes) can be served from cache after login until refetch, so idle-logout briefly falls back to the 60-minute default.
    reference: L-10 docs accuracy; session management
    fix: Update the comment. Key the query by user id, or enable it only when authenticated.
  - id: SEC-10
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:47-60, 334-344
    evidence: Not verifiable locally (the harness postgres is a superuser):
      (a) Production postgres has BYPASSRLS, which the 11 new FORCE RLS tables rely on. There is only indirect evidence (users was already FORCEd and the helpers work in production), and no evidence file.
      (b) Every public definer function in production is owned by postgres (ALTER FUNCTION … SET search_path needs ownership).
      (c) Supabase Storage and Realtime set the `role` GUC to the JWT role, which the SEC-6 trust model depends on.
    reference: §0A.5 ("not verifiable" rule)
    fix: Add read-only pre-flight queries to the deploy note (`select rolbypassrls from pg_roles where rolname='postgres'`; `select proowner::regrole, count(*) from pg_proc … where prosecdef group by 1`) and commit their output as evidence.
  - id: SEC-11
    severity: info
    location: audit/backlog.md (WP-02 row 1)
    evidence: Anon reads of 9 admin tables whose policies apply to PUBLIC (backup_jobs, restore_jobs, roles, user_roles, system_config, feature_flags, data_jobs, system_health, health_alerts) now fail with 42501 "permission denied for function get_tenant_id_for_user" instead of returning empty. This fails closed but puts an internal function name in PostgREST errors. No anon-readable view or anon-insertable default uses a revoked function. It is already in the backlog for WP-06.
    reference: OWASP A05 (error detail)
    fix: Scope those policies `to authenticated` (WP-06).

CHECKED:
  - Read WP-02 (plan §WP-02, §0A.4/0A.5), H-01/L-07/G-10 and Appendix A-1 in report 3, and the full diff c4ecfac..7c81fd7 (17 files).
  - Ran the full harness on my own DB rv_wp02_security: every migration applied, all suites passed ("All suites passed"); 111 migration files and 64 suites in the tree. Only catalog_module_gate and catalog_storage_policies still carry TODOs.
  - Fail-before: rebuilt the DB with the 110 pre-WP-02 migrations. definer_lockdown failed 19/28, catalog_definer_security 3, catalog_rls_coverage 1. After applying the migration (twice, to check idempotency) all passed, as did security_settings.
  - Catalog after migration: all 65 public definer functions pin `search_path=public, pg_temp`. Only get_security_settings() is anon-executable. Authenticated and timhirt_view_owner grants match definer_allowlist.sql exactly, and the inventory class counts match the live catalog (1/23/23/18).
  - My own probes: anon denied on update_job_progress, record_health_metric, is_feature_enabled, verify_document, consume_rate_limit, library_return and attendance_retroactive_edit_window_days. A student is denied acknowledge_alert, create_import_job, get_config and library_checkout. Admin A cannot create a tenant-B import job, cannot complete or fail a job, gets has_module(B)=false, and a cross-tenant acknowledge_alert changes nothing. super_admin keeps has_module on any tenant but cannot read tenant-B roles.
  - Only messages_insert passes another user's id to the narrowed helpers (same tenant). No policy, invoker function, view, default, check constraint or index calls a revoked definer function. Definer callers of revoked functions (dashboard_*, get_class_rank, library_checkout) run as the owner, so they keep working.
  - Every app `.rpc()` target is allow-listed or an invoker function. Every Edge Function `.rpc()` goes through a service-role client (requireRole adminClient, verify-id, the limiter), and branding has_module is called with the admin client.
  - Re-created bodies (has_resource_permission, has_module, get_tenant_id_for_user) match their latest prior definitions apart from the guard, so no earlier fix was reverted.
  - No definer body calls an extension function unqualified, so pinning search_path is safe. No definer function was previously pinned to a non-public path.
  - Injection: `format('%s', oid::regprocedure)` prints quoted identifiers, so it is safe. definer-inventory.py uses a fixed SQL string, no shell=True, and re.escape. No PostgREST filter or dynamic SQL is built from input.
  - Error messages are generic ('permission denied for tenant/alert'). No secrets in the diff.
  - Role GUC tampering: authenticated and anon have no role memberships and `public.set_config` does not exist.
  - N/A in this diff, confirmed by file list (no src or Edge Function changes): XSS, CSRF, SSRF, uploads, crypto, rate limits on Edge endpoints. I did not run tsc, eslint, vitest or build.
  - Cleanup: dropped rv_wp02_security; the worktree has no changes (git status empty, no deno.lock or __pycache__). Scratch probe files are under /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/.
