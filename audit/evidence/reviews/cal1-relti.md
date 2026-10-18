REVIEWER: REL-TI (tenant-isolation-review, read-only, worktree /home/user/rv-ti at aba4c75)
WP: Release (310820a → aba4c75): 20261008000001_academic_calendar_engine.sql, 20261017000001_tenant_admin_invite_states.sql, invite-tenant-admin, onboard-tenant, src/features/academic-calendar/**, TenantDetailPage.tsx
VERDICT: FAIL. This is mostly "not verifiable", not a confirmed leak. Postgres went down partway through the audit, so the two-tenant probes and the mutation runs never happened.

**Postgres is down.** The socket at /tmp/pgsock:5433 refuses connections. No postgres process is running, and only a stale socket and lock file from Oct 17 22:45 remain. I did not restart it, as you asked. My database `reti_review` still exists on that cluster. Please drop it once the server is back (`drop database reti_review`).

What I got done before it went down: a full harness run on `reti_review`, which was green (116 migrations applied, 68/68 suites; academic_calendar_engine 79/79 and tenant_admin_invite_states 11/11). I also finished the static rule check of every surface. What I did not get to: `app-rpc-grants.py`, the two-tenant probes (§3) and the mutations (§4).

FINDINGS
- **REL-TI-01, blocker (not verifiable).** Location: environment (/tmp/pgsock:5433).
  - Evidence: no probes ran as tenant A vs tenant B, as a teacher without academic_calendar:update, as a school without the events module, or as anon. `app-rpc-grants.py` did not run.
  - The mutations you asked for are also missing from the implementer's own log (audit/evidence/calendar/mutations-20261017.txt): school_calendars select policy → `using(true)`, dropping the module gate on school_calendars, removing the p_tenant refusal in calendar_year_settings, removing the guard's tenant check, removing the composite FK, and making the guard re-home tenant_id. That log only covers entries_select_true, auth_entries_select_true, the guards and the invite-state mutations.
  - Reference: SKILL.md §3–§5.
  - Fix: bring Postgres back, then re-run §3–§5 (or re-dispatch me).
- **REL-TI-02, major (predicted mutation survivor, from reading the code; not run).** Location: supabase/migrations/20261008000001_academic_calendar_engine.sql:273-274 and supabase/tests/rls/academic_calendar_engine.sql:155-158.
  - Evidence: the only cross-tenant entry test expects `22023 invalid_calendar`, which comes from the guard (migration :666-668). If the composite FK `school_calendar_entries_calendar_fkey (calendar_id, tenant_id)` is dropped on its own, the guard still raises 22023, and no assertion checks the FK. That mutation should survive.
  - The other two predicted outcomes: removing only the guard's tenant check makes the FK fire `23503` instead, so it should be killed. Making the guard re-home tenant_id lets the insert succeed, so it should also be killed.
  - Reference: SKILL.md §2 (child rows need a composite FK) and §4 (remove the composite FK and an assertion must go red).
  - Fix: add an assertion that would catch the FK's removal. Either check the constraint in `pg_constraint` (`contype='f'`, both columns), or disable the guard trigger and expect `23503` on an entry that points at another school's calendar.
- **REL-TI-03, major (test gap; the code is safe today).** Location: academic_calendar_engine.sql (no such probes); migration :330-335.
  - Evidence: the suite never checks that a client cannot write `school_calendars` (INSERT, UPDATE or DELETE). For entries it only checks one own-school INSERT (test at :141). There is no tenant-B UPDATE or DELETE probe against A's calendars or entries.
  - Today the REVOKE of insert/update/delete/truncate from authenticated blocks all of this, and there are no write policies. But a later grant plus a permissive policy would pass every test.
  - Reference: SKILL.md §4 item 3; CLAUDE.md "no client can write where the design says only an RPC writes".
  - Fix: as B, add throws_ok 42501 (or 0 rows affected) for INSERT, UPDATE and DELETE on A's school_calendars and school_calendar_entries.
- **REL-TI-04, minor.** Location: supabase/functions/invite-tenant-admin/index.ts:165 (reached from :108, :118 and :153).
  - Evidence: the catch logs the raw `(err as Error).message`. That includes the AuthApiError thrown by `inviteUserByEmail`/`resetPasswordForEmail`, and the new resend path adds two more such throws. GoTrue messages can quote the address, for example "Email address \"…\" is invalid" or the not-authorized error from the default SMTP sender.
  - onboard-tenant/index.ts already logs Auth errors by code only, for exactly this reason (privacy review, WP-01 round 3).
  - Reference: SKILL.md §2 (logs carry ids, not PII).
  - Fix: use the same Auth-error redaction as onboard-tenant.
- **REL-TI-05, minor (test gap).** Location: academic_calendar_engine.sql:189-194.
  - Evidence: the p_tenant refusal is only asserted indirectly, through effective_calendar_entries, calendar_days and instructional_days. Those still catch its removal (predicted killed), but `calendar_year_settings(…, A)` and `calendar_day_status(…, A)` called as B have no assertion of their own.
  - Fix: add a direct throws_ok for each.
- **REL-TI-06, info.** Location: migration :465-468.
  - Evidence: a super_admin may pass any p_tenant to the invoker calendar functions, by design. The school_calendars select policy has no super_admin branch, so other schools' calendars and entries stay invisible to them. Only session dates read through tenants and academic_years RLS could come back.
  - Fix: none needed; record it as the intended platform access.
- **REL-TI-07, info.** Location: src/features/platform/TenantDetailPage.tsx:155-170.
  - Evidence: on this super_admin-only page, `.eq('tenant_id', id)` is a platform filter, not the security boundary. Its query keys (`["tenant-admins", id]`) leave out the user id, but the cache is cleared on sign-out and session loss (useSession.ts:26, PlatformNav.tsx:50, DashboardShell.tsx:280).
  - Fix: none needed.

CHECKED (statically, every surface)
- **Tables.** All 7 have RLS enabled and forced (:284-297).
  - school_calendars and school_calendar_entries: tenant_id is NOT NULL with an FK to tenants. Select policies use the `get_tenant_id_for_user(auth.uid())` predicate. Drafts are hidden unless the user holds academic_calendar:update, and entries follow their calendar through an RLS'd EXISTS. Both have a restrictive `has_module(tenant_id,'events')` gate.
  - The 5 platform tables carry no tenant data and are read-only to clients. Authority drafts are hidden from schools.
  - Client writes are revoked; anon has nothing.
- **Guard and composite FK.** The entries guard refuses a tenant mismatch and refuses a change of calendar_id/tenant_id (:663-668). The composite FK is in place (:273-274).
- **create_school_calendar.** SECURITY DEFINER, search_path pinned, revoked then granted to authenticated, and listed in definer_allowlist.sql:46. The tenant comes from auth.uid(); it checks the permission and the module; recreating a draft also needs update.
- **Invoker functions.** calendar_year_settings refuses an end user's foreign p_tenant using the trusted-role allow-list. effective_calendar_entries, calendar_days, calendar_day_status and instructional_days all go through it. The ec_* helpers are pure and immutable.
- **tenant_admin_invite_states.** SECURITY DEFINER, search_path pinned, revoked from public/anon/authenticated, granted to service_role only. It refuses non-trusted roles even with EXECUTE and returns no email, hash or token. Its suite covers tenant scoping and p_user scoping.
- **invite-tenant-admin.** requireRole(["super_admin"]) reads the role from public.users. status is scoped by `p_tenant`. resend re-checks the profile (`.eq id`, `.eq tenant_id`, `.eq role school_admin`) and the state RPC before calling getUserById. Responses carry only user_id, pending and invited_at. The success log holds ids only.
- **onboard-tenant.** Only the period-seed refactor changed, and it is tenant-scoped (`tenant.id` is the same value as `tenantId`).
- **Calendar query keys.** They include `[tenant_id, user_id]` (AcademicYearGridPage.tsx:76-90). The unscoped keys (day-types, authorities) hold platform reference data only.
- **Earlier harness run.** Full and green on `reti_review` before the outage (output in /tmp/reti-harness.txt).

Mutation predictions (from reading the code, not run, so none counts as a pass):
- Killed: policy → `using(true)` on school_calendars and on entries, dropping either module gate, removing the p_tenant refusal, removing the guard's tenant check, re-homing tenant_id.
- Survivor: dropping the composite FK alone (REL-TI-02).