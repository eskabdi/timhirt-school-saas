Security review of `git diff 6c0f215..aaec819 -- supabase src`: no findings. I found no high-confidence vulnerability introduced by this change.

The range touches 3 files with 12 additions and 8 removals. Here is what I checked:

1. **`supabase/functions/onboard-tenant/index.ts`**
   - **Injection:** `escapeLike` in `/home/user/timhirt-school-saas/supabase/functions/_shared/invite-guard.ts` uses the same regex as the inline code it replaces (`s.replace(/[\\%_]/g, m => '\\'+m)`). LIKE escaping is unchanged, so nothing new is exposed to injection. The email is still checked by zod first, and the filter runs through PostgREST's `.ilike()` with the escaped value.
   - **Authorization:** unchanged. `requireRole(req, ["super_admin"])` runs before the try block.
   - **Account deletion or takeover:** the new `if (existErr) throw existErr;` runs before the tenant is created and before any invite, while `tenantId` and `invited` are still undefined. The catch block therefore runs no rollback, so it cannot delete an account that already existed. Before this change, a query error left `existingUser` null and the code went on to invite. That path could reach the catch-block rollback after re-inviting an existing account. The change closes that gap rather than opening one.
   - **PII in logs:** the catch block logs `logSafeError(err)`, which records only `message` for non-auth errors. PostgREST/Postgres messages for a failed select do not echo filter values, and the client gets the generic `errors.internal()`. Nothing new leaks.

2. **`supabase/functions/invite-staff/index.ts`**
   - **Tenant scope:** the `staff_no` duplicate query is still filtered to `ctx.tenantId`.
   - **Rollback:** the new throw happens before the invite, while `invitedUserId` is still unset. No rollback runs and no existing user is affected.
   - **Logging:** it goes through the same `logSafeError` and generic 500 path as above.
   - **Authorization:** unchanged. The role gate, the `hr_officer` assignable-roles check and the `ctx.tenantId` requirement all run before this code.

3. **`supabase/tests/rls/academic_calendar_engine.sql`:** only a comment changed, and test files are excluded anyway.

**Net effect:** both duplicate checks now refuse to continue when their query fails, instead of treating the failure as "no duplicate". This removes the path where an unverified check could lead to an invite. I found no new authorization bypass, injection, account deletion or takeover, or PII written to logs.