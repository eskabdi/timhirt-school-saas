REVIEWER: test-verifier (round 3, final)
WP: R6 WP-01 (Harness and CI truth, plus the owner additions: Eastern Arabic digits and Hijri, full names at every call site, semgrep hash-lock). Diff checked: da6055e..1a5eec7.
VERDICT: FAIL (2 majors)

**What I ran myself (all green at 1a5eec7)**
- pgTAP on a fresh DB `tv_r3f`: 109 migrations, 62/62 suites. The open TODOs are definer 2, RLS 1, module gate 1, storage 1.
- `tsc` 0 errors; `eslint src` 0; Vitest 12 files / 75 tests; `check:i18n` 0; `check:locales` ok; build ok. `dist/index.html` has `app-commit` = HEAD.
- Deno: `_shared` tests 16/16, all functions 28/28. `deno-check.sh`: 28 functions, 3 baselined, ok.
- semgrep 1.95.0: the rule self-test gives 16 expected, 0 missing, 0 unexpected. The full scan (repo rules plus 3 registry packs) ran 87 rules with 0 findings.
- `conventions.py`: self-test ok, 0 findings. `pinned-actions.sh` ok (7 uses). `npm audit --omit=dev --audit-level=high` exits 0.
- gitleaks v8.30.1, which I built into the scratchpad: full history, 256 commits, no leaks.
- No `.only`, `.skip` or ignored tests anywhere in the diff.

**Mutations: each one fails its test (tests run in scratch copies; the repo tree is clean)**
- **Shim default privileges removed:** `catalog_definer_security` #2 and `r6_hotfix_library_anon` #13 fail.
- **Planted migration** (an anon definer function without `search_path`, a tenant table without RLS, a definer function in `auth`, a tenant-only storage policy): these fail:
  - `catalog_definer_security` #1, #3 and #5
  - `catalog_rls_coverage` #1 and #2
  - `catalog_module_gate` #1
  - `catalog_storage_policies` #1
- **Planted AND/OR precedence storage policy** (the role term is `school_admin`): `catalog_storage_probe` #4 and #10 fail.
- **Calendar migration:**
  - Without `- 'geezNumerals'`: `r6_calendar_numerals` #1, #10, #12 and #15 fail.
  - Without the trigger: #10, #12, #14 and #15 fail.
- **Runner:** it fails on a TODO that now passes, a plan that is too short, an SQL error and a plain failure. It passes an open TODO and a test description containing "ERROR:".
- **RichTextEditor:** reverting to `innerHTML =`, or dropping the `onChange` of the cleaned HTML, fails `RichText.test.tsx`.
- **Digits and dates:**
  - Latin digits put into `ARABIC_INDIC`: 3 tests fail.
  - Gregorian hidden in `EthDate`: 2 tests fail.
- **Names and CSV:**
  - `names.ts` without the middle name, or without `father_name`: Vitest and Deno both fail.
  - `csvCell` without the formula guard: fails.
- **Name gate:** `conventions.py` flags a template literal, `+ " " +`, `[first, last].join` and an Edge Function template. It also flags a Ge'ez digit and `USD`.
- **XSS sinks:** a planted `dangerouslySetInnerHTML` and `innerHTML =` fail the repo semgrep rules (exit 1).
- **Planted secrets:** a planted `sk_live_` key and a `ghp_` token in a scratch clone make gitleaks exit 1 (2 leaks).
- **Deno ratchet:** restoring the old `process-import-job` (the `.catch` on a PostgREST builder) fails `deno-check.sh` with TS2551.
- **Pinned actions:** `setup-node@v4` makes `pinned-actions.sh` exit 1.

**FINDINGS**

1. **Major — owner criterion "First + Middle + Last in every list" is not met, and no test catches it.**
   - Location: `/home/user/timhirt-school-saas/src/features/students/StudentsListPage.tsx:114-129` and `/home/user/timhirt-school-saas/src/features/settings/ClassDetailPage.tsx:80-94`.
   - Evidence: the main students list and the class roster still render separate `{s.first_name}` and `{s.last_name}` columns with no middle name. `students/api.ts:62` and `classesApi.ts:148` now select `middle_name`, but nothing renders it.
   - Why the gate misses it: `conventions.py` checks one line at a time. These forms passed with 0 findings (mutation-proven):
     - separate table cells
     - a `[\n first,\n last\n].join` spread over several lines
     - a template literal broken across a line
     - `first_name.concat(' ', last_name)`
     - `${first} ${middle}` (last name dropped)
     - first name only
   - Fix:
     - Render `fullName(s)` in one Name column, or add a Middle column.
     - Make the name check work across lines, or add a test that renders these pages.
     - Add a check that every `.select` feeding a name render includes `middle_name`/`father_name`.

2. **Major — the tenant calendar setting is never tested end to end.**
   - Location: `/home/user/timhirt-school-saas/src/features/settings/useCalendarPrefs.ts:33-45` and `/home/user/timhirt-school-saas/src/features/settings/CalendarPreferencesPage.tsx:26-56`.
   - Evidence: `EthDate.test.tsx` passes `prefs` directly, so the path from stored `settings.calendar` to `parseCalendarPrefs` to render is never exercised. All 4 of these mutations left Vitest at 75/75:
     - `numerals` forced to `"latn"`: the Arabic digit option silently does nothing.
     - A stored `"geez"` passed straight through.
     - The legacy camelCase fallback removed.
     - `serializeCalendarPrefs` writing camelCase.
   - Nothing renders `CalendarPreferencesPage`, so no test shows the Ge'ez toggle is gone or that the Arabic and Hijri options exist and save the snake_case shape.
   - Fix:
     - Unit-test `parseCalendarPrefs` and `serializeCalendarPrefs` with snake_case, camelCase, junk, `"geez"` and `"arab"` inputs.
     - Add a test that renders `<EthDate/>` from a mocked `tenant_configs.settings` with no `prefs` prop.
     - Add a page test that checks the options and the upsert payload.

3. **Minor — nothing guards the semgrep hash-lock.**
   - Location: `/home/user/timhirt-school-saas/.github/workflows/ci.yml:127`.
   - Evidence: all 47 pins in `scripts/ci/requirements-semgrep.txt` carry hashes (`setuptools==80.10.2`, `semgrep==1.95.0`), and the scratch venv matches the lock. pip turns on hash checking by itself when the file has hashes. But reverting the step to a plain `pip install semgrep==1.95.0` fails no local check.
   - Fix: extend `pinned-actions.sh`, or add a small CI lint that requires `-r scripts/ci/requirements-semgrep.txt --require-hashes` in the workflow.

4. **Minor — round-2 extras with no automated test.**
   - Evidence: these are verified only by inspection or one-off runs:
     - the onboard-tenant "checks every insert" rollback (`supabase/functions/onboard-tenant/index.ts`)
     - the `EthDatePicker` labels and `aria-current`
     - the `app-commit` meta, which I checked by hand
     - the `deploy-guard.sh` dirty-tree refusal
   - None of them is a plan WP-01 acceptance criterion.
   - Fix: add a Deno test with a failing mock insert for onboard-tenant, and a small render test for the picker.

5. **Info — the self-grant in `r6_hotfix_library_anon.sql:13-16` is acceptable.**
   - Evidence: the suite grants EXECUTE to anon, then re-applies the revoke migration, so the probe proves the revoke rather than granting itself access. Anon's USAGE on `public` now comes only from the shim, and removing it fails #13.

**CHECKED**
- Plan criterion 1 (shim): covered by pgTAP, mutation-proven.
- Plan criterion 2 (four catalog guards plus the storage probe): each mutation-proven.
- Plan criterion 3 (CI): SHA pins, gitleaks, semgrep packs plus repo rules, npm audit, deno check, Dependabot and conventions are all present. Each one I could run locally fails on a planted fault. The Dependabot file I verified by reading it only.
- Plan "Tests" line: a planted secret and a planted `dangerouslySetInnerHTML` fail locally.
- Owner additions:
  - Arabic digits and Hijri: the library and `EthDate` are covered; the stored-setting path and the settings page are not (finding 2).
  - Ge'ez migration: covered by pgTAP.
  - Full names: the helper is covered; call-site enforcement is incomplete (finding 1).
  - Semgrep hash-lock: correct, but unguarded (finding 3).
