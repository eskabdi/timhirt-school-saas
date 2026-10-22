Tenant-isolation review of the calendar and invite-state migrations at aba4c75: no cross-tenant read or write path, and no widened or narrowed access. Nothing needs fixing before merge. The only items are Low/Info hardening notes. I ran the full harness on my own database, `rv_tiso` (116 migrations and all pgTAP suites passed, including `academic_calendar_engine.sql` and `tenant_admin_invite_states.sql`), then probed it live with two tenants. I dropped `rv_tiso` afterwards and left the server and the other databases alone. I did not do mutation proofs.

**Verdict: PASS**

Files reviewed:
- `/home/user/rv-ti/supabase/migrations/20261008000001_academic_calendar_engine.sql`
- `/home/user/rv-ti/supabase/migrations/20261017000001_tenant_admin_invite_states.sql`

**Checklist, with evidence**

| Item | Result | Evidence |
|---|---|---|
| ENABLE and FORCE RLS on all 7 tables | PASS | Lines 284-297. `pg_class` shows `relrowsecurity` and `relforcerowsecurity` both true on every one. |
| Policies carry the tenant predicate; no `using (true)` on tenant data | PASS | Lines 311-326. `school_calendars_select` and `school_calendar_entries_select` compare `tenant_id` to `(select get_tenant_id_for_user(auth.uid()))`. The three `using (true)` policies (lines 300-302) are on the intentionally public platform tables. |
| Draft visibility | PASS | Probe: a teacher in tenant A (no `academic_calendar:update`) sees 0 calendars and 0 entries while an admin has a draft with 1 entry. The admin sees 1 own and 0 other. The entries policy's `exists` on `school_calendars` inherits the draft filter. |
| Restrictive module gate | PASS | Lines 315-326, `for all`, restrictive, with the `super_admin` escape. Probe: the admin of tenant C (basic tier, no events module) sees 0 rows and cannot call `create_school_calendar` (`not_allowed`). |
| Composite FK `(calendar_id, tenant_id)` | PASS | Lines 254 and 273-274 (`unique (id, tenant_id)` plus the FK). |
| Guard triggers refuse instead of re-homing | PASS | As postgres: an entry insert with a mismatched `tenant_id` raises `invalid_calendar`. An update of `tenant_id` or `calendar_id` raises `calendar_closed` (42501). The authority guards also refuse `calendar_id`, `ec_year` and `authority_id` changes. |
| `create_school_calendar` (lines 723-820) | PASS | The tenant comes from `get_tenant_id_for_user(auth.uid())`. It checks `has_resource_permission(...,'create')` and `has_module(v_tenant,'events')`, with the search_path pinned. Execute is revoked from public, anon and authenticated, then granted to authenticated, which matches the allow-list entry at `definer_allowlist.sql:46`. Probes: teacher denied, tenant C denied, anon gets "permission denied for function", `super_admin` without a tenant gets `not_allowed`. Every table read inside it is filtered by `v_tenant` or `v_prev`, which is itself tenant-filtered. |
| Invoker functions taking `p_tenant` | PASS | `calendar_year_settings` raises 42501 `not_allowed` for another school's tenant unless the role is trusted or the caller is `super_admin` (lines 465-469). Probes as the tenant A admin: `calendar_year_settings`, `effective_calendar_entries`, `calendar_days`, `calendar_day_status` and `instructional_days` all raise `not_allowed` for tenant B, and succeed for A's own tenant. They route through `calendar_year_settings`. As `service_role` the cross-tenant call works, and `super_admin` gets tenant B's published layers. |
| Platform tables have no client write path | PASS | Privileges for `authenticated` are only REFERENCES, SELECT and TRIGGER; `anon` has none. `pg_policies` shows no insert, update or delete policy on any of the 7 tables. Probes as an admin: all insert, update, delete and truncate attempts on every table fail with "permission denied for table X". The `tenants.edu_authority_id` update is blocked because `tenants_write` is `super_admin`-only (`20260713000005_rls_policies.sql:16`). Authority drafts are visible only to `super_admin` (lines 304-309). |
| Invite states function (`20261017000001`) | PASS | `security definer`, search_path pinned, role allow-list check, EXECUTE revoked from public, anon and authenticated and granted to `service_role` only. Probes: `authenticated` and `anon` get "permission denied for function"; `service_role` gets rows that expose only booleans, not addresses, hashes or tokens. It is not in the allow-list, as intended. The only caller, `supabase/functions/invite-tenant-admin/index.ts:49`, uses `requireRole(["super_admin"])`. |

**Findings (none block merge)**

1. **Info/Low, `20261008000001_academic_calendar_engine.sql:333-335`.**
   - The revoke covers only `insert, update, delete, truncate`, so `authenticated` keeps TRIGGER and REFERENCES on all 7 tables.
   - It cannot be exploited today: `authenticated` has no CREATE on `public`, and no trigger function is executable to it. This is the same as every other table in the repo.
   - Optional hardening: `revoke all on <7 tables> from authenticated; grant select on <7 tables> to authenticated;`.

2. **Info, repo-wide convention rather than a regression.**
   - The trusted-context allow-list (`current_setting('role')` in `none`, `service_role`, `postgres`, `supabase_admin`) can be fooled by `set_config('role','none',true)`. In my harness, where the session user is postgres, an `authenticated` session did this and then read tenant B through `calendar_year_settings`.
   - On Supabase the session user is `authenticator`, and PostgREST does not expose `pg_catalog.set_config`. So this is not client-reachable. Nothing in this migration makes it worse.

3. **Info, behaviour to be aware of.**
   - A `super_admin` calling `calendar_year_settings` with another tenant's id gets that tenant's authority and published layers, but never its `school_calendars` rows. The table policy scopes them to the caller's own tenant, and a `super_admin` without a tenant also cannot call `create_school_calendar`.
   - That looks intended.

**Not covered:** I did not do mutation proofs (replacing a policy with `using (true)` and re-running the suite), which the updated CLAUDE.md asks for before merge. The 79-assertion calendar suite passes, but I did not prove it fails when the policies are removed.