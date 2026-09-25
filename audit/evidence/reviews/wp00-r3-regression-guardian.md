# WP-00 closeout, round 3: regression-guardian (verbatim verdict, HEAD 53b83e2, 2026-09-25)

VERDICT: PASS for the diff. No blocker or major in the code. WP-00 cannot close until the owner decides OWN-1 (DR-4) and OWN-2 (DR-1).

- RG3-1 (minor): `.refine(isHttpsUrl)` makes record-fee-payment return 400 "Invalid request" (English, untranslated) for an http:// URL, so the payment is not recorded. Before, it was recorded with verification failed/https_required, and the header comment still says a failed check does not block recording. → **fixed after this verdict**: no 400; the payment is recorded, the verification is reported as failed/https_required, and the URL is not stored.
- RG3-2 (minor): the admission applicant used to get the translated `https_required` message; after the change it was a 400 → "unknown". → **fixed**: the function returns `{ok:false, reason:"https_required"}` without storing anything.
- RG3-3 (minor): no Deno test covers the writers' https guard. → backlog (WP-03). The DB CHECK and `httpsHref` are tested.
- RG3-4 (info): the §7 guards that do not exist yet (WP-01/06/08/12) cannot be verified.
- RG3-5 (info): no render test for the two detail pages. → backlog.
- RG3-6 (info): the reviews directory was incomplete when checked.
- OWN-1 (owner, blocker): DR-4. The undeployed set includes the anon library write path.
- OWN-2 (owner, major): DR-1. Public sign-up.

CHECKED:
- Local gates:
  - tsc: 0
  - eslint src: 0, and it was shown to fail on a planted `dangerouslySetInnerHTML`
  - Vitest: 56/56
  - check:i18n: 0
  - check:locales (against f57d82c): OK
  - build: OK
  - no-payment-gateway: ok
- Deno: tests 13/13, deno check OK.
- pgTAP on a private DB: 108 migrations applied, 56/56 suites passed.
  - r6_hotfix 21/21, r6_hotfix_library_anon 12/12, webhook_settlement 10/10.
  - The existing §7 guards all pass: resource_permissions*, class_rank, grading_scales_lookup, payroll_sod.
- FS-1 migration:
  - Removing the CHECK makes 4 of 5 assertions fail.
  - It re-runs cleanly.
  - The Zod rule and the CHECK agree on the edge cases tried.
- Existing callers of both writers trim input and send https. bank_verification.sql and fee_payment_recording.sql still pass.
- manage-integration-credentials refactor:
  - The handler logic is unchanged.
  - The row check runs before any Vault write.
  - The branded type holds.
  - `.strict()` and the non-empty config values are tested.
- IntegrationsPage pagination and `keys.ts` (no imports) are OK.
- The docs match the code.
