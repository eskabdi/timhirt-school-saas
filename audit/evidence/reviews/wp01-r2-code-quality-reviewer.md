REVIEWER: code-quality-reviewer
WP: R6 WP-01 (with the owner-directed WP-14 pull-forward), diff bae3bfd..ffe8242 (HEAD = ffe8242)
VERDICT: FAIL

There is one major finding, M-1. Everything else is minor or info.

FINDINGS

M-1 | major | Location: src/features/settings/useCalendarPrefs.ts:16-31, supabase/migrations/20260925000002_r6_calendar_numerals.sql:5,22,26,31-34, supabase/functions/onboard-tenant/index.ts (default `calendar: { secondaryVisible, numerals, showHijri }`)
- Evidence: The diff adds a new camelCase jsonb key, `settings.calendar.showHijri`. It is written by CalendarPreferencesPage, by the migration backfill and by onboard-tenant. The new CHECK constraint `tenant_configs_calendar_numerals_chk` builds camelCase keys (`geezNumerals`) into the schema.
- Reference: Plan §0 Rule 8 ("camelCase TS / snake_case SQL **and jsonb keys**", listed as non-negotiable) and WP-14.4 / L-09 (migrate `tenant_configs.settings` keys to snake_case, and map to camelCase only at the TS boundary).
- Why it matters: WP-14.4 already has to migrate `secondaryVisible`. This PR adds another camelCase key and a constraint that WP-14.4 will also have to rewrite.
- Fix: Store the new key as `show_hijri`. Map it to `showHijri` inside `parseCalendarPrefs`, and do the reverse mapping on save. Better still, start the read-both transition for `secondary_visible` here as well. The migration, the CHECK, the pgTAP suite `r6_calendar_numerals.sql` and onboard-tenant must all use the snake_case keys.

m-1 | minor | Location: src/features/settings/useCalendarPrefs.ts:7
- Evidence: The comment says `geezNumerals` "was removed by migration 20260925000001". That migration is `r6_verification_url_https`. The removal is in 20260925000002.
- Fix: Correct the migration id in the comment.

m-2 | minor | Location: src/features/settings/CalendarPreferencesPage.tsx:69 and src/components/EthDate.tsx:47-52
- Evidence: The preview passes only `numerals={prefs.numerals}`. `EthDate` reads `showHijri` and `secondaryVisible` from the saved tenant config, not from the unsaved form state. Ticking "Show Hijri" therefore does not change the preview until after Save.
- Fix: Let `EthDate` accept an optional `prefs` override (or `showHijri`), and pass the local `prefs` from the preview.

m-3 | minor | Location: src/features/settings/CalendarPreferencesPage.tsx:30-37
- Evidence: The save `useMutation` has no `onError` and no success feedback. A failed upsert shows the user nothing, whether it is the new CHECK (23514), RLS or the network. The page also mirrors server state with `useState` + `useEffect` instead of React Hook Form. `parseCalendarPrefs` is a hand-written validator rather than a Zod schema.
- Reference: Plan §0 Rule 6 (Zod allow-list on every input; generic client errors via `errors.*`); project RHF convention.
- Fix: Define a Zod `calendarPrefsSchema` (with `.catch` defaults) and use it for both parse and save. Drive the form with RHF. Surface errors through the `errors.*` helpers or a toast.

m-4 | minor | Location: src/features/settings/useCalendarPrefs.ts:36-42 (duplicated at CalendarPreferencesPage.tsx:21-25 and IdCardTemplateDesignerPage.tsx:112-116)
- Evidence: The same `["tenant-config"]` query (key and queryFn) is copied into three places.
- Problems with the copied query:
  - The queryFn discards `error` (`(await …).data`), so a failed fetch silently becomes the defaults.
  - It keeps `profile!.tenant_id!` non-null assertions.
  - It keeps `.eq("tenant_id", …)`, which CLAUDE.md says to leave out because RLS injects it.
  - The key is not tenant-scoped.
- The previous `useGeezNumerals` had the same problems; this PR moves them into a new shared hook rather than fixing them.
- Fix: Export one `useTenantConfig()` from the new hook module. Its queryFn should throw on `error`, and the three pages should use it.

m-5 | minor | Location: src/lib/ethiopian-date.ts:109-121 and src/components/EthDate.tsx:48-50
- Evidence: `toHijri` builds a new `Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", …)` on every call. `EthDate` calls it on every render of every date, and there are about 50 call sites, including large tables. It also calls `t("hijriMonths", { returnObjects: true })` each time.
- Fix: Create the formatter once, lazily, at module scope (keeping the try/catch feature detection).

m-6 | minor | Location: src/components/ui/RichTextEditor.tsx:51-58
- Evidence: The load effect calls `onChange(el.innerHTML)` whenever the sanitised serialisation differs from `value`. That includes harmless rewrites like `<b>` to `<strong>`, `<br/>` to `<br>` and attribute reordering, so opening an unedited notice or assignment makes the form dirty. `onChange` is also missing from the effect's dependencies.
- Fix: Call `onChange` only when something was actually removed. One way is to compare `sanitizeRichTextNodes(value)` against a parse of `value` with the same normaliser. Alternatively, document that callers must tolerate this. Add `onChange` to the dependencies, or hold it in a ref.

m-7 | minor | Location: src/lib/names.ts:1-25 and supabase/functions/_shared/names.ts
- Evidence: The API differs from plan WP-14.2, which specifies `formatName(p, "full" | "short")`, `initials()` and a camelCase `PersonName` mapped at the TS boundary.
  - `shortName` is exported but no production code calls it (dead export).
  - Existing inline joins that duplicate the helper were not migrated. They pass the conventions gate only because they mention `middle_name`/`father_name`. The sites are:
    - src/features/hr/EditProfileModal.tsx:107
    - src/features/hr/StaffRegistrationPage.tsx:190
    - src/features/students/StudentDetailPage.tsx:115
    - src/features/portal/StudentDashboardView.tsx:84
    - supabase/functions/process-import-job/index.ts:186
    - supabase/functions/process-export-job/index.ts:132
    - supabase/functions/provision-portal-accounts/index.ts:89
    - supabase/functions/issue-id-card/index.ts:309-310
  - There is no Deno test for `_shared/names.ts` (Rule 4).
- Fix: Either follow the plan's signature or amend WP-14.2 to record the chosen API. Move the listed sites to `fullName()`/`shortName()`. Add `_shared/names.test.ts`.

m-8 | minor | Location: supabase/functions/process-export-job/index.ts (catch block around line 264) and supabase/functions/process-import-job/index.ts:390-398
- Evidence: The two files contain the same 8-line try/await `fail_job`/log block, word for word.
- Fix: Move it into a `_shared` helper, e.g. `failJobQuietly(client, jobId, fnName)`.

m-9 | minor | Location: supabase/security/deno_check_known.txt:4
- Evidence: The header comment still names `enroll-finalize-billing (WP-04)` as baselined. That function was removed from the list, which now holds only 3 entries.
- Fix: Remove it from the comment.

m-10 | minor | Location: supabase/tests/rls/catalog_storage_policies.sql:28,31
- Evidence: The detector has two weaknesses:
  - The role-term regex counts any `EXISTS` subquery as a role term.
  - The tenant-term regex `foldername(name))[1] = .*get_tenant_id_for_user(...)` also matches a disjunction such as `bucket_id = 'x' OR (foldername(name))[1] = …`, which is not tenant-scoped.
  - No planted fixture covers the OR case.
- Fix: Add planted `OR`-shaped and irrelevant-`EXISTS` policies to the self-test, then tighten the regexes or walk the expression tree.

m-11 | minor | Location: supabase/migrations/20260925000002_r6_calendar_numerals.sql:15-22
- Evidence: Two stored values would abort the whole migration:
  - A non-boolean string in `showHijri` makes `(settings #>> '{calendar,showHijri}')::boolean` raise.
  - A JSON `null` in `calendar` makes `jsonb - 'geezNumerals'` raise "cannot delete from scalar".
- Neither case is likely, but either would stop the deploy transaction.
- Fix: Guard with `jsonb_typeof(...) = 'object'` / `= 'boolean'`.

m-12 | minor | Location: not applicable (verification gap)
- Evidence: None of the following could be run in this sandbox, so none of them is verified here:
  - `supabase/tests/run.sh` (the local PG16 cluster is down; connection refused on 5432), including the new catalog suites and `r6_calendar_numerals.sql`
  - `scripts/ci/deno-check.sh` (deno is not installed)
  - `scripts/ci/semgrep-rule-test.py` (semgrep is not installed)
- The implementer's claim of 61/61 suites and 28 functions with 3 baselined is taken from audit/FIXES_VERIFIED_R6.md only.
- Fix: The gatekeeper or the harness reviewer must run these three gates.

i-1 | info | Location: src/lib/ethiopian-date.ts:76-84, scripts/ci/conventions.py docstring, plan §0 Rule 8 / WP-14.1
- Evidence: Eastern Arabic digits (٠-٩) are offered as an opt-in. Plan text says "Arabic numerals only" and "formatEth always uses Arabic digits". The owner decision is recorded in audit/FIXES_VERIFIED_R6.md ("Owner-directed changes") and in docs/insa/_pending-changes.md, but the plan itself was not amended.
- Fix: Add a one-line amendment to Rule 8 / WP-14.1.

i-2 | info | Location: diff scope
- Evidence: The WP-01 PR also carries WP-14 work (names, numerals, Hijri, a migration). That conflicts with Rule 2 (one WP = one PR), but the owner directed it and it is documented.

i-3 | info | Location: src/lib/ethiopian-date.ts:84
- Evidence: `ARABIC_INDIC[Number(d)]!` uses a non-null assertion. It is safe because `[0-9]` guarantees the index; a short comment or a `?? d` fallback would drop it.

CHECKED
- `npx tsc --noEmit`: exit 0.
- `npx eslint src`: exit 0, with no output (0 errors, 0 warnings).
- `npx vitest run`: 10 files, 66 tests, all passing. This includes the new names.test.ts, RichText.test.tsx (editor load-path render test) and the Hijri/digit cases in ethiopian-date.test.ts.
- `npm run check:i18n`: 0. `npm run check:locales`: parity OK. New keys `hijriMonths`, `hijriEraSuffix` and `calendarPrefs.*` exist in en/am/om, and `gregorianEquivalent` exists.
- `python3 scripts/ci/conventions.py --self-test`: ok. The full scan finds 0. I reviewed the regexes and fixtures.
- `bash scripts/ci/pinned-actions.sh`: ok (7 uses, all SHA-pinned). I reviewed the CI job wiring; the conventions and semgrep self-tests are blocking.
- Code review only (not run):
  - run.sh TODO accounting: the open, closed, failed and errored counts, the check that seen equals planned, and the private mktemp file.
  - shim.sql default privileges and removal of the auth.users grant.
  - All four catalog suites and their baselines/allow-lists.
  - The migration and its pgTAP suite.
- names.ts / _shared/names.ts and all changed call sites. Every students query feeding `fullName` selects `middle_name`. I grepped for leftover first+last concatenations (none) and for duplicate inline joins (m-7).
- ethiopian-date.ts: `formatDigits`, `formatEth` and `toHijri`/`formatHijri`. No `toGeez`/`geez` references remain in src or supabase/functions.
- EthDate, EthDatePicker (prop rename, `formatDigits` use), CalendarPreferencesPage, and useCalendarPrefs (React Query key and invalidation).
- RichText `sanitizeRichTextNodes` (createElement plus allow-listed attributes only) and the RichTextEditor effect.
- The Edge Function `.catch()` fixes. I confirmed the remaining `.catch(() => {})` sites are on real Promises (auth admin, fetch, storage), not PostgREST builders.
- vite.config.ts commit-meta plugin and the package.json deploy script.
