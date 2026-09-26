# R6 backlog (minor / info findings, fix plan §0A.4)

| Source | Item | Suggested WP |
|---|---|---|
| WP-00 recon | ~~Missing `config.toml` entries for `invite-tenant-admin`, `issue-staff-id`, `upload-admission-document`.~~ **Done in WP-00** (infra review F3), matching production's observed `verify_jwt` (see drift §2). | — |
| WP-00 gate | `deno check` on `enroll-finalize-billing` fails with TS2352 (embedded `class` typed as an object but returned as an array) at `index.ts:66`. Pre-existing on the base commit. | WP-04 (function is rewritten there) |
| WP-00 gate | ~~CI must set `DENO_NO_PACKAGE_JSON=1 --node-modules-dir=none`~~ (done in WP-00). Remaining: add a `deno check supabase/functions/*/index.ts` job with the same flags (16 errors today, per the WP-01 recon). | WP-01 |
| WP-00 DNS | `edux.et` apex redirects 308 → `www.edux.et`; the plan (WP-20.2) wants `www` → apex. The apex redirect response also sends HSTS without `includeSubDomains`. | WP-20 |
| WP-00 gatekeeper | ~~Stale WP-00 records (FIXES rows 1 and 3–5, drift header, duplicated access record, cron assertion numbers)~~. Resolved in PR #8. | — |
| WP-00 gatekeeper (test-verifier F5, second half) | No Vitest render test that `IntegrationsPage` lists only SMS providers. The CI guard's `fabric[-_]?app` pattern only partly covers a re-added Telebirr card. | WP-03 |
| WP-00 security SR-8 | Rotate `SUPABASE_ACCESS_TOKEN` and `VERCEL_TOKEN` after the R6 deploys (owner action 8). | Owner, now |
| WP-00 security SR-11 | `no-payment-gateway.sh` is an identifier deny-list. A direct `fetch("https://api.chapa.co/...")` passes. Add provider hosts or an outbound-host allow-list. | WP-03 |
| WP-00 security SR-12 | `upload-admission-document` keys its rate limit on the leftmost `X-Forwarded-For` and trusts the client `file.type`. Both are pre-existing. | WP-12 |
| WP-00 infra F7 | `*.edux.et` is not attached to the Vercel project, and the wildcard certificate is unverified. HSTS preload waits for the www→apex flip. | WP-20 |
| WP-00 security SR-4 | Revoke any Telebirr testbed credentials or keypair ever issued, with Ethio Telecom (owner action 6). | Owner |
| WP-00 review FS-1 | ~~Stored `javascript:` verification URL rendered as a link~~ **Fixed in the closeout** (gatekeeper GK-7): https-only in both writers, a DB CHECK (`20260925000001`), links rendered only for https with `rel="noopener noreferrer"`. | — |
| WP-00 review FS-2 | `window.open(url, "_blank")` without `noopener`, and `rel="noreferrer"` without `noopener` (InvoiceDetailPage, InvoicesPage). | WP-12 |
| WP-00 review CG-3 / CQ-6 / FS-3 / PI-5 | `fees.payFailed` ("Could not start the payment") is the fallback for failed invoice *generation*. Add `fees.errors.generateFailed`. | WP-14 |
| WP-00 review CG-4 / I18N-6 | Oromo `help.integrationsNote` says "Gosti kun" (this type), not "this version". A native speaker should confirm. | WP-14 |
| WP-00 review CG-5 | `FinancialReportPage.tsx:12` has untranslated provider labels, including a stale "Card" (Stripe). | WP-03 |
| WP-00 review I18N-3 | `check:i18n` misses literals in JSX ternaries and text before `{`. Extend the scanner and add a fixture that must fail. | WP-01 |
| WP-00 review SC-1 / SC-2 | `jsr:@std/assert@1` and `npm:zod@3` float, with no `deno.lock`. `npx -y deno@2.9.6` is not integrity-pinned. Use `denoland/setup-deno` pinned by SHA. | WP-01 / WP-13 |
| WP-00 review AZ-2 | `manage-integration-credentials` is super_admin-only but has no aal2 or impersonation check. Move it to `requireAccess` first. | WP-07 |
| WP-00 review AZ-3 | `service_role` (and `authenticated`, without a policy) still hold DELETE on `audit_logs`. Revoke it, or add a raising trigger. | WP-08 / WP-10 |
| WP-00 review AZ-4 / AC-8 / PI-3 | The removed-endpoint 404 check is a one-time capture. Add `scripts/ci/removed-endpoints-404.sh` to the staging smoke suite and the go-live checks. | WP-17 / WP-19 |
| WP-00 review AC-5 | The blueprint (§790 onwards) still lists `process-fee-payment` as a live endpoint. | WP-18 |
| WP-00 review PI-1 / PI-2 | Drop `settle_gateway_payment` in WP-03. Add r6_hotfix fixtures for a pending cash row and a succeeded telebirr row. | WP-03 |
| WP-00 review CQ-3 / CQ-4 | ~~Duplicate provider list; AfroMessage unconfigurable~~ (fixed in the closeout, AC-1). | — |
| WP-00 review WP00-4 | Record per-function `updated_at` against commit times, so the "deployed = repo" check covers code, not only names. | WP-17 |
| WP-00 closeout | Supabase Auth: set `config.toml` `site_url` and `additional_redirect_urls` to the production values (DR-2). | WP-07 / WP-20 |
| WP-00 review R2-2 | `manage-integration-credentials` merges `platform_integrations.config` read-modify-write; two concurrent super-admin saves can lose an update. Merge in SQL (`config = config || $1`) or move the Vault + config write into one definer RPC transaction. | WP-12 |
| WP-00 review DM-2 | ~~Real anon calls in `r6_hotfix_library_anon.sql`~~ **Done in WP-01** (assertions 14–15, after the schema-usage precondition at 13; both fail without the migration). | — |
| WP-00 r3 AZ-R3-4 | `manage-integration-credentials` (Vault writer) must move to `requireAccess` with a fresh aal2 challenge and an `imp_mode=read` rejection when WP-06 introduces them (plan WP-06 item 5). | WP-06 |
| WP-00 r3 RG3-3 / TV3-1 | ~~No test covers the writers' https guard~~ **Fixed**: both writers call `_shared/bank-verification-record.ts` (`checkAndStoreBankUrl`), which has its own Deno tests. Removing the https branch fails 6 of them; removing the write-error check fails 1. | — |
| WP-00 r3 RG3-5 | No render test for the https-only link branches on InvoiceDetailPage / AdmissionDetailPage. There is no DOM test library in the repo yet. | WP-01 / WP-12 |
| WP-00 gatekeeper G3-3 | No test covers the wiring in `record-fee-payment` / `verify-admission-bank-url` `index.ts` (the call into `checkAndStoreBankUrl`, and that a throw there still leaves the payment recorded). Pair it with RG3-5. | WP-03 |
| WP-00 DR-1 follow-up | A self-signed-up auth account (created 2026-08-06, no `public.users` profile) exists from when sign-up was open. The owner should identify it and delete it if unknown. | Owner |
| WP-00 gatekeeper GK-F1 | Re-checked at WP-01 start (2026-09-25): `disable_signup = true`, live probe 422 `signup_disabled`. Still to do: add it to the WP-19 config-drift check. | WP-19 |
| WP-00 gatekeeper GK-F4 | ~~Embed the commit SHA in the bundle~~ **Done in WP-01**: `<meta name="app-commit">` in `index.html`; `npm run deploy` passes `VITE_COMMIT_SHA`. | — |
| WP-01 conventions | ~~Per-tenant "Use Ge'ez numerals" option~~ **Done (owner ask, 2026-09-25)**: replaced by Eastern Arabic digits and Hijri options; migration `20260925000002`. Native-speaker check of the Amharic/Oromo Hijri month names and era suffix still wanted. | WP-14 (i18n review) |
| WP-01 conventions | ~~Names without the middle name~~ **Done (owner ask, 2026-09-25)**: every name render uses `fullName()` or shows a middle-name column; the conventions gate blocks new single-line, multi-line and separate-column forms (round 3). | — |
| WP-01 deno check | 3 Edge Functions still fail `deno check` (baseline `supabase/security/deno_check_known.txt`): generate-payslip-pdf, issue-id-card, run-payroll (enroll-finalize-billing fixed). | WP-10 / WP-12 / WP-13 |
| WP-01 SAST | semgrep partially parses `integrationPayload.ts` (`unique symbol`) and `timetable-pdf.ts`; those files get partial SAST coverage. | WP-13 |
| WP-01 | `happy-dom` is now available (`// @vitest-environment happy-dom`), which unblocks the render tests in RG3-5 / TV3-2 (https-only links on the invoice and admission pages). | WP-03 / WP-12 |
| WP-01 review AZ-1 | 39 definer functions pin `search_path=public` without `pg_temp`; tighten the guard to require `pg_temp` (or `""`) when WP-02 rewrites them. | WP-02 |
| WP-01 review AZ-6 / TI-6 | ACL parity covers `public` EXECUTE/SELECT/INSERT only; add UPDATE/DELETE, schema CREATE and storage grants. Add guards for `security_invoker=false` views and permissive `true` tenant policies. | WP-02 / WP-05 |
| WP-01 review EF-1 / AZ-3 | No Deno test drives the fixed error paths in `activate-sso-user`, `process-export-job`, `process-import-job`. | WP-12 |
| WP-01 review EF-2 / EF-3 | No `deno.lock`; `npm:@supabase/supabase-js@2` floats, so `deno check` results can drift. Baselined functions pass on any failure reason. | WP-13 |
| WP-01 review SC-4 | Upstream moved the gitleaks tag v8.30.1; `go install` builds the sumdb-locked 8d1f98c7 (`h1:PmEvCfVI7ti9dV3s5aMZUY7sS2GxRvG3yzih7E+cS3w=`). Re-verify on any bump. | WP-13 |
| WP-01 review SC-5 | Dev-dependency audit: 1 critical (vitest ≤4.1.10) and 5 high. | WP-13 |
| WP-01 review FE-4 | Editor/sanitiser accept any https image; the CSP only allows Supabase storage. Restrict `SAFE_IMG_SRC` to match. | WP-12 |
| WP-01 round 2 | ~~Cache-key collision~~ **Done (release gate, 2026-09-26)**: Branding and Classes now use their own sub-keys; the remaining `["tenant-config", id]` users all select `settings` only. Original note: cache-key collision (pre-existing): several pages cache different `tenant_configs` columns under the same `["tenant-config", tenantId]` key (ClassesPage selects `operational_mode_key` only; BrandingPage adds two columns), so whichever loads first decides what the others read until a refetch. Give each query its own sub-key or one shared hook. | WP-12 |
| WP-01 round 2 (F-08) | `scripts/i18n-audit.mjs` misses strings in ternaries and `aria-label={cond ? "…" : "…"}`; (weekday initials now translated in round 3) (a native-speaker decision on Amharic/Oromo initials is needed); `IdCardTemplateDesignerPage` shows a hard-coded "Saved.". | WP-14 |
| WP-01 round 2 (F-13) | Hijri dates follow Umm al-Qura; Ethiopia's Islamic Affairs Supreme Council uses local moon sighting, which can differ by a day or two around month starts. Consider a per-tenant ±1/±2 day adjustment. | WP-14 |
| WP-01 round 2 (infra F3, SEC-4) | Pin or vendor the semgrep registry packs (p/owasp-top-ten, p/typescript, p/react); they are fetched live. | WP-13 |
| WP-01 round 2 (infra F6) | `setup-go` "1.24" installs an older 1.24.x than gitleaks v8.30.1 needs, so `go install` downloads a second (checksum-verified) toolchain. Match go-version to gitleaks' go.mod. The rls-tests job apt-installs Postgres and pgTAP unpinned. | WP-13 |
| WP-01 round 2 (SEC-5/6) | The editor has no `onPaste` sanitiser (self-XSS only; render path re-sanitises); images may come from any https host (beacon risk). | WP-12 |
| WP-01 round 3 (CQ m-2) | `src/lib/csv.ts` API differs from plan WP-12.1 (`csvCell(string \| number)`, no `toCsv`, no Deno twin); `ClassesPage`, `ImportExportPage` and `process-export-job` still write CSV by hand without the formula guard. | WP-12 |
| WP-01 round 3 (CQ i-2) | `shortName()` (First + Middle) has no callers yet; keep as the convention's API or remove. | WP-14 |
| WP-01 round 3 (i18n N-05) | No webfont covers Eastern Arabic digits (٠-٩); the opt-in relies on the device font. | WP-14 |
| WP-01 round 3 (i18n N-06) | Oromo `hijriEraSuffix` is the English "A.H."; native-speaker check (owner B3). | Owner B3 |
| WP-01 round 3 (i18n N-07) | Component tests exist for the Calendar and Branding settings pages only; add them for ID-card template and Fee structures. | WP-12 |
| WP-01 round 3 (DM3-4) | Done: the round-1 ledger row is marked superseded. | — |
| WP-01 release gate (GK-6) | Branding saves in two writes (settings section via RPC, then the two catalog columns); a failure between them half-applies the save (the error is shown). Fold the columns into one RPC. | WP-12 |
| WP-01 release gate (GK-8) | The onboard-tenant rollback's auth-user deletion and all RPCs are unverified against real Supabase: no staging project. | WP-17 |
| WP-01 state review (SC-2) | `fail_job` / `complete_job` accept any current status (a late failure can flip a completed job); no claim lease, so a timed-out run leaves a job `processing` forever. Guard both with `where status = 'processing'` and add a `started_at` staleness sweep. | WP-10 |
| WP-01 state review (SC-4) | Settings sections are last-writer-wins: two admins editing the same section overwrite each other (billing is built client-side from the cache). Add an expected-`updated_at` check or server-side key merges. | WP-12 |
| WP-01 privacy review (4) | `process-export-job` writes national ID, personal email, kebele/house number, minors' ethnicity and DOB in plaintext with no formula guard; needs a data-minimisation decision and `csvCell`. | WP-12 / WP-04 / WP-10 |
