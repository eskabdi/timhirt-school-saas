REVIEWER: CAL-I18N2 (round-2 i18n and accessibility)
WP: Academic Calendar Engine slice 1, c8a388d..6133b48 -- src (worktree /home/user/rv-wp09; the browser was driven against /home/user/timhirt-school-saas at the same commit, whose src is clean)
VERDICT: FAIL. There is 1 Major, a new regression introduced by this round's sr-only weekday names. There is also 1 Medium: I18N-05 is still open.

Round 1 status:
- Fixed: I18N-01, 03, 04, 06, 07, 08, 09, 10, 12 and 13.
- Fixed with small leftovers: I18N-02 and I18N-11 (see CAL-I18N2-03, -04 and -06).
- Not fixed: I18N-05.

FINDINGS

CAL-I18N2-01 | Major (regression) | src/features/academic-calendar/AcademicYearGridPage.tsx:209, 223
- Evidence: the new `<span className="sr-only">{weekdayNames[…]}</span>` in each of the 37 weekday `<th>` is `position:absolute`. Nothing inside the scroller is positioned: the region div is `static` and the weekday th are not sticky. So these spans take a containing block outside the `overflow-x-auto` region, are not clipped by it, and widen the whole document.
- Measured `document.scrollingElement.scrollWidth` in Chromium with default prefs (no Hijri, nothing selected):
  - om: 998 at 360, 998 at 412, 1013 at 768, 1024 at 1024
  - en: 990 at 360
  - am: 974 at 360
- With mobile emulation, `innerWidth` becomes 974–998.
- Scrolling the page right at 360 shows only blank page (`rv-i18n2-m360-om-panned.png`).
- Diagnosis: setting `style.position="relative"` on the region brings scrollWidth back to 360 (en and am measured).
- DashboardShell's `<main className="min-w-0 flex-1 p-4 sm:p-6">` is neither positioned nor clipping, so production behaves the same. Round 1 measured 360 here without Hijri, so this is a regression on every phone and tablet, in the default configuration, in all three locales.
- Reference: WCAG 1.4.10.
- Fix: add `relative` to the region div at :209 (or to each weekday th). Add a check that the page does not scroll horizontally at 360px, for example in a Playwright smoke test, since jsdom cannot see this.

CAL-I18N2-02 | Medium (I18N-05 not fixed) | AcademicYearGridPage.tsx:323, 384-386; src/components/EthDate.tsx:59-65
- Evidence: `flex min-w-0 flex-wrap` on the legend `<li>` does not help, because EthDate itself cannot break. Each `· GC` and `· Hijri` segment is a `whitespace-nowrap` span that carries its own leading space. So the EC·GC·Hijri chain is one unbreakable min-content box.
- With the sr-only spans excluded, the right edge of the widest element at a 360px viewport is:
  - Legend holiday list with show_hijri: am 500, en 530, om 533. These are the same numbers as round 1.
  - Inspector h2 after selecting a day: 588, 662 and 638 with Hijri; 371, 403 and 384 without Hijri (secondary_visible is on by default). The inspector h2 is the same defect.
- Reference: WCAG 1.4.10.
- Fix: put the break opportunity outside the nowrap spans in EthDate, e.g. `{" "}<span className="whitespace-nowrap">· …</span>`. That also covers the inspector h2. Re-measure at 360 in am/en/om with show_hijri on and a day selected.

CAL-I18N2-03 | Minor | AcademicYearGridPage.tsx:40, 240, 372-376; dayTypes.ts:56-61
- Evidence: `out_of_session` and `next_session` share OUT_OF_SESSION_FILL, the same DOTS pattern and no mark. The legend therefore shows "Out of session" and "Next year's session" with identical swatches, and the cells are visually identical. This was verified with next session = 2027-09-01.
- The tentative ☾ has no legend entry, and neither does the today outline.
- Reference: WCAG 1.4.1.
- Fix: give next_session its own pattern or mark, and add legend keys for ☾ and today.

CAL-I18N2-04 | Minor | AcademicYearGridPage.tsx:252
- Evidence: today's `outline-2 -outline-offset-2 outline-navy` and the selected `ring-2 ring-inset ring-ink` paint the same inner 2px band in near-identical dark colours. Selecting today therefore changes nothing visible (`rv-i18n2-today-unselected.png` and `rv-i18n2-today-selected.png` are identical).
- Contrast of the ring and the outline on fills:
  - special_closure #595959: 2.46:1 (ring) and 2.56:1 (outline)
  - national/religious #2e75b6: 3.56:1 and 3.70:1
- Reference: WCAG 1.4.11.
- Fix: make the selected and today indicators different, for example a light-plus-dark double ring for selected, or a corner marker for today. Make sure each indicator reaches 3:1 on #595959.

CAL-I18N2-05 | Minor | AcademicYearGridPage.tsx:158-163
- Evidence: there are no keyboard instructions anywhere. The cells are plain buttons with no composite role, and nothing visible or described says that 370 of the 371 days are reachable only with the arrow keys or Page Up/Down.
- ArrowUp/ArrowDown move ±7 days. In this months-as-rows layout that is a jump of 7 columns sideways, not to the cell above or below. Verified: from Tikimt 9, ArrowDown goes to Tikimt 16.
- Reference: WAI-ARIA APG keyboard interface (making keys discoverable).
- Fix: add a short hint (sr-only plus a visible tip) linked to the region with aria-describedby. Either make Up/Down move to the adjacent month row, or document the ±7 behaviour.

CAL-I18N2-06 | Minor (not verifiable) | AcademicYearGridPage.tsx:135-141, 237
- Evidence: the cell name has no weekday (e.g. "Meskerem 1, 2019 E.C. — National Holiday — … — Not a school day"), so the weekday comes only from the column header. The leading and trailing empty `<td aria-hidden>` are ignored in the AX tree: 4 ignored nodes before "Meskerem 1" (CDP getFullAXTree).
- I could not verify whether Chromium, NVDA or JAWS then report column headers shifted by the number of hidden cells: CDP exposes no column index.
- Fix: leave the empty td in the tree (blank, not aria-hidden), or add the weekday name to `cellName()`, or both.

CAL-I18N2-07 | Info | src/locales/*/common.json `academicCalendar.tentative` used at AcademicYearGridPage.tsx:139
- Evidence: the tentative label already contains parentheses, so the name reads "Mawlid (Tentative (Hijri calendar, depends on the moon))". The am and om names have the same nesting.
- Fix: use " — " instead of wrapping it in "( )", or add a short `tentativeShort` key.

CAL-I18N2-08 | Info | AcademicYearGridPage.tsx:208; src/lib/utils.ts:3
- Evidence: `<Card className="p-0">` does not remove the padding. `cn` is plain clsx with no tailwind-merge, and the computed padding-left on the region's parent is 20px. That spends 40px of the 328px available at 360 (region clientWidth 288).
- Fix: use a Card variant without padding, or merge the classes.

CAL-I18N2-09 | Info | dayTypes.ts:56; AcademicYearGridPage.tsx:254
- Evidence: the type marks are 8px glyphs in the cell corner. Their contrast is ≥4.84:1, but ● and ◆ are hard to tell apart at 1x (`rv-i18n2-marks-2x.png`). The legend swatch uses 9px.
- Consider 10px marks.

CHECKED
- Gates:
  - `npm run check:i18n`: 0. I proved it can fail: a scratch copy with 2 planted strings reported 2.
  - `npm run check:locales`: common 2369, apply 135, calendar 51; parity; no reformat.
  - vitest on academic-calendar (grid, contrast, api, AcademicYearGridPage), ethiopian-holidays and EthDate: 8 files, 44/44 pass.
- Locale diff checked key by key: `weekdays` (en/am/om), `choose.created`/`dropped` now `{n}`, `droppedTitle`, `derived.next_session`, the om caption now "ALI" (matches eraSuffix), `error.calendar_exists`. All three locales.
- I18N-01:
  - In the browser, every rendered fill in en/am/om is ≥4.5:1. The minimum is 4.84 (white on #2e75b6), which includes the 10px Hijri digit (opacity 1) and the 8px mark.
  - special_closure #595959 matches the migration seed. White on it is 7.0:1 (calculated; no special_closure entry renders in the mock data).
  - contrast.test asserts ≥4.5 for every fill.
- I18N-02:
  - Marks render in cells and legend.
  - Weekend is hatched; out-of-session is dotted.
  - aria-current="date" is on today (Tikimt 7, 2019 = 2026-10-17).
  - The selected ring is visible after focus moves away.
  - The weekday header is orange, hatched and bold.
- I18N-03:
  - Names are built from formatEth plus type plus formatHijri plus the tentative holiday name plus school-day status, with era suffixes in en/am/om.
  - Instructional has no suffix.
- I18N-04: tested as school_admin in en/am/om, plus calendar_exists and prev=published.
  - Focus lands on the page-level role=status.
  - The outcome and the left-out list survive the chooser unmounting.
  - Eastern Arabic digits follow prefs.
  - On error, focus stays on the button, the alert is linked to the fieldset, and the id resolves.
- I18N-06: Tab order is select → region → one cell; there are no other stops.
  - Arrows, Home/End and PageUp/PageDown work in all three locales.
  - Focus returns to the last cell after Shift+Tab then Tab.
  - Enter fills the always-mounted aria-live inspector, and aria-controls matches its id.
- I18N-07: the focus ring is fully visible at z-20 (screenshots).
- I18N-08: the inspector has no duplicate Hijri line.
- I18N-09: th accessible text is the full name (Monday / ሰኞ / Wiixata) and the letter is aria-hidden.
- I18N-10: the radio name is the label only, and the hint is the description. Disabled previous_year gives its reason. CalendarPreferencesPage checkboxes are linked to their notes with aria-describedby (static check).
- I18N-11: region role, label (caption) and tabIndex 0 are present. 110 empty cells are blank and aria-hidden. The month column is 61/81/88px at 360.
- I18N-13: new tests cover the tab stop, aria-current, the name and the notice focus. The 2026-10-09 comment is corrected.
- Reflow: measured at 360/412/768/1024/1280, with and without Hijri, with and without selection, desktop and mobile emulation.
- Not verified: a real screen reader (header association with hidden cells) and a real device.

Artifacts:
- Harness: /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n2 (port 5208, year-aware mock, now stopped).
- Drivers: /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n2-drive1.mjs … rv-i18n2-drive8.mjs
- Output: /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n2-drive1.out
- Screenshots in the same scratchpad: rv-i18n2-m360-om-panned.png, rv-i18n2-focus-next.png, rv-i18n2-focus-selected.png, rv-i18n2-today-selected.png, rv-i18n2-marks-2x.png, rv-i18n2-full-en.png

No repository files were edited, and no /tmp/review-*.md was written.