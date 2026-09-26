REVIEWER: insa-docs-auditor (round 3, documentation truth audit)
WP: R6 WP-01. HEAD 1a5eec7; round-2 fixes are `ffe8242..1a5eec7`.

VERDICT: FAIL

All 5 majors from round 2 are fixed, and the code backs each fix. The fail comes from 2 new majors: two doc claims are stale, and the code or the file tree contradicts them. Each is a one-line fix and neither touches code.

**Status of the round-2 majors**
- **F1: fixed.** `docs/insa/_pending-changes.md` now says "3 baselined". `deno-check.sh` prints "28 functions, 3 baselined, ok".
- **F2: fixed.** README.md:135 says 62. There are 62 files in `supabase/tests/rls/*.sql`, and run.sh passed 62 suites.
- **F3: fixed.**
  - CLAUDE.md:112-115 and `_pending-changes.md` now limit the parity claim to EXECUTE and SELECT/INSERT (191 = 191).
  - Schema USAGE and `auth.users` are tied to the production capture.
  - Both files name the gaps (UPDATE/DELETE, sequences, schema CREATE), and the residual-risk table lists them.
- **F4: fixed.**
  - `supabase/tests/shim.sql:135-136` now grants USAGE on auth and storage to all API roles and on vault to service_role only. It grants no SELECT on `auth.users`.
  - The committed evidence `audit/evidence/wp01-prod-calendar-and-schema-grants-20260925T154210Z.txt` shows exactly that: vault false for anon and authenticated, `auth_users_select` false for all three roles.
  - The full harness is green with the new shim.
- **F5: fixed by design.**
  - Migration 20260925000002 no longer adds a CHECK. It adds `normalize_calendar_settings()` and a `BEFORE INSERT OR UPDATE OF settings` trigger, which maps `secondaryVisible` and `showHijri` and drops `geezNumerals`. The old writers at da6055e (the frontend upsert and the old onboard-tenant insert) are normalised instead of rejected, so "order no longer matters" holds.
  - `onboard-tenant/index.ts:100` now writes snake_case keys.
  - `r6_calendar_numerals.sql` passes 15/15.
  - The migration header gives the pre-apply count: 3 rows, which matches the evidence.

**Status of the round-2 minors**
- Fixed: F6 (RichText.test.tsx has 6 tests, matching the doc), F8, F9, F10, F11 (the comment cites 20260925000002), F12, F13, F14 (residual-risk table added), F15 (`wp01-signup-disabled-20260925T203148Z.txt` committed) and F16 (the blank line is gone).
- F7 is fixed in FIXES_VERIFIED but still stale in the backlog (finding 4 below).

**FINDINGS**

1. **major.** `docs/insa/_pending-changes.md:109`
   - What is wrong: the line still says "pgTAP (61 suites)". Round 2 added `catalog_storage_probe.sql`, so there are now 62 suite files, and run.sh reports 62 "ok" suites.
   - The other docs already say 62: README:135, CLAUDE.md:143, and FIXES_VERIFIED "62/62". Only this line is stale.
   - Reference: contract rule ("claim in docs not backed by code"); the INSA SFD input. This is the same class of finding as round-2 F2.
   - Fix: change 61 to 62.

2. **major.** `README.md:21`
   - What is wrong: the feature table still lists "`<EthDatePicker/>` 13-month grid, **Geez numerals**". That feature was removed in WP-01:
     - `grep -rni 'toGeez|geez' src` returns nothing.
     - Plan §0 Rule 8 and WP-14.1 now say Ge'ez numerals are gone.
     - `_pending-changes.md` says "Ge'ez numerals are no longer offered".
   - The README advertises a banned, removed capability.
   - Fix: replace it with "Arabic digits (0-9, or Eastern Arabic ٠-٩ per tenant), optional Hijri date".

3. **minor.** `README.md:52` and `README.md:133`
   - What is wrong: "2,318 keys at full parity" counts only common (2,183) and apply (135). `check-locales.mjs` also checks calendar (37 keys, full parity), so the total is 2,355.
   - Fix: say 2,355, or "2,318 in common + apply".

4. **minor.** `audit/backlog.md:41`
   - What is wrong: it still says "28 call sites use `fullName()`". Now there are 39 `fullName(` calls in 28 non-test files, not counting the helper definitions. FIXES_VERIFIED already dropped the count.
   - Fix: drop the count, or say "39 calls in 28 files".

5. **info.** `audit/FIXES_VERIFIED_R6.md` (round-1 table, owner-ask rows)
   - The round-1 row still says "a CHECK stops `geezNumerals` … being written back" and uses `showHijri`. The round-2 table below it supersedes this (DM-1/F5 row), and the section is historical. I am not asking for a change.

6. **info.** gitleaks claims ("256 commits clean", 5 reviewed false positives) are not verifiable here because gitleaks is not installed. `.gitleaksignore` does hold exactly 5 fingerprints, and the 2 removed ones were for commit 0188d860, as the doc says.

**CHECKED (at 1a5eec7)**
- **Migrations:** 109 on disk; run.sh applied all 109.
- **pgTAP:** local cluster started. 62/62 suites pass, including the new `catalog_storage_probe.sql` (10/10) and `r6_calendar_numerals.sql` (15/15). Catalog TODOs match the docs: definer 2, RLS 1, module gate 1, storage 1.
- **Vitest:** 12 files / 75 tests, which matches FIXES_VERIFIED.
- **Deno:** `deno test` 28/28. `deno-check.sh`: 28 functions, 3 baselined, ok.
- **Conventions:** `conventions.py` reports 0 findings.
- **Locales:** 2183 + 135 + 37 keys, parity ok in all three locales.
- **Edge Functions to redeploy:** `git diff da6055e..HEAD -- supabase/functions` changes exactly the 9 functions listed in the FIXES deploy note and OWNER_ACTIONS B1:
  - activate-sso-user
  - enroll-finalize-billing
  - issue-fee-document
  - issue-id-card
  - onboard-tenant
  - process-export-job
  - process-import-job
  - provision-portal-accounts
  - record-fee-payment
  
  Every importer of the changed `_shared/names.ts` and `_shared/jobs.ts` is in that set. The only migration since da6055e is 20260925000002.
- **Deploy order:** the migration's trigger normalises the legacy writes, so the "order no longer matters" claim holds. The pre-apply and post-apply checks in the deploy note agree with the migration header and the evidence.
- **CLAUDE.md:** "108 of 109" is accurate, the shim/parity wording matches the shim and the evidence, and eslint "0 warnings" and "62 pgTAP suites" are accurate.
- **`docs/OWNER_ACTIONS.md`:** B1 is consistent with FIXES (1 migration, the frontend, 9 functions, and the heads-up about the visible Gregorian date, backed by `secondary_visible_camel: 3` in the evidence).
- **Plan amendments** in `docs/audits/timhirt-production-fix-plan.md`:
  - The Rule 8 Eastern-Arabic opt-in, the 14.1 "done" note (trigger, `latn`/`arab`, `show_hijri`, blocking conventions) and the 14.2 names note all match the code.
  - `module_gate_allowlist.sql` exists.
  - The §verification query now uses `tenant_id`.
- **Backlog:** the table is contiguous again, and the round-2 rows were added.

I did not modify any repository file. The local Postgres 16 cluster was down; I started it and left it running.

Key files:
- /home/user/timhirt-school-saas/docs/insa/_pending-changes.md
- /home/user/timhirt-school-saas/README.md
- /home/user/timhirt-school-saas/audit/backlog.md
- /home/user/timhirt-school-saas/audit/FIXES_VERIFIED_R6.md
- /home/user/timhirt-school-saas/supabase/migrations/20260925000002_r6_calendar_numerals.sql
- /home/user/timhirt-school-saas/supabase/tests/shim.sql

VERDICT: FAIL
1. major, docs/insa/_pending-changes.md:109: says "pgTAP (61 suites)"; there are 62.
2. major, README.md:21: advertises "Geez numerals", which WP-01 removed.
3. minor, README.md:52 and :133: "2,318 keys" leaves out the calendar namespace; the total is 2,355.
4. minor, audit/backlog.md:41: "28 call sites" is stale; there are 39 calls in 28 files.
