# WP-00 closeout, round 3: insa-docs-auditor (verbatim verdict, HEAD 53b83e2, 2026-09-25)

VERDICT: PASS for the docs scope. The implementer has no blocker or major left. WP-00 closure waits on the owner (O-1 DR-4, O-2 DR-1).

- WP00-R3-1 (minor): the G-09 row in FIXES_VERIFIED listed only part of the undeployed set, and its exit condition had no FS-1 check. → **fixed**: full set listed, plus a check that the constraint is present in prod.
- WP00-R3-2 (minor): `audit/evidence/reviews/` did not exist at 53b83e2. → **fixed**: the round-3 verdicts are committed in this directory.
- WP00-R3-3 (minor): the drift header did not say that §4 records repo ≠ prod. → **fixed**.
- WP00-R3-4 (info): the shared cross-boundary module is not recorded for WP-18. → **fixed** in `_pending-changes.md`.
- O-1 (owner, blocks closure): DR-4. 4 library RPCs are anon-executable in prod (46/65 definer functions). The fix is written and tested but not applied. The docs record this correctly.
- O-2 (owner, blocks closure): DR-1. Public sign-up is enabled in prod. The docs record this correctly.

CHECKED:
- Counts: 108 migrations, 56 pgTAP suites, 28 functions, 28 config.toml entries. CLAUDE.md and README both say 108/56.
- Fresh scratch DB: 108 migrations applied, 56/56 suites passed (r6_hotfix 21/21, r6_hotfix_library_anon 12/12, verification_url_https 5/5, webhook_settlement 10/10).
- Vitest 56 passed, Deno 13/13 passed, check:locales passed.
- The FS-1 code matches `_pending-changes.md`.
- The undeployed set is the same in CLAUDE.md, drift §4 and DR-4.
- The evidence files match the counts they claim (65/46, 595 = 595, 672 = 672).
- The backlog and the INSA pending entries are complete.
- DEPLOYMENT.md deploys all 28 functions.
