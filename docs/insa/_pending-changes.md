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
  integrations; the only third-party network integrations are SMS gateways, SAML
  IdPs and bank receipt-verification hosts.
- API inventory: the four endpoints above are removed (they must return 404 in
  every environment — see `audit/prod-drift-2026-09-24.md`).

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
| D-04 | Accept equal migration and function counts in place of `supabase db diff --linked` for the WP-00 reconciliation (plan WP-00 step 4). | Owner, 2026-09-24: "matching counts enough" | WP-00 reconciliation | Ends in WP-17: staging gets a full `db diff` in CI | Per-version migration list compared (106 = 106), function list and `verify_jwt` compared (28 = 28), raw evidence in `audit/evidence/`. Residual: out-of-band dashboard edits to production schema would not be detected. |

**Formerly open items (all answered):**
- ~~O-01~~ **accepted by the owner 2026-09-24 → D-04:** *"matching counts enough"*. `supabase db diff --linked` was not run (no database password in the session); the evidence of repo = production is migrations 106 = 106 and Edge Functions 28 = 28 with `verify_jwt` equal (`audit/prod-drift-2026-09-24.md` §3). A full schema diff runs in WP-17 against staging, where the harness owns the password.
- ~~O-02~~ **closed 2026-09-24:** the owner removed the hostns.io nameservers (DoH now returns only `ns1/ns2.vercel-dns.com`) and moved Supabase Auth email to custom SMTP through Resend (`send.edux.et` MX/SPF and `resend._domainkey` DKIM are live). The owner confirmed an invite email was sent and received. Remaining: the apex has no MX or SPF record, so mail *to* `info@`/`superadmin@edux.et` is not delivered. See `docs/runbooks/domain-edux-et.md`.
- ~~O-03~~ **answered 2026-09-24:** *"The 10 reviewers keep them running"*. The 10 missing reviewers ran against the merged WP-00 diff (`a293cb8..f57d82c`); verdicts are in `audit/FIXES_VERIFIED_R6.md`.
