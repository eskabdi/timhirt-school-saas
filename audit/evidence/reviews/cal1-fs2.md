REVIEWER: frontend-security-reviewer, round 2 (prefix CAL-FS2)
WP: Academic Calendar Engine slice 1, frontend. Diff reviewed: `git -C /home/user/rv-wp09 diff c8a388d..6133b48 -- src`. Gates were run in /home/user/timhirt-school-saas, which is at the same commit (6133b48) and has a clean `src`.

VERDICT: PASS. There are no blocker, major or medium findings. All seven round-1 findings are fixed, and I confirmed each fix by running the code, not only by reading it. The remaining findings are info only.

**Round-1 findings: status**

- **CAL-FS-01 (major): FIXED.**
  - The `created` state is now held in `AcademicYearGridPage`. It renders inside a `role=status` div that is always mounted (`AcademicYearGridPage.tsx:196`), and focus moves to it (`:116`).
  - Chromium check (perm=1, origin previous_year, RPC returns 3 dropped entries): at 300 ms and again at 2.1 s the notice still read "Draft created; 3 school days copied." It also showed the dropped count and listed each dropped day with its EthDate and name. The chooser was gone and `document.activeElement` was the notice. Changing the year away and back clears it.
  - The new test fails when the notice is moved back under the chooser: I mutated a scratch copy and the test went red.
- **CAL-FS-02 (minor): FIXED.**
  - `canChoose` now uses `rpc has_resource_permission(p_user_id: profile.id, 'academic_calendar', 'create')` (`api.ts:67`, page `:128`).
  - In the browser, the mock session role was "teacher". With the permission true the chooser appeared; with it false, or with an RPC error, there was no chooser. The arguments sent were `{p_user_id:"u1", …}`.
  - `profile.id` is the auth uid (`useSession.ts` reads users.id = session.user.id). The function is allow-listed for authenticated and answers only for the caller (lockdown `20260926000001`, line 193). The `calendar_exists` copy is now "A calendar for this year already exists.", which is no longer false for a draft. The one remaining case is CAL-FS2-01 below.
- **CAL-FS-03 (minor): FIXED.**
  - `previousAvailable` (`:129`) is true only when year−1's `school_status` is published or closed. That is the same predicate `create_school_calendar` uses (migration line 731-735).
  - Browser check: with year−1 in state draft or none, the radio is disabled and its hint reads "There is no published calendar for last year to copy." A forced click on the label leaves "moe" checked. With published or closed, the option is enabled.
  - The check fails closed while the query is loading or has errored.
- **CAL-FS-04 (minor): FIXED.**
  - `calendarErrorKey` now uses an exact match (`message === k`). Every code the RPC raises is a bare string message, so all five map correctly.
  - Browser check: `subst` and `rawerr` both showed "Something went wrong. Try again.", and the exact `calendar_exists` showed its localized copy. The sentinel SECRET-SERVER-TEXT never appeared in the DOM.
  - `api.test.ts` goes red if the match is reverted to `includes`: mutation verified.
- **CAL-FS-05 (minor): FIXED.**
  - `safeColor` (`contrast.ts:26-28`, `^#[0-9a-fA-F]{6}$`, falling back to #e7e6e6) is applied in `fetchDayTypes` (`api.ts:59`).
  - Every style sink takes its colour from `DayTypeRow.color` or from a constant: the cell fill, the weekend header, the Swatch, and `textOn`.
  - Browser check with these hostile colours: `red;background-image:url(…)`, `url(…)`, `#fff";x:url(…)`, `expression(alert(1))`, the number 12345, null and `#12345`. Only three fills appeared (#e7e6e6, #70ad47, #f3f4f6), no style attribute matched evil/url(/expression, and there were 0 external requests.
- **CAL-FS-06 (info): FIXED.**
  - `tField` (`src/lib/i18n.ts:53-59`) now returns only string values.
  - Browser check with labels and names of `{en:{…}, am:[…], om:7}`, `{en:{x:1}, am:"AM-FALLBACK"}`, and dropped names that were `null` or `{en:{o:1}, am:"AM-DROP"}`: there was no page error, the string fallbacks were used, and non-strings rendered as "".
  - Callers: 71 non-test call sites. The type signature is unchanged and all arguments are `*_i18n` jsonb or `d.name`. For valid data the behaviour is identical: an empty string is still returned as-is, and a plain string or null input still yields "". ApprovalsPage DiffValue only gains a better fallback.
  - The full vitest run is green: 24 files, 132 tests.
- **CAL-FS-07 (info): FIXED.** The settings (year, year±1), entries and can-create query keys now include `tenant_id` and the user id. Day types and authorities are global reference data, so leaving them unscoped is correct. The `invalidateQueries(["academic-calendar"])` prefix still matches the scoped keys. `RequireRole` returns null until the profile loads, so the `[null, null]` scope is never used.

**New code in this diff: checks**

- **Roving tabindex and keyboard:** the grid has exactly one tab stop, on today. Arrow keys, Home, End, PageDown and Enter all behave correctly in Chromium, and Enter fills the inspector.
- **aria-labels:** these are built from `formatEth`/`formatHijri` plus `tField` and `t()`, and set as attribute strings. An `<img onerror>` label stayed inert text (`__xss` null, 0 img and 0 script elements).
- **next_session:** shown and never counted. The year total stayed 210 with `next=2027-08-20`.
- **No dangerous sinks:** no innerHTML, dangerouslySetInnerHTML, eval, `new Function`, `window.open`, href or location writes, storage, console or `target=_blank` were added.
- **Server parity:** I found no UI action the server would refuse, apart from CAL-FS2-01.

FINDINGS

- **CAL-FS2-01 | info | /home/user/timhirt-school-saas/src/features/academic-calendar/AcademicYearGridPage.tsx:128**
  - *Evidence:* `calendar_year_settings` is SECURITY INVOKER. The policy `school_calendars_select` hides drafts from anyone without `academic_calendar:update`. So a user who has create but not update, in a school with an existing draft, sees `school_calendar_id = null` and is offered Choose Calendar. The server then refuses with `calendar_exists` (migration line 744-745).
  - *Why info:* the refusal now renders an accurate, localized message, and the client cannot know about a draft that RLS hides.
  - *Fix (optional):* have the definer RPC report draft existence, or accept the current behaviour.
- **CAL-FS2-02 | info | /home/user/timhirt-school-saas/src/features/academic-calendar/grid.ts:125**
  - *Evidence:* the grid marks a day `next_session` only when `iso > sessionEndsOn`. SQL `calendar_days` assigns a day covered by two sessions to the later year (`order by s.y desc`). The two disagree only if next year's session starts before this year's ends.
  - *Why info:* display only, and no security impact.
  - *Fix:* drop the `iso > sessionEndsOn` clause to match SQL, or add a DB constraint that sessions do not overlap.
- **CAL-FS2-03 | info | /home/user/timhirt-school-saas/src/lib/i18n.ts:53**
  - *Evidence:* the shared `tField` change has no unit test. I verified it only through the browser and through the green suites of its callers.
  - *Fix:* add a small test covering object, array and number values, and the fallback order.
- **CAL-FS2-04 | info | /home/user/timhirt-school-saas/src/features/auth/useSession.ts:32**
  - *Evidence:* the new scoped keys take tenant and user from `profile`, but the profile query key `qk.profile()` is itself unscoped. In the round-1 scenario (a different user signs in from another tab with no sign-out event), the profile is stale until it refetches, and so is the scope. This is pre-existing.
  - *Fix:* key the profile query by `userId`.
- **CAL-FS2-05 | info | /home/user/rv-wp09/src/features/platform/TenantDetailPage.tsx**
  - *Evidence:* the diff range also contains the invite release (0f515a3: invite status and Resend invite). I did not review it in depth because it is outside the calendar scope.
  - *What I did check:* there is no injection sink. The access token is sent only in the Authorization header to `${VITE_SUPABASE_URL}/functions/v1/invite-tenant-admin`, the existing pattern. Error text is a fixed translation key, not server text.
- **CAL-FS2-06 | info | not verifiable** (carried over from round 1)
  - No live database was used, so I checked RLS and definer behaviour by reading the SQL only.
  - I did not re-examine the WP-20 host-tenant check. The diff does not touch auth, routing guards or `supabase.ts`.
  - The frontend must not ship before migration 20261008000001 is applied.

CHECKED

- **Gates at 6133b48:**
  - `npx tsc --noEmit` rc=0
  - `npx eslint src` rc=0
  - `npx vitest run src/features/academic-calendar src/lib`: 9 files, 36 tests pass
  - full `npx vitest run`: 24 files, 132 tests pass
  - `check:i18n`: 0 hardcoded strings
  - `check:locales`: passed, with en/am/om parity for the new keys (`weekdays`, `derived.next_session`, `choose.droppedTitle`)
- **Mutation proof (scratch `git archive` copy, since deleted):** moving the notice under `canChoose` turns the page test red, and reverting to `includes` turns `api.test.ts` red.
- **Chromium harness:** `/tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/calfs2` (port 5298, server stopped; driver `drive.mjs`, adversarial mocks in `mocks/supabase.ts`). Scenarios covered:
  - hostile colours, labels and names
  - create flow, persistence and focus
  - permission true, false and error
  - previous year in states none, draft, published and closed
  - three error modes
  - keyboard navigation and next_session
- **Network:** 0 external requests in any scenario. `create_school_calendar` sends only `{p_ec_year, p_origin}`.
- **Server code read:** `create_school_calendar`, `calendar_year_settings`, `calendar_days` and the RLS select policies in 20261008000001; the `has_resource_permission` lockdown and its allow-list entry (`definer_allowlist.sql:19`).
- **No repository files were modified.** Both worktrees are clean.