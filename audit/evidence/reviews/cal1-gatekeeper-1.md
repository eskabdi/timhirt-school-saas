REVIEWER: release-gatekeeper (read-only; I modified no repository files)
WP: F-01 Academic Calendar Engine slice 1 + invite fixes. Release candidate aaec819, records in 61836e2, branch claude/timhirt-security-audit-kan0ei.
VERDICT: FAIL

The code is in good shape. It fails on the rules: CLAUDE.md says "dispatch all four on the commit being merged … A change made after a skill ran is not reviewed: re-run the skills on the new commit." Two of the four mandatory skills have no recorded run on the final commit, and the code-review skill has no verdict file at all. I found no open code defect of blocker or major severity.

## Findings

**G-01 | major | process**
- Location: audit/evidence/reviews/cal1-relti3.md:1 and cal1-tenant-isolation.md
- Evidence: the last tenant-isolation-review round ran on 6c0f215 ("worktree /home/user/rv-ti at 6c0f215"). aaec819 then changed two Edge Functions:
  - `supabase/functions/onboard-tenant/index.ts`: `if (existErr) throw existErr;`
  - `supabase/functions/invite-staff/index.ts`: `if (dupErr) throw dupErr;`
- My own reading: this delta does not touch tenant scope. The `staff_no` query still filters on `ctx.tenantId`, and both throws happen before any invite or rollback. But the rule requires the skill to run on the commit.
- Fix: run the `tenant-isolation-review` skill on aaec819 (or 61836e2) and save the verdict as `audit/evidence/reviews/cal1-tenant-isolation-2.md`.

**G-02 | major | process**
- Location: audit/evidence/reviews/ (file missing)
- Evidence: there is no code-review verdict file. CLAUDE.md says "Their verdicts go in audit/evidence/reviews/". The only record is the summary in `audit/FIXES_VERIFIED_R6.md` ("six runs") and backlog rows "Release code review 2026-10-18 (1)–(6)".
  - Row (6) mentions the aaec819 fail-closed throws, so a run on aaec819 probably happened.
  - The rows carry no severities, so I cannot check that every confirmed Critical/High/Medium was fixed or deferred with a reason. Example: row (6), "onboard-tenant … can adopt an orphan auth account as the new school's admin", has no severity.
- Fix: commit the code-review verdict(s) with a severity per item, at least for 6c0f215..aaec819, to `audit/evidence/reviews/cal1-code-review*.md`.

**G-03 | minor | process**
- Location: `audit/evidence/calendar/verify-browser-20261018d.txt:1` ("release candidate 6c0f215") and `harness-20261018d.txt` (committed at 6c0f215)
- Evidence: the verify skill's evidence is from 6c0f215, not aaec819. The gap is covered in substance:
  - `git diff 6c0f215 aaec819 -- src supabase/migrations` is empty, so the browser evidence still applies to the same files.
  - I re-ran the harness on 61836e2 myself (see CHECKED below).
- Fix: re-run `verify` on the final commit together with G-01, or record that this gate re-run stands in for it.

**G-04 | minor**
- Location: `docs/insa/_pending-changes.md:245`
- Evidence: it still says "37 assertions". The suite now has 94 (line 249 states this).
- Fix: correct the number.

**G-05 | minor**
- Location: `docs/insa/_pending-changes.md:259`
- Evidence: it says the duplicate check fails closed for invite-staff and invite-tenant-admin only. It does not mention `onboard-tenant`'s fail-closed duplicate check or invite-staff's `staff_no` check, both added in aaec819 (they return a 500 when the query fails).
- Fix: add one sentence.

**G-06 | minor | not verifiable**
- Location: `src/locales/om/common.json:85` (`keyboardHint`)
- Evidence: CAL-I18N3-03 was fixed by changing the word to "utubaa" (aba4c75). No native speaker has confirmed it, and this is not in the backlog.
- Fix: add a backlog row like the existing one for CG-4/I18N-6.

**G-07 | info**
- Evidence: the latest verdicts from CAL-TV (tv2) and CAL-I18N (i18n3) are FAIL, and neither reviewer re-ran. I checked their majors myself:
  - **TV2-01:** faked year 2020 passes 94/94 (`mutations-20261018.txt`); the assertion now compares the two answers.
  - **TV2-02:** `_shared/invite-state.ts` has `invite-state.test.ts`, which passes in the Deno run.
  - **I18N3-01:** the selection ring is now an overlay span (`AcademicYearGridPage.tsx:287`), so the focus ring still draws. Browser evidence shows `navyRingAfterEnter: true` and `navyRingBackIn: true` in en, am and om.
  - The TV2 minors were mutation-killed: a6b, g6hi, sessfn, sessfn2, tv12, inv_confirmed, F22b, T2.

**G-08 | info**
- Evidence: in REL-TI-R2-01, the reviewer asked the owner to decide on one surviving mutant, which the team documented as equivalent. The reasoning is in `mutations-20261018.txt` and backlog row 112, but no human decision is recorded.

## Checked
- **Commits:** the working tree is clean at 61836e2. `aaec819..61836e2` touches only records and one SQL comment line.
- **Production commits are included:** the three production commits after e40f87b (20682fb, e9c0c9c, 463b241) appear on this branch as 1f01cee, 8c30a21 and 0f515a3 with identical patch-ids, so nothing in production is lost. 463b241 is not an ancestor of aaec819; it was cherry-picked.
- **Gates I ran on a `git archive` of 61836e2:**
  - run.sh: 116 migrations, 68/68 suites. academic_calendar_engine 94/94, tenant_admin_invite_states 11/11, TODOs unchanged.
  - app-rpc-grants: 28 RPCs, 0 findings.
  - tsc 0, eslint 0/0, vitest 27 files / 155 tests, check:i18n 0, check:locales passed in the repo, build OK.
  - deno test: 51 passed. deno-check: 28 functions, 3 baselined, ok.
  - Definer count is 81, matching the INSA inventory.
- **GitHub CI on 61836e2:** build-and-test, rls-tests, security-scan and the Vercel preview all succeeded. The semgrep rule test is not installed locally, so I am relying on CI's security-scan for it.
- **Reviewer verdicts:**
  - db → db2/db3/db4: PASS.
  - fs → fs2: PASS.
  - i18n → i18n3: FAIL; the major is fixed (G-07).
  - tv → tv2: FAIL; the majors are fixed (G-07).
  - sec: PASS. CAL-SEC-01 and 02 fixed; SEC-03 is CAL-DB-01, fixed (22–86 ms in `cal-db-01-timing.txt`).
  - ti: PASS. invsec: PASS (INV-SEC-01 and 02 fixed).
  - relti → relti2/relti3: PASS. rlsti: PASS. tenant-isolation: PASS (at 6c0f215).
  - security-review skill 1–5: no findings. Ranges 310820a→6133b48→67f541a→23a9fa1→6c0f215→aaec819 are contiguous and cover the whole release delta.
- **DB4 minors:** DB4-01 fixed; DB4-02 asserted (per the aba4c75 message); DB4-03 shown in `auth-users-postgres-select-20261017.txt` (postgres can SELECT auth.users in production and staging).
- **INSA `_pending-changes.md:229-259` documents:**
  - every new RPC with its grants: `create_school_calendar`, the 8 invoker functions, `ec_session_in_year`, `ec_same_date_next_year`, and the service-role-only `tenant_admin_invite_states`;
  - error codes (42501 / 22023 / 23505) and the invite-tenant-admin actions (invite/status/resend, 409 already_accepted, 429, rate-limit buckets);
  - Auth-error logging, the ERD, access control and data classification.
  - Apart from G-04 and G-05, this matches the migrations, whose grants I listed.
- **Deploy-order dependencies:**
  - The calendar migration only adds to existing tables (new tables, a nullable `tenants.edu_authority_id`, permission seeds) and re-creates `normalize_calendar_settings`. It is safe under the current 463b241 frontend.
  - The new frontend needs the calendar RPCs.
  - `invite-tenant-admin` calls `tenant_admin_invite_states` (20261017000001).
  - TenantDetailPage at aaec819 works with both the old and the new invite-tenant-admin.
  - The deploy skill enforces the order "migrations, then Edge Functions, then the frontend".
- **Backlog:** rows for 2026-10-18 (1)–(6) are present and assigned to WP-14 or F-01 slice 2.

## What must change before PASS
1. Run the `tenant-isolation-review` skill on aaec819/61836e2 and commit its verdict (G-01).
2. Commit the code-review verdict(s) with severities. If any item rated Medium or higher is deferred, record the reason, and the human's acceptance in `docs/insa/_pending-changes.md` (G-02).
3. Re-run `verify` on the final commit, or record that this gate's re-run stands in for it (G-03).
4. Optional, but do it in the same records commit: G-04, G-05 and G-06.

## Conditions for deploy (once the gate passes)
1. **Which commit:** deploy the commit the four skills passed (aaec819 or 61836e2; their `src` is identical), through the `deploy` skill only.
2. **Backup first:** production has no PITR or backups (D-03). Take the targeted pre-deploy capture and commit it to `audit/evidence/`.
3. **Staging dry run:** restore staging if it is paused (Free plan), then apply both migrations there.
4. **Production migrations:** apply 20261008000001, then 20261017000001. Confirm schema_migrations shows 116, and that postgres can still SELECT auth.users. If either migration fails, stop: neither the Edge Functions nor the frontend may ship.
5. **Edge Functions:** only after 20261017000001 is applied, deploy invite-tenant-admin, onboard-tenant, invite-staff and provision-portal-accounts (their bundles include `_shared/auth-errors.ts`, `invite-guard.ts` and `invite-state.ts`). Check that verify_jwt is unchanged and the count stays 28/28.
6. **Frontend last:** build from a `git archive` of the reviewed SHA with `--build-env VITE_COMMIT_SHA=<sha>`, never `--prebuilt`. Grep the served bundle (`<meta name="app-commit">` plus a calendar-only string), then run the `deploy-checker` agent.
7. **Orphan auth accounts:** have the owner identify or remove the two production auth accounts with no profile (2026-08-06 and 2026-09-24) before onboarding a school with either address. onboard-tenant can still adopt such an account (backlog row (6)).
8. **Afterwards:** update the CLAUDE.md "Deployed state" and `audit/FIXES_VERIFIED_R6.md`.

## Records not written
Your instruction not to modify files overrides my standing permission to append, so I wrote nothing to `audit/FIXES_VERIFIED_R6.md` or `audit/backlog.md`. Suggested entries:
- **FIXES_VERIFIED_R6.md, F-01:** "Release gate 2026-10-18 (aaec819/61836e2): FAIL. Process only: tenant-isolation-review not re-run after 6c0f215; code-review verdict file missing; verify evidence at 6c0f215. Gates re-run green on 61836e2: 116 migrations / 68 suites, calendar 94/94, invite 11/11, app-rpc-grants 28/0, tsc, eslint, vitest 155, i18n 0, locales, build, deno test 51, deno-check ok, CI green."
- **backlog.md:** add G-04, G-05 and G-06.

Files: /home/user/timhirt-school-saas/audit/FIXES_VERIFIED_R6.md, /home/user/timhirt-school-saas/audit/backlog.md, /home/user/timhirt-school-saas/docs/insa/_pending-changes.md, /home/user/timhirt-school-saas/audit/evidence/reviews/cal1-relti3.md, /home/user/timhirt-school-saas/audit/evidence/calendar/verify-browser-20261018d.txt. My gate run outputs are in /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/harness.txt and /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/vitest.txt. The scratch database `relgate_r6` is still on the local server at /tmp/pgsock:5433; drop it when you are done.