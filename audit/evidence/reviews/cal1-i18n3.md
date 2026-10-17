REVIEWER: CAL-I18N3 (round-3 i18n and accessibility re-review)
WP: Academic Calendar Engine slice 1, `git -C /home/user/rv-wp09 diff 6133b48..0129fef -- src`. The browser was driven against /home/user/timhirt-school-saas. Its HEAD is e429947, but `git diff 0129fef HEAD -- src` is empty and `git status --short src` is clean, so it serves the same src as 0129fef.
VERDICT: FAIL. There is 1 Major (High), a new regression from this round's selected-ring change. Every round-2 finding is fixed, and I re-measured each one in the browser.

Round-2 status:
- I18N2-01 (page-wide scroll): fixed.
- I18N2-02 (EthDate unbreakable chain): fixed.
- I18N2-03 (legend, next_session pattern): fixed.
- I18N2-04 (today vs selected): fixed, but it introduced CAL-I18N3-01.
- I18N2-05 (keyboard hint, Up/Down): fixed.
- I18N2-06 (weekday in cell names): fixed. Whether a real screen reader reports the header association is still not verified.
- Info items 07, 08 and 09: fixed.

FINDINGS

CAL-I18N3-01 | Major / High (regression, WCAG 2.4.7, failure technique F78) | src/features/academic-calendar/AcademicYearGridPage.tsx:47, :281; src/index.css:64
- Evidence: the global focus indicator is `:focus-visible { @apply outline-none ring-2 ring-navy ring-offset-2 … }`. That ring is a box-shadow. The new `SELECTED_RING` is an inline `style.boxShadow`, so it overrides the focus ring on the selected cell, and the outline is transparent.
- Measured with keyboard only:
  1. Tab into the grid, then ArrowRight. The focused cell has `:focus-visible` = true and shadow `rgb(248,249,250) 0 0 0 2px, rgb(4,22,53) 0 0 0 4px` (the navy ring).
  2. Press Enter. `:focus-visible` is still true, but the shadow is now only `inset … #ffffff, inset … #111111`, so no focus ring.
  3. Tab out, then Shift+Tab back. Focus returns to the same cell, still with no focus ring.
- Screenshots `rv-i18n3-kb-2-after-enter.png` and `rv-i18n3-kb-3-back-in.png` are byte-identical (md5 e0c1f181…).
- The cell also looks the same focused and unfocused: in `rv-i18n3-national-selected-kbfocus.png` and `…-kbblur.png` it is unchanged, and the navy ring only appears on the neighbour once focus moves there. The same happens on the #595959 closure cell.
- So right after the main action (Enter), and every time focus comes back into the grid, a keyboard user has no focus indicator. Round 2's class-based ring did not remove the focus ring this way.
- Fix (either):
  - Draw the focus ring in a way inline box-shadow cannot override, e.g. `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy` on the cell.
  - Or compose the selected shadow with the focus ring when the cell is focused, for example through a class plus CSS variables instead of an inline style.
- Add a test: once selected and focused, the cell's computed box-shadow or outline must still include the focus ring.

CAL-I18N3-02 | Minor | AcademicYearGridPage.tsx:336; src/lib/i18n.ts:38
- Evidence: the reason uses `t(\`academicCalendar.choose.droppedReason.${d.reason}\`, { defaultValue: "" })`. The i18n config has `returnEmptyString: false`, so for an unknown reason i18next prints the raw key instead of an empty string.
- In the browser, with `reason: "weird"`, the notice reads "— Sports day (academicCalendar.choose.droppedReason.weird)" in en, am and om. The unbreakable key widens the page to scrollWidth 387 at 360.
- This is latent: the migration only emits `outside_year` and `locked_date` (20261008000001_academic_calendar_engine.sql:799, :803), and both render correctly in all three locales: "(falls on a locked date)", "(በተቆለፈ ቀን ላይ ይወድቃል)", "(guyyaa cufame irra bu'a)", and the outside_year forms.
- Fix: look up the reason only if it is known (e.g. `i18n.exists(key)`), and leave out the parentheses otherwise.

CAL-I18N3-03 | Minor (not verifiable) | src/locales/om/common.json:85 `academicCalendar.keyboardHint`
- Evidence: om reads "olii fi gadi tarree sanuma keessa turu". As far as I know, "tarree" is normally "row/line" and "column" is "utubaa". If that is right, the om hint says the opposite of the behaviour (Up/Down keep the column). en ("column") and am ("ዓምድ") are correct.
- Fix: have a native speaker confirm the om wording.

CAL-I18N3-04 | Info | src/features/platform/TenantDetailPage.tsx:66; supabase/functions/invite-tenant-admin/index.ts:55, :93
- Evidence: every 429 maps to `resendRateLimited` ("Wait an hour and try again"). That includes the general 10-per-60-second bucket at :55, where waiting a minute is enough. The per-user 3-per-hour bucket at :93 does match the text.
- The mapping itself works: the new unit test passes, unknown errors fall back to `resendFailed`, and the key exists in en, am and om.
- Fix: optional. Use neutral wording ("Try again later"), or read `retry_after_seconds`.

CAL-I18N3-05 | Info | src/locales/am/common.json (`academicCalendar.tentative`); AcademicYearGridPage.tsx `cellNames`
- Evidence: the tentative cell name now uses an ASCII ": " in every locale, e.g. "መውሊድ: ጊዜያዊ (…)". The am strings elsewhere use the Ethiopic "፦" (e.g. "የቀሩ፦").
- This is cosmetic and screen readers handle it fine. A localized separator key would be cleaner.

CAL-I18N3-06 | Info | AcademicYearGridPage.tsx:377-379 (TodayBar)
- Evidence, from the computed colours with the clock set into a special_closure day:
  - on #595959: black bar 2.70:1, 1px white edge 7.0:1
  - on #2e75b6: black 3.90:1, white 4.84:1
- The pair meets 1.4.11 because the white edge is next to the fill, but on #595959 that edge is only 1px. A 2px edge would be sturdier.
- The selected ring passes on both fills: white 2px inner (4.84 and 7.0) and black 2px outer.
- Today and selected are now visually distinct: `rv-i18n3-national-unselected.png` and `…-selected-click.png` differ.

CAL-I18N3-07 | Info | AcademicYearGridPage tests
- Evidence: no automated reflow guard was added; jsdom cannot measure layout and there is no Playwright test. The only proof that the page does not scroll horizontally is the manual evidence file.
- Touch targets measured 29-30 × 34 CSS px. That meets WCAG 2.5.8 AA (24px) but is below 44px.

CHECKED
- Gates (in /home/user/timhirt-school-saas, src identical to 0129fef):
  - `npm run check:i18n`: 0 hardcoded strings. Round 2 showed this gate fails on planted strings.
  - `npm run check:locales`: common 2375, apply 135, calendar 51; parity; passed.
  - vitest on src/features/academic-calendar, TenantDetailPage.test.tsx, src/lib/i18n.test.ts and src/components: 9 files, 46/46 pass.
- Locales, key by key against 6133b48, in en/am/om: keyboardHint, legendToday, legendTentative, choose.droppedReason.{locked_date,outside_year}, the reworded choose.dropped and droppedTitle, platformPagesX.resendRateLimited, and the inviteResent wording. All three locales are present with ICU intact. The Amharic hint renders in the project font stack (Inter, "Tayitu Ethiopic", …).
- I18N2-01 / reflow:
  - Grid: 36 runs = {mobile emulation, desktop} × {360, 412, 768} × {en, am, om} × {Hijri + Hijri holidays on, off}, with next session set and today selected via Enter. scrollWidth = innerWidth = viewport before and after selection in every run.
  - The widest non-region element ends at the viewport edge.
  - Negative control: setting the region to `position: static` gives scrollWidth 954-993 every time, so the measurement does catch the regression.
  - Created notice (360 px, 6 runs): fits at 360 in every locale with the real reasons; the 387 overflow comes only from the unknown-reason raw key (CAL-I18N3-02).
- I18N2-02:
  - Inspector heading right edge is 324 at 360 (scrollWidth 288 = clientWidth). It wraps to 3 lines with Hijri and 2 without, and at 412 it is 376.
  - The legend lists have scrollWidth equal to clientWidth, and no li goes past its ul.
  - Screenshot `rv-i18n3-m360-am.png` shows the "·" segments wrapping.
- I18N2-03:
  - next_session uses the 90deg STRIPES pattern (12 cells) and out_of_session uses dots (34 cells); the legend swatches differ the same way.
  - The legend has "Today" (with the bar) and "☾ Tentative Hijri holiday" keys in all three locales (`rv-i18n3-legend-en.png`).
- I18N2-04: contrast as in CAL-I18N3-06; today and selected are distinct, but see CAL-I18N3-01.
- I18N2-05:
  - The hint is visible (9.3:1), and the region's aria-describedby resolves to it.
  - Up/Down keep the column (col 13 → 13 → 13, and col 31 holds after End).
  - Page Up/Down keep the day number (Hidar 12 → Tahsas 12); Home and End go to the start and end of the month.
  - Same results in en, am and om.
- I18N2-06: every cell name now starts with the weekday ("Saturday — Tikimt 7, 2019 E.C. — …", "ቅዳሜ — …", "Sanbata — …").
- I18N2-07: tentative names read "Mawlid: Tentative (…)" with no nested parentheses.
- I18N2-08: the region's parent has 0px padding; the region clientWidth is 328 at 360 (was 288).
- I18N2-09: marks are 10px, minimum contrast 4.84:1.
- Dropped-day reasons were driven as school_admin in en/am/om.
- TenantDetailPage: 429 → resendRateLimited (unit test), other errors → resendFailed (code read).
- Not verified: a real screen reader and a real device.

Artifacts (scratchpad /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad):
- Drivers: /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n3-reflow.mjs, /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n3-detail.mjs, /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n3-focus.mjs
- Output: /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n3-reflow.out, /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n3-detail.out
- Screenshots:
  - /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n3-kb-1-focused.png
  - /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n3-kb-2-after-enter.png
  - /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n3-kb-3-back-in.png
  - /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n3-national-selected-kbfocus.png
  - /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n3-national-selected-kbblur.png
  - /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n3-m360-am.png
  - /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/rv-i18n3-legend-en.png
- Harness changes, all in scratch: I added a special_closure entry and a test national holiday on 2026-10-16/17 to rv-i18n2/data/entries.json. I changed the mock's dropped reasons to the real `locked_date`/`outside_year`, and `dropped=bogus` now gives an unknown reason.
- The Vite server on port 5208 is stopped. No repository files were edited (both trees show a clean git status), and no /tmp/review-*.md was written.