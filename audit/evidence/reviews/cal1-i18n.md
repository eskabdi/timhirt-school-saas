REVIEWER: CAL-I18N reviewer (i18n and accessibility)
WP: Academic Calendar Engine, slice 1 (commit c8a388d; diff e40f87b..c8a388d -- src)
VERDICT: FAIL. There are 2 Major and 4 Medium findings.

How I checked: I read all files in scope. I ran `check:i18n` and `check:locales`, and I ran the 5 affected vitest files (34/34 pass). I rendered each ICU message with i18next-icu in en, am and om. I drove the page in Chromium through a copy of the harness, which lives at `/tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n` (port 5207, with public/fonts served, a viewport meta tag, and the role and create RPC mocked). The original harness was not touched. The driver scripts are in the scratchpad as `rv-i18n-drive{1..5}.mjs` and `rv-i18n-icu.mjs`. Screenshots are `rv-i18n-focus2.png`, `rv-i18n-focus3.png`, `rv-i18n-full-en.png` and `rv-i18n-mobile-{am,en,om}.png`.

FINDINGS

CAL-I18N-01 | Major | src/features/academic-calendar/AcademicYearGridPage.tsx:26-34, 152, 154
- Evidence: `textOn()` switches to dark text only when luminance is above 0.4. The real crossover point for #1f2937 against white is about 0.18. So these mid-tone fills get white 12px text that fails WCAG 1.4.3 (4.5:1):
  - examination #e88a8e: 2.48:1
  - semester_break #70ad47: 2.71:1
  - regional_holiday #5b9bd5: 2.96:1
  - special_closure #7f7f7f: 4.00:1 (fails with either text colour; dark text gives 3.67)
- The Hijri day is drawn at 9px with `opacity-80`. That drops to 2.10:1 on exam days, 3.71:1 on national holidays and 4.46:1 on staff_development.
- I computed every type's ratio from the seeded colours (types.json matches dayTypes.ts).
- Reference: WCAG 1.4.3.
- Fix:
  - Pick the text colour by the higher contrast ratio, not a 0.4 threshold. With that, exam goes to 5.91, semester break to 5.42 and regional to 4.96.
  - Darken or lighten special_closure, or use #000 text on it.
  - Drop `opacity-80`, and raise the Hijri digit to at least 10–11px.
  - Add a unit test asserting ≥4.5:1 for every DAY_TYPES colour.

CAL-I18N-02 | Major | AcademicYearGridPage.tsx:128, 144, 149-155, 226-231; dayTypes.ts:27-28
- Evidence: in a cell, day type and "counts as a school day" are shown only by fill colour. The only extras are the ☾ for tentative days and the navy outline for today. Specific problems:
  - national_holiday and religious_holiday share #2e75b6. The legend shows two identical swatches, so a sighted user cannot tell them apart.
  - out_of_session (#f3f4f6) against instructional (#ffffff) is 1.10:1. academic_year_opening/closing (#fff2cc) against white is 1.12:1. Both are effectively invisible, which fails 1.4.11 as well.
  - out_of_session is not in the legend.
  - Weekend columns in the header are marked only by an orange background.
  - The selected cell (`aria-pressed=true`) has no visual state. Its computed style is identical to an unselected peer once focus moves away.
  - Today is not exposed to assistive technology: there is no `aria-current="date"`.
- Reference: WCAG 1.4.1, 1.4.11, 4.1.2.
- Fix:
  - Add a non-colour cue per category: a short letter code or glyph in the cell (aria-hidden, since the name carries it), or a pattern/border style. Give each cue a matching entry in the legend.
  - Give the two holiday types distinct cues.
  - Add out_of_session to the legend and give it a visible pattern or hatch.
  - Style the selected cell (ring or border).
  - Add `aria-current="date"` to today.

CAL-I18N-03 | Medium | AcademicYearGridPage.tsx:145-146, 149, 194
- Evidence: the cell's `aria-label` replaces its visible content. As a result:
  - When the school shows Hijri dates, the Hijri day is visible (cell text "129" = EC 1 plus Hijri 29) but missing from the name ("Meskerem 1, 2019 — National Holiday").
  - The tentative name does not say which holiday it is: "ነሐሴ 8, 2019 — የሳምንት መጨረሻ — ጊዜያዊ (በሂጅራ ቀን መቁጠሪያ፣ በጨረቃ እይታ ይወሰናል)". Mawlid is named only in the inspector.
  - The date string is hand-built rather than produced by `formatEth`/`formatHijri`, against the convention that every date goes through `<EthDate/>`/formatEth. So it has no era suffix (ዓ.ም / E.C. / ALI), and the inspector's Hijri line at :194 has no AH.
- Reference: WCAG 1.3.1, 4.1.2; CLAUDE.md "Every rendered date goes through `<EthDate/>` or `formatEth`".
- Fix: build the name from `formatEth(...)`, then the type label, then `formatHijri(...)` when `c.hijri` is set, then `t("academicCalendar.hijriHoliday.<code>")` plus "tentative" for each tentative code, then school day / not a school day.

CAL-I18N-04 | Medium | AcademicYearGridPage.tsx:83, 112, 254, 272-278
- Evidence: this is reproduced in the browser as school_admin. When you press "Create draft", `onSuccess` invalidates the queries. The settings refetch returns `school_calendar_id`, so `canChoose` becomes false and `<ChooseCalendar>` unmounts. That takes with it:
  - the focused button: `document.activeElement` ends up as BODY;
  - the `role="status"` "Draft created; # school days copied" message, which never shows (`[role=status]` count is 0 afterwards);
  - the "dropped" warning.
- Reference: WCAG 2.4.3, 4.1.3, 3.3.1.
- Fix:
  - Keep the result and the status/alert region in the page, outside the conditional.
  - After success, move focus to that message or to the h1/grid.
  - Add a test that the status text survives the refetch.

CAL-I18N-05 | Medium | AcademicYearGridPage.tsx:236-238 (Legend holidays list)
- Evidence: at a 360px viewport with the opt-in `show_hijri`, the whole page scrolls horizontally. scrollWidth is 500 (am), 530 (en) and 533 (om) against a clientWidth of 360.
- The overflowing element is `<ul class="grid … sm:grid-cols-2">` → `<li><EthDate/> — name</li>`. EthDate's EC · GC · Hijri segments are each `whitespace-nowrap`, and the separator space sits inside the nowrap span, so the chain cannot break. The grid item's `min-width:auto` then pushes the page wider.
- Without Hijri the page width is 360 (no overflow). The 37-column table itself scrolls correctly inside its Card.
- Reference: WCAG 1.4.10 Reflow.
- Fix: in the legend, use `min-w-0` items and render the date and name as separately wrapping blocks, e.g. `<li className="flex flex-wrap gap-x-1 min-w-0">`. Alternatively, move the break opportunity in EthDate outside the nowrap spans.

CAL-I18N-06 | Medium | AcademicYearGridPage.tsx:149-151, 174-177, 192
- Evidence: every day is its own tab stop, 371 of them (measured: 371 Tabs to cross the grid). ArrowRight does not move focus; there is no roving tabindex.
  - The inspector sits after the table, so a keyboard user must tab through the remaining cells to reach it or the legend.
  - Each cell is announced as a "toggle button, not pressed" for a single-select choice.
  - There is no `aria-controls` link to the inspector.
  - The `aria-live` Card is mounted already holding its content on the first selection, so the first announcement is unreliable.
  - There are no keyboard tests.
- Reference: WAI-ARIA APG Grid pattern; WCAG 2.1.1, 2.4.3, 4.1.3.
- Fix:
  - Use a roving tabindex: one tab stop, with arrow keys, Home/End and PageUp/PageDown by month.
  - Use `aria-selected` in a `role="grid"`, or keep plain buttons with `aria-controls` pointing at the inspector.
  - Render the live region always (empty until a cell is selected).

CAL-I18N-07 | Minor | AcademicYearGridPage.tsx:151
- Evidence: the global `:focus-visible` ring is a box-shadow. The next cells' `relative` buttons paint over its right and bottom edges, so only the top and left of the ring show (see `rv-i18n-focus2.png` and `rv-i18n-focus3.png`).
- Reference: WCAG 2.4.7 / 2.4.11.
- Fix: add `focus-visible:z-20` to the cell button.

CAL-I18N-08 | Minor | AcademicYearGridPage.tsx:193-196
- Evidence: the inspector shows the Hijri date twice. `<EthDate>` in the h2 already renders it when show_hijri is on, and :194 repeats it (without AH). Verified text: "…ረቢዑል አኺር 29, 1448 ዓ.ሂ / ረቢዑል አኺር 29, 1448".
- In Amharic an instructional day reads "የትምህርት ቀን · የትምህርት ቀን": the type label and `schoolDay` are the same string.
- Fix: delete line 194. Skip the school-day suffix when the type is instructional, or reword the am string.

CAL-I18N-09 | Minor | AcademicYearGridPage.tsx:126-130; src/locales/*/calendar.json `weekdaysShort`
- Evidence: the 37 column headers are single letters with no `abbr` or full name. Some letters repeat (en "T"/"T" and "S"/"S"; om "K"/"K"), so a screen reader reads ambiguous column headers.
- Fix: add a full `weekdays` array to calendar.json in all three locales, and set it as `abbr` (or sr-only text) on each th.

CAL-I18N-10 | Minor | AcademicYearGridPage.tsx:262-268, 278; src/features/settings/CalendarPreferencesPage.tsx:56-61
- Evidence:
  - Each radio's hint sits inside its `<label>`, so it becomes part of the accessible name (aria snapshot: radio "Use the MoE calendar Follow the national (and regional) calendar as published; …"). It is not an `aria-describedby` description.
  - The error alert is not linked to the group.
  - In settings, the `hijriHolidaysNote` text is not linked to its checkbox (same pattern as the existing showHijri note).
- Reference: WCAG 1.3.1, 3.3.2.
- Fix: put the hint in a separate element and point `aria-describedby` at it, for the radios, the checkbox and the error.

CAL-I18N-11 | Minor | AcademicYearGridPage.tsx:118, 138, 142
- Evidence:
  - The horizontal scroll container has no `role="region"`, label or `tabindex`.
  - 110 empty cells contain a literal "-" that screen readers read out.
  - On a 360px screen the sticky month column takes about a third of the 328px scroller (`rv-i18n-mobile-om.png`).
- Fix:
  - Add `role="region" aria-labelledby` (pointing at the caption) and `tabIndex={0}` to the scroller.
  - Make the empty cells empty or `aria-hidden`.
  - Narrow or abbreviate the month column below `sm`.

CAL-I18N-12 | Minor | src/locales/om/common.json `academicCalendar.caption`; AcademicYearGridPage.tsx:273, 276
- Evidence:
  - The om caption says "A.L.I." while the om calendar `eraSuffix` is "ALI", so the same page uses two spellings.
  - ICU `#` in `created`/`dropped` always uses Western digits, while the rest of the page follows `prefs.numerals` (Eastern Arabic when chosen).
- Fix: use one spelling of the om era suffix, and pass `formatDigits(count)` as a separate argument rather than `#`.

CAL-I18N-13 | Info | src/features/academic-calendar/AcademicYearGridPage.test.tsx:71
- Evidence:
  - The tests check only totals and whether Choose Calendar is offered. There are no assertions on the caption, th scope, cell accessible names, keyboard behaviour, contrast or the status message.
  - The comment says 2026-10-09 is "Tikimt 2019 EC". It is Meskerem 29: the today outline renders on Meskerem 29.
- Fix: add a11y assertions and correct the comment.

CHECKED
- Gates:
  - `npm run check:i18n`: 0 hardcoded strings.
  - `npm run check:locales`: common 2359, apply 135, calendar 44 keys, parity across en/am/om, no reformat.
  - vitest on academic-calendar, ethiopian-holidays, calendarPrefs and EthDate: 34/34 pass.
- Locale keys `academicCalendar.*`, `nav.academicCalendar`, `calendarPrefs.hijriHolidays` and `calendarPrefs.hijriHolidaysNote` exist in en, am and om.
- ICU plurals `created`/`dropped` render correctly in en, am and om for 0, 1, 2 and 11 with i18next-icu.
- No Ge'ez numerals (U+1369–U+137C) in the diff or the new locale values.
- Amharic font: Tayitu Ethiopic loads, and CDP `getPlatformFontsForNode` shows Tayitu rendering the am weekday headers, month names, h1 and legend. The stack is Tayitu Ethiopic, then Jiret Ethiopic, inherited from tailwind `sans`/`display`.
- "Today": `todayEthiopian()`/`today()` are used and no bare `new Date()` is added. The today outline lands on Meskerem 29, 2019 = 2026-10-09 (correct).
- Legend and inspector dates go through `<EthDate/>`. The cell aria-label and the Hijri line do not (finding 03).
- Table semantics: sr-only caption present in all three locales, `th scope=col` on the weekday and total headers, `th scope=row` on months and the tfoot.
- Year select has a label. Choose Calendar uses fieldset and legend.
- Contrast computed for all 17 fills plus the 80%-opacity Hijri text.
- Keyboard tested: tab count, arrow keys, Enter selects, focus stays on the cell, focus ring screenshots.
- Choose Calendar flow tested end to end as school_admin.
- Mobile at 360px in am, en and om: the table scrolls inside its Card, but the page overflows when Hijri is shown.
- Touch targets: cells are at least 24×33px, which meets WCAG 2.5.8 AA. The radios are 13px, but the whole label is clickable.
- Reduced motion: the page has no animations, so this does not apply.
- Ethiopian clock and First/Middle/Last name order: the page shows no times or person names, so these do not apply.
- Nav entry in DashboardShell: key `nav.academicCalendar`, STAFF roles, events module.
- Not verified: rendering on a real mobile device or with a screen reader (NVDA/VoiceOver/TalkBack). Accessible names and live-region behaviour come from the DOM, ARIA snapshots and the ARIA spec, not from a screen-reader run.