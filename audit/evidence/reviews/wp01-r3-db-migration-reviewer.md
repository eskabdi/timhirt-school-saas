REVIEWER: db-migration-reviewer (round 3)
WP: R6 WP-01. Reviewed `git diff ffe8242..1a5eec7`, head 1a5eec7.
VERDICT: PASS

All three major findings from round 2 are fixed, and I confirmed each one by running it. No blocker or major findings remain. Five minor and three info findings follow.

## Round-2 findings re-checked

**DM-1 (major): fixed.** The CHECK is gone. A BEFORE INSERT / UPDATE OF settings trigger now normalises writes instead of rejecting them.
- As an authenticated school_admin through RLS (dm_r3f), I sent the old da6055e-shaped PostgREST upsert: `insert … on conflict (tenant_id) do update set settings = excluded.settings` with `{"secondaryVisible":false,"geezNumerals":true}`.
- It succeeded and was stored as `{"numerals":"latn","show_hijri":false,"secondary_visible":false}`.
- The trigger still fires for authenticated even though EXECUTE on the trigger function is revoked from that role.
- onboard-tenant now wraps every insert in `must()`, so an error on the tenant_configs insert throws and triggers the rollback.

**DM-2 (major): fixed.** I built a seeded copy (dm_r3f_seed): 108 migrations, `seed.sql`, and 14 settings shapes. Then I applied 000002 twice.
- Shapes covered: the production and onboard-tenant camelCase shapes, `geezNumerals:true`, `{}`, calendar `{}`, `numerals:1`, `showHijri:"true"`, `"ARAB"`, `secondary_visible:"false"`, a null snake_case key next to a camelCase one, a nested `geezNumerals` inside an extra key, both spellings together, and calendar `1`.
- I also set the whole `settings` value to `[]`, `"str"` and `null`.
- First run: `UPDATE 9`. Every row was canonical, extra keys were kept, and rows with a top-level non-object or no calendar were left untouched. Second run: `UPDATE 0`.
- No errors, no growing arrays, no failed casts.

**DM-3 (major): fixed.**
- The migration header (lines 19-25) and `audit/FIXES_VERIFIED_R6.md:478,501` give the pre-apply production count, the expected post-state, pre- and post-apply queries, a forward-fix, and a statement that restoring Ge'ez is not supported.
- The count matches `audit/evidence/wp01-prod-calendar-and-schema-grants-20260925T154210Z.txt`: 3 object rows, 3 with `geezNumerals`, 0 with it true.
- Deploy order no longer matters (see DM3-2 for one transitional caveat).

**DM-4 (minor): fixed.** The suite covers scalar, array, null and invalid shapes, runs the migration twice, and pins the old-writer behaviour with `lives_ok` and a check of the stored value. I mutation-tested it:
- Remove `create trigger`: fails tests 10, 12, 14 and 15.
- Allow `'geez'` in the numerals list: fails test 6.
- Keep the `geezNumerals` key: fails tests 1, 10, 12 and 15.

**DM-5 (minor): fixed for what it claims.** The shim now matches the production evidence, checked with `has_table_privilege` / `has_schema_privilege` on dm_r3f:
- `auth.users` SELECT is false for all three API roles.
- vault USAGE is granted only to service_role.
- storage.objects SELECT/INSERT/UPDATE/DELETE and buckets SELECT are true for all three roles.
- Sequences and `pg_default_acl` are still not compared; CLAUDE.md already says so.

**DM-6 (info): fixed.** The comment in `useCalendarPrefs.ts` now cites 000002.

**DM-7 (info): fixed.** `run.sh:68,72` now matches `^(psql:.*: )?ERROR:`.

## FINDINGS

**DM3-1 | minor | supabase/migrations/20260925000002_r6_calendar_numerals.sql:66-85**
- **Evidence:** the backfill UPDATE runs before `create trigger`. I reproduced this on dm_r3f_seed: the migration ran in one transaction with a `pg_sleep(3)` inserted after the UPDATE, and a concurrent session inserted `{"calendar":{"secondaryVisible":true,"geezNumerals":false}}`. After commit, the row was still stored un-normalised with `geezNumerals`.
- **Scenario:** an onboard-tenant call or a settings save during the deploy leaves one camelCase row. Readers tolerate it (the new reader accepts camelCase, and `geezNumerals` is ignored), and the post-apply check at FIXES:501 would catch it.
- **Fix:** create the trigger before the UPDATE, which is still idempotent, or `lock table public.tenant_configs in share row exclusive mode` first.

**DM3-2 | minor | 20260925000002:23-25 and audit/FIXES_VERIFIED_R6.md:476,478**
- **Evidence:**
  - The header says the data "stays valid for both old and new readers". But the da6055e settings page reads `calendar.secondaryVisible ?? true` (`git show da6055e:src/features/settings/CalendarPreferencesPage.tsx:23`), and after the migration that key is gone.
  - The old page's save also replaces the whole calendar object. I confirmed a tenant's `arab`/`show_hijri:true` reset to `latn`/`false` via the RLS upsert.
  - FIXES:478 says all 3 production rows are `secondaryVisible: true`. The evidence file only counts keys, not values, so that claim is not verifiable.
- **Scenario:** a school with the Gregorian date hidden opens a stale old-SPA tab, sees the box ticked, presses Save, and the Gregorian date reappears. The same happens during the window between the migration and the frontend deploy.
- **Fix:** capture the values of `secondaryVisible` in the evidence (read-only query). Either deploy the frontend first, or correct the wording to "old readers show the default for secondary_visible until the frontend ships".

**DM3-3 | minor | supabase/tests/rls/catalog_storage_probe.sql:27-29**
- **Evidence:** tenant-B objects are seeded only in non-public buckets, so update and delete are never probed in `branding`. I planted `create policy … for update to authenticated using (bucket_id='branding')`:
  - With the file as shipped, the probe returned `{}` (missed).
  - With one tenant-B object added to branding, it reported "<role> updates tenant B objects" for every role.
- **Scenario:** a cross-tenant logo defacement policy passes the behavioural probe. It would still be flagged by the text classifier (no tenant term, not fingerprint-allow-listed), so this is defence in depth, not a hole.
- **Fix:** also seed a tenant-B object in public buckets, and exclude only the SELECT check for those buckets.

**DM3-4 | minor | audit/FIXES_VERIFIED_R6.md:457**
- **Evidence:** the round-1 row still says "a CHECK stops `geezNumerals` … being written back" and "7/7". Rows 476-478 supersede it, but the record contradicts the migration.
- **Fix:** add "(superseded by round 2: trigger, 15/15)".

**DM3-5 | minor | supabase/tests/rls/r6_calendar_numerals.sql:52**
- **Evidence:** the idempotency check compares `settings` only. If the `where settings is distinct from …` guard is removed (I tested this), the suite stays green even though every row is rewritten and `updated_at` is bumped on each rerun.
- **Fix:** also compare `updated_at`, or assert that the second run's row count is 0.

**DM3-6 | info | 20260925000002:64**
- **Evidence:** anon and PUBLIC have EXECUTE on `normalize_calendar_settings` revoked; authenticated and service_role keep it. They need it, because the trigger calls it as the writer.
- The function is pure SQL, not SECURITY DEFINER, and pins `search_path`. The trigger function is revoked from authenticated, which is harmless because trigger firing does not check EXECUTE (verified).

**DM3-7 | info | 20260925000002:83-85**
- **Evidence:** `update of settings` means updates that don't touch `settings` are not normalised. That is acceptable because the backfill covers existing rows.
- Locks are negligible: the table has one row per tenant, the trigger takes SHARE ROW EXCLUSIVE, and the UPDATE is small.

**DM3-8 | info | supabase/tests/run.sh:68**
- **Evidence:** a NOTICE whose text contains ": ERROR:" would now be counted as an error. That errs toward failing the run, never toward a false pass.

## CHECKED
- **Full harness on a fresh DB (dm_r3f), from a git-archive of 1a5eec7:**
  - 109 migrations applied, all suites ok, exit 0.
  - `r6_calendar_numerals` 15/15, `catalog_storage_probe` 10/10, `catalog_storage_policies` 15/16 (1 TODO WP-05), `catalog_module_gate` 8/9 (1 TODO).
  - `catalog_definer_security` 5/7 (2 TODO), `catalog_rls_coverage` 3/4 (1 TODO).
- **Seeded copy:** 108 migrations plus `seed.sql` plus the shape matrix; 000002 applied twice (see DM-2 above).
- **Transaction race:** reproduced (DM3-1).
- **RLS path:** old-client upsert as school_admin via PostgREST-style `on conflict`.
- **Catalog:** grants, volatility, `search_path`, owner, SECURITY DEFINER status, FORCE RLS on `tenant_configs`, and its policies.
- **Mutation tests:** 4 mutations of the calendar suite (DM-4 above), and the planted public-bucket probe gap (DM3-3).
- **Shim versus production evidence:** schema USAGE, `auth.users`, storage DML.
- **Code:** onboard-tenant `must()` error handling; old da6055e readers and writers of the calendar keys; new reader and serializer; plan §5 query 5 fix.
- **Not verifiable:** production `secondaryVisible` values (DM3-2), and behaviour against real Supabase (no staging).
- **Repo:** not modified. Scratch work is under /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad; scratch DBs are dm_r3f and dm_r3f_seed.

VERDICT: PASS
