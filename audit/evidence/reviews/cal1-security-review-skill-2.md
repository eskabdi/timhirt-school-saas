## Security review: `6133b48..67f541a`. No findings

I found no new vulnerability I'm more than 80% confident is exploitable. I only read code and ran nothing. Here is what I checked and why each part holds up.

**`supabase/migrations/20261017000001_tenant_admin_invite_states.sql`**
- It is a SECURITY DEFINER function, but it is locked down as the rules require:
  - `search_path = public, pg_temp` is pinned.
  - EXECUTE is revoked from `public, anon, authenticated` and granted only to `service_role`.
  - It is not in `supabase/security/definer_allowlist.sql`, which is correct for a service_role-only function.
- As a second guard, it raises `forbidden` for any role outside the trusted list (`none`, `service_role`, `postgres`, `supabase_admin`). A signed-in user calling through PostgREST has role `authenticated`, so they would be refused even if a grant slipped in.
- It returns only booleans (whether a password is set, whether the user signs in through SSO, whether the email is confirmed) plus `invited_at`. No email, password hash or token comes back.
- The caller-supplied `p_tenant` and `p_user` are only reachable from service_role, which the Edge Function calls after a `super_admin` check.
- The `shim.sql` change only adds the `is_sso_user` column to the test copy of `auth.users`.

**`supabase/functions/invite-tenant-admin/index.ts`**
- `requireRole(["super_admin"])` still runs before any action.
- The rate-limit bucket is picked from the unvalidated `body.action`, but only the value `"status"` gets the larger budget, and that value only routes to the read-only status branch.
- Status responses contain only `{user_id, pending, invited_at}`.
- On resend, the user is still checked to be a `school_admin` of that tenant (the profile query, plus the RPC's own filter) before anything is sent.
- Recovery path (`resetPasswordForEmail(email, {redirectTo})`):
  - The address comes from `auth.admin.getUserById(user_id)`, so the link only goes to the account owner's own inbox.
  - `redirectTo` is built from the trusted `APP_URL` environment variable.
  - It is sent only to confirmed accounts with no password, and refused with 409 once the invite is accepted.
  - I found no way for a third party to receive a recovery link, so there is no account-takeover route.
- One side effect, which is not a vulnerability: a user who signs in with Google or another social login also has no password and is not marked as SSO. They would show as pending, and a resend would send a recovery link to their own inbox.
- The response no longer returns `invited_at` from GoTrue, and the log line `{tenant_id, user_id, by, kind}` contains no personal data.

**`_shared/log-safe.ts`, `_shared/invite-state.ts`, `onboard-tenant`**
- Errors from Supabase Auth (names starting with `Auth`) are logged by code only, so the email they can quote is no longer logged. `invite-tenant-admin` previously logged the raw message, so this reduces what reaches the logs.
- The other errors keep their message; they are database errors, which don't quote addresses.
- `invite-state.ts` contains only pure decision functions.

**`20261008000001_academic_calendar_engine.sql` changes**
- `ec_session_in_year` is an ordinary (invoker) pure date function. Granting it to `authenticated` exposes nothing.
- `ec_same_date_next_year` is also invoker, has EXECUTE revoked from `authenticated`, and is only called inside the definer `create_school_calendar`, so the revoke is harmless.
- `calendar_year_settings` (invoker):
  - The new date bounds on the `academic_years` fallback only narrow it. They stop a school's own academic year from reaching into another year's days, which would also capture locked MoE holidays.
  - The check that refuses `p_tenant` for another school is unchanged.
- `authority_calendars_guard` now refuses any change to `ec_year` or `authority_id`, which closes off moving a calendar after its entries were checked.
- `create_school_calendar` (definer):
  - It still takes the tenant from `auth.uid()` and checks the `academic_calendar:create` permission and the module gate.
  - Copied entries that fall outside the year are now dropped and reported, and the window matches the entry guard's.
  - The new `reason` field is a fixed string. The `name_i18n` and dates it echoes come from the caller's own school's rows.

**Frontend** (`AcademicYearGridPage.tsx`, `grid.ts`, `dayTypes.ts`, `EthDate.tsx`, `ethiopian-date.ts`, `TenantDetailPage.tsx`)
- There is no `dangerouslySetInnerHTML`.
- The new inline styles are constant strings.
- The `querySelector` selector `button[data-iso="${iso}"]` is built from ISO dates the grid computes, not from user input.
- The drop reason goes through `i18n.exists`/`t` and is rendered by React, which escapes it.
- `TenantDetailPage` now shows only its own known error keys instead of an arbitrary error message.

**`supabase/templates/invite.html`**
- The change fixes a CSS selector typo (`img9` to `img`) and edits button text. `{{ .Email }}` and `{{ .ConfirmationURL }}` are escaped by Go's template engine, and no new values are inserted.