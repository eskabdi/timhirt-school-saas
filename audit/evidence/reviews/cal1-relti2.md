REVIEWER: REL-TI (tenant-isolation-review, round 2, read-only, worktree /home/user/rv-ti at ca0d8d3)
WP: Release 310820a → ca0d8d3. It covers 20261008000001_academic_calendar_engine.sql, 20261017000001_tenant_admin_invite_states.sql, the invite-tenant-admin and onboard-tenant Edge Functions, src/features/academic-calendar/** and TenantDetailPage.tsx.

VERDICT: PASS. I found no cross-tenant read or write path. I re-ran SKILL.md §3–§5 myself on my own database `reti_r2`, which is now dropped; I did not stop the server. 27 mutations: 25 turned an assertion red, one only weakens a super_admin read path and none of the 25 do, and one survived. The survivor is dropping the tenant predicate on `school_calendar_entries_select` alone. I am treating it as an equivalent mutant rather than a test gap, with the evidence below. If you apply "a survivor is a FAIL" literally, that one line flips the verdict, so I'm flagging it for your call.

**Gates (all green)**
- `run.sh`: 116 migrations, 68/68 suites. `academic_calendar_engine` 94/94, `tenant_admin_invite_states` 11/11, `cross_tenant_matrix` 7/7.
- Catalog guards: `catalog_definer_security` 10/10, `catalog_rls_coverage` 2/2, `catalog_storage_probe` 14/14. `catalog_module_gate` (8 pass + 1 open TODO) and `catalog_storage_policies` (19 pass + 1 open TODO) carry the existing WP-06/WP-05 TODOs; no calendar table is a new offender.
- `app-rpc-grants.py`: 28 app RPCs, 0 findings.

**Two-tenant probes (my own pgTAP file, rolled back, 49/49 pass)**
- **Tenant B vs tenant A:**
  - B reads 0 of A's calendars and entries, whether filtered by tenant or by calendar id.
  - Insert, update and delete on A's calendars and entries all fail with 42501.
  - `calendar_year_settings`, `effective_calendar_entries`, `calendar_days`, `calendar_day_status` and `instructional_days` called with p_tenant=A all raise `42501 not_allowed`.
  - B's effective calendar shows none of A's suppression rows and no Oromia entries.
  - `create_school_calendar` as B touches only B; A's draft is unchanged and A's calendar holds no foreign entries.
  - B cannot read A's tenants row.
  - `has_resource_permission(A's admin)` asked by B returns null, i.e. it answers only for the caller.
- **Teacher without `academic_calendar:update`:** cannot see the draft or its entries, directly or through the RPCs (including the settings draft id), and cannot create a calendar.
- **School without the events module:** reads no calendar or entries (directly or through the RPCs) and cannot create one.
- **super_admin:** sees no school calendars or entries. Naming A in `calendar_year_settings` or `effective_calendar_entries` returns no school calendar id and no school entries. Cannot create a calendar.
- **anon:** gets 42501 on the tables, the RPCs, `create_school_calendar` and `tenant_admin_invite_states`.
- **Signed-in user calling `tenant_admin_invite_states`:** 42501.

**Mutations.** Each ran as `begin; <mutation>; \i suite`. Text-replacement mutations abort if the replacement changed nothing; none did. The unmutated baseline is 94/11/49 green.

| # | Mutation | Result | What caught it |
|---|---|---|---|
| M01 | school_calendars select → `using(true)` | killed | 4 assertions |
| M02 | entries select → `using(true)` | killed | #36, #48 |
| M03 | drop the module gate on school_calendars | killed | #56 |
| M04 | drop the module gate on entries | killed | `catalog_module_gate` #1 (ratchet); both suites and my probes stay green |
| M05 | both select policies `using(true)` and both gates dropped | killed | 11 assertions |
| M06 | drop the school_calendars tenant predicate only | killed | #60 |
| **M07** | **drop the entries tenant predicate only** | **survived** | nothing: both suites, my probes and every catalog suite stay green |
| M08 | remove the p_tenant refusal in `calendar_year_settings` | killed | #45, #46, #49, #50, … |
| M09 | drop the composite FK only | killed | #32 |
| M10 | remove the guard's tenant check | killed | #31 |
| M11 | guard re-homes tenant_id | killed | #31 |
| M12/M12b | FK dropped plus guard check removed, or plus re-home | killed | #31, #32 |
| M13 | `create_school_calendar` without the module check | killed | #57 |
| M14 | `create_school_calendar` without the permission check | killed | #18 |
| M15 | `authority_calendars` select → `using(true)` | killed | #14, #15 |
| M16 | invite states without `p.tenant_id = p_tenant` | killed | #1, #2, #4 |
| M17 | invite states without the role refusal | killed | #10 |
| M18/M18b | client writes granted, with permissive or tenant-scoped policies | killed | 10 / 7 assertions |
| M19 | entries select without the parent EXISTS | killed | #36 |
| M20 | invite states without the school_admin filter | killed | #1 |
| M21 | invite states ignore p_user | killed | #3, #4 |
| M23 | `calendar_year_settings` trusts `authenticated` | killed | 5 assertions |
| M24 | grant invite states to authenticated | killed | #8 |
| M25 | grant calendar RPCs to anon | killed | #68 |

M22 (dropping the super_admin branch in `calendar_year_settings`) narrows access rather than widening it. No suite assertion catches it; only my probe errors.

**Why M07 is equivalent.** For an end user, the restrictive gate's `has_module(tenant_id, …)` answers only for the caller's own tenant, so the gate already acts as a tenant predicate. For everyone, the parent EXISTS plus the composite FK binds the entry to a calendar the caller can see. For super_admin, the parent EXISTS falls back on the school_calendars tenant predicate, which M06 shows is tested.

I tried to kill M07 the same way your test #32 isolates the FK: I dropped the FK, disabled the guard, inserted an A-tenant entry under B's published calendar and probed as B. B still read 0 rows, because the gate blocks it. Removing the predicate together with the gate is killed by your entries_select_and_gate_true mutation, and M05 is killed by my run too. This agrees with your log's note that it is equivalent.

FINDINGS
- **REL-TI-R2-01 (info).** Location: supabase/migrations/20261008000001_academic_calendar_engine.sql:330-333 (the entries select policy). Evidence: M07 survives, explained above.
  - Fix (optional): if you want even this layer to have its own assertion, add a test that drops the FK and the entries gate inside the test transaction, inserts a mismatched row and expects B to read 0.
- **REL-TI-R2-02 (info).** Location: migration :476-479. A super_admin may pass any p_tenant to the invoker calendar functions, by design. The school calendar and its entries stay hidden; only the session dates, read through the tenants and academic_years RLS, can come back.
- **REL-TI-R2-03 (minor, not verifiable here).** This worktree has no Deno and no node_modules, so I could not run `supabase/functions/_shared/invite-state.test.ts` or the vitest suites.
  - I read both. The query-key test checks `["academic-calendar", tenant, user, …]` for the settings, entries and can-create queries (AcademicYearGridPage.test.tsx:226-229).
  - The invite-state helpers are pure functions and the Edge Function uses them unchanged.
  - Fix: let CI run `deno test` and `vitest` on ca0d8d3 before deploy.

Your round-1 fixes are confirmed:
- **REL-TI-02:** test #32 kills M09.
- **REL-TI-03:** tests #41–#44 and the insert probe; M18/M18b are killed.
- **REL-TI-04:** invite-tenant-admin/index.ts:163-166 now logs Auth errors by code only, as onboard-tenant does.
- **REL-TI-05:** tests #45 and #46.

CHECKED
- **Tables:** RLS enabled and forced on all 7 (checked in the catalog). tenant_id is NOT NULL with an FK on both school tables. Select policies use `get_tenant_id_for_user(auth.uid())`, and both school tables have a restrictive events gate. Write privileges are revoked: authenticated has only `rxt` and anon has nothing.
- **Functions:**
  - `create_school_calendar` is SECURITY DEFINER with search_path pinned, executable by authenticated and service_role only, and is in the allow-list.
  - `tenant_admin_invite_states` is SECURITY DEFINER with search_path pinned and executable by service_role only. It refuses untrusted roles and returns no email, hash or token.
  - The new `ec_same_date_next_year` and the four guard functions are executable by service_role only.
  - The invoker RPCs are executable by authenticated, not anon, and have search_path pinned.
- **Edge Functions:**
  - invite-tenant-admin requires super_admin.
  - status is scoped by `p_tenant`.
  - resend re-checks the profile with `.eq id`, `.eq tenant_id` and `.eq role school_admin`, plus the state RPC scoped by tenant and user, before `getUserById`.
  - Responses carry only `{user_id, pending, invited_at}` or `{user_id, resent}`; logs carry ids and an auth error code.
  - onboard-tenant only had the period seed refactored, still scoped to the new tenant.
- **Client:** calendar query keys are scoped to tenant and user, and the cache is cleared on sign-out. The platform page is super_admin-only.

Files are in /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/reti/:
- harness.txt
- probe.sql and probe.out
- mutations.log
- the mut/ folder (the 27 mutation files)
- killtest.sql (the M07 kill attempt)