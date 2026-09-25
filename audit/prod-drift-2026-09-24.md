# Production drift reconciliation (R6 WP-00 step 4)

**Status: read-only reconciliation DONE (§2); WP-00 deploy DONE and verified 2026-09-24 (§3). §4: closeout reconciliation. §5: closeout set deployed 2026-09-25; repo = production again.**

**Access record (SR-8).** At first this session had no credentials and this
runbook was written for the owner to run. Later on 2026-09-24 the owner
instructed: *"For supabase and Vercel tokens check environment variables of this
session."* The session found `SUPABASE_ACCESS_TOKEN` and `VERCEL_TOKEN` in its
environment and used them **read-only**: Management API `GET /projects`,
`/functions` and `/database/backups`, SELECT-only SQL queries, and Vercel
`GET` project/deployment/domain endpoints. No write was made to production. Token
values were never printed, written to disk or committed (the diff and history
were scanned by the security reviewer). The tokens are injected into the
session environment, not stored in the repo. **The owner should rotate both tokens
after the R6 deploys** (CLAUDE.md: deploy tokens are shredded or rotated after
use). The facts in §2 are the session's own query results. The owner can re-run
the §1 commands to confirm them independently.

Known drift, per `CLAUDE.md` (2026-09-21):
- Round 5 (tiered document customization) and the EC-"today" UTC fix
  (commit `15acb4f`) are merged in the repo but **not deployed**: no migration
  applied, no Edge Function redeployed, no `npm run deploy`.
- R6 WP-00 adds migration `20260924000001_r6_hotfix_contain.sql` and removes
  four Edge Functions. That changes the drift further until it ships.

## 1. Commands to run (read-only)

Keep the access token out of shell history and the repo (CLAUDE.md: never
commit, never echo, shred after use).

```bash
supabase link --project-ref <prod-ref>

# Migrations: repo vs production
supabase migration list --linked            # rows with a Local but no Remote version = unapplied
supabase db diff --linked --schema public,storage > /tmp/prod-schema-diff.sql   # expect empty after deploy

# Edge Functions: deployed set vs repo
supabase functions list                      # compare with: ls supabase/functions (minus _shared)

# Auth / storage configuration (dashboard or Management API)
#  - Auth: site URL, redirect URLs, JWT expiry, MFA, password policy, CAPTCHA
#  - Storage: bucket list, public flags, MIME/size limits
```

## 2. Observed (2026-09-24, Management API + Vercel API, read-only)

See the access record at the top of this file.

| Check | Expected | Observed |
|---|---|---|
| Supabase projects | prod + staging | **Only production** (`livqynxlibmccaycseer`, eu-west-1). No staging project exists (WP-17 creates it). |
| Migrations applied on prod | all repo migrations | **105/105 repo migrations applied**, including Round 5. The CLAUDE.md "not deployed" note is stale for the DB. Only `20260924000001_r6_hotfix_contain.sql` (this WP) is outstanding. |
| Edge Functions deployed but not in repo | none | `process-fee-payment` (v7), `telebirr-generate-keypair` (v1), **`telebirr-notify` (v4, verify_jwt=false)**, `telebirr-query-order` (v1) |
| Edge Functions in repo but not deployed | none | none |
| `verify_jwt` of functions that lacked a `config.toml` entry (RG-4) | explicit | Production (`GET /functions`): `upload-admission-document` **false**, `invite-tenant-admin` **true**, `issue-staff-id` **true**. The new `config.toml` entries match these exactly. |
| Edge Function code drift | none | All functions last deployed ≤ 2026-08-16. Stale vs repo: EC-today fix `93daaab` (`_shared/ethiopian-date.ts` → `onboard-tenant`, `process-export-job`, `process-import-job`, `run-payroll`); R5 `adc20d8` (`enroll-finalize-billing`). |
| Frontend on Vercel prod | repo HEAD | **`b29ac14`** (2026-08-16, `claude/round5-document-customization`). Missing `adc20d8`, the EC-today fix `93daaab`, and everything after. |
| Telebirr exposure (C-01) | — | `platform_integrations.telebirr.configured = false`, no config keys, no Telebirr Vault secrets, **0 Telebirr payments** (prod has 6 bank + 4 cash, all succeeded). `process-fee-payment` returns 503 while unconfigured, so no pending gateway order can exist and C-01 is **not currently exploitable**. The endpoint is still publicly reachable and must be deleted. |
| PITR | enabled | **Disabled.** Management API lists **0 backups** (walg enabled). ⚠️ G-06: no restore point exists. Enable PITR or a paid plan with daily backups before any production write beyond this WP. |
| Tenants on prod | — | 3 |
| Vercel domains | `edux.et`, `www`, `*.edux.et` | `edux.et` (308 → `www.edux.et`), `www.edux.et`, `timhirt-school-saas.vercel.app`. **`*.edux.et` is not attached to the project**, so wildcard DNS resolves but the project serves no tenant subdomains yet (WP-20). |
| Vercel DNS records (MX/TXT) | preserved | Could not list: the Vercel token lacks the `domainRecord:list` scope. DoH shows no MX/SPF/DMARC. |

## 3. Deploy of WP-00 (2026-09-24 ~17:21–17:29 UTC, owner-approved)

Owner approval (2026-09-24): *"Deploy to production"* and *"Keep telebir"* (deviation 1 accepted).
Staging was skipped because no staging project exists (WP-17 creates it); the owner approved production directly. PITR was still **off**, with 0 backups.

**Pre-deploy capture** (raw output: `audit/evidence/wp00-prod-predeploy-capture-20260924.txt`):
- Gateway payments (`provider not in ('cash','bank')`): **0 rows**.
- Telebirr integration row: 1 row, `configured=false`, `config={}`.
- Telebirr Vault secrets: none. Token cache: 0 rows. `cron` schema: absent.
- **Live risk confirmed before the fix:** `cleanup_old_audit_logs()` ACL `{=X/postgres,…,anon=X,authenticated=X,service_role=X}`, i.e. callable by anyone (H-01/RV-05). `settle_gateway_payment` ACL `{postgres=X,service_role=X}`, i.e. reachable through the old unsigned `telebirr-notify` (C-01).

**Steps executed:**
1. Migration `20260924000001` applied in one transaction through the Management API, together with its `schema_migrations` row.
2. Deleted Edge Functions `telebirr-notify`, `telebirr-query-order`, `telebirr-generate-keypair` and `process-fee-payment` (each `DELETE` returned 200), immediately after step 1.
3. Redeployed `manage-integration-credentials` (v6, includes `schema.ts`), `record-fee-payment` (v6), `enroll-finalize-billing` (v4), `onboard-tenant` (v8), `process-export-job` (v3), `process-import-job` (v2) and `run-payroll` (v7). Used `supabase functions deploy --use-api` (CLI 2.117.0), which bundles server-side and takes `verify_jwt` from `config.toml`.
4. Frontend: `vercel deploy --prod` built on Vercel's servers (`Running "npm run build"`, no `--prebuilt`). The first attempts failed with a bare `fetch failed`; the deployment list confirmed nothing had shipped, and a retry succeeded. Deployment `timhirt-school-saas-4blhs4gcv` is READY, target production, commit `150f99b`, aliased to `www.edux.et`, `edux.et` and `timhirt-school-saas.vercel.app`.

| Check | Expected | Observed (2026-09-24) |
|---|---|---|
| Migration `20260924000001` on prod | 1 row | ✅ present |
| EXECUTE on `cleanup_old_audit_logs()` / `settle_gateway_payment()` for anon, authenticated, service_role | all false | ✅ all 6 false |
| `platform_integrations` Telebirr rows / provider CHECK | 0 / SMS only | ✅ 0 / `sms_smsala, sms_afromessage, sms_geezsms` |
| `telebirr_token_cache` | dropped | ✅ `to_regclass` null |
| Vault `telebirr%` secrets | 0 | ✅ 0 |
| `cron.job` purge jobs | 0 or no cron | ✅ `cron` not installed |
| Pending gateway payments after | 0 | ✅ 0; real payments untouched (6 bank + 4 cash succeeded) |
| `POST /functions/v1/{telebirr-notify,telebirr-query-order,telebirr-generate-keypair,process-fee-payment}` | 404 | ✅ 404 × 4 (control `verify-id` → 400) |
| Edge Functions deployed vs repo | equal | ✅ 28 = 28, none missing, none extra |
| `verify_jwt` vs `config.toml` | equal | ✅ no mismatches |
| JWT-protected functions without a token | 401 | ✅ `manage-integration-credentials`, `run-payroll` → 401 |
| Served bundle has env baked in | project ref, anon key | ✅ 6 project-ref hits, anon JWT present |
| Served bundle free of gateway code | 0 | ✅ 0 hits across all JS chunks |
| Served bundle carries this WP's change | marker present | ✅ "This version has no online payment gateway" found |
| Fonts served as real TTF | `00010000` | ✅ Tayitu, Jiret, Noto |
| `supabase db diff` (full schema diff) | empty | ⚠️ Not run: needs the database password, which this session doesn't have. The migration set is equal (106 = 106). |

Timeline: pre-deploy capture ~17:21Z → migration ~17:22Z → function deletes ~17:23Z → function redeploys 17:24–17:25Z → Vercel production deployment created 17:28:38Z. The records commit (`c89ccd4`, 17:30:49Z) came after all of these. **Raw post-deploy evidence, re-captured 2026-09-24T17:37:24Z:** `audit/evidence/wp00-prod-verification-20260924T173724Z.txt`. It reproduces the migration, privilege, Telebirr-row, Vault, cron, payments, 404 and function/`verify_jwt` rows. The 401 probes, the bundle env/marker checks and the font bytes were observed at deploy time but are not in that file. "Edge Functions deployed vs repo" compares names and `verify_jwt`, not code: 21 functions were not redeployed by WP-00.

**Repo = production** at commit `150f99b` (PR #7, merged as `f57d82c`).

## 4. Closeout reconciliation (2026-09-24 ~22:17–22:21 UTC, read-only)

| Check | Result | Evidence |
|---|---|---|
| Policies (public + storage), RLS/FORCE per table, public function definitions (secdef, search_path, md5 of source) | **0 differences**: 595 = 595 lines (407 policies, 112 tables, 76 functions) | `audit/evidence/wp00-prod-catalog-diff-20260924T221703Z.txt` |
| Storage buckets (id, public, size limit, MIME list) | **0 differences**: 16 = 16 | `audit/evidence/wp00-prod-auth-storage-config-20260924T222047Z.txt` |
| Auth settings vs `config.toml` | **Drift:** sign-up enabled (repo: invite-only), no `edux.et` redirect URLs, weak password policy, SMTP via Resend | same file; `docs/insa/_pending-changes.md` DR-1..DR-3 |
| Triggers and constraints (public) | **0 differences**: 672 = 672 | `audit/evidence/wp00-prod-catalog-diff-triggers-constraints-*.txt` |
| Function ACLs | Not compared with the repo: the harness shim lacks Supabase default grants (WP-01). Production read directly: **46/65 definer functions anon-executable**, including 4 tenant-writing `library_*` RPCs | `audit/evidence/wp00-prod-definer-acl-*.txt`; containment migration `20260924000002` |

**Undeployed after the closeout (PR #8), so repo ≠ production until the next deploy:**
- migrations `20260924000002_r6_hotfix_library_anon.sql` and `20260925000001_r6_verification_url_https.sql`: repo 108, production 106;
- `manage-integration-credentials`: repo has `keys.ts` and the validate-before-write handler, production runs v6;
- `record-fee-payment` and `verify-admission-bank-url`: https-only verification URL (FS-1);
- frontend (IntegrationsPage AfroMessage fix and translated strings; https-only links on the invoice and admission pages): production runs `150f99b`.

**Deploy order for this set (review SR3-2):** the https CHECK is added validated. Immediately before applying it, re-count `bank_payment_verifications where verification_url !~* '^https://'` on production (it was 0 on 2026-09-25). The old writers can still store a non-https URL until the new functions ship. If the count is not 0, stop and clean the rows up with the owner first. Apply both migrations in one transaction, then deploy the three functions, then the frontend.

## 5. Closeout deploy (2026-09-25 ~07:20–07:35 UTC, owner approval: "Deploy")

Staging still does not exist (D-02). PITR is still off (D-03). The pre-apply re-count of non-https `bank_payment_verifications` rows was 0 (SR3-2).

| Check | Expected | Observed |
|---|---|---|
| Migrations on prod | 108, incl. `20260924000002`, `20260925000001` | ✅ 108; both rows present |
| `library_checkout/return/renew/bulk_return` proacl | `{postgres=X,service_role=X}` | ✅ all four; anon ✗, authenticated ✗, service_role ✓ |
| Constraint `bank_payment_verifications_url_https` | present, validated | ✅ `CHECK (verification_url ~* '^https://')`, convalidated true |
| Edge Functions vs repo | 28 = 28, `verify_jwt` equal | ✅ no missing/extra/mismatch; manage-integration-credentials v7, record-fee-payment v7, verify-admission-bank-url v3 |
| JWT-protected functions without a token | 401 | ✅ manage-integration-credentials, record-fee-payment |
| Frontend | built on Vercel, from `da6055e` | ✅ `Running "npm run build"`, aliased www.edux.et |
| Served bundle | env baked in, closeout markers, no gateway code | ✅ project ref ×21, anon JWT, "Could not save the credentials", `sms_afromessage:["sender_id"]`, the https-only rule, `noopener noreferrer` ×3, gateway identifiers 0 |
| Fonts | real TTF | ✅ Tayitu, Jiret, Noto `00010000` |
| Anon-executable definer functions | — | 42 (was 46; the 4 library RPCs are closed; the remaining 42 are WP-02 scope) |

Raw output: `audit/evidence/wp00-closeout-deploy-20260925T072419Z.txt`. **Repo = production at `da6055e`.**
