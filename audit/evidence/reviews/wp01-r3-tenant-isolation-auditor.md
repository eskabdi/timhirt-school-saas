REVIEWER: tenant-isolation-auditor (round 3, final)
WP: WP-01 (HEAD 1a5eec7; round-2 fixes at ffe8242..1a5eec7)
VERDICT: FAIL

The full harness passes on my own database. Four of the six round-2 findings I re-tested are fixed: TI-R2-3, TI-R2-4, TI-R2-5 and TI-R2-6. TI-R2-7 was fixed by inspection. There is no cross-tenant path in any shipped policy, table or function.

The fail comes from TI-R2-1, which is only partly closed. The new behavioural probe catches the exact shapes I planted in round 2. However, a realistic WP-05 AND/OR slip, whose leaking branch keys on a real path segment, still passes both the probe and the text classifier. I demonstrated an actual tenant-A-reads-and-writes-tenant-B result with it. That is the same class of guard gap I rated major in round 2.

FINDINGS:

1. TI-R3-1 (major). The cross-tenant storage guard is still evadable when the leak depends on the object path.
   - Location:
     - `supabase/tests/rls/catalog_storage_probe.sql:27-29`: the seed is always `<B>/<bucket_id>/secret.pdf`.
     - `supabase/tests/rls/catalog_storage_probe.sql:84`: the insert attempt is always `<B>/probe/<role>.pdf`.
     - `supabase/tests/rls/catalog_storage_policies.sql:35-36`: the tenant term counts if it appears anywhere, including inside one OR branch.
   - Evidence: real upload paths carry literal segments. Examples are `${tenantId}/staff/${employeeId}/…` in `src/features/hr/staffApi.ts:18,67,99` and `${tenant}/front|back/…` in `IdCardTemplateDesignerPage.tsx:243`. In a rolled-back transaction I reused the suite's own seed, its `storage_cross_tenant_probe()` and its classifier views, then planted two policies:
     - `"zz p6 hr staff read"` (SELECT): `bucket_id='documents' AND foldername[1]=get_tenant_id_for_user(auth.uid()) AND role='school_admin' OR foldername[2]='staff' AND role='hr_officer'`. This is a plausible WP-05 "add an HR branch" slip.
     - `"zz p7 hr staff write"`: the same expression as an INSERT WITH CHECK.
   - Result:
     - The probe returned `{}`.
     - Neither policy appeared in `storage_no_role` or `storage_no_tenant`, so all 16 plus 10 assertions would stay green.
     - After I added one object at a real path, `0000000b…/staff/e1/national_id.pdf`, the probe reported `hr_officer reads tenant B in documents`.
     - As the tenant-A hr_officer, `INSERT INTO storage.objects ('documents', '<B>/staff/e1/planted.pdf')` succeeded.
     - Filename-keyed variants (`name like '%.png' OR …`) and segment-keyed variants evade in the same way; I planted them as P3, P4 and P5.
   - Failure scenario: WP-05 rewrites the storage policies. One policy gets an unparenthesised OR branch keyed on `foldername[2]='staff'`. CI stays green, and every HR officer in every tenant can read and plant files in every other tenant's staff document folder (national IDs, contracts).
   - Fix (do both):
     - (a) Text check: require the tenant-folder comparison to be a top-level AND conjunct. For example, anchor the deparsed text: `^\(\(bucket_id = '[a-z-]+'::text\) AND \(\(storage\.foldername\(name\)\)\[1\] = \(\( SELECT get_tenant_id_for_user\(auth\.uid\(\)\) AS get_tenant_id_for_user\)\)::text\) AND `. PostgreSQL deparses a top-level OR as `(((…) AND …) OR …)`, so the anchor fails on it. All 30 existing non-allow-listed policies already match this prefix. Add p6 and p7 as planted cases that must be flagged.
     - (b) Probe: seed and insert at realistic paths per bucket, i.e. every literal found in `(storage.foldername(name))[k] = '<lit>'` in the current policies plus a uuid segment at depths 2 to 4, not only `<B>/<bucket>/secret.pdf` and `<B>/probe/…`.

2. TI-R3-2 (minor). The probe never tests UPDATE or DELETE of tenant-B objects in the public `branding` bucket.
   - Location: `supabase/tests/rls/catalog_storage_probe.sql:27-29` (`where not coalesce(b.public,false)`).
   - Evidence: I planted `for update to authenticated using (bucket_id='branding')` and the matching `for delete`, and the probe returned `{}`.
   - They are caught today only by the text classifier's `storage_no_tenant`. A precedence-slip version of them would evade both guards, as in finding 1.
   - Failure scenario: a tenant-A admin overwrites or deletes tenant B's logo and letterhead, which appear on B's public admission and verify pages.
   - Fix: also seed a tenant-B object in public buckets. Exclude only SELECT from the read check there, and keep the UPDATE and DELETE checks.

3. TI-R3-3 (minor). The role-term classifier still accepts terms that do not narrow access.
   - Location: `supabase/tests/rls/catalog_storage_policies.sql:33`.
   - Evidence: both of these were planted and neither was flagged:
     - `(select get_role_for_user(auth.uid())) = (select get_role_for_user(auth.uid()))`, which matches `AS get_role_for_user\) = `;
     - `(is_teacher_of_class(null) or true)`.
   - Both stay within one tenant, so this is least privilege, not isolation. The planted TI-R2-2 shapes (bare EXISTS, uid tautology, `<>` literal, helper name in a string literal) are now correctly flagged.
   - Fix: require the right-hand side to be a string literal or `ANY (ARRAY['…'::text,…])`. Treat a helper call as a role term only when it is a top-level AND conjunct, which the anchored-prefix approach from finding 1 gives you.

4. TI-R3-4 (info). This is not tenant isolation, but it is a data-integrity risk in the same file. `src/features/settings/CalendarPreferencesPage.tsx`: the save builds `{...(settings ?? {}), calendar}`. If `useTenantSettings()` is still loading or has errored, `settings` is undefined. Save then upserts a settings object that holds only `calendar` and wipes the tenant's other settings keys. This is pre-existing behaviour. Fix: disable Save until `settings` has loaded without error.

Round-2 findings, re-verified by running the code:
- TI-R2-1: partly fixed. The behavioural probe exists, is non-vacuous (3 precondition asserts) and catches the a1/a4 shapes plus the planted insert, update and delete cases. The residual gap is TI-R3-1 and TI-R3-2.
- TI-R2-2: fixed for all the planted round-2 shapes. The residual is TI-R3-3.
- TI-R2-3: fixed. The gate expression regex is anchored, `polroles` must include authenticated or PUBLIC, and the planted service_role, `OR true` and `is null` gates count as ungated (suite 8/9 plus 1 TODO).
- TI-R2-4: fixed. The allow-list carries an md5 fingerprint of USING, WITH CHECK, cmd and roles. The planted widening of `public read branding` breaks it, and the current value matches.
- TI-R2-5: fixed.
  - The shim now grants vault USAGE only to service_role and grants no SELECT on `auth.users`.
  - This matches `audit/evidence/wp01-prod-calendar-and-schema-grants-20260925T154210Z.txt`.
  - Verified with `has_schema_privilege` and `has_table_privilege` (anon/authenticated vault USAGE = f; anon and service_role `auth.users` SELECT = f).
- TI-R2-6: fixed. `normalize_calendar_settings` handles a scalar, array or null calendar, a `"geezNumerals"` string, non-boolean `showHijri` and `numerals:"geez"`, and it keeps extra keys, all without raising. A non-object `settings` passes through unchanged.
- TI-R2-7: fixed. The comments cite `20260925000002` and "any command".

CHECKED:
- Full harness on a private DB `ti_r3` (Postgres 16, HEAD 1a5eec7), exit 0:
  - 109 migrations; all suites passed;
  - `catalog_storage_probe` 10/10; `catalog_storage_policies` 15/16 plus 1 TODO; `catalog_module_gate` 8/9 plus 1 TODO;
  - definer 5/7 plus 2 TODO; RLS 3/4 plus 1 TODO; `r6_calendar_numerals` 15/15.
- Planted-policy attacks against the new probe and classifiers, in rolled-back transactions with scratch SQL in my scratchpad:
  - P1 and P2: branding update and delete;
  - P3, P4 and P5: segment- and filename-keyed precedence slips;
  - P6 and P7: realistic HR staff-folder slip, confirmed behaviourally as a cross-tenant read and insert;
  - two role-term tautologies.
- tenant_configs:
  - RLS ENABLE and FORCE; `configs_select` and `configs_write` derive the tenant from `get_tenant_id_for_user(auth.uid())`;
  - `tenant_id` is the PK with an FK to `tenants` ON DELETE CASCADE;
  - behavioural probe as a tenant-A school_admin: sees 1 row; UPDATE and DELETE of the B row affect 0 rows; INSERT and upsert into B raise 42501; B's row is unchanged.
- New functions:
  - `normalize_calendar_settings`: SECURITY INVOKER, `search_path` pinned, revoked from public and anon, pure;
  - `tenant_configs_normalize_calendar`: invoker, `search_path` pinned, revoked from public, anon and authenticated;
  - the trigger only rewrites `NEW.settings`, never `tenant_id`.
- `src/features/settings/useCalendarPrefs.ts`: the query key now includes `tenantId`, so there is no cross-tenant cache bleed. `.eq("tenant_id")` is a PK selector for super_admin's multi-row visibility, and RLS still enforces access. The client never writes a tenant other than `profile.tenant_id`, and RLS rejects anything else in any case.
- Storage bucket list (16, one public) and all current `storage.objects` policies: every non-allow-listed policy has a top-level tenant-folder conjunct.
- The repo was not modified; DB `ti_r3` was dropped. The untracked `audit/evidence/reviews/wp01-r3-i18n-a11y-reviewer.md`, `deno.lock` and `scripts/ci/__pycache__/` in the working tree are not mine.

VERDICT: FAIL
1. TI-R3-1, major: `supabase/tests/rls/catalog_storage_probe.sql:27-29,84` and `supabase/tests/rls/catalog_storage_policies.sql:35-36`. A path-keyed OR slip evades both guards; demonstrated as a tenant-A hr_officer reading and inserting in tenant B's `documents/<B>/staff/…`.
2. TI-R3-2, minor: `supabase/tests/rls/catalog_storage_probe.sql:27-29`. Cross-tenant UPDATE and DELETE are not probed in the public `branding` bucket.
3. TI-R3-3, minor: `supabase/tests/rls/catalog_storage_policies.sql:33`. Role-term tautologies are still accepted (within one tenant only).
4. TI-R3-4, info: `src/features/settings/CalendarPreferencesPage.tsx` save handler. Save while settings are loading or errored overwrites the tenant's other settings keys.
