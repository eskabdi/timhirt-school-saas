# Tenant-isolation review (`tenant-isolation-review` skill), calendar slice 2a

Commit `9f83575` (diff `7d75a8b..9f83575`); re-checked on the round-2 commit by
the suite and mutation log below.

## Independent reviewers
- `tenant-isolation-auditor`: **PASS**. No Critical/High/Medium. Its probes as
  school B (submit/decide/cancel/save/delete against A, `calendar_year_settings`
  and `effective_calendar_entries` with A's tenant, `school_calendar_pending` on
  A's calendar, direct reads of A's rows, the internal helpers) were all refused
  or returned 0 rows with A's rows present. L-1 (Low): the policy's tenant clause
  and the pending RPC's tenant filter each survive mutation alone because
  `has_module` / the restrictive module gate back them up, and the suite had no
  direct B-reads-A `school_calendars` assertion. **Fixed:** assertion added; M42
  (policy tenant clause + module gate dropped) and M30b (RPC tenant filter +
  module check) are killed. I-2 (flag settable by any session) was fixed by the
  round-2 code review (#5).
- `rls-tenant-isolation-reviewer`: **PASS**. FORCE RLS on all touched tables;
  `submit_approval`/`execute_approval` byte-identical outside the new branches;
  only the allow-listed RPCs executable by `authenticated`; live probes and the
  suite clean. Two Low notes are the intended checker preview and the pending
  RPC's metadata (own school, no payload/maker).

## Rule checks, probes, mutation proof
Every surface (the select policy, `save/delete_school_calendar_entry`,
`school_calendar_pending`, the payload and execute helpers, the guards, the
year-close trigger, the client query keys) is covered in
`supabase/tests/rls/academic_calendar_authoring.sql` (102 assertions:
cross-tenant read/write, other school's calendar/entry/request, module gate,
role without permission, anon, direct table writes) and mutation-proven in
`audit/evidence/calendar/cal2a-mutations-*.txt`. Guards green
(`cal2a-gate-*.txt`: all suites, catalog guards, app-rpc-grants 0 findings).

**Verdict: PASS.**
