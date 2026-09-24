# Production drift reconciliation (R6 WP-00 step 4)

**Status: BLOCKED — owner action required.** This session has no Supabase
access token, linked project or Vercel credentials, so the read-only checks
below could not be run. They must run before WP-01 starts, because every later
WP assumes repo = production.

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

## 2. Record the results here

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
