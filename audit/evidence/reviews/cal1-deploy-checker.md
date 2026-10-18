**Verdict: PASS.** I found no gap in the claimed 2026-10-18 deploy of 61836e2. Nothing was modified. Scratch files are in `/tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/vf/`.

Repo state: HEAD is a890ed3, a descendant of 61836e2. The only changes between them are docs and audit evidence (`git diff --name-only 61836e2 HEAD`). There are no src, supabase or migration changes after the release commit, so a890ed3 does not change what was shipped.

**1. Migrations: PASS** (run through the read-only `q.py` helper against `livqynxlibmccaycseer`)
- `select count(*), max(version) from supabase_migrations.schema_migrations` returned `116 | 20261017000001`.
- Both claimed rows exist: `20261008000001 | academic_calendar_engine` and `20261017000001 | tenant_admin_invite_states`.
- The prod version list is identical to the 116 version prefixes in `supabase/migrations/` (`diff` produced no output).
- Schema is present, not just the bookkeeping rows. All 7 new tables (`edu_authorities`, `calendar_day_types`, `holiday_rules`, `authority_calendars`, `authority_calendar_entries`, `school_calendars`, `school_calendar_entries`) have `relrowsecurity` and `relforcerowsecurity` both true.
- Policies match the migration:
  - The 5 authority/reference tables each have one `*_select` policy.
  - `school_calendars` and `school_calendar_entries` each have `*_select` plus `*_module_gate` (ALL).
- Grants on all 7 tables:
  - `anon`: no select, insert or update.
  - `authenticated`: select only. Insert, update and delete are false.
  - `service_role`: insert is true.
- All 8 triggers exist and are enabled (`O`): the audit and guard triggers on the four calendar tables.
- Function grants:
  - `create_school_calendar(integer,text)` is SECURITY DEFINER with `search_path=public, pg_temp`. It is executable by authenticated and service_role, not anon. That matches the line in `supabase/security/definer_allowlist.sql`.
  - `tenant_admin_invite_states(uuid,uuid)` is SECURITY DEFINER and executable by service_role only. `anon_x`, `auth_x` and `sr_x` came back False, False, True.
  - The invoker calendar functions (`calendar_days`, `calendar_day_status`, `effective_calendar_entries` and others) are executable by authenticated and service_role only. The guard trigger functions and `ec_same_date_next_year` are service_role only.

**2. Edge Functions: PASS**
- `GET /v1/projects/livqynxlibmccaycseer/functions` returned 28 functions, all ACTIVE.
  - The set equals `supabase/functions/*` exactly: no function missing and none extra.
  - `verify_jwt` for all 28 equals `supabase/config.toml` (0 mismatches).
- The four redeployed functions are at the claimed versions with `verify_jwt` true: invite-tenant-admin v10, onboard-tenant v13, invite-staff v6, provision-portal-accounts v6.
- Unauthenticated POST and GET against `https://livqynxlibmccaycseer.functions.supabase.co/<slug>`:
  - All 23 `verify_jwt: true` functions returned 401 `{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}`. This includes all four redeployed ones.
  - The 5 public functions returned 400 `{"error":"Invalid request"}` for an empty body, which is not a JWT 401. These are `submit-admission`, `verify-id`, `upload-admission-document`, `check-admission-status` and `verify-admission-bank-url`.
  - `check-login-attempt` and `sso-domain-lookup` are also `verify_jwt: false` and returned 400. config.toml marks both as public pre-auth gates, so this is intended. The skill's public list is just stale.
  - `chapa-webhook` is in the skill's public list but is neither in the repo nor deployed. Nothing to compare there.
- Deployed source contains the new code. `GET /v1/projects/{ref}/functions/{slug}/body` returned an ~11.8 MB octet-stream bundle for each of the four. `grep -ac` on each found these strings:
  - "Too many invite emails sent recently": 3 hits in `invite-tenant-admin`, 2 in `onboard-tenant`, 2 in `invite-staff`, 3 in `provision-portal-accounts`.
  - `over_email_send_rate_limit`: 5 in every one.
  - `auth_error`: 7 in every one.
  - `createdByThisCall`: 4, 2, 4 and 0. The 0 for `provision-portal-accounts` is correct, because its diff against 463b241 only adds the `logSafeError` import and call.
  - `tenant_admin_invite_states`: 4 in `invite-tenant-admin` and 0 in the other three, matching the repo (only `invite-tenant-admin/index.ts` references it).
- The 463b241..61836e2 diff touches only those four function entrypoints plus `_shared` files, so no other function needed a redeploy. `_shared/security.ts` is unchanged.

**3. Frontend: PASS** (same result on both domains)
- `https://www.edux.et/` and `https://timhirt-school-saas.vercel.app/` each returned 200 and 864 bytes, with `<meta name="app-commit" content="61836e2ed8f3220803144206e46db2b1fadebba6">`.
- Both reference `/assets/index-BN7RzeRf.js`, and that file is byte-identical across the two domains (`cmp`).
- I fetched the entry plus the chunks it references: 4 JS files (`index-BN7RzeRf`, `index-CZYSPii1`, `index-Dpgg72Wy`, `fontkit.es-C9AwvZX_`). Counts over all of them, identical on both domains:
  - `livqynxlibmccaycseer`: 6 (the 0 case is the `--prebuilt` trap, so this rules it out).
  - Anon key: the JWT payload decodes to `{'iss': 'supabase', 'ref': 'livqynxlibmccaycseer', 'role': 'anon'}`. It is the anon role, not service_role.
  - `effective_calendar_entries`: 1, in `index-BN7RzeRf.js`.
  - `arrow keys move between days`: 1.
  - `Wait a while (up to an hour)`: 1.
  - `create_school_calendar`: 1.
  - `tenant_admin_invite_states`: 0 and `61836e2`: 0. Both are expected: the RPC is called only from the Edge Function, not from `src`, and the commit sha is in the HTML meta tag, not the JS.
- `/fonts/NotoSerifEthiopic-Regular.ttf` returned 200 and 219400 bytes with magic `00 01 00 00` on both domains. It is a real TTF, not the index.html rewrite.

**4. Secrets: PASS**
- `git grep -E '(sbp|vcp)_[A-Za-z0-9]{20,}'` on the working tree found nothing.
- The same pattern over the three untracked `audit/evidence/cal1-*` files and `docs/` found nothing.
- A `git log --all -S'sbp_'` pickaxe over history found no added token-shaped lines.
- The literal values of `$SUPABASE_ACCESS_TOKEN` and `$VERCEL_TOKEN` (the latter is set in this environment) appear in zero files in the working tree, untracked files included. I did not print them. The `$SUPABASE_ACCESS_TOKEN` literal also appears in no blob of any commit reachable from `git rev-list --all`.

**Not checked**
- I did not drive the calendar page in a browser, and I did not execute the closed calendar RPCs. The read-only role cannot, as you said.
- I confirmed the RLS policies exist, but I did not run cross-tenant probes against production.
- I only tested for 401 without an Authorization header. I did not send a bogus bearer token.
- The three `audit/evidence/cal1-*.txt` files are still untracked in the repo. Commit them if you want the record kept.