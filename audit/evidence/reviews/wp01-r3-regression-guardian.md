REVIEWER: regression-guardian (independent, read-only), round 3 (final)
WP: R6 WP-01 (L-08), with the round-1 and round-2 fixes and the owner-directed calendar changes. Round-2 fixes are `ffe8242..1a5eec7`; the whole WP is `da6055e..1a5eec7`; head is `1a5eec7`.
VERDICT: PASS

My round-2 major (RG-1) is fixed. Every gate is green, and I proved the harness still goes red when it should. What remains is 2 minor findings and 2 info notes.

**RG-1 from round 2 is fixed.**
- The CHECK is gone. In its place, `normalize_calendar_settings()` is IMMUTABLE with a pinned search_path, and a BEFORE INSERT/UPDATE trigger runs it. Old-client writes are now normalised instead of rejected.
- I ran it myself as `authenticated` (a school_admin JWT, going through RLS `configs_write`):
  - the da6055e settings-page write `{secondaryVisible:true, geezNumerals:false}` saves and is stored as `{secondary_visible, numerals:"latn", show_hijri:false}`;
  - a new-shape write saves unchanged.
- `authenticated` has EXECUTE on the normaliser; anon does not.
- onboard-tenant now checks the error on every insert.
- The suite covers the old onboard insert, the old settings upsert, running twice (idempotence), and scalar, array, null and junk calendar values. That also closes my round-2 RG-2 (scalar `calendar`).
- RG-3 (snake_case keys), RG-4 (the visible change is now recorded in `audit/FIXES_VERIFIED_R6.md:479`, with 5 EthDate tests), RG-5, RG-6 (`fix-plan.md:1809` now uses `tenant_id`) and RG-7 (counts are 3 baselined and assertions 14–15) are all fixed.

FINDINGS

1. **R3-1: minor. The onboard-tenant "rollback" cannot succeed once the admin user row exists, and the ledger says it does.**
   - Location: `supabase/functions/onboard-tenant/index.ts:66-119` (the `must(...)` calls), `:124` (rollback), `audit/FIXES_VERIFIED_R6.md:476`.
   - Evidence:
     - `users_tenant_id_fkey` and `academic_years_tenant_id_fkey` are ON DELETE NO ACTION (`confdeltype='a'`). Only `tenant_configs` and `periods` cascade.
     - I reproduced it locally: insert a tenant, then its school_admin user, then `delete from tenants` as service_role. The delete fails with `ERROR: ... violates foreign key constraint "users_tenant_id_fkey"`.
     - The rollback in the catch block ignores that error.
   - Failure scenario:
     - The users insert succeeds, then `academic_years`, `tenant_configs` or `periods` fails. The new `must()` throws and the function returns 500, but the tenant, the user and the invited auth user all remain.
     - Retrying with the same email then hits "already registered", and retrying with the same slug hits the unique constraint.
     - Compared with da6055e this is better (it used to return 201 on a half-built tenant), so it is not a regression. But the ledger's "a failure rolls the tenant back" is false, and the test I asked for in round 2 does not exist.
   - Fix (either works):
     - Delete dependants before the tenant (`users`, `academic_years`) and delete the invited auth user, checking each error.
     - Or move the seed into one transactional RPC.
   - Either way, correct line 476 of the ledger and add a test.

2. **R3-2: minor. The new deploy guard blocks a deploy after the local gates run.**
   - Location: `scripts/deploy-guard.sh:8`, `package.json:16`, `.gitignore` (no `__pycache__` entry).
   - Evidence: running the gates leaves `scripts/ci/__pycache__/conventions.cpython-311.pyc`, which is untracked and not ignored. Running `bash scripts/deploy-guard.sh` then exits 1 with "refusing to deploy".
   - Failure scenario: an operator runs the CLAUDE.md gates and then `npm run deploy`, and the deploy is refused until they clean up by hand. The failure is safe (it never ships a wrong bundle), just friction.
   - Fix: add `__pycache__/` to `.gitignore`, or set `PYTHONDONTWRITEBYTECODE=1` in the scripts.

3. **R3-3: info. While old and new clients overlap, the old settings page can reset a snake_case preference.**
   - Location: `da6055e:src/features/settings/CalendarPreferencesPage.tsx:23,30`.
   - Evidence:
     - After the migration, the da6055e page reads `calendar.secondaryVisible ?? true`, so it shows `true` for a stored `secondary_visible:false`.
     - When it saves, it replaces the whole `calendar` object, which also drops `numerals` and `show_hijri`.
     - No impact in practice: the pre-apply evidence shows all 3 production rows have `secondaryVisible: true`, and the old page offers no numerals or Hijri option.
   - Fix: none needed. Deploying the frontend promptly after the migration closes the window.

4. **R3-4: info. Behaviour changes in round 2 that the WP did not originally ask for.** All are recorded in the ledger:
   - Every EthDate now shows a visible `· DD/MM/YYYY G.C.` for all 3 tenants (review F-01; recorded at `FIXES_VERIFIED_R6.md:479`).
   - RichTextEditor now marks the form dirty only when something unsafe was dropped (m-6).
   - `csvCell` neutralises formula injection in the invoice and payroll exports.
   - `deploy-guard` was added.
   - Checkout in the CI rls-tests and sast jobs now uses `persist-credentials: false`.
   - pip installs `--only-binary :all:`.
   - Vitest now inlines i18next-icu and intl-messageformat.

   None of these weakens a prior guarantee.

CHECKED
- **pgTAP**, on my own database (`rg_wp01r3`, Postgres 16, `/tmp/pgsock:5433`, dropped afterwards): 109 migrations, 62/62 suites green, exit 0.
  - `r6_calendar_numerals` 15/15, `r6_hotfix` 21/21, `r6_hotfix_library_anon` 15/15, `verification_url_https` 5/5, `catalog_storage_probe` 10/10.
  - TODOs: definer 2, RLS 1, module gate 1, storage 1. That is unchanged.
- **Proof the gates still fail:** I ran a mutated `git archive 1a5eec7` copy on `rg_wp01r3m` with three plants: the migration's `create trigger` removed, an anon-executable SECURITY DEFINER function, and a cross-tenant storage SELECT policy. `run.sh` exited 1. The failures were:
  - `catalog_definer_security` #1 (reports `zz_mut_definer()`);
  - `catalog_storage_policies` #1 and #3;
  - `catalog_storage_probe` #4 (every role reads tenant B in 15 buckets);
  - `r6_calendar_numerals` #10 and #12 (legacy shape stored un-normalised);
  - `student_photo_lifecycle` #4.
- **§7 Regression Guard:**
  - Green: `resource_permissions*` (4 suites), `catalog_rls_coverage`, `catalog_module_gate`, `class_rank` 9/9, `grading_scales_lookup` 6/6, `payroll_sod` 7/7, `student_grade_history` 8/8.
  - "Arabic numerals only": the conventions gate (geez-digit 0) and the §5 Q5 assertion in the suite.
- **§5 queries, locally:**
  - Q1: 42 anon-executable and 13 without search_path, matching the baselines. Neither new function is SECURITY DEFINER, and both pin search_path.
  - Q2: 11.
  - Q5 (corrected to `tenant_id`): 0 rows.
- **Frontend gates**, from a clean `git archive 1a5eec7`:
  - `tsc --noEmit` 0; `eslint src --max-warnings 0` 0; vitest 12 files / 75 tests.
  - `check:i18n` 0; `check:locales` passes (common 2183, apply 135, calendar 37, parity en/am/om, run in the repo so the reformat check ran).
  - `npm run build` OK, with the app-commit meta present.
- **CI scripts:**
  - `conventions.py` 0 findings, self-test ok; `pinned-actions.sh` ok (7); `no-payment-gateway.sh` ok.
  - semgrep 1.95.0 self-test: 16 expected, 0 missing, 0 unexpected.
  - `deno-check.sh`: 28 functions, 3 baselined, ok. `deno test supabase/functions`: 28 passed. I removed the `deno.lock` my run created.
- **Code reviewed:**
  - the migration, trigger and grants;
  - the `useCalendarPrefs` reader, which accepts both snake_case and camelCase;
  - CalendarPreferencesPage (it writes snake_case, and the upsert error surfaces);
  - EthDate: `toDate` is unchanged, there is no `new Date()` or `toLocaleDateString`, and the preview uses `today()`;
  - RichText, where the sanitiser path is unchanged apart from the report flag, with no `innerHTML =` and no `dangerouslySetInnerHTML`;
  - the `formatDigits` fallback, the cached Hijri formatter, and `_shared/jobs.ts` `failJobQuietly`, which is tested;
  - the harness diff: the shim's schema USAGE narrowed, and the widened `run.sh` ERROR regex, which only makes it stricter;
  - the module-gate regex tightening, whose planted bypasses are all detected;
  - the storage allowlist fingerprint.
- **Not verifiable here:** production data after the apply, GitHub CI runs (gitleaks), and whether the owner actually asked for the scope pulled forward (same as round 2).

Key files:
- /home/user/timhirt-school-saas/supabase/functions/onboard-tenant/index.ts
- /home/user/timhirt-school-saas/audit/FIXES_VERIFIED_R6.md
- /home/user/timhirt-school-saas/scripts/deploy-guard.sh
- /home/user/timhirt-school-saas/supabase/migrations/20260925000002_r6_calendar_numerals.sql
- /home/user/timhirt-school-saas/supabase/tests/rls/r6_calendar_numerals.sql

VERDICT: PASS
