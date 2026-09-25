REVIEWER: tenant-isolation-auditor (round 2)
WP: WP-01 (HEAD ffe8242, base bae3bfd; round-1 fixes at 744f1d4..ffe8242)
VERDICT: FAIL

The full harness passes on my own database. TI-2, TI-3 and TI-5 are fixed. The failure is the storage guard: its content-based rewrite catches the TI-1 shapes, but I defeated its new hard assertion "every storage policy is scoped to the caller's tenant folder" with the most common RLS mistake, an AND/OR precedence slip. I planted two such policies. A tenant-A student could read tenant-B objects through both, and the detector passed both. No shipped policy is affected, so there is no production cross-tenant path, but a WP-05 regression of this kind would pass the guard.

FINDINGS:

- id: TI-R2-1
  severity: major
  location: supabase/tests/rls/catalog_storage_policies.sql:25-32 (the detector functions) and :46-49 (`storage_no_tenant`)
  evidence: Both checks are regexes over the deparsed text, so they only ask whether a term appears anywhere, not whether it constrains the result. The tenant regex `storage\.foldername\(name\)\)\[1\] = .*get_tenant_id_for_user\(auth\.uid\(\)\)` passes as soon as the tenant term appears in any OR branch. In a rolled-back transaction on my DB I seeded a tenant-A student and two tenant-B objects, `bbbb…/secret1.pdf` and `bbbb…/secret2.pdf`, and planted two policies:
    - a1: `(bucket_id = 'zzb1') OR ((bucket_id = 'zzb9') AND (foldername[1] = get_tenant_id_for_user(auth.uid())::text) AND (get_role_for_user(auth.uid()) = 'school_admin'))`, which is the precedence bug.
    - a4: `(bucket_id = 'zzb2') AND ((foldername[1] = …tenant…) OR (get_role_for_user(auth.uid()) IS NOT NULL))`.
  As the tenant-A student (`set local role authenticated` with the JWT sub claim set), `select … from storage.objects` returned both tenant-B rows. The suite's own `storage_has_role_term` and `storage_has_tenant_term` both returned `t` for a1 and a4, so neither view flags them. A third cross-tenant shape was also accepted: a5, `bucket='documents' and foldername[1]='shared' or get_tenant_id_for_user(auth.uid()) is not null and …`.
  reference: WP-01 change 2; round-1 TI-1; H-02; OWASP A01; brief ("any cross-tenant path"; "run or require pgTAP probes")
  fix: Add a behavioural probe to catalog_storage_policies.sql (or a companion suite) alongside the text classifier:
    - Seed a tenant-B object in every non-public bucket in `storage.buckets`.
    - For every value of the role enum, act as a tenant-A user and assert that SELECT sees 0 rows, UPDATE and DELETE affect 0 rows, and an INSERT into a tenant-B folder throws 42501.
  This does not depend on how a policy is written, and it catches OR and precedence bugs. At minimum, also flag any policy whose deparsed expression has a top-level OR, and add a1 and a4 as planted cases that must be flagged.

- id: TI-R2-2
  severity: minor
  location: supabase/tests/rls/catalog_storage_policies.sql:25-28 (`storage_has_role_term`)
  evidence: The role-term regex is satisfied by terms that do not narrow access. Four planted policies, all tenant-folder-scoped, were each classified as role-checked:
    - a2: `… and exists(select 1)`;
    - a3: `… and auth.uid() = auth.uid()`;
    - a6: `… and exists(select 1 from public.users p where p.id = auth.uid())`, which passes for every user in the tenant, students included;
    - a9: `… and get_role_for_user(auth.uid()) <> 'nobody'`.
  A string literal also counts: a8, `… and name <> 'has_permission'`. These stay inside one tenant, so this is minor, but a6 and a9 are plausible accidental "role checks" in WP-05. The detector also ignores `polroles`: a7, written `to anon`, was classified like an authenticated policy.
  reference: WP-05 storage least privilege
  fix: Require the role term to be a comparison against a role literal or list (`get_role_for_user(…) = …` / `= ANY (…)`), or a `has_permission`/`has_resource_permission` call. Drop the bare `EXISTS`. Prefer the per-role behavioural probe from TI-R2-1, extended so a student or guardian in the same tenant cannot read another user's files.

- id: TI-R2-3
  severity: minor
  location: supabase/tests/rls/catalog_module_gate.sql:19-21
  evidence: I planted three restrictive `*_module_gate` policies with `polcmd='*'` and USING containing `has_module(`. The guard counted all three tables as gated:
    - zz_m1 `to service_role` only, so `authenticated` is not gated at all;
    - zz_m2 `has_module(tenant_id,'library') or true`;
    - zz_m3 `not has_module(…) is null`.
  The name/cmd/has_module check is better than round 1, but it ignores the policy's roles and whether `has_module` actually constrains the result. This is not a cross-tenant path, because the gate is feature entitlement.
  reference: TI-2 (round 1); H-04 / WP-06
  fix: Require `'authenticated'::regrole = any(polroles)` or `polroles = '{0}'` (PUBLIC). Require the USING expression to be exactly one `has_module(tenant_id, '<literal>')` call, or that call as a top-level AND conjunct, and reject any OR.

- id: TI-R2-4
  severity: minor
  location: supabase/tests/rls/catalog_storage_policies.sql:43,48; supabase/security/storage_policy_allowlist.sql
  evidence: The allow-list exempts a policy by name alone, from both detectors. `alter policy "public read branding" … using (bucket_id in ('branding','documents'))` would keep the name and therefore stay exempt, which would make `documents` world-readable with the guard still green. I found this by reading the code; I did not execute it.
  reference: H-02
  fix: Store `md5(pg_get_expr(polqual, polrelid))` (and roles/cmd) in the allow-list row and assert that it matches, so any change to an allow-listed policy needs a new review.

- id: TI-R2-5
  severity: minor
  location: supabase/tests/shim.sql:129; audit/evidence/wp01-acl-parity-20260925T101802Z.txt
  evidence: TI-4 is only partly fixed. The `auth.users` SELECT for anon and authenticated is removed. The shim still runs `grant usage on schema auth, storage, vault to authenticated, anon, service_role`, and the parity evidence still covers `public` only. Whether production grants anon USAGE on `vault` is **not verifiable** here; I have no production access.
  reference: CLAUDE.md "Don't add a grant to the shim that Supabase doesn't make"; round-1 TI-4
  fix: Extend the parity query to the `auth`, `storage` and `vault` schemas and their objects, capture production, and drop any shim grant that production lacks. Vault USAGE for anon is the likely one.

- id: TI-R2-6
  severity: minor
  location: supabase/migrations/20260925000002_r6_calendar_numerals.sql:15-26
  evidence: There is no tenant-isolation impact:
    - `tenant_configs` still has RLS ENABLE + FORCE;
    - `configs_select` and `configs_write` are unchanged and derive the tenant from `get_tenant_id_for_user(auth.uid())`;
    - the migration adds only a row-local CHECK and a data UPDATE.

  The UPDATE can still abort the deploy on unexpected production data. `jsonb - 'geezNumerals'` on a non-object `settings.calendar` raises "cannot delete from scalar" (reproduced), and `(… showHijri)::boolean` raises on a non-boolean string. A scalar string `"geezNumerals"` would also satisfy `?`. Whether production has such rows is **not verifiable**.
  reference: CLAUDE.md "Migrations are validated locally…"
  fix: Before deploy, run `select count(*) from tenant_configs where jsonb_typeof(settings->'calendar') <> 'object'` and a showHijri type check against production. Alternatively, guard the UPDATE with `jsonb_typeof(settings->'calendar') = 'object'` and use a `CASE` for showHijri.

- id: TI-R2-7
  severity: info
  location: src/features/settings/useCalendarPrefs.ts:7; supabase/security/storage_tenant_only_known.sql:2
  evidence: The comment in `useCalendarPrefs.ts` cites migration `20260925000001`, but the migration is `20260925000002`. The storage baseline header still says "SELECT policies", although the guard now covers all commands.
  fix: Correct both comments.

CHECKED:
- I read the round-1 verdict, the "Round 1 reviews" section of FIXES_VERIFIED_R6 and the full diff 744f1d4..ffe8242 for:
  - `supabase/` (shim, 4 catalog suites, security baselines, the new migration and suite);
  - the 5 Edge Function diffs, which only add `middle_name` to existing selects with the same tenant filters, and change `onboard-tenant` defaults.
- Full harness on my own DB `ti_r2` (Postgres 16, `git archive` of ffe8242 in scratch), exit 0:
  - 109 migrations, 61/61 suites;
  - TODOs as claimed: definer 2, RLS 1, module gate 1, storage 1;
  - `r6_calendar_numerals` 7/7, `r6_hotfix_library_anon` 15/15, `catalog_storage_policies` 10/11 plus 1 TODO.
- TI-1: the round-1 shapes (unwrapped tenant-only, `auth.role()`, `bucket_id in (…)`, write-only) and a role-but-no-tenant policy are now flagged. This is covered by the suite's own planted assertions.
- Nine further planted storage policies (a1–a9) in a rolled-back transaction: all nine evaded both detectors. The cross-tenant reads by a1 and a4 were confirmed behaviourally as a tenant-A student.
- TI-2: the name-only bypass is closed. Three new planted bypasses (roles, `OR true`, `is null`) evade it. The 58 authenticated / 1 service_role gate count includes my plants; no existing gate is service_role-only.
- TI-3: the exact-message `throws_ok` and the `has_schema_privilege('anon','public','usage')` precondition are present and pass.
- TI-4: the `auth.users` grant to anon/authenticated is removed. The schema USAGE on auth/storage/vault remains (TI-R2-5).
- TI-5: the shim comment is corrected.
- AZ-2: the new assertion covers non-public definer functions, excluding extensions.
- `tenant_configs`: RLS ENABLE + FORCE, both policies tenant-derived from `get_tenant_id_for_user(auth.uid())`, `tenant_id` NOT NULL with an FK to `tenants` ON DELETE CASCADE, and the only trigger is `set_updated_at`. JSONB edge-case behaviour of the migration is reproduced (TI-R2-6).
- Storage baseline (4 policies) and allow-list (1, with a reason) are unchanged and exact against the harness.
- The repo was not modified. The private DB `ti_r2` was dropped and the scratch copy deleted. The untracked `docs/OWNER_ACTIONS.md` in the working tree was not created by me. I wrote no review file.
