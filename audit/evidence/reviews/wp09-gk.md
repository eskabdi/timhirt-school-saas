REVIEWER: release-gatekeeper | WP: R6 WP-09 (code at e40f87b, worktree /home/user/rv-wp09) | VERDICT: **FAIL**

The WP-09 code looks correct and every gate is green. It fails on one open major, a missing test. TV-1 (Medium) is marked fixed in the ledger, but the new assertion proves nothing. I did not append to audit/FIXES_VERIFIED_R6.md because you said the worktree is read-only. Add the entry when the fix below lands.

## Blocking finding

**GK-1 (major): the TV-1 test passes for the wrong reason, so nothing tests that a checker needs `<resource>:approve`.**
- **Where:** `supabase/tests/rls/maker_checker_hardening.sql:396-404`. The test reads the request id and hash through `pg_temp.req()`, defined at :88. That helper runs with the caller's own rights, so it runs while acting as the teacher.
- **Why it is vacuous:** the teacher cannot see the request (the SELECT policy hides it). A diag I added shows the helper returns `NULL` for the id. `decide_approval(NULL, …)` then raises `not_allowed` at "not found", before it reaches the permission check. This is the exact flaw the test-verifier described in TV-1.
- **Proof:**
  - I replaced `if not coalesce(public.has_resource_permission(v_uid, v_resource,'approve'), false)` in `decide_approval` with `if false`. All 66 suites stayed green: 0 failures apart from the two known TODOs.
  - With the helper run as its owner instead, the unmutated schema passes and the mutated schema fails assertions 75 and 76.
  - So the database check itself works. The ledger's claim (lines 837 and 843) that the behavioural assertions fail on `a6d673e` is wrong for TV-1.
- **Fix:**
  1. Read the id and hash as postgres before calling `act_as`, using the `mh_pay` temp-table pattern already at :330-335.
  2. Add the `grades:approve` case too (a teacher deciding a `grade_edit_after_publish` request), as TV-1 asked.
  3. Show the suite fails with the permission check removed, and correct the ledger.
- This needs only a test-verifier re-check of this one item. No new round for the other reviewers.

## Reviewer verdicts

| Reviewer | Rounds | Final |
|---|---|---|
| security | r1 F, r2 F, r3 F, r3b | PASS (a6d673e) |
| tenant isolation | r1 F, r2 F, r4-ti | PASS (a714c61) |
| authz | r1 F, r2 (2 Low), r2-az | PASS (691f581) |
| code quality | cq FAIL, never re-reviewed | CQ-1 verified (mutation: assertion 80 fails); CQ-2 has a payload assertion |
| test verifier | tv FAIL, never re-reviewed | TV-2 verified (mutation: 77 and 78 fail); **TV-1 open (GK-1)** |
| regression guard | rg | PASS (7cb1fc4); later commits covered by my full harness run |
| conventions | cg | PASS |
| INSA docs | insa FAIL, never re-reviewed | INSA-1 verified (mutation: hardening #74 and catalog_definer_security #1 fail); INSA-2 and INSA-3 doc text checked |
| db-migration | r1 F, r2 F, r3 | PASS (b260bf2); later edits to 000003 not re-reviewed by db (covered by az, perf and harness) |
| state/concurrency | r1 F, r2 F, r3-sc | PASS |
| payments | r1 F, r2 F, r3 | PASS |
| frontend security | fs | PASS; later UI diff grepped, clean |
| i18n/a11y | r1 F, r2 F, r3 F | I18N9R3-1 fixed in e40f87b (see below) |
| API contract, privacy | — | PASS |
| performance | perf F, r2-perf | PASS |

Every required core and triggered reviewer (§0A.2, §0A.3, §0A.6) produced a verdict.

**I18N9R3-1:** the fix is sufficient without a 4th round.
- I ran e40f87b's `GradebookPage.test.tsx` against faf7d93's page and it fails, as claimed: `expected 'Corrections sent for approval.' not to match /sent for approval/`. It passes at e40f87b.
- The success message now depends on the save's own unfiltered `result.failed`, and an edit only adds the row to a separate `editedSince` set.
- The two info items (notice cleared on view switch, notice re-keyed per decision) are trivial.

## Gates (scratch copy of e40f87b)

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `eslint src` | 0 errors, 0 warnings |
| `vitest` | 18 files, 103/103 passed |
| `check:i18n` | 0 |
| `check:locales` | parity OK; the reformat check was skipped in the archive, so I checked by hand: the git diff is 27+/24− lines per locale set |
| `build` | OK |
| `run.sh` | 114 migrations, 66/66 suites, `maker_checker` 65/65, `maker_checker_hardening` 88/88, 2 known TODOs (WP-05, WP-06) |
| `app-rpc-grants.py` | 24 RPCs, 0 findings |
| `deno-check`, semgrep | not run here (no deno installed) |

**Guards bite:** with the grade publication trigger made a no-op, `maker_checker` fails 3 assertions (42, 43, 47) and `maker_checker_hardening` fails 4 plus 94 errors.

**Cleanup:** all `gk_wp09*` databases are dropped and `/tmp/gk-wp09` and `/tmp/gk-wp09-faf` are removed. I did not touch the server or `/tmp/pgval`.

## Outstanding items

- **Blocking:** GK-1 only.
- **Backlog (already in audit/backlog.md lines 84-109, not blocking):**
  - no expiry scheduler (WP-16);
  - SEC-R2-3: withdrawal and other statuses (WP-14);
  - SC-R2-4 (WP-16);
  - PAY-R2-5: splitting a payment across days or invoices (WP-04);
  - race tests exist only as recorded probes (WP-17);
  - CQ-3, CQ-5, CQ-6, CQ-7 and TV-3, TV-5 (WP-14, WP-17);
  - RG-1: cross-school bank reference reuse (WP-03, also in the residual risks);
  - CG-3 and CG-6: EC and Addis "today" (WP-14);
  - FS-1 root cause and FS-3 (WP-14);
  - PRV9-1 in general (WP-10);
  - AZ-06 (WP-07);
  - the unverified a11y screen-reader items.
- **Minor, process:** no db-migration re-review after the 000003 edits in a6d673e, 7cb1fc4, a714c61 and 691f581. Compensated by the az and perf re-checks on 691f581 and the full harness.

## Deploy preconditions

1. **Owner action A0:** restore both paused Supabase projects (production `livqynxlibmccaycseer` first, then staging `ekebibapffrhzibidbnr`). Moving production to Pro is recommended (backups, no pausing).
2. **GK-1** fixed and re-verified. Record this gate's PASS and the WP-09 entry in audit/FIXES_VERIFIED_R6.md.
3. **Production preflights, re-run at deploy time.** The earlier results are stale (2026-09-27):
   - pending cash/bank payments must be 0 (DB-10);
   - payments and fee lines whose tenant differs from their invoice header's tenant must be 0, or the composite foreign keys in 000003 fail (TI-R2-4, RG-5);
   - capture a pre-deploy evidence file (D-03: no PITR or backups).
4. **Staging dry run first**, then apply 000001, 000002 and 000003 to production, each in its own transaction, once each, inside the deploy wrapper (`set local lock_timeout` relies on it).
5. **Owner notice B1a:** every cash or bank payment now needs a second approver unless a threshold is set, and a school with only one admin needs a second approver account. Get the owner's threshold choice for each school.
6. **After deploy:**
   - run the definer-grant drift query in docs/DEPLOYMENT.md (5 WP-09 grants, `approval_required` closed);
   - deploy the 4 changed Edge Functions (`record-fee-payment`, `issue-fee-document`, `generate-fee-invoices`, `enroll-finalize-billing`) and the frontend (`npm run deploy` from a `git archive` with `VITE_COMMIT_SHA`);
   - grep the served bundle for WP-09 code.
7. **Ship only e40f87b's WP-09 scope.** Exclude the Academic Calendar commits (bc8dd3f and later, migration `20261008000001`).

Key files:
- /home/user/rv-wp09/supabase/tests/rls/maker_checker_hardening.sql
- /home/user/rv-wp09/supabase/migrations/20260927000003_r6_maker_checker_hardening.sql
- /home/user/rv-wp09/audit/FIXES_VERIFIED_R6.md
- /home/user/rv-wp09/docs/OWNER_ACTIONS.md