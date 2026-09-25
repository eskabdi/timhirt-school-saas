# WP-00 closeout, round 3: authz-reviewer (verbatim verdict, HEAD 53b83e2, 2026-09-25)

VERDICT: FAIL. There are no implementer defects. The only reasons are two majors that only the owner can close (DR-1, DR-4); the §0A.4 contract fails any open major without a recorded human acceptance. Once the owner records acceptance or deploys, the result is PASS with no code change.

A. Owner-only:
- AZ-R3-1 (major, DR-4): `20260924000002` is correct locally (proacl `{postgres=X,service_role=X}` on all four RPCs), but production still has anon=X. Fix: deploy it, or record acceptance of DR-4.
- AZ-R3-2 (major, DR-1): public sign-up. The decision is pending.
- AZ-R3-3 (minor): `20260925000001` and the two https-only functions are in the undeployed set; production still runs `z.string().url()` only. Fix: deploy both migrations and both functions together.

B. Implementer (non-blocking):
- AZ-R3-4 (info): `manage-integration-credentials` has no aal2 or impersonation check. `requireAccess` is WP-06; add this endpoint to the backlog so it isn't missed.
- AZ-R3-5 (minor, not verifiable): `deno` is not installed in the review environment. Rely on the CI `deno test` output.
- AZ-R3-6 (info): the DB regex is looser than the JS rule (it accepts `https://` with nothing after it). Safe, because the UI links only when `httpsHref()` passes.

CHECKED:
- Library RPCs are service_role only on wp_gate. The trigger guard functions are harmless.
- `process-library-circulation` takes the tenant from `ctx.tenantId`.
- `r6_hotfix_library_anon.sql` passes 12/12. The negative control (re-granting anon) shows the test is not vacuous.
- The https CHECK is validated. `verification_url_https.sql` passes 5/5, and dropping the constraint makes it fail.
- manage-integration-credentials order: role, rate limit, strict Zod, exact key sets, row lookup before Vault. The update must match a row, and credentials are never echoed.
- record-fee-payment and verify-admission-bank-url: only `.refine(isHttpsUrl)` changed. Auth is untouched.
- UI links render only through `httpsHref()`, with `rel="noopener noreferrer"`.
- No new privilege-escalation surface.
