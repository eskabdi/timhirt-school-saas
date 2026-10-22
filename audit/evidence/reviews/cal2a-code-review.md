# Code review (`code-review` skill, high), calendar slice 2a

Range `7d75a8b..f80cde2` (the slice 2a commit). Severity as in
`cal1-code-review.md`.

## Run 1 — `7d75a8b..f80cde2`
| # | Finding | Sev | Disposition |
|---|---|---|---|
| 1 | The approval diff hides `overrides_entry_id`, so a change that only re-targets an override looks like "no change" to the checker; the editor dropped the override when an entry was edited | High (checker approves blind) | Fixed: payload `from`/`to` carry `overrides` (the MoE/regional entry's name), shown in the inbox; the form keeps `overridesEntryId`. pgTAP + UI tests, mutation-proven |
| 2 | Freeze while a publish waits only in the RPCs; `create_school_calendar` could rebuild a frozen draft | Medium | Fixed: both guards refuse (`school_calendar_publish_pending`), trusted contexts excepted; pgTAP (recreate refused), M28b killed |
| 3 | Open form survives a year switch and saves into the other year's calendar | Medium | Fixed: `key={school_calendar_id}`; UI test, mutation-proven |
| 4 | Editors who are neither maker nor checker never see that a request waits | Medium | Fixed: `school_calendar_pending` (definer, own school, events, update or approve; no payload/maker); pgTAP for editor, teacher, other school; M30b killed |
| 5 | Expired pending request freezes the UI | Medium | Fixed: the RPC returns unexpired requests only; pgTAP (expiry), M32 killed |
| 6 | Duplicate suppressions of one date (random add ids; button stays) | Medium | Fixed: unique index (calendar, overrides_entry_id); `already_overridden` at save and submit (incl. a waiting request); `entity_changed` at approval; UI hides dates a request waits on. pgTAP + UI, M33/M34/M36 killed |
| 7 | Inbox link ignores the request's year; approving leaves the calendar cache stale | Medium | Fixed: `/academic-calendar?year=<ec_year>` (page honours ±1), inbox invalidates `["academic-calendar"]`; tests, mutation-proven |
| 8 | Year reopen: draft unblocks, published stays closed; no backfill | Low | By design and now documented in the migration: a closed calendar is the year's record and stays closed; a draft follows its year. Backfill statement added (no-op today: no published school calendar exists before this slice) |
| 9 | Escaped names pass the 200-char check but fail the column's 1000-char CHECK as a raw error | Low | Fixed: `normalize_calendar_entry_name` checks the serialized length → `invalid_name`; pgTAP, M35 killed |
| 10 | `editorErrorKey` duplicates `calendarErrorKey` | Low | Fixed: shared `exactErrorKey` |

Survivors in the mutation log are single layers of two-layer checks (RPC +
guard, tenant filter + `has_module`); every pair is killed
(`audit/evidence/calendar/cal2a-mutations-*.txt`).

## Run 2 — `7d75a8b..9f83575`
| # | Finding | Sev | Disposition |
|---|---|---|---|
| 1 | A closed year's draft still rebuildable through `create_school_calendar` (guards did not check the year) | Medium | Fixed: both guards refuse `calendar_closed` for a draft whose year is closed; pgTAP, M37/M37b killed |
| 2 | Span > 366 days and a removal without a target hit raw CHECK errors | Low | Fixed: `invalid_range` / `invalid_override` in the RPC and the request; pgTAP, M38/M39 killed |
| 3 | Removing a MoE/regional date copied its name, which may hold other keys or > 200 characters | Medium | Fixed: `removalName` keeps en/am/om, 200 characters; unit + page test, mutation-proven |
| 4 | A year inserted already closed did not close its calendar | Low | Fixed: the trigger also fires on insert; pgTAP, M40 killed |
| 5 | The approval flag was honoured for any role that set it | Medium (defence in depth) | Fixed: honoured only when `current_user` is the definer owner (postgres/supabase_admin); pgTAP with a BYPASSRLS role holding write grants, M41 killed |
| 6 | Draft-visibility rule written twice (policy, `calendar_year_settings`) | Low | Fixed: one helper `can_preview_school_calendar_draft()` used by both (the policy as an initplan) |
| 7 | Every edit invalidated the whole calendar tree; every decision refetched calendar data | Low | Fixed: the editor invalidates settings/entries/school-entries/requests only; the inbox only for calendar actions; test (no permission refetch), mutation-proven |
| 8 | Permission lookups repeated per call in `calendar_year_settings` | Low | Fixed with 6: evaluated once, only when the row is a draft |
| 9 | Selected day's entries came from a stale cell snapshot | Low | Fixed: derived from the current grid; test (the added day appears in the inspector), mutation-proven |
| 10 | Focus did not move into a re-opened add form; two submit_approval codes unmapped | Low | Fixed: `openedAt` per open; `reason_too_long`, `approval_action_unavailable` mapped in en/am/om; test, mutation-proven |
