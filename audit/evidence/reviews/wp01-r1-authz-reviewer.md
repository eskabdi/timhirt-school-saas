REVIEWER: authz-reviewer
WP: WP-01
VERDICT: PASS

The DB side of WP-01 does what it claims. All 60 pgTAP suites pass on my own database, the definer ratchet catches regressions in both directions, and the harness privileges match the captured production listing line for line. I found three minor issues and three info notes, and nothing at blocker or major. One check could not be run here: `deno check` (Deno isn't installed), so AZ-3 is marked not verifiable.

FINDINGS:
  - id: AZ-1
    severity: minor
    location: supabase/tests/rls/catalog_definer_security.sql:25
    evidence: The check is `c like 'search_path=%'`, so `search_path=public` counts as "pinned". In az_w1, 39 of the 65 definer functions use exactly `search_path=public`, with no explicit `pg_temp` at the end. When `pg_temp` isn't listed, Postgres searches it first for tables. A session that can create temp tables could then shadow a table that one of these functions names without a schema. The only other value in use is `search_path=public, pg_temp`.
    reference: L-07 / PostgreSQL "Writing SECURITY DEFINER Functions Safely" / INSA Phase 3 secure coding
    fix: In WP-02, tighten the check to require `search_path=""` or a trusted list ending in `pg_temp`. Baseline the 39 functions or fix them.
  - id: AZ-2
    severity: minor
    location: supabase/tests/rls/catalog_definer_security.sql:21
    evidence: The guard only looks at `n.nspname = 'public'`. Today that is enough: `auth`, `storage` and `vault` have 0 definer functions in the harness. But a definer function added later in a new API-exposed schema would get past the guard without failing it.
    reference: H-01 / §0A tenant-isolation "definer functions"
    fix: Scan every schema except `pg_catalog`, `information_schema` and extension-owned objects, or add a hard assertion that no definer function exists outside `public`.
  - id: AZ-3
    severity: minor
    location: supabase/functions/activate-sso-user/index.ts:85
    evidence: The rollback fix is correct. PostgREST builders are thenables with no `.catch`, and the fix now awaits the call and destructures `{ error }`, with the delete scoped by tenant_id and user_id. But no Deno test drives the failure path (update fails, then the teachers row is removed). The only guard against a regression is the `deno check` ratchet, and I could not run it here: `deno` is not installed, so this part is not verifiable.
    reference: Plan §0 rule 4 (failing-then-passing test)
    fix: Add a Deno test that stubs the `users` update to return an error and asserts the teachers delete runs. Paste the `bash scripts/ci/deno-check.sh` output into the PR.
  - id: AZ-4
    severity: info
    location: supabase/functions/activate-sso-user/index.ts:39, supabase/functions/_shared/security.ts:50
    evidence: This is a role-promotion endpoint. It uses `requireRole(req, ["school_admin"])`, which does not check aal2, tenant status (suspended/pending) or `imp_mode=read`, and nothing requires maker-checker approval. `requireAccess` does not exist yet. This predates WP-01 and is outside its scope.
    reference: WP-06 / WP-07 / WP-09 (privilege-escalation approval)
    fix: Track it in WP-06/07/09. activate-sso-user must move to `requireAccess` with aal2, a tenant-status check, a read-only-impersonation check and dual control.
  - id: AZ-5
    severity: info
    location: supabase/tests/shim.sql:46
    evidence: The comment says "46 anon-executable SECURITY DEFINER functions". The evidence, the baseline and FIXES_VERIFIED all say 42. 46 was the count before DR-4, and the four library RPCs have since been revoked.
    reference: doc/control consistency
    fix: Change the comment to 42, or say it was 46 before DR-4.
  - id: AZ-6
    severity: info
    location: audit/evidence/wp01-acl-parity-20260925T101802Z.txt
    evidence: The parity check covers EXECUTE on `public` functions, plus SELECT for anon/authenticated and INSERT for authenticated on tables and views. It does not cover UPDATE/DELETE, column grants, CREATE/USAGE on the schema, or the `storage`/`auth` schemas, which are shim tables in the harness. I could not verify the production side myself. I could only confirm that the committed production listing matches the harness.
    reference: L-08
    fix: When WP-02/WP-05 re-capture the evidence, add UPDATE/DELETE, `has_schema_privilege(...,'create')` and storage.objects grants.

CHECKED:
  - I read plan §0, §0A.4 and WP-01, and read the full diff `bae3bfd..744f1d4` for supabase/tests, supabase/security and the three changed Edge Functions.
  - Harness run: I copied HEAD to /tmp/az-repo and ran run.sh against az_w1. All 108 migrations applied, all 60 suites passed, exit 0. The 4 catalog suites report their TODOs as expected (definer 4/6 + 2 TODO; module_gate, rls_coverage and storage each 3/4 + 1 TODO).
  - Ratchet proof in az_w1: I added a new definer function with no search_path and revoked anon on `jwt_user_id()`. Assertion 1 then failed (`{zz_probe_definer()}`), as did assertion 2 (`{jwt_user_id()}`) and assertion 3. The TODO assertions reported have: 42 anon-executable and 14 without search_path.
  - The extension exclusion (`pg_depend deptype='e'`) is correct. pgtap and pgcrypto sit in public in the harness, and no extension definer function leaks into the set.
  - Anon detection uses `has_function_privilege('anon', ...)`, which includes the PUBLIC grant. A real `set role anon` call to `get_email_for_user` now reaches the function, so the probes are no longer vacuous. r6_hotfix_library_anon 13–14 make real anon calls and get 42501.
  - Both baselines match reality exactly: 42 anon-executable and 13 without search_path in the harness, with no extras in either direction.
  - I re-ran the evidence query on az_w1 and got 191 lines with sha256 572e6510…, byte-identical to the committed production listing.
  - The shim's default privileges match what Supabase grants: `pg_default_acl` holds anon/authenticated/service_role entries for types f, r and S, owned by postgres, with USAGE on public.
  - Runner TODO logic: an open TODO is tolerated, a TODO that passes fails the suite, and the plan count now includes TODOs. The narrowed ERROR regex still catches real psql errors, including those from `\ir` files.
  - activate-sso-user: the rollback logic and the tenant-scoped delete are correct. process-export-job and process-import-job use the same fix for `fail_job`.
  - CI: the pgtap job runs `supabase/tests/run.sh`, `deno-check.sh` is wired in, and the actions I looked at are SHA-pinned.
