# R6 — Fixes Verified (production-readiness fix plan)

One entry per Work Package (fix plan §0 Rule 10). Status per finding:
`open` → `fixed (PR #)` → `verified-staging` → `verified-prod`.

---

## WP-00 — Freeze, protect, and reconcile production (G-09, RV-05, C-01, L-06)

**Branch / PR:** `claude/timhirt-security-audit-kan0ei` → `fix/production-readiness-r6` (R6 base, created at `a293cb8`). The PR link is added when the PR is opened.

### Findings

| ID | Status | Evidence |
|---|---|---|
| C-01 (unsigned Telebirr webhook) | **verified-prod** (2026-09-24) · verified-staging n/a (no staging project; owner approved prod-direct) | Repo: gateway removed, `r6_hotfix.sql`, CI guard. Prod: 4 endpoints → 404; settlement EXECUTE false for anon/authenticated/service_role (`prod-drift-2026-09-24.md` §3). |
| L-06 (Origin-derived redirect) | **verified-prod** | `process-fee-payment` removed from the repo and deleted in prod (404). |
| RV-05 (anon-callable audit purge) | **verified-prod** | Pre-deploy ACL showed anon/authenticated/service_role EXECUTE. Post-deploy all false. `r6_hotfix.sql` #1–#3, #11. |
| G-09 (repo ≠ production) | **closed for WP-00 scope** | Production = commit `150f99b`: migrations 106 = 106, functions 28 = 28 with matching `verify_jwt`, frontend built from `150f99b`. Remaining: merge PR #7 so the default branch equals production; full `db diff` needs the DB password. |

### Implementation

| Step (plan WP-00) | Done | Notes |
|---|---|---|
| 0. `edux.et` DNS checklist | Partial | See the DNS evidence below. The certificate check can't be done from this sandbox (TLS is re-terminated by the egress proxy). |
| 1. PITR confirmed + manual backup id | **Owner** | Needs the production dashboard. |
| 2. Contain the purge (hotfix migration) | Yes | `supabase/migrations/20260924000001_r6_hotfix_contain.sql` |
| 3. Remove Telebirr (WP-03.1) | Yes (repo) · **Owner** (deployed functions) | 4 functions + `_shared/telebirr.ts` deleted; `config.toml`, `manage-integration-credentials`, `IntegrationsPage`, `InvoiceDetailPage`, `InvoicesPage`, 13 locale keys × 3 locales, `DEPLOYMENT.md` updated. Deployed copies must be deleted with `supabase functions delete …`. |
| 4. Reconcile drift | **Owner** | Commands in `audit/prod-drift-2026-09-24.md`. |
| 5. Deploy Round 5 + EC-today fix + this WP | **Owner** | Not done from this session (no credentials, and it needs explicit approval). |
| 6. Install subagent workflow | Yes | 21 agents in `.claude/agents/` (generated from plan Appendix B, B.0 preamble inlined) + `.claude/commands/wp-run.md`; plan copied to `docs/audits/timhirt-production-fix-plan.md`. |

### Deviations from the plan

1. **Scope of "remove Telebirr".** Only the *online gateway* is removed. `telebirr` remains as a *manual* payment method (a wallet transfer proven by a receipt URL, alongside CBE/Awash) in `registration_payment_method`, `bank_verification_domains` and the admission/bank-verification forms. That path never credits anything by itself, and WP-03's bank catalogue replaces it. For the same reason, the CI guard bans gateway identifiers rather than every `telebirr` string; WP-03 tightens it.
2. **`settle_gateway_payment` kept, not dropped.** It is revoked from `public`, `anon`, `authenticated` and `service_role`. It stays as the Appendix C starting point, and its allocation logic is still exercised by `webhook_settlement.sql` and `invoice_consolidation.sql` (run as owner).
3. **`telebirr_gateway.sql` replaced by `r6_hotfix.sql`.** The old suite asserted properties of objects this WP deletes (token cache, Telebirr integration row). The new suite asserts their removal. Settlement allocation coverage is unchanged (see 2); the old suite's "a voided order never settles" check moved to `webhook_settlement.sql` (RG-3).
4. **`service_role` also revoked from `cleanup_old_audit_logs()`.** The plan revokes from `public, anon, authenticated`. Revoking from `service_role` too is stricter and matches the hard stop "do not run the purge until WP-08".
5. **Branching.** The session's working branch is `claude/timhirt-security-audit-kan0ei`. The plan's base `fix/production-readiness-r6` was created from `a293cb8`, and the WP PR targets it.
6. **Parents have no in-app payment action until WP-03.** Accepted consequence of removing the gateway. Staff record payments via `record-fee-payment`.

### Tests and gate (2026-09-24, local)

| Gate | Result |
|---|---|
| `supabase/tests/run.sh` | 106 migrations applied, **54/54 suites passed**; `r6_hotfix.sql` 21/21 (15 → 19 → 21 across review rounds); `webhook_settlement.sql` 10/10 (RG-3 voided-order check) |
| Fail-before proof | Without the migration, `r6_hotfix.sql` fails #1–#3 (purge executable), #7 (token cache exists), #8 (Telebirr row present), #9 (CHECK still allows telebirr), and #11/#12 (explicitly granted EXECUTE not revoked). #4–#6 pass on the base only because the shim lacks Supabase's default grants (L-08); #11/#12 close that gap by granting first. Mutation-tested by the db-migration reviewer (round 2). |
| `deno test supabase/functions` | 3/3 (`manage-integration-credentials/schema.test.ts`: gateway providers rejected — test-verifier F5). Fails 2/3 when `telebirr` is re-added to the schema. Runs in CI. |
| `npx tsc --noEmit` | clean |
| `npx eslint src` | 0 problems |
| `npx vitest run` | 6 files, 50 tests passed |
| `npm run check:i18n` / `check:locales` | 0 hard-coded strings / parity OK, no reformat |
| `npm run build` | built; **0 bundle hits** for `process-fee-payment`, `telebirr-query-order`, `telebirr-generate-keypair` |
| `deno check` (touched functions) | `manage-integration-credentials`, `record-fee-payment`, `verify-admission-bank-url`, `upload-admission-document` OK. `enroll-finalize-billing`: 2 × TS2352, **pre-existing on base** (backlog → WP-04). |
| `scripts/ci/no-payment-gateway.sh` | ok. Hardened after review (SR-5/F2): proven to fail on camelCase `merchOrderId`/`processFeePayment`, a new `telebirr-webhook` directory and a `config.toml` entry, and to exit 2 (not ok) when a scanned directory is missing |

### DNS evidence — `edux.et` (DNS-over-HTTPS via Cloudflare, 2026-09-24)

| Query | Result | Verdict |
|---|---|---|
| `NS edux.et` | `ns1.vercel-dns.com`, `ns2.vercel-dns.com` | ✅ delegated to Vercel |
| `A edux.et` | `216.198.79.1`, `64.29.17.1` | ✅ Vercel |
| `A www.edux.et` | `64.29.17.1`, `216.198.79.65` | ✅ |
| `A probe-r6check.edux.et` (random label) | `64.29.17.1`, `216.198.79.65` | ✅ wildcard resolves |
| `MX edux.et` | **no records** | ⚠️ owner: confirm the domain never had email. If it did, restore the MX records now. |
| `TXT edux.et` (SPF / verification) | **no records** | ⚠️ same |
| `TXT _dmarc.edux.et` | **no records** | ⚠️ same |
| `https://edux.et` | `308 → https://www.edux.et/`, HSTS `max-age=63072000` (no `includeSubDomains`) | ⚠️ plan wants `www` → apex (WP-20) |
| `https://www.edux.et` | 200, HSTS `max-age=63072000; includeSubDomains; preload` | ✅ |
| `https://probe-r6check.edux.et` | no HTTP response through the sandbox egress proxy | ❓ owner: verify from outside (wildcard added to the Vercel project? certificate `*.edux.et`?) |
| Certificate (`openssl s_client`) | issuer = sandbox egress CA (TLS re-terminated) | ❓ not verifiable here |

### Production facts gathered (2026-09-24, read-only, Management/Vercel API)

Full detail is in `audit/prod-drift-2026-09-24.md`. Relevant to the migration's data effects and to C-01 forensics (DBM-01, SR-3):
- **Telebirr payments in production: 0 in total** (no pending, no succeeded). Production has 6 bank + 4 cash payments, all `succeeded`. So the void step changes 0 rows, and no historical Telebirr settlement exists that could have come from a forged notify.
- Telebirr `platform_integrations` row: `configured = false`, `config` has no `fabric_app_key`, no `our_public_key_pem`. The delete removes an empty row.
- Telebirr Vault secrets in production: **none** (`vault.secrets where name like 'telebirr%'` → 0 rows).
- Telebirr functions **are still deployed** (`telebirr-notify` v4, `verify_jwt=false`). They can't settle anything while unconfigured, but they are still reachable (SR-1, SR-2).

### Rollback / forward-fix plan (DBM-01)

- **Pre-deploy capture:** run just before applying the migration, and paste the output into `prod-drift-2026-09-24.md` §3:
  `select id, tenant_id, invoice_id, amount, provider::text, provider_ref, status::text, created_at from payments where provider not in ('cash','bank');`
  `select * from platform_integrations where provider = 'telebirr';`
  Expected from the facts above: 0 payment rows, 1 empty integration row.
- **Deploy log:** the migration raises notices with the exact row counts (`voided N pending gateway payment(s)`, `deleted N Telebirr platform_integrations row(s)`).
- **Forward-fix, not revert:** if a voided order later proves to have been paid (it appears on the merchant statement), credit it through `record-fee-payment` as a manual bank payment with a **new** reference (the bank-statement reference, or `R6-<original ref>`). `payments.provider_ref` has a global unique index, so the voided row's ref cannot be reused (DBM-07); record the original gateway ref in the payment note. Never set it back to `pending`, because nothing can settle it any more.
- **Recovery source:** `audit_trigger` stores the before-image of every voided payment and of the deleted integration row in `audit_logs.old_data`.
- **Privileges:** re-granting EXECUTE is a one-line forward migration. It is not expected to be needed.
- **Last resort:** PITR/backup restore. ⚠️ No backup exists today (PITR off, 0 backups), so this option doesn't exist until the owner enables backups (G-06).

### Post-deploy verification (SR-4, SR-7, DBM-05, F6) — each must hold, record in the drift table

| Check | Expect |
|---|---|
| `select version from supabase_migrations.schema_migrations where version = '20260924000001'` | 1 row |
| `select has_function_privilege('service_role','public.settle_gateway_payment(text,public.payment_provider,numeric)','execute')` (and for `cleanup_old_audit_logs()`, and for `anon`/`authenticated`) | all `false` |
| `select count(*) from vault.secrets where name like 'telebirr%'` | 0 (don't rely on the migration NOTICE) |
| `select jobid, command from cron.job where command ilike '%cleanup_old_audit_logs%'` | 0 rows (or `cron` schema absent) |
| `select count(*) from platform_integrations where provider = 'telebirr'` | 0 |
| `POST /functions/v1/{telebirr-notify,telebirr-query-order,telebirr-generate-keypair,process-fee-payment}` | 404 each |

Order matters (SR-1/SR-2): **apply the migration first**. That removes the old `telebirr-notify`'s ability to call settlement. **Then delete the four functions with no gap**, which removes the unauthenticated `provider_trans_id` write path in the old Failure/Expired branch.

### Review round 3 fixes

- test-verifier F1: `r6_hotfix.sql` now installs a stand-in `cron.job`, and asserts that the purge job is unscheduled and unrelated jobs are kept (#11–#12 of 21).
- test-verifier F5: `manage-integration-credentials` schema moved to `schema.ts` with a Deno test. **Deploy note:** when deploying this function through the Management API multipart endpoint, include `manage-integration-credentials/schema.ts` alongside `index.ts` and `_shared/security.ts` (the CLI bundles it automatically).
- regression-guardian RG-1 (stale "Configure Telebirr" text in en/am/om), RG-2 (merged locale line restored; line counts equal to base), RG-3 (voided-order assertion in `webhook_settlement.sql`), RG-4 (production `verify_jwt` values recorded in drift §2; backlog row closed).

### Owner decisions (2026-09-24)

- **Deploy approved:** "Deploy to production". Staging skipped (none exists). PITR still off at deploy time.
- **Deviation 1 accepted:** "Keep telebir". `telebirr` stays as a *manual* payment method (wallet transfer + receipt URL) until WP-03's bank catalogue. The CI guard keeps banning gateway identifiers only. This closes test-verifier F2 and security SR-5(d).

### Owner actions still open

1. ~~PITR/backup before deploy~~. Deploy approved without a backup. **Enable PITR or daily backups now (G-06)**; there is still no restore point.
2. ~~Drift reconciliation~~: done (`prod-drift-2026-09-24.md` §2, §3).
3. ~~Deploy + 404 verification~~: done and verified 2026-09-24.
4. ~~Leftover Vault secrets~~: verified 0.
5. DNS / domains (F7): (i) confirm there was never email on `edux.et`, or restore MX/SPF/DKIM/DMARC; (ii) attach `*.edux.et` in WP-20.6; (iii) HSTS preload waits for the WP-20 www→apex flip.
6. Revoke with Ethio Telecom any Telebirr testbed credentials or keypair that were ever issued (SR-4).
7. **Merge PR #7** so the default branch matches production.
8. **Rotate `SUPABASE_ACCESS_TOKEN` and `VERCEL_TOKEN`** after the R6 deploys (SR-8, CLAUDE.md).
