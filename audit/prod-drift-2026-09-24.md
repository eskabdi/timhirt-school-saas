# Production drift reconciliation (R6 WP-00 step 4)

**Status: read-only reconciliation DONE (§2); deploy PENDING owner approval (§3).**

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

The session later found `SUPABASE_ACCESS_TOKEN` and `VERCEL_TOKEN` in its environment. The read-only checks were run with them; no values were printed or stored.

| Check | Expected | Observed |
|---|---|---|
| Supabase projects | prod + staging | **Only production** (`livqynxlibmccaycseer`, eu-west-1). No staging project exists (WP-17 creates it). |
| Migrations applied on prod | all repo migrations | **105/105 repo migrations applied**, including Round 5. The CLAUDE.md "not deployed" note is stale for the DB. Only `20260924000001_r6_hotfix_contain.sql` (this WP) is outstanding. |
| Edge Functions deployed but not in repo | none | `process-fee-payment` (v7), `telebirr-generate-keypair` (v1), **`telebirr-notify` (v4, verify_jwt=false)**, `telebirr-query-order` (v1) |
| Edge Functions in repo but not deployed | none | none |
| Edge Function code drift | none | All functions last deployed ≤ 2026-08-16. Stale vs repo: EC-today fix `93daaab` (`_shared/ethiopian-date.ts` → `onboard-tenant`, `process-export-job`, `process-import-job`, `run-payroll`); R5 `adc20d8` (`enroll-finalize-billing`). |
| Frontend on Vercel prod | repo HEAD | **`b29ac14`** (2026-08-16, `claude/round5-document-customization`). Missing `adc20d8`, the EC-today fix `93daaab`, and everything after. |
| Telebirr exposure (C-01) | — | `platform_integrations.telebirr.configured = false`, no config keys, no Telebirr Vault secrets, **0 Telebirr payments** (prod has 6 bank + 4 cash, all succeeded). `process-fee-payment` returns 503 while unconfigured, so no pending gateway order can exist and C-01 is **not currently exploitable**. The endpoint is still publicly reachable and must be deleted. |
| PITR | enabled | **Disabled.** Management API lists **0 backups** (walg enabled). ⚠️ G-06: no restore point exists. Enable PITR or a paid plan with daily backups before any production write beyond this WP. |
| Tenants on prod | — | 3 |
| Vercel domains | `edux.et`, `www`, `*.edux.et` | `edux.et` (308 → `www.edux.et`), `www.edux.et`, `timhirt-school-saas.vercel.app`. **`*.edux.et` is not attached to the project**, so wildcard DNS resolves but the project serves no tenant subdomains yet (WP-20). |
| Vercel DNS records (MX/TXT) | preserved | Could not list: the Vercel token lacks the `domainRecord:list` scope. DoH shows no MX/SPF/DMARC. |

## 3. Record after deploying this WP

| Check | Expected after WP-00 deploy | Observed | Date |
|---|---|---|---|
| Migrations unapplied on prod | none (latest `20260924000001`) | _pending_ | |
| Schema diff | empty | _pending_ | |
| Edge Functions deployed but not in repo | none: `telebirr-notify`, `telebirr-query-order`, `telebirr-generate-keypair`, `process-fee-payment` deleted | _pending_ | |
| Edge Functions in repo but not deployed | none | _pending_ | |
| `POST /functions/v1/telebirr-notify` | 404 | _pending_ | |
| Round 5 marker in served bundle (CLAUDE.md "READY is not shipped") | present | _pending_ | |
| PITR enabled (step 1) | yes | _pending_ | |
| Manual backup id before deploy (step 1) | recorded | _pending_ | |
