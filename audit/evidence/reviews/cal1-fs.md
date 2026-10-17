REVIEWER: frontend-security-reviewer (prefix CAL-FS)
WP: Academic Calendar Engine slice 1, frontend (`git -C /home/user/rv-wp09 diff e40f87b..c8a388d -- src`, worktree at c8a388d)
VERDICT: FAIL. There is one major finding (CAL-FS-01). I found no blocker and no exploitable security issue.

FINDINGS

CAL-FS-01 | major | /home/user/rv-wp09/src/features/academic-calendar/AcademicYearGridPage.tsx:83, 112, 251-277
- **Problem:** the result of "Choose Calendar" is never shown, so the "dropped days" notice is dead code.
- **Why:** `ChooseCalendar` keeps `result` in local state, and `onSuccess` calls `invalidateQueries(["academic-calendar"])`. The settings refetch then returns a `school_calendar_id`, because an admin can see the draft. That makes `canChoose` false, and line 112 unmounts the component together with its `result`.
- **Evidence:** I drove this in Chromium against mocks (scratch harness `calfs`, `role=school_admin`, origin `previous_year`, RPC returns `copied: 3` and `dropped: [1 entry]`). 300 ms after the click, `[role=status]` was already gone, there was no `p.text-late` "dropped" message, and the badge read "Draft". It was the same at 1.8 s.
- **Impact:** the server returns `dropped` only in this response. So when copied school days are left out because they fall on locked dates, the admin is never told. The "Draft created; # school days copied" confirmation is lost as well.
- **Tests:** the page test does not cover the mutation.
- **Fix:** move the `result` state, or a success banner, up to `AcademicYearGridPage`, or keep the component mounted until the user dismisses it. Then add a test asserting that the `created` and `dropped` messages survive the refetch.

CAL-FS-02 | minor | AcademicYearGridPage.tsx:83
- **Problem:** `canChoose` checks `profile?.role === "school_admin"`, but the server checks `has_resource_permission(uid,'academic_calendar','create')`. That permission honours custom roles (RolesTab lists every row of `permissions`, so `academic_calendar:create` can be granted) and user overrides.
- **Effect 1:** a staff member granted the permission is never offered the action, even though the server would accept it.
- **Effect 2:** a user who has create but not update cannot see a draft, because RLS on `school_calendars_select` requires update to see drafts. The UI offers Choose anyway, and the server refuses with `calendar_exists` (covered by pgTAP, academic_calendar_engine.sql:144). The UI then says "This year's calendar is already published", which is false: the calendar is a draft.
- **Not a security issue:** the definer function is the real gate.
- **Fix:** gate on `rpc('has_resource_permission', {p_user_id, p_resource:'academic_calendar', p_action:'create'})`. It is allow-listed for authenticated and answers only for the caller. Also give the `calendar_exists` error copy a draft-aware wording.

CAL-FS-03 | minor | AcademicYearGridPage.tsx:256-269
- **Problem:** "Use the previous school calendar" is always offered, but the server refuses it with `no_previous_calendar` when year−1 has no published or closed school calendar. The refusal renders a clean localized error, but this is still an action the UI offers and the server refuses.
- **Fix:** fetch `calendar_year_settings(year-1)`, which is already cached when the user views that year. Disable the option unless `school_status` is published or closed.

CAL-FS-04 | minor | /home/user/rv-wp09/src/features/academic-calendar/api.ts:83-86
- **Problem:** `calendarErrorKey` matches with `message.includes(k)`, a substring test. Any server error whose text happens to contain a code is mislabelled.
- **Evidence:** in the browser, a mocked 42703 error with message `column "not_allowed_x" …` was shown as "You are not allowed to set up the calendar."
- **Raw text is never shown:** in all 3 browser cases (unique-violation detail, "permission denied for function", the substring case) the DOM contained only the localized string, and the sentinel `SECRET-SERVER-TEXT` was absent.
- **Fix:** match exactly. The function raises the bare code as the message, so use `CREATE_ERRORS.find(k => message === k)`. Optionally also check `err.code` (42501/22023/23505).
- **Tests:** add a unit test for the mapping; none exists.

CAL-FS-05 | minor | AcademicYearGridPage.tsx:144, 152, 228; api.ts:51-58
- **Problem:** the client does not validate `calendar_day_types.color` and trusts whatever the database returns.
- **Why the impact is bounded:** React applies style objects through the CSSOM, so a hostile value cannot inject another declaration or load a URL.
- **Evidence:** in the browser, colours `red;background-image:url(https://evil.example/x.png)` and `url(https://evil.example/y.png)` were dropped. No style attribute contained them, and there were 0 external requests.
- **Side effect:** with an invalid colour, `textOn()` gets NaN and returns white text on the default white background, so the day number becomes unreadable.
- **Current control:** the DB CHECK `^#[0-9a-fA-F]{6}$` (migration line 134). INSERT and UPDATE are also revoked from authenticated.
- **Fix (defence in depth):** in `toGridDayTypes` / `fetchDayTypes`, accept only `/^#[0-9a-fA-F]{6}$/` and fall back to a neutral colour otherwise.

CAL-FS-06 | info | supabase/migrations/20261008000001_academic_calendar_engine.sql:119, 133, 206, 252 (consumed via `tField`, src/lib/i18n.ts:53)
- **Problem:** the `*_i18n` CHECKs require only `en` to be a string. If an `am` or `om` value were a JSON object, `tField` would return it and React would throw "Objects are not valid as a React child". That would replace the whole page with the router error screen for every user of the school.
- **Why it is only info now:** no client write path exists in slice 1.
- **Fix:** before slice 2 adds school entry editing, either require every value to be a string in the CHECK, or make `tField` return only `typeof === "string"` values.
- **XSS:** checked. Payloads such as `<img onerror>` and `<script>` in `label_i18n` and `name_i18n`, and `{x} $t(...) <b>` in the authority name, all rendered as inert text. `window.__xss` stayed null, and the DOM had 0 `img` and 0 `script` elements. ICU did not re-parse the interpolated `source`.

CAL-FS-07 | info | AcademicYearGridPage.tsx:50-53
- **Problem:** the query keys `["academic-calendar", …]` include neither tenant nor user, which the comment in `src/lib/queryKeys.ts` (§6.3) asks for.
- **Mitigation:** the cache is cleared on sign-out (`useSession.ts:26`, `DashboardShell.tsx:280`). Most keys in the codebase are unscoped anyway (358 of 427).
- **Residual risk (existing pattern):** if a different user signs in without a sign-out event (for example from another tab), the cache is not cleared. The tenant-specific settings and entries would then show stale data until refetch.
- **Fix:** include `profile.tenant_id` in the settings and entries keys, or clear the cache when the user id changes.

CAL-FS-08 | info | not verifiable here
- **WP-20 (host-tenant check):** I found no client-side host-to-tenant check in `src` (`grep` for host/tenant/hostname turned up only SecuritySettingsPage and PublicAdmissionFormPage). The diff does not touch auth, routing guards or `supabase.ts`, so this slice cannot have regressed it. I could not confirm where WP-20 is enforced.
- **No live database:** nothing was listening on localhost:5432, so the RLS and definer behaviour was checked by reading the SQL and the pgTAP suite, not by running it.
- **Deploy order:** per CLAUDE.md, migration 20261008000001 is still pending in production. If the frontend ships first, every staff member gets a nav entry to a page that shows "Could not load".

CHECKED
- **No HTML injection:** no innerHTML, dangerouslySetInnerHTML, eval, `new Function`, inline scripts, `window.open`, `href` or `location` writes in the diff. Text from the database renders only as React text nodes (browser-verified with XSS payloads). Compatible with Trusted Types and the CSP: `vercel.json` has `script-src 'self'`, and inline styles go through the CSSOM.
- **Error handling:** `calendarErrorKey` never surfaces server text (3 browser cases). All 6 error keys plus the hijriHoliday and level keys exist in en, am and om.
- **Route guards are UX only:** the route is RequireAuth → DashboardShell → RequireRole STAFF → RequireModule events, and the nav entry uses STAFF and module events.
  - `create_school_calendar` is SECURITY DEFINER with `search_path` pinned. It takes the tenant from `auth.uid()` and checks `academic_calendar:create`, the events module and the year window; recreating a draft needs `update`. Its EXECUTE is revoked and then re-granted to authenticated, and it is listed in `definer_allowlist.sql:46`.
  - `calendar_year_settings` refuses another tenant's `p_tenant` for end users.
  - The RLS select policies cover drafts (update permission needed) and the restrictive module gates. INSERT, UPDATE and DELETE are revoked from authenticated on all 7 tables. pgTAP covers the teacher refusal, create without update, and cross-tenant refusals.
- **Hijri suggestions are display only:** they never feed `counts`, and the only RPCs sent with `hijri_holidays` on were the two read RPCs. `create_school_calendar` sends only `{p_ec_year, p_origin}`. The `hijri_holidays` setting is a strict boolean in both the parser and the DB normaliser, defaulting to off.
- **Today and storage:** no bare `new Date()` for "today"; the page uses `today()` and `todayEthiopian()`, and `grid.ts` and `ethiopian-holidays.ts` only build dates from explicit arguments. No localStorage or sessionStorage.
- **Logging and network:** no console output, and no requests to hosts other than the app.
- **Dependencies and secrets:** no package.json or lockfile changes. `vite build` into scratch: the only "sb_secret_" / "service_role" strings in the bundle are the supabase-js key-format validator, not a key.
- **Gates (repo at c8a388d, `src` clean):** `npx tsc --noEmit` rc=0; `npx eslint src` rc=0; scoped vitest 5 files / 34 tests pass (`academic-calendar`, `ethiopian-holidays`, `calendarPrefs`, `EthDate`).
- **Browser harness:** copied to `/tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/calfs` (port 5297, adversarial mocks in `mocks/`, driver `drive.mjs`); the server has been stopped.
- **Not checked:** `/tmp/review-<name>.md` was not written, per the parent's instruction to return findings directly. No repository files were modified.