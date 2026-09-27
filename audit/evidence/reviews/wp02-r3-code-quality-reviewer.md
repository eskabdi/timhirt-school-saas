REVIEWER: code-quality-reviewer
WP: WP-02 (round 3)
VERDICT: FAIL

FINDINGS:
  - id: CQ-1
    severity: major
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:47-50
    evidence: The migration header is the documented undo plan (docs/DEPLOYMENT.md §7 says "its header lists each reverse statement"). It reads: "latest earlier definitions: 20260817000006 has_resource_permission, 20260821000005 attendance_retroactive_edit_window_days, 20260825000001 auto_assign_exam_seats, the rest in 20260715*/20260719*". Three of "the rest" point to the wrong files:
      - `get_tenant_id_for_user` was last defined in `20260821000002_suspended_tenant_lockout.sql:30`, which added `u.role = 'super_admin' or not exists (… t.status = 'suspended')`.
      - `has_module` was last defined in `20260821000003_module_gating_rls.sql:53`.
      - `get_security_settings` was last defined in `20260806000001_security_settings.sql:51`.
      An operator who follows the header and restores `get_tenant_id_for_user` from `20260715000013` removes the suspended-tenant lockout, so a closed control comes back open during a rollback.
    reference: §0A.4 severity rule "doc/control mismatch"; §0A.3 db-migration "reversible plan"
    fix: List every replaced function next to its real latest earlier migration: get_email_for_user 20260715000012, get_role_for_user 20260715000013, get_tenant_id_for_user 20260821000002, has_module 20260821000003, get_security_settings 20260806000001, create_*_job 20260719000010, acknowledge_alert 20260719000011. Because this migration is not deployed yet, the fix can go in the header itself; otherwise update the DEPLOYMENT.md pointer.
  - id: CQ-2
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:318 (live catalog comment)
    evidence: `CREATE OR REPLACE` keeps the old `COMMENT ON FUNCTION`. The migrated DB still returns `get_security_settings()|Read-only: the platform-wide login/idle-timeout/password-policy values … for any authenticated user.` Since WP-02, only super_admin and trusted contexts get the login thresholds.
    reference: INSA docs generated from code (WP-18)
    fix: Add `comment on function public.get_security_settings() is '…'` describing the new split.
  - id: CQ-3
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:112,136,161,179,224,337,356; supabase/migrations/20260927000002_r6_maker_checker.sql:172,201
    evidence: The trusted-context allow-list literal `coalesce(current_setting('role', true), 'none') in ('none', 'service_role', 'postgres', 'supabase_admin')` is copied 9 times across two migrations (7 + 2). Adding or removing a trusted role later means editing every copy, and one missed copy leaves an oracle open.
    reference: Duplication of existing helpers; CLAUDE.md "trusted contexts" rule
    fix: Add one inlinable `language sql stable` invoker helper (for example `public.is_trusted_db_context()`) granted to authenticated, and call it everywhere. If the per-row cost (DM-1) rules that out, add a catalog check that every copy of the literal is identical.
  - id: CQ-4
    severity: minor
    location: supabase/tests/rls/catalog_definer_security.sql:54-55
    evidence: The regex `c ~ '^search_path=(""|public, pg_temp)$'` also accepts `search_path=""`, but the assertion text and header (line 7) say "exactly public, pg_temp".
    reference: Test and message mismatch
    fix: Either drop the `""` branch or change the message and header to say an empty search_path is also accepted.
  - id: CQ-5
    severity: info
    location: scripts/ci/app-rpc-grants.py:21 vs scripts/db/definer-inventory.py:33
    evidence: The two scripts use two different regexes to find app RPC calls. The CI one accepts backtick names (`["'\`]`); the inventory one does not (`[\"']`). A template-literal `.rpc(\`x\`)` call would be caught by CI but missing from the inventory's "App callers" column.
    reference: Duplicated logic
    fix: Put one shared pattern in a small shared module, or make the two regexes match.
  - id: CQ-6
    severity: info
    location: src/lib/useSecuritySettings.test.tsx:14
    evidence: `supabase: { rpc: (...a: unknown[]) => h.rpc(...(a as [])) }` casts `unknown[]` to an empty tuple just to satisfy a zero-arity `vi.fn`.
    reference: Strict typing hygiene
    fix: Type the mock as `vi.fn(async (_name: string) => …)` and forward `(name: string) => h.rpc(name)`.

CHECKED:
  - Read WP-02 plan text and acceptance criteria (§4 WP-02), plus §0A.1–0A.6.
  - Reviewed the full `git diff c4ecfac 7c81fd7` and `git diff 67a627d f4d5924` for the migration, allow-list, inventory, shim, pgTAP suites, CI step, `scripts/ci/app-rpc-grants.py`, `scripts/db/definer-inventory.py`, `src/lib/useSecuritySettings.ts` and its test, and the fix-commit edits to `20260927000002_r6_maker_checker.sql`.
  - `npx tsc --noEmit`: exit 0. `npx eslint src`: exit 0, no output.
  - `npx vitest run`: 16 files, 98 tests passed. The new `useSecuritySettings.test.tsx` passes 2/2, and its "no session → no RPC" case would fail against the pre-fix hook, which had no `enabled` flag.
  - TS: no `any` and no new non-null assertions. The removed `login*` fields have no remaining consumers (tsc clean). Invalidation in `SecuritySettingsPage.tsx:203` (`["security-settings"]`) still prefix-matches the new `["security-settings", userId]` key. Inline query keys are the codebase norm (423 inline vs 2 `qk.*`).
  - `supabase/tests/run.sh` on the fresh DB `rv3_wp02_cq`: 113 migrations applied, all suites passed (`definer_lockdown.sql` 58/58, `catalog_definer_security.sql` 8/8).
  - `scripts/ci/app-rpc-grants.py`: 23 app RPCs, 0 findings. Proved it fails: after revoking `create_import_job` from authenticated, it reported "closed create_import_job … ImportExportPage.tsx:63" and exited 1. The only `.rpc(` call its regex does not match is the dashboard wrapper, which the `rpc<T>(` pattern covers at its call sites.
  - Proved `catalog_definer_security.sql` fails on planted drift (anon grant on `get_config`, and reset `search_path` on `cleanup_old_audit_logs`): tests 1, 3 and 4 went to `not ok`.
  - Regenerated `definer_inventory.md` from a scratch copy against the migrated DB. It is byte-identical to the tracked file (74 rows).
  - The `has_module` plpgsql rewrite is logically equivalent to the `20260821000003` SQL body (override, then tier, then false). The `get_tenant_id_for_user` rewrite keeps the suspended-tenant check.
  - The plan deviations (`has_module` keeps its tenant param, `get_config` split replaced by a service_role-only `get_config` plus a filtered `get_security_settings`, job and alert RPCs still granted to authenticated) are recorded in `audit/FIXES_VERIFIED_R6.md:581-582` and `docs/insa/_pending-changes.md:181`.
  - `data_jobs` direct-update probe is not vacuous: the `data_jobs_read` policy lets the admin see the rows.
  - Cleanup: dropped `rv3_wp02_cq` and deleted the scratch copy. `git status` in `/home/user/rv-wp02` is clean; no `deno.lock` or `__pycache__` left behind.
  - Not verified: the plpgsql performance claims (DM-1); that belongs to performance-reviewer.
