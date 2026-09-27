REVIEWER: code-quality-reviewer (round 3)
WP: R6 WP-01 (with the owner-directed WP-14 pull-forward). I reviewed the full diff da6055e..1a5eec7 and focused on the round-2 fixes in ffe8242..1a5eec7. HEAD is 1a5eec7.
VERDICT: FAIL

The FAIL is caused by one major finding, M-1. Every round-2 major and minor finding is fixed, and the gates I could run are green. M-1 is a data-loss path in the save code that was rewritten this round. It is not new behaviour, but this round's change only half-finished it.

FINDINGS

**M-1 | major | Saving calendar or ID-card settings can wipe every other tenant setting**
- Location: src/features/settings/CalendarPreferencesPage.tsx:23, :32, :74 and src/features/settings/IdCardTemplateDesignerPage.tsx:113, :251, :475
- Evidence: `useTenantSettings()` now throws on error, which was the round-2 m-4 fix. But both pages read only `data` and ignore `isLoading`/`isError`. They then upsert the whole jsonb:
  - `const next = { ...(settings ?? {}), calendar: serializeCalendarPrefs(prefs) };` followed by `upsert({ tenant_id, settings: next })`
  - The Save button is disabled only on `save.isPending`.
- Failure scenario: a school admin opens Calendar Preferences on a slow link, or the fetch fails after React Query's retries. `settings` is `undefined` and the form shows the defaults. The admin clicks Save. The upsert replaces `tenant_configs.settings` with `{calendar:{…}}` alone. The tenant's `branding` (colours and logo, used by the sidebar, documentBranding and _shared/branding.ts), `idCardTemplate` and `defaultLocale` are silently deleted, and there is no backup (PITR is off). The ID-card designer does the same in reverse and wipes `calendar` and `branding`.
- Why it counts against this WP: the pattern existed before, but these exact lines were rewritten this round. The query error that is now "propagated" still ends up as defaults followed by a destructive write, which is a swallowed error. The CLAUDE.md "no swallowed errors" rule and plan Rule 6 apply.
- Fix:
  - Disable Save (and render a loading or error state) unless the settings query `isSuccess`.
  - Show `t("calendarPrefs.saveFailed")`, or an equivalent load-failure message, when `isError`.
  - Better: merge server-side with one `settings = settings || jsonb_build_object('calendar', …)` RPC, so the client never writes keys it did not read.

**m-1 | minor | Hand-written validation instead of Zod, no React Hook Form (round-2 m-3, partly open)**
- Location: src/features/settings/useCalendarPrefs.ts:40-52 and CalendarPreferencesPage.tsx:22-27
- Evidence: `parseCalendarPrefs` is still a hand-written validator rather than a Zod schema, and the page still copies server state into `useState` + `useEffect` instead of using RHF. Error and success feedback is now present (role=status / role=alert), and the server trigger normalises every write. That makes this a convention gap, not a correctness bug.
- Fix: add a `calendarPrefsSchema` with `.catch()` defaults and drive the form with RHF, or record the exception.

**m-2 | minor | Pulled-forward csv.ts diverges from the WP-12.1 API, and three CSV writers still bypass it**
- Location: src/lib/csv.ts:7; ad-hoc writers remain at src/features/settings/ClassesPage.tsx:264, src/features/settings/ImportExportPage.tsx:12 and supabase/functions/process-export-job/index.ts:57-59
- API divergence: plan WP-12.1 specifies `csvCell(value: unknown)` plus `toCsv(...)` with a BOM, mirrored in `_shared/csv.ts`. The pulled-forward helper is `csvCell(value: string | number)`, with no `toCsv` and no Deno twin.
- Injection still open: the three writers above quote but do not neutralise `=+-@`. process-export-job is the bulk student/teacher export, so a name such as `=HYPERLINK(...)` typed by any registrar is still injectable there.
- Status: M-05 is formally WP-12's, so this is not a regression. But the WP now owns the helper, and WP-12 will have to change its signature.
- Fix: match the plan's signature now, or note in WP-12.1 that the helper exists with this API.

**m-3 | minor | Non-null assertion kept on a rewritten line**
- Location: src/features/settings/IdCardTemplateDesignerPage.tsx:252
- Evidence: the rewritten mutation still uses `profile!.tenant_id`. CalendarPreferencesPage guards it (`if (!profile?.tenant_id) throw`).
- Fix: use the same guard.

**i-1 | info | Sanitiser report can miss a dropped attribute**
- Location: src/components/ui/RichText.tsx:93
- Evidence: `!(a.name in attrs)` checks against a plain object literal, so attributes named `constructor`, `toString`, `__proto__` and similar count as "kept" and are not reported. Only harmless attributes can hit this, since no `on*` name is an Object.prototype key, so there is no security impact. At worst an attribute like that stays in the stored HTML while the renderer drops it.
- Fix: `Object.hasOwn(attrs, a.name)`.

**i-2 | info | `shortName` is still an exported helper with no callers**
- Location: src/lib/names.ts:22
- Evidence: plan WP-14.2 is now amended to record the `fullName`/`shortName` API, and every inline name join from round-2 m-7 has been migrated (verified by grep and `conventions.py`: name-concat 0).
- Fix: acceptable as the convention's API. Remove it if the lint policy treats unused exports as dead code.

**i-3 | info | Not verifiable in this sandbox**
- `bash scripts/ci/deno-check.sh`: deno is not installed. This covers:
  - the new `_shared/jobs.ts` structural `FailJobClient` accepting a `SupabaseClient`;
  - the onboard-tenant `must()` helper;
  - `_shared/names.test.ts` and `_shared/jobs.test.ts`.
- `python3 scripts/ci/semgrep-rule-test.py`: semgrep is not installed.
- The gatekeeper must run both.

Round-2 finding status:
- M-1 (camelCase jsonb): FIXED.
  - Keys stored: `secondary_visible` / `numerals` / `show_hijri`.
  - The reader accepts both spellings.
  - An immutable normaliser plus a BEFORE INSERT/UPDATE trigger replace the CHECK.
  - onboard-tenant writes snake_case.
  - The pgTAP suite covers old-client writes.
- m-1 (wrong migration id in comment): FIXED.
- m-2 (preview ignores unsaved prefs): FIXED (`prefs` override, covered by EthDate.test.tsx).
- m-3 (save feedback, Zod, RHF): PARTLY FIXED. Feedback is added; Zod and RHF are still open (see m-1 above).
- m-4 (duplicated tenant-config query): FIXED as `useTenantSettings`, with a tenant-scoped key and errors thrown. The `.eq` has a documented justification: the PK lookup is needed because super_admin RLS can read every row.
- m-5 (Hijri formatter rebuilt per call): FIXED (lazy module-level formatter; invalid Date returns null).
- m-6 (editor marks form dirty on harmless rewrites): FIXED (SanitizeReport, `onChange` held in a ref, regression test).
- m-7 (name helper adoption): FIXED (all 8 sites migrated, `_shared/names.test.ts` added, plan amended).
- m-8 (duplicated fail_job block): FIXED (`_shared/jobs.ts` `failJobQuietly` plus a test).
- m-9 (stale deno_check_known.txt comment): FIXED.
- m-10 (storage catalog detector): harness green. The regexes were not re-audited in depth; I defer to the tenant-isolation and db reviewers.
- m-11 (migration aborts on odd stored values): FIXED (jsonb_typeof guards; the suite covers a JSON null calendar, an array calendar and non-boolean values).
- m-12 (unrun gates): the pgTAP harness now runs green (see CHECKED); deno and semgrep are still not run (i-3).
- i-1 (plan not amended for Eastern Arabic digits): FIXED (plan Rule 8 amended).
- i-3 (non-null assertion in `formatDigits`): FIXED (`?? d`).

CHECKED
- `npx tsc --noEmit`: exit 0.
- `npx eslint src`: exit 0, 0 warnings.
- `npx vitest run`: 12 files, 75 tests passed. This includes the new EthDate.test.tsx, csv.test.ts and the RichTextEditor dirty-state test.
- `npm run check:i18n`: 0.
- `npm run check:locales`: parity OK, calendar has 37 keys. The new `nav.*`, `calendarPrefs.saved/saveFailed/hijriNote` keys exist in en/am/om.
- `python3 scripts/ci/conventions.py`: 0 findings (name-concat 0, Ge'ez 0).
- `supabase/tests/run.sh`: run in a scratch database (review_cq_r3, since dropped) on the local PG16 as postgres. All migrations applied and all suites passed, including r6_calendar_numerals (15/15: idempotent rerun, legacy camelCase writes normalised, JSON-null and array calendar).
- `psql` checks:
  - `normalize_calendar_settings` is IMMUTABLE.
  - EXECUTE: anon false, authenticated true, service_role true. The trigger therefore works for the PostgREST school_admin upsert.
  - Under `set role authenticated`, legacy `showHijri` maps to `show_hijri`.
- Code review:
  - ethiopian-date.ts: `formatDigits`, `formatGregorian` (UTC fields, DD/MM/YYYY), lazy Hijri formatter, `toHijri` month-range validation, `formatHijri`.
  - EthDate: visible Gregorian/Hijri text, AA-contrast class, explicit `numerals` beats prefs.
  - EthDatePicker: localised nav aria-labels, per-day aria-label, `aria-current`.
  - useCalendarPrefs: parse/serialize, both spellings, query key `["tenant-config", id, "settings"]`, which is still invalidated by the `["tenant-config"]` prefix.
  - CalendarPreferencesPage and IdCardTemplateDesignerPage.
  - RichText: `toDom` report paths (disallowed tag, comment, unsafe href/src, dropped attribute).
  - RichTextEditor effect: no re-render loop after the sanitised `onChange`.
  - csv.ts: formula prefix, numeric exemption, CR quoting.
  - names.ts and `_shared/names.ts`, plus every changed call site (InvoicesPage, PayrollRunDetailPage, EditProfileModal, StaffRegistrationPage, StudentDetailPage, StudentDashboardView, issue-id-card, process-export-job, process-import-job, provision-portal-accounts).
  - `_shared/jobs.ts` and its test.
  - onboard-tenant: `must()` on every insert, snake_case calendar defaults, the catch-block rollback path.
  - Migration 20260925000002: normaliser, backfill `where is distinct from`, trigger `search_path`, revokes.
- Grep:
  - No other readers of the calendar keys.
  - Remaining ad-hoc CSV writers (m-2).
  - All `["tenant-config"…]` keys and `tenant_configs` writers, for the invalidation and wipe analysis (M-1).
- Not run: deno check, deno test, semgrep (i-3).

VERDICT: FAIL
1. M-1 | major | src/features/settings/CalendarPreferencesPage.tsx:32 and :74, and IdCardTemplateDesignerPage.tsx:251 and :475. A Save made before the settings load, or after the load fails, overwrites the whole `tenant_configs.settings` object and deletes branding, the ID-card template and the locale.
2. m-1 | minor | useCalendarPrefs.ts:40-52 and CalendarPreferencesPage.tsx:22-27. No Zod schema and no RHF.
3. m-2 | minor | src/lib/csv.ts:7. The API diverges from WP-12.1, and ad-hoc CSV writers remain in ClassesPage.tsx:264, ImportExportPage.tsx:12 and process-export-job/index.ts:57.
4. m-3 | minor | IdCardTemplateDesignerPage.tsx:252. `profile!.tenant_id` remains on a rewritten line.
5. i-1 | info | RichText.tsx:93. The `in` check can match Object.prototype keys.
6. i-2 | info | names.ts:22. `shortName` has no callers.
7. i-3 | info | deno check, deno test and semgrep gates were not verifiable here.
