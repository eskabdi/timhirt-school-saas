REVIEWER: release-gatekeeper, round 2 (read-only; I modified no files)
WP: F-01 Academic Calendar Engine slice 1 + invite fixes. Code is aaec819, records in 61836e2, gate follow-up in 0f04509.
VERDICT: PASS. You can deploy 61836e2, subject to the conditions below.

The four mandatory skills have now covered the final code, and I found no open blocker or major. `git diff 61836e2..0f04509 -- supabase src` is empty, so 0f04509 only adds records and does not change what ships.

## How the round-1 findings were closed
- **G-01 (major), closed.** `audit/evidence/reviews/cal1-tenant-isolation-2.md` is a review of 61836e2.
  - It confirms the delta since 6c0f215 only makes two existing checks fail closed. The `staff_no` query still filters on `ctx.tenantId`.
  - It re-ran the harness (116 migrations / 68 suites, calendar 94/94, invite 11/11) and app-rpc-grants (0 findings).
  - 49/49 two-tenant probes pass, and 18 isolation mutations each turn something red.
- **G-02 (major), closed.** `audit/evidence/reviews/cal1-code-review.md` lists all seven code-review runs, covering 310820a→aaec819 with no gaps, and gives every finding a severity and a disposition.
  - Every High is fixed, including the pre-existing invite-staff bug where a rollback could delete another school's account.
  - Every Medium is fixed.
  - Everything deferred is Low or pre-existing, and each deferred item is in `audit/backlog.md`: the 2026-10-18 rows numbered (1)–(6) plus the new G-06 row.
- **G-03, closed.** `audit/evidence/calendar/verify-20261018-final.txt` is a verify run on 61836e2:
  - harness green;
  - browser at 360 px in en, am and om: no horizontal scroll, monthly totals 9,20,21,22,21,14,20,22,19,21,21,–,– and 210 for the year, up/down keep the column;
  - keyboard focus ring still visible on the selected cell after Enter and on coming back into the grid (`navyRingAfterEnter: true`, `navyRingBackIn: true`).
- **G-04 and G-05, fixed** in `docs/insa/_pending-changes.md`:
  - line 245 now gives the assertion count as 94 at release;
  - line 259 now says onboard-tenant's duplicate check and invite-staff's staff-number check fail closed.
- **G-06, closed.** It is a backlog row assigned to F-01 slice 2, and it is also owner action B-CAL1.2.
- **Orphan account.** Owner action B-CAL1.1 in `docs/OWNER_ACTIONS.md` covers it. Production now has one orphan account, from 2026-08-06, and the guard refuses to invite that address.
- **Equivalent mutant (REL-TI-R2-01).** It is listed for the owner as B-CAL1.3, marked "no action unless you object".
- **Ledger.** The round-1 FAIL and how each item was closed are recorded in `audit/FIXES_VERIFIED_R6.md`.

## What I checked independently in round 1 (still valid; 61836e2 is unchanged)
- run.sh: 116 migrations, 68/68 suites; app-rpc-grants: 28 RPCs, 0 findings.
- tsc 0, eslint 0/0, vitest 155/155, check:i18n 0, check:locales OK, build OK.
- deno test 51/51 and deno-check ok. This covers REL-TI-R3-03, which the tenant-isolation reviewer marked not verifiable because it had no Deno.
- GitHub CI on 61836e2 is green: build-and-test, rls-tests, security-scan.
- CI on 0f04509 was still running when I checked. It only adds records, so it does not affect the deploy decision.

## Open minors (all already in audit/backlog.md, none blocking)
- REL-TI-R3-01: two schools inviting the same address within 60 s can race; no data is exposed.
- No handler-level tests for the Edge Function wiring. Every decision is in tested helpers.
- onboard-tenant can adopt an orphan account as the new school's admin (pre-existing).
- Duplicated helpers and a missing `lower(email)` index.
- EthDate reads a timestamp without a time zone as local time.
- A resend refused by GoTrue's cooldown still uses up an hourly slot.
- The Oromo wording needs confirming by a native speaker.

## Residual risks
- Production has no PITR or backups (D-03).
- The Edge Functions cannot be exercised end to end before deploy: there is no live GoTrue, and staging has no functions.

## Conditions for deploy
1. **Which commit:** deploy 61836e2, or aaec819, which ships the same files. Use the `deploy` skill only.
2. **Backup first:** take the targeted pre-deploy capture of production and commit it to `audit/evidence/`.
3. **Staging dry run:** restore staging if it is paused, then apply 20261008000001 and 20261017000001 there.
4. **Production migrations:** apply the same two migrations, in that order. Confirm 116 rows in schema_migrations and that postgres can still SELECT auth.users. If either migration fails, stop: nothing else may ship.
5. **Edge Functions:** only after 20261017000001 is applied, deploy invite-tenant-admin, onboard-tenant, invite-staff and provision-portal-accounts. Check that verify_jwt is unchanged and the count is still 28/28. Then smoke-test invite-tenant-admin's `status` action from the platform console.
6. **Frontend last:** build from a `git archive` of the SHA with `--build-env VITE_COMMIT_SHA=<sha>`, never `--prebuilt`. Grep the served bundle for `app-commit` and for a string that only the calendar page contains. Run the `deploy-checker` agent.
7. **Afterwards:** update the CLAUDE.md "Deployed state" (116 migrations, the new frontend commit) and record the deploy in `audit/FIXES_VERIFIED_R6.md`.

## Ledger entry to append (I did not write it)
"Release gate round 2 (2026-10-18): PASS for 61836e2. G-01–G-06 closed (cal1-tenant-isolation-2.md, cal1-code-review.md, verify-20261018-final.txt, INSA lines 245/259, backlog G-06, OWNER_ACTIONS B-CAL1). Gates independently re-run green on 61836e2; CI green."

Files:
- /home/user/timhirt-school-saas/audit/evidence/reviews/cal1-code-review.md
- /home/user/timhirt-school-saas/audit/evidence/reviews/cal1-tenant-isolation-2.md
- /home/user/timhirt-school-saas/audit/evidence/calendar/verify-20261018-final.txt
- /home/user/timhirt-school-saas/docs/OWNER_ACTIONS.md
- /home/user/timhirt-school-saas/audit/FIXES_VERIFIED_R6.md

The scratch database `relgate_r6` is still on /tmp/pgsock:5433; it can be dropped.