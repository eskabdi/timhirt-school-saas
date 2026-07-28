---
name: deploy
description: Ship this repo to production — apply Supabase migrations via the Management API, deploy Edge Functions, and deploy the frontend to Vercel, with the verification each step needs. Use when asked to deploy, migrate, or release.
---

# Deploying this repo

Project ref `livqynxlibmccaycseer` · Vercel project `prj_krmuBBJAUibtVJN6EHmiqa4uLlkV`.

Needs a Supabase Management token (`sbp_…`) and a Vercel token (`vcp_…`) from
the user. Store them with `umask 077` in a `chmod 600` file, never echo them,
and `shred -u` the moment the deploy finishes. Then grep the repo to confirm
neither leaked into a commit.

Order matters: **migrations, then Edge Functions, then the frontend.** The
frontend calls RPCs the migration creates; shipping it first means live errors.

## 1. Migrations

Check what production already has before writing anything:

```bash
curl -s -X POST -H "Authorization: Bearer $SB" -H "Content-Type: application/json" \
  --data "$(python3 -c "import json;print(json.dumps({'query':'select version from supabase_migrations.schema_migrations order by version desc limit 4;'}))")" \
  "https://api.supabase.com/v1/projects/livqynxlibmccaycseer/database/query"
```

Apply each outstanding file in its own request, wrapped in a transaction with
the bookkeeping insert:

```
begin;
<file contents>
insert into supabase_migrations.schema_migrations (version, name)
values ('<version>','<name>') on conflict do nothing;
commit;
```

`ALTER TYPE … ADD VALUE` is fine inside that transaction as long as the new
labels are not *used* in the same one.

Validate locally first — `./supabase/tests/run.sh`, see the `verify` skill.
Reading a migration is not validation; a backfill once joined on a column that
did not exist and only the harness caught it.

Afterwards, assert the result rather than trusting the 201: query the new
columns, `relrowsecurity`, the policy names, the enum labels.

## 2. Edge Functions

All 14 share `_shared/security.ts`, so a change there means redeploying all of
them. Each deploy is a multipart POST carrying the entrypoint plus the shared
files, with `verify_jwt` matching what is already live — public endpoints
(`chapa-webhook`, `check-admission-status`, `submit-admission`,
`upload-admission-document`, `verify-id`) are `false`; everything else `true`.

```bash
curl -X POST -H "Authorization: Bearer $SB" \
  "https://api.supabase.com/v1/projects/livqynxlibmccaycseer/functions/deploy?slug=$SLUG" \
  -F "metadata={\"entrypoint_path\":\"$SLUG/index.ts\",\"name\":\"$SLUG\",\"verify_jwt\":$VJ}" \
  -F "file=@$SLUG/index.ts;filename=$SLUG/index.ts" \
  -F "file=@_shared/security.ts;filename=_shared/security.ts" \
  -F "file=@_shared/ethiopian-date.ts;filename=_shared/ethiopian-date.ts"
```

Run from `supabase/functions/`. **Diff the deployed list against the repo** —
`invite-staff` sat undeployed for days while its UI 404'd, and nothing surfaced
it until the two lists were compared.

## 3. Frontend

```bash
npm run deploy      # rm -rf .vercel/output && npx vercel deploy --prod
```

**Never pass `--prebuilt`.** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
are baked in at build time from the Vercel *project settings*, which a local
build cannot read — a locally built artifact ships `undefined` for both and the
app is a blank page reading `supabaseUrl is required`.

`--prebuilt=false` gives you `--prebuilt`: the flag is boolean and the `=false`
is discarded. That shipped a stale July 18 `.vercel/output` on every deploy for
eight days.

The build log must say `Running "npm run build"`. If it says `Using prebuilt
build artifacts from .vercel/output`, nothing you wrote was deployed.

Uploads occasionally fail with a bare `Error: fetch failed`. Re-run; check the
deployment list before assuming anything shipped.

## 4. Verify — a READY state proves nothing

```bash
BUNDLE=$(curl -s https://timhirt-school-saas.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "https://timhirt-school-saas.vercel.app/$BUNDLE" > /tmp/live.js

grep -c 'livqynxlibmccaycseer' /tmp/live.js   # 0 ⇒ env never baked in, app is blank
grep -coE 'eyJ[A-Za-z0-9_-]{20,}' /tmp/live.js
grep -c '<a string only your change contains>' /tmp/live.js
```

Also confirm `/fonts/NotoSerifEthiopic-Regular.ttf` returns a real TTF (magic
`00010000`) and not ~790 bytes of `index.html` — the SPA rewrite answers 200 for
missing assets, and Ethiopic silently falls back to a font with no Ethiopic
glyphs.

Then hit the endpoints the change touched. Public ones need no auth:
`chapa-webhook` with no signature must be 401; `submit-admission?tenant_slug=…`
returns the grade and fee lists.

## What "done" means

The deploy is done when the served bundle contains the change and the touched
endpoints behave — not when the CLI prints READY.
