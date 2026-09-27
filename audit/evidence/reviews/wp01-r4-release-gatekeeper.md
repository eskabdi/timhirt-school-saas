**REVIEWER:** release-gatekeeper (re-run)
**WP:** R6 WP-01 (L-08, plus the owner-directed WP-14 pull-forward). Head c4ecfac, worktree /home/user/rv-wp01.
**VERDICT: FAIL**

WP-01 still fails, but only because the owner has not decided. There is no open code blocker or code major. Every gate is green at c4ecfac. GK-1, GK-4, GK-5 and GK-7 are closed, and I confirmed each by running it. I also checked all three state-concurrency fixes myself, with mutation tests and two real Postgres sessions, and all three hold. The one thing left is GK-2, and it now covers more code than before (details below).

### Gates I ran at c4ecfac (all green)
- `tsc` 0.
- `eslint src --max-warnings 0` 0.
- Vitest: 14 files, 88/88.
- `check:i18n` 0.
- `check:locales` OK (common 2189, apply 135, calendar 44).
- `npm run build` OK.
- pgTAP on a fresh `gk_wp01` database: 110 migrations, 63/63 suites, exit 0. The TODOs are unchanged: definer 2, RLS 1, module gate 1, storage 1. `tenant_settings_merge` passes 10/10.
- `deno-check.sh`: 28 functions, 3 baselined, ok. Deno tests 37/37.
- semgrep rule test: 16 expected, 0 missing, 0 unexpected.
- `conventions.py`: 0 findings, `name-render` 0.
- `pinned-actions` ok; `no-payment-gateway` ok.
- gitleaks: 271 commits, no leaks.
- `app-rpc-grants.py` does not exist at this head (it arrives with WP-02), so it is not applicable here.

### Earlier gate findings, closed and checked by running them
- **GK-1 (Branding page):**
  - Restoring the 5829420 page fails `BrandingPage.test.tsx`.
  - Removing only the `if (error) throw error` line also fails it.
- **GK-1 and GK-5 (Fee structures):** there is no test for this page in the repo, so I ran a throwaway test outside it.
  - After a failed load the toggle is disabled and the load alert shows.
  - After a successful load the toggle is enabled and checked.
  - The page now has its own cache sub-key (`["tenant-config", id, "billing"]`).
- **GK-4:** the `[1]` settings case is now in the merge suite (10/10). `merge_tenant_settings` is still SECURITY INVOKER with `search_path` pinned; anon cannot execute it and authenticated can.
- **GK-7:** all the listed minors are in `audit/backlog.md`, plus SC-2 (remainder), SC-4 and privacy item 4.
- **GK-3:** payments-integrity PASS, privacy PASS, state-concurrency FAIL; the state-concurrency findings are checked below.

### State-concurrency fixes, checked independently
- **SC-1 (onboard rollback deleting another school's admin):**
  - Replacing the guard with `if (invited)` fails 2 of the 6 rollback tests.
  - Dropping only the `public.users` ownership check fails 1 test.
  - I also traced the logic through the case-variant email and same-email concurrent cases. The admin email is now lower-cased and the pre-check is case-insensitive, and the rollback deletes the auth user only if this run created it and no profile still owns it. In every interleaving I traced, it never deletes an account that another profile still owns.
- **SC-2 (job claim):**
  - With two real sessions, A claimed 1 row and B, blocked behind A, claimed 0; the job ended `processing`.
  - Removing `.eq("status","queued")` fails the Deno type check, and with `--no-check` it fails 2 tests.
  - Nothing runs after `complete_job`, so one run can no longer flip a completed job to failed.
  - Still open, as recorded in the backlog: the anon-callable `fail_job` (baselined for WP-02) and the missing claim lease.
- **SC-3 (two first saves on a tenant with no config row):** with two real sessions saving branding and calendar at the same time, both sections were stored with no 23505, and the calendar trigger still normalised the section.

### FINDINGS
- **GK-2 | major (process, needs the owner) | commits 9ac652f and c4ecfac**
  - Evidence: §0A.1 caps review at 3 rounds, and after a fix loop the failed reviewer (state-concurrency) plus test-verifier and regression-guardian should re-run. No review verdict exists at c4ecfac. The c4ecfac changes (onboard rollback, `claimJob`, the ON CONFLICT upsert) have been checked only by this gatekeeper. OWNER_ACTIONS B4 names only `merge_tenant_settings` and "round-3 changes", so it does not cover them.
  - Fix: the owner answers B4, with its wording widened to cover 9ac652f and c4ecfac, recorded in `docs/insa/_pending-changes.md`.
- **GK-R4-1 | minor | `src/features/fees/FeeStructuresPage.tsx:263`**
  - Evidence: a failed save of the billing toggle shows `calendarPrefs.saveFailed`, which reads "Could not save the calendar settings", in all three locales. The message is wrong on this page.
  - Fix: add a `fees.blockUnpaid.saveFailed` key in en, am and om.
- **GK-R4-2 | minor | Fee structures has no component test for the GK-1/GK-5 fix**
  - Evidence: I verified it only with a scratch test. It is partly tracked under N-07 in the backlog.
  - Fix: commit a test like `BrandingPage.test.tsx` (WP-12).
- **GK-R4-3 | minor | `audit/backlog.md`**
  - Evidence: PAY-4 (`csvCell` should also check `trimStart()` and the full-width `＝`) is not in the backlog.
  - Fix: add it for WP-12.
- **GK-R4-4 | info | not verifiable locally**
  - GoTrue's invite behaviour and `created_at` semantics behind SC-1, and every RPC against real Supabase. The staging project is empty (WP-17).
- **GK-R4-5 | info | performance-reviewer did not run**
  - The only possible trigger was the bundle. I measured it: JS went from 2,905,379 to 2,912,836 bytes (+0.26%), and the fonts load lazily via `unicode-range`. I treat the trigger as not met.
- **GK-R4-6 | info | leftovers in the worktree**
  - Ignored build output `dist/` and `tsconfig.tsbuildinfo` may be from my `build`/`tsc` run; I left them in place. There is no `deno.lock` and no `__pycache__`. Database `gk_wp01` is dropped and my scratch copies are removed.

### CHECKED
- All 25 `wp01-r*` verdict files.
- Core reviewer coverage (8/8) and triggered coverage: db-migration, api-contract, supply-chain, infra-config, frontend-security, i18n-a11y, payments-integrity, privacy, state-concurrency.
- The 9ac652f and c4ecfac diffs line by line.
- The ledger (lines 374–560).
- Backlog, OWNER_ACTIONS B4 and B5, and the H-02 row in `_pending-changes`.
- CLAUDE.md counts (110 migrations / 63 suites).
- Grants and definer status of the merge function.

### What still needs the owner's decision
- **B4 (GK-2):** my recommendation is **"B4 A"**, widened to include 9ac652f and c4ecfac. I independently verified every changed path with mutation tests and two-session tests. Recording that answer turns this verdict into a PASS without another code change.
- **B5 (H-02):** my recommendation is **"contain H-02"** now. It is a live High exposure of staff ID and health scans and minors' report cards. It is not a WP-01 blocker because WP-05 owns it.
- **B3:** a native speaker should check the Amharic and Oromo text, and the owner should sign off the visible "· DD/MM/YYYY G.C." shown on every date. Recommendation: do this before deploying.

### Proposed ledger entry (for `audit/FIXES_VERIFIED_R6.md`, WP-01 section)
> **Release gate re-run (c4ecfac): FAIL, owner decision only.** All gates green: tsc 0, eslint 0, Vitest 88/88, i18n 0, locales OK, build OK, pgTAP 110 migrations and 63/63 suites (TODOs unchanged), deno-check ok, Deno 37/37, semgrep 16/0/0, conventions 0, pinned-actions ok, gitleaks 271 clean. Closed and verified by running them: GK-1 (Branding: the pre-fix page and the removed throw both fail `BrandingPage.test.tsx`; Fee structures checked with a scratch render test), GK-4 (merge 10/10), GK-5, GK-7. GK-3 verdicts present. State-concurrency fixes verified independently: SC-1 (mutations fail 2/6 and 1/6 rollback tests), SC-2 (two sessions claimed 1 and 0; the claim mutation fails the type check and 2 tests), SC-3 (two-session first saves both land). Open: GK-2 (major, process), now covering 9ac652f and c4ecfac with no reviewer re-run, pending owner B4. New minors GK-R4-1 (Fee toggle shows the calendar save message), GK-R4-2 (no Fee structures component test) and GK-R4-3 (PAY-4 missing from the backlog) go to the backlog.

### Deploy prerequisites (after B4 is recorded)
1. Capture `tenant_configs` into `audit/evidence/` before anything else, because PITR is off.
2. Apply `20260925000002`, then `20260925000003`. Post-checks:
   - 0 camelCase calendar keys remain.
   - `merge_tenant_settings` is executable by authenticated = true, by anon = false.
3. Deploy the frontend right after with `npm run deploy` (never `--prebuilt`). Grep the served bundle for `merge_tenant_settings`, and check that `<meta name="app-commit">` shows the deployed SHA.
4. Redeploy the 9 Edge Functions: activate-sso-user, enroll-finalize-billing, issue-fee-document, issue-id-card, onboard-tenant, process-export-job, process-import-job, provision-portal-accounts, record-fee-payment.
5. Get the B3 sign-off first. Every date will visibly change for all 3 production tenants.

Key files:
- /home/user/rv-wp01/docs/OWNER_ACTIONS.md
- /home/user/rv-wp01/audit/FIXES_VERIFIED_R6.md
- /home/user/rv-wp01/audit/backlog.md
- /home/user/rv-wp01/src/features/fees/FeeStructuresPage.tsx
- /home/user/rv-wp01/supabase/functions/_shared/onboard-rollback.ts
- /home/user/rv-wp01/supabase/functions/_shared/jobs.ts
- /home/user/rv-wp01/supabase/migrations/20260925000003_r6_tenant_settings_merge.sql

VERDICT: FAIL
