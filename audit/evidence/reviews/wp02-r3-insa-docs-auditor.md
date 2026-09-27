REVIEWER: insa-docs-auditor
WP: WP-02
VERDICT: FAIL

The code does what the WP asks. The harness is green, the guards fail when I break them on purpose, and the counts I checked match the migrated database. The FAIL comes from one doc/control mismatch (IDA-1): the runbook and the migration say new functions in every schema except `public` and `extensions` start closed, and that is not true for `storage`. Under §0A.4 a doc/control mismatch is major. The fix is small: either one extra default-privilege revoke in the pending migration, or a one-line doc correction. Since this was round 3, the last one §0A.1 allows, the WP now goes to the human: fix IDA-1 or record it as an accepted residual risk.

FINDINGS:
  - id: IDA-1
    severity: major
    location: docs/DEPLOYMENT.md:245-248; supabase/migrations/20260926000001_r6_definer_lockdown.sql:479-482
    evidence: The runbook says `a function postgres creates in any schema other than public (service_role only) and extensions starts with no EXECUTE for anyone but postgres`. The migration header says the same ("in any other schema but extensions … only by postgres"). WP-02's own production evidence (audit/evidence/wp02-prod-owners-bypassrls-defacl-20260926T105624Z.txt) shows a schema-level default `storage | f | {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`, and the migration never touches it. I started a scratch DB with production's defaults, applied step 4, then ran `create function storage.probe()`. Result: `has_function_privilege('anon','storage.probe()','execute') = t` (authenticated also t). The shim does not model the `storage` default, so the harness cannot see this. No migration creates functions in `storage` today, so the practical impact is low, but the documented control does not exist.
    reference: §0A.4 (doc/control mismatch = major); INSA Phase 3 Access Control; H-01
    fix: Either add `alter default privileges for role postgres in schema storage revoke execute on functions from anon, authenticated;` to the pending migration (and model the storage default in the shim), or correct DEPLOYMENT.md §7, the migration header and CLAUDE.md ("an extension created outside the extensions schema starts closed") to name the `storage` exception.
  - id: IDA-2
    severity: minor
    location: docs/DEPLOYMENT.md:271
    evidence: The runbook expects the public-schema default to read `{service_role=X/postgres}`. That value comes from the harness. Production starts from `{postgres=X/postgres,anon=X/…,authenticated=X/…,service_role=X/…}`. After step 4 on the production-like scratch DB it read `{postgres=X/postgres,service_role=X/postgres}`. The actual pass rule ("no anon=/authenticated= entry") still holds, but on deploy day the operator will see a value that differs from the one written.
    reference: §0A.4; INSA Phase 6 verification evidence
    fix: Change the expected value to `{postgres=X/postgres,service_role=X/postgres}`.
  - id: IDA-3
    severity: minor
    location: docs/insa/_pending-changes.md:176; audit/FIXES_VERIFIED_R6.md (WP-02 H-01 row, round-2 TI-R2-1 and SEC-R2-3 rows); supabase/security/definer_allowlist.sql:15
    evidence: Several counts are stale:
      - "definer_lockdown.sql: 51 real calls" and "definer_lockdown 51/51". The suite has plan(58): 55 calls or direct writes plus 3 state reads, and it ran 58/58.
      - "catalog_definer_security.sql 7/7 hard". It is 8/8.
      - "a deny-list has_module fails #49". #49 is the attendance-window probe; my deny-list mutation failed #50.
      - "RLS helper (321 policies)". The catalog and the regenerated inventory show 317 policies for get_tenant_id_for_user.
      - "#8 over 1018 dependencies". The catalog has 1014.
    reference: §0A.4; plan Rule 7
    fix: Update these numbers from the final-head run.
  - id: IDA-4
    severity: minor
    location: audit/FIXES_VERIFIED_R6.md (WP-02, "13 definer functions without search_path" row: "the guard now requires exactly that"); docs/insa/_pending-changes.md:174
    evidence: The docs say the guard requires exactly `public, pg_temp`. The guard regex `c ~ '^search_path=(""|public, pg_temp)$'` (catalog_definer_security.sql) also accepts an empty search_path. All 74 functions do pin `public, pg_temp` today (my catalog query: nopin = 0).
    reference: §0A.4
    fix: Either document that `""` is accepted, or remove `""|` from the regex.
  - id: IDA-5
    severity: minor
    location: docs/insa/_pending-changes.md:162-183
    evidence: The WP-02 section has no clause mapping (WP-01's section cites INSA Phase 3/5 and ISO 27001 controls). Its only "Residual:" line describes a mitigation, not a residual risk. The known residuals live only in audit/backlog.md, not in the pending residual-risk notes:
      - invoker RPCs are still executable by anon (AC-9). In the harness, anon can execute 1126 public functions (pgtap/pgcrypto included).
      - writing definer RPCs bypass the later module, aal2 and impersonation policies (AZ-8).
      - anon queries on 9 PUBLIC-scoped tables return 42501 and name the helper function (confirmed on all 9).
      - the trust context `none` covers any direct login role, not only "cron and migrations" (line 168).
    reference: Brief checklist (residual-risk register, clause mapping); INSA Phase 3
    fix: Add a clause-mapping line (H-01/L-07/G-10 → INSA Phase 3 Access Control, ISO 27001 A.8.3/A.8.2), a WP-02 residual-risk list pointing at these backlog rows, and say that "unset role" means any session that never SET ROLE.
  - id: IDA-6
    severity: info
    location: audit/FIXES_VERIFIED_R6.md (WP-02 "Gate (local, round-1 fixes)")
    evidence: The only gate record is for round 1. Nothing is recorded for f4d5924 (tsc/eslint/vitest/build/deno-check/semgrep were not re-recorded after round 2). I re-ran only pgTAP and app-rpc-grants at f4d5924, not the frontend or Deno gates.
    reference: §0A.4 / §0A.5 (gate output required at release-gatekeeper)
    fix: The release-gatekeeper records the full gate output at the final head.
  - id: IDA-7
    severity: info
    location: audit/FIXES_VERIFIED_R6.md (DM-1 row); CLAUDE.md (deployed-state block)
    evidence: Not verifiable in my scope:
      - the performance figures (308 ms / 3.57 s, from 1,420 ms / 14.0 s). I ran no EXPLAIN or benchmark; that belongs to performance-reviewer.
      - the production facts in the evidence file and the "108 of 113 applied" deployed state. Contacting production is forbidden.
    reference: §0A.5 ("not verifiable")
    fix: performance-reviewer confirms the figures; the release gate re-runs the read-only production queries on deploy day.

CHECKED:
  - Read the WP-02 plan text, acceptance tests, the Docs item and §0A. Read the final migration 20260926000001 in full, plus definer_allowlist.sql, definer_lockdown.sql, catalog_definer_security.sql, definer-inventory.py, the shim/README/.gitignore/ci.yml/useSecuritySettings.ts diffs, and the WP-02 parts of CLAUDE.md, DEPLOYMENT.md §7, OWNER_ACTIONS.md C5, audit/backlog.md, FIXES_VERIFIED_R6.md and _pending-changes.md.
  - Full harness on a fresh `rv3_wp02_insa` at f4d5924: 113 migrations and 65/65 suites green. definer_lockdown 58/58, catalog_definer_security 8/8, catalog_rls_coverage 2/2 hard. Only the WP-05 and WP-06 TODOs remain.
  - Catalog: 74 definers (65 + 9 new in WP-09), 0 unpinned, 20 trigger-only. Grants: 29 authenticated (24 + 5), 3 timhirt_view_owner, 72 service_role. Only cleanup_old_audit_logs and settle_gateway_payment are owner-only.
  - FORCE RLS is on every public table. health_alerts, system_health and data_jobs have no INSERT policy and data_jobs has no UPDATE policy. health_alerts admin UPDATE/DELETE are tenant- and school_admin-scoped, as the docs say.
  - Regenerated the inventory from the migrated DB in a scratch copy: byte-identical to the committed file. Class counts are 29/23/2/20/0, matching the docs.
  - Ran the DEPLOYMENT.md §7 drift query: 32 rows, equal to the allow-list.
  - Simulated production's default ACLs through step 4 (global row closed, public keeps service_role, extensions `{=X/postgres}`, storage still open: IDA-1/IDA-2).
  - app-rpc-grants.py: 23 app RPCs, 0 findings. It is wired into the ci.yml rls-tests job, and the three job names in OWNER_ACTIONS C5 match ci.yml.
  - Mutation tests on the guards, each restored or rolled back:
    - revoking is_guardian_of fails #2 and #8;
    - an anon grant fails #1 and #3;
    - an unpinned search_path fails #4;
    - an authenticated default privilege fails #7;
    - a deny-list has_module fails definer_lockdown #50.
  - No end-user path passes a foreign id to the tightened helpers except the messages policy, which the same-tenant branch covers. WP-09 callers use `v_uid`, which is `auth.uid()`.
  - The Report 3 Appendix A-1 anon probes and the plan's cross-tenant probes (create_export_job for tenant B, has_module for tenant B) are all present and pass.
  - Backlog claim confirmed: anon SELECT on the 9 PUBLIC-scoped tables returns 42501.
  - check-login-attempt reads system_config with service_role, so the super_admin-only thresholds do not affect it. Nothing calls get_config or is_feature_enabled.
  - Cleanup: both scratch databases dropped, scratch files removed, `git status` clean, no deno.lock or __pycache__ left, no tracked file edited.
