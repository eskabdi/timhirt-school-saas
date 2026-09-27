# Session handoff (2026-09-26)

For the next Claude Code session on the R6 fix plan
(`docs/audits/timhirt-production-fix-plan.md`). Owner goal: *complete the fix
plan; anything only the owner can do goes into `docs/OWNER_ACTIONS.md`*.

## Where things stand

Branch `claude/timhirt-security-audit-kan0ei`, draft **PR #9** into
`fix/production-readiness-r6`. Commits on top of `da6055e` (production):

| Commit | WP | Review status |
|---|---|---|
| … `c4ecfac` | **WP-01** (harness/CI truth, calendar settings with Eastern Arabic digits and Hijri, full First+Middle+Last names, settings merge RPC, storage guards) | 3 review rounds done plus the missing path-triggered reviewers (payments PASS, privacy PASS, state-concurrency FAIL → fixed in `c4ecfac`). Release gate at `5829420` was FAIL; its findings were fixed in `9ac652f`/`c4ecfac`. **The gatekeeper re-check on `c4ecfac` never ran** (rate limit). CI green on `c4ecfac`. |
| `7c81fd7` | **WP-02** (SECURITY DEFINER lockdown, H-01) | Local gate green; **no reviewers yet**. |
| `455ef8f` | **WP-09** (maker-checker framework, M-06) | Local gate green; **no reviewers yet**. |
| (this file) | handoff | — |

**Do not merge PR #9 until WP-02 and WP-09 have passed their own review
rounds and gatekeeper.** They were pushed here only so the work survives the
container.

Local gate on the full head: tsc 0, eslint 0/0, Vitest 15 files / 96 tests,
check:i18n 0, check:locales OK, build OK, pgTAP 113 migrations / 65 suites,
deno-check OK (3 baselined), Deno tests 37/37, conventions 0, pinned-actions
OK, semgrep rule test 16/0/0, gitleaks clean.

## Next steps, in order

1. Re-run **release-gatekeeper** on WP-01 (`c4ecfac`); inputs are
   `audit/evidence/reviews/wp01-r3-*.md` and the end of
   `audit/FIXES_VERIFIED_R6.md`. GK-2 (round-3 fix surface not re-reviewed)
   waits on owner decision **B4**.
2. Round-1 reviewers for **WP-02** and **WP-09**. Suggested set: security, authz,
   tenant-isolation, code-quality, test-verifier, regression-guardian,
   insa-docs, conventions-guardian, db-migration, api-contract, plus for WP-09
   payments-integrity, state-concurrency, privacy-guardian,
   frontend-security and i18n-a11y. Run them in batches of about 6, because of
   rate limits. Save the verdicts to `audit/evidence/reviews/wp0X-r1-*.md`.
   Allow at most 3 rounds, then the gatekeeper.
3. Continue the plan: **WP-05** next. H-02 is open and High: every role in a
   school can read staff ID and health scans and all report cards (owner item
   B5). Then WP-20, WP-03, WP-04, WP-06, WP-07, WP-08, WP-10 … WP-19.
4. Production deploys only on the owner's explicit "deploy" (B1). The pending
   deploy is:
   - migrations `20260925000002`, `…03`, `20260926000001`, `20260927000001`
     and `…02`;
   - the frontend;
   - 9 Edge Functions for WP-01, plus `record-fee-payment`,
     `issue-fee-document`, `onboard-tenant`, `process-import-job` and
     `process-export-job`.
   Capture `tenant_configs` first, because PITR is off.

## Owner decisions pending (`docs/OWNER_ACTIONS.md`)

- A1–A4: security hygiene (rotate tokens, delete the stray sign-up account,
  revoke Telebirr credentials, MX/SPF).
- B1 / B1a: deploy approval. Heads-up: every date now shows the Gregorian
  date too. Maker-checker makes every manual payment need a second person by
  default.
- B2: WAF A/B.
- B3: native-speaker check.
- **B4**: WP-01 review limit, GK-2.
- **B5**: H-02 containment.
- C1–C4: staging, PITR/backups (urgent), monitoring, operator MFA.
- D1–D3: legal, INSA assessment, named owners.

## Environment notes

- Local Postgres 16 for pgTAP. If it is not running:
  `rm -f /tmp/pgval/postmaster.pid; mkdir -p /tmp/pgsock; chown pgtest /tmp/pgsock; su pgtest -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgval -o '-k /tmp/pgsock -p 5433 -h \"\"' -l /tmp/pgval.log start"`.
  Then run the harness with `PGHOST=/tmp/pgsock PGPORT=5433 PGUSER=postgres PGDATABASE=<fresh db> ./supabase/tests/run.sh`.
  A fresh container may need Postgres, semgrep 1.95.0 (hash-locked in
  `scripts/ci/requirements-semgrep.txt`) and gitleaks set up again.
- Deno: `DENO="npx -y deno@2.9.6" bash scripts/ci/deno-check.sh`. Delete any
  `deno.lock` it leaves behind.
- Tokens (`SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`): never commit, never echo,
  shred after use.
- Owner rules:
  - no Ge'ez numerals; Arabic digits 0-9, with Eastern Arabic as an opt-in;
  - Tayitu is the primary Amharic font, Jiret the secondary;
  - names are First + Middle + Last;
  - Amharic times use the Ethiopian clock;
  - INSA-compliant, secure by default.
