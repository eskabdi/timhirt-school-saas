REVIEWER: db-migration-reviewer
WP: WP-02 (round 3; implementation `c4ecfac..7c81fd7`, fixes `67a627d..f4d5924`, worktree at `f4d5924`)
VERDICT: PASS

All round-2 findings are closed in substance. For DM-1 the order-of-magnitude slowdown is gone: on data I seeded myself, the plpgsql helpers read about 25–35% slower than before WP-02, where the round-2 SQL bodies were 4.7–5.9x slower. There are no blockers or majors. Three findings remain: two minor documentation inaccuracies and one info-level gap in test coverage.

FINDINGS:
  - id: DM3-1
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:100-101; audit/backlog.md:76; audit/FIXES_VERIFIED_R6.md:622
    evidence: |
      The migration comment says the plpgsql helpers "are back to the pre-WP-02 cost (290 ms / 3.1 s)". The backlog says "within ~10% of the pre-WP-02 cost". The 290 ms / 3.1 s figures are the old bodies' timings from my round-2 run, not a measurement of the plpgsql bodies.
      My setup: a seeded copy with 5,000 students and 50,000 attendance rows in tenant A, queried as that tenant's school_admin with the authenticated role. Old, round-2 and current helper bodies were each swapped in inside a transaction. I ran old and new interleaved 10 times each, on a shared and noisy machine:
        attendance count(*): old median about 3.64 s, new about 4.50 s (+24%); round-2 SQL 16.5–18.0 s
        students count(*):   old median about 330 ms, new about 446 ms (+35%); round-2 SQL 1.87–2.04 s
      So DM-1 is fixed: from about 4.7–5.9x down to about 1.25–1.35x. The documents understate the remaining cost by 2–3x. No same-session baseline or EXPLAIN ANALYZE was recorded, which was part of my round-2 fix request.
    reference: round-2 DM-1 fix ("correct the backlog figure; record before/after"); §0A.4 accuracy
    fix: Replace the claims with measured before/after numbers from the same session (roughly +25–35% versus pre-WP-02), or record an EXPLAIN ANALYZE pair in FIXES_VERIFIED_R6. Keep the WP-06 initplan/tenant-less has_module item as the remedy.
  - id: DM3-2
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:46-50
    evidence: |
      The forward-fix plan says each previous helper body is in "20260817000006 … 20260821000005 … 20260825000001 …, the rest in 20260715*/20260719*".
      I checked the latest earlier CREATE for each function the migration replaces:
        - get_tenant_id_for_user: 20260821000002_suspended_tenant_lockout.sql
        - has_module: 20260821000003_module_gating_rls.sql
        - get_role_for_user: 20260713000001_core.sql
        - get_security_settings: 20260806000001_security_settings.sql
      None of these is in 20260715*/20260719*. Only get_email_for_user (20260715000012) and the job/alert RPCs (20260719000010/11) are. Someone following the note and restoring get_tenant_id_for_user from an older file would drop the suspended-tenant lockout.
      The policy citations are correct (20260719000010:41,47 and 20260719000011:49,55).
    reference: db-migration checklist "a rollback or forward-fix plan written in the PR" (round-2 DM-2)
    fix: List the four missing source migrations explicitly in the header.
  - id: DM3-3
    severity: info
    location: supabase/tests/rls/catalog_definer_security.sql (no such assertion); supabase/migrations/20260926000001_r6_definer_lockdown.sql:115-240
    evidence: |
      No test pins the fix for DM-1. A later CREATE OR REPLACE of get_tenant_id_for_user, get_role_for_user or has_module as `language sql` with the same caller checks would pass every suite and bring back the 4–5x read cost.
      All suites stayed green on the round-2 SQL bodies, which shows the suites do not detect this.
    reference: availability; the §0A.3 performance-reviewer scope
    fix: Add a catalog assertion that these three helpers are `prolang = plpgsql` (with a comment citing DM-1), or add a performance smoke test in WP-06.
  - id: DM3-4
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:66
    evidence: |
      `set local lock_timeout = '5s'` works as intended. With a concurrent session holding a read lock on user_roles, the migration was cancelled after 5.14 s at :506 with "canceling statement due to lock timeout", instead of queueing.
      It only takes effect inside a transaction block. The recorded deploy path (Management API, one transaction per migration, per wp00-closeout evidence line 9) satisfies that. A plain `psql -f` without `-1` would only print a warning and apply no timeout.
    reference: lock safety (round-2 DM-3)
    fix: Optional. Add one line to DEPLOYMENT.md §7 saying the migration must be applied in a transaction.

CHECKED:
  - I read the WP-02 text, its acceptance criteria and §0A.4, the fix diffs `16548ba..f4d5924` and `67a627d..f4d5924`, the final migration, and the doc edits to FIXES_VERIFIED_R6, backlog and DEPLOYMENT.md.
  - **Fresh database:** `run.sh` on `rv3_wp02_dbmig` applied 113 migrations and all 65 suites passed. That includes definer_lockdown 58/58, catalog_definer_security 8/8 and catalog_rls_coverage 2/2. The only TODOs left are WP-05 and WP-06.
  - **Second run on the same database** was also all green, so RG-1/AZ2-2 is closed. `app-rpc-grants.py` reported 23 RPCs, 0 findings, exit 0.
  - **Seeded copy:** I applied migrations up to 20260925000003 (65 definer functions, 42 executable by anon), then loaded `supabase/seed.sql` plus 5,500 students, 50,000 attendance rows, 2,003 users, 500 health alerts and 300 data_jobs.
    - The WP-02 migration applied in a single transaction in 0.06 s, and the two WP-09 migrations applied cleanly after it.
    - Row counts were unchanged (5500/50000/2003/500/300).
    - Policies went from 407 to 404: WP-02 dropped 4, including the new drop of data_jobs_admin_update, and WP-09 added 1.
    - No table is left with RLS enabled but not forced. No definer function is executable by anon. None has a search_path other than `public, pg_temp`.
  - **DM-1 re-measured:** old, round-2 and current helper bodies, interleaved, with the numbers given in DM3-1. The fix is confirmed.
  - **Behaviour of the plpgsql rewrite:** I compared the round-2 SQL bodies with the plpgsql bodies across 784 cases.
    - Invoking roles: authenticated, service_role, none, and an unexpected role.
    - Callers: admin, student, a tenant-B admin, a suspended-tenant admin, a super_admin in a suspended tenant, a platform super_admin, and no JWT.
    - Targets: including a missing id and NULL, for all three helpers, and for has_module with overrides, tier, NULL tenant and an unknown module.
    - Result: 0 differences.
    - `users.role` is NOT NULL, so the `v_role <> 'super_admin'` NULL path cannot occur.
  - **AZ2-1 (dropped data_jobs_admin_update policy):**
    - The probe is not vacuous: an import job exists in tenant A at that point.
    - With the policy recreated, definer_lockdown fails exactly #31; after dropping it again, 58/58.
    - The app never updates data_jobs, and the Edge job claim uses adminClient.
  - **SEC-R2-3 (catalog guard #8):** revoking has_module from authenticated fails guards #2 and #8; after re-granting, 8/8.
  - **DM-2:** the forward-fix plan is present and says anon is never re-granted. The policy line citations are correct; the function citations are incomplete (DM3-2).
  - **DM-3:** the lock timeout is present and I verified it fires (DM3-4).
  - **DM-4 and DM-5:** documented in the migration header and in DEPLOYMENT.md §7. The DEPLOYMENT.md drift query's regexp is harmless, because regprocedure output has no ", ".
  - **DM-6:** the citation now points to 20260817000006.
  - **DM-7:** recorded as a backlog row.
  - **Idempotency:** applying the migration twice in a row on a pre-WP-02 database gives an identical catalog hash (function ACLs, config, source and language, default ACLs, policies, FORCE flags).
  - **Job and alert RPC signatures:** create_import_job, create_export_job and acknowledge_alert each have a single overload, so no stray old signature is left behind.
  - **Inventory:** running `definer-inventory.py` against the harness database, on a scratch `git archive` copy, produces output identical to the committed `definer_inventory.md`.
  - The CI step for `app-rpc-grants.py` runs after `run.sh` on the same database.
  - **Not verified:**
    - performance at production scale and on production's PostgreSQL version (local PG 16, shared noisy host);
    - the frontend and Edge gates (tsc, eslint, vitest, build, deno-check, semgrep), which are outside db-migration scope;
    - production or staging state (no remote access, as instructed).
  - **Cleanup:** I dropped rv3_wp02_dbmig, rv3_wp02_dbmig_seed and rv3_wp02_dbmig_idem, and removed the scratch copy. `git status` in /home/user/rv-wp02 is clean. I created no deno.lock or `__pycache__`, and did not touch the server.
