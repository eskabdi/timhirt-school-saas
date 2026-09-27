REVIEWER: regression-guardian
WP: WP-02 (round 3; head f4d5924; implementation c4ecfac..7c81fd7, fixes 67a627d..f4d5924)
VERDICT: PASS

RG-1 is closed. I ran `run.sh` twice on the same database and both runs were green (113 migrations, 65/65 suites). The new plpgsql helpers matched the previous SQL bodies in all 1,640 cases I compared. No blocker or major finding is open.

FINDINGS:
  - id: RG3-1
    severity: minor
    location: .github/workflows/ci.yml (security-scan job: semgrep, semgrep-rule-test.py, gitleaks)
    evidence: Not verifiable. `which semgrep gitleaks` returns nothing, and `gh` is not installed. So I could not run the semgrep rule test, the semgrep scan or the secret scan, and I could not confirm the CI status of 16548ba or f4d5924. FIXES_VERIFIED_R6.md says "RG-6: CI security-scan green on `16548ba`"; I could not check that claim. Round 3 changes no src/ or Edge Function code (it touches migrations, tests, the shim and docs), so the exposure is low. This carries over RG-6.
    reference: §0A.5 ("cannot verify → finding")
    fix: Confirm the security-scan CI job is green on f4d5924 before merge.

  - id: RG3-2
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:66
    evidence: The migration has no BEGIN of its own. Applied with a bare `psql -f`, which is how the harness runs it, `set local lock_timeout = '5s'` only prints `WARNING: SET LOCAL can only be used in transaction blocks` and has no effect. I reproduced that warning on a scratch database. The DM-3 fix only works if the production deploy wrapper runs each migration in a transaction. CLAUDE.md says it does ("the deploy wrapper's transaction"), but I could not check that here. Nothing breaks either way.
    reference: DM-3 fix claim in audit/FIXES_VERIFIED_R6.md (round 2 table)
    fix: None required. Optionally check at deploy time that the migration runs inside a transaction, or use `set lock_timeout` and reset it at the end of the file.

  - id: RG3-3
    severity: info
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:419
    evidence: |
      This change was not in the WP-02 text: the migration now drops `data_jobs_admin_update`, so a school admin can no longer UPDATE `data_jobs` directly. I found no regression from it:
      - Neither src/ page updates the table. HealthMonitoringPage.tsx:102 and ImportExportPage.tsx:50 only SELECT.
      - In the Edge Functions, the userClient only reads `data_jobs`. `claimJob` (_shared/jobs.ts:36) is called with `ctx.adminClient` in both processors.
      - The only policy left on `data_jobs` is `data_jobs_read`. health_alerts keeps its admin update and delete policies, as the INSA pending-changes text says.
      - The new probe is not vacuous. The import job from line 72 already exists when it runs. I recreated the original policy from 20260719000010:47 and definer_lockdown failed exactly `not ok 31`; after I dropped the policy again it passed 58/58.
    reference: regression-guardian mandate (flag behaviour changes the WP did not ask for)
    fix: None required.

  - id: RG3-4
    severity: info
    location: supabase/tests/rls/catalog_definer_security.sql:82
    evidence: |
      The new guard #8 finds its dependencies through pg_depend. It fails on a planted offender: revoking `is_guardian_of` from authenticated produced `not ok 8` listing 19 policies, and it passed 8/8 after the re-grant. Its coverage has two limits:
      - pg_depend does not record calls made inside a function body, so a policy that calls an open invoker helper which in turn calls a closed function is not caught.
      - Policies are checked only for `authenticated`, not `anon` (a stated scope choice).
      There is no offender today: the full harness is green and app-rpc-grants reports 0 findings.
    reference: SEC-R2-3 fix claim
    fix: None for WP-02. Optionally note the body-call gap in the suite header or the backlog.

  - id: RG3-5
    severity: info
    location: docs/audits/timhirt-production-fix-plan.md:1863-1876 (§7)
    evidence: |
      Some §7 guards still do not exist, so I could not re-run them. None of them is WP-02's to add. This carries over RG-7.
      - "Vitest for AcademicRecordTab"
      - `grade_history_ledger.sql` (WP-08)
      - the `export-bank-transfer` tests (WP-12.2)
      - the WP-14.1 runtime numerals test
    reference: §7 Regression Guard
    fix: None for WP-02.

CHECKED:
  - **RG-1 closed.**
    - `shim.sql` now restores `alter default privileges for role postgres grant execute on functions to public` before `create extension pgcrypto/pgtap`.
    - Harness run 1 on a fresh database `rv3_wp02_regr`: 113 migrations, 65 suites ok, exit 0.
    - Run 2 on the same database, after the migration had left the global default as `{postgres=X/postgres}`: 65 suites ok, exit 0.
    - pgtap's `throws_ok` has proacl NULL after a re-run (the built-in default, which includes PUBLIC EXECUTE). The ledger sentence at FIXES_VERIFIED_R6.md:579 is corrected and now matches.
  - **RG-2 closed.** DEPLOYMENT.md:271 now says "no PUBLIC entry … expected `{postgres=X/postgres}`". That matches the harness `pg_default_acl` (`-|{postgres=X/postgres}`, `public|{service_role=X/postgres}`).
  - **RG-4.** WP-09 now revokes `approval_payload_hash` from authenticated explicitly. Its proacl is `{postgres=X/postgres,service_role=X/postgres}`.
  - **Helper equivalence (plpgsql vs the 16548ba SQL bodies).**
    - I installed the old bodies as `old_*` functions and compared them with the new `get_tenant_id_for_user`, `get_role_for_user` and `has_module`.
    - Roles: none/postgres, authenticated, service_role, an unexpected role, and timhirt_view_owner.
    - Callers: 6 users and NULL. The users cover active, suspended and trial tenants, super_admin with and without a tenant, and a nonexistent id.
    - Targets: the same users plus NULL; for `has_module`, 5 tenant ids × 5 modules, with overrides set to true and false and tiers basic, standard and premium.
    - Result: 1,640 cases, 0 differences.
    - To prove the comparison can fail, I planted two mutations; they produced 26 and 23 differences.
    - I also checked the semantics against the table definitions:
      - `users.role` is NOT NULL.
      - `tenant_module_overrides` has PK (tenant_id, module_key) and `enabled` NOT NULL.
      - `tier_modules` has PK (tier_key, module_key).
      - So the non-strict SELECT INTO and `exists` cannot change results.
    - Compared with the pre-WP-02 bodies (core, 20260821000002, 20260821000003), the trusted-role answers are unchanged. Grants and ACLs on the three helpers are kept, including timhirt_view_owner, and all three are STABLE plpgsql.
  - **DM-1 performance claim.** On 5k students as a school_admin: 310–410 ms with the plpgsql helpers against 1,546–1,626 ms with the 16548ba SQL bodies swapped in. This agrees with the ledger's 308 ms / 1,420 ms.
  - **§7 guards re-run.**
    - Green: resource_permissions (20/20), _academics (52/52), _fees_comms_library (38/38) and _hr (37/37); catalog_rls_coverage 2/2; class_rank 9/9; grading_scales_lookup 6/6; payroll_sod 7/7.
    - catalog_module_gate: 8/9 with the expected WP-06 TODO.
    - `conventions.py`: 0 findings.
  - **Catalog guards.**
    - catalog_definer_security 8/8, catalog_storage_policies 19/20 (expected WP-05 TODO), catalog_storage_probe 14/14.
    - definer_lockdown 58/58, maker_checker 65/65, security_settings 8/8, exam_seating_charts 9/9.
    - Planted offenders: guard #8 fails as described in RG3-4, and the data_jobs update probe fails as described in RG3-3.
  - **§5 queries.** Query 1 (anon-executable or unpinned definer functions): 0 rows. Query 2 (tables without RLS or FORCE, relkind r and p): 0 rows. Query 5 (Ge'ez digits in config): 0.
  - **WP-00 closures kept.** `settle_gateway_payment` and `cleanup_old_audit_logs` proacl are `{postgres=X/postgres}`.
  - **definer_inventory.md.** I regenerated it from the head database with a scratch copy of the generator. It is byte-identical, 74 rows, including the new 215/317 policy counts.
  - **Round-3 diff reviewed** (16548ba..f4d5924): migration, shim, both test suites, the WP-09 edit, DEPLOYMENT.md, FIXES_VERIFIED, backlog, CLAUDE.md and INSA pending changes. The only unrequested behaviour change I found is the one in RG3-3.
  - **Gates.**
    - `tsc --noEmit` 0 and `eslint src --max-warnings 0` 0.
    - vitest: 16 files, 98 tests.
    - check:i18n 0, check:locales passed, build 0.
    - app-rpc-grants: 23 RPCs, 0 findings.
    - deno-check (deno 2.9.6): 28 functions, 3 baselined, ok.
    - semgrep and gitleaks were not run; see RG3-1.
  - **Cleanup.** `rv3_wp02_regr` and `rv3_wp02_regr_lt` are dropped, and no `rv3_wp02_regr*` database remains. There is no deno.lock or `__pycache__`; `git status` shows no tracked changes, and HEAD is still f4d5924.
