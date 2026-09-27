REVIEWER: regression-guardian (independent, read-only)
WP: R6 WP-01 (L-08), including the round-1 fixes and the owner-directed changes (names and calendar numerals). Diff reviewed: `bae3bfd..ffe8242`.
VERDICT: FAIL (1 major)

Nearly all prior guarantees still hold and every gate is green. The fail is one deploy-ordering hazard in the new tenant_configs CHECK, which you asked me to check specifically.

FINDINGS

RG-1: major. The new CHECK breaks the onboard-tenant and settings page currently live in production, and onboard-tenant fails silently.
- Location: `supabase/migrations/20260925000002_r6_calendar_numerals.sql:30-34`, `supabase/functions/onboard-tenant/index.ts:86`, `docs/DEPLOYMENT.md:29-46`
- Evidence:
  - The CHECK rejects the `geezNumerals` key whatever its value, including `false`.
  - Production runs `da6055e`. Its onboard-tenant inserts `calendar: {secondaryVisible: true, geezNumerals: false}`, and its CalendarPreferencesPage always writes `geezNumerals`.
  - Probe on the local DB: that old onboard payload fails with `23514 tenant_configs_calendar_numerals_chk`.
  - The runbook runs `supabase db push` (line 29) before `functions deploy` (line 45), and the frontend ships later. In that window a school admin who saves calendar prefs gets an error.
  - Onboarding in that window "succeeds" but creates a tenant with no `tenant_configs` row (no locale, branding or calendar). onboard-tenant ignores the insert result (`await db.from("tenant_configs").insert(...)` with no error check), so nothing rolls back.
  - The FIXES_VERIFIED_R6 deploy note lists the migration, frontend and 7 functions, but gives no order.
- Reference: the review's own ask (the CHECK must not break onboard-tenant or any existing writer); CLAUDE.md "A READY deployment is not a shipped deployment"; plan §0 Rule 3.
- Fix: do any of the following, the more the better.
  - Relax the CHECK to reject only `geezNumerals = true`, e.g. `not coalesce((settings #>> '{calendar,geezNumerals}')::boolean, false)`.
  - Or write a required order into the deploy note: Edge Functions and frontend first, then the migration.
  - Either way, make onboard-tenant destructure the error from the `tenant_configs` insert and throw it, so the existing tenant rollback runs. Add a test for that.

RG-2: minor. The migration aborts on a non-object `settings.calendar`.
- Location: `supabase/migrations/20260925000002_r6_calendar_numerals.sql:14-26`
- Evidence: with `settings = {"calendar": null}`, the UPDATE fails with `ERROR: cannot delete from scalar`. I reproduced this locally. `coalesce` does not catch jsonb `null`. I could not check production data.
- Fix: add `and jsonb_typeof(settings->'calendar') = 'object'` to the WHERE, or run a pre-flight query in production before deploy: `select tenant_id from tenant_configs where settings ? 'calendar' and jsonb_typeof(settings->'calendar') <> 'object'`.

RG-3: minor. A new camelCase jsonb key goes against plan §0 Rule 8 and L-09.
- Location: `supabase/migrations/20260925000002_r6_calendar_numerals.sql:600`, `src/features/settings/useCalendarPrefs.ts:301`, `supabase/functions/onboard-tenant/index.ts:90`
- Evidence: `showHijri` is added as a new persisted key. Rule 8 says "snake_case SQL **and jsonb keys**", and WP-14.4 plans to migrate the camelCase keys away.
- Fix: store it as `show_hijri` now (map to camelCase at the TS boundary), or add it explicitly to the WP-14.4 migration list in the backlog.

RG-4: minor. EthDate has a visible behaviour change that no WP asked for.
- Location: `src/components/EthDate.tsx:52`
- Evidence: every `<EthDate/>` now gets `title="= YYYY-MM-DD G.C."` whenever `secondaryVisible` is on. That is the default (`DEFAULT_CALENDAR_PREFS.secondaryVisible = true`), so every date in the app now has a tooltip where it had none. This follows from reviving a previously dead toggle, but it is not in the WP-01 plan or the owner asks. No render test covers it.
- Fix: record it in FIXES_VERIFIED_R6 as an intended change, or leave it off by default. Add an EthDate render test covering bare date, ISO instant, `Date`, null and the tooltip.

RG-5: info. A comment names the wrong migration.
- Location: `src/features/settings/useCalendarPrefs.ts:7`
- Evidence: the comment says the flag was removed by `20260925000001`, which is the https verification-URL migration. The right one is `20260925000002`.
- Fix: correct the migration id.

RG-6: info. Plan §5 query 5 cannot run.
- Location: `docs/audits/timhirt-production-fix-plan.md:1809`
- Evidence: `select id from public.tenant_configs …` fails with `ERROR: column "id" does not exist`, because the primary key is `tenant_id`. With `tenant_id` the query returns 0 rows locally.
- Fix: change `id` to `tenant_id`.

RG-7: info. Three documentation counts are inconsistent.
- `docs/insa/_pending-changes.md:113` says deno-check has "4 baselined". The file now lists 3, as does the FIXES_VERIFIED gate section.
- `supabase/tests/rls/r6_hotfix_library_anon.sql:8` says "Assertions 14-15". The backlog says 13–14. The real anon calls are 14–15 and the schema-usage check is 13.
- Fix: align the counts.

RG-8: info. Scope went beyond WP-01.
- Evidence: WP-14 items were pulled forward: `fullName`/`shortName`, Ge'ez removal, the Eastern Arabic ٠-٩ option and Hijri display. They are recorded as an "owner ask 2026-09-25" in FIXES_VERIFIED_R6, `_pending-changes.md` and the backlog. I cannot confirm the owner request itself.
- The ٠-٩ digits sit uneasily with plan Rule 8, "Arabic numerals only", if that means 0-9. The conventions gate checks only for Ge'ez digits.
- The Amharic and Oromo Hijri month names are unreviewed; that is already in the backlog.
- Fix: none required, if the owner confirms.

RG-9: info. RichTextEditor now calls `onChange(cleaned)` on load whenever stored HTML differs from its sanitised form.
- Location: `src/components/ui/RichTextEditor.tsx:52-57`
- Evidence: a form holding stored HTML that is not byte-identical to its sanitised form becomes dirty on mount. This was requested by review FE-1, and I found no render loop: after `onChange`, value equals `innerHTML`.
- Fix: none. Recorded so it is known.

CHECKED
- **Gates**, run from a `git archive ffe8242` copy in the scratchpad:
  - `tsc --noEmit` 0; `eslint src` exit 0; vitest 10 files / 66 tests.
  - `check:i18n` 0; `check:locales` passes (run in the repo so the reformat diff check ran; calendar 31 keys, parity en/am/om).
  - `npm run build` OK; `dist/index.html` has the app-commit meta ("unknown" without .git, as designed).
  - `conventions.py` 0 findings and self-test ok; `pinned-actions.sh` ok (7); `no-payment-gateway.sh` ok.
  - `deno-check.sh` 28 functions, 3 baselined, ok; `deno test supabase/functions` 22/22.
- **pgTAP** on my own database `rg_wp01` (`PGHOST=/tmp/pgsock`, port 5433), dropped afterwards: 109 migrations, 61/61 suites green. Catalog TODOs: definer 2, RLS 1, module gate 1, storage 1. `r6_calendar_numerals` 7/7, `r6_hotfix` 21/21, `r6_hotfix_library_anon` 15/15, `library` 29/29, `verification_url_https` 5/5.
- **Mutation checks:**
  - Removing the geezNumerals clause from the CHECK turns `r6_calendar_numerals` #5 "not ok".
  - A planted anon-executable SECURITY DEFINER function turns `catalog_definer_security` #1 "not ok".
- **§7 Regression Guard:** `resource_permissions*` (4 suites), `class_rank`, `grading_scales_lookup`, `payroll_sod`, `student_grade_history` and the catalog RLS/module-gate guards are all green. "Arabic numerals only" is covered by the conventions gate plus the new runtime test (no U+1369–U+137C in any rendered EC date).
- **§5 queries, locally:**
  - Q1: 42 anon-executable and 13 without search_path, matching `definer_anon_known` (42) and `definer_search_path_known` (13).
  - Q2: 11, matching `rls_force_known` (11).
  - Q5: 0 rows once corrected to `tenant_id`.
- **Library anon hotfix:** all four library RPCs have anon EXECUTE = false, and real anon calls are refused with an exact `permission denied for function …`. The shim now gives anon USAGE on public and matches Supabase default privileges; `auth.users` SELECT is limited to service_role.
- **https verification URLs:** the `bank_payment_verifications_url_https` constraint is present, the suite is green and `_shared` Deno tests pass. The InvoiceDetailPage diff touches names only, not the verification link.
- **No payment gateway:** the CI guard is still wired (ci.yml:41) and passes.
- **Sanitiser:** `RichText` render path unchanged. The editor load path now uses `sanitizeRichTextNodes` + `replaceChildren` (no `innerHTML =`). No `dangerouslySetInnerHTML` added. The only added `innerHTML` uses are reads or in tests.
- **i18n:** new keys (`calendarPrefs.*`, `hijriMonths`, `hijriEraSuffix`) exist in all three locales, inserted in-line with no reformat.
- **Deploy runbook:** `npm run deploy` still does `predeploy` (rm .vercel/output), has no `--prebuilt`, and adds `--build-env VITE_COMMIT_SHA`. The DEPLOYMENT.md verify step gained a commit-meta check; the bundle grep is kept.
- **EthDate:** `toDate()` is unchanged, so bare date, ISO instant, `Date` and null (renders "—") still work. No caller-side `.slice(0,10)` was added. There is no new `new Date()` or `toLocaleDateString` in the diff, and the preview uses `today()`.
- **middle_name selects:** every changed `.select()` or embed adding `middle_name` targets `students`, directly or as `students(...)` / `student:students(...)` via `portal_notifications`, `clinic_visits`, `discipline_incidents`, `invoice_headers`, `library_checkouts` / `holds` / `fines`, `guardians` and `student_leave_requests`. `students.middle_name` exists (`20260718000001:16`) and has a column-level `grant select … to authenticated` (line 24). That matters because `20260715000013` revoked table-level SELECT. The Edge Functions use adminClient, or userClient on students, which is covered. The shared `["students-brief"]` query key has the same column list in both pages.
- **Ge'ez removal:** no remaining `toGeez`, `useGeezNumerals`, `geez` prop or `geezNumerals` writer in src or supabase/functions. The remaining "geez" hits are the GeezSMS provider, comments, the conventions gate and tests. tsc is clean, so no caller still passes `geez`.
- **tenant_configs writers:** onboard-tenant, CalendarPreferences, Branding, IdCardTemplateDesigner and FeeStructures. The repo versions all pass the CHECK, as do NULL `numerals`, `calendar: null` and default `{}`. The currently deployed versions do not (RG-1). The migration is idempotent (run twice: `UPDATE 0`), and `showHijri: "yes"` casts cleanly.
- **CI workflow:** existing gates are retained (vitest, i18n, locales, no-payment-gateway, build, run.sh) and new jobs are SHA-pinned.

Not verifiable here: production `tenant_configs` data shapes (RG-2), the owner request behind RG-8, and GitHub CI runs (gitleaks and semgrep were not re-run locally).

Key files:
- /home/user/timhirt-school-saas/supabase/migrations/20260925000002_r6_calendar_numerals.sql
- /home/user/timhirt-school-saas/supabase/functions/onboard-tenant/index.ts
- /home/user/timhirt-school-saas/docs/DEPLOYMENT.md
- /home/user/timhirt-school-saas/src/components/EthDate.tsx
- /home/user/timhirt-school-saas/src/features/settings/useCalendarPrefs.ts
- /home/user/timhirt-school-saas/docs/audits/timhirt-production-fix-plan.md
