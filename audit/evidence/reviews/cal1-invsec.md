REVIEWER: INV-SEC (independent security review, read-only)
WP: Invite review fixes and calendar slice 1 round 3. Worktree /home/user/rv-wp09 at 0129fef, diff 6133b48..0129fef. Scope: invite-tenant-admin, 20261017000001_tenant_admin_invite_states.sql, tests/rls/tenant_admin_invite_states.sql, src/features/platform, templates/invite.html, and the calendar engine SQL changes.
VERDICT: PASS. I found no blocker, major, High or Critical issue. Two Low findings need follow-up: one I confirmed by running it (02) and one I could not verify (01). The rest are Info.

FINDINGS

INV-SEC-01, minor (Low), not verifiable: SSO school_admins show as "pending", and Resend sends them a password-reset link.
- Location: /home/user/rv-wp09/supabase/migrations/20261017000001_tenant_admin_invite_states.sql:31, /home/user/rv-wp09/supabase/functions/invite-tenant-admin/index.ts:75,88,111
- Evidence:
  - `password_set` is `coalesce(u.encrypted_password,'') <> ''`. Users who sign in via SSO have no password: the LoginPage `signInWithSSO` flow (complete-sso-login creates them) and a promotion to school_admin produce exactly that.
  - Such an admin shows as Pending forever and gets a Resend button. Their email is confirmed, so resend calls `resetPasswordForEmail`.
  - I could not check GoTrue locally. As I recall, `/recover` skips SSO users (`is_sso_user=false`). If so, the call silently does nothing while the API returns `resent:true`.
  - If a GoTrue version does send the reset to SSO users, the admin could set a local password. That gets around the tenant's IdP: offboarding and MFA at the IdP would no longer stop a password login.
  - The link only ever goes to the account's own address, so a third party cannot use it to take over the account.
- Reference: CLAUDE.md, the R6 tenant SSO model.
- Fix: have the function also return `u.is_sso_user`. Treat SSO users as accepted in `status`, and refuse `resend` for them with 409.

INV-SEC-02, minor (Low), confirmed by a probe: a school's own academic year can still hide a locked authority holiday that falls in the previous year's Nehase or Pagume.
- Location: /home/user/rv-wp09/supabase/migrations/20261008000001_academic_calendar_engine.sql:68-73 and :494, used by calendar_days at about :585
- Evidence:
  - `ec_session_in_year` deliberately lets a session start in the previous year's Nehase (the MoE lead-in).
  - When year N+1 has no authority calendar, a school_admin can write `academic_years` (ec_year N+1, starts Nehase 1 of N). Days in that range then belong to session N+1, and only N+1 entries apply to them.
  - Probe on a private harness database, as an authenticated school_admin:
    - I first added a locked national_holiday on 2019-12-19 EC to the published MoE 2019 calendar. Before: `national_holiday|counts=f|blocks_student=t`.
    - After inserting academic_years 2020 starting 2019-12-01 EC: `2020|instructional|counts=t|blocks_student=f`.
  - It is limited to the school's own tenant. Other tenants were refused (`not_allowed`, below).
  - The seed has no locked entries in Nehase or Pagume today, and Hijri holidays are display-only, so this cannot happen until an authority enters such a date.
  - The fix reduces the CAL-DB3-03 exposure but does not fully match its own comment ("locked MoE holidays included").
- Fix: a school's own academic year should start no earlier than Meskerem 1, with the Nehase lead-in reserved for authority calendars. Alternatively, keep applying year N's locked entries to lead-in days before Meskerem 1 of N+1.

INV-SEC-03, info, not verifiable: no automated test covers the Edge Function's status and resend branches.
- Location: /home/user/rv-wp09/supabase/functions/invite-tenant-admin/index.ts:52-119
- Evidence: the directory holds only index.ts, and `deno` is not installed here. I reviewed the invite/recovery branch choice, the 409, the cross-tenant check, the bucket choice and the GoTrue errors by reading only.
- One detail found by reading: GoTrue's per-user cooldown on `/recover` ("For security purposes, you can only request this after N seconds") does not match `/rate limit/i`. It surfaces as a generic 500, so it fails closed.
- Fix: add a Deno unit test with a stubbed adminClient.

INV-SEC-04, info: the recovery email uses Supabase's default "Reset Password" template.
- Location: /home/user/rv-wp09/supabase/config.toml (only `[auth.email.template.invite]` is set); index.ts:111
- Evidence: an invitee who never set a password receives a generic "reset your password" email. This is confusing and looks like phishing. It is not exploitable.
- Fix: add a branded recovery template.

INV-SEC-05, info, existed before this diff: AcceptInvitePage shows the set-password form for any session.
- Location: /home/user/rv-wp09/src/features/auth/AcceptInvitePage.tsx:36
- Evidence:
  - The page checks only `getSession()`. It does not check `type=invite|recovery` in the hash or ask for the current password.
  - A recovery session reaching it is fine (the token comes from the user's own mailbox).
  - But any signed-in session can change its password there. That includes a super_admin impersonating a pending admin through impersonate-user's magiclink session, which lets the super_admin set that admin's password.
  - The resend path itself never gives the link to the super_admin.
- Fix (separate WP): only render the form for an invite/recovery hash, or require reauthentication. Block /accept-invite during impersonation.

INV-SEC-06, info: the request body is now parsed before the rate limiter.
- Location: index.ts:51-55
- Evidence: this only happens after `requireRole(['super_admin'])`, so the exposure is negligible.
- The bucket logic is sound. The status bucket (60/min) is used only when `body.action === "status"`, and the same test sends the request to the status branch, so resend and invite cannot use the status budget.

Answers to the coordinator's questions
1. tenant_admin_invite_states:
   - It is SECURITY DEFINER with `search_path = public, pg_temp`. The ACL is `{postgres=X, service_role=X}`, with nothing for anon or authenticated (checked in the catalog).
   - As anon or authenticated: `permission denied`. As a custom role holding a stray grant: `forbidden`.
   - The role check is an allow-list (`none, service_role, postgres, supabase_admin`), as CLAUDE.md requires.
   - It returns only user_id, two booleans and invited_at: no email, hash or token.
   - It is correctly not in definer_allowlist.sql, and catalog_definer_security passes (10/10).
2. Resend:
   - Only a super_admin can reach it. The target must be a school_admin of the given tenant (profile check plus the function's tenant filter). Otherwise it returns 400, and 409 once a password is set.
   - Limited to 3 per hour per target, plus 10 per minute per super_admin.
   - Only a super_admin can see the 400/409 difference, so there is no enumeration by others.
   - The link goes only to the account's own email. Recovery to /accept-invite is safe: the redirect is on the allow-list, and the implicit-flow hash session feeds `updateUser({password})`. Local auth-js 2.110.4 defaults to `flowType: 'implicit'`; the Edge import `npm:@supabase/supabase-js@2` is not pinned, and a switch to PKCE would break the link rather than open a hole.
   - Remaining issues: SSO (01) and the existing page behaviour (05).
3. The separate status bucket is fine (06).
4. Calendar SQL:
   - Cross-tenant use is refused: `calendar_year_settings` and `calendar_days` for another tenant raised `not_allowed`.
   - `authority_calendars_guard` now freezes ec_year. The session columns are NOT NULL, so the strict function cannot be bypassed with NULLs.
   - The `outside_year` window in create_school_calendar matches the entry guard (`ec_to_gregorian(y,1,1)-60` to `end+60`).
   - `ec_session_in_year` is IMMUTABLE and SECURITY INVOKER (not definer), and is granted to authenticated as calendar_year_settings needs.
   - The only lock bypass I found is the one inside a school's own tenant (02).

CHECKED
- Read both diffs in full, the whole invite-tenant-admin/index.ts, requireRole and rateLimit in _shared/security.ts, AcceptInvitePage, the src/lib/supabase client config, the SSO path in LoginPage, and how onboard-tenant and impersonate-user handle passwords.
- Ran the full harness on a private database `invsec_rev` (since dropped): 116 migrations applied, all suites passed. That includes tenant_admin_invite_states 9/9, academic_calendar_engine 76/76 and catalog_definer_security 10/10.
- Manual probes: the invite-state function's ACL, anon and authenticated refused, a stray-grant role refused, cross-tenant calendar refused, `ec_session_in_year` with NULLs, and the lead-in lock-bypass probe.
- Vitest: TenantDetailPage.test.tsx, 4/4 passed.
- Frontend: the error text is restricted to known translation keys, and nothing renders HTML.
- Logs carry no email, only tenant_id, user_id and the actor.
- Not verifiable here: actual GoTrue behaviour (SSO `/recover`, cooldown messages) and the Edge Function at runtime (no deno, no function tests).

I wrote no repository files.