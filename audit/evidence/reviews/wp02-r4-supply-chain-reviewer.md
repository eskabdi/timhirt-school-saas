REVIEWER: supply-chain-reviewer
WP: WP-02
VERDICT: PASS

FINDINGS:
  - id: SC-1
    severity: minor
    location: scripts/db/bench-rls-helpers.sh:9
    evidence: The script writes `insert into auth.users …`, `insert into public.tenants …` and 150k attendance rows to whatever database the `PG*` variables point at. The only protection is a comment: "a migrated harness database, never production". There is no check on the host or the database name before it runs.
    reference: OWASP A05 (security misconfiguration) / INSA change management. Production has PITR off and no backups (CLAUDE.md).
    fix: Stop the script before the first `psql` when `PGHOST` matches `supabase.(co|com)` or `pooler.supabase`, or when the database has no `supabase/tests/shim.sql` marker. Alternatively, require an explicit `BENCH_I_AM_ON_A_HARNESS=1`.
  - id: SC-2
    severity: info
    location: scripts/ci/app-rpc-grants.py:23
    evidence: The scan only sees literal names (`rpc("name"` / `rpc<T>("name"`). If an RPC name is computed at runtime (`supabase.rpc(name, …)`), it is silently left out. Today the only such call is the dashboard wrapper at src/features/dashboard/useDashboardData.ts:61, and its callers pass literals that the typed-wrapper regex catches (all 23 names match an independent grep).
    reference: Note on gate completeness
    fix: Optional. Fail when a non-literal `.rpc(` call appears outside an allow-listed wrapper, so a new dynamic call site cannot get past the check without being noticed.
  - id: SC-3
    severity: info
    location: .github/workflows/ci.yml:98-105
    evidence: The new step depends on `supabase/tests/run.sh` leaving the migrated schema in `PGDATABASE=postgres`. I confirmed that run.sh only cleans up a temp file (`trap 'rm -f "$MIG_TMP"'`) and does not drop or recreate the database, so the dependency holds. Because the step comes straight after run.sh in the same job, it gets skipped if the pgTAP step fails. That is acceptable, since the job is already red in that case.
    reference: none
    fix: None needed.

CHECKED:
  - I diffed the scoped paths over the whole WP-02 range (c4ecfac..98b78e3, including all the round-1/2/3 fix commits). Only four files changed: `.github/workflows/ci.yml` (+8), `scripts/ci/app-rpc-grants.py` (new), `scripts/db/bench-rls-helpers.sh` (new), `scripts/db/definer-inventory.py` (new).
  - Dependencies: nothing changed in any `package.json`, `package-lock.json`, `deno.json`, `deno.lock`, `import_map.json` or `requirements*.txt`. No new `npm:`, `jsr:` or esm/deno.land imports in `supabase/functions`, and no `create extension` in the WP-02 migrations. Since nothing was added, no licence or maintenance review applies, and neither the stack inventory nor the SBOM needed updating.
  - The new scripts use only the Python standard library (os, re, subprocess, sys, pathlib) plus psql and bash, which the rls-tests job already installs (`postgresql-client-16`). No pip or npm installs, so no install scripts. The walrus operator needs Python 3.8 or later; ubuntu-latest ships 3.12.
  - GitHub Actions: the WP added no new `uses:`. All the existing ones (checkout, setup-node, setup-deno, setup-go, setup-python) are pinned to a 40-character SHA with a version comment.
  - `npm audit --omit=dev --audit-level=high`: exit 0. It reports 2 moderate issues and no high or critical ones.
  - `app-rpc-grants.py` safety: RPC names are restricted to `[A-Za-z_][A-Za-z0-9_]*` before they are put into SQL, so the `values` list cannot be injected into. psql runs with `-X`. A psql error makes the script exit 1, and so does finding zero RPCs.
  - `app-rpc-grants.py` behaviour, tested on a scratch database I created on the local test cluster (/tmp/pgsock:5433):
    - The full `supabase/tests/run.sh` passed ("All suites passed").
    - `--self-test` printed ok.
    - A real run reported 23 app RPCs and 0 findings, exit 0.
    - I then proved it fails: after revoking EXECUTE on `create_import_job(uuid,text,integer)` from authenticated and renaming `dashboard_billing`, it reported "closed create_import_job … ImportExportPage.tsx:63" and "missing dashboard_billing … useDashboardData.ts:184", exit 1.
    - I dropped the scratch database afterwards.
  - The 23 names the script extracts match an independent grep of `src/`.
  - `definer-inventory.py`: `psql` runs with `--no-psqlrc` and `check=True`, and the script writes only to `supabase/security/definer_inventory.md`. It is not wired into CI and makes no network calls.
  - The CI step chains `--self-test && run`, so a broken regex fails the build.
  - No secrets or tokens were added. The CI credentials (`postgres`/`postgres`) are for the local runner cluster only, the same values as the existing step.
  - Cleanup: the worktree is clean (`git status` shows nothing), there is no `deno.lock`, and no `__pycache__` was left behind (I ran Python with `-B`).
