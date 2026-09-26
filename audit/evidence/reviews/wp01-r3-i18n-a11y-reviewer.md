REVIEWER: l10n-a11y-reviewer (independent, read-only), round 3
WP: R6 WP-01 at HEAD 1a5eec7. Round-2 fixes are in `git diff ffe8242..1a5eec7`. I also checked against `origin/fix/production-readiness-r6...HEAD` for the touched UI files.

VERDICT: FAIL. There is one major finding (N-01). F-01 and the other round-2 findings are fixed or accepted as minor.

**Status of the round-2 findings**
- **F-01 (major): FIXED.** `src/components/EthDate.tsx:113-115` now shows the Gregorian date as visible text (`<span className="text-ink-soft"> · {t("gregorianEquivalent",{date: formatGregorian(d,digits)})}</span>`), and the `title` attribute is gone. `src/components/EthDate.test.tsx:41-44` checks the text is rendered ("… · 25/09/2026 G.C."). The old code only put the date in `title`, which is not part of the text, so this test would have failed against it.
- **F-02: FIXED.** The Hijri and Gregorian spans use `text-ink-soft`.
- **F-03: FIXED.** The preview passes the unsaved prefs (`CalendarPreferencesPage.tsx:74`, `<EthDate … prefs={prefs}/>`).
- **F-04: FIXED.** There is an always-mounted `role="status"` span for "saved" and a `role="alert"` message for "save failed" (`:79-81`). Both are translated in en/am/om, and `save.reset()` runs on every edit.
- **F-06: FIXED.** om `calendarPrefs.preview` is now "Durduuba".
- **F-07: FIXED.** "Sha'ban" and "Dhu al-Qa'dah".
- **F-08: PARTIAL.** The navigation `aria-label`s now use `calendar:nav.*`, and all three locales have them. The picker preview uses `formatGregorian`. `WEEKDAYS` is still hard-coded (see N-03).
- **F-09: FIXED.** There is one helper, `formatGregorian` (DD/MM/YYYY, reads UTC, follows the numerals setting). The leading "=" is gone from `gregorianEquivalent` in all three locales.
- **F-10: FIXED for Amharic.** `src/index.css:23-39` adds the "Tayitu Ethiopic" and "Jiret Ethiopic" faces, limited to Ethiopic via unicode-range (U+1200-139F, 2D80-2DDF, AB00-AB2F, 1E7E0-1E7FF). The `tailwind.config.ts:59-60` stacks for both sans and display are now Inter/Public Sans → Tayitu → Jiret → Noto Sans Ethiopic. `fc-query` confirms both TTFs cover Ethiopic (lang am/gez/om/tig; charset 1200-…). No Arabic-digit fallback was added (N-05).
- **F-11: PARTIAL.** Each day button now has a full-date `aria-label`, and today gets `aria-current="date"`. The grid roles still have no rows and no arrow-key navigation (N-04).
- **F-12: FIXED for EthDate.** It has 5 tests. `CalendarPreferencesPage` still has no component test (N-07).
- **F-13: ADDRESSED.** The Umm al-Qura caveat is now shown on the page (`calendarPrefs.hijriNote`, all three locales).
- **F-05: OPEN, minor.** om `hijriEraSuffix` is still "A.H." (N-06).

FINDINGS

**N-01 | major | src/features/settings/CalendarPreferencesPage.tsx:32 and :79 (same pattern at src/features/settings/IdCardTemplateDesignerPage.tsx:250)**
- Evidence: `const next = { ...(settings ?? {}), calendar: serializeCalendarPrefs(prefs) }; … upsert({ tenant_id, settings: next })`.
- `settings` comes from `useTenantSettings()`. It is `undefined` while the query is loading, and also when it fails; round 2 made failures throw on purpose ("Errors propagate instead of silently becoming defaults", `useCalendarPrefs.ts:50`).
- The page never reads the query's `isError`/`isPending`. The Save button is only disabled on `save.isPending`.
- The `tenant_configs` trigger (`normalize_calendar_settings`, migration 20260925000002:28-84) only normalises the `calendar` key. It does not merge with the stored row.
- Failure scenario: an admin on a slow mobile connection opens Calendar settings. The settings fetch fails (network or RLS) or hasn't finished. The page shows defaults with no error message. The admin ticks "Show Hijri" and presses Save, and the upsert succeeds. `tenant_configs.settings` is replaced with `{calendar:{…}}`, which silently erases `branding` (school name, logo, palette), `idCardTemplate` and `billing.blockUnpaidBalance`. PITR is off and there are no backups, so this cannot be undone. The ID-card designer has the same hole in reverse (a failed load, then Save, wipes `calendar` and `branding`).
- This behaviour predates the WP. Round 2 rewrote these exact lines and added the error-propagation contract, but the page still doesn't act on it.
- Reference: WCAG 2.2 SC 3.3.1 (error identification: the load error is never shown) and SC 3.3.4 (error prevention for data changes). It is also a data-integrity problem.
- Fix:
  - Disable Save until `settings !== undefined`.
  - Render a `role="alert"` load-error message (new i18n key in all three locales) when the query errors.
  - Better still, write only the sub-key on the server, e.g. an RPC or update doing `settings = settings || jsonb_build_object('calendar', …)`, so the client never round-trips the whole jsonb. Do the same in `IdCardTemplateDesignerPage`.
  - Add an RTL test: with the query in the error state, Save is disabled and the alert is shown.

**N-02 | minor | src/components/EthDate.tsx:113 with src/features/settings/useCalendarPrefs.ts:26**
- Evidence: `DEFAULT_CALENDAR_PREFS.secondaryVisible` is `true`, and the Gregorian date is now inline text rather than a tooltip. Every `<EthDate/>` in the app therefore grows to "Meskerem 15, 2019 E.C. · 25/09/2026 G.C." for any tenant with no stored setting, or with a stored `true`. Per the migration header, production has 3 rows, all with `secondaryVisible` set.
- This is the intended F-01 behaviour, but dense tables on phones will wrap or overflow. I did not check this in a browser, so treat it as not verifiable.
- Fix: check the densest tables (invoices, attendance, payroll) at 360px. Consider `whitespace-nowrap` on each segment, or a compact table variant.

**N-03 | minor | src/components/EthDatePicker.tsx:30, :181**
- Evidence: `const WEEKDAYS = ["S","M","T","W","T","F","S"]` is still hard-coded English and is rendered as column headers in am/om.
- There is also `src/features/settings/IdCardTemplateDesignerPage.tsx:256` `setSaveMessage("Saved.")`, a hard-coded user-facing string in a file this WP touched.
- `check:i18n` reports 0 because its regex misses array literals and setState arguments.
- Fix: add `calendar:weekdaysShort` (7 entries, en/am/om) and a `common` saved key. Consider extending `scripts/i18n-audit.mjs` to catch these.

**N-04 | minor | src/components/EthDatePicker.tsx:155, :184**
- Evidence: `role="grid"` has no `role="row"` children and no arrow-key, Home/End or PageUp/PageDown handling.
- Focus doesn't move into the `role="dialog"` popup when it opens, and doesn't come back to the trigger when a day is picked. The trigger at :119-127 keeps focus, so a keyboard user can still Tab into the popup, and Escape closes it.
- Reference: APG date picker dialog pattern; WCAG 4.1.2.
- Fix: either implement the grid pattern (rows, roving tabindex, arrow keys, focus in on open and back on close), or drop `role="grid"`/`gridcell` so the day buttons are announced as plain buttons.

**N-05 | minor | tailwind.config.ts:59-60**
- Evidence: no font in the stack covers U+0660-0669. The "arab" option relies on the operating system's fallback. That usually works on Android, but it isn't guaranteed on every desktop.
- Fix: add `'Noto Sans Arabic'`, subset to digits through unicode-range, or accept the risk and document it.

**N-06 | minor | src/locales/om/calendar.json:5**
- Evidence: `"hijriEraSuffix": "A.H."` is still the English abbreviation, while the same file uses the Oromo "ALI"/"ALA".
- Fix: get a native Afaan Oromoo speaker to confirm (e.g. "ALH"), or document the choice. I can't verify the correct term.

**N-07 | minor | test gap, not verifiable | src/features/settings/CalendarPreferencesPage.tsx**
- Evidence: there is no component test for the page. Nothing tests the fieldset/legend group, the radio names, the status/alert messages, or the loading and error state (N-01).
- I did not drive the page in a browser, a screen reader or on a touch device.
- Fix: add an RTL test, e.g. `getByRole('group',{name})`, `getByRole('radio',{name})`, and `role=status` text after save.

**N-08 | minor | index.html:2**
- Evidence: `<html lang="en">` is never updated when the language changes. `grep` finds no `documentElement.lang` or `languageChanged` handler in `src`. Screen readers will read Amharic and Oromo UI with an English voice.
- This predates the WP.
- Reference: WCAG 3.1.1.
- Fix: set `document.documentElement.lang` on i18next `languageChanged`.

**N-09 | info | src/components/EthDate.tsx:110-117**
- Evidence: the `<time dateTime=…>` element now wraps the Gregorian and Hijri text as well as the EC date. Machine readers still get the correct ISO date, but strictly the element content should be the date that `dateTime` describes.
- Optional fix: wrap only the EC part in `<time>`.

**N-10 | info (pass) | project rules**
- No Ge'ez numerals: `grep -P '[\x{1369}-\x{137C}]'` and a search for toGeez/geezNumerals over `src` and `supabase/functions` return nothing. The test at `EthDate.test.tsx:54` asserts that no ASCII or Ge'ez digits appear when "arab" is chosen.
- Arabic 0-9 is the default (`numerals: "latn"`), and Eastern Arabic digits are opt-in only.
- Tayitu is primary and Jiret secondary, in the correct order.
- ICU: `{date}` is the only placeholder added. The am/om strings keep the placeholder and add no plural or select syntax, so there are no ICU errors.
- Touch targets: the checkbox and radio labels are now `min-h-6 py-1` (24px or more), and the day buttons are 36px.

CHECKED
- Read my own round-2 verdict. Read the UI parts of `git diff ffe8242..1a5eec7`: EthDate.tsx, EthDate.test.tsx, EthDatePicker.tsx, CalendarPreferencesPage.tsx, useCalendarPrefs.ts, ethiopian-date.ts, index.css, tailwind.config.ts, the 6 locale files and the IdCardTemplateDesignerPage change.
- `npm run check:i18n`: 0. It has blind spots (N-03).
- `npm run check:locales`: passes. common has 2183 keys, apply 135, calendar 37, with parity across en/am/om and no wholesale reformat.
- `npx vitest run`: 12 files, 75/75 tests pass, including EthDate.test.tsx (5 tests).
- Font files: public/fonts/Tayitu.ttf and Jiret.ttf exist. `fc-query` confirms Ethiopic coverage (lang am/gez/om; charset 1200-…).
- The migration's `normalize_calendar_settings` and trigger touch only the `calendar` key, which is the basis for N-01.
- Other readers of `tenant_configs.settings` (branding, billing, idCardTemplate): these are the keys N-01 would erase.
- Searched for Ge'ez numerals and for any sync of the html lang attribute.
- Not run: the browser, a screen reader, a mobile viewport, tsc, eslint, build, pgTAP.

VERDICT: FAIL
