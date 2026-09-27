REVIEWER: db-migration-reviewer
WP: WP-02 (round 2; `c4ecfac..7c81fd7` plus `67a627d..16548ba`)
VERDICT: FAIL

The lockdown itself is correct and the tests do catch its absence. The verdict is FAIL because of one major finding: the rewritten helper functions make ordinary database reads about 4 to 5 times slower, and the backlog records this as a much smaller cost.

FINDINGS:
  - id: DM-1
    severity: major
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:91-130, :177-197
    evidence: |
      Setup: local PostgreSQL 16.13, a copy with seed data (5,000 students and 50,000 attendance rows in tenant A), querying as a school_admin with the authenticated role. The only difference between the two runs is the helper bodies: the pre-WP-02 bodies of get_tenant_id_for_user, get_role_for_user, has_resource_permission and has_module, against the WP-02 bodies. Each was measured twice.
        select count(*) from students    OLD 297 / 290 ms       NEW 1,472 / 1,420 ms   (about 4.9x)
        select count(*) from attendance  OLD 3,363 / 3,064 ms   NEW 13,814 / 15,025 ms (about 4.5x)
      The search_path value does not cause it: the old bodies with `public, pg_temp` ran in 278 ms and 3,209 ms.
      Isolating each change on attendance:
        - new has_resource_permission alone: 3.3 s (no change);
        - new has_module: 7.7 s;
        - new get_tenant_id_for_user and get_role_for_user on top of that: 14 to 15 s.
      In a tight loop, has_module costs about 180 µs per call, up from 6.5 µs. The new body calls two SQL definer helpers from inside a SQL function, and the more complex bodies cost more for every call. Many module-gate and permission policies (57 module gates) call these helpers once per row.
      audit/backlog.md:76 records this as "about +27–40%" and defers it to WP-06. That understates the measured effect by an order of magnitude. On Supabase, the authenticated role's default statement timeout is 8 s.
    reference: plan WP-02 item 4 (the tenant-less `has_module(p_module)` could be wrapped as a `(select …)` initplan that runs once per statement); §0A.4 "doc/control mismatch"; availability
    fix: |
      Rewrite get_tenant_id_for_user, get_role_for_user and has_module as plpgsql, with the same predicates and `return (select …)`.
      I checked this locally without committing it: students took 386 ms and attendance 4,108 ms, close to the old baseline.
      Alternatively, move the module gates to an initplan form. In either case, correct the backlog figure, and record a before/after EXPLAIN ANALYZE in FIXES_VERIFIED_R6.
      Not verified: that the plpgsql variant passes the full test suite.
  - id: DM-2
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:45-47
    evidence: |
      The rollback note reads: "re-grant EXECUTE to the listed roles; the body changes … can be reverted by re-running the previous CREATE OR REPLACE". It leaves out:
        - the three dropped policies (health_alerts_insert, system_health_insert, data_jobs_write), whose definitions are in 20260719000010:41 and 20260719000011:49,55;
        - FORCE RLS on the 11 tables;
        - the two ALTER DEFAULT PRIVILEGES changes and the grant added on the `extensions` schema.
      It also does not say that a rollback must never restore anon access, and does not state a forward-fix-only policy.
    reference: db-migration checklist "a rollback or forward-fix plan written in the PR"
    fix: Replace it with a forward-fix plan that lists each object and the statement that reverses it, as the WP-00 library hotfix does (FIXES_VERIFIED_R6.md:217). State explicitly that anon is never re-granted.
  - id: DM-3
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:372-374, :449-459
    evidence: |
      DROP POLICY and ALTER TABLE … FORCE ROW LEVEL SECURITY take ACCESS EXCLUSIVE locks. They do this on user_roles, roles, role_permissions and permissions, which has_resource_permission reads in 198 policies, i.e. in almost every authenticated query. No lock_timeout is set.
      One long-running reader would therefore queue all API traffic behind the migration's lock request. The migration itself runs in about 60 ms, and the tables are small.
    reference: db-migration checklist "long locks avoided"
    fix: Add `set local lock_timeout = '5s';` at the top of the migration (it is transactional in the deploy wrapper), and retry on failure.
  - id: DM-4
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:51-65
    evidence: |
      Applying the migration twice in a row leaves the catalog unchanged (identical md5 of function ACLs, config and bodies, default privileges and policies), so it is idempotent in order.
      Re-applying it after 20260927000002 is not safe: the loop that revokes from every SECURITY DEFINER function strips the WP-09 grants. After re-running it, submit_approval, decide_approval, set_approval_settings, approval_required and exam_results_published were all `{postgres=X/postgres,service_role=X/postgres}`.
    reference: idempotent DDL
    fix: Document in the migration header and in DEPLOYMENT.md that this migration must never be re-run manually. The drift query in DEPLOYMENT.md §7 detects the damage if it happens.
  - id: DM-5
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:439-446
    evidence: |
      `alter default privileges for role postgres revoke execute on functions from public` applies to every schema, not only public.
      `extensions` is handled; I verified that a new function there is executable by anon.
      Any other schema postgres later creates functions in starts with no PUBLIC EXECUTE. That covers a future `private` schema, or an extension installed WITH SCHEMA outside `extensions`.
      This is the intended behaviour, but it is documented only for public and extensions.
    reference: grants explicit
    fix: Add a sentence about this to the header and to DEPLOYMENT.md.
  - id: DM-6
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:132-134
    evidence: |
      The comment says the has_resource_permission body is the "latest definition, from 20260817000004 onwards". The latest definition is actually in 20260817000006_custom_role_enforcement.sql:70. I compared the bodies and they are identical, so only the citation is wrong.
    reference: accuracy
    fix: Cite 20260817000006.
  - id: DM-7
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:91-130
    evidence: |
      As a super_admin with the authenticated role, get_role_for_user and get_tenant_id_for_user return NULL for users in other tenants. On seed data, 'sa role other' and 'sa tenant other' were both NULL.
      Only has_module has a super_admin exception.
      Nothing depends on this today. I checked every policy and function body in the catalog: the only helper calls that pass an id other than the caller's are messages_insert (same tenant), has_permission (service_role only) and the WP-09 functions (which pass v_uid, the caller). No app RPC calls these helpers.
    reference: backward compatibility
    fix: Note it for WP-06/WP-07, so that a future super_admin policy does not rely on it.
CHECKED:
  - I read the WP-02 text, its acceptance criteria and §0A.4, both diffs, the full final migration, the allow-list, catalog_definer_security.sql, definer_lockdown.sql, the shim, run.sh, app-rpc-grants.py and the round-1 verdicts. I also read the WP-09 edits made in 16548ba, which only switch two functions to the trusted-role allow-list and add a test grant.
  - Fresh database: `PGDATABASE=rv2_wp02_dbmig ./supabase/tests/run.sh` applied 113 migrations. All 65 suites passed (definer_lockdown 51/51, catalog_definer_security 7/7, catalog_rls_coverage 2/2). The only remaining TODOs belong to WP-05 and WP-06. app-rpc-grants.py reported 23 RPCs and 0 findings, exit 0.
  - The tests fail without the fix: in a database with every migration except 20260926000001, definer_lockdown fails 38/51, catalog_definer_security 4/7, catalog_rls_coverage 1/2 and security_settings 1/8.
  - Copy with seed data: I applied the migrations up to 20260925000003, which gives 65 definer functions, 42 of them executable by anon (matching production). I then loaded supabase/seed.sql plus 2,001 users, 500 alerts, 500 metrics and 300 jobs.
    - Applying 20260926000001 in a single transaction took 0.06 s.
    - The two WP-09 migrations then applied cleanly.
    - Row counts were unchanged (2001/500/500/300/17). Policies went from 374 to 372 (WP-02 dropped 3, WP-09 added 1). 0 tables are left with RLS enabled but not forced.
  - Smoke test after the migration, as a school_admin: reads work; create_export_job and acknowledge_alert work in the admin's own tenant; the role of a user in another tenant comes back NULL, and a same-tenant role resolves.
  - Idempotency: applying the migration twice in a row leaves the catalog unchanged. Re-applying it after WP-09 does not (DM-4).
  - search_path: all 74 definer functions pin `search_path=public, pg_temp`. No definer or invoker function in public calls pgcrypto, uuid-ossp or vault functions, so moving production's `extensions` schema off the path breaks nothing.
  - Grants: no definer function is executable by anon; the authenticated and view-owner grants match the allow-list; service_role can execute all of them.
  - No view, column default, CHECK constraint or policy uses a function that authenticated cannot execute. The only invoker non-trigger function closed to authenticated is approval_payload_hash, whose callers are all definer functions.
  - Default privileges: the global row is `{postgres=X/postgres}`, the public-schema row is `{service_role=X/postgres}`, and `extensions` has `{=X/postgres}`. I tested this with a scratch schema: a new public function is closed to authenticated and open to service_role, and a new extensions function is open to anon.
  - FORCE RLS: the production evidence file shows postgres is not a superuser, has BYPASSRLS and owns all 11 tables and all 65 definer functions.
  - Edge Functions: every .rpc() call to a revoked function uses a service_role client. I checked verify-id, rate limiting, jobs, library, branding and has_module.
  - Direct writes to the three tables whose policies were dropped: the app only UPDATEs health_alerts (a policy still allows it) and never INSERTs; Edge Functions use the admin client.
  - Generated inventory: running definer-inventory.py gives output identical to the committed definer_inventory.md (74 rows).
  - Vitest src/lib/useSecuritySettings.test.tsx: 2/2 passed.
  - Not verified:
    - the frontend and Edge gates (tsc, eslint, build, deno-check, semgrep); frontend and Edge code is outside the db-migration scope;
    - behaviour on production or staging (no remote access, as instructed);
    - performance at production scale and on production's PostgreSQL version (DM-1 was measured locally only).
  - Cleanup: I dropped rv2_wp02_dbmig, _seed, _idem and _nofix. The worktree has no tracked changes. The ignored `dist/` and `tsconfig.tsbuildinfo` there were created at 22:54, around when my first run started, but not by my commands; I left them in place.
