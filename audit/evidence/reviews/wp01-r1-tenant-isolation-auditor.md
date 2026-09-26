REVIEWER: tenant-isolation-auditor (harness / catalog-guard focus)
WP: WP-01 (HEAD 744f1d4, diff bae3bfd..744f1d4)
VERDICT: FAIL

The harness now matches production for grants, and the runner and ratchets work. It fails on one major finding: the storage guard misses the exposure class it was written to catch, including cross-tenant variants.

FINDINGS:
  - id: TI-1
    severity: major
    location: supabase/tests/rls/catalog_storage_policies.sql:16-23
    evidence: The detector matches the exact deparsed text of a policy's condition with two anchored regexes. I added four SELECT policies inside a transaction that was rolled back. Only `"zz d"` (`bucket_id = 'documents'` on its own) was flagged. These three were missed:
      - `"zz a"`: `bucket_id='documents' and (storage.foldername(name))[1] = public.get_tenant_id_for_user(auth.uid())::text`. This is the same tenant-folder-only class, just written without the `(SELECT …)` wrapper.
      - `"zz b"`: `bucket_id='documents' and auth.role()='authenticated'`. This lets any tenant read every tenant's files.
      - `"zz c"`: `bucket_id in ('documents','avatars')`. Also readable across tenants.
    reference: WP-01 change 2 ("no storage.objects SELECT policy whose only predicate is the tenant folder"); OWASP A01; H-02
    fix: Classify policies by what the condition contains, not its exact text. Flag any `storage.objects` policy for `r`/`*` whose condition has no role or ownership term, i.e. no `get_role_for_user`, `has_permission`/`has_resource_permission`, `auth.uid()` outside the tenant-folder expression, or `EXISTS` subquery. Separately flag any policy with no tenant-folder term on a bucket where `public = false`. Add planted-policy tests for the a/b/c shapes above.

  - id: TI-2
    severity: minor
    location: supabase/tests/rls/catalog_module_gate.sql:18-19
    evidence: The guard only checks the policy name (`not polpermissive and polname like '%module_gate%'`). Adding `create policy zz_g_module_gate on zz_g as restrictive for insert … with check (true)` made table zz_g count as gated. Assertion 1 still returned ok, and the ungated count dropped from 38 to 37. This matches the plan's wording, but WP-06 will rely on this guard to close H-04.
    reference: H-04 / WP-06
    fix: Also require `polcmd = '*'` (or one gate per command) and a condition that calls `has_module(`.

  - id: TI-3
    severity: minor
    location: supabase/tests/rls/r6_hotfix_library_anon.sql:39-42
    evidence: `throws_ok(..., '42501', null, ...)` accepts any permission error. "Permission denied for schema public" is also 42501, so these two new real anon calls would pass under the old shim too. They do not show that the fix is doing the work.
    reference: L-08, CLAUDE.md "Prove a gate fails before trusting that it passed"
    fix: Assert the error message `'permission denied for function library_return'` (and the same for `library_checkout`), or add `ok(has_schema_privilege('anon','public','usage'))` first.

  - id: TI-4
    severity: minor
    location: supabase/tests/shim.sql:128-129 (unchanged lines, but they undercut the claim that the harness mirrors Supabase)
    evidence: The shim runs `grant usage on schema auth, storage, vault to … anon` and `grant select on auth.users to authenticated, anon`. Supabase makes neither grant (in production `auth.users` is denied to API roles). The ACL parity evidence only covers `public`, so this difference is not measured.
    reference: CLAUDE.md "Don't add a grant to the shim that Supabase doesn't make"; L-08
    fix: Remove the grants on `auth.users` and on the `vault`/`auth` schemas to anon (and to authenticated if production agrees). Extend the parity query to the `auth`, `storage` and `vault` schemas.

  - id: TI-5
    severity: info
    location: audit/evidence/wp01-acl-parity-20260925T101802Z.txt
    evidence: I can't independently confirm the production side of the parity check because I have no production access. The harness side reproduces exactly: 191 lines, sha256 572e6510…0299, zero diff against the file's "Production lines", 42 anon-executable definer functions. The shim comment at shim.sql:46 says "46" anon-executable functions in production, but the evidence shows 42.
    reference: 0A.5 ("not verifiable")
    fix: Change the comment to 42, or say that 46 is the count from before WP-00.

  - id: TI-6
    severity: info
    location: supabase/tests/rls/catalog_rls_coverage.sql; supabase/security/
    evidence: Several exposure classes have no catalog guard:
      - views with `security_invoker=false` (today `clinic_visit_detail` and `hr_employee_sensitive`, owned by `timhirt_view_owner` and covered by `hr_clinic_sensitive_views.sql`);
      - permissive tenant-table policies whose condition is `true` or doesn't reference the tenant;
      - storage INSERT/UPDATE/DELETE policies with no tenant-folder check.
      Also, the plan names `module_gate_allowlist.txt` but the implementation uses `.sql`.
    reference: WP-02 / WP-05 / WP-06 scope
    fix: Add these as TODO ratchets in the WPs that own them. Update the plan to say `.sql`.

CHECKED:
  - I read §0, §0A.4 and WP-01 of the plan, and the full diff for `shim.sql`, `run.sh`, the 4 `catalog_*` suites, the 8 `supabase/security` baselines and `r6_hotfix_library_anon.sql`.
  - I ran the full harness on a private DB (`ti_w1`, Postgres 16, from a `git archive` of 744f1d4): 108 migrations, 60 suites, exit 0, with 5 open TODOs (WP-02 ×3, WP-05, WP-06).
  - I ran the evidence file's parity query on the harness. The output is byte-identical to the file's production lines, and anon has USAGE on `public` through the shim.
  - The runner fails when it should. I added three dummy suites: a passing TODO, a hard failure whose description contains "ERROR:", and a suite that runs fewer assertions than it plans. Each failed the run (exit=1).
  - Each ratchet catches a new offender. I added:
    - an anon-executable definer function with no `search_path`: caught by assertions 1 and 3;
    - a table with RLS but no FORCE: caught;
    - a tenant table with no gate: caught.
    The check that the baseline only shrinks returns ok, which confirms the baseline lists are exact.
  - Storage baseline: 4 tenant-only read policies. I listed all 33 `storage.objects` policies and confirmed by hand that they are exactly the ones with no role condition. `branding` is the only public bucket, and it is on the allow-list with a reason. The WP-00 catalog diff (policies on `public` and `storage`, md5 of the conditions) shows zero drift from production.
  - Module-gate baseline: 37 tables, exact (the ungated count was 37 before I added test tables). The allow-list is empty.
  - Baselines for definers (42 anon-executable, 13 without `search_path`) and for missing FORCE (11 tables) are exact against the harness.
  - The definer-rights views are owned by the non-bypass role `timhirt_view_owner` (migration 20260715000013) and have an existing cross-tenant test.
  - CI runs the harness as `PGUSER: postgres`, which matches the `alter default privileges for role postgres` in the shim.
  - The repo working tree is unchanged, and I deleted my temporary copies.
