REVIEWER: api-contract-reviewer
WP: WP-02 (round 3, head f4d5924; implementation c4ecfac..7c81fd7, review fixes 67a627d..f4d5924)
VERDICT: PASS

All 14 of my round-1 findings are either fixed in code with a test that fails without the fix, or recorded in `audit/backlog.md` / the ledger. I found no blocker or major on the fixed head. Three minor/info issues remain, listed below.

FINDINGS:
  - id: AC3-1
    severity: minor
    location: /home/user/rv-wp02/audit/FIXES_VERIFIED_R6.md:568, :632, :633
    evidence: The ledger still says `definer_lockdown` 51/51 and `catalog_definer_security` 7/7, and gives fail-before counts out of 51. The round-2 commits (6a89aa0, 3108004) grew those suites: on f4d5924 the plans are `1..58` and `1..8`. The other numbers match my run: 113 migrations, 65 suites, `security_settings` 8, `exam_seating_charts` 9, `maker_checker` 65. The round-1 AC-10 fix was made, but it went stale again.
    reference: plan Rule 5 / Rule 10 (evidence must match the actual run)
    fix: Change to 58/58 and 8/8, and re-run the fail-before against 7c81fd7 with the current test files.
  - id: AC3-2
    severity: minor
    location: /home/user/rv-wp02/scripts/ci/app-rpc-grants.py:21, :32
    evidence: The scanner reads one line at a time and uses the regex `\brpc(?:<[^>(]*>)?\(\s*["'`]…`. I tested the regex. It misses a nested generic: `rpc<Array<X>>("b")` gives `[]`. It also misses any call that breaks the line after `rpc(`. It only knows the one `rpc<T>` wrapper, so any other wrapper that forwards a name variable (like `useDashboardData.ts:61`) is invisible to it. Today src/ has no multi-line or nested-generic calls, so the result (23 RPCs, 0 findings) is complete for this head. But the gate could turn green without actually checking a future call. It does fail correctly on a real revoke: I revoked `create_import_job` and it reported `closed create_import_job … ImportExportPage.tsx:63`, exit 1.
    reference: CLAUDE.md "Prove a gate fails before trusting that it passed" / TV-3
    fix: Scan the whole file with a DOTALL regex, allow nested `<…>`, or use a TS AST walk. Add a self-test fixture with a multi-line call and a nested generic.
  - id: AC3-3
    severity: info
    location: /home/user/rv-wp02/audit/FIXES_VERIFIED_R6.md:582
    evidence: The AC-4 deviation (job and alert RPCs stay granted to `authenticated`, with checks inside) is now recorded with its rationale, and `_pending-changes.md` has the same text. I found no record that the owner accepted it. My round-1 fix asked for that.
    reference: §0 Rule 10
    fix: The gatekeeper should confirm owner acceptance, or confirm that recording is enough for a minor.
  - id: AC3-4
    severity: info
    location: /home/user/rv-wp02/supabase/migrations/20260926000001_r6_definer_lockdown.sql:95-190 (plpgsql rewrite of the hot helpers)
    evidence: Not verifiable by me: the DM-1 performance numbers (308 ms / 3.57 s). I checked only that the rewrite keeps the same predicates and that all suites pass.
    reference: DM-1 / AC-14
    fix: The performance-reviewer should confirm with EXPLAIN ANALYZE.
  - id: AC3-5
    severity: info
    location: repository (no OpenAPI spec)
    evidence: Still not verifiable: there are no OpenAPI paths, examples or x-insa-category for the RPCs. It is tracked in `audit/backlog.md` (AC-11 → WP-18).
    reference: WP-18
    fix: As in the backlog.

Round-1 disposition:
- **Fixed in code:**
  - AC-1: the attendance window gives the default 7 for another tenant. Probes #23 and #49; service_role still sees the real value (#58).
  - AC-2: the login thresholds go only to super_admin and trusted contexts. Probes #16, #47 and #54, plus `security_settings` #6.
  - AC-3: `has_resource_permission` probes #39 and #40 now discriminate, with positive control #22.
  - AC-5: `data_jobs_write` and `data_jobs_admin_update` are dropped. Probes #30, #31 and #44.
  - AC-6: validation added (entity allow-list matches `ImportExportPage.tsx:41`; the 5 MB cap matches the data-imports bucket limit). Probes #26 to #29.
  - AC-8: new class "Disabled (owner only)".
  - AC-12: the evidence file shows all 65 production definer functions are owned by postgres, and postgres has BYPASSRLS.
  - AC-13: the hook is keyed by user id and runs only with a session.
- **Partly fixed:** AC-7. The `exam_not_found` part is unified. The rest (P0001 still maps to a 400; `acknowledge_alert` still silently does nothing on a foreign id) is in the backlog for WP-12.
- **Backlogged:** AC-6 idempotency (WP-12), AC-9 (WP-06/WP-18), AC-11 (WP-18), AC-14 (fixed, with a remaining row for WP-06).
- **Recorded:** AC-4 as a deviation row.
- **Corrected, then stale again:** AC-10 (see AC3-1).

CHECKED:
  - Read WP-02 (plan :329-389), my round-1 verdict, the full current migration, and the diff 67a627d..f4d5924 for src, scripts, CI, the security files, the shim, the WP-09 edits and the backlog. Read the FIXES_VERIFIED WP-02 section.
  - Ran the harness on a fresh `rv3_wp02_api`: 113 migrations, all 65 suites pass. `definer_lockdown` 58/58, `catalog_definer_security` 8/8. `app-rpc-grants.py`: 23 app RPCs, 0 findings.
  - Fail-before, round-1 migration: I swapped 7c81fd7's migration into an f4d5924 scratch tree. `definer_lockdown` fails #12, #16, #23, #26 to #30 and more. `catalog_definer_security` fails #1, #3 and #7. `exam_seating_charts` #9 and `security_settings` #6 also fail.
  - Fail-before, no WP-02 migration: the catalog guards, FORCE RLS coverage, and the anon probes #1 to #5 all fail.
  - The `app-rpc-grants.py` gate fails (exit 1) when I revoke `create_import_job`, and passes again after I re-grant it. I also probed its regex edge cases (AC3-2).
  - `useSecuritySettings`:
    - tsc 0 and eslint src 0; Vitest passes the 2 tests.
    - Mutations in a scratch copy: removing `enabled` fails test 1, and going back to the unscoped query key fails test 2.
    - Consumers checked: AcceptInvitePage (session from the URL hash), ChangePasswordModal, useIdleLogout. SecuritySettingsPage's `["security-settings"]` prefix invalidation still matches the new key.
    - No consumer used the removed login fields. check-login-attempt reads `system_config` with the service role.
  - Client parity for the job RPCs: argument names, the entity list and the bucket limit match the database checks. The errors are 42501 "permission denied for tenant" and 22023 "invalid entity type/file size": generic, with no ids.
  - Edge Function RPC calls to closed functions use adminClient/service role. `claimJob` uses adminClient, so dropping `data_jobs_admin_update` does not break processing.
  - WP-09 edits: `approval_required` and `exam_results_published` now use the trusted-role allow-list. `approval_payload_hash` is revoked from authenticated.
  - Regenerated the inventory from a scratch copy of the script: identical to the committed file (74 rows).
  - Cleanup: dropped `rv3_wp02_api`, `rv3_wp02_api_r1` and `rv3_wp02_api_none`, and removed the scratch trees. The worktree is clean at f4d5924, with no deno.lock or `__pycache__`.
  - Not run: full vitest, build, i18n/locales, deno-check and semgrep. This diff's src change is limited to useSecuritySettings and its test.
