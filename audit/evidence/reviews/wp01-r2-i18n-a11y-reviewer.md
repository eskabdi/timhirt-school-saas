REVIEWER: l10n-a11y-reviewer (independent, read-only)
WP: R6 WP-01, UI changes in `git diff bae3bfd..ffe8242 -- src/` (HEAD = ffe8242)
VERDICT: FAIL. There is one major finding (F-01).

FINDINGS

F-01 | major | src/components/EthDate.tsx:52
Evidence: the Gregorian date only appears in a tooltip:
`<time dateTime={iso} title={prefs.secondaryVisible ? t("gregorianEquivalent", { date: iso }) : undefined}>`
- The date is never shown as text.
- `<time>` can't take focus, so keyboard users can't reach it.
- Touch users can't hover, so they never see it. Most users in this market are on phones.
- Screen readers don't announce `title` reliably.
- The setting that turns it on is labelled "Show Gregorian date alongside Ethiopian dates" (`help.showGregorian`). That promises visible text, which the component doesn't deliver.
Reference: WCAG 2.2 SC 1.3.1, 2.1.1 and 1.4.13. The `title` attribute is not an accessible way to deliver content.
Fix: when `secondaryVisible` is on, render the Gregorian date as visible text, the same way the Hijri date is rendered (e.g. `<span> · {t("gregorianEquivalent",{date})}</span>`). If it must stay compact, use a focusable, labelled disclosure. At minimum, add a visually hidden copy (sr-only) and remove the `title`.

F-02 | minor | src/components/EthDate.tsx:54
Evidence: the new Hijri text uses `text-ink-faint` (#8A8FA6). Its contrast is 3.20:1 on the card colour (#FFF) and 3.04:1 on the page colour (#F8F9FA). The text is text-sm, so it needs 4.5:1. The token is used across the app, but here it carries real content (the Hijri date).
Reference: WCAG 2.2 SC 1.4.3.
Fix: use `text-ink-soft` (#44474E), or darken the `ink-faint` token.

F-03 | minor | src/features/settings/CalendarPreferencesPage.tsx:69
Evidence: the preview only receives the unsaved `numerals` value. `<EthDate/>` reads `showHijri` and `secondaryVisible` from the saved query in `useCalendarPrefs`. Ticking "Show Hijri" therefore doesn't change the preview until you save.
Reference: users should be able to predict the result of a setting (WCAG 3.2 predictability).
Fix: pass the edited prefs into the preview, e.g. via an optional `prefs` or `showHijri` override prop on EthDate.

F-04 | minor | src/features/settings/CalendarPreferencesPage.tsx:71
Evidence: nothing is rendered for `save.isSuccess` or `save.isError`, and there is no aria-live region. If saving fails (RLS or network), nothing tells the user. This existed before this WP, but the page was reworked here.
Reference: WCAG 2.2 SC 4.1.3 (status messages) and 3.3.1.
Fix: add a `role="status"` saved message and a `role="alert"` error message, both using i18n keys in all three locales.

F-05 | minor | src/locales/om/calendar.json:5
Evidence: the Oromo Hijri era suffix is `"hijriEraSuffix": "A.H."`, which is the English abbreviation. The same file's own pattern is `eraSuffix: "ALI"` (Akka Lakkoofsa Itoophiyaa) and `"= {date} ALA"`. A native speaker needs to confirm the right term; I can't verify it authoritatively.
Reference: consistent terms within a locale; fix plan i18n parity rule.
Fix: have an Afaan Oromoo reviewer confirm the form, e.g. "ALH" or "Hijraa", or document why the Latin "A.H." was chosen.

F-06 | minor | src/locales/om/common.json:125
Evidence: `calendarPrefs.preview` is "Duraan-argi". The rest of the om locale uses "Durduuba" (previewNote, previewTitle, componentPreview, livePreview) or "Duraa Ilaali" (preview).
Reference: consistent terminology across the locale.
Fix: use "Durduuba", editing the existing line in place. Don't re-serialise the file.

F-07 | minor | src/locales/en/calendar.json:4
Evidence: "Shaban" and "Dhu al-Qadah" drop the ʿayn apostrophe that standard English transliteration keeps ("Sha'ban", "Dhu al-Qa'dah"). The Oromo list keeps it ("Sha'baan", "Zul-Qa'ida"). The Amharic list looks acceptable: ሙሐረም, ሰፈር, ረቢዑል አወል/አኺር, ጀማደል ኡላ/አኺር, ረጀብ, ሻዕባን, ረመዳን, ሸዋል, ዙልቀዕዳ, ዙልሂጃ, and era "ዓ.ሂ" (ዓመተ ሂጅራ). These are recognised Ethiopian-Muslim spellings, with small variants in use (ሸዕባን, ዙልቃዕዳ, ዙልሒጃ). A native review is still advisable.
Fix: "Sha'ban", "Dhu al-Qa'dah". Optionally get sign-off from a native Amharic and Oromo speaker.

F-08 | minor | src/components/EthDatePicker.tsx:138, :143, :152, :30, :98
Evidence: this file was touched in the WP and still has hard-coded English:
- `aria-label`s "Previous month", "Previous years", "Select year", "Back to days", "Next month", "Next years".
- `WEEKDAYS = ["S","M","T","W","T","F","S"]`.
- The Gregorian preview uses `Intl.DateTimeFormat("en-GB", …)`, so it shows English month names and Western digits even when the tenant picked Eastern Arabic digits.

`check:i18n` reports 0 only because its regex (`scripts/i18n-audit.mjs:67`) matches literal attribute values and misses ternary expressions. All of this existed before the WP, but it contradicts the "0 hard-coded strings" gate.
Fix: add calendar-namespace keys in en, am and om, and pass the digits through `formatDigits`.

F-09 | minor | src/components/EthDate.tsx:52 and EthDatePicker.tsx:98
Evidence: the Gregorian date is formatted two different ways. EthDate's tooltip shows raw ISO (`= 2026-09-25 G.C.`) with no digit conversion, and a screen reader reads the leading "=" as "equals". The picker shows `en-GB` short form ("25 Sep 2026"). Neither goes through a project formatter, and neither follows the numerals preference.
Fix: add a single `formatGregorian(d, {numerals, locale})` helper, and drop the leading "=" from `gregorianEquivalent`, or hide it from assistive technology.

F-10 | minor | tailwind.config.ts:59-60
Evidence: the global stack is `sans: 'Inter','Noto Sans Ethiopic',system-ui` and `display: 'Public Sans','Noto Sans Ethiopic'`. Tayitu and Jiret are declared in `src/index.css:12-21`, but only the ID-card designer uses them. The new Amharic strings (Hijri months, `calendarPrefs.*`) therefore render in Noto Sans Ethiopic, or the system fallback, not Tayitu/Jiret. The stack also has no font that covers Arabic-Indic digits (U+0660–0669), so the "arab" option relies on system fallback. This existed before the WP.
Reference: project convention (Tayitu/Jiret for Amharic).
Fix: add a `:lang(am)` font stack that includes Tayitu/Jiret, and add an Arabic-digit-capable fallback such as Noto Sans Arabic.

F-11 | minor | src/components/EthDatePicker.tsx:192-206
Evidence: each day button is labelled only by its digit (now possibly "١٥"), with no month, year or full-date name. Today is marked only by a ring, with no `aria-current="date"`. `role="gridcell"` buttons sit in a `role="grid"` that has no rows and no arrow-key navigation. This existed before the WP, but the digit change makes the labels even less clear.
Reference: WCAG 2.2 SC 1.3.1, 1.4.1 and 4.1.2; APG date picker dialog pattern.
Fix: set `aria-label={formatEth(date,…)}` on each day, add `aria-current="date"` for today, and either implement grid keyboard navigation or drop the grid roles.

F-12 | minor | not verifiable / test gap
Evidence: there are no component tests for `EthDate` (Hijri span, tooltip, numerals) or for `CalendarPreferencesPage` (fieldset/legend, radio behaviour, preview). `grep` for EthDate/CalendarPreferencesPage in `*.test.tsx` returns nothing. I did not drive the page in a browser, so screen-reader and touch behaviour is not verified.
Fix: add RTL tests: radios reachable via `getByRole('radio',{name})` inside `getByRole('group',{name})`, the Hijri text rendered when `showHijri` is on, and the Gregorian date present as text (after F-01).

F-13 | info | src/lib/ethiopian-date.ts (toHijri)
Evidence: dates come from ICU's `islamic-umalqura` (Saudi Arabia's calendar). As far as I know, Ethiopia's Islamic Affairs Supreme Council goes by local moon sighting, so dates near month starts (Ramadan, Eid) can be off by a day or two. The test vectors for 2026-09-25 (14 Rabi II 1448) and 2026-03-20 (1 Shawwal 1447) are plausible and pass.
Fix: say it is Umm al-Qura in the settings help text, or add a tenant-level ±1/±2 day adjustment later.

F-14 | info | src/features/settings/CalendarPreferencesPage.tsx:48-67
Evidence (pass): both checkboxes are wrapped in `<label>` with translated text. The numeral radios sit in a `<fieldset>` with a translated `<legend>`, share `name="numerals"`, and each has its own wrapping label. Arrow-key radio behaviour is native. Ge'ez numerals are gone: `toGeez` and `useGeezNumerals` are deleted, and the test asserts no U+1369–137C output. Row height is about 20px (text-sm) against the 24px WCAG 2.5.8 minimum, so the touch targets are borderline. Consider `min-h-6` or `py-1` on the labels.

CHECKED
- `git diff bae3bfd..ffe8242 -- src/` (40 files), reading EthDate.tsx, EthDatePicker.tsx, CalendarPreferencesPage.tsx, useCalendarPrefs.ts, ethiopian-date.ts, names.ts and the 6 locale files in full.
- `npm run check:locales`: passes. common has 2180 keys, apply 135, calendar 31, with parity across en/am/om and no wholesale reformat.
- `npm run check:i18n`: reports 0. Its scope has a blind spot for ternary `aria-label`s (F-08).
- `npx vitest run src/lib/names.test.ts src/__tests__/ethiopian-date.test.ts`: 13/13 pass. This covers the Hijri vectors, the Eastern Arabic digits and the no-Ge'ez assertion.
- `calendarPrefs.*` exists in all three common.json files, and `hijriMonths` (12 entries) and `hijriEraSuffix` exist in all three calendar.json files.
- Amharic and Oromo Hijri month names, era suffixes and labels were checked for plausibility (F-05, F-06, F-07). Native-speaker confirmation is not verifiable by me.
- `fullName()`: every `select` changed in the diff now includes `middle_name`. A repo-wide grep finds no remaining `first_name … last_name` renders that drop the middle name. The other hand-rolled joins (StudentDetailPage, StudentDashboardView, the hr modals) include middle_name/father_name.
- Label, fieldset and legend semantics on the preferences page.
- Colour contrast of `ink-faint`, computed at 3.20 and 3.04 to 1.
- Font stack in tailwind.config.ts and src/index.css.
- Not run: the browser, a screen reader, a touch device, the full vitest, tsc or build gates.
