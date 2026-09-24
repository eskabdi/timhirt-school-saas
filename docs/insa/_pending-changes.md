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
