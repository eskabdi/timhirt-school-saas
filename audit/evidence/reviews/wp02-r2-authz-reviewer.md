REVIEWER: authz-reviewer
WP: WP-02 (round 2; implementation c4ecfac..7c81fd7, fixes 67a627d..16548ba)
VERDICT: PASS

All nine round-1 findings are closed, fixed or tracked. No blocker or major findings remain. Two new minor findings and four info items follow.

FINDINGS:
  - id: AZ2-1
    severity: minor
    location: supabase/migrations/20260719000010_import_export.sql:47 (`data_jobs_admin_update`, unchanged); docs/insa/_pending-changes.md:170
    evidence: |
      The fix removed the INSERT policies, but it left the UPDATE policy. A school_admin can still do directly what `complete_job`, `fail_job` and `update_job_progress` do, and those three are documented as service_role-only. I ran this as a tenant-A school_admin on 16548ba:
        select create_export_job(A,'students') -> :job
        update data_jobs set status='completed', storage_path='<tenantB>/x.csv', processed_rows=999, user_id='<teacher A>' where id=:job
        -> completed|<tenantB>/x.csv|999|<teacher A>
      The impact is small. The attacker is a school_admin acting in their own tenant. The `data-imports` storage SELECT policy only lets a school_admin of the same tenant sign a file. The Edge processors rebuild the path themselves and refuse jobs that are not queued, and a teacher probe on the same row updated 0 rows. Still, the INSA text says "a client cannot write directly what the service_role-only and school_admin-only RPCs guard", and that is not true for UPDATE on `data_jobs`. Nothing in `src/` updates `data_jobs` directly.
    reference: OWASP A01 / RLS–RPC parity (round-1 AZ-1 follow-on) / INSA Phase 3 Access Control
    fix: Drop `data_jobs_admin_update`. Edge uses the service_role client, which bypasses RLS. Add an admin direct-UPDATE probe to definer_lockdown.sql. Or narrow line 170 to "no INSERT policy; school_admin may still update own-tenant job rows".
  - id: AZ2-2
    severity: minor
    location: supabase/tests/shim.sql:16 vs :54; audit/FIXES_VERIFIED_R6.md:579
    evidence: |
      A second run of run.sh against the same database fails. The ledger says "The shim restores the built-in default at the start of every harness run, so a re-run is unaffected." That is wrong because of statement order:
      - The schema reset drops `public` cascade, and pgtap goes with it.
      - The shim then recreates pgtap at line 16, while the global default the previous run's migration closed is still in force.
      - Line 54 restores the default only after that.
      The result is pgTAP functions with no PUBLIC EXECUTE:
        lives_ok(text,text)|{postgres=X/postgres}
        --- FAIL: admission_refund.sql  ERROR: permission denied for function lives_ok
        (also attendance_guardian_notify, bank_verification, class_rank, …)
      The first run on a fresh DB was green (113 migrations, 65/65), and CI uses a fresh container. So this is a failure you see, not a false green. But it breaks the "run.sh before you say it works" loop on a reused local DB.
    reference: CLAUDE.md "Before you say it works" / Rule 10 record keeping
    fix: Move the `alter default privileges for role postgres grant execute on functions to public` line above the `create extension` lines in shim.sql. Or create pgtap in its own schema. Correct the ledger sentence.
  - id: AZ2-3
    severity: info
    location: docs/OWNER_ACTIONS.md (C5); audit/backlog.md (WP-02 review AZ-6)
    evidence: The default-privilege half of round-1 AZ-6 is fixed, and catalog_definer_security #7 fails on planted drift (see CHECKED). Not verifiable: whether `rls-tests` is a required status check. Branch protection lives outside the repo. It is now logged as owner action C5.
    reference: WP-02 plan item 3
    fix: The owner completes C5 and records the evidence.
  - id: AZ2-4
    severity: info
    location: audit/evidence/wp02-prod-owners-bypassrls-defacl-20260926T105624Z.txt
    evidence: This closes round-1 AZ-7 on paper (postgres has rolsuper=False, rolbypassrls=True, and owns all 11 FORCE'd tables). Not verifiable by me, because I was not allowed to query production. I relied on the committed artifact.
    reference: G-10 / L-02
    fix: none required; the release-gatekeeper may re-query read-only before deploy.
  - id: AZ2-5
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:326-362 (auto_assign_exam_seats), :189-245 (job/alert RPCs)
    evidence: |
      These are round-1 AZ-8 items, now logged in audit/backlog.md for WP-06/WP-07:
      - Writing definer RPCs have no module check, no imp_mode=read refusal and no aal2 check. For example, `auto_assign_exam_seats` still lacks `has_module(...,'gradebook')`.
      - Edge Functions still use `requireRole`, not `requireAccess`. WP-02 changes no Edge Function.
      - The role, permission and custom-role writes (`privileged_role_grant`) are registered in WP-09 but wired only in WP-07.
      Suspended-tenant callers are refused: a probe returned has_module=false and window=7, and seat assignment reads as exam_not_found because get_tenant_id_for_user is NULL.
    reference: WP-06 / WP-07 / WP-09
    fix: Track them in those WPs, as the backlog already says.
  - id: AZ2-6
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:426-433; scripts/ci/app-rpc-grants.py
    evidence: |
      The new global default also closes future functions created by postgres outside `extensions`. Two future-risk cases:
      - A later `create extension` with no schema clause lands in `public` and becomes service_role-only.
      - A new invoker helper called only from RLS policies needs an explicit grant to authenticated. app-rpc-grants.py covers only `supabase.rpc()` names, so these helpers rely on pgTAP coverage.
    reference: WP-02 plan item 3
    fix: Mention both in the CLAUDE.md "Every new function starts closed" paragraph.
CHECKED:
  - I read WP-02 (plan lines 329-385), §0A.4 and my round-1 verdict, and reviewed the full code diff 67a627d..16548ba (migration, allow-list, inventory, catalog guard, definer_lockdown, security_settings, exam_seating_charts, maker_checker, shim, useSecuritySettings plus its test, app-rpc-grants.py, ci.yml, docs, ledger).
  - Harness on a fresh rv2_wp02_authz: 113 migrations, 65/65 suites, exit 0. definer_lockdown 51/51, catalog_definer_security 7/7, security_settings 8/8, maker_checker 65/65. The only TODOs are WP-05 and WP-06.
  - Fail-before, running the HEAD test files against older schemas:
    - WP-01 head (c4ecfac): definer_lockdown fails 38/51.
    - Round-1 head (67a627d): definer_lockdown fails 13/51, security_settings fails 1/8, catalog_definer_security fails 3/7 (anon grant, default ACLs).
  - Round-1 AZ-2 is closed. The new assertions #38 and #39 (student asks about a same-tenant admin and a tenant-B admin) fail on c4ecfac and pass on HEAD. #22 is the positive control.
  - Round-1 AZ-1 is closed for INSERT:
    - `health_alerts_insert`, `system_health_insert` and `data_jobs_write` are gone.
    - Direct inserts are refused: as a student into all three tables, and as a school_admin into data_jobs.
    - The remaining policies are SELECT, and admin UPDATE/DELETE. The UPDATE gap is AZ2-1.
  - Round-1 AZ-3 is closed. Admin A gets 7 for tenant B, and so does an unexpected role, while service_role gets 30. A suspended admin gets 7 for their own tenant.
  - Round-1 AZ-4 is closed:
    - A teacher gets only the password_* keys and session_timeout_minutes; a registrar and a school_admin get no login_* keys; super_admin gets them.
    - The hook no longer reads the login_* keys, and tsc is 0.
    - SecuritySettingsPage reads system_config directly.
    - `invalidateQueries(["security-settings"])` still prefix-matches the per-user key.
  - Round-1 AZ-5 is closed:
    - The anon grant is revoked, and the guard asserts zero anon definers.
    - The hook is enabled only with a session, so the invite page, before a session, gets defaults and makes no call.
    - Vitest useSecuritySettings.test.tsx passes 2/2, and eslint on both files is clean.
  - Round-1 AZ-6 is closed apart from branch protection:
    - The default ACLs after migration are `-|{postgres=X}` and `public|{service_role=X}`.
    - Planting `grant execute on functions to authenticated` as a public default fails catalog #7.
    - Required-check status is not verifiable (AZ2-3).
  - Round-1 AZ-9 is closed. The ledger counts (113/65, 13/51 fail-before) match my runs.
  - Trust allow-list (`none`, `service_role`, `postgres`, `supabase_admin`) versus the old deny-list:
    - It is strictly tighter.
    - No migration calls set_config/SET ROLE, so no end-user path can change the `role` GUC.
    - The two WP-09 helpers changed in 16548ba use the same pattern.
    - Tests with an unexpected role pass.
  - auto_assign_exam_seats: the body matches 20260825000001, except that the cross-tenant branch now raises exam_not_found. No frontend code matches on `cross_tenant_denied`.
  - The create_*_job validation (entity allow-list, 0–5 MB) matches process-import-job and process-export-job, and the Edge processors re-validate tenant, type, status and path.
  - app-rpc-grants.py:
    - The check reports 23 RPCs and 0 findings.
    - Negative control: revoking `create_import_job` from authenticated makes it exit 1.
    - No multi-line `rpc(` call escapes the regex; the only non-literal call is the dashboard wrapper definition.
  - I regenerated definer_inventory.md from a scratch root; it is byte-identical to the committed file (74 rows).
  - Re-applying 20260926000001 on top of itself applies cleanly. It strips the later WP-09 grants when run out of order, which is expected, and the catalog guard caught that.
  - The worktree is clean, with no deno.lock or __pycache__. I dropped rv2_wp02_authz, rv2_wp02_authz_c4ecfac and rv2_wp02_authz_67a627d. Temporary files are only in the session scratchpad.

Relevant files:
- /home/user/rv-wp02/supabase/migrations/20260926000001_r6_definer_lockdown.sql
- /home/user/rv-wp02/supabase/migrations/20260719000010_import_export.sql
- /home/user/rv-wp02/supabase/tests/shim.sql
- /home/user/rv-wp02/supabase/tests/rls/definer_lockdown.sql
- /home/user/rv-wp02/supabase/tests/rls/catalog_definer_security.sql
- /home/user/rv-wp02/docs/insa/_pending-changes.md
- /home/user/rv-wp02/audit/FIXES_VERIFIED_R6.md
