# INSA documentation — pending changes

Fix plan §0 Rule 7: until WP-18 creates the `docs/insa/` set, every WP appends
the controls, tables, endpoints and roles it changes here. WP-18 folds these
entries into the right documents (SFD, DFD, architecture, OpenAPI, stack
inventory, residual-risk register) and then empties this file.

---

## WP-00 — Containment and Telebirr decommission (2026-09-24)

**Audit purge disabled pending ledger backfill.**
- `public.cleanup_old_audit_logs()`: EXECUTE revoked from `public`, `anon`,
  `authenticated` and `service_role`; any pg_cron job calling it is unscheduled
  (migration `20260924000001_r6_hotfix_contain.sql`).
- Reason: `audit_logs` is the only source of student grade history until the
  WP-08 enrollment ledger exists (RV-05). Retention resumes only as
  archive-not-delete after WP-10.
- SFD → Logging: "Audit logs are currently retained indefinitely; no purge runs."

**Telebirr removed. This version takes manual bank payments only.**
- Edge Functions removed: `telebirr-notify` (Public, unsigned webhook — C-01),
  `telebirr-query-order`, `telebirr-generate-keypair`, `process-fee-payment`
  (L-06: Origin-derived redirect). `_shared/telebirr.ts` deleted.
- DB: `settle_gateway_payment()` revoked from every API role and kept only as
  the Appendix C starting point; `telebirr_token_cache` dropped; Telebirr
  `platform_integrations` row and Vault secrets
  (`telebirr_fabric_app_secret`, `telebirr_private_key_pem`) deleted; provider
  CHECK = SMS providers only; pending gateway orders voided.
- UI: "Pay via Telebirr" buttons and the Telebirr integration card removed.
  Parents currently have **no** in-app payment action. Payments are recorded by
  school staff (`record-fee-payment`) until WP-03 ships manual bank-transfer
  submissions.
- Still present, by design: `telebirr` as a *manual* payment method (wallet
  transfer + receipt URL) in admission/bank-verification flows; WP-03's bank
  catalogue replaces it.
- CI: `scripts/ci/no-payment-gateway.sh` fails the build if gateway code
  reappears.
- Architecture / DFD / stack inventory: remove Telebirr (and Stripe/Chapa) as
  integrations. The third-party network integrations are now: SMS gateways,
  SAML IdPs, bank receipt-verification hosts, **Resend** (Supabase Auth email,
  below), and **Vercel DNS** (authoritative for `edux.et`).
- **Resend / Amazon SES (new processor, 2026-09-24).** Supabase Auth sends invite,
  confirmation and password-reset email through custom SMTP `smtp.resend.com:465`
  as `noreply@edux.et` ("Edux School Management"). Resend relays through Amazon SES
  eu-west-1 (`send.edux.et` MX/SPF, DKIM `resend._domainkey.edux.et`). Data sent:
  recipient email address, display name, and one-time auth links. That makes it
  **Confidential (auth credentials in transit)**. WP-18 needs it in: stack inventory,
  DFD (Supabase Auth → Resend → recipient MX), data classification (processor, EU
  region, retention per the Resend DPA), and the residual-risk register (a leaked
  one-time link lets the holder sign in). The SMTP credential lives only in the
  Supabase dashboard, not in the repo.
- API inventory: the four endpoints above are removed (they must return 404 in
  every environment — see `audit/prod-drift-2026-09-24.md`).
- API contract: `manage-integration-credentials` accepts `provider` ∈
  {`sms_smsala`, `sms_afromessage`, `sms_geezsms`} only, rejects unknown
  top-level fields (`.strict()`), and requires the exact key set per provider:
  `credentials.api_key` for all three, plus `config.sender_id` for AfroMessage.
  The allow-list lives in `manage-integration-credentials/keys.ts`, which the
  Integrations page also imports (review AC-1). It validates the input and checks that the `platform_integrations` row exists before any Vault
  write, and returns 500 (generic) if the row is missing. Classification: Internal
  (super_admin only).
- Edge Function `verify_jwt` (now explicit in `config.toml` for every function):
  `upload-admission-document` = false (public admission upload, rate-limited),
  `invite-tenant-admin` = true, `issue-staff-id` = true.
- CI: the workflow token is read-only (`permissions: contents: read`); a Deno job
  runs the Edge Function unit tests (Deno 2.9.6 from npm, MIT; test dependency
  `jsr:@std/assert@1`); the no-payment-gateway guard runs on every PR.

**Development pipeline.**
- The fix plan now lives in the repo at `docs/audits/timhirt-production-fix-plan.md`.
- 21 read-only reviewer/cartographer subagents are installed under
  `.claude/agents/`, plus the `/wp-run` orchestration command. SFD → Secure
  development: every change is reviewed by independent specialist agents and a
  release gatekeeper (fix plan §0A).

**Domain (`edux.et`).**
- NS delegated to Vercel (verified 2026-09-24). Architecture doc must show:
  Vercel DNS, wildcard `*.edux.et`, and the apex → `www` redirect currently in
  place (the plan wants `www` → apex; see WP-00 record).

### WP-00 owner decisions and accepted deviations (→ WP-18 `10-residual-risk-register.md`)

| ID | Decision | Owner / date | Scope | Expiry / exit condition | Compensating controls |
|---|---|---|---|---|---|
| D-01 | Keep `telebirr` as a **manual** payment method (wallet transfer + receipt URL) and allow the bare word in the CI guard. Fix plan WP-03.1 step 5 wanted every `telebirr` identifier gone. | Owner (eskabdi), 2026-09-24: "Keep telebir" | `registration_payment_method`, `bank_verification_domains`, admission/bank-verification forms, `record-fee-payment` enum | Ends in WP-03, when the bank catalogue replaces the method and the CI guard bans every `telebirr` identifier | The method never credits an invoice by itself (staff record or verify payments). The gateway identifiers themselves are banned by `scripts/ci/no-payment-gateway.sh`, and the gateway endpoints return 404 in production. |
| D-02 | Deploy WP-00 **directly to production without staging**. | Owner, 2026-09-24: "Deploy to production" (after being told no staging project exists) | WP-00 deploy only | Ends in WP-17 (staging project). Every later WP deploys to staging first. | Full local gate (pgTAP 54/54 incl. `r6_hotfix` 21/21, Deno, Vitest, build); mutation-tested by the db-migration reviewer; small, permission-only migration; raw pre/post evidence in `audit/evidence/`. |
| D-03 | Run production **without PITR/daily backups** (plan WP-00 step 1 not met). | Owner, 2026-09-24: "PITR or daily backups requires tier upgrade so that is not mandatory now" | **Standing** until the Supabase tier is upgraded. Applies to every production write until then. | Ends at the tier upgrade (G-06, WP-19). Re-assess before go-live: the §6 go-live gate requires "PITR on; restore drill passed". | Before each production write: a targeted pre-deploy capture committed to `audit/evidence/` (as done for WP-00), `audit_logs.old_data` as the row-level history, forward-fix migrations instead of restores. **Residual risk: no point-in-time recovery for any data loss.** |
| D-04 | Accept equal migration and function counts in place of `supabase db diff --linked` for the WP-00 reconciliation (plan WP-00 step 4). | Owner, 2026-09-24: "matching counts enough" | WP-00 reconciliation | Ends in WP-17: staging gets a full `db diff` in CI | Per-version migration list compared (106 = 106), function list and `verify_jwt` compared (28 = 28), raw evidence in `audit/evidence/`. **Strengthened after review (AZ-1/TI-1):** a catalog comparison needing no DB password: 595 = 595 lines, 0 differences across every policy, RLS/FORCE flag and public function definition, plus 672 = 672 triggers and constraints (`audit/evidence/wp00-prod-catalog-diff-*.txt`). Auth settings and storage buckets were compared as well (`audit/evidence/wp00-prod-auth-storage-config-*.txt`). Buckets are identical. Auth drift is listed as DR-1/DR-2. Residual: table/function ACLs are not compared until WP-01 gives the harness Supabase's default grants. |

**Formerly open items (all answered):**
- ~~O-01~~ **accepted by the owner 2026-09-24 → D-04:** *"matching counts enough"*. `supabase db diff --linked` was not run (no database password in the session); the evidence of repo = production is migrations 106 = 106 and Edge Functions 28 = 28 with `verify_jwt` equal (`audit/prod-drift-2026-09-24.md` §3). A full schema diff runs in WP-17 against staging, where the harness owns the password.
- ~~O-02~~ **closed 2026-09-24:** the owner removed the hostns.io nameservers (DoH now returns only `ns1/ns2.vercel-dns.com`) and moved Supabase Auth email to custom SMTP through Resend (`send.edux.et` MX/SPF and `resend._domainkey` DKIM are live). The owner confirmed an invite email was sent and received. Remaining: the apex has no MX or SPF record, so mail *to* `info@`/`superadmin@edux.et` is not delivered. See `docs/runbooks/domain-edux-et.md`.
- ~~O-03~~ **answered 2026-09-24:** *"The 10 reviewers keep them running"*. The 10 missing reviewers ran against the merged WP-00 diff (`a293cb8..f57d82c`); verdicts are in `audit/FIXES_VERIFIED_R6.md`.

**Library circulation RPCs (WP-00 addendum, migration `20260924000002`).** `library_checkout`, `library_return`, `library_renew` and `library_bulk_return` are service_role-only. In production they were executable by `anon` through Supabase's default privileges, and each takes a caller-supplied `p_tenant_id`. API inventory: classify all four as Internal (called only by `process-library-circulation`). WP-02 generalises this to every definer function.

**Bank verification URLs are https-only (FS-1, migration `20260925000001`).** `bank_payment_verifications.verification_url` has a CHECK `~* '^https://'`. Neither writer (`record-fee-payment`, `verify-admission-bank-url`) stores a non-https URL: each reports verification `failed` / `https_required`. The fee payment itself is still recorded, and the applicant sees the translated https_required message (review RG3-1/RG3-2: the user-facing behaviour is unchanged from before FS-1). The UI renders only https values as links. Control: stored-XSS prevention (OWASP A03). Architecture note for WP-18: `supabase/functions/_shared/https-url.ts` is import-free and shared across the build boundary. The browser imports it through `src/lib/safeUrl.ts`, so both sides apply one rule; the same holds for `manage-integration-credentials/keys.ts`. After review SR3-1, the rule requires the stored string itself to start with `https://` and to contain no whitespace, matching the DB CHECK exactly. Both writers trim first and check the write result.

**Production drift found in the WP-00 reconciliation (2026-09-24, evidence `audit/evidence/wp00-prod-auth-storage-config-*.txt`):**
- ~~**DR-1**~~ **closed 2026-09-25: the owner disabled public sign-up. Verified via the Management API (`disable_signup = true`) and a live `/auth/v1/signup` probe returning 422 `signup_disabled` (`audit/evidence/wp00-dr1-signup-disabled-20260925T072554Z.txt`).** One self-signed-up account from 2026-08-06 (no profile) is for the owner to identify and remove. History: **DR-1 (High, owner action pending): public sign-up is enabled in production.** `config.toml` declares `enable_signup = false` (invite-only), but production reports `disable_signup = false`. Anyone holding the public anon key can create an auth account, and that account then holds the `authenticated` role that every definer function and policy checks against (H-01 blast radius). No flow in `src/` or `supabase/functions/` calls `signUp`, and SSO is unused (0 providers), so disabling it breaks nothing. Two auth accounts exist with no `public.users` profile (2026-08-06 confirmed, 2026-09-24 unconfirmed); the owner should identify them. **Fix:** Dashboard → Authentication → Sign In / Providers → turn off "Allow new users to sign up", or `PATCH /v1/projects/{ref}/config/auth {"disable_signup": true}`.
- **DR-2 (Medium): the auth redirect allow-list has only `timhirt-school-saas.vercel.app` URLs.** `site_url` is `https://www.edux.et`, but `https://www.edux.et/**` and `https://*.edux.et/**` are missing, so a `redirectTo` on the real domain falls back to `site_url`. The repo `config.toml` still has the local `site_url` and no `additional_redirect_urls`. Fix in WP-07/WP-20 (auth redirect wildcards), and record the production values in `config.toml`.
- ~~**DR-4**~~ **closed 2026-09-25 (deployed, verified-prod; `audit/evidence/wp00-closeout-deploy-20260925T072419Z.txt`).** Before: anon could write library data in any tenant. In production, 46/65 SECURITY DEFINER functions are anon-executable (`audit/evidence/wp00-prod-definer-acl-*.txt`). Four take a caller-supplied `p_tenant_id` and write: `library_checkout`, `library_return`, `library_renew`, `library_bulk_return`. Fix ready: migration `20260924000002`, tested. **Exit:** it is applied to production (with the rest of the undeployed closeout set: `20260925000001`, the three Edge Functions and the frontend) and the proacl evidence is committed. The other 41 (the known H-01 set) and `get_security_settings()` (read-only policy thresholds, left open because `AcceptInvitePage` reads it) are closed by WP-02.
- **DR-3 (→ WP-07): password policy** is min length 6, no required character classes, HIBP off, no reauthentication on password change, CAPTCHA off, and no session timebox or inactivity timeout. WP-07 sets these.

## R6 WP-01 — Secure development pipeline and a truthful test harness (L-08)

**Secure development pipeline (INSA Phase 3/5; ISO 27001 A.8.25, A.8.28, A.8.29).** CI now runs on every PR and every push to main:
- The existing gates: typecheck, lint, unit tests (Vitest), i18n, locale parity, build, and pgTAP (61 suites).
- **Supply-chain controls:** every GitHub Action is pinned to a full commit SHA, enforced by `scripts/ci/pinned-actions.sh`. Dependabot runs weekly for npm and github-actions. `npm audit --omit=dev --audit-level=high` runs on every build.
- **Secret scan:** gitleaks v8.30.1 over the full git history. It is built with `go install`, so the binary is checked against the Go checksum database. Reviewed false positives are pinned by exact fingerprint in `.gitleaksignore`.
- **SAST:** semgrep 1.95.0, installed from a hash-locked requirements file (`scripts/ci/requirements-semgrep.txt`, `pip --require-hashes`), runs the repo-owned rules `.semgrep/timhirt-security.yml` plus the OWASP Top 10, TypeScript and React registry packs. The repo rules cover dangerouslySetInnerHTML, HTML-string DOM sinks, eval / new Function, the service-role key in browser code, and plain-http fetch. A fixture self-test (`scripts/ci/semgrep-rule-test.py`) fails CI if a rule stops matching; without a Semgrep login the registry packs alone ran only 4 rules and missed planted sinks.
- **Edge Function type check:** `deno check` runs on all 28 entrypoints, as a ratchet (`supabase/security/deno_check_known.txt`, 4 baselined).
- **Conventions gate (blocking):** `scripts/ci/conventions.py` fails CI on Ge'ez digits, non-ETB currency, or a name that drops the middle name, over src/, Edge Functions, migrations and index.html. A fixture self-test proves each check fires.
- **Dev dependency added:** happy-dom 20.14.5 (MIT; dependencies MIT except entities, BSD-2-Clause). It is the Vitest DOM environment for `RichText.test.tsx` and is not shipped in the bundle.
- **Build provenance:** the commit SHA is stamped into `index.html` as `<meta name="app-commit">`.

**Test harness truth (L-08).**
- `supabase/tests/shim.sql` mirrors Supabase's default privileges. Effective privileges for every public function and table match production exactly (`audit/evidence/wp01-acl-parity-20260925T101802Z.txt`: 191 = 191, and 42 = 42 anon-executable definer functions).
- The runner (`run.sh`) supports TAP TODOs. A known gap is reported; a TODO that starts passing fails the run until it is flipped to a hard assertion.
- Real psql errors fail the run; the word "ERROR:" inside an assertion description no longer does.
- Each run uses a private temp file.

**Catalog guards (ratchets, `supabase/security/`).**

| Guard | Hard now | Baseline (TODO) → WP |
|---|---|---|
| `catalog_definer_security.sql` | no new anon-executable or search_path-less SECURITY DEFINER function; no definer function outside `public` | 42 anon-executable, 13 without search_path → WP-02 |
| `catalog_rls_coverage.sql` | RLS enabled on every table; no new table without FORCE | 11 without FORCE → WP-02 |
| `catalog_module_gate.sql` | no new ungated tenant table; a gate counts only when it is restrictive, covers every command and calls `has_module(`; allow-list entries need a reason | 37 unclassified → WP-06 |
| `catalog_storage_policies.sql` | every storage.objects policy (all commands) has a role/relationship term and a tenant-folder term, classified by content; detector proven on 5 planted shapes; allow-list entries need a reason and must name a real policy | 4 → WP-05 (branding allow-listed: public bucket) |

**Security fixes found by the new gates (verified by tests, not yet deployed):**
- **Stored XSS in the notice/assignment editor** (`RichTextEditor`). Stored HTML was loaded with `el.innerHTML = value`, so `<img onerror>` in another author's notice ran when a staff member opened it for editing. It now loads `sanitizeRichTextNodes()`, which uses the same allow-list as `<RichText/>` and builds nodes with `replaceChildren`. Test: `RichText.test.tsx`, 4 tests; all 4 fail with raw nodes. Control: stored-XSS prevention (OWASP A03).
- **Error paths that threw instead of recovering** (`activate-sso-user`, `process-export-job`, `process-import-job`). They called `.catch()` on PostgREST builders, which have none. The teacher-row rollback never ran, and failed import/export jobs stayed "running". Fixed, and caught by the `deno check` gate.

## R6 (owner decision 2026-09-25) — Names and calendar display

- **Personal names** are rendered First + Middle + Last everywhere (`fullName()`, `src/lib/names.ts` and `supabase/functions/_shared/names.ts`), including fee receipts and documents generated by Edge Functions. Short form: First + Middle.
- **Calendar display settings** (`tenant_configs.settings.calendar`, school admin): show Gregorian equivalent; show the Hijri (Islamic, Umm al-Qura) date; digits `0-9` (default) or Eastern Arabic `٠-٩`. Ge'ez numerals are no longer offered. Dates are still stored Gregorian (§17.2); these settings are presentation-only. A CHECK constraint (migration `20260925000002`) rejects the old `geezNumerals` key and unknown digit systems. Data classification: non-sensitive tenant configuration.
