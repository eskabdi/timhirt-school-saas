# Release code review (`code-review` skill), calendar slice 1 + invite fixes

Every delta from the last production deploy to the release candidate was
reviewed; each run's findings are listed with a severity and what was done.
Severity: **High** = data loss, account deletion, wrong data shown as right,
or a security control silently off; **Medium** = a user-visible bug or a gap
in a stated guarantee; **Low** = cleanup, edge case or defence in depth.
"Pre-existing" = present in production before this release and not made worse
by it (deferred with the reason; not a release blocker).

## Run 1 — `310820a..6133b48`
| # | Finding | Sev | Disposition |
|---|---|---|---|
| 1 | Invite "accepted" = link opened, not password set (prefetching scanners) | High | Fixed 0129fef: `tenant_admin_invite_states` (password set / SSO) |
| 2 | Status action shares the 10/min invite budget | Medium | Fixed 0129fef: own bucket (60/min) |
| 3 | Grid vs SQL disagree when sessions overlap | Medium | Fixed 0129fef: later year wins, as in SQL; test |
| 4 | Resend 429 message lost; raw error text shown | Medium | Fixed 0129fef: key allow-list, 429 key |
| 5 | ArrowUp/Down move ±7 days, not the row above | Medium | Fixed 0129fef: same column; test |
| 6 | Status: one getUserById per admin, failures dropped | Low | Fixed 0129fef: one RPC |
| 7 | Previous/next settings fetched needlessly / late | Low | Fixed 0129fef |
| 8 | Cell names recomputed every keystroke | Low | Fixed 0129fef: memoised |
| 9 | Duplicate date helpers | Low | Fixed aba4c75 (`src/lib/ethiopian-date.ts`) |
| 10 | Template button text, `img9` typo, expiry text | Low | Fixed 0129fef (expiry 3600 s verified in production config) |

## Run 2 — `6133b48..0129fef`
| # | Finding | Sev | Disposition |
|---|---|---|---|
| 1 | Page shows "No calendar" while next year's settings load | Medium | Fixed aba4c75 |
| 2 | GoTrue cooldown 429 not detected on recovery | Medium | Fixed aba4c75 (`status === 429`, cooldown wording) |
| 3 | SSO admins shown pending, sent a password link | Medium | Fixed aba4c75 (`is_sso_user` → accepted, 409) |
| 4 | Recovery email uses the reset template | Low | Accepted: production recovery template is branded and links to `/accept-invite` (verified) |
| 5 | Selection ring hides the focus ring | High (a11y 2.4.7) | Fixed aba4c75 (overlay); browser-verified |
| 6 | Long button label overflows | Low | Fixed aba4c75 ("Accept & Set Password") |
| 7 | 429 copy says "an hour" for 1-minute limits | Low | Fixed aba4c75 (neutral wording) |
| 8 | Unknown drop reason prints "()" | Low | Fixed aba4c75 |
| 9 | Date helpers belong in the lib | Low | Fixed aba4c75 |
| 10 | Resend reads all admins to find one | Low | Fixed aba4c75 (`p_user`) |

## Run 3 — `0129fef..ca0d8d3`
| # | Finding | Sev | Disposition |
|---|---|---|---|
| 1 | Invite action still on the narrow 429 regex | Medium | Fixed 67f541a |
| 2 | Next-year settings error not a load failure (wrong totals) | Medium | Fixed 67f541a; test (68fb454) |
| 3 | Refused resend still costs an hourly slot | Low | Backlog (2026-10-18 rows), WP-14 |
| 4 | invite-staff / provision 429 detection | Low | invite-staff fixed 68fb454; provision pre-existing → backlog |
| 5 | `fromIsoDate` appends to an instant | Medium | Fixed 67f541a → strict parser 68fb454/23a9fa1/6c0f215; tests |
| 6 | Hamle-15 assertion weakened | Medium | Fixed 67f541a → data-based 23a9fa1/6c0f215; mutation-proven |
| 7 | Test flag not reset in afterEach | Low | Fixed 67f541a |
| 8 | Log redaction copied, not shared | Low | Fixed 67f541a (`_shared/auth-errors.ts`) |
| 9 | Attendance page duplicates date helpers | Low | Pre-existing → backlog |
| 10 | Grid aliases | Low | Fixed 67f541a |

## Run 4 — `ca0d8d3..67f541a`
| # | Finding | Sev | Disposition |
|---|---|---|---|
| 1 | invite-staff / provision log raw Auth errors (PII) | Medium (pre-existing) | Fixed 68fb454 (both) |
| 2 | Next-year-only failure untested | Medium | Fixed 68fb454 (test; mutation killed) |
| 3–5 | `fromIsoDate` instant vs EthDate, malformed input, test gap | Medium | Fixed 68fb454/ccc2b40; tests |
| 6 | `logSafeError` can throw on odd values (skips rollback) | Medium | Fixed 68fb454 |
| 7 | onboard-tenant 429 → 500 | Low | Fixed 68fb454 |
| 8 | Hamle expectation read from the engine | Medium | Fixed 68fb454 → data-based 23a9fa1 |

## Run 5 — `67f541a..68fb454`
| # | Finding | Sev | Disposition |
|---|---|---|---|
| 1 | Wider 429 check returns from provision's loop without rollback | High (regression) | Fixed ccc2b40: provision keeps its original branch; its rollback gap is pre-existing → backlog |
| 2 | onboard 429 after an incomplete rollback | Medium | Fixed ccc2b40 (500) |
| 3 | INSA doc overstates redaction coverage | Low | Fixed ccc2b40 (exact list); impersonate-user / complete-sso-login pre-existing → backlog |
| 4 | onboard rollback logs raw messages | Medium | Fixed ccc2b40 |
| 5–6 | zone-less timestamps, impossible dates | Medium | Fixed ccc2b40 |
| 7 | Rate limit by English wording only | Low | Fixed ccc2b40 (GoTrue codes; Auth errors only) |
| 8 | Hamle hard-codes 2019 | Low | Fixed 23a9fa1 |
| 9 | 429 message copied | Low | Fixed ccc2b40 (`RATE_LIMITED_MESSAGE`) |
| 10 | invite-tenant-admin rollback deleteUser unguarded | Medium | Fixed ccc2b40 → `rollbackInvitedUser` 6c0f215 |

## Run 6 — `67f541a..ccc2b40` and `ccc2b40..23a9fa1`
| # | Finding | Sev | Disposition |
|---|---|---|---|
| 1 | invite-staff case-sensitive duplicate check → rollback deletes another school's pending account | High (pre-existing) | Fixed 23a9fa1/6c0f215 (`_shared/invite-guard.ts`, Deno-tested) |
| 2 | Duplicate-check query error ignored → same deletion | High (pre-existing) | Fixed 6c0f215 (fails closed, both functions) |
| 3 | Concurrent invite → rollback deletes the other account | Medium (pre-existing) | Fixed 6c0f215 (delete only when the profile is ours or absent) |
| 4 | invite-staff partial rollback leaves the profile | Medium (pre-existing) | Fixed 6c0f215 (`ownsProfile`) |
| 5 | `±hhmm` / microseconds not portable (Safari) | Medium | Fixed 6c0f215 (normalised); test |
| 6 | EthDate parses zone-less timestamps as local | Low | Backlog (no zone-less timestamps reach EthDate today) |
| 7 | `addDaysIso` throws on bad input | Medium | Fixed 23a9fa1 (returns "") |
| 8 | Status not logged for Auth errors | Low | Fixed 23a9fa1 |
| 9 | LIKE escape copied in three functions; no `lower(email)` index | Low | Backlog |
| 10 | Refused resend costs a slot | Low | Backlog |

## Run 7 — `23a9fa1..6c0f215` and `6c0f215..aaec819`
| # | Finding | Sev | Disposition |
|---|---|---|---|
| 1 | Orphan auth account (no profile) cannot be invited | Low | Backlog: remove in the dashboard; owner action lists the two production orphans |
| 2 | 60 s window lets a concurrent invite adopt a fresh account | Low | Backlog; no data exposed (REL-TI-R3-01) |
| 3 | GoTrue emails an existing account before the refusal | Low | Inherent to `inviteUserByEmail`; backlog |
| 4 | onboard-tenant: fail-open duplicate check | Medium (pre-existing) | Fixed aaec819 |
| 5 | Lost insert response treated as "not ours" | Low | Backlog |
| 6 | Handler wiring (the throws, the 400, `ownsProfile`) has no handler-level test | Low | Every decision is in tested helpers (`createdByThisCall`, `rollbackInvitedUser`, `escapeLike`, `isRateLimited`, `logSafeError`, `invite-state`); the handlers call them in one line each. Handler extraction for tests is backlog (WP-14) |
| 7 | `createdByThisCall` duplicates onboard's `createdByThisRun` | Low | Backlog |
| 8 | invite-staff staff_no check fail-open | Low (pre-existing) | Fixed aaec819 |
| 9 | Hamle comment stale | Low | Fixed aaec819 / 61836e2 |
| 10 | onboard-tenant can adopt an orphan as the new school's admin; tenant inserted before the invite | Low (pre-existing; the orphan's owner is the invited address) | Backlog (6) |
| 11 | Concurrent duplicate staff_no → 500 after the email | Low (pre-existing) | Backlog |

**Open at release:** no High or Medium introduced by this release. Deferred
items are Low or pre-existing, each in `audit/backlog.md` (2026-10-18 rows)
with its reason.
