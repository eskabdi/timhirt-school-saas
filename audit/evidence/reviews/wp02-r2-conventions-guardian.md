REVIEWER: conventions-guardian
WP: WP-02
VERDICT: PASS

WP-02 introduces no convention violation: no Ge'ez digits, no non-ETB currency, no new date, clock, name, font or address rendering, and no locale or Edge Function changes. Every gate I ran is green. The findings below are three minors and one info note for the backlog; two of the minors are old code that WP-02 now depends on.

FINDINGS:
  - id: CG-1
    severity: info
    location: /home/user/rv-wp02/scripts/ci/conventions.sh (does not exist)
    evidence: `ls scripts/ci/conventions.sh` returns "No such file or directory". The gate is `scripts/ci/conventions.py`, which CI runs at `.github/workflows/ci.yml:57-60` (`--self-test`, then a full scan). I ran that instead: the self-test passed (BAD fixtures flagged, OK fixtures not), and the scan found 0 geez-digit, 0 currency, 0 name-concat and 0 name-render, exit code 0.
    reference: fix plan §0A.2 conventions-guardian; reviewer brief
    fix: Change the reviewer brief to name `scripts/ci/conventions.py`, or add a `conventions.sh` wrapper that calls it.

  - id: CG-2
    severity: minor
    location: /home/user/rv-wp02/src/features/settings/HealthMonitoringPage.tsx:394, :443, :448
    evidence: `<EthDate value={alert.acknowledged_at} /> {new Date(alert.acknowledged_at).toLocaleTimeString()}`. Line 448 shows the `acknowledged_at` that WP-02's rewritten `acknowledge_alert` writes (`20260926000001_r6_definer_lockdown.sql:254-270`). The time uses the browser clock, not `toEthClock`, so the Amharic UI shows a Western-clock time. The code dates from dc5a5a3 (2026-08-09), not WP-02. `eslint.config.js:28-33` bans `toLocaleDateString` and `toLocaleString` but not `toLocaleTimeString`, so lint does not catch it.
    reference: Conventions: time via toEthClock in Amharic UI; blueprint §17.2
    fix: Render the times with `toEthClock` (Amharic UI) and add a `toLocaleTimeString` selector to the `no-restricted-syntax` rule in `eslint.config.js`. Backlog item.

  - id: CG-3
    severity: minor
    location: /home/user/rv-wp02/src/features/settings/ImportExportPage.tsx:63-69, :97-102; /home/user/rv-wp02/src/features/gradebook/ExamsPage.tsx:53-60
    evidence: WP-02 adds new server refusals: `create_import_job`/`create_export_job` raise 42501 "permission denied for tenant", 22023 "invalid entity type" and 22023 "invalid file size" (> 5242880 bytes); `auto_assign_exam_seats` now always raises `exam_not_found` (migration lines 211-246, 337-339). The import/export callers discard the RPC `error` (`const { data: job } = await supabase.rpc(...)`) and throw a hard-coded English `new Error("Failed to create job")`. None of these three pages renders `mutation.error` (grep finds no `.error`, `isError`, `onError` or toast). The only UI entity values, `["students","teachers","fees"]` (line 41), match the new allow-list, so there is no functional regression. But a file over 5 MB now fails silently in every locale, and there is no client-side size check.
    reference: Conventions: i18n keys present in en/am/om; OWASP A09 (generic but visible error)
    fix: Check the RPC `error`, map 42501/22023/`exam_not_found` to `t()` keys added to en/am/om `common.json` (one-line inserts, no re-serialisation), render the mutation error, and reject files over 5 MB before calling the RPC. Backlog item.

  - id: CG-4
    severity: info
    location: /home/user/rv-wp02/supabase/migrations/20260926000001_r6_definer_lockdown.sql:352
    evidence: `order by nullif(roll_number, '')::int nulls last, last_name, first_name`. This is carried over unchanged from `20260825000001_exam_seating_charts.sql:72`. It is a sort order, not a name concatenation, and the rendered seat names go through `fullName()` (`ExamsPage.tsx:86`). But in Ethiopian naming the last name is the grandfather's name, so sorting by it first does not give a family-name order. The same pattern appears in several `src` queries (`.order("last_name")`).
    reference: Conventions: names are First Middle Last
    fix: Order by `first_name, middle_name, last_name` project-wide in a later WP. Backlog note only; not introduced by WP-02.

CHECKED:
  - Read the WP-02 text and acceptance criteria (plan lines 329-385) and §0A.4/§0A.5.
  - Diffs reviewed: `c4ecfac..7c81fd7` (implementation), `67a627d..16548ba` (round-1 fixes), `16548ba..6a89aa0` (tests/docs). WP-09 commits were excluded.
  - WP-02 touches no locale files, CSS, PDF generators or Edge Functions (`git diff --stat -- src/locales supabase/functions` is empty for both WP-02 ranges). The locale changes in the wider range come from WP-09 (455ef8f).
  - Every added line in all three WP-02 diffs, scanned with Python regex:
    - 0 characters in U+1369–U+137C
    - 0 USD/EUR/US$/`$<digit>`/currency hits
    - 0 `toLocale*String` or bare `new Date()`
    - 0 font, address, woreda or kebele changes
  - The only name-related line (migration :352) is an ORDER BY, not a concatenation (CG-4).
  - Repo-wide Ge'ez scan of tracked files: hits only in audit/docs prose and the intentional `conventions_fixtures.txt` BAD lines, none in code or locales.
  - `src/lib/useSecuritySettings.ts`:
    - The dropped `login*` fields are unused anywhere (`tsc` clean).
    - The query is keyed by user id and runs only with a session.
    - The new `useSecuritySettings.test.tsx` passes, and adds no user-facing strings.
  - Tayitu/Jiret `@font-face` are still present in `src/index.css:13-18`, untouched by WP-02.
  - Gates run in /home/user/rv-wp02:
    - `npx tsc --noEmit`: exit 0
    - `npx eslint src`: exit 0, no output
    - `npx vitest run`: 16 files / 98 tests passed
    - `npm run check:i18n`: 0 hardcoded strings
    - `npm run check:locales`: common 2292 / apply 135 / calendar 44 keys, parity across en/am/om, passed
    - `python3 scripts/ci/conventions.py --self-test` and full scan: ok, 0 findings
  - Database: created my own `rv2_wp02_conv` and ran `supabase/tests/run.sh`:
    - 113 migrations applied; 65/65 suites ok
    - `definer_lockdown.sql` 51/51, `catalog_definer_security.sql` 7/7, `catalog_rls_coverage.sql` 2/2
    - 2 tolerated TODOs (WP-05 storage, WP-06 module gate)
    - `scripts/ci/app-rpc-grants.py`: 23 app RPCs, 0 findings
    - Dropped the database afterwards.
  - The worktree is clean after the run (`git status --short` empty); no `deno.lock` or `__pycache__` was left behind.
  - Not verified: `npm run build`, `deno-check.sh` and `semgrep-rule-test.py`. No WP-02 file falls inside what they check for conventions, and the other WP reviewers cover them.
