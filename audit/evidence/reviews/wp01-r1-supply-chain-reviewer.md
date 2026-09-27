REVIEWER: supply-chain-reviewer
WP: R6 WP-01 (diff bae3bfd..744f1d4, HEAD 744f1d4)
VERDICT: PASS

I found no blocker or major issues. Every action SHA matches its tag. The new dev dependency is necessary, MIT-licensed, has no install scripts and is committed in the lockfile. The runtime audit has no high or critical findings.

FINDINGS:
  - id: SC-1
    severity: minor
    location: scripts/ci/pinned-actions.sh:7-9
    evidence: A planted `- {uses: actions/checkout@v4}` (flow-style YAML) returns exit 0, so it gets past the check. `uses: docker://alpine:latest` is exempt with no digest required. The `# vX.Y.Z` comment is never checked against the SHA. All other planted cases failed as they should (tag, branch on a reusable workflow, quoted tag, `@<sha>x`, `.yaml` extension).
    reference: WP-01 §3 "Pin every action by commit SHA"; OpenSSF Scorecard Pinned-Dependencies
    fix: Parse the workflows as YAML (for example `python3 -c 'import yaml'`) and walk every `uses`. Require `docker://…@sha256:<64hex>`. Optionally cross-check the tag comment with `git ls-remote` in a scheduled job.
  - id: SC-2
    severity: minor
    location: .github/workflows/ci.yml:116,125
    evidence: `pip install semgrep==1.95.0` is not run with `--require-hashes`, so semgrep's dependencies float. `--config p/owasp-top-ten --config p/typescript --config p/react` pulls unversioned registry rules on each run, so the SAST result is not reproducible.
    reference: WP-13 (exact versions); SLSA build reproducibility
    fix: Install from a hashed `requirements-ci.txt` (`pip install --require-hashes -r`). Vendor or snapshot the registry packs, or accept this and log it in audit/backlog.md.
  - id: SC-3
    severity: minor
    location: docs/insa/_pending-changes.md (WP-01 section)
    evidence: The new devDependency `happy-dom@20.14.5` and its 8 transitive dependencies (ws 8.21.3, entities 7.0.1, @types/node 26.6.2, …) are not mentioned anywhere under docs/insa or in audit/FIXES_VERIFIED_R6.md. There is no stack inventory or SBOM yet (docs/insa/ contains only _pending-changes.md).
    reference: Plan §0 rule 7; WP-13 SBOM and stack inventory
    fix: Add one line to the pending changes ("dev: happy-dom 20.14.5, MIT, Vitest DOM environment for RichText.test.tsx") so that WP-13 and WP-18 pick it up.
  - id: SC-4
    severity: info
    location: .github/workflows/ci.yml:109
    evidence: Upstream moved the gitleaks tag v8.30.1. On GitHub, `refs/tags/v8.30.1` now points to 83d9cd68 ("update goreleaser", 2026-03-12). proxy.golang.org records the original commit 8d1f98c7 (2026-02-21), with sum.golang.org `h1:PmEvCfVI7ti9dV3s5aMZUY7sS2GxRvG3yzih7E+cS3w=`. `go install` builds the checksum-locked 8d1f98c7, which is safe and deterministic. However, the release binaries on GitHub for "v8.30.1" come from different code. The module path `github.com/zricethezav/gitleaks/v8` is correct, and its go.mod requires go 1.24.11, which setup-go "1.24" (latest patch) satisfies.
    reference: Supply-chain integrity (tag mutability)
    fix: Nothing to fix. Record the sumdb hash in the evidence so any future bump is reviewed against it.
  - id: SC-5
    severity: info
    location: package-lock.json (dev tree)
    evidence: `npm audit` over all dependencies reports 13 issues: 1 critical (vitest <=4.1.10), 5 high (vite, brace-expansion, browserslist, js-yaml, nanoid) and 7 moderate. None of them is in happy-dom's subtree. Runtime-only audit: 2 moderate (react-router / react-router-dom), 0 high or critical.
    reference: WP-13 ("dev audit = 0 critical")
    fix: WP-13 must handle the vitest upgrade.
  - id: SC-6
    severity: info
    location: package.json:45
    evidence: happy-dom has a single npm maintainer (davidortner). 20.14.5 is the current `latest`, published 2026-09-12. It is actively maintained, and 20.x is past the earlier VM-escape advisory. It is used only by `// @vitest-environment happy-dom` in RichText.test.tsx. tsconfig limits `types` to `["vitest/globals"]`, so the hoisted @types/node 26.6.2 does not leak Node globals into `src`.
    reference: OpenSSF maintainer/bus-factor
    fix: None.
  - id: SC-7
    severity: info
    location: .github/workflows/ci.yml:42-44
    evidence: The inline comment "v2.0.5" is the tag of the setup-deno action, not the Deno version. Deno 2.9.6 is set separately through `deno-version` (and tag v2.9.6 exists at e518fbd6 in denoland/deno). setup-deno downloads Deno without checking a checksum.
    reference: none
    fix: None required.

CHECKED:
  - Checked every SHA with `git ls-remote <repo> refs/tags/<tag> 'refs/tags/<tag>^{}'`. All five are lightweight tags that point directly at the pinned commit:
    - actions/checkout v4.4.0 = 11d5960a…7262
    - actions/setup-node v4.4.0 = 49933ea5…0020
    - denoland/setup-deno v2.0.5 = 22d081ff…d2ed
    - actions/setup-go v5.6.0 = 40f1582b…baff
    - actions/setup-python v5.6.0 = a26af69b…7065
  - The workflow sets `permissions: contents: read` for the whole workflow, and no job widens it. The triggers are `pull_request` (not `pull_request_target`) and push to main. The only `${{ }}` inside a `run:` is `pull_request.base.sha`, which is hex and not attacker-controlled.
  - Tool installs:
    - gitleaks v8.30.1 exists in proxy.golang.org and sum.golang.org (see SC-4).
    - semgrep 1.95.0 exists on PyPI. Semgrep CE is LGPL and is only run in CI, not shipped, so the licence is fine.
    - Deno v2.9.6 tag exists.
  - `bash scripts/ci/pinned-actions.sh` prints "ok (7 uses, all SHA-pinned)", exit 0. I copied it to the scratchpad and ran it against 9 planted cases to prove it fails (results in SC-1).
  - `npm audit --omit=dev --audit-level=high` exits 0 (2 moderate). The full audit is summarised in SC-5.
  - happy-dom:
    - Pinned to exact version 20.14.5 in package.json and in the committed package-lock.json, with integrity hashes.
    - Licences: MIT for happy-dom and all its dependencies, except entities, which is BSD-2-Clause.
    - No `hasInstallScript` in the diff. The only install scripts in the whole lockfile are esbuild and fsevents, both already present before this WP.
    - `npm ls` is consistent.
    - `npx vitest run src/components/ui/RichText.test.tsx` runs 4/4 passing.
    - `npx tsc --noEmit` exits 0.
  - .github/dependabot.yml covers npm (weekly, grouped minor/patch) and github-actions (weekly), with `directory: /`. Deno is not covered, and the file itself notes this is deferred to WP-13.
  - I only read and ran commands. No repository files were edited, and I did not write a review file.
  - Not verified: the CI run on GitHub itself (whether gitleaks and semgrep actually fail on planted findings in Actions). I only saw the implementer's claims in audit/FIXES_VERIFIED_R6.md.

Files referenced:
- /home/user/timhirt-school-saas/.github/workflows/ci.yml
- /home/user/timhirt-school-saas/.github/dependabot.yml
- /home/user/timhirt-school-saas/scripts/ci/pinned-actions.sh
- /home/user/timhirt-school-saas/package.json
- /home/user/timhirt-school-saas/package-lock.json
- /home/user/timhirt-school-saas/docs/insa/_pending-changes.md
