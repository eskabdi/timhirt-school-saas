## Security review: `git diff 23a9fa1..6c0f215`

**No findings.** I found nothing newly introduced at more than 80% confidence.

### What I checked

**1. The new 400 refusal ("an existing auth account is never adopted").** In `supabase/functions/invite-staff/index.ts` and `supabase/functions/invite-tenant-admin/index.ts`, the 400 is returned before `invitedUserId` is set. So that path never reaches the rollback and never inserts a profile. It cannot be used to delete another school's account or take it over.
- GoTrue still re-sends its invite email to an existing unconfirmed account before the 400 comes back. That was already true before this range, and the change narrows the exposure because the account is no longer adopted.
- The 400 shares its message with the existing duplicate check. It tells the caller nothing new about whether an address exists.

**2. Clock skew in `createdByThisCall`** (`supabase/functions/_shared/invite-guard.ts`). It compares GoTrue's `created_at` (database clock) with `Date.now()` in the Edge Function, allowing 60 seconds. An attacker controls neither clock.
- If the Edge Function's clock runs ahead, a genuine invite is refused. That fails closed and only affects availability.
- An existing account counts as "created by this call" only if it was created in the 60 seconds before the request. The only way to adopt someone else's account is to race a concurrent invite or onboard of the same address, landing between GoTrue creating the user and the other request inserting its profile. Once that profile exists, the duplicate check refuses. This is a theoretical race with no concrete attacker-controlled path, so it is excluded.
- Before this range there was no `created_at` check at all, so any orphan auth account could be adopted. The range strictly narrows that.

**3. Rollback (`rollbackInvitedUser`).**
- `ownsProfile=true` is set only in invite-staff, after this call's own profile insert succeeds. It deletes the profile by that id, then the auth user, and that account passed `createdByThisCall`.
- `ownsProfile=false` deletes the auth user only if no profile exists for the id. If a profile exists (another request owns the account) or the lookup errors, the account is kept.
- Every lookup and delete is by primary key `id`, using the service-role client. Neither function can delete an account that has a profile, so a cross-school deletion is not possible.

**4. Duplicate check.** The lookup now throws when it errors, where it used to fall through and invite. That fails closed.
- `escapeLike` escapes `\`, `%` and `_`, the same as the inline code it replaces.
- PostgREST also treats `*` as a wildcard in `ilike`. Zod's email regex should not allow `*` (I didn't run it to confirm). Even if `*` got through, a wildcard can only widen the match, which means more refusals, not a bypass.
- The value goes through supabase-js as an encoded query parameter in a plain `ilike` filter, not an `or=` string, so filter injection is not possible.

**5. PII in logs.** The new `console.error` calls log only `user_id` plus `logSafeError`. For auth errors that is the code and status; for other errors it is the message. No email or name is logged. The `console.log` on the resend path is unchanged.

**6. `src/lib/ethiopian-date.ts` `fromIsoDate`.** This only rewrites dates into a form every browser can parse, on the client. The regex ends in `$` and has no nested quantifiers. It has no security impact.

**7. Out of scope as asked:** test files, docs, audit evidence, and the pgTAP suite change.