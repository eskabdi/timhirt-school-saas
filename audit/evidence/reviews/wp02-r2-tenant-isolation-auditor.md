REVIEWER: tenant-isolation-auditor
WP: WP-02 (round 2; implementation `c4ecfac..7c81fd7`, fix commit `67a627d..16548ba`)
VERDICT: PASS

FINDINGS:
  - id: TI-R2-1
    severity: minor
    location: /home/user/rv-wp02/supabase/tests/rls/definer_lockdown.sql:836-846
    evidence: |
      The new check that any unexpected role is treated as an end user (TI-5) is asserted for only two functions: get_email_for_user and attendance_retroactive_edit_window_days. As a mutation test, I put the old deny-list trust check (`in ('authenticated','anon')`) back into has_module and get_tenant_id_for_user. definer_lockdown.sql still passed 51/51, and the whole committed harness would stay green. Only my scratch probe caught it:
        not ok 32 - probe role: has_module(A) false
        not ok 34 - probe role: tenant null
      The same trust clause also appears, untested for an unexpected role, in get_role_for_user, has_resource_permission, get_security_settings, approval_required and exam_results_published. The code itself is correct today (my probe: all 7 give the caller-only answer).
    reference: OWASP A01 (fail-safe defaults) / round-1 TI-5 ("add a pgTAP case showing that an unexpected role gets caller-only answers")
    fix: Grant wp02_probe_role EXECUTE on the other seven helpers and add one caller-only assertion each (has_module(B) false, get_tenant_id_for_user(B user) null, get_role_for_user(B user) null, has_resource_permission(other user) null, no login_* keys, approval_required(B) null, exam_results_published(B exam) null).
  - id: TI-R2-2
    severity: minor
    location: /home/user/rv-wp02/audit/backlog.md (row "WP-02 review TI-3")
    evidence: |
      TI-3 was moved to the backlog, not fixed. Moving a minor finding to the backlog is allowed, but the backlog row is wrong in two ways:
        - It lists get_class_rank and get_student_grade_history as "probed by the reviewer, not committed". Both have committed cross-tenant probes (class_rank.sql:104, student_grade_history.sql:123).
        - It leaves out approval_required(uuid,…) and exam_results_published(uuid). 16548ba edited both, both are granted to authenticated, and neither has a committed tenant-A vs tenant-B probe. maker_checker.sql:207 calls approval_required only for the caller's own tenant.
      Functions that really lack a committed cross-tenant probe: is_guardian_of, is_teacher_of_class, dashboard_overview(p_academic_year_id), approval_required, exam_results_published. My probe ran all five cross-tenant and every one passed.
    reference: §0A.2 tenant-isolation-auditor ("cross-tenant probe tests exist and pass") / round-1 TI-3
    fix: Correct the backlog row to name these five functions. When it is done (WP-06), add the probes and the catalog rule.
  - id: TI-R2-3
    severity: info
    location: /home/user/rv-wp02/docs/DEPLOYMENT.md:262-263
    evidence: |
      The runbook says the global default-ACL row must be "without `=X/`". On the harness the correct closed state is `-|{postgres=X/postgres}`, which contains `=X/`. Read literally, the correct state would be reported as drift. (The drift query itself is correct: regprocedure prints arguments without spaces, and its output matches the allow-list format.)
    reference: doc accuracy (H-07 / L-10)
    fix: Give the expected value (`{postgres=X/postgres}`), or say "no entry for PUBLIC (an entry starting `=X/`)".
  - id: TI-R2-4
    severity: info
    location: /home/user/rv-wp02/supabase/migrations/20260926000001_r6_definer_lockdown.sql:441-446
    evidence: The `extensions`-schema re-grant of EXECUTE to PUBLIC runs only if that schema exists. The shim has no `extensions` schema, so the harness never runs this branch. Not verifiable locally. It has no tenant-isolation impact.
    reference: INSA evidence requirement
    fix: Record `pg_default_acl` for `extensions` in the post-deploy evidence.
  - id: TI-R2-5
    severity: info
    location: /home/user/rv-wp02/supabase/migrations/20260926000001_r6_definer_lockdown.sql:365-374 (with data_jobs_admin_update from earlier migrations)
    evidence: |
      The migration comment says the "completed export job pointing at any storage path" attack is closed. That is true for INSERT only. data_jobs_admin_update still lets a school_admin rewrite storage_path and status on their own tenant's jobs.
      This is not a cross-tenant path: ImportExportPage.tsx:121-124 signs through the user client, and the data-imports storage SELECT policy requires foldername[1] = the caller's tenant and the school_admin role. My probe confirmed that a tenant-B admin's UPDATE on tenant A's job changes nothing.
    reference: L-07 / A-1
    fix: None needed for isolation. Optionally restrict data_jobs_admin_update to the columns the page changes (WP-06).
  - id: TI-R2-6
    severity: info
    location: /home/user/rv-wp02/supabase/migrations/20260927000002_r6_maker_checker.sql:490,570,643,663,677
    evidence: The WP-09 enforcement triggers still use a deny-list, `current_user in ('authenticated','anon')`. This is the same fail-open pattern as round-1 TI-5. It is out of WP-02 scope (16548ba did not touch these lines) and is noted here for the WP-09 reviewers.
    reference: OWASP A01 (fail-safe defaults)
    fix: For the WP-09 review, decide whether to invert this to a trusted-context allow-list, or record why current_user is enough.

Round-1 findings:
  - **TI-1 (blocker): closed.**
    - attendance_retroactive_edit_window_days now gives callers outside the tenant the default 7 (migration:305-320).
    - It is probed at definer_lockdown.sql:794, :845 and :853.
    - The allow-list reason and _pending-changes.md:168 are updated.
    - Mutation test: with the old body restored, tests 23 and 48 fail.
  - **TI-2: closed.**
    - Tenant B's exam and a random id both give 'exam_not_found'.
    - exam_seating_charts.sql:103 is updated.
    - Mutation test: with the old two-error behaviour restored, test 9 fails.
  - **TI-3: moved to the backlog, not fixed.** The backlog row is inaccurate (TI-R2-2).
  - **TI-4: closed.**
    - login_* keys go only to super_admin and trusted contexts.
    - The hook drops them.
    - SecuritySettingsPage reads system_config directly.
  - **TI-5: closed in code, with a test coverage gap (TI-R2-1).** Trust is now an allow-list: 'none', service_role, postgres, supabase_admin.
  - **TI-6: closed.**
    - The global and `public` default privileges for postgres no longer grant EXECUTE.
    - Catalog assertion 7 guards this; mutation tests (reopening authenticated, restoring the PUBLIC default) make it fail.
  - **TI-7: closed.** The evidence file shows `postgres | False | True` (rolbypassrls) in production.
  - **TI-8: in the backlog** for the performance reviewer.
  - **TI-9: closed.** FIXES_VERIFIED, CLAUDE.md and README say 113 migrations and 65 suites, which matches my run.
  - **TI-10: in the backlog** (WP-06).

CHECKED:
  - I read the WP-02 text and tests, §0A.4 and my round-1 verdict. I read the full 16548ba diff and the current full migration 20260926000001.
  - Harness on my own database rv2_wp02_ti: 113 migrations applied, 65/65 suites green, "All suites passed", exit 0. Key suites:
    - definer_lockdown 51/51
    - catalog_definer_security 7/7
    - catalog_rls_coverage 2/2
    - security_settings 8/8
    - exam_seating_charts 9/9
    - maker_checker 65/65
    - attendance_audit_and_retroactive_gate 7/7
  - The only open TODOs belong to WP-05 and WP-06.
  - My own rolled-back pgTAP probe passed 41/41: a tenant-B school_admin against tenant-A data, covering every allow-listed authenticated function with a uuid argument (19 functions), plus direct SELECT/INSERT/UPDATE/DELETE on data_jobs, health_alerts and system_health. It showed:
    - is_teacher_of_class and is_guardian_of return false.
    - exam_results_published returns null, and the same null for a random id.
    - approval_required returns null.
    - dashboard_overview(A's academic year) returns 0 students.
    - get_student_grade_history returns '{}'.
    - auto_assign_exam_seats gives 'exam_not_found' for both A's exam and a random id.
    - submit_approval on A's invoice gives 42501.
    - The attendance window is 7.
    - has_module returns false; get_tenant_id_for_user, get_role_for_user, get_email_for_user and has_resource_permission return null.
    - create_*_job gives 42501. acknowledge_alert leaves A's alert untouched.
    - B sees 0 of A's rows, and cross-tenant INSERTs give 42501.
    - B's UPDATE/DELETE on A's rows changes nothing.
    - A school_admin cannot insert even an own-tenant alert (the policy was dropped).
    - No login_* keys come back.
    - An unexpected role and an authenticated caller with no sub claim both get caller-only answers.
  - Policies left on data_jobs, health_alerts and system_health all derive the tenant from get_tenant_id_for_user(auth.uid()). No src or Edge code inserts into them. Export signing goes through storage RLS scoped to the tenant folder, and process-import-job checks the `${tenantId}/${job_id}/` prefix.
  - Mutation tests:
    - Catalog guard: a PUBLIC grant on get_config fails assertions 1 and 3. Reopening the default privileges (authenticated, or the global PUBLIC grant) fails assertion 7.
    - Lockdown and seating suites: the old attendance body and the old two-error seating body are both caught.
    - The deny-list has_module and get_tenant_id_for_user are not caught (TI-R2-1).
    - Every mutation was reverted, and both suites went back to 51/51 and 7/7.
  - Harness default ACLs after migration: `-|{postgres=X/postgres}` and `public|f|{service_role=X/postgres}`. The shim mirrors Supabase's public-schema defaults, so assertion 7 is not vacuous.
  - `current_setting('role')` trust model: no migration function sets `role`. The new code has no deny-list checks on the role GUC; only the WP-09 triggers still use one, on current_user (TI-R2-6).
  - scripts/ci/app-rpc-grants.py on the migrated DB: 23 app RPCs, 0 findings.
  - The DEPLOYMENT.md drift query run as written gives signatures in allow-list format.
  - No Edge Function code changed in either commit. No new table, view or storage policy. The only schema changes are replaced function bodies, 3 dropped policies, default ACLs and FORCE RLS.
  - Not verified: live PostgREST, Storage or Edge behaviour and production catalog state (no remote access, as instructed); the `extensions` default-ACL branch (TI-R2-4).
  - Housekeeping:
    - scripts/db/definer-inventory.py rewrites the tracked `supabase/security/definer_inventory.md` in place. The regenerated content was byte-identical (`git status` clean), which also confirms the committed inventory is current.
    - The worktree at /home/user/rv-wp02 is clean: no deno.lock and no __pycache__.
    - Database rv2_wp02_ti is dropped, and the probe role left nothing behind.
