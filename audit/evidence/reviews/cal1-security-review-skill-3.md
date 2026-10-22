## Security review: `git diff 67f541a..23a9fa1`, no findings

I found no new vulnerabilities in this range that I'm more than 80% confident in. I read the code diff and the full `invite-staff` handler at 23a9fa1. I did not run anything and did not change any files.

### What I checked

**1. `invite-staff` duplicate check with `.ilike` (`supabase/functions/invite-staff/index.ts:79-81`)**
- **Escaping is correct.** `\`, `%` and `_` get a backslash in front, and backslash is Postgres's default LIKE escape, so `\_` matches a literal underscore.
- **PostgREST's `*` wildcard is not escaped, but it can't get in.** zod v3's `.email()` pattern doesn't allow `*` (or `%` or `\`) in an address.
- **No filter injection.** supabase-js sends `.ilike()` as one URL-encoded `email=ilike.<value>` parameter, not through `or=()`, so commas and parentheses can't add filter clauses.
- **A wildcard slip would fail safe.** It could only match more rows, which means a valid email gets rejected as a duplicate. It can't let a real duplicate through, so it can't reach the rollback that deletes an auth user.
- **The change makes things safer.** Lower-casing and trimming the email, plus the case-insensitive match, close the old hole: a case-only variant of an existing address used to pass the `.eq` check, `inviteUserByEmail` handed back that existing account, and the catch block deleted it. The same pattern is already used in `invite-tenant-admin` (line 142) and `onboard-tenant` (line 50).
- **Unchanged from before, not counted as new:** the duplicate-check query ignores its own error (as the old `.eq` version did). The rollback still relies on `public.users` to recognise an existing account, so an auth user with no `public.users` row isn't covered. The tenant is still taken from the signed-in caller (`ctx.tenantId`), and the `hr_officer` limit on which roles it can assign still applies.

**2. `logSafeError` / `isRateLimited` (`supabase/functions/_shared/auth-errors.ts`)**
- Auth errors are logged by code and HTTP status only, never by message, so an email address quoted in a GoTrue error doesn't reach the logs.
- Other errors keep their message, which is what the old code logged too, so no new personal data is logged.
- Neither function can throw on an odd thrown value, so the catch blocks always get to their rollback.
- `isRateLimited` only changes which status code is returned (429 or 500). It has no effect on who is allowed to do what.

**3. `invite-tenant-admin` rollback (lines 168-175)**
- The `deleteUser` call is now wrapped and its errors are logged. The only new thing logged is `user_id`, which is a UUID and not personal data.
- What gets deleted is unchanged: still only `invitedUserId`, which only the invite action sets.

**4. `onboard-tenant` and `onboard-rollback.ts`**
- The 429 response is returned only after a complete rollback. Rollback errors now go through `logSafeError`.
- Neither change affects authorization or tenant scoping.

**5. `provision-portal-accounts`**
- Only the logging changed (now goes through `logSafeError`). The rollback is unchanged.

**6. `src/lib/ethiopian-date.ts` (`fromIsoDate` / `addDaysIso`)**
- These are browser-side date-parsing helpers with no security impact. The regex is anchored and simple, and ReDoS was out of scope anyway.

**7. Tests, docs and evidence files**
- These are excluded from the review. The SQL test file I didn't open; it's in `supabase/tests/`, so it's test-only and excluded.

The range contains no migrations, RLS policies, SECURITY DEFINER functions or secrets.