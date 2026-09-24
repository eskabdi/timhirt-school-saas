# R6 — Fixes Verified (production-readiness fix plan)

One entry per Work Package (fix plan §0 Rule 10). Status per finding:
`open` → `fixed (PR #)` → `verified-staging` → `verified-prod`.

---

## WP-00 — Freeze, protect, and reconcile production (G-09, RV-05, C-01, L-06)

**Branch / PR:** `claude/timhirt-security-audit-kan0ei` → `fix/production-readiness-r6` (R6 base, created at `a293cb8`). The PR link is added when the PR is opened.

### Findings

| ID | Status | Evidence |
|---|---|---|
| C-01 (unsigned Telebirr webhook) | **fixed (code)** · verified-staging ✗ · verified-prod ✗ | `telebirr-notify` directory deleted; `settle_gateway_payment` unreachable from every API role; `r6_hotfix.sql` #4–#6; CI guard `scripts/ci/no-payment-gateway.sh`. Production 404 not yet verified: the deployed function must be deleted (`audit/prod-drift-2026-09-24.md`). |
| L-06 (Origin-derived redirect) | **fixed (code)** | `process-fee-payment` removed with the gateway. |
| RV-05 (anon-callable audit purge) | **fixed (code)** | `r6_hotfix.sql` #1–#3: `cleanup_old_audit_logs()` not executable by anon / authenticated / service_role. |
| G-09 (repo ≠ production) | **open — blocked on owner** | No production credentials in this session; see the drift runbook. |

### Implementation

| Step (plan WP-00) | Done | Notes |
|---|---|---|
| 0. `edux.et` DNS checklist | Partial | See the DNS evidence below. The certificate check can't be done from this sandbox (TLS is re-terminated by the egress proxy). |
| 1. PITR confirmed + manual backup id | **Owner** | Needs the production dashboard. |
| 2. Contain the purge (hotfix migration) | Yes | `supabase/migrations/20260924000001_r6_hotfix_contain.sql` |
| 3. Remove Telebirr (WP-03.1) | Yes (repo) · **Owner** (deployed functions) | 4 functions + `_shared/telebirr.ts` deleted; `config.toml`, `manage-integration-credentials`, `IntegrationsPage`, `InvoiceDetailPage`, `InvoicesPage`, 13 locale keys × 3 locales, `DEPLOYMENT.md` updated. Deployed copies must be deleted with `supabase functions delete …`. |
| 4. Reconcile drift | **Owner** | Commands in `audit/prod-drift-2026-09-24.md`. |
| 5. Deploy Round 5 + EC-today fix + this WP | **Owner** | Not done from this session (no credentials, and it needs explicit approval). |
| 6. Install subagent workflow | Yes | 21 agents in `.claude/agents/` (generated from plan Appendix B, B.0 preamble inlined) + `.claude/commands/wp-run.md`; plan copied to `docs/audits/timhirt-production-fix-plan.md`. |

### Deviations from the plan

1. **Scope of "remove Telebirr".** Only the *online gateway* is removed. `telebirr` remains as a *manual* payment method (a wallet transfer proven by a receipt URL, alongside CBE/Awash) in `registration_payment_method`, `bank_verification_domains` and the admission/bank-verification forms. That path never credits anything by itself, and WP-03's bank catalogue replaces it. For the same reason, the CI guard bans gateway identifiers rather than every `telebirr` string; WP-03 tightens it.
2. **`settle_gateway_payment` kept, not dropped.** It is revoked from `public`, `anon`, `authenticated` and `service_role`. It stays as the Appendix C starting point, and its allocation logic is still exercised by `webhook_settlement.sql` and `invoice_consolidation.sql` (run as owner).
3. **`telebirr_gateway.sql` replaced by `r6_hotfix.sql`.** The old suite asserted properties of objects this WP deletes (token cache, Telebirr integration row). The new suite asserts their removal. Settlement allocation coverage is unchanged (see 2).
4. **`service_role` also revoked from `cleanup_old_audit_logs()`.** The plan revokes from `public, anon, authenticated`. Revoking from `service_role` too is stricter and matches the hard stop "do not run the purge until WP-08".
5. **Branching.** The session's working branch is `claude/timhirt-security-audit-kan0ei`. The plan's base `fix/production-readiness-r6` was created from `a293cb8`, and the WP PR targets it.
6. **Parents have no in-app payment action until WP-03.** Accepted consequence of removing the gateway. Staff record payments via `record-fee-payment`.

### Tests and gate (2026-09-24, local)

| Gate | Result |
|---|---|
| `supabase/tests/run.sh` | 106 migrations applied, **54/54 suites passed**; `r6_hotfix.sql` 15/15 |
| Fail-before proof | Without the migration, `r6_hotfix.sql` fails #1–#3 (purge executable), #7 (token cache exists), #8 (Telebirr row present). #4–#6 already pass on the base because the shim doesn't reproduce Supabase's default `service_role` grants — the L-08 blind spot fixed in WP-01. |
| `npx tsc --noEmit` | clean |
| `npx eslint src` | 0 problems |
| `npx vitest run` | 6 files, 50 tests passed |
| `npm run check:i18n` / `check:locales` | 0 hard-coded strings / parity OK, no reformat |
| `npm run build` | built; **0 bundle hits** for `process-fee-payment`, `telebirr-query-order`, `telebirr-generate-keypair` |
| `deno check` (touched functions) | `manage-integration-credentials`, `record-fee-payment`, `verify-admission-bank-url`, `upload-admission-document` OK. `enroll-finalize-billing`: 2 × TS2352, **pre-existing on base** (backlog → WP-04). |
| `scripts/ci/no-payment-gateway.sh` | ok; proven to fail on a planted identifier and a planted function directory |

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

### Owner actions required before WP-00 can be marked verified-prod

1. Confirm PITR is on and take a manual backup; record the backup id here.
2. Run the drift commands in `audit/prod-drift-2026-09-24.md` and fill in its table.
3. Deploy to staging, then production: migrations (incl. `20260924000001`), `supabase functions delete telebirr-notify telebirr-query-order telebirr-generate-keypair process-fee-payment`, redeploy changed functions (`manage-integration-credentials`, `record-fee-payment`, `enroll-finalize-billing`), frontend via `npm run deploy`. Then verify `POST /functions/v1/telebirr-notify` → 404, and grep the served bundle for a marker.
4. Delete any leftover Telebirr Vault secrets by hand if the migration raised the "could not delete" notice.
5. DNS: confirm there was no email on `edux.et` (or restore MX/SPF/DKIM/DMARC); verify the wildcard certificate from outside.
