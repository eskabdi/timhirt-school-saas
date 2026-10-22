REVIEWER: REL-TI (tenant-isolation-review, final pass, read-only, worktree /home/user/rv-ti at 61836e2)
WP: Release candidate aaec819 plus records (61836e2). Delta since my round-3 PASS on 6c0f215: `git diff 6c0f215..61836e2 -- supabase src`.

VERDICT: PASS for 61836e2. No tenant surface changed, the harness is green, and every key isolation mutation I re-ran still turns a test red.

**What the delta touches (no tenant surface changed)**
- Only three files changed under supabase/ and src/. Nothing changed in supabase/migrations, supabase/security, the shim, scripts or src.
- **supabase/functions/invite-staff/index.ts:88-91:** the staff_no duplicate check now throws on a query error. The query is unchanged and still scoped `.eq("tenant_id", ctx.tenantId)`, with the tenant taken from requireRole.
- **supabase/functions/onboard-tenant/index.ts:49-54:** the duplicate-email check now uses the shared `escapeLike` (same escaping as before) and throws on a query error.
  - This is a super_admin-only function, and the check still covers every tenant on purpose so an existing account is never adopted.
  - A query error now leads to no invite; before, it was treated as "no duplicate".
- **supabase/tests/rls/academic_calendar_engine.sql:356-359:** a comment edit only; the assertion text is unchanged.
- Read-side and write-side scoping are unchanged, and nothing new reaches another tenant's rows. Both code changes only make things fail closed.

**Gates** (my own DB `reti_r4`, now dropped; server not stopped)
- `run.sh`: 116 migrations, 68/68 suites. `academic_calendar_engine` 94/94, `tenant_admin_invite_states` 11/11, `cross_tenant_matrix` 7/7.
- Catalog guards: `catalog_definer_security` 10/10, `catalog_rls_coverage` 2/2, `catalog_storage_probe` 14/14. `catalog_module_gate` 8/9 and `catalog_storage_policies` 19/20, each with only its existing WP-06/WP-05 TODO open.
- `app-rpc-grants.py`: 28 app RPCs, 0 findings.
- My 49 two-tenant probes (tenant B vs A, teacher, school without the events module, super_admin, anon): 49/49 pass on the unmutated baseline.

**Mutation spot-check** (no replacement was a no-op; each turned at least one assertion red)

| Mutation | Suite result | My probes |
|---|---|---|
| school_calendars select → `using(true)` | 4 red | 5 red |
| school_calendar_entries select → `using(true)` | 2 red | 2 red |
| drop the school_calendars module gate | 1 red | 2 red |
| drop the entries module gate | caught by `catalog_module_gate` #1 | – |
| drop the school_calendars tenant predicate only | 1 red | 1 red |
| remove the p_tenant refusal in `calendar_year_settings` | 5 red | 5 red |
| `calendar_year_settings` trusts `authenticated` | 5 red | 5 red |
| drop the composite FK | #32 red | – |
| remove the guard's tenant check | #31 red | – |
| guard re-homes tenant_id | #31 red | – |
| `create_school_calendar` without the module check | #57 red | 1 red |
| `create_school_calendar` without the permission check | #18 red | 1 red |
| client write grants with permissive policies | 10 red | 9 red |
| entries select without the parent EXISTS | 1 red | 1 red |
| grant calendar RPCs to anon | #68 red | – |
| invite states without `p.tenant_id = p_tenant` | 3 red | – |
| invite states without the role refusal | 1 red | – |
| grant invite states to authenticated | 1 red | – |

FINDINGS (all carried over; nothing new)
- **REL-TI-R2-01 (info):** dropping only the entries tenant predicate (M07) is still the equivalent mutant explained in round 2. The caller-bound `has_module` gate and the parent EXISTS plus composite FK already enforce the tenant.
- **REL-TI-R3-01 (minor):** the 60 s window in `createdByThisCall` still lets two schools that invite the same address at the same moment race for the new account. No A data is exposed or deleted; at worst A's invite fails, or the person ends up in B, which also invited them.
- **REL-TI-R3-02 (info):** the "already registered" answer still tells a school whether an address exists in any tenant. This was already there before the release.
- **REL-TI-R3-03 (minor, not verifiable here):** there is no Deno in this environment, so the Edge Function unit tests did not run. CI's `deno test` and `deno-check` should pass on 61836e2 before deploy.

CHECKED: the delta file list and the full diff; harness and app-rpc-grants on 61836e2; the unmutated baseline of both suites and my probes; the 18 key isolation mutations above.

Files are in /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/reti/:
- harness4.txt
- mutations4.log
- probe.sql
- the mut/ folder (the mutation files)