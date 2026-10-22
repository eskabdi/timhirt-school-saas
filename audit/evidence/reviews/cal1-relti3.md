REVIEWER: REL-TI (tenant-isolation-review, round 3, read-only, worktree /home/user/rv-ti at 6c0f215)
WP: Release delta ca0d8d3..6c0f215: _shared/invite-guard.ts and _shared/auth-errors.ts, invite-staff, invite-tenant-admin, the onboard-tenant/onboard-rollback/provision-portal-accounts log and 429 changes, and the calendar suite's Hamle assertion. No migration, `supabase/security` or shim changes since ca0d8d3.

VERDICT: PASS. I found no path that lets school B read, write, delete or adopt school A's user or data. The harness is still green and every mutation result matches round 2. The Edge Functions cannot run here, so I read them and probed in SQL what they depend on.

**Harness** (my own DB `reti_r3`, now dropped; server not stopped)
- `run.sh`: 116 migrations, 68/68 suites. `academic_calendar_engine` 94/94, `tenant_admin_invite_states` 11/11, `cross_tenant_matrix` 7/7.
- Catalog guards: `catalog_definer_security` 10/10, `catalog_rls_coverage` 2/2, `catalog_storage_probe` 14/14. `catalog_module_gate` 8/9 and `catalog_storage_policies` 19/20, each with only its existing WP-06/WP-05 TODO open.
- `app-rpc-grants.py`: 28 RPCs, 0 findings.
- My 49 two-tenant probes: 49/49 pass.

**Mutations** (all 27 re-run against the 6c0f215 suites; results identical to round 2)
- Killed: everything except M07 and M22. That includes the policy → `using(true)` mutations, both module gates (M04 via the `catalog_module_gate` ratchet), the tenant predicate on `school_calendars`, the p_tenant refusal and the trust-authenticated variant, the composite FK, the guard's tenant check and the re-home variant, `create_school_calendar`'s module and permission checks, client write grants, the parent EXISTS, all five invite-state mutations, and the anon grant.
- M07 (entries tenant predicate only) still survives and is the documented equivalent mutant from round 2. The end-user gate `has_module(tenant_id)` answers only for the caller's own tenant, and the parent EXISTS plus composite FK covers super_admin.
- M22 (dropping the super_admin branch) narrows access, so it is not an isolation mutation.

**Edge Function code review**
- **invite-staff:**
  - The tenant comes only from `ctx.tenantId` (requireRole school_admin/hr_officer). It is never read from the body.
  - The duplicate check runs over every tenant's users, ignores case, escapes LIKE wildcards, and stops the invite if the lookup itself errors.
  - An account GoTrue says was created before this call started (allowing 60 s for clock skew) is refused with a 400 and is never adopted or rolled back.
  - On rollback, the profile row is deleted (by id) only when this call inserted it. Otherwise the auth user is deleted only when no profile exists in any tenant; if one exists, or the lookup errors, it is kept.
- **invite-tenant-admin:** super_admin only, with the same duplicate check, created-by-this-call refusal and rollback (`ownsProfile=false`). status and resend are unchanged from ca0d8d3.
- **auth-errors.ts:** Auth errors are logged as code and HTTP status only, never the message. Other errors log their message only, never `details`. `isRateLimited` trusts message wording only on Auth errors.
- **onboard-tenant:** returns 429 only after a complete rollback, which is still scoped `.eq("tenant_id", tenantId)`. provision-portal-accounts changed only its logging.

**SQL probes of what the Edge code relies on** (as service_role, rolled back)
- `ilike 'mixed.case\_x@…'` matches the stored `Mixed.Case_x@…`.
- An escaped `_` is literal (0 matches); an unescaped `_` acts as a wildcard (1 match), so the escaping matters.
- The rollback's by-id profile lookup sees other tenants' rows. That is what makes "someone else's account" read as "keep".
- `public.users` has `UNIQUE(email)`, which is case-sensitive (hence the ilike pre-check) and `PRIMARY KEY(id)`. It has no FK to `auth.users` here.

FINDINGS
- **REL-TI-R3-01 (minor).** Location: supabase/functions/_shared/invite-guard.ts:15-18, used at invite-staff/index.ts:107 and invite-tenant-admin/index.ts:159.
  - The 60 s window is a race. If schools A and B invite the same address at the same moment, and B's call lands within 60 s of A's call creating the account but before A inserts its profile, B adopts that new account.
  - Whichever profile insert lands first wins the PK. The losing call keeps the account, because a profile now exists, and returns 500. If B's teacher insert then fails, B's rollback deletes its own profile and that auth user.
  - Impact: A's invite fails, or the person ends up in B, which invited them too. No A data is exposed or deleted.
  - Fix (optional): shrink the window, or catch the PK conflict and answer 409.
- **REL-TI-R3-02 (info).** The duplicate check's "already registered" 400 tells a school_admin/hr_officer in B whether an address exists in any tenant. This behaviour was already there before this delta, is limited to 15 per minute, and is needed so the function never adopts an existing account.
- **REL-TI-R3-03 (minor, not verifiable here).** There is no Deno in this environment, so `invite-guard.test.ts` and `auth-errors.test.ts` did not run. I read them: they cover the cases above, including rollback "kept" when the profile is someone else's or the lookup fails.
  - Fix: let CI's `deno test` and `deno-check` pass on 6c0f215 before deploy.

CHECKED: the full `git diff ca0d8d3..6c0f215` of supabase/functions and supabase/tests; the full invite-staff body; harness, app-rpc-grants, two-tenant probes and all 27 mutations on 6c0f215; the duplicate-check and rollback-lookup behaviour in SQL; the users constraints.

Files are in /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/reti/:
- harness3.txt
- mutations3.log
- probe.sql
- the mut/ folder (the mutation files)