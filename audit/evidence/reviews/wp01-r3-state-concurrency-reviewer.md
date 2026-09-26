REVIEWER: state-concurrency-reviewer
WP: R6 WP-01 (whole-WP diff da6055e..9ac652f, head 9ac652f). This review fills gap GK-3.
VERDICT: FAIL

I found two majors and three smaller issues. The first major was introduced by this WP. The second was already there, but this WP's working failure path now makes it reachable. The calendar migration and merge_tenant_settings's handling of different sections both held up under two-session tests.

FINDINGS

1. **major: the onboard rollback deletes an auth user it did not create.**
   - Location: supabase/functions/_shared/onboard-rollback.ts:30, with supabase/functions/onboard-tenant/index.ts:45 and :59.
   - Scenario: `invitedUserId` is whatever `inviteUserByEmail` returns. The function's own comment (index.ts:40-44) says the invite returns the existing user id when the account already exists, which is GoTrue's behaviour for an unconfirmed invitee. The pre-check at :45 compares email exactly, but `users_email_key` is case-sensitive and GoTrue lowercases.
     - School X is onboarded and its admin `head@school.et` has not accepted yet, which is normal for invite-only.
     - A super_admin then onboards school Y with `Head@school.et`. The pre-check finds 0 rows and the invite returns X's admin id.
     - The `users` insert fails with 23505 on `users_pkey`.
     - `rollbackTenant(Y, invitedUserId)` then calls `auth.admin.deleteUser` on **school X's admin**.
     - The same happens if two onboards with the same email but different slugs run at the same time: the loser deletes the winner's admin.
   - Before this WP the rollback never touched auth users, so this deletion is new.
   - Evidence (scratch DB, run as service_role): pre-check 0 rows, the users insert raises duplicate key `users_pkey`, and every rollback step succeeds. Afterwards `X admin public.users = 1` and `X admin auth.users = 0`. X's admin now has a `public.users` row but no auth user: the invite link is dead, and a re-invite creates a new id that does not match `public.users`.
   - Not verifiable locally: the GoTrue invite behaviour (taken from the code's own comment).
   - The Deno tests (onboard-rollback.test.ts) use a fake client and only check call order, so they cannot catch this.
   - Fix:
     - Only delete an auth user this call created. Record `const t0 = Date.now()` before the invite and delete only if `invited.user.created_at >= t0`, and never when the users insert failed on a PK/email conflict.
     - Make the pre-check case-insensitive (`.ilike` or lowercase `admin_email` in the Zod schema), and check auth for an existing account before inviting.
     - Add a test where `deleteUser` must not be called for a pre-existing id.

2. **major: job claim is check-then-act, and fail_job/complete_job accept any state change. Already there before this WP, but this WP's failure path makes it reachable.**
   - Location: supabase/functions/process-import-job/index.ts:323-331, supabase/functions/process-export-job/index.ts:229-237, supabase/migrations/20260719000010_import_export.sql:129-141 (`fail_job`) and :111 (`complete_job`).
   - Scenario: each invocation reads `status` through RLS, then runs an unconditional `update … set status='processing' where id=…`.
     - Two invocations for the same `job_id` (a client retry, or a replayed direct call) both see `queued` and both claim it. Both then import every row, so students, teachers and fees are inserted twice.
     - `fail_job` has no guard on the current status. Now that `failJobQuietly` actually runs it (the old `.catch` threw before it ran), one run that fails after the other completed flips `completed` to `failed`, while the export file or imported rows stay behind. `complete_job` can equally flip `failed` back to `completed`.
     - There is no expiry for claims and no resume: an Edge Function that hits its wall-clock limit leaves the job `processing` forever.
     - No trigger or CHECK validates status transitions in the database.
   - Two-session evidence: S1 saw `queued`, S2 saw `queued`, and each claimed 1 row. Then `complete_job` followed by `fail_job` left `status=failed`, `error_log=[{"error":"internal_error"}]`.
   - Fix:
     - Claim atomically with `update … set status='processing' where id=$1 and status='queued' returning id`, via an RPC. Zero rows means return 409.
     - Guard `fail_job` and `complete_job` with `where status='processing'`.
     - Add a `started_at` staleness sweep, or a lease column, for claim expiry.
     - If this is ruled out of WP-01's scope, carry it as a named item to the WP that owns data_jobs.

3. **minor: two first saves on a tenant with no config row race, and the loser gets a raw 23505.**
   - Location: supabase/migrations/20260925000003_r6_tenant_settings_merge.sql:46-52.
   - Scenario: two admins save different sections when the tenant has no `tenant_configs` row. Both UPDATEs match 0 rows and both INSERT; B blocks on A's uncommitted key.
   - Evidence: when A commits, B fails with `duplicate key value violates unique constraint "tenant_configs_pkey"`. Only A's section is stored, and BrandingPage shows the raw error text in its toast. The loss is visible and a retry fixes it, hence minor. Onboarding now creates the row, so only older tenants without a row are exposed.
   - Fix: `insert … on conflict (tenant_id) do update set settings = case when jsonb_typeof(tenant_configs.settings)='object' then tenant_configs.settings else '{}' end || excluded.settings`, which keeps the RLS check through the UPDATE policy. Or catch `unique_violation` and retry the UPDATE once.

4. **minor: last writer wins within a section, with no revision check.**
   - Location: 20260925000003 (no `updated_at` or revision compare), src/features/fees/FeeStructuresPage.tsx:91.
   - Scenario: two admins editing the same section (branding or idCardTemplate) silently overwrite each other. FeeStructuresPage builds `billing` on the client from a possibly stale cache, so a concurrent change to another billing key is lost.
   - Fix: add an optional `p_expected_updated_at` argument and raise 40001 on mismatch, or merge billing keys on the server.

5. **info: other points, none blocking.**
   - `fail_job`, `complete_job` and `update_job_progress` are SECURITY DEFINER with no tenant check. `fail_job` is EXECUTE-able by anon and authenticated, so anyone can fail any tenant's job. This is already in the baselines `supabase/security/definer_anon_known.sql:25` and `definer_search_path_known.sql:18`, so it is tracked (WP-02).
   - BrandingPage.tsx:103-108 saves in two separate calls (merge, then an update of the catalog columns). The save is not atomic, but a retry is idempotent.
   - `data_jobs.user_id` is `NOT NULL` but its FK is `ON DELETE SET NULL`, so deleting that auth user (as the rollback in finding 1 does) raises instead. This was already there.

CHECKED
- Read the whole-WP diff for jobs.ts, process-import-job, process-export-job, onboard-tenant, onboard-rollback.ts, 20260925000002, 20260925000003 and the settings pages (Branding, FeeStructures, IdCardTemplate, useCalendarPrefs).
- `failJobQuietly`: awaits the call, never throws, returns false on an error result or an exception. The caller's own error response still goes out. Correct as written; the state problems are in finding 2.
- Rollback order against real foreign keys (catalog query): `users` and `academic_years` are NO ACTION on tenants, while `tenant_configs`, `periods` and `data_jobs` cascade. Onboarding writes only periods, tenant_configs, academic_years and users. There are no insert triggers that create other dependants (tenants→set_tenant_no, users→users_lock_identity only), so deleting dependants before the tenant is correct. The simulated rollback deleted tenant Y.
- Harness run on scratch DB `sc_wp01`: all migrations applied and all suites passed, including tenant_settings_merge 10/10.
- Two-session test, merge_tenant_settings on different sections: B waited on A's row lock (`Lock/transactionid`). After re-evaluation, both `calendar` and `branding` were stored and billing was kept. PASS.
- Two-session test, missing-row insert race: reproduced finding 3.
- Two-session test, calendar migration against writers, on DB `sc_wp01_pre` (migrations up to 20260925000001, camelCase seed, migration run in one transaction):
  - An in-flight writer blocked the migration's `create trigger` (`Lock/relation`) and was then normalised by the backfill.
  - A writer arriving during the migration transaction blocked on the table lock and was then normalised by the trigger.
  - Both rows ended with snake_case keys, `numerals:"latn"`, and no Ge'ez. PASS. Row-level locking only; reads are not blocked.
- Two-session test, data_jobs claim race plus a fail after complete: reproduced finding 2.
- Onboarding with a case-variant email against a pending admin, in SQL: reproduced the database side of finding 1.
- Not verifiable:
  - Deno unit tests (jobs.test.ts, onboard-rollback.test.ts): `deno` is not installed.
  - GoTrue's invite-returns-existing-id behaviour: taken from the code's own comment and not run.
- Dropped the scratch DBs `sc_wp01` and `sc_wp01_pre`. No tracked files were modified.

VERDICT: FAIL
