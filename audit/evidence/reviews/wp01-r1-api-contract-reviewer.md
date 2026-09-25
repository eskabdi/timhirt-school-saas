REVIEWER: edge-function-contract-reviewer
WP: WP-01 (Edge Function `.catch()` fixes and the `deno check` ratchet), HEAD 744f1d4, diff bae3bfd..744f1d4
VERDICT: PASS

The three fixes are correct and `deno check` now passes for all three functions. I found no blockers or majors, only three minors and three info notes.

FINDINGS:
  - id: EF-1
    severity: minor
    location: supabase/functions/process-export-job/index.ts:263, supabase/functions/process-import-job/index.ts:389, supabase/functions/activate-sso-user/index.ts:81
    evidence: None of the three functions has a test file (each directory contains only `index.ts`). The fixed error paths are proven only by the type checker. No Deno test checks that a thrown error leads to `fail_job(job_id,'internal_error')`, that the teacher rollback runs, or that the response is still a generic 500.
    reference: L-08 (harness must prove behaviour); CLAUDE.md "Verification means running the thing"
    fix: Add Deno unit tests with a stubbed admin client that throws in the main path. Assert the `fail_job` or delete call happened, and assert a 500 with the generic body and CORS headers. Log it in audit/backlog.md.
  - id: EF-2
    severity: minor
    location: supabase/functions/_shared/security.ts:9 (`npm:@supabase/supabase-js@2`); no deno.lock in the repo
    evidence: The version is not pinned, so `deno check` resolved postgrest-js 2.117.1 during this run. Without a lockfile, a new upstream release can change type results. That can turn the ratchet red, or make a baselined function STALE, with no repo change.
    reference: WP-01 §3 (a trustworthy CI); supply-chain pinning
    fix: Commit a deno.lock, or pin exact versions in the `npm:` specifiers, and run the check with `--frozen`.
  - id: EF-3
    severity: minor
    location: scripts/ci/deno-check.sh:27-28
    evidence: A baselined function counts as "known" whenever `deno check` fails for any reason, including a module-resolution or network failure. A new kind of break in those 4 functions is therefore hidden until the WP that removes them from the baseline.
    reference: WP-01 ratchet intent
    fix: Optionally store the expected TS error codes or count per baselined function, and fail if they change.
  - id: EF-4
    severity: info
    location: scripts/ci/deno-check.sh:37
    evidence: `$(wc -l <<<"$known")` prints 1 when the baseline is empty. This only affects the summary text.
    fix: `grep -c . <<<"$known"`.
  - id: EF-5
    severity: info
    location: process-export-job/index.ts:262-274, process-import-job/index.ts:388-400
    evidence: The response status is still 500. Before the fix, the `.catch` TypeError inside the catch block escaped the handler, so Deno's default 500 went out as plain text without CORS headers and the job stayed stuck in "processing". Now `errors.internal()` returns the documented generic body with CORS headers. This is a fix, not a contract change.
  - id: EF-6
    severity: info
    location: supabase/migrations/20260719000010_import_export.sql:150
    evidence: `grant execute on function fail_job to authenticated` on a SECURITY DEFINER function that takes any `p_job_id`. This existed before this diff and belongs to WP-02 (definer lockdown).
    fix: Handle it in WP-02 (make it service_role only).

CHECKED:
  - Read the plan's §0A.4 contract, the severity rules and the WP-01 text (§3: `deno check` job, SHA pins). I did not read §0 itself.
  - Diffed bae3bfd..744f1d4 for supabase/functions, scripts/ci/deno-check.sh and supabase/security/deno_check_known.txt. HEAD is 744f1d4.
  - activate-sso-user: request schema, auth (requireRole school_admin), rate limit, CORS and the 200/400/404/500 responses are unchanged. The rollback is now awaited, and its errors (returned or thrown) are logged without replacing the original `updErr`. Failure still returns `errors.internal()` (500).
  - process-export-job and process-import-job: success and 400/429 responses are unchanged. In the catch block `fail_job` is now awaited, `job_id` is in scope there, the logs contain only the message (no ids or stacks), and the handler returns `errors.internal()`. The `fail_job(p_job_id uuid, p_error_message text)` signature matches the migration.
  - Remaining `.catch(() => {})` calls in supabase/functions (auth.admin.deleteUser, fetch, storage.remove) are all on real Promises, not PostgREST builders.
  - `DENO_NO_PACKAGE_JSON=1 npx -y deno@2.9.6 check --node-modules-dir=none` passes for all 3 functions (rc=0).
  - Proved the gate fails first: the bae3bfd versions of activate-sso-user and process-export-job fail with TS2551 "Property 'catch' does not exist on type PostgrestFilterBuilder" (rc=1).
  - Ran `scripts/ci/deno-check.sh` in full with deno 2.9.6: 28 functions checked, 4 baselined, ok, rc=0.
  - Ratchet test on a copy in the scratchpad: a function that fails but is not in the baseline prints FAIL, and a baselined function that passes prints STALE. Both give rc=1.
  - The baseline file has 4 entries, each tied to a later WP (WP-04, WP-10/13, WP-12), and matches the script's output.
  - CI (.github/workflows/ci.yml:42-52) pins setup-deno by SHA with deno-version 2.9.6 and runs the script.
  - Not checked (outside this narrow scope): OpenAPI entries for these endpoints, and parity with the frontend client types. The response shapes are unchanged in the diff.
