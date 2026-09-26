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
| G-09 (repo ≠ production) | **closed again, verified-prod 2026-09-25** (closeout deploy, `audit/evidence/wp00-closeout-deploy-20260925T072419Z.txt`). History: it was re-opened by the closeout (PR #8). Not deployed: migrations `20260924000002` and `20260925000001`; Edge Functions `manage-integration-credentials` (v6 in prod), `record-fee-payment` and `verify-admission-bank-url`; the frontend (IntegrationsPage, and the invoice and admission pages). It closes again once all of that is deployed and verified by: the library proacl query, the constraint `bank_payment_verifications_url_https` present in prod, a 401 probe, and a bundle marker (`platformPagesX.saveFailed` text). Before the closeout: | Production = commit `150f99b`: migrations 106 = 106, functions 28 = 28 with matching `verify_jwt`, frontend built from `150f99b`. PR #7 merged. Full `db diff` replaced by owner decision D-04 plus a password-free catalog diff (0 differences) and an auth/storage config comparison (see Closeout below). |

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

### Closeout deploy to production (2026-09-25, owner: "Deploy")

**DR-4 closed, verified-prod.**
- The four library RPCs are service_role-only; anon and authenticated have no EXECUTE.
- FS-1 is live in prod: the https CHECK is present and validated, both writers are deployed, and the frontend renders https-only links.
- AC-1 (AfroMessage configurable) is live.
- G-09 closed: repo = production at `da6055e` (108 migrations, 28/28 functions, frontend bundle verified).
- Evidence: `audit/evidence/wp00-closeout-deploy-20260925T072419Z.txt`. Details: `audit/prod-drift-2026-09-24.md` §5.

**Still open (owner decision): DR-1, public sign-up.** The owner approved "Deploy" only, and sign-up was not changed. WP-00 becomes gatekeeper-PASS once DR-1 is either disabled or accepted as a dated D-xx row.

### DR-1 closed (2026-09-25)

The owner disabled public sign-up; the first attempt reverted in the dashboard and the second held. Verified from both sides:
- the Management API reads `disable_signup = true`;
- a live `/auth/v1/signup` with the anon key returns **422 `signup_disabled`**, and no account was created.

Evidence: `audit/evidence/wp00-dr1-signup-disabled-20260925T072554Z.txt`. Owner follow-up: identify and delete the self-signed-up account from 2026-08-06 if it is unknown.

**With DR-4 (deployed) and DR-1 (disabled) both closed, no owner-only item remains for WP-00.** The final gatekeeper stated: "WP-00 becomes PASS with no code change once DR-4 and DR-1 are each deployed or accepted."

### Release gatekeeper — WP-00 final verdict (2026-09-25, HEAD `91fcdc7`): **PASS**

The diff since `ebb48a5` is records and evidence only. There is no code change between the deployed commit `da6055e` and HEAD.
- **DR-4 closed, verified-prod.** `library_*` proacl is service_role-only. Anon-executable definer functions went from 46 to 42. The https CHECK is validated. Evidence: `wp00-closeout-deploy-20260925T072419Z.txt`.
- **G-09 closed.** All four exit checks are in the evidence: proacl, the constraint, the 401 probes and the `platformPagesX.saveFailed` bundle marker. Production has 108 migrations and 28/28 functions with matching `verify_jwt`.
- **DR-1 closed.** The Management API reads back `disable_signup = true`, and a live sign-up probe returned 422 `signup_disabled`. Evidence: `wp00-dr1-signup-disabled-20260925T072554Z.txt`.

**Gates re-run:** typecheck 0, Vitest 56/56, Deno 22/22. pgTAP was not re-run (no SQL change since the last run).

**New minors:**
- GK-F1: re-check `disable_signup` and the 422 probe when WP-01 starts.
- GK-F2: the profile-less self-signed-up account from 2026-08-06; the owner should delete it.

**Info:**
- GK-F3: the two migrations were applied in separate transactions, not one.
- GK-F4: the frontend's commit identity is inferred from bundle markers; embed the SHA from WP-01 on.
- GK-F5: production claims were verified from the committed evidence only.
- GK-F6: the plan's gap table still shows G-09 as open.

**Residual risks:**
- H-01: 42 anon-executable definer functions (WP-02).
- D-02: no staging. D-03: no PITR.
- DR-2 and DR-3.
- RV-05: the ledger part (WP-08).

**WP-00: PASS.**

---

## WP-01 — Make the harness and CI tell the truth (L-08)

**Branch / PR:** `claude/timhirt-security-audit-kan0ei` → `fix/production-readiness-r6` (base `bae3bfd`). PR link added when opened.

### Findings

| ID | Status | Evidence |
|---|---|---|
| L-08 (harness lacked Supabase grants, so anon probes passed vacuously) | **fixed** (harness/CI; nothing to deploy) | The shim mirrors Supabase default privileges. Effective-privilege parity with production is 191 = 191, 0 differences, and 42 = 42 anon-executable definer functions (`audit/evidence/wp01-acl-parity-*.txt`). All 56 existing suites still pass. |
| New (R6-W1-1): stored XSS in the rich-text editor load path | **fixed** (repo; deploy pending) | `RichTextEditor` loads `sanitizeRichTextNodes()` via `replaceChildren`. `RichText.test.tsx` has 4 tests, and all 4 fail with raw nodes. The repo semgrep rule flags the old line 49. |
| New (R6-W1-2): `.catch()` on PostgREST builders (3 Edge Functions) | **fixed** (repo; deploy pending) | At runtime, `typeof builder.catch` is `undefined`, confirmed with Deno. The rollback and `fail_job` calls are now awaited, with errors logged. `deno check` passes on all three; restoring the old code turns `scripts/ci/deno-check.sh` red. |
| DM-2 (WP-00 backlog): real anon calls | **done** | `r6_hotfix_library_anon.sql` #13–#14. Both fail without the migration. |
| GK-F4 (WP-00): commit SHA in bundle | **done** | `<meta name="app-commit">` equals `git rev-parse HEAD` in `dist/index.html`. An invalid `VITE_COMMIT_SHA` is rejected. |
| GK-F1 (WP-00): sign-up stays disabled | **re-verified** at WP-01 start and again in round 2 | `disable_signup = true` (`audit/evidence/wp01-signup-disabled-20260925T203148Z.txt`, read from the Management API with only that field kept). |

### Implementation (plan WP-01)

| Plan item | Done | Notes |
|---|---|---|
| 1. Shim mirrors Supabase defaults | Yes | USAGE on `public` and `ALTER DEFAULT PRIVILEGES FOR ROLE postgres … GRANT ALL ON TABLES/SEQUENCES/FUNCTIONS` to anon, authenticated and service_role, set before any migration runs. |
| 2. Catalog guard suites | Yes, as **ratchets** (recon adjustment 3) | See the four `catalog_*.sql` suites and `supabase/security/*_known.sql`. The allow-lists are `.sql`, not `.txt`, so pgTAP can `\ir` them (adjustment 5). The storage guard also covers `ALL` policies (adjustment 6). |
| 3a. Pin actions by SHA | Yes | 7 `uses:`, all pinned, enforced by `scripts/ci/pinned-actions.sh`. |
| 3b. gitleaks | Yes | Full history. 5 reviewed false positives are pinned by exact fingerprint (round 2 removed 2 stale entries that only a shallow clone produced). The first local scan ran on a **shallow** clone (180 of 256 commits) and missed one, which the first CI run caught; the clone was unshallowed and rescanned (256 commits, clean). |
| 3c. semgrep | Yes, **plus repo rules** | The registry packs alone ran 4 rules and missed planted sinks. The repo rules come with a fixture self-test. |
| 3d. `npm audit --omit=dev --audit-level=high` | Yes | Clean (0 high/critical in runtime deps). |
| 3e. `deno check` | Yes, as a ratchet | 3 of the 7 failing functions were fixed (real bugs). 4 were baselined; round 1 fixed enroll-finalize-billing, so 3 remain. |
| 3f. Dependabot | Yes | npm and github-actions, weekly. |
| 3g. Conventions script | Yes; report-only at first (adjustment 8), **blocking since round 1** | The 8 Ge'ez-digit and 13 name findings were fixed on the owner's request (see below); CI now fails on any finding. |
| Runner | Yes | TAP TODO support, real-error detection, private temp file. |

### Tests: each gate proven to fail before it is trusted

| Gate | Planted / mutation | Result |
|---|---|---|
| `run.sh` | a real failure; an SQL error; plan too short; a TODO that passes | FAIL on each. An open TODO and a description containing "ERROR:" pass. |
| catalog guards | 9 mutations: new anon definer, fixed baseline entry, new table without FORCE, table without RLS, removed FORCE baseline entry, new ungated table, newly gated table, new tenant-only storage policy, new bucket-only storage policy | each fails the intended hard assertion |
| gitleaks | planted `sk_live_…` key in a new commit | exit 1 (1 leak) |
| semgrep repo rules | fixture: 10 `ruleid:` lines and 5 `ok:` lines (16/6 after round 2) | 10/10 matched, 0 unexpected. The old `RichTextEditor` is flagged. A rule-nesting bug was caught by the fixture itself. |
| pinned actions | `setup-node@v4` | exit 1 |
| `deno check` ratchet | old `activate-sso-user` restored | FAIL |
| conventions | planted `"$5"` and `"USD 10"` | 2 currency findings; template literals are not flagged |

### Gate (local, 2026-09-25)

- typecheck 0; `eslint src` 0.
- Vitest: 9 files / 60 tests.
- `check:i18n` 0; `check:locales` OK; build OK.
- no-payment-gateway, pinned-actions, `npm audit` (runtime): all OK.
- Deno tests 22/22; `deno-check.sh` OK (28 functions, 4 baselined).
- semgrep: rule self-test OK; full scan (repo rules + 3 packs) 0 findings.
- gitleaks: history clean.
- pgTAP: 108 migrations, 60/60 suites. The catalog guards show their TODOs: definer 2, RLS 1, module gate 1, storage 1.

**Deploy note:** no migration. The fixes to `RichTextEditor` (frontend) and to 3 Edge Functions ship with the next production deploy.

### Round 1 reviews (13 launched on `744f1d4`)

Six reviewers returned: authz, api-contract, conventions, supply-chain and frontend-security PASS; tenant-isolation FAIL (one major). Their verdicts are saved unedited in `audit/evidence/reviews/wp01-r1-*.md`. The other seven (security, code-quality, test-verifier, regression-guardian, db-migration, infra-config, insa-docs) died on an API rate limit before reporting and are re-run on the fixed head.

| Finding | Severity | Fix | Proof |
|---|---|---|---|
| TI-1 storage guard matched exact text only | major | Classify every `storage.objects` policy (all commands, USING and WITH CHECK) by content: it must carry a role/relationship term and a tenant-folder term. | 5 planted policies (unwrapped tenant-only, `auth.role()`, `bucket_id in (…)`, write tenant-only, role-but-cross-tenant) are each caught; the 4 baselined policies are still the only offenders. |
| TI-2 module gate matched by name only | minor | A gate counts only if restrictive, `polcmd = '*'` and USING calls `has_module(`. | Planted insert-only `with check (true)` gate is not counted; a real gate is. All 56 existing gates still count. |
| TI-3 anon calls accepted any 42501 | minor | Assert the exact message `permission denied for function …`, plus `has_schema_privilege('anon','public','usage')`. | `r6_hotfix_library_anon.sql` 15/15. |
| TI-4 shim granted anon/authenticated `SELECT` on `auth.users` | minor | Removed (only service_role reads it, as on Supabase). | All suites still pass. |
| TI-5 / AZ-5 shim said 46 | info | Comment says 46 before WP-00, 42 now. | — |
| AZ-2 definer guard ignored other schemas | minor | Hard assertion: no SECURITY DEFINER function outside `public` (extensions aside). | ok. |
| AZ-1 `search_path=public` without `pg_temp` | minor | Deferred to WP-02 (it rewrites every definer function). | backlog |
| FE-1 editor kept the unsafe original in form state | minor | After sanitising on load, `onChange(cleaned)` when it differs. | New editor render test mounts `RichTextEditor`; it fails when line 52 is reverted to `innerHTML =`. |
| FE-2 no editor-level test | minor | Same test. | 5/5. |
| SC-1 pinned-actions missed flow-style YAML and docker tags | minor | Match `uses:` anywhere; docker needs `@sha256:<64hex>`. | 5 planted cases each exit 1. |
| SC-2 semgrep deps floated | minor | Hash-locked `scripts/ci/requirements-semgrep.txt`, `--require-hashes`. This was also the **root cause of the red security-scan** (see below). | — |
| SC-3 happy-dom not in the INSA notes | minor | Added to `_pending-changes.md`. | — |
| EF-4 empty baseline printed 1 | info | `grep -c .`. | — |
| CG-1…CG-7 conventions gate | minor | Rewritten: JSX, `+` and `.join` name forms; EUR/GBP, `$${`, Intl `currency:`; `.sql`/`.css`/`.html`/migrations scanned; Ge'ez range written as escapes; fixture self-test; plan text says `conventions.py`. **Now blocking in CI** (0 findings). | `--self-test` ok (19 planted lines). |

**Red security-scan on PR #9 (CI #176), root cause.** `pip install semgrep==1.95.0` let pip pick the newest setuptools (84.0.0). setuptools 81+ no longer ships `pkg_resources`, which semgrep 1.95.0 imports through `opentelemetry-instrumentation` 0.46b0. semgrep died on import with exit 1 and no stdout, and the self-test reported that as a JSON decode error. Reproduced locally with the same install, fixed with a hash-locked dependency file (`setuptools<81`), and the self-test now requires a JSON report and prints semgrep's stderr otherwise. Proven both ways: CI-like install → exit 1 with the `ModuleNotFoundError`; locked install → 10/0/0.

### Owner-directed changes (2026-09-25, pulled forward from WP-14)

| Owner ask | Done | Proof |
|---|---|---|
| Show full names (First + Middle + Last) | `src/lib/names.ts` / `supabase/functions/_shared/names.ts` (`fullName`, `shortName`; staff `father_name` counts as middle). every name render uses it (round 2 also moved the 8 remaining hand-rolled joins onto it), and every students query that feeds them selects `middle_name`. `enroll-finalize-billing` left the `deno check` baseline. | `names.test.ts` 4/4; conventions name-concat 0 and blocking. |
| (Superseded in round 2: trigger normaliser instead of a CHECK, snake_case keys, 15/15.) Remove "Use Ge'ez numerals"; add Arabic numerals (٠١٢٣…) and Hijri options | `settings.calendar.numerals` = `latn` (0-9, default) or `arab` (٠-٩); `settings.calendar.showHijri` shows the Hijri (Umm al-Qura) date beside EC dates. `toGeez` and the toggle are gone. Migration `20260925000002_r6_calendar_numerals.sql` moves any Ge'ez tenant to `latn`, and a CHECK stops `geezNumerals` or an unknown digit system being written back. Hijri month names in en/am/om. | `r6_calendar_numerals.sql` 7/7; `ethiopian-date.test.ts` asserts no U+1369–U+137C in any rendered EC date and checks two known Hijri dates. |

### Gate after round-1 fixes (local)

- typecheck 0; `eslint src` 0; Vitest 10 files / 66 tests; `check:i18n` 0; `check:locales` OK; build OK.
- conventions self-test ok and 0 findings; pinned-actions ok; semgrep self-test 10/0/0 (hash-locked install).
- `deno-check.sh` OK (28 functions, 3 baselined).
- pgTAP: 109 migrations, 61/61 suites; catalog TODOs unchanged (definer 2, RLS 1, module gate 1, storage 1).

**Deploy note (superseded by round 2 below).**

### Round 2 reviews (on `ffe8242`)

Verdicts, unedited: `audit/evidence/reviews/wp01-r2-*.md`. Returned: security PASS, infra-config PASS; tenant-isolation, code-quality, db-migration, regression-guardian, insa-docs and i18n-a11y FAIL (majors below). test-verifier died twice on the API rate limit and is re-run on the fixed head.

| Finding | Severity | Fix | Proof |
|---|---|---|---|
| TI-R2-1: the storage text classifier is fooled by an AND/OR precedence slip | major | New suite `catalog_storage_probe.sql`: seeds a tenant-B object in each of the 15 private buckets and, as a tenant-A user of all 10 roles plus anon, tries SELECT, UPDATE, DELETE (without WHERE, so only the command's own policy applies) and INSERT into tenant B; every write in a rolled-back sub-transaction. | 10/10: clean on the real policies; each planted shape (OR precedence, tenant term inside an OR, cross-tenant insert/update/delete) is caught. |
| M-1 / RG-3: new camelCase jsonb key | major | Calendar keys are `secondary_visible`, `numerals`, `show_hijri`; the reader also accepts legacy camelCase. | `r6_calendar_numerals.sql` 15/15. |
| DM-1 / RG-1 / SEC-WP01-2 / F5: the CHECK broke the production frontend and onboard-tenant (they write `geezNumerals: false`) | major | CHECK replaced by `normalize_calendar_settings()` plus a BEFORE INSERT/UPDATE trigger: legacy writes are normalised, not rejected, so deploy order no longer matters. onboard-tenant now checks every insert, so a failure rolls the tenant back. | Suite asserts the old settings-page upsert and the old onboard insert both save and are stored normalised. |
| DM-2 / SEC-WP01-1 / TI-R2-6: scalar/array/null calendar aborted or corrupted the migration; not idempotent on arrays | major | Normaliser handles every shape (non-object → defaults, invalid values → defaults, extra keys kept). | Suite covers scalar, array, null, invalid numerals, non-boolean `showHijri`; a second run changes nothing. Removing the non-object guard makes the suite error (mutation). |
| DM-3: no rollback, counts or order | major | Migration header: pre-apply production count (3 rows, all `{secondaryVisible: true, geezNumerals: false}`, `audit/evidence/wp01-prod-calendar-and-schema-grants-20260925T154210Z.txt`), expected post-state, forward-fix (drop trigger and function; data stays valid). | — |
| F-01 (i18n-a11y): Gregorian date only in a `title` tooltip | major | Shown as visible text (DD/MM/YYYY, tenant digits) when enabled; Hijri likewise; `text-ink-soft` for AA contrast (F-02). **Visible change:** all 3 production tenants have this setting on (the onboarding default, which never did anything before), so after deploy every date shows its Gregorian equivalent until an admin unticks it. | `EthDate.test.tsx` 5/5. |
| F1–F5, F13 (insa-docs): stale counts and an over-broad parity claim | major/minor | Corrected here, in CLAUDE.md, README and `_pending-changes.md`; residual-risk table added. | — |
| TI-R2-2 / m-10 | minor | Role term must be a role equality, permission/relationship helper or ownership column comparison; string literals blanked; bare EXISTS no longer counts. | 3 planted look-alikes flagged. |
| TI-R2-3 | minor | A module gate must match the exact generated shapes and apply to authenticated/PUBLIC. | 3 planted bypasses flagged; all 56 real gates still count. |
| TI-R2-4 | minor | Allow-listed storage policies carry an md5 fingerprint. | Widening 'public read branding' breaks it. |
| TI-R2-5 / DM-5 | minor | Shim: vault USAGE only for service_role; no API role reads `auth.users` (matches the production capture). | Full harness green. |
| m-2/F-03, m-3/F-04, m-4, m-5, m-6, m-7, m-8, m-9 (code-quality, i18n-a11y) | minor | Preview uses unsaved prefs; save status/error regions; one `useTenantSettings()` hook that throws on error (own sub-key); cached Hijri formatter; editor hands HTML back only when something was removed; 8 hand-rolled name joins moved to `fullName`; `failJobQuietly()` shared helper; baseline comments. | `RichText.test.tsx` 6/6, `_shared/jobs.test.ts` 3/3, `_shared/names.test.ts` 3/3. |
| F-06/F-07/F-08/F-09/F-11 (i18n-a11y) | minor | Oromo "Durduuba", Sha'ban / Dhu al-Qa'dah; picker navigation labels translated; each day labelled with its full EC date, `aria-current="date"` on today; one Gregorian formatter (no leading "="). | locales parity ok. |
| F-10 (i18n-a11y), owner rule | minor | Tayitu (primary) and Jiret (secondary) now render all app Ethiopic text via Ethiopic-only font aliases. | build ok. |
| SEC-WP01-3 | minor | `src/lib/csv.ts`: CSV formula-injection guard for invoice and payroll exports. | `csv.test.ts` 3/3. |
| SEC-WP01-4 | minor | semgrep sink rule adds `execCommand("insertHTML")`, `createContextualFragment`, `setHTMLUnsafe`, `parseHTMLUnsafe`, `srcdoc`, `<iframe srcDoc>`. | Rule self-test 16/0/0. |
| infra F1/F2/F4/F7/F8/F10 | minor | 2 stale gitleaks fingerprints removed (full history still clean); `npm run deploy` refuses a dirty tree; conventions self-test needs a proving fixture per check; `persist-credentials: false`; `--only-binary :all:`; Dependabot pip. | gitleaks 256 commits clean; guard exits 1 on a dirty tree; thinned fixture fails. |
| DM-7 | info | run.sh matches `psql:<any path>: ERROR:`. | — |
| Found while testing (new) | — | In Vitest, i18next-icu loaded intl-messageformat's CommonJS build and every ICU message fell back to its raw text, so i18n in tests proved nothing. `vite.config.ts` inlines both packages. The browser bundle was checked separately (`{date} G.C.` → `25/09/2026 G.C.`); production is not affected. | EthDate tests would fail without it. |

### Gate after round 2 (local)

- typecheck 0; `eslint src` 0 errors, 0 warnings; Vitest 12 files / 75 tests; `check:i18n` 0; `check:locales` OK; build OK.
- conventions self-test ok and 0 findings; pinned-actions ok; semgrep rule test 16/0/0 and full scan (repo rules + 3 packs) 0; gitleaks full history (256 commits) clean.
- `deno-check.sh` OK (28 functions, 3 baselined); Deno tests 28/28.
- pgTAP: 109 migrations, 62/62 suites; catalog TODOs unchanged (definer 2, RLS 1, module gate 1, storage 1).

**Deploy note (round 2).** One migration (`20260925000002`), the frontend, and 9 Edge Functions: `activate-sso-user`, `enroll-finalize-billing`, `issue-fee-document`, `issue-id-card`, `onboard-tenant`, `process-export-job`, `process-import-job`, `provision-portal-accounts`, `record-fee-payment`. Order no longer matters (the trigger accepts old and new writers). Pre-apply check: `select jsonb_typeof(settings->'calendar'), count(*) from tenant_configs group by 1` (expect 3 objects). Post-apply check: 0 rows with any camelCase calendar key; `select count(*) from tenant_configs where settings->'calendar' ? 'geezNumerals'` = 0.


### Round 3 reviews (final round, 7 reviewers)

Verdicts in `audit/evidence/reviews/wp01-r3-*.md`. db-migration and regression-guardian passed. code-quality, i18n-a11y, insa-docs, tenant-isolation and test-verifier failed; every major and most minors are fixed below.

| Finding | Severity | Fix | Proof |
|---|---|---|---|
| CQ M-1 / i18n N-01 / TI-R3-4: Save before the settings load (or after a failed load) overwrote the whole `tenant_configs.settings`, erasing branding, the ID-card template and billing with no backup | major | New migration `20260925000003`: `merge_tenant_settings(section, value)` (SECURITY INVOKER, RLS `configs_write` is the authorization, known sections only, one row-locked UPDATE). Calendar, ID-card, Branding and Fee-structures pages now write only their own section, and Save is disabled until the stored settings have loaded; a load failure shows an alert. | `tenant_settings_merge.sql` 9/9 (other sections untouched, tenant B untouched, teacher and anon refused, unknown section refused); `calendarPrefs.test.tsx` 11/11 (Save disabled while loading and on error, snake_case payload through the RPC). |
| TI-R3-1: a path-keyed OR slip (`… OR foldername[2]='staff' AND role='hr_officer'`) evaded both storage guards | major | Text guard: the tenant-folder comparison must be a top-level AND conjunct right after the bucket test (anchored on the deparsed text; a top-level OR fails the anchor). Probe: tenant-B objects at realistic paths (`staff/<id>/`, three id segments, `front/`, `back/`, and every literal `foldername[k]='…'` in the live policies), inserts at the same paths. | Planted read and write slips are flagged by the text guard and caught by the probe; every shipped policy still passes the anchor (asserted). Storage suites 20/20 (1 TODO WP-05) and 14/14. |
| TI-R3-2 / DM3-3: no cross-tenant update/delete probe in the public `branding` bucket | minor | Tenant-B objects are seeded in public buckets too; only the read check skips public buckets. | Planted branding update and delete policies are caught. |
| TI-R3-3: role "terms" that narrow nothing (`role = role`, `helper(null) OR true`) | minor | Role equality must compare with a literal or literal list; any `OR true` disqualifies. | Both planted shapes flagged. |
| TV-1: student list and class roster showed First and Last only; the name gate missed separate columns and multi-line joins | major | Both tables have a Middle name column. `conventions.py` adds `.concat`, a four-line window for split joins and templates, and `name-render` (a `.tsx` that renders `{x.first_name}` but never a middle name). | The pre-fix versions of both pages are flagged; self-test has proving fixtures for each new form. |
| TV-2: the stored calendar setting → render path and the settings page were untested | major | `calendarPrefs.test.tsx`: parse/serialize (snake_case, camelCase, `geez`, junk), `<EthDate/>` rendering from a mocked stored setting with no `prefs` prop, and the page (options, no Ge'ez, Save gating, RPC payload). | Forcing `numerals` to `latn` or dropping the Save gate fails 4 tests. |
| insa-docs 1, 2 (major), 3, 4 | major/minor | `_pending-changes.md` suite count; README no longer advertises Ge'ez numerals; key totals; backlog name count. | — |
| TV-3: the semgrep hash-lock had no guard | minor | `pinned-actions.sh` also requires every workflow `pip install` to use `--require-hashes -r <file>` and every pin in that file to carry a hash. | Reverting the step, or stripping one pin's hashes, exits 1. |
| RG R3-1 / TV-4: onboard-tenant "rollback" could not delete the tenant once its admin existed (FK NO ACTION) | minor | `_shared/onboard-rollback.ts` deletes periods, tenant_configs, academic_years and users before the tenant, then the invited auth user, and logs any step that fails. | `onboard-rollback.test.ts` 3/3. |
| DM3-1: a write racing the backfill could stay un-normalised | minor | The trigger is created first, then the backfill runs under `SHARE ROW EXCLUSIVE`. | Harness green. |
| DM3-5: the idempotency test could not see a rewrite | minor | It also compares each row's `ctid`. | — |
| DM3-2: production values were not captured | minor | `audit/evidence/wp01-prod-calendar-values-20260926T053918Z.txt`: 3 tenants, `secondaryVisible` = true, `geezNumerals` = false. Header wording corrected: ship the frontend right after the migration. | — |
| RG R3-2: the deploy guard tripped on `__pycache__` | minor | `.gitignore` ignores `__pycache__/`. | — |
| CQ m-3, i-1; i18n N-02, N-03, N-04, N-08, N-09 | minor | ID-card upload guards the profile; `Object.hasOwn` in the sanitiser report; each date segment `whitespace-nowrap`; weekday initials and the ID-card save messages translated; the picker drops its half-built grid roles (day buttons keep full-date labels, `aria-pressed`); `<html lang>` follows the UI language; `<time>` wraps only the EC date. | locales parity ok. |
| Not fixed here | — | CQ m-1 (Zod/RHF for the calendar form; server normalises every write), CQ m-2 (CSV helper API differs from WP-12.1; recorded in the plan), i18n N-05 (no Arabic-digit webfont; OS fallback, recorded as residual risk), N-06 and the new Amharic/Oromo weekday initials (owner B3 native-speaker check), N-07 (component tests beyond the calendar page). | — |

### Gate after round 3 (local)

- typecheck 0; `eslint src` 0 errors, 0 warnings; Vitest 14 files / 88 tests (after the release-gate fix); `check:i18n` 0; `check:locales` OK (common 2189, apply 135, calendar 44); build OK.
- conventions self-test ok and 0 findings; pinned-actions ok (7 uses, 1 pip install hash-locked); semgrep rule test 16/0/0; gitleaks clean; no-payment-gateway ok.
- `deno-check.sh` OK (28 functions, 3 baselined); Deno tests 31/31.
- pgTAP: 110 migrations, 63/63 suites; catalog TODOs unchanged (definer 2, RLS 1, module gate 1, storage 1).

**Deploy note (round 3).** Two migrations (`20260925000002`, `20260925000003`), then the frontend straight after (the old settings page reads only camelCase), and the same 9 Edge Functions as round 2 (`onboard-tenant` now also imports `_shared/onboard-rollback.ts`). Pre/post checks as in round 2, plus: `select has_function_privilege('authenticated', 'public.merge_tenant_settings(text,jsonb)', 'execute')` = true and for `anon` = false.

### Release gate (at 5829420): FAIL, and what followed

Verdict: `audit/evidence/reviews/wp01-r3-release-gatekeeper.md`. The gatekeeper re-ran every gate (all green) and confirmed every round-3 major closed by mutation or planted policies. It failed the WP on:

| Finding | Severity | Status |
|---|---|---|
| GK-1: Branding and Fee structures swallowed a failed settings load (`.data` without checking `error`), so the "Save waits for the load" gate never engaged and Save could write default branding over a school's own | major | **Fixed.** Both queries throw on error; Branding shows the load-error alert; Branding and Classes get their own cache sub-keys (the old shared key could hand Branding a settings-only row and blank the school type on Save). `BrandingPage.test.tsx` 2/2; the pre-fix page fails it. |
| GK-4: `merge_tenant_settings` turned a non-object `settings` into an array | minor | **Fixed** in `20260925000003` (non-object is replaced). `tenant_settings_merge.sql` 10/10. |
| GK-5: Fee structures toggle after a failed load | minor | Fixed with GK-1. |
| GK-7: open minors missing from the backlog | minor | Added to `audit/backlog.md`. GK-6 (Branding's two writes) is there for WP-12. |
| GK-3: path-triggered reviewers (payments-integrity, privacy-guardian, state-concurrency) never ran | major (process) | Run after this fix; verdicts in `audit/evidence/reviews/wp01-r3-*.md`. |
| GK-2: nobody but the gatekeeper reviewed the round-3 fix commit (new migration and RPC), and §0A.1 allows no 4th round | major (process) | **Owner decision**: `docs/OWNER_ACTIONS.md` B4. |
