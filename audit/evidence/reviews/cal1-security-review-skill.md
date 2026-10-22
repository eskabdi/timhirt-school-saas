## Security review of `310820a..HEAD` (branch claude/timhirt-security-audit-kan0ei)

**No findings.** Nothing in this diff reaches the >80%-confidence bar for an exploitable vulnerability. I read the code and traced the data flows; I did not run the Postgres harness.

### What I checked

**`supabase/functions/invite-tenant-admin/index.ts`** (new `status` and `resend` actions)
- All three actions sit behind `requireRole(req, ["super_admin"])`, which checks the caller's JWT and then their `public.users.role` through the service client. A school user or an anonymous caller cannot reach `status` or `resend`.
- `status` returns only `user_id`, `pending` and `invited_at` for the given tenant's school_admins, up to 50. It does not return emails or auth metadata, and only a super_admin can call it, and a super_admin can already see every tenant. No cross-tenant leak.
- `resend` checks that the `user_id` belongs to the `tenant_id` with role `school_admin` before calling `getUserById`. It refuses with 409 once the invite has been accepted (email confirmed or signed in), and checks that the returned user id is the same one. You cannot use it to send an invite to some other account.
- The schemas are `.strict()` zod. The duplicate-email check moved from `eq` to `ilike`, with `\`, `%` and `_` escaped. That is a column filter, not an `or()` string, so PostgREST filter injection is not possible, and the check is stricter than before.
- `redirectTo` comes from the `APP_URL` env var, which is trusted. The error responses use fixed strings.

**`supabase/templates/invite.html`** (GoTrue email template) and **`config.toml`**
- The template fills in `.Data.school_name`, `.Email`, `.SiteURL` and `.ConfirmationURL`. `school_name` is set only by a super_admin: the tenant name in `invite-tenant-admin`, or `p.name` in `onboard-tenant`.
- An invitee cannot change their own metadata before accepting, because they have no session yet. There is no path from an attacker to template injection or HTML injection.
- The `config.toml` change only points the local setup at this template.

**`onboard-tenant` and `_shared/default-periods.ts`**: a fixed seed grid with no user input. This is a functional fix only.

**Migration `20261008000001_academic_calendar_engine.sql`**: I read the diff and the whole pending migration.
- **Changes in this diff:** they only tighten things. There is a new date-range check in `authority_calendar_entries_guard`, and `authority_calendars_guard` now also runs on INSERT and checks the session range. The trigger functions keep EXECUTE revoked from client roles. `special_closure` changed colour.
- **Whole-file pass:**
  - **Grants and tables:** clients cannot write to any of the seven tables (anon is revoked everything; authenticated is revoked INSERT, UPDATE, DELETE and TRUNCATE). RLS is enabled and forced on all of them.
  - **`calendar_year_settings`** (security invoker) refuses an end user who names another school's `p_tenant`, using the trusted-role allow-list plus a super_admin check. `effective_calendar_entries`, `calendar_days`, `calendar_day_status` and `instructional_days` all go through it, and RLS on `tenants` and `school_calendars` limits the data as well.
  - **`create_school_calendar`** (security definer) follows the WP-02 pattern:
    - `search_path` is pinned, EXECUTE is revoked from public, anon and authenticated, then granted back to authenticated only.
    - The tenant comes from `auth.uid()`, never from the caller. It requires `has_resource_permission(...,'create')` and the `events` module.
    - Recreating a draft (which deletes its entries) additionally requires the `update` permission.
  - **Policies:**
    - **Drafts:** draft authority calendars are visible only to a super_admin, and draft school calendars only to users with `academic_calendar:update`.
    - **Entries:** entry policies follow the visibility of their parent calendar.
    - **Module gate:** the restrictive module-gate policies are in place.

**Frontend** (`academic-calendar/**`, `TenantDetailPage.tsx`, `i18n.ts`)
- No `dangerouslySetInnerHTML` and no user-controlled `href`.
- Day-type colours go into React `style` objects. React sets these per property through the CSSOM, so a value cannot break out into other properties. They also pass through `safeColor` (`^#[0-9a-fA-F]{6}$`) on top of the database CHECK.
- `patternFor` returns only fixed values.
- `fetchCanCreateCalendar` calls `has_resource_permission(p_user_id, …)`. That function is on the definer allow-list as "answers only for the caller", and it only decides what the UI shows; the server enforces the real permission.
- `t((e as Error).message)` only ever receives one of two fixed translation keys.
- The `tField` change makes it safer: non-string values now become an empty string.

**Excluded as out of scope:** test files (`*.test.ts`, `supabase/tests/rls/academic_calendar_engine.sql`), audit and review markdown, and the locale JSON files.