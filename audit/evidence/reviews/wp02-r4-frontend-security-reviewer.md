REVIEWER: frontend-security-reviewer
WP: WP-02
VERDICT: PASS

I found no blocker or major issues in the WP-02 frontend change, so the verdict is PASS. Two minor findings go to `audit/backlog.md`, and one issue that already existed is listed as info (it belongs to WP-07). I could not run the local Postgres test suites because the local server is down, so the server-side checks are marked "not verified" below.

FINDINGS:
  - id: FE-1
    severity: minor
    location: /home/user/rv-wp02/src/lib/useSecuritySettings.ts:36-49, used at /home/user/rv-wp02/src/features/auth/AcceptInvitePage.tsx:28,44 and /home/user/rv-wp02/src/features/auth/ChangePasswordModal.tsx:19,31
    evidence: `enabled: !!userId` together with `if (!data) return DEFAULT_SECURITY_SETTINGS;`. The fetch now starts only after `useSession()`'s `getSession()` resolves, so it starts slightly later than before. Until the RPC answers, or for good if it errors, both password forms check `passwordMeetsPolicy(password, passwordPolicy)` against `DEFAULT_PASSWORD_POLICY` (minLength 8, no character-class rules). They do not know the real policy is missing. The invite form becomes usable as soon as the page's own `getSession()` resolves, which does not wait for the settings query.
    reference: OWASP A07 (Identification and Authentication Failures), finding M-03, reviews AC-13/SEC-9
    fix: Return the loading and error state from `useSecuritySettings` (for example `{ ...settings, policyReady }`). Keep the submit button in `AcceptInvitePage` and `ChangePasswordModal` disabled until the query succeeds, and show an error if it fails, instead of quietly using the weaker defaults. Server-side enforcement (WP-07) is the real control.
  - id: FE-2
    severity: minor
    location: /home/user/rv-wp02/src/lib/useSecuritySettings.test.tsx:47-61
    evidence: The tests cover "no session, so no RPC" and "u-1's answer is cached under ['security-settings','u-1']". They do not cover (a) switching from u-1 to u-2 without a sign-out and checking that u-1's data is not served while u-2's fetch is running, or (b) that `SecuritySettingsPage.tsx:203` `invalidateQueries({ queryKey: ["security-settings"] })` still matches the new two-part key by prefix. Both behaviours are correct by reading the code (the key includes the user id, and TanStack prefix matching applies), but no test locks them in.
    reference: plan §0A.4 severity rules (missing test for an acceptance criterion); reviews AC-13/SEC-9
    fix: Add a test that re-renders with `h.userId = "u-2"` and checks for a second RPC call with no data carried over from u-1. Add a test that `client.invalidateQueries({queryKey:["security-settings"]})` triggers a refetch.
  - id: FE-3
    severity: info
    location: /home/user/rv-wp02/src/lib/passwordPolicy.ts:14-20; /home/user/rv-wp02/supabase/config.toml (no `minimum_password_length` or `password_requirements`)
    evidence: The password policy is checked only in the browser. An invited user with a session could call `supabase.auth.updateUser({password})` directly and skip it. This was already true before WP-02 and is not a regression.
    reference: finding M-03, tracked in WP-07 §7.2
    fix: Close it in WP-07 (set `minimum_password_length` and `password_requirements` in `config.toml` and the hosted dashboard).
  - id: FE-4
    severity: info
    location: /home/user/rv-wp02/src/lib/useSecuritySettings.ts:36
    evidence: Every `useSecuritySettings()` call now also runs `useSession()`. Each one adds its own `onAuthStateChange` subscription (each calls `queryClient.clear()` on sign-out) and its own `getSession()`. This has no security impact; it just adds some redundant work.
    reference: n/a
    fix: Optional. Read the user id from a shared session context or query instead.

CHECKED:
  - **Diff scope:** `git diff 67a627d 98b78e3 -- src` touches only `src/lib/useSecuritySettings.ts` and a new test file. `98b78e3..1700e73` changes only locale strings in `src`.
  - **Removed fields:** the four `login*` fields are gone and nothing in `src` reads them any more (grep). `LoginPage` does not use them. `tsc --noEmit` is clean and `eslint src` shows no output.
  - **Unsafe code patterns:** the diff has no innerHTML, `dangerouslySetInnerHTML`, eval, `new Function`, `window.open`, `href=`, localStorage or sessionStorage use, and no token handling (grep returned nothing).
  - **Token handling:** the hook calls only `supabase.rpc` and `useSession()`, which uses supabase-js `getSession` and `onAuthStateChange`. No token is copied or stored anywhere.
  - **Cache scoping:** the query key is `["security-settings", userId]` and the query runs only when `userId` is truthy, so nothing runs while the user is unknown or signed out. `useSession` clears the whole query cache on sign-out (§6.3). `SecuritySettingsPage`'s invalidation still matches by prefix.
  - **Invite and change-password pages:** both still call `passwordMeetsPolicy` before `updateUser`, and both are used only with a session. The invite page's session comes from the invite link (supabase-js/auth-js 2.110.4 resolves `getSession` after reading the session from the URL), so the authenticated-only RPC is reachable there. The server returns `password_*` keys whatever the user's role (migration `20260926000001` lines 338-359). Idle logout re-arms when `sessionTimeoutMinutes` changes.
  - **New tests:** they pass (2/2). I also ran the same test file against the pre-WP-02 hook from `67a627d` in a scratch copy, and both tests fail there ("spy called 1 times", "expected undefined to be truthy"). So the tests actually tell the old and new behaviour apart.
  - **Build output:** `vite build` to a scratch folder succeeded. Grepping the bundle for `service_role`, `sb_secret_` and service-role JWTs found only supabase-js's own key-format error message, no secrets. `login_max_attempts` appears only from the super-admin `SecuritySettingsPage` form.
  - **Server side:** by reading the files, the SQL keeps the login thresholds for super_admin and trusted contexts only; pgTAP covers anon getting 42501, registrar getting no thresholds, and super_admin getting them (`definer_lockdown.sql:52,60,62,117,137`, `security_settings.sql`); and the allow-list grants `get_security_settings()` to authenticated only. **Not verified by running:** local Postgres 16 is down, so I did not execute `supabase/tests/run.sh` or these suites. The db-migration and api-contract reviewers must confirm them.
  - **Unaffected by this diff:** CSP and Trusted Types (no inline script or eval added), open redirects, external links, signed-URL file previews, and the WP-20 host-to-tenant check.
