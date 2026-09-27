REVIEWER: tenant-isolation-auditor
WP: WP-02
VERDICT: FAIL

FINDINGS:
  - id: TI-1
    severity: blocker
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:297 (re-grant); supabase/security/definer_allowlist.sql:23; body at supabase/migrations/20260821000005_attendance_audit_and_retroactive_gate.sql:42
    evidence: |
      `attendance_retroactive_edit_window_days(p_tenant_id uuid)` is granted to `authenticated` again. It returns `tenant_configs.settings->>'attendance_retroactive_edit_days'` for whatever tenant id the caller passes. Its body does no caller or tenant check. My probe ran as the tenant-A school_admin, with tenant B configured to 30 days:
        select public.attendance_retroactive_edit_window_days('<tenant B>');
        not ok 7 - A: B attendance window NOT readable (expect default 7, B has 30)
        #         have: 30
        #         want: 7
      Any signed-in user of any tenant can call it through /rest/v1/rpc. The repo already treats this pattern as a cross-tenant read: supabase/tests/rls/dashboard_aggregates.sql:244-246 says "dashboard_teaching_days takes a tenant id as an argument, so calling it directly would be a cross-tenant read. It is revoked from authenticated". The allow-list justifies the grant as "a non-sensitive tenant setting". docs/insa/_pending-changes.md:167 says "Functions never trust a caller-supplied identity", which this function contradicts. The data is low-sensitivity, but it is a direct read of another tenant's data.
    reference: OWASP A01 / INSA Phase 3 Access Control / L-07 (cross-tenant oracles) / WP-02 Changes item 4 ("Derive tenant internally in every function that still needs a p_tenant_id parameter for authenticated callers")
    fix: |
      Scope the answer to the caller's tenant, using the same pattern as has_module. For another tenant it returns the default 7, so nothing leaks:
        create or replace function public.attendance_retroactive_edit_window_days(p_tenant_id uuid)
        returns integer language sql stable security definer set search_path = public, pg_temp as $$
          select coalesce(
            (select (tc.settings->>'attendance_retroactive_edit_days')::int
             from public.tenant_configs tc
             where tc.tenant_id = p_tenant_id
               and (coalesce(current_setting('role', true), 'none') not in ('authenticated','anon')
                    or p_tenant_id = public.get_tenant_id_for_user(auth.uid()))),
            7);
        $$;
        revoke execute on function public.attendance_retroactive_edit_window_days(uuid) from public, anon, authenticated;
        grant execute on function public.attendance_retroactive_edit_window_days(uuid) to authenticated;
      I ran this in a rolled-back transaction and attendance_audit_and_retroactive_gate.sql stays 7/7. Also:
        - Add a tenant-A vs tenant-B probe to definer_lockdown.sql.
        - Update the allow-list reason.
        - Correct the _pending-changes.md:167 claim.
  - id: TI-2
    severity: minor
    location: supabase/migrations/20260825000001_exam_seating_charts.sql:57-60 (re-granted to authenticated at 20260926000001_r6_definer_lockdown.sql:300)
    evidence: |
      Tenant-A admin, tenant-B exam id → "ERROR: cross_tenant_denied"; random uuid → "ERROR: exam_not_found". Two different errors confirm whether an exam id exists in another tenant. This predates WP-02 and exposes only existence (the ids are random UUIDs), but it is the L-07 oracle class and WP-02 re-grants the function.
    reference: L-07 / OWASP A01 (information exposure)
    fix: Raise one error for both cases (e.g. 'exam_not_found'), or check the tenant in the lookup (`where id = p_exam_id and tenant_id = get_tenant_id_for_user(auth.uid())`). Update exam_seating_charts.sql:103 to match.
  - id: TI-3
    severity: minor
    location: supabase/tests/rls/definer_lockdown.sql:1-79
    evidence: 24 functions are granted to authenticated. definer_lockdown.sql probes about 8 of them cross-tenant. There is no rule that every allow-listed function taking an id must have a tenant-A vs tenant-B probe, and that gap is how TI-1 got through. I ran create_import_job(B), get_email_for_user(B user), has_resource_permission(B user), check_staff_employee_linkage, get_class_rank and get_student_grade_history cross-tenant myself; all pass, but none of those runs is committed.
    reference: WP-02 Tests; §0A.2 tenant-isolation-auditor ("cross-tenant probe tests exist and pass")
    fix: Add a cross-tenant assertion in definer_lockdown.sql for every allow-listed `authenticated` function with a uuid parameter. Optionally add a catalog assertion that fails when an allow-listed function takes a uuid argument and has no matching probe-list entry.
  - id: TI-4
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:256-274; audit/FIXES_VERIFIED_R6.md:569
    evidence: |
      get_security_settings() still returns login_max_attempts, login_attempt_window_minutes, login_ip_max_attempts and login_ip_window_minutes to every authenticated user in every tenant, including students and parents. In src, only the password policy and session timeout from this hook are used; the login_* keys are mapped in useSecuritySettings.ts but nothing else references them. L-07 names "the platform security thresholds" as part of the oracle, and WP-02 item 5 asks for a service-role-only reader for security thresholds. FIXES_VERIFIED marks L-07 fixed. This is platform data, not tenant data, so it is not a cross-tenant issue.
    reference: L-07 / WP-02 Changes item 5
    fix: For authenticated, return only session_timeout_minutes and password_*. Or record the deviation, with human acceptance, in the residual-risk register.
  - id: TI-5
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:81,103,120,137,172,275 (also the pattern mandated in CLAUDE.md)
    evidence: |
      Trust is decided by a deny-list: `coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon')` means "trusted, answer for any id". Any other role that could run SET ROLE in future would be trusted automatically (fail-open), for example a new PostgREST role or a custom JWT role. I found no bypass today:
        - No function sets `role`.
        - No proconfig sets role.
        - authenticated is not a member of service_role.
    reference: OWASP A01 (fail-safe defaults)
    fix: Invert the check to an allow-list of trusted contexts, e.g. `current_setting('role', true) in ('service_role', 'none')`. Add a pgTAP case showing that an unexpected role gets caller-only answers.
  - id: TI-6
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:319-328
    evidence: WP-02 item 3 says "future functions start closed" (alter default privileges … revoke execute). The migration deliberately leaves default privileges unchanged and relies on catalog_definer_security.sql instead. I mutation-tested that guard and it works (see CHECKED). It only runs in CI, so a definer function created outside migrations (e.g. in the SQL editor) starts executable by anon and authenticated. The residual is documented in _pending-changes.md.
    reference: WP-02 Changes item 3
    fix: At minimum, add `alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;` to remove Supabase's explicit grants. Otherwise log the deviation as accepted by the human.
  - id: TI-7
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:331-341; audit/FIXES_VERIFIED_R6.md
    evidence: |
      Not directly verifiable: FORCE RLS on the 11 tables is safe only if the production owner (postgres) has BYPASSRLS. No evidence file records rolbypassrls; FIXES_VERIFIED only says "(read-only check)". In the harness, postgres is a superuser, so the harness cannot test this. Indirect proof is strong:
        - audit/evidence/wp00-prod-catalog-diff-20260924T221703Z.txt:620 shows `rls|public.users|true|true`.
        - users policies apply only to authenticated.
        - The postgres-owned definer helpers read users, and production works.
    reference: INSA evidence requirement
    fix: Record `select rolname, rolbypassrls from pg_roles where rolname='postgres'` in the WP-02 pre-deploy evidence.
  - id: TI-8
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:166-185 (has_module)
    evidence: has_module runs per row in 57 restrictive gates and now makes two extra nested definer calls. EXPLAIN ANALYZE of `select count(*) from students` (20k rows, school_admin): old body 8102/8047 ms, new body 10168/10455 ms, about +27%. The baseline is already slow; that is not caused by WP-02.
    reference: §0A.3 performance-reviewer (for their assessment)
    fix: Leave to the performance reviewer (e.g. compare with `(select get_tenant_id_for_user(auth.uid()))` initplans in the gate policies).
  - id: TI-9
    severity: minor
    location: audit/FIXES_VERIFIED_R6.md:585
    evidence: The file says "pgTAP: 110 migrations, 63/63 suites". My run on this commit was 111 migrations and 64 suites, all green. CLAUDE.md and README were updated to 111/64.
    reference: doc accuracy (H-07 / L-10)
    fix: Correct it to 111 migrations and 64/64 suites.
  - id: TI-10
    severity: info
    location: policies on backup_jobs, restore_jobs, roles, user_roles, system_config, feature_flags, data_jobs, system_health, health_alerts (TO public)
    evidence: These policies call helpers that anon can no longer execute, so an anon query now fails with 42501 instead of returning no rows. That fails closed. No anon consumer exists in src or Edge; every one is an authenticated settings page or an adminClient call. It is already logged in audit/backlog.md for WP-06.
    reference: —
    fix: Scope these policies `to authenticated` in WP-06, as the backlog says.

CHECKED:
  - Read the WP-02 text and acceptance tests, §0A.4, and Report 3's H-01, L-07 and Appendix A-1 probes.
  - Read the full diff c4ecfac..7c81fd7 (17 files).
  - Harness on my own database rv_wp02_tenant: 111 migrations, 64/64 suites green. definer_lockdown 28/28, catalog_definer_security 6/6, catalog_rls_coverage 2/2. The remaining TODOs belong to WP-05 and WP-06.
  - Catalog state:
    - All 65 public definer functions pin `search_path=public, pg_temp`.
    - anon can execute only get_security_settings(); a real anon call returns password_* keys only.
    - The authenticated grants (24) and timhirt_view_owner grants (3) exactly match definer_allowlist.sql.
    - All definer functions and all 112 tables are owned by postgres.
  - Mutation tests on the catalog guard: I added a grant (get_config to authenticated), removed an allow-listed grant (is_guardian_of) and created an unpinned definer function. The guard failed 4 of 6 assertions, as it should.
  - Mutation test on definer_lockdown.sql: with the old has_module and get_tenant_id_for_user bodies restored, tests 17 and 19 fail, so the cross-tenant probes do detect the old behaviour.
  - Read the bodies of all 24 authenticated-granted functions:
    - The dashboard_*, get_class_rank, get_student_grade_history, check_staff_employee_linkage and auto_assign_exam_seats functions derive the tenant from get_tenant_id_for_user(auth.uid()).
    - is_guardian_of, is_teacher_of_class and jwt_user_id are based on auth.uid().
    - attendance_retroactive_edit_window_days trusts its argument (TI-1).
  - My own 46-assertion probe (rolled back):
    - Tenant-A admin against tenant-B data returns null, false or 42501 for get_email_for_user, get_tenant_id_for_user, get_role_for_user, has_resource_permission, has_module, create_import_job and create_export_job (including a null tenant), and for acknowledge_alert (B's alert untouched), check_staff_employee_linkage, get_class_rank and get_student_grade_history.
    - SELECT, INSERT, UPDATE and DELETE by tenant A on B's rows in all 11 newly forced tables are denied or affect nothing. Inserting a platform system_config row is denied.
    - Suspended tenant: own tenant id is null, has_module is false, job creation is denied.
    - super_admin gets has_module for any tenant (by design) and cannot create a job in tenant B.
    - authenticated without a sub claim gets null or false.
    - The only failure is TI-1.
  - Policies that pass a non-caller id to a helper: only messages_insert (the recipient, same-tenant branch) and the two timhirt_view_owner view policies (jwt_user_id() = auth.uid()). hr_clinic_sensitive_views 12/12 and messages 14/14 pass.
  - No invoker function, view, column default or CHECK constraint calls a revoked definer function. No definer body calls an extension-schema function, so the search_path pin is safe for pgcrypto living in `extensions` in production.
  - Storage policies: all apply to authenticated, apart from the public branding read, which calls no function.
  - Frontend and Edge call sites: every definer RPC the app calls is allow-listed; the other app RPCs are invoker functions. Every Edge Function RPC to a definer function uses adminClient (fail_job, complete_job, update_job_progress, library_*, has_module in branding, consume_rate_limit, verify_document). Edge code was not changed by this WP.
  - Role-GUC trust model: no function sets `role` in its body or proconfig. authenticated, anon and timhirt_view_owner are not members of service_role.
  - The 11 forced tables: tenant_id is NOT NULL with an FK to tenants on all of them, except system_config (nullable by design for platform rows) and permissions/role_permissions (global, no tenant_id). RLS is enabled and forced on all 11.
  - Regenerated definer_inventory.md from the database into scratch with scripts/db/definer-inventory.py; it is byte-identical to the committed file.
  - Checked the TI-1 fix against attendance_audit_and_retroactive_gate.sql in a rolled-back transaction: 7/7.
  - Not verified: production rolbypassrls (TI-7), live Edge or PostgREST behaviour (no remote access, by instruction), and performance at production scale (TI-8 is harness-only).
  - Housekeeping: the worktree at /home/user/rv-wp02 is clean (no deno.lock or __pycache__) and database rv_wp02_tenant has been dropped.
