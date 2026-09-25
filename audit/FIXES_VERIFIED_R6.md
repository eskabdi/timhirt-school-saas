# R6 — Fixes Verified (production-readiness fix plan)

One entry per Work Package (fix plan §0 Rule 10). Status per finding:
`open` → `fixed (PR #)` → `verified-staging` → `verified-prod`.

---

## WP-00 — Freeze, protect, and reconcile production (G-09, RV-05, C-01, L-06)

**Branch / PR:** `claude/timhirt-security-audit-kan0ei` → `fix/production-readiness-r6` (R6 base, created at `a293cb8`). PR #7 (merged, squash `f57d82c`). Closeout records and review fixes: PR #8.

### Findings

| ID | Status | Evidence |
|---|---|---|
| C-01 (unsigned Telebirr webhook) | **verified-prod** (2026-09-24) · verified-staging n/a (no staging project; owner approved prod-direct) | Repo: gateway removed, `r6_hotfix.sql`, CI guard. Prod: 4 endpoints → 404; settlement EXECUTE false for anon/authenticated/service_role (`prod-drift-2026-09-24.md` §3). |
| L-06 (Origin-derived redirect) | **verified-prod** | `process-fee-payment` removed from the repo and deleted in prod (404). |
| RV-05 (anon-callable audit purge) | **contained, verified-prod** (WP-00); the ledger part stays open → WP-08 | Pre-deploy ACL showed anon/authenticated/service_role EXECUTE. Post-deploy all false. `r6_hotfix.sql` #1–#3, #11. |
| G-09 (repo ≠ production) | **re-opened by the closeout (PR #8)**. Not deployed: migrations `20260924000002` and `20260925000001`; Edge Functions `manage-integration-credentials` (v6 in prod), `record-fee-payment` and `verify-admission-bank-url`; the frontend (IntegrationsPage, and the invoice and admission pages). It closes again once all of that is deployed and verified by: the library proacl query, the constraint `bank_payment_verifications_url_https` present in prod, a 401 probe, and a bundle marker (`platformPagesX.saveFailed` text). Before the closeout: | Production = commit `150f99b`: migrations 106 = 106, functions 28 = 28 with matching `verify_jwt`, frontend built from `150f99b`. PR #7 merged. Full `db diff` replaced by owner decision D-04 plus a password-free catalog diff (0 differences) and an auth/storage config comparison (see Closeout below). |

### Implementation

| Step (plan WP-00) | Done | Notes |
|---|---|---|
| 0. `edux.et` DNS checklist | Partial | See the DNS evidence below. The certificate check can't be done from this sandbox (TLS is re-terminated by the egress proxy). |
| 1. PITR confirmed + manual backup id | **Not met, owner-accepted** | PITR off, 0 backups at deploy time. The owner approved the deploy anyway; a targeted pre-deploy capture (`audit/evidence/wp00-prod-predeploy-capture-20260924.txt`) was the only recovery record. Tracked in `docs/insa/_pending-changes.md` (D-03) and G-06. |
| 2. Contain the purge (hotfix migration) | Yes | `supabase/migrations/20260924000001_r6_hotfix_contain.sql` |
| 3. Remove Telebirr (WP-03.1) | **Yes (repo + prod)** | 4 functions + `_shared/telebirr.ts` deleted in the repo; deleted in prod 2026-09-24 (404 × 4, `audit/evidence/wp00-prod-verification-*.txt`). `config.toml`, `manage-integration-credentials`, `IntegrationsPage`, `InvoiceDetailPage`, `InvoicesPage`, 13 locale keys × 3 locales and `DEPLOYMENT.md` updated. |
| 4. Reconcile drift | **Yes** | Migrations 106 = 106 and function names/`verify_jwt` 28 = 28; frontend commit verified in the served bundle. `supabase db diff --linked` was replaced (D-04) by a catalog diff (policies, RLS/FORCE, function definitions: 0 differences) and an auth-settings/storage-bucket comparison. Buckets are identical; auth drift is DR-1/DR-2 (`docs/insa/_pending-changes.md`). |
| 5. Deploy Round 5 + EC-today fix + this WP | **Yes (prod, no staging)** | Owner-approved 2026-09-24; staging doesn't exist (D-02). Details and timeline in `audit/prod-drift-2026-09-24.md` §3. |
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

- test-verifier F1: `r6_hotfix.sql` now installs a stand-in `cron.job`, and asserts that the purge job is unscheduled and unrelated jobs are kept (#14–#15 of 21).
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
5. DNS / domains (F7): (i) ~~email question~~ answered: auth mail via Resend, but the apex has no MX/SPF, so inbound mail to `info@`/`superadmin@` is not delivered; (ii) attach `*.edux.et` in WP-20.6; (iii) HSTS preload waits for the WP-20 www→apex flip.
6. Revoke with Ethio Telecom any Telebirr testbed credentials or keypair that were ever issued (SR-4).
7. **Merge PR #7** so the default branch matches production.
8. **Rotate `SUPABASE_ACCESS_TOKEN` and `VERCEL_TOKEN`** after the R6 deploys (SR-8, CLAUDE.md).

### Release gatekeeper — WP-00 (2026-09-24, HEAD `c89ccd4`)

**VERDICT: FAIL.** There are no open code or test blockers, and every local gate reproduces green. The WP fails for four reasons: required reviewers are missing, recorded human acceptances are not in the place §0A.4 requires, the production evidence is not reproducible, and WP-00 steps 1 and 4 are incomplete. Review is at the §0A.1 three-round cap, so this is escalated to the owner.

**Reviewer verdicts collected** (`/tmp/review-*.md`): security-reviewer FAIL (round 2, `5dc3868`); db-migration-reviewer PASS (round 2, `5dc3868`); infra-config-reviewer PASS (round 1, `afce13d`); test-verifier FAIL (`5dc3868`); regression-guardian PASS (`5dc3868`). No reviewer verdict covers `551e5a2`, `150f99b`, `c89ccd4` or the production deploy.

**Missing required verdicts:** under §0A.2, §0A.3 and the §0A.6 WP-00 row ("in addition to the 8 core"), these verdicts are required and absent. Core: tenant-isolation-auditor, authz-reviewer, code-quality-reviewer, conventions-guardian, insa-docs-auditor. Triggered: api-contract-reviewer (§0A.6 row, and `supabase/functions/**`), frontend-security-reviewer (`src/**/*.tsx`), i18n-a11y-reviewer (`src/locales/**`), supply-chain-reviewer (`.github/workflows/ci.yml` adds `npx -y deno@2.9.6`), and payments-integrity-reviewer (the migration updates `payments`, and the diff touches fee functions). WP-00 step 6 names only security, db-migration and infra-config. The plan contradicts itself here, and no owner waiver is recorded.

**Gate re-run by the gatekeeper on `c89ccd4` (clean export):**
- `tsc`: 0. `eslint src`: 0. `vitest`: 6 files / 50 tests. `check:i18n`: 0. `check:locales` against the base: parity OK. `build`: OK.
- Deno tests: 3/3. `no-payment-gateway.sh`: ok. It fails on a planted `merchOrderId`, on a `chapa-webhook` directory, and on the base tree.
- pgTAP on a private DB: 106 migrations, 54/54 suites, `r6_hotfix` 21/21, `webhook_settlement` 10/10.
- Mutation checks: removing the cron unschedule fails r6_hotfix #14 and #15. Letting settlement accept `failed` orders fails webhook_settlement #9 and #10.
- The Vitest scope change drops no existing test.
- The repo has 106 migrations and 28 functions. That count matches drift §3.
- The redeploy set covers every importer of `_shared/ethiopian-date.ts`.

**Closed (verified by the gatekeeper):**
- test-verifier: F1 (cron), F5 (Deno schema test), F6.
- regression-guardian: RG-1 to RG-4.
- db-migration-reviewer: DBM-07 and DBM-08.
- infra-config-reviewer: F1 to F6.
- security-reviewer: SR-9.

**Tests added:** `r6_hotfix.sql` (21 assertions), `webhook_settlement.sql` +2, `manage-integration-credentials/schema.test.ts` (3), and the CI guard `scripts/ci/no-payment-gateway.sh`.

**What must change for PASS:**
1. **GK-1 (major, required reviewers missing).** Either run the 10 missing reviewers, or have the owner record a one-time WP-00 bootstrap waiver and fix the step 6 / §0A.6 conflict in the plan. Record the waiver in `docs/insa/_pending-changes.md`.
2. **GK-2 (major, acceptance not recorded where §0A.4 requires it).** Three owner decisions exist only in `audit/`:
   - deviation 1 (bare `telebirr` allowed until WP-03; plan WP-03.1 step 5 is unchanged);
   - skipping staging for "404 on staging" and for step 5 (until WP-17);
   - deploying with PITR off and no backup.

   Record each one in `docs/insa/_pending-changes.md` (no residual-risk register exists yet) with the owner, date, decision, scope and expiry. The owner's words were recorded by the implementer, so the gatekeeper cannot confirm them independently.
3. **GK-3 (major, not verifiable).** C-01 and L-06 are marked "verified-prod". They rest only on the summary table in drift §3. No raw post-deploy output is kept: no curl status lines, no SQL results, no `functions list`. The pre-deploy capture exists only in an ephemeral `/tmp` scratchpad. It matches §3, but it is not committed. The timeline is also inconsistent: the deploy window "~17:22–17:35 UTC" ends after the `c89ccd4` commit time (17:30:49 UTC), and that commit already records the deploy as verified. Fix: re-run the `docs/DEPLOYMENT.md` 404 loop and the six post-deploy SQL checks, commit the timestamped raw output (drift §3 or `audit/evidence/`), and correct the timeline.
4. **GK-4 (major, WP-00 steps incomplete).**
   - Step 1: PITR is off, and there are 0 backups and no backup id.
   - Step 4: `supabase db diff --linked` was not run. G-09 is marked "closed for WP-00 scope" on migration-list equality and function-name counts only.
   - Step 0: the mail-record question is unanswered.

   Fix: enable PITR or backups and record the backup id, run the schema diff and record it, and answer the mail question. Alternatively, the owner accepts each gap as in GK-2.

**Open minors → `audit/backlog.md`:**
- Stale records: `FIXES_VERIFIED_R6` Implementation table rows 1 and 3–5, the drift header line 3, and the duplicated drift line 48. The cron assertion numbers (#14–#15, not #11–#12) are also wrong.
- No UI test shows that IntegrationsPage lists only SMS providers.
- SR-8: token rotation.
- SR-11: the guard does not check provider hosts.
- SR-12: upload-admission-document trusts X-Forwarded-For and the client MIME type.
- Infra F7: `*.edux.et` is not attached and the certificate is unverified.
- Telebirr testbed credentials have not been revoked.

**Residual risks (live today):**
- No restore point exists in production (G-06).
- No staging environment exists.
- `telebirr` remains as a manual method.
- Parents have no in-app payment action until WP-03.
- The audit purge is disabled, so audit logs grow without bound until WP-08 and WP-10.
- PR #7 is unmerged, so the default branch does not equal production.

### Owner decisions after the gatekeeper FAIL (2026-09-24)

- **PITR/backups:** not mandatory now (needs a tier upgrade). Recorded as a standing D-03 in `docs/insa/_pending-changes.md`, with compensating controls. This closes GK-4 step 1 as *accepted*, not *met*.
- **Email (GK-4 step 0 / O-02):** answered. Mail exists on hostns.io. MX, SPF and DKIM are missing from Vercel DNS, and the owner must add them (the token can't write DNS). See `docs/runbooks/domain-edux-et.md`.
- **Merge PR #7:** instructed by the owner. It is merged with the gatekeeper verdict still **FAIL** on two open items the owner hasn't decided: **O-01** (`db diff` needs the DB password) and **O-03 / GK-1** (10 plan-required reviewers not run for WP-00). Both remain open in `docs/insa/_pending-changes.md`. WP-00 is **not** gatekeeper-PASS until they are resolved or waived.

### WP-00 closeout (2026-09-24, PR #8)

**Owner answers:** "matching counts enough" (O-01 → D-04); "edux.et DNS has been resolved and email is at supabase using resend.com … invite user email sent and received successfully" (O-02); "The 10 reviewers keep them running" (O-03 / GK-1). A "next" arrived while this closeout was running. WP-01 starts after the gatekeeper re-run below.

**The 10 missing reviewers** ran against the merged diff `a293cb8..f57d82c`:

| Reviewer | Verdict | Blocking findings → outcome |
|---|---|---|
| tenant-isolation-auditor | PASS | TI-1 (minor): the catalog was not compared → **done**: `audit/evidence/wp00-prod-catalog-diff-*.txt`, 595 = 595 lines, 0 differences |
| authz-reviewer | FAIL | AZ-1 (major): production policies/grants not compared with the repo → **fixed** by the same catalog diff (policies, RLS/FORCE, function secdef/search_path/source). ACL comparison waits for WP-01's shim (see below). |
| code-quality-reviewer | PASS | — |
| conventions-guardian | PASS | — |
| insa-docs-auditor | FAIL | WP00-1 (major): Resend was missing from the integration list → **fixed** in `_pending-changes.md`. WP00-2 (major): auth/storage reconciliation → **done**: `audit/evidence/wp00-prod-auth-storage-config-*.txt`. Minors WP00-3/5/6/7/8 fixed in this PR. |
| api-contract-reviewer | FAIL | AC-1 (major): the Integrations page posted AfroMessage's `sender_id` as a secret, so every save got a 400 → **fixed**: one key allow-list `manage-integration-credentials/keys.ts` imported by the Edge Function and `src/features/platform/integrationPayload.ts`. Tests: Vitest `integrationPayload.test.ts` (3; 2 fail on the old payload shape) and Deno `keys.test.ts` (3). Also fixed: AC-2 (`.strict()`), AC-3 (validate before any Vault write), AC-4/CQ-1 (DB errors and a missing row are checked). |
| frontend-security-reviewer | PASS | FS-1 (pre-existing `javascript:` URL risk in `verification_url`) → backlog **major** for WP-03 §3.11 |
| i18n-a11y-reviewer | PASS | I18N-1/2 fixed while touching the card: every string translated in en/am/om, `role="alert"`, generic error, no `.slice(0, 10)` on `<EthDate>` |
| supply-chain-reviewer | PASS | — |
| payments-integrity-reviewer | PASS | — |

**New live finding from the WP-01 recon (verified on production, read-only):** 46 of 65 `SECURITY DEFINER` functions in `public` are executable by `anon`. Supabase's default privileges grant `anon` an explicit EXECUTE, and `revoke … from public` never removes it. 41 of them are the known H-01 set (WP-02). Five are new:
- `library_checkout`, `library_return`, `library_renew` and `library_bulk_return` take a caller-supplied `p_tenant_id` and write checkouts, copies, holds and fines. Anyone holding the anon key and the UUIDs could write into any tenant.
- `get_security_settings()` only reads policy thresholds. It is left to WP-02, because `AcceptInvitePage` reads it.

**Containment:** `supabase/migrations/20260924000002_r6_hotfix_library_anon.sql` revokes EXECUTE on the four library functions from public, anon and authenticated, keeping service_role for `process-library-circulation`. Test: `r6_hotfix_library_anon.sql`, 12 assertions; 8 fail without the migration. **Not yet applied to production: needs owner approval.**
- **Rollback:** none intended. If it is ever needed, a forward-fix migration re-grants to service_role only, never to anon.
- **After applying to production:** run `select proname, proacl from pg_proc where proname in ('library_checkout','library_return','library_renew','library_bulk_return')`. It must show `{postgres=X/postgres,service_role=X/postgres}` for all four; commit the output under `audit/evidence/`.
- **After WP-01** (the shim gives anon schema usage), add a real `set local role anon` call that must raise 42501 (review DM-2).

**Auth drift found (owner action):**
- **DR-1:** public sign-up is **enabled** in production. The repo declares invite-only. 2 auth accounts have no app profile.
- **DR-2:** the redirect allow-list is missing the `edux.et` hosts.
- **DR-3:** the password/session policy is weak (→ WP-07).

Details are in `docs/insa/_pending-changes.md`.

**Gate (local, this PR's head):**
- `tsc`: 0. `eslint src`: 0.
- `vitest`: 7 files / 53 tests. `check:i18n`: 0. `check:locales`: parity OK.
- `build`: OK. `no-payment-gateway`: ok. Deno tests: 6/6.
- `deno check manage-integration-credentials`: OK.
- pgTAP: 107 migrations, 55/55 suites (`r6_hotfix` 21/21, `r6_hotfix_library_anon` 12/12).

### WP-00 closeout, review round 2 (2026-09-25)

| Reviewer | Verdict | Outcome |
|---|---|---|
| db-migration-reviewer | PASS | DM-1 (rollback and verification plan) and DM-3 (INSA entry) added. DM-2 (real anon call) is queued for after WP-01. |
| api-contract-reviewer | PASS | R2-1 fixed: the row check now runs before any Vault write (43a0551). R2-2 (concurrent config merge) → backlog, WP-12. |
| authz-reviewer | FAIL | F1 = library migration not deployed (**owner decision**, DR-4). F2: trigger/constraint parity added (672 = 672, 0 differences). F3: production definer-ACL evidence committed. F4 = DR-1 sign-up (**owner decision**). |
| insa-docs-auditor | FAIL | R2-1: DR-4 and a library entry added. R2-2: undeployed changes marked, G-09 reopened, counts 107/55. R2-3: code fixed. R2-4: backlog wording. |
| regression-guardian | FAIL | RG-1/RG-2 are the same two **owner decisions**. RG-3/RG-4 were already fixed. RG-7: pagination counts only listed providers. RG-8: `keys.ts` must stay import-free. |
| test-verifier | FAIL | R2-TV-1: `CredentialsPayload` is a branded type, so a hand-built page body fails `tsc` (TS2345, proven by mutation). R2-TV-2: the handler is split into `handler.ts` (injectable) and covered by `handler.test.ts` (4 tests). Removing the pre-write validation fails 2 of them, and moving the row check back after the Vault writes fails 1. R2-TV-3: a `.strict()` test was added; removing `.strict()` fails 1. R2-TV-7: config values must be non-empty. R2-TV-4 = DR-4 (**owner decision**). |

**Gate (local):** `tsc` 0; `eslint src` 0; Vitest 7 files / 54 tests; `check:i18n` 0; `check:locales` OK; build OK; guard ok; Deno 12/12; `deno check` OK. pgTAP last run: 107 migrations, 55/55 suites. No SQL has changed since then, and CI rls-tests is green on 037edbf.

**Open blockers, owner only:** DR-4 (apply `20260924000002` and deploy the function and frontend) and DR-1 (disable public sign-up). Each is either done or accepted as a D-xx row.

### Release gatekeeper — WP-00 closeout (2026-09-25, HEAD `ae40d09`): FAIL

The code fixes were verified in code and tests (AC-1..AC-4, R2-1, R2-TV-1/2/3/7, RG-7/8, the library migration with a non-vacuous suite). Gatekeeper re-run: tsc 0, Vitest 54/54, Deno 12/12, i18n and locales OK, build OK.

| Item | Owner of the fix | Status |
|---|---|---|
| GK-5, DR-4: library anon write live in production | owner | open. Deploy `20260924000002` together with the rest of the undeployed set, or accept it as a D-xx |
| GK-6, DR-1: public sign-up enabled | owner | open. Disable it, or accept it |
| GK-7, FS-1: stored `javascript:` verification URL rendered as a link | implementer | **fixed**, see "FS-1 fix" below |
| GK-8: round-2 fixes not re-reviewed | implementer | round 3 run next (test-verifier, regression-guardian, insa-docs-auditor, authz-reviewer, security-reviewer) |
| GK-9: closeout verdicts not on disk | implementer | round-3 verdicts are saved verbatim under `audit/evidence/reviews/` |
| Minors: stale `keys.ts` comment; DM-2 not in the backlog | implementer | fixed |

#### FS-1 fix

**Change:** `_shared/https-url.ts` (`isHttpsUrl`) is shared by `record-fee-payment`, `verify-admission-bank-url` (Zod `.refine`) and `src/lib/safeUrl.ts` (`httpsHref`). The invoice and admission pages render a link only for https, with `rel="noopener noreferrer"`; anything else renders as plain text. Migration `20260925000001` adds CHECK `verification_url ~* '^https://'`. Production had 0 rows, checked read-only.

**Tests:**
- Deno `https-url.test.ts`: javascript, data, http, protocol-relative and garbage URLs are all rejected.
- Vitest `safeUrl.test.ts` (2).
- pgTAP `verification_url_https.sql` (5): 4 fail without the migration.

**Gate:**
- tsc 0; eslint 0; Vitest 56; Deno 13/13.
- `deno check` on both functions: OK.
- pgTAP on a fresh DB: 108 migrations, 56/56 suites.

### WP-00 closeout, review round 3 (final, 2026-09-25)

Round-3 verdicts are saved as written under `audit/evidence/reviews/wp00-r3-*.md` (GK-9).

| Reviewer | Verdict | Outcome |
|---|---|---|
| authz-reviewer | FAIL: owner-only (DR-4, DR-1). No implementer defects | AZ-R3-4 → backlog (WP-06 `requireAccess` for the Vault writer) |
| security-reviewer | PASS | SR3-1 fixed: the JS https rule now matches the DB CHECK exactly (literal prefix, no whitespace), both writers `.trim()`, and write errors are checked. SR3-2: a pre-apply re-count step added to the deploy order |
| insa-docs-auditor | PASS (docs) | WP00-R3-1, R3-3 and R3-4 fixed. R3-2: this directory now exists |
| regression-guardian | PASS (code) | RG3-1/RG3-2 fixed: a non-https URL returns failed/`https_required` again (no bare 400); the fee payment is still recorded, and the URL is never stored. RG3-3 fixed with TV3-1. RG3-5 → backlog |
| test-verifier | FAIL | TV3-1 (major) fixed: both writers now use `checkAndStoreBankUrl`, covered by `bank-verification-record.test.ts` (9 tests; mutations fail 6 and 1). TV3-2 → backlog (no DOM test library yet). TV3-3: a `typecheck` script was added. TV3-4: noted; reviewers now judge the frozen final SHA |

**Gate (local, after all fixes):**
- `tsc` 0; `eslint src` 0.
- Vitest: 8 files / 56 tests. `check:i18n` 0; `check:locales` OK; build OK; guard ok.
- Deno: 22/22. `deno check` OK on all three touched functions.
- pgTAP on a fresh DB: 108 migrations, 56/56 suites.

The §0A.1 review cap (3 rounds) is now reached. The TV3-1 fix after round 3 goes to the release gatekeeper directly, together with the owner items.

### Release gatekeeper — WP-00 final consolidation (2026-09-25, HEAD `ebb48a5`): FAIL (owner-only)

**Verified in code and tests:**
- TV3-1: both writers call `_shared/bank-verification-record.ts`. Mutation check: removing the https branch fails 6/9 tests; removing the write-error throw fails 1/9.
- SR3-1 and RG3-1/2.
- GK-7 FS-1: two renderers, both via `httpsHref`; the DB CHECK has a 5-assertion suite.
- GK-8: 5 round-3 verdicts. The post-cap TV3-1 fix was verified by the gatekeeper's own mutation check.
- GK-9.

**Gates re-run:** typecheck 0, Vitest 56/56, Deno 22/22, deno check OK on 3 functions. pgTAP was not re-run by the gatekeeper; the 108 migrations / 56 suites figure is the implementer's.

**Implementer items open:** none (blocker/major). New minors: G3-1 (the record said 10 Deno tests; the actual count is 9, now corrected), G3-2 (implementer annotations inside "verbatim" verdicts; see the note in `audit/evidence/reviews/`), G3-3 (writer `index.ts` wiring untested; → backlog with RG3-5).

**Owner items blocking PASS:**
- DR-4: after a zero-row non-https re-count, deploy the undeployed set (20260924000002, 20260925000001, the three Edge Functions, the frontend), then commit the proacl and constraint evidence. Or record a D-xx acceptance.
- DR-1: disable public sign-up, commit the auth-config evidence, and identify the 2 profile-less accounts. Or record a D-xx acceptance.

**Residual risks live today:**
- DR-4: anon library writes across tenants.
- FS-1: stored XSS in prod (fix not yet deployed).
- DR-1: open sign-up.
- 46/65 definer functions anon-executable (WP-02).
- D-03: no PITR.
- D-02: no staging.

WP-00 becomes PASS with no code change once DR-4 and DR-1 are each deployed or accepted.
