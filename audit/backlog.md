# R6 backlog (minor / info findings, fix plan §0A.4)

| Source | Item | Suggested WP |
|---|---|---|
| WP-00 recon | ~~Missing `config.toml` entries for `invite-tenant-admin`, `issue-staff-id`, `upload-admission-document`.~~ **Done in WP-00** (infra review F3), matching production's observed `verify_jwt` (see drift §2). | — |
| WP-00 gate | `deno check` on `enroll-finalize-billing` fails with TS2352 (embedded `class` typed as an object but returned as an array) at `index.ts:66`. Pre-existing on the base commit. | WP-04 (function is rewritten there) |
| WP-00 gate | `deno check` needs `DENO_NO_PACKAGE_JSON=1 --node-modules-dir=none` in this repo, otherwise Deno resolves `npm:` imports from the root `node_modules`. The CI job in WP-01 must set this. | WP-01 |
| WP-00 DNS | `edux.et` apex redirects 308 → `www.edux.et`; the plan (WP-20.2) wants `www` → apex. The apex redirect response also sends HSTS without `includeSubDomains`. | WP-20 |
| WP-00 gatekeeper | Stale WP-00 records. In `audit/FIXES_VERIFIED_R6.md`, Implementation rows 1 and 3–5 still say "Owner" / "no credentials". The drift header (line 3) says "deploy PENDING". The access record is duplicated at drift line 48. The round-3 note calls the cron assertions "#11–#12 of 21"; they are #14–#15. | WP-00 follow-up |
| WP-00 gatekeeper (test-verifier F5, second half) | No Vitest render test that `IntegrationsPage` lists only SMS providers. The CI guard's `fabric[-_]?app` pattern only partly covers a re-added Telebirr card. | WP-03 |
| WP-00 security SR-8 | Rotate `SUPABASE_ACCESS_TOKEN` and `VERCEL_TOKEN` after the R6 deploys (owner action 8). | Owner, now |
| WP-00 security SR-11 | `no-payment-gateway.sh` is an identifier deny-list. A direct `fetch("https://api.chapa.co/...")` passes. Add provider hosts or an outbound-host allow-list. | WP-03 |
| WP-00 security SR-12 | `upload-admission-document` keys its rate limit on the leftmost `X-Forwarded-For` and trusts the client `file.type`. Both are pre-existing. | WP-12 |
| WP-00 infra F7 | `*.edux.et` is not attached to the Vercel project, and the wildcard certificate is unverified. HSTS preload waits for the www→apex flip. | WP-20 |
| WP-00 security SR-4 | Revoke any Telebirr testbed credentials or keypair ever issued, with Ethio Telecom (owner action 6). | Owner |
