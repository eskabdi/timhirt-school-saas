REVIEWER: authz-reviewer
WP: WP-02
VERDICT: FAIL
FINDINGS:
  - id: AZ-1
    severity: major
    location: supabase/migrations/20260719000011_system_health.sql:49 and :55, supabase/migrations/20260719000010_import_export.sql:41 (unchanged by the diff), claims at docs/insa/_pending-changes.md:167-168
    evidence: |
      The RPC and the RLS policy disagree. The lockdown makes the job and health RPCs service_role-only, and limits `create_*_job` to school_admin. But the table policies (`health_alerts_insert`, `system_health_insert`, `data_jobs_write`, all TO PUBLIC and checking only the tenant) still let any role in the tenant do the same thing directly. Probed as a tenant-A **student** (authenticated), against 7c81fd7:
        select public.create_health_alert(A,'security','critical','Your account is locked, call +251')  -> ERROR: permission denied for function create_health_alert
        insert into health_alerts (...) values (A,'security','critical','Your account is locked, call +251') -> 7062a3f3-…|critical|Your account is locked, call +251
        select public.record_health_metric(A,'cpu',99,…) -> ERROR: permission denied
        insert into system_health (tenant_id,metric_type,value,status) values (A,'cpu',99,'critical') -> 5ddf7663-…|critical
        select public.create_export_job(A,'students') -> ERROR: permission denied for tenant
        insert into data_jobs (…, status, storage_path) values (…,'export','students','completed','attacker/path.csv') -> b2cf6c15-…|completed|attacker/path.csv
      ImportExportPage.tsx:118-126 signs a download URL for any job's `storage_path` and shows it to the school_admin. So the A-1 "forged alert" and "completed job with an attacker path" still work inside a tenant, by any role. The INSA text says "`create_export_job`/`create_import_job` only … for a school_admin" and "The job, health … functions are service_role-only", which describes a control the table path bypasses.
    reference: OWASP A01 (Broken Access Control) / INSA Phase 3 Access Control / H-01 (A-1 probe), RLS–RPC parity
    fix: Drop `health_alerts_insert` and `system_health_insert` (service_role bypasses RLS, so Edge and cron are unaffected). Restrict `data_jobs_write` to `to authenticated`, `get_role_for_user(auth.uid()) = 'school_admin'` and `status = 'queued'`, with no `storage_path`/`processed_rows`/`completed_at` (or column-level INSERT grants). Add student and school_admin direct-insert probes to definer_lockdown.sql. Or get explicit human acceptance, logged in the residual-risk register against WP-06.
  - id: AZ-2
    severity: major
    location: supabase/tests/rls/definer_lockdown.sql:57
    evidence: |
      The assertion that is supposed to back "`has_resource_permission` only for the caller" also passes without the fix. I rebuilt my DB at the WP-01 head (c4ecfac shim, 110 migrations) and ran the new suite: 19/28 fail, but
        ok 20 - has_resource_permission answers only for the caller
      Its subject is a student, who has no `students:read`, so the call returned NULL before the fix too. With a subject who holds the permission, the oracle was real before the fix and is closed after it:
        PRE-FIX  (caller student A): has_resource_permission(admin A,'students','read') -> true ; (admin B, tenant B) -> true
        POST-FIX (caller student A): -> NULL ; -> NULL
      No other suite covers a non-caller query as `authenticated`: custom_role_enforcement.sql:150/157 and resource_permissions.sql:242/253 run in a trusted, non-authenticated context. Reverting the guard would leave CI green, yet `_pending-changes.md` cites definer_lockdown.sql as the control.
    reference: OWASP A01 / L-07 (cross-tenant oracle) / §0A.2 test-verifier "fail before / pass after"; CLAUDE.md "Prove a gate fails before trusting that it passed"
    fix: Assert NULL for `has_resource_permission(<same-tenant school_admin>, 'students','read')` and `(<tenant-B school_admin>, …)` as a non-admin caller. Keep one positive self-check. Confirm the new assertions fail on the WP-01 head.
  - id: AZ-3
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:297; supabase/security/definer_allowlist.sql:23
    evidence: |
      `attendance_retroactive_edit_window_days(p_tenant_id)` is granted to authenticated, and its body still trusts the tenant argument. Plan item 4 says every authenticated-callable function with a `p_tenant_id` must derive the tenant internally. Probe as a tenant-A student, with tenant B's config set to 42:
        student A reads tenant B window:|42
    reference: L-07 / WP-02 plan item 4 / OWASP A01
    fix: Apply the same guard as `has_module`: when `current_setting('role')` is authenticated/anon and `p_tenant_id` is not the caller's tenant, return the default (7) or NULL. The policy always passes the row's tenant, so behaviour does not change. Add a cross-tenant probe.
  - id: AZ-4
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:267-273; supabase/tests/rls/definer_lockdown.sql:51
    evidence: |
      Any signed-in user (student probe) gets the platform login thresholds:
        login_max_attempts, login_attempt_window_minutes, login_ip_max_attempts, login_ip_window_minutes, session_timeout_minutes, password_*
      RLS `system_config_read` gives platform rows (tenant_id IS NULL) to super_admin only. No client code reads the four `login_*` keys: only `sessionTimeoutMinutes` and `passwordPolicy` are used (useIdleLogout.ts, AcceptInvitePage.tsx, ChangePasswordModal.tsx). The test locks the exposure in ('a signed-in user also gets the login and session settings'). This is the same threshold oracle L-07 cites (`get_config('login_max_attempts')`), now narrowed from anon to all authenticated users.
    reference: L-07 / WP-02 plan item 5 (security thresholds service_role-only) / RLS–RPC parity
    fix: Non-super_admin callers get only `session_timeout_minutes` and `password_*`. Flip line 51 to assert that `login_*` is absent for a non-super_admin.
  - id: AZ-5
    severity: minor
    location: supabase/security/definer_allowlist.sql:40; supabase/tests/rls/catalog_definer_security.sql (anon exactly `{get_security_settings()}`)
    evidence: |
      The acceptance criterion is "`0` anon-executable definer functions"; the implementation allows one. The stated reason ("Invite page shows the password policy before a session exists") does not match the code. AcceptInvitePage.tsx renders `<PasswordPolicyHint>` and the form only when `hasSession` is true, and ChangePasswordModal needs a session. No page shows the policy without a session.
    reference: WP-02 acceptance tests / H-01
    fix: Revoke the anon grant and make the guard assert zero anon definers. Or record the human's acceptance with a reason backed by the code.
  - id: AZ-6
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:33, :323-332
    evidence: |
      Plan item 3 says "future functions start closed". The migration leaves default privileges unchanged, so on Supabase every new public function is still EXECUTE-able by PUBLIC/anon/authenticated. The replacement control is the CI guard. I planted drift (`grant … get_config to authenticated`, `grant … has_module to anon`, `fail_job search_path = public`) and it failed 3/6 as expected. Not verifiable: whether the rls-tests job is a **required** status check on fix/production-readiness-r6/main (branch protection is outside the repo).
    reference: WP-02 plan item 3 / INSA Phase 3 secure-by-default
    fix: Record the required-check setting as evidence, or state it in _pending-changes as a dependency of this control.
  - id: AZ-7
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:35, :334-345; audit/FIXES_VERIFIED_R6.md (WP-02 row "Production owner postgres has BYPASSRLS (read-only check)")
    evidence: No artifact in audit/evidence records the production `rolbypassrls` for postgres. Not verifiable from here, since production is off-limits. There is strong indirect evidence: `users` and `tenants` were already FORCE'd and the definer helpers work in production.
    reference: G-10 / L-02 FORCE RLS
    fix: Commit the read-only query output (`select rolname, rolbypassrls from pg_roles where rolname in ('postgres','service_role')`) to audit/evidence before deploy.
  - id: AZ-8
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:189-245 (create_export_job, create_import_job, acknowledge_alert); allow-listed auto_assign_exam_seats
    evidence: |
      These RPCs run as the owner and bypass RLS, so WP-07's planned restrictive `imp_mode <> 'read'` policy and the aal2 checks will not cover them. `auto_assign_exam_seats` has no `has_module(…,'gradebook')` check, while the Exams route is module-gated. `requireAccess` does not exist yet: Edge Functions use `requireRole`, and this diff changes no Edge Function. Maker-checker for role, permission and override writes is absent: `roles_admin_manage`, `user_roles_admin_manage`, `user_permission_overrides_write` are school_admin-only with no approval. That is pre-existing, WP-09 scope.
    reference: WP-06 / WP-07 / WP-09 forward dependencies
    fix: Backlog entries so that WP-06/07 add module, imp_mode and aal2 checks inside every writing definer RPC, not only in policies.
  - id: AZ-9
    severity: info
    location: audit/FIXES_VERIFIED_R6.md (WP-02 "Gate (local)")
    evidence: It says "pgTAP: 110 migrations, 63/63 suites" and "fails 17 assertions". My run: 111 migrations, 64/64 suites green. Pre-fix, 19/28 assertions fail.
    reference: Rule 10 record keeping
    fix: Correct the counts.
CHECKED:
  - Read WP-02, §0A.4, Report 3 H-01/L-07 and the Appendix A-1 probes; reviewed the full diff c4ecfac..7c81fd7.
  - The harness on my own DB rv_wp02_authz: 111 migrations, 64/64 suites green (TODOs only for WP-05/WP-06); exit 0.
  - Pre-fix run (c4ecfac shim + 110 migrations): 19/28 of the new definer_lockdown.sql assertions fail, so the suite has teeth, except #20 (AZ-2).
  - The migration re-applies cleanly on top of itself (idempotent).
  - The catalog guard fails on planted grant and search_path drift (negative control).
  - Regenerated the inventory to the scratchpad: byte-identical to the committed definer_inventory.md (65 functions).
  - No policy, view, column default, CHECK, or invoker/trigger function body references a definer function that authenticated (or timhirt_view_owner) lost. Positive control on the same query found 321 policy callers of get_tenant_id_for_user.
  - Only `messages_insert` passes a non-caller id to the narrowed helpers, and it fails closed on NULL. Nested calls in has_permission/has_resource_permission pass `p_user_id`, already pinned to the caller.
  - Anon/PUBLIC policies that now raise 42501 are exactly the 9 tables in the backlog. No anon-facing page queries them (public pages use Edge Functions; the Login/AcceptInvite/SSO pages use auth only).
  - Every app RPC is either allow-listed or a non-definer function that authenticated can still execute. That includes the generic dashboard wrapper names.
  - Every Edge Function RPC (complete_job, update_job_progress, fail_job, has_module in branding.ts, library_*, verify_document, consume_rate_limit) uses a service_role client. Library RPCs take the tenant from `requireRole` ctx. No direct Postgres connections from Edge.
  - The `current_setting('role')` trust model works inside SECURITY DEFINER (probes show authenticated callers get NULL/false for others, service_role gets full answers). No end-user path runs with the role GUC unset.
  - Cross-tenant: admin A cannot read B's email/role/tenant, cannot create jobs in B, cannot ack B's alerts, and has_module(B) is false. The underlying tenants and tenant_module_overrides rows for B are not readable either.
  - Suspended tenant: has_module(own) is false, create_export_job(own) is denied, acknowledge_alert(own) is a no-op.
  - RPC/route/Edge role parity for import-export and health-monitoring: school_admin in all three. The RLS insert policies are broader (AZ-1).
  - users_self_update (get_email_for_user self-only), timhirt_view_owner views (no lost helpers), and system_config/feature_flags RLS (platform rows super_admin-only).
  - Worktree left clean (no deno.lock/__pycache__); database rv_wp02_authz dropped.

No files were written in /home/user/rv-wp02. My only temporary files are in the session scratchpad.
