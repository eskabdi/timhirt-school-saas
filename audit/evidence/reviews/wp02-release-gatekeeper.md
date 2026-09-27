REVIEWER: release-gatekeeper
WP: WP-02 (H-01, L-07, G-10), head `98b78e3`
VERDICT: **FAIL**

The code holds up: I re-ran every gate, mutation-tested the key fixes and found no blocker. The FAIL is about process only. It comes from two majors that need either your decision or two short reviewer runs. No code change is required.

```
FINDINGS:
  - id: GK-1
    severity: major (process)
    location: commits 853c371, b5779d4, 98b78e3 → supabase/migrations/20260926000001_r6_definer_lockdown.sql:77,242-248,379-383,514-520,541; supabase/tests/shim.sql
    evidence: No reviewer has looked at the code after the round-3 verdicts at f4d5924, and §0A.1 allows no 4th round. That code includes has_module's caller check rewritten as one inline lookup, the same change in attendance_retroactive_edit_window_days, the new revoke of the `storage` default privileges, and the lock_timeout change from SET LOCAL to SET plus RESET. code-quality, insa-docs and performance each have only a FAIL verdict on record. Security, authz and tenant-isolation last passed at 16548ba, which is before the f4d5924 and 98b78e3 helper rewrites. No owner acceptance is recorded (OWNER_ACTIONS.md has no WP-02 item; 10-residual-risk-register.md does not exist). This is the same situation as WP-01 GK-2 / B4.
    reference: §0A.1 (max 3 rounds, then escalate), §0A.5, §0A.4 (major = fixed or accepted by the human)
    fix: The owner picks one: (A) accept the gatekeeper's independent verification of the three fix commits (listed under CHECKED), or (B) order one targeted re-review of 853c371..98b78e3 by security, tenant-isolation, performance and insa-docs. Record the choice in OWNER_ACTIONS.md.
  - id: GK-2
    severity: major (process)
    location: .github/workflows/ci.yml:98-105 (16548ba, 853c371); src/lib/useSecuritySettings.test.tsx (16548ba, 853c371)
    evidence: The diff touches `.github/workflows/**`, which triggers supply-chain-reviewer, and `src/**/*.tsx`, which triggers frontend-security-reviewer (§0A.3). Neither review file exists in audit/evidence/reviews/wp02-*. My own check found nothing: the CI step runs a stdlib-only script (`import os, re, subprocess, sys`), adds no action, dependency or lockfile change, and pinned-actions is ok (7 uses, all SHA-pinned). The .tsx file is a Vitest test with no DOM sinks. But §0A.5 says a missing required reviewer fails the WP.
    reference: §0A.3 path triggers, §0A.5, WP-01 GK-3 precedent
    fix: Run supply-chain-reviewer and frontend-security-reviewer on the WP-02 diff (a small scope, both expected to PASS), or have the owner accept the gatekeeper's check.
  - id: GK-3
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:246
    evidence: Mutation m3 removes `and ct.status is distinct from 'suspended'` from has_module. definer_lockdown, catalog_definer_security, tenant_suspension_lockout, module_gating and attendance_audit all stay green. It is defence in depth: get_tenant_id_for_user already returns NULL for suspended tenants, so every tenant-scoped policy is closed anyway. It was also untested at f4d5924.
    reference: plan Rule 4
    fix: Add a probe where a user of a suspended tenant calls has_module(own tenant, 'library') and gets false, and the same for the attendance window (default 7). Goes to the backlog (WP-06).
  - id: GK-4
    severity: minor
    location: audit/FIXES_VERIFIED_R6.md:632
    evidence: "test-verifier, performance and insa-docs: listed as they return." is stale text (all three returned). The gate section at :663 describes itself as run on "the commit that adds this section", which cannot be verified from the commit itself. My re-run at 98b78e3 matches it line for line.
    fix: Delete the stale sentence and cite this gatekeeper re-run.
  - id: GK-5
    severity: info
    location: supabase/tests/rls/catalog_definer_security.sql:122-129
    evidence: Check #9 passes a function that has one conforming trusted-role list and a second, deny-list copy (the regex needs only one match). All 9 current copies conform. Mutation m4 (deny-list) is caught.
    fix: Count the `current_setting('role'` occurrences and require the same number of conforming matches. Backlog.
  - id: GK-6
    severity: info
    location: audit/evidence/reviews/wp02-r3-code-quality-reviewer.md (CQ-1 fix text)
    evidence: The reviewer suggested 20260715000013 as the source for get_role_for_user. That file only GRANTs. The implementer's header cites 20260713000001_core, which is correct: grep shows it is the only earlier CREATE. All 11 cited sources and both dropped-policy line references check out.
    fix: none
  - id: GK-7
    severity: info
    location: bench (my run, same data for all three bodies)
    evidence: Tenant B students count: head 365-392 ms, pre-WP-02 345-349 ms (+5-12%), round-3 f4d5924 497-524 ms. Everything else is at parity: B attendance 3.92-3.97 s vs 3.83-4.01 s (round-3: 5.39-5.56 s), A students 597-634 vs 637-656 ms, A attendance 6.31 vs 6.83-6.93 s.
    fix: none. PERF-1 is closed. The remaining per-row gate cost predates WP-02 (PERF-3, backlog → WP-06).

CHECKED:
  - Required reviewers: all 8 core plus db-migration, api-contract and performance have verdicts. supply-chain and frontend-security, which the path triggers require, have none (GK-2).
  - Fresh DB gk_wp02: run.sh exit 0, 113 migrations, 65/65 suites (catalog_definer_security 10/10, catalog_rls_coverage 2/2, definer_lockdown 58/58, maker_checker 65/65, security_settings 8/8). A second run on the same DB is also exit 0 (RG-1 holds).
  - app-rpc-grants: self-test ok, 23 RPCs, 0 findings. tsc 0, eslint src 0/0, vitest 16 files / 98 tests, check:i18n 0, check:locales ok, build 0. deno-check (Deno 2.9.6) 28 functions, 3 baselined, ok. deno test 37/0. semgrep rule test 16/0/0. conventions 0. pinned-actions ok.
  - Harness at production's 108 migrations: 65 definer / 11 invoker functions, 42 anon-executable, 13 unpinned. This matches the production evidence file exactly.
  - Mutations (each on a clone of the migrated DB): m1 has_module with no caller check → definer_lockdown #21, #50 fail; m2 super_admin branch removed → #46; m4 deny-list → #50 and catalog #9; m5 tenant-equality removed → #21, #50; m6 attendance caller check removed → #23, #49; m7 anon default in storage → catalog #7 (IDA-1); m8 extensions PUBLIC default revoked → #7 (TV3-2); m9 has_module as SQL → #9, #10 (DM3-3). m3 (suspended clause) survives (GK-3).
  - PERF-1 rewrite is logically the same as the f4d5924 rule: super_admin, or own tenant and not suspended. Null tenant, null uid and anon all resolve to deny.
  - CQ-1: all 11 forward-fix sources are the latest earlier CREATE. Dropped-policy references 20260719000010:41,47 and 20260719000011:49,55 are correct.
  - IDA-1: production has the storage default (evidence file lines 33-35). The migration revokes it, the shim models it, and #7 guards it. No repo migration creates functions in storage.
  - definer_inventory.md regenerated in a scratch copy is byte-identical (74 functions: 29 Private, 23 Internal, 2 Disabled, 20 Trigger-only). Allow-list has 32 rows (29 authenticated, 3 timhirt_view_owner, 0 anon).
  - useSecuritySettings: keyed by user, enabled only with a session, login thresholds dropped. No sinks.
  - Cleanup done: gk_wp02* databases dropped, my deno.lock and tsconfig.tsbuildinfo removed, worktree clean.
```

**To turn this into a PASS, with no code change:**
1. Get your decision on GK-1: accept my verification of the post-round-3 commits, or order the targeted re-review.
2. Run supply-chain-reviewer and frontend-security-reviewer on the WP-02 diff (GK-2), or accept my check instead.
3. Copy GK-3 through GK-5 into `audit/backlog.md`.

**Decisions for you:**
- **GK-1:** I recommend accepting the gatekeeper's review. Every changed line was mutation-tested, the behaviour is logically the same as round 3's, and the benchmark was reproduced.
- **GK-2:** I recommend running the two reviewers. It is cheap, and it follows how WP-01 handled the same gap.
- **Plan deviations** (`get_email_for_user` and `create_*_job`/`acknowledge_alert` stay granted to authenticated with checks inside; `has_module` keeps its tenant parameter; `get_config` is locked rather than split): I recommend accepting them into the residual-risk register. They are tested with cross-tenant and unexpected-role probes.
- **Residual risks AC-9, AZ-8, SEC-11, PERF-3:** I recommend scheduling them into WP-06, WP-07 and WP-18 as the backlog already proposes.
- **C5** (make CI a required check): I recommend doing it before this PR merges.

**Proposed ledger entry** (for `audit/FIXES_VERIFIED_R6.md`, after "Gate at the final WP-02 head"):

```
### Release gatekeeper — WP-02 (2026-09-27, HEAD `98b78e3`): FAIL (process only)

Independent re-run, fresh database: 113 migrations, 65/65 suites (definer_lockdown 58/58, catalog_definer_security 10/10, catalog_rls_coverage 2/2), re-run on the same DB green; app-rpc-grants 23/0; tsc, eslint, vitest 98/98, i18n, locales, build, deno-check, deno test 37/0, semgrep rule test, conventions, pinned-actions all green. Harness at 108 migrations = production (65 definers, 42 anon, 13 unpinned).
Mutations caught: has_module caller check removed / super_admin branch removed / deny-list / tenant equality removed / SQL body; attendance window caller check removed; storage anon default; extensions PUBLIC default. Survivor: has_module suspended clause (GK-3, minor, defence in depth).
Post-round-3 majors verified: CQ-1 (all 11 sources correct; the reviewer's own suggestion for get_role_for_user was wrong), IDA-1 (storage default revoked and guarded), PERF-1 (two-tenant rerun: head ≈ pre-WP-02, B students +5–12%, all others at parity; round-3 body 1.4x).

| Finding | Severity | Status |
|---|---|---|
| GK-1: post-round-3 fixes (853c371, b5779d4, 98b78e3) reviewed only by the gatekeeper; §0A.1 allows no 4th round | major (process) | **Owner decision** (OWNER_ACTIONS B6) |
| GK-2: path-triggered supply-chain (ci.yml) and frontend-security (useSecuritySettings.test.tsx) reviewers never ran | major (process) | Run them, or owner accepts the gatekeeper's check (no new actions or deps; test file has no sinks) |
| GK-3: has_module suspended-tenant clause untested | minor | backlog → WP-06 |
| GK-4: stale sentence at "Round 3 review" | minor | fix text |
| GK-5: catalog #9 accepts one conforming plus one deviant copy | info | backlog |
| GK-6, GK-7 | info | none |

Verified on staging: no (staging empty, WP-17). Verified on production: no (deploy pending).
```

**Deploy prerequisites:**
1. Your explicit "deploy" (B1). Deploy after the WP-01 migrations `20260925000002`/`…03`, and before the WP-09 migrations `20260927000001`/`…02`, which rely on functions starting closed.
2. Pre-apply, read-only production re-query on deploy day. Expect 65 definer and 11 invoker functions in `public`, all owned by postgres (ALTER FUNCTION needs ownership); 42 anon-executable; 13 unpinned; 11 tables without FORCE; postgres with BYPASSRLS; default ACLs as in `audit/evidence/wp02-prod-owners-bypassrls-defacl-20260926T105624Z.txt`. Commit that output as the pre-deploy capture, since PITR is off (D-03).
3. Apply through the deploy wrapper inside one transaction (5 s lock timeout; if it times out, retry — do not force it). Never re-run it by hand afterwards.
4. Ship the frontend (`useSecuritySettings`) in the same release with `npm run deploy` (never `--prebuilt`), then grep the served bundle to confirm it is the new build.
5. Post-apply checks:
   - The DEPLOYMENT.md §7 drift query returns exactly the allow-list: 32 rows with WP-09 (27 without it), and no anon.
   - Every table has FORCE.
   - postgres's global default no longer grants PUBLIC; the `public` and `storage` defaults grant no anon or authenticated; `extensions` still grants PUBLIC.
6. Smoke test as a school admin and as a student: dashboard, Import/Export job creation, health alert acknowledgement, exam seat auto-assign, and the password policy on the invite and change-password pages.
7. Recommended: branch protection with required CI checks (C5) before merging PR.

Files: `/home/user/rv-wp02/audit/FIXES_VERIFIED_R6.md`, `/home/user/rv-wp02/supabase/migrations/20260926000001_r6_definer_lockdown.sql`, `/home/user/rv-wp02/supabase/tests/rls/catalog_definer_security.sql`, `/home/user/rv-wp02/docs/OWNER_ACTIONS.md`, `/home/user/rv-wp02/audit/backlog.md`, and scratch at `/tmp/gk_wp02/` (`run1.txt`, `run2.txt`, `bench.txt`, `mut/`).
