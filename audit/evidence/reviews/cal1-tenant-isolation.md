# Release tenant-isolation review (tenant-isolation-review skill), 2026-10-18

Scope: 310820a → release candidate (calendar engine `20261008000001`,
invite state `20261017000001`, `invite-tenant-admin`, `onboard-tenant`,
calendar UI query keys, `TenantDetailPage`).

**Verdict: PASS.**

## Surfaces (§1–2)
| Surface | Who reaches it | Tenant decided by | Rule check |
|---|---|---|---|
| `school_calendars` | authenticated | `get_tenant_id_for_user(auth.uid())` policy; restrictive `events` gate; drafts only with `academic_calendar:update` | FORCE RLS; no client writes (revoked, no write policies) |
| `school_calendar_entries` | authenticated | own tenant + EXISTS visible calendar; gate; composite FK `(calendar_id, tenant_id)`; guard refuses a mismatch | as above |
| authority tables, day types, holiday rules, authorities | authenticated (read) | platform data, no tenant; authority drafts super_admin only | no client writes |
| `create_school_calendar` (definer) | authenticated | `auth.uid()`; permission + module; recreate needs update | allow-listed; search_path pinned |
| `calendar_year_settings` and the 4 functions through it (invoker) | authenticated | refuses another school's `p_tenant` unless trusted role / super_admin | |
| `ec_*` helpers | authenticated / owner only | pure | |
| `tenant_admin_invite_states` (definer) | service_role only | `p_tenant` from a super_admin-only Edge Function; refuses untrusted roles | no address/hash/token |
| `invite-tenant-admin` status/resend | super_admin (requireRole) | body `tenant_id`, profile re-checked `.eq(tenant_id).eq(role)`; RPC scoped | Auth errors logged by code only (REL-TI-04 fixed) |
| calendar query keys | browser | `[tenant_id, user_id]` scope (page test) | |

## Probes and assertions (§3–4)
`supabase/tests/rls/academic_calendar_engine.sql` (94) and
`tenant_admin_invite_states.sql` (11): B reads 0 of A's calendars and entries;
the tenant predicate alone (platform admin past the gate; draft and published);
B cannot insert/update/delete A's calendars or entries; teacher without update
sees no draft or its entries; school without `events` reads nothing; every
`p_tenant` function refuses B (`calendar_year_settings`, `calendar_day_status`,
`effective_calendar_entries`, `calendar_days`, `instructional_days`); the guard
refuses re-homing; the composite FK refuses a mismatch on its own.

Mutation log: `audit/evidence/calendar/mutations-20261018.txt` — all 16
mutations killed; faked EC years 2020/2021/2030/2031 pass. One documented
equivalent mutant (entries' own predicate/gate are implied by the calendar's).

## Guards (§5)
`audit/evidence/calendar/harness-20261018.txt`: 116 migrations, all suites
(cross_tenant_matrix, catalog_rls_coverage, catalog_definer_security,
catalog_module_gate, catalog_storage_policies); app-rpc-grants 0.

## Reviewers (§6)
- `rls-tenant-isolation-reviewer` (`cal1-rlsti.md`): PASS, live two-tenant probes.
- `tenant-isolation-auditor` (`cal1-relti.md`): FAIL as not verifiable
  (Postgres went down mid-audit). Its findings are fixed: REL-TI-02 (FK
  assertion), REL-TI-03 (client-write probes), REL-TI-04 (log redaction),
  REL-TI-05 (direct p_tenant refusals); the mutations it predicted were run
  here (all killed). Re-dispatched on the release commit for confirmation.
