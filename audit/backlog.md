# R6 backlog (minor / info findings, fix plan §0A.4)

| Source | Item | Suggested WP |
|---|---|---|
| WP-00 recon | ~~Missing `config.toml` entries for `invite-tenant-admin`, `issue-staff-id`, `upload-admission-document`.~~ **Done in WP-00** (infra review F3), matching production's observed `verify_jwt` (see drift §2). | — |
| WP-00 gate | `deno check` on `enroll-finalize-billing` fails with TS2352 (embedded `class` typed as an object but returned as an array) at `index.ts:66`. Pre-existing on the base commit. | WP-04 (function is rewritten there) |
| WP-00 gate | `deno check` needs `DENO_NO_PACKAGE_JSON=1 --node-modules-dir=none` in this repo, otherwise Deno resolves `npm:` imports from the root `node_modules`. The CI job in WP-01 must set this. | WP-01 |
| WP-00 DNS | `edux.et` apex redirects 308 → `www.edux.et`; the plan (WP-20.2) wants `www` → apex. The apex redirect response also sends HSTS without `includeSubDomains`. | WP-20 |
