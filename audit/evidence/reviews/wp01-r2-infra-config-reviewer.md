REVIEWER: infra-config-reviewer (independent, read-only)
WP: R6 WP-01. Scope: CI and config, `git diff bae3bfd..ffe8242 -- .github scripts/ci vite.config.ts package.json docs/DEPLOYMENT.md .gitleaksignore`
VERDICT: PASS (no blocker or major findings; 4 minor, 6 info)

I changed no repository files. Everything I built or installed went into the session scratchpad: a scratch venv, gitleaks, deno, a full clone, and build output. I did not write a /tmp/review file; this handback is the report.

FINDINGS

F1 | minor | /home/user/timhirt-school-saas/.gitleaksignore:7-8
- Evidence: two entries point at commit `0188d860…` (blueprint:854 and migration 20260817000004:7). That commit is an ordinary one-parent commit ("audit: add HR/Staff module findings") and does not change either file. I ran gitleaks v8.30.1 over a full, non-shallow clone with `.gitleaksignore` removed. It found exactly 5 fingerprints, and they match the other 5 ignore entries exactly. It never produces the two `0188d860` fingerprints. They look like leftovers from a shallow local clone, where `0188d860` was the cut-off point, so every file looked newly added there. The CI checkout uses fetch-depth 0, so they never match in CI. They are stale, not "exact fingerprints" of real findings. They don't hide anything today.
- Reference: task requirement that ignore entries be exact fingerprints; the file's own header ("pinned by exact fingerprint").
- Fix: delete the two `0188d860` lines. Re-run `gitleaks git .` on a full clone and confirm exit 0.

F2 | minor | /home/user/timhirt-school-saas/package.json:17 (and docs/DEPLOYMENT.md, verify section)
- Evidence: `--build-env VITE_COMMIT_SHA=$(git rev-parse HEAD)` stamps HEAD, but `vercel deploy` uploads the working tree. A deploy from a tree with uncommitted changes is stamped with a SHA that doesn't describe what shipped. DEPLOYMENT.md then says "git rev-parse HEAD # must match", which in that case gives false assurance.
- Reference: CLAUDE.md "A READY deployment is not a shipped deployment"; GK-F4.
- Fix: make `deploy` refuse to run if `git status --porcelain` is non-empty, or stamp `<sha>-dirty`. The regex in `vite.config.ts` would then need to allow the suffix.

F3 | minor | /home/user/timhirt-school-saas/.github/workflows/ci.yml:129-132
- Evidence: `--config p/owasp-top-ten --config p/typescript --config p/react` downloads the registry rules live on every run. The semgrep binary is hash-locked, but the rule content is not. A registry update can turn CI red, or quietly drop coverage, with no repo change. I ran the full command locally: exit 0, 87 rules, 278 files, 0 findings, and 2 files only partly parsed.
- Reference: the determinism requirement in the review brief.
- Fix: snapshot the three packs into `.semgrep/vendor/` and refresh them through a reviewed PR. Or accept the drift as a documented deviation.

F4 | minor | /home/user/timhirt-school-saas/scripts/ci/conventions.py:57-69
- Evidence: `self_test` only checks the fixture lines that exist. If `conventions_fixtures.txt` is emptied, or loses every BAD line for one check, it still prints "ok". `semgrep-rule-test.py` guards the same case with "no `ruleid:` annotations found".
- Reference: CLAUDE.md "Prove a gate fails before trusting that it passed".
- Fix: fail unless every key in CHECKS has at least one BAD fixture that it flags.

F5 | info | /home/user/timhirt-school-saas/supabase/security/deno_check_known.txt:4 and scripts/ci/deno-check.sh
- Evidence: the baseline works per function, not per error. A baselined function (run-payroll, issue-id-card, generate-payslip-pdf) can pick up new errors of any kind and still pass. The header comment names enroll-finalize-billing (WP-04), which is not on the list; that function passes today. The plan (WP-01 item 3) asks for a plain `deno check supabase/functions/**/index.ts`; the ratchet is a documented deviation. I confirmed with deno 2.9.6 that the 3 baselined functions fail only on real TS2339 type errors. The other 25 pass. With deno missing, the script fails closed: 25 FAIL, exit 1.
- Fix: optionally, store the expected error count or a hash per baselined function. Fix the stale comment.

F6 | info | /home/user/timhirt-school-saas/.github/workflows/ci.yml:107
- Evidence: `go-version: "1.24"` installs go1.24.7, but gitleaks v8.30.1 needs go >= 1.24.11. Locally, `go install` switched to go1.26.8 and downloaded it. That download is checksum-verified, so it is deterministic, but it's a hidden second toolchain download.
- Fix: set go-version to match the gitleaks go.mod toolchain (1.26.x).

F7 | info | /home/user/timhirt-school-saas/.github/workflows/ci.yml:20,75,102
- Evidence: checkout uses the default `persist-credentials: true`, so the read-only GITHUB_TOKEN stays in `.git/config` while third-party code runs (semgrep registry rules, go install, npm). The risk is low because top-level `permissions: contents: read` applies.
- Fix: add `persist-credentials: false` to the checkouts. security-scan (line 102) doesn't need the token; for build-and-test, check first that `check:locales` still works against HEAD~1/base on a public repo.

F8 | info | /home/user/timhirt-school-saas/.github/workflows/ci.yml:122
- Evidence: the pip install has no `--only-binary :all:`. If a wheel were missing, pip would build from source, and the build dependencies it pulls in are not hash-checked. I confirmed that every locked package has a wheel for cp312 manylinux x86_64 today, so there is no current exposure.
- Fix: add `--only-binary :all:`.

F9 | info | not verifiable
- Evidence: `gh` is not installed, so I could not confirm that GitHub Actions is green for ffe8242 on PR #9, the follow-up to red run #176. Everything else here comes from local runs of the same commands.
- Fix: the gatekeeper should confirm the CI run for ffe8242 is green before merge.

F10 | info | /home/user/timhirt-school-saas/.github/dependabot.yml
- Evidence: Dependabot covers npm and github-actions weekly, as the plan asks. It does not cover `scripts/ci/requirements-semgrep.txt` (pip). The comment says Deno is deferred to WP-13.
- Fix: optionally add a pip ecosystem entry for /scripts/ci.

CHECKED
- Diff read in full for all listed paths, excluding the lock-file body, which I checked by installing it.
- Least privilege: top-level `permissions: contents: read`, and no job raises it. Triggers are pull_request and push to main only.
- `bash scripts/ci/pinned-actions.sh`: "ok (7 uses, all SHA-pinned)", exit 0. I planted refs in a scratch copy:
  - rejected (exit 1): `@v4`, flow-style `{uses: x@v4}`, a quoted branch name, a 40-hex SHA plus an extra character, an unpinned `docker://` image, a reusable workflow `@v1`, a fake all-caps SHA, and a folded `>-` scalar.
  - accepted (exit 0): `./local` and a real SHA followed by a comment.
- Every pinned SHA matches its tag via `git ls-remote`: checkout v4.4.0, setup-node v4.4.0, setup-deno v2.0.5, setup-go v5.6.0, setup-python v5.6.0.
- `python3 scripts/ci/conventions.py --self-test`: ok, exit 0. The full scan finds 0 in every category, exit 0.
- Semgrep hash lock: installed with `--require-hashes --only-binary :all:` into a fresh venv. semgrep 1.95.0 and setuptools 80.10.2 (so pkg_resources is present) import fine. All wheels resolve for cp312 manylinux. The file header correctly gives setuptools<81 as the #176 root cause.
- `semgrep-rule-test.py`: 10 expected, 0 missing, 0 unexpected, exit 0. A crash is treated as a failure because it requires a JSON report. The full SAST command exits 0.
- Planted-findings test in a scratch clone:
  - gitleaks: "leaks found: 2", exit 1.
  - semgrep: flagged the planted `dangerouslySetInnerHTML` (rule `timhirt-no-dangerously-set-inner-html`), exit 1.
- gitleaks v8.30.1, built via go install as in CI: 0 leaks in the real repo with the ignore file. Without it, 5 findings, and the fingerprints were compared against the ignore file (F1).
- `deno-check.sh` with deno 2.9.6: 28 functions, 3 baselined, ok. With deno missing it fails closed.
- `npm audit --omit=dev --audit-level=high`: exit 0 (2 moderate). `happy-dom` 20.14.5 is in package-lock.
- `npm run typecheck` exists (`tsc --noEmit`).
- app-commit meta: a scratch build stamps `<meta name="app-commit" content="deadbeef">` from `VITE_COMMIT_SHA`. An invalid value (`x;rm`) is rejected and falls back to the git HEAD SHA, so nothing can be injected.
- `docs/DEPLOYMENT.md` verify step is consistent with the meta tag (see F2 caveat).
- Not in this diff, noted only: rls-tests apt-installs Postgres and pgTAP without version pins.
