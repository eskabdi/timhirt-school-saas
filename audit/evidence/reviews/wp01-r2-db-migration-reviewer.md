REVIEWER: db-migration-reviewer (dm_r2)
WP: R6 WP-01, `git diff bae3bfd..ffe8242 -- supabase/`
VERDICT: FAIL (3 major findings)

The harness side is sound. The full run is green, the ratchets and runner gates really do fail when they should, and the migration is idempotent on realistic object-shaped data. It fails on the new migration `20260925000002_r6_calendar_numerals.sql` for three reasons: the CHECK breaks the code that is live in production now, some data shapes abort the migration or are corrupted by it, and there is no rollback, pre-apply count or deploy order.

FINDINGS

DM-1 | major | supabase/migrations/20260925000002_r6_calendar_numerals.sql:36-40
- **Evidence:** the CHECK rejects any row that has the `geezNumerals` key, including `geezNumerals: false`. Two live writers always write that key:
  - The production frontend (da6055e), in `src/features/settings/CalendarPreferencesPage.tsx:30`: `calendar: { secondaryVisible, geezNumerals }`.
  - The production Edge Function onboard-tenant (da6055e), in `supabase/functions/onboard-tenant/index.ts:86-93`: `calendar: {secondaryVisible: true, geezNumerals: false}`. It does not check the insert's `error`.
- **Reproduced on the seeded copy:** after the migration, an old-shape write fails with `ERROR: new row ... violates check constraint "tenant_configs_calendar_numerals_chk"` (23514).
- **Impact:** between the migration and the function/frontend deploy, and afterwards for any browser tab still running the old SPA:
  - Every save on the Calendar Preferences page fails.
  - onboard-tenant creates a tenant with **no tenant_configs row**, silently, because the error is ignored.

  The deploy note (`audit/FIXES_VERIFIED_R6.md:466`) gives no order.
- **Reference:** this checklist ("enum/check changes backward compatible"); CLAUDE.md, "A READY deployment is not a shipped deployment".
- **Fix:** pick one:
  - Make the CHECK tolerant during the transition: reject only `(settings #>> '{calendar,geezNumerals}')::boolean is true`, or strip the key in a BEFORE INSERT/UPDATE trigger instead of rejecting it.
  - Or document and enforce the order: deploy onboard-tenant, then the frontend, then the migration.

  Either way, onboard-tenant should check the `tenant_configs` insert error.

DM-2 | major | supabase/migrations/20260925000002_r6_calendar_numerals.sql:20-32
- **Evidence:** tested against a scratch DB (`drop constraint`, then `\i` twice):

| `settings.calendar` shape | Result |
|---|---|
| `"x"` or JSON `null` | `ERROR: cannot delete from scalar` (line 26). The migration, and the whole deploy transaction, aborts. |
| `[]` or `["geezNumerals"]` | Not idempotent, and it corrupts the row. After run 1: `{"calendar": [{"numerals":"latn","showHijri":false}]}`. After run 2: `{"calendar": [{…},{…}]}`. The array grows every run. |
| `{"numerals":"geez","showHijri":false}` or `{"numerals":1,"showHijri":false}` | The WHERE clause skips the row (both keys present), so ADD CONSTRAINT fails: `check constraint ... is violated by some row`. |
| `showHijri` holding a non-boolean string such as `"maybe"` | The `::boolean` cast raises `invalid input syntax for type boolean`. |

  Object-shaped rows are handled correctly: other keys are kept, `geezNumerals` is removed, and a second run updates 0 rows. No count or shape query was run on production, so whether these shapes exist there is **not verifiable**.
- **Reference:** checklist ("idempotent DDL", "backfill before … check"); the brief asked about calendar values that are absent, non-object, or carry extra keys.
- **Fix:**
  - Add `and jsonb_typeof(settings->'calendar') = 'object'` to the UPDATE.
  - Normalise a non-object `calendar` explicitly (for example to `'{}'`, or reject it in a pre-flight check).
  - Rewrite `numerals` whenever it is not `'latn'`/`'arab'`, not only when it is missing.
  - Read `showHijri` only when `jsonb_typeof = 'boolean'`.
  - Or add the CHECK `NOT VALID` and `VALIDATE` it after a verified cleanup.

DM-3 | major | audit/FIXES_VERIFIED_R6.md:455-466 (no plan anywhere in the diff)
- **Evidence:**
  - There is no rollback or forward-fix plan for this migration. The data change loses information: `geezNumerals` is deleted and `updated_at` is bumped on every touched row by the `tenant_configs_updated` trigger (seen on the seeded copy).
  - No pre-apply count of affected rows or shapes was taken on production, and no post-apply check is defined.
  - There is no deploy order.

  For comparison, WP-00 had DM-1 and SR3-2 plans (`audit/prod-drift-2026-09-24.md:121`).
- **Reference:** checklist ("data migrations verified with counts; a rollback or forward-fix plan written in the PR").
- **Fix:** add three things to FIXES_VERIFIED_R6 / prod-drift:
  - A pre-apply read-only query: counts by `jsonb_typeof(settings->'calendar')`, `geezNumerals` true/false, and `numerals` present or invalid.
  - The expected post-apply counts (0 rows with `geezNumerals`, 0 rows violating the CHECK).
  - A forward-fix: `alter table … drop constraint tenant_configs_calendar_numerals_chk`. Say that restoring Ge'ez is intentionally not supported (Rule 8).

DM-4 | minor | supabase/tests/rls/r6_calendar_numerals.sql:17-37
- **Evidence:**
  - The suite applies the migration once, so idempotency is never asserted.
  - It has no case for a non-object calendar, a present-but-invalid `numerals`, or `geezNumerals: false`.
  - No test pins the old-client write that DM-1 rejects.

  This is why DM-2 passes the harness while the migration is still unsafe.
- **Reference:** CLAUDE.md, "Prove a gate fails before trusting that it passed."
- **Fix:**
  - `\ir` the migration twice and assert the settings are unchanged.
  - Add rows with calendar `[]`, `null` and `{"numerals":"geez","showHijri":false}`.
  - Add a lives_ok/throws_ok pair that fixes the chosen transition behaviour.

DM-5 | minor | supabase/tests/shim.sql:130-133
- **Evidence:** the TI-4 change (only service_role gets SELECT on `auth.users`) says "as on Supabase". But the only parity evidence, `audit/evidence/wp01-acl-parity-20260925T101802Z.txt`, was captured at 744f1d4, before this change. It covers only functions and tables in `public` (SELECT for anon/authenticated, INSERT for authenticated). It does not cover `auth.*`, `storage.*`, `vault`, sequences, or UPDATE/DELETE. So the claim that the harness mirrors Supabase for `auth.users` and the non-public schemas is **not verifiable**.
- **Reference:** CLAUDE.md, "Don't add a grant to the shim that Supabase doesn't make."
- **Fix:** re-capture parity after ffe8242. Include `has_table_privilege` on `auth.users` and the `storage.objects`/`buckets` DML for anon, authenticated and service_role, plus `pg_default_acl` rows.

DM-6 | info | src/features/settings/useCalendarPrefs.ts:7
- **Evidence:** the comment cites migration `20260925000001`, but the file is `20260925000002`.
- **Fix:** correct the number.

DM-7 | info | supabase/tests/run.sh:66
- **Evidence:** suites run without `ON_ERROR_STOP`, so errors are found only by the regex `^(psql:[^ ]+: )?ERROR:`. It misses an error if the checkout path contains a space. The plan-count check covers most of those cases, but not an error raised after `finish()`.
- **Fix:** match `^psql:.*: ERROR:`, or run suites with `-v ON_ERROR_STOP=1` and rely on the exit status.

DM-8 | info | supabase/tests/shim.sql:681-686
- **Evidence:** the default privileges are `for role postgres`. If CI runs as a different role, the grants would not apply. The ratchet does catch this: the "every baselined entry still offends" assertions would go red. So this is noted only.

DM-9 | info | supabase/security/module_gate_allowlist.sql
- **Evidence:** the plan names `module_gate_allowlist.txt`, but a `.sql` file loaded with `\ir` was used. The deviation is harmless.

DM-10 | info | 20260925000002:36-40
- **Evidence:** a validated ADD CONSTRAINT takes an ACCESS EXCLUSIVE lock and scans the table. `tenant_configs` has one row per tenant, so the lock is negligible. `NOT VALID` is not needed for lock reasons, only for DM-2.

CHECKED
- Read the full `supabase/` diff `bae3bfd..ffe8242`: migration, shim, run.sh, the 4 catalog suites, the 7 security baselines/allowlists, `r6_calendar_numerals`, `r6_hotfix_library_anon`, and the `onboard-tenant` diff.
- **Full harness** on a fresh DB `dm_r2`, from a git-archive copy of ffe8242: 109 migrations applied, 61/61 suites ok, exit 0. The TODOs are definer 2, RLS FORCE 1, module gate 1, storage 1.
- **Gates proven to fail** on a mutated copy (exit 1):
  - Removing `user_roles` from `rls_force_known` fails catalog_rls_coverage test 2.
  - A TODO that now passes fails with "flip them to hard assertions".
  - An ERROR after `finish()` fails the suite.
  - A test description containing "ERROR:" does not cause a false failure.
- **Migration idempotency:** applied twice on the migrated `dm_r2` (UPDATE 0 both times) and twice on a seeded copy (`dm_r2_seed`, migrations up to 20260925000001, `seed.sql`, plus 6 `tenant_configs` rows in the old-frontend and onboard-tenant shapes). Before: 3 rows with `geezNumerals` and 4 with a calendar. After: 0 and 4, with the other keys kept. The second run was a no-op. The old-shape write is rejected afterwards (DM-1).
- **Shape matrix:** 14 settings shapes, each applied twice (results in DM-2).
- **Old writers:** confirmed at da6055e (`CalendarPreferencesPage`, `onboard-tenant`), including the ignored insert error.
- **Evidence and docs:** the ACL parity evidence covers public functions and tables only and predates TI-4. There is no rollback, count or order plan for this migration in `audit/` or `docs/`. Checked the `tenant_configs` triggers, FORCE RLS and policies.
- **Not verifiable:** production `tenant_configs` shapes and counts, and Supabase's real grants on `auth.users`.
- **Repo:** not modified.
