REVIEWER: insa-docs-reviewer (documentation truth audit)
WP: R6 WP-01. HEAD ffe8242, base bae3bfd. Scope: docs/insa/_pending-changes.md (the WP-01 section and "Names and calendar display"), audit/FIXES_VERIFIED_R6.md (WP-01), audit/backlog.md, CLAUDE.md, README.md, docs/DEPLOYMENT.md.
VERDICT: FAIL. There are 5 major findings. The headline counts you asked about all check out. The failures are other claims in the docs that the code or evidence contradicts, plus one deploy-order hazard.

FINDINGS

F1. major. docs/insa/_pending-changes.md:113
- Evidence: the doc says deno check has "4 baselined". supabase/security/deno_check_known.txt lists 3 functions: generate-payslip-pdf, issue-id-card and run-payroll. `DENO=/tmp/denobin/deno bash scripts/ci/deno-check.sh` prints "28 functions, 3 baselined, ok".
- Reference: contract rule "claim in docs not backed by code". The fix plan's WP-01 Docs item requires this file to be accurate.
- Fix: change it to "3 baselined".

F2. major. README.md:135
- Evidence: the doc says "every pgTAP suite (60 as of R6 WP-01 …)". There are 61 files in supabase/tests/rls/*.sql, and run.sh ran 61 suites, all ok. CLAUDE.md and _pending-changes.md both say 61.
- Reference: same contract rule.
- Fix: change it to 61.

F3. major. CLAUDE.md:111 and docs/insa/_pending-changes.md:119
- Evidence: the docs say "harness and production agree on every effective privilege" and "Effective privileges for every public function and table match production exactly". The parity evidence covers less than that. Lines 4-5 of audit/evidence/wp01-acl-parity-20260925T101802Z.txt limit its scope to EXECUTE on public functions, SELECT for anon and authenticated, and INSERT for authenticated. It does not cover UPDATE, DELETE, sequences, schema CREATE, or the auth, storage and vault schemas. audit/backlog.md (AZ-6/TI-6) admits this gap.
- What does hold: I reproduced the harness side against 109 migrations. It gives 191 lines with sha256 572e6510…, identical to the file, and 0 diff against the production lines.
- Reference: contract rule. It is also a SFD accuracy issue.
- Fix: word it as "EXECUTE on public functions, and SELECT/INSERT on public tables and views, match production (191 = 191)", and name the gap.

F4. major. supabase/tests/shim.sql:129-133 at HEAD, and CLAUDE.md:107-114
- Evidence: the HEAD shim does two things production does not:
  - `grant usage on schema auth, storage, vault to authenticated, anon, service_role`
  - `grant select on auth.users to service_role`, with the comment "as on Supabase"
- A production capture shows otherwise. It is `audit/evidence/wp01-prod-calendar-and-schema-grants-20260925T154210Z.txt`, which is **untracked** in the working tree. It reports vault USAGE false for anon and authenticated, and `auth_users_select: false` for every API role, service_role included.
- So at HEAD the CLAUDE.md rule "the harness grants what Supabase grants / don't add a grant Supabase doesn't make" is broken by the shim itself.
- An uncommitted working-tree edit to shim.sql fixes this. It is not in ffe8242. My pgTAP run (15:39Z) happened before that edit (15:42Z), so it tested HEAD.
- Reference: L-08 and CLAUDE.md.
- Fix: commit the shim change together with the evidence file, then re-run pgTAP.

F5. major. audit/FIXES_VERIFIED_R6.md:466 (deploy note)
- Evidence: the new CHECK `tenant_configs_calendar_numerals_chk` rejects any `calendar.geezNumerals` key. Production at da6055e still writes that key in two places:
  - `supabase/functions/onboard-tenant/index.ts:90` inserts `calendar: { secondaryVisible: true, geezNumerals: false }`
  - `src/features/settings/CalendarPreferencesPage.tsx:30` upserts `{ secondaryVisible, geezNumerals }`
- If migration 20260925000002 is applied before the new frontend and the new onboard-tenant, both tenant onboarding and calendar saves fail with a CHECK violation (23514).
- The untracked production capture shows 3 tenant rows that carry the geezNumerals key today.
- The deploy note lists the parts but gives no order.
- Reference: the D-02/D-03 posture (no staging, no PITR).
- Fix: in the deploy note, require deploying onboard-tenant and the frontend first, or in the same window, before the migration, and add a post-deploy onboarding probe.

F6. minor. docs/insa/_pending-changes.md:134
- Evidence: the doc says "RichText.test.tsx, 4 tests; all 4 fail with raw nodes". The file has 5 tests: 4 sanitizer tests plus the editor render test added for FE-2. Vitest reports "RichText.test.tsx (5 tests)".
- Fix: say "5 tests (4 sanitizer + 1 editor)".

F7. minor. audit/FIXES_VERIFIED_R6.md:456 and audit/backlog.md:41
- Evidence: the docs say "28 call sites in 25 files". I measured 30 `fullName(` calls in 20 files that import the helper: 27 calls in 17 src files and 3 in 3 Edge Functions. This excludes StaffRegistrationPage's own local `fullName()`.
- Fix: correct the counts, or drop them.

F8. minor. audit/FIXES_VERIFIED_R6.md:431
- Evidence: the text says "Seven reviewers returned … The other six (…)", but lists 6 reviewers that returned and names 7 that died. The repo has 6 `wp01-r1-*.md` files under audit/evidence/reviews/.
- Fix: swap to "Six returned … the other seven".

F9. minor. audit/FIXES_VERIFIED_R6.md:411
- Evidence: the doc says the fixture has "10 `ruleid:` lines and 3 `ok:` lines". The fixtures contain 10 ruleid and 5 ok annotations, both at 744f1d4 and at HEAD.
- Fix: change 3 to 5.

F10. minor. audit/FIXES_VERIFIED_R6.md:399 and :401
- Evidence: the implementation table still says "4 are baselined" and conventions "report-only … 8 Ge'ez-digit and 13 name-concat". Both are superseded: 3 are baselined, and the conventions gate is now blocking with 0 findings (CI `Project conventions` step; I ran it and got 0).
- Fix: mark both rows as superseded, pointing to the round-1 section.

F11. minor. src/features/settings/useCalendarPrefs.ts:7
- Evidence: the comment says the geezNumerals flag "was removed by migration 20260925000001". That migration is FS-1 (https URLs). The right one is 20260925000002.
- Fix: correct the migration number.

F12. minor. supabase/security/deno_check_known.txt:4
- Evidence: the header still names "enroll-finalize-billing (WP-04)" as a baselined type error, but it is no longer in the list.
- Fix: update the comment.

F13. minor. CLAUDE.md:8
- Evidence: the deployed-state block says "All 108 migrations are applied". The repo now has 109, and 20260925000002 is not in production.
- Fix: "108 of 109; 20260925000002 pending the WP-01 deploy".

F14. minor. docs/insa/_pending-changes.md, R6 WP-01 section
- Evidence: the section has no entries for the residual-risk register. WP-00 had an explicit deviations table for this. Deferred WP-01 risks appear only in backlog.md:
  - dev dependencies: 1 critical and 5 high, not covered because the audit runs with `--omit=dev`
  - semgrep only partly parses 2 files
  - no deno.lock, and supabase-js floats
  - 39 definer functions set `search_path=public` without `pg_temp`
  - the ACL parity scope limits (see F3)
  - 3 functions baselined in deno check
- Reference: contract checklist (residual-risk register).
- Fix: add a "WP-01 residual risks → 10-residual-risk-register" list.

F15. minor. audit/FIXES_VERIFIED_R6.md (GK-F1 row) and audit/backlog.md (GK-F1)
- Evidence: the docs say sign-up was "re-verified at WP-01 start: disable_signup = true, 422". No WP-01 capture exists under audit/evidence/. The only one is wp00-dr1-signup-disabled-20260925T072554Z.txt. I cannot verify this.
- Fix: commit the raw probe output.

F16. minor. audit/backlog.md:45
- Evidence: a blank line splits the table. Rows 46 onward (AZ-1, AZ-6, EF-1, EF-2, SC-4, SC-5, FE-4) lose the header and render as a separate headerless table.
- Fix: remove the blank line.

F17. info. The gitleaks claims ("history clean", "256 commits") are not verifiable here because gitleaks is not installed. HEAD has 256 commits; b3aeaf3 had 254.

F18. info. docs/insa/_pending-changes.md, Names section
- Evidence: the section says names render via `fullName()` everywhere. issue-id-card:309, provision-portal-accounts:89 and process-export-job:132 use inline First+Middle+Last joins instead of the helper. What they render is correct (the middle name is included); the helper just isn't universal.

F19. info. Not touched by WP-01, but now stale:
- CLAUDE.md "~41 pre-existing `any` warnings": `npx eslint src` now reports 0.
- README "1104 keys": common alone has 2180.

CHECKED (all run at HEAD ffe8242)
- Migrations: 109 on disk, and run.sh applied all 109.
- pgTAP: 61 suites, all passing. Run as the postgres OS user after I started the local cluster, which was down; I left it running.
  - Catalog TODOs match the docs: definer 2, RLS 1, module gate 1, storage 1.
  - r6_calendar_numerals 7/7, r6_hotfix_library_anon 15/15, r6_hotfix 21/21.
- Live catalog counts in the test database:
  - 42 anon-executable definer functions
  - 13 definer functions without search_path
  - 39 with `search_path=public` only
  - 11 tables without FORCE RLS
  - 56 module gates of the qualifying shape
  - Baselines: definer_anon 42, search_path 13, rls_force 11, module_gate 37, storage 4 plus 1 allow-list entry. All match _pending-changes.md.
- ACL parity: reproduced the evidence query on the harness. 191 lines, same sha256, 0 diff.
- Storage detector: 5 planted shapes present in catalog_storage_policies.sql.
- CHECK constraint definition matches the doc. tenant_configs write policy is school_admin only.
- Vitest: 10 files, 66 tests passing.
- tsc 0; eslint src 0; check:i18n 0; check:locales ok.
- Deno: deno-check 28 functions, 3 baselined, ok. deno test 22/22.
- Semgrep 1.95.0 rule self-test: 10 expected, 0 missing, 0 unexpected. The repo rules cover the 5 sink classes the doc lists.
- conventions.py: self-test ok, 0 findings. Its scope (src, supabase/functions, supabase/migrations, index.html) matches the doc.
- pinned-actions.sh: 7 uses, all SHA-pinned. no-payment-gateway.sh ok.
- CI workflow: triggers, blocking conventions step, gitleaks via `go install` v8.30.1, hash-locked semgrep, `npm audit --omit=dev --audit-level=high`. Dependabot: npm and github-actions, weekly.
- .gitleaksignore: 7 fingerprints.
- happy-dom 20.14.5 is MIT; its dependencies are MIT except entities 7.0.1 (BSD-2-Clause), as the doc says.
- Build provenance: vite build to the scratchpad gives `<meta name="app-commit" content="ffe8242…">`. An invalid VITE_COMMIT_SHA falls back to git. package.json deploy passes `--build-env VITE_COMMIT_SHA`. The DEPLOYMENT.md steps are consistent with this.
- Names helpers exist in src/lib/names.ts and supabase/functions/_shared/names.ts. Every student select that feeds a name includes middle_name. Hijri uses `islamic-umalqura`, with month names in en/am/om. Numerals are latn or arab.
- Evidence files named in the docs exist: wp01-acl-parity-20260925T101802Z.txt and the 6 wp01-r1 reviews.

The working tree has changes that are not part of HEAD: the modified supabase/tests/shim.sql, the untracked audit/evidence/wp01-prod-calendar-and-schema-grants-20260925T154210Z.txt, 5 wp01-r2 reviews and docs/OWNER_ACTIONS.md. I did not create any of them. I did not modify the repo.

Key files:
- /home/user/timhirt-school-saas/docs/insa/_pending-changes.md
- /home/user/timhirt-school-saas/audit/FIXES_VERIFIED_R6.md
- /home/user/timhirt-school-saas/audit/backlog.md
- /home/user/timhirt-school-saas/README.md
- /home/user/timhirt-school-saas/CLAUDE.md
- /home/user/timhirt-school-saas/supabase/tests/shim.sql
- /home/user/timhirt-school-saas/supabase/migrations/20260925000002_r6_calendar_numerals.sql
- /home/user/timhirt-school-saas/supabase/functions/onboard-tenant/index.ts
- /home/user/timhirt-school-saas/src/features/settings/useCalendarPrefs.ts
- /home/user/timhirt-school-saas/supabase/security/deno_check_known.txt
