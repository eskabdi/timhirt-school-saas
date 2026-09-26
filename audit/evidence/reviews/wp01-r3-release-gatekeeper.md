WP-01 FAILS the final gate. Every round-3 blocker and major the reviewers raised is fixed, and I confirmed each one by running it. What remains open is one new code major and two process majors, and none of the three has a recorded owner acceptance.

The code major is the same data-loss bug as round-3 M-1, still present on the Branding page. The fix is a few lines in two files plus one test. §0A.1 allows only 3 review rounds, so this goes to you rather than into a 4th round.

REVIEWER: release-gatekeeper
WP: R6 WP-01 (L-08, plus the owner-directed WP-14 pull-forward). Head 5829420 on claude/timhirt-security-audit-kan0ei, PR #9.
VERDICT: FAIL

**Gates I ran myself at 5829420 (all green)**
- `tsc` 0; `eslint src --max-warnings 0` 0.
- Vitest: 13 files, 86/86 tests.
- `check:i18n` 0; `check:locales` OK (common 2189, apply 135, calendar 44).
- `npm run build` OK.
- pgTAP on a fresh database: 110 migrations, 63/63 suites, exit 0. The TODOs are unchanged: definer 2, RLS 1, module gate 1, storage 1.
- `deno-check.sh`: 28 functions, 3 baselined, ok. Deno tests 31/31.
- `conventions.py`: self-test ok, 0 findings.
- `pinned-actions.sh` ok (7 uses, 1 pip install, hash-locked).
- semgrep rule test: 16 expected, 0 missing, 0 unexpected.
- gitleaks: 257 commits, no leaks. `no-payment-gateway` ok.

**Round-3 blockers and majors: closed, each confirmed by running it**
- **CQ M-1 / i18n N-01 on the Calendar and ID-card pages.** Both now write only their own section through `merge_tenant_settings`, and Save waits for the settings to load.
  - Removing the `!loaded` gate fails 2 tests.
  - Changing the RPC payload fails 1 test.
  - `tenant_settings_merge.sql` passes 9/9.
  - Grants: anon has no EXECUTE, authenticated does. The function is SECURITY INVOKER with `search_path` pinned.
  - Super_admin gets `not_allowed`; a missing row is created; a teacher gets 42501.
- **TI-R3-1 (storage guards).** I planted my own slips, not the reviewer's:
  - The text anchor flags a filename-keyed OR, a `foldername[3]` OR, a nested OR, and the reversed-order and `bucket_id IN` forms. The last two are safe false positives.
  - The only shipped expression outside the anchor is `public read branding`, which is on the fingerprinted allow-list.
  - The behavioural probe catches a filename-keyed read slip (`hr_officer reads tenant B in <15 buckets>`), a depth-3 literal slip, and a cross-tenant update in the public branding bucket.
- **TV-1 (full names).** Restoring the pre-fix StudentsListPage and ClassDetailPage gives `name-render 2`; HEAD gives 0.
- **TV-2 (calendar setting untested).** Forcing `numerals` to `latn` fails 2 tests.
- **insa-docs 1 and 2.**
  - `_pending-changes.md:109` says 63 suites.
  - The README no longer advertises Ge'ez numerals, and 2,368 = 2189 + 135 + 44.
  - CLAUDE.md says 110 migrations / 63 suites, with 000002 and 000003 pending.
- **Minors I also checked.**
  - The onboard rollback order deletes cleanly as service_role (the tenant row is gone afterwards).
  - `<html lang>` now follows the UI language.

**FINDINGS**

1. **GK-1 | major | The settings-wipe bug (M-1) is still open on the Branding page**
   - Location: `src/features/settings/BrandingPage.tsx:41-47` and `:138`; the same pattern is in `src/features/fees/FeeStructuresPage.tsx:74-77` and `:250`.
   - Evidence:
     - The queryFn returns `(await supabase.from("tenant_configs")…maybeSingle()).data` and never checks `error`.
     - postgrest-js turns fetch failures into `{data: null, error}` (`node_modules/@supabase/postgrest-js/dist/index.cjs:328`). A failed load therefore reports `isSuccess = true`, and the `!configLoaded` gate never engages.
     - A scratch test I ran outside the repo, with the load failing, printed: `SAVE DISABLED AFTER FAILED LOAD: false ALERT: false`.
     - Clicking Save then sent `merge_tenant_settings("branding", {nameEn:"",nameAm:"",nameOm:"",motto:"",logoPath:null,sealPath:null,…defaults})` and `update {school_type_key:null, operational_mode_key:null}`.
     - The result: a school's names, logo and seal paths, palette, school type and operating mode are overwritten. PITR is off, so this cannot be undone.
     - The ledger (`FIXES_VERIFIED_R6.md:510`) says "a load failure shows an alert" for all four pages. That is not true for Branding or Fee structures.
   - Reference: CLAUDE.md "no swallowed errors"; §0A.4 severity rules (data loss); the same class as round-3 CQ M-1.
   - Fix:
     - In both queryFns: `const { data, error } = await …; if (error) throw error; return data;`
     - Show a translated `role="alert"` load-error message on Branding, with the key in en, am and om.
     - Add a render test like `calendarPrefs.test.tsx` that checks Save is disabled after a failed load.

2. **GK-2 | major (process) | Nobody reviewed the new code in the round-3 fix commit**
   - Location: commit 5829420, which added:
     - migration `20260925000003` and the RPC `merge_tenant_settings`;
     - four rewritten settings pages;
     - `_shared/onboard-rollback.ts`;
     - rewritten storage guard suites.
   - Evidence:
     - All round-3 verdicts were written against 1a5eec7.
     - The new migration and RPC trigger db-migration, api-contract, authz and tenant-isolation review (§0A.3).
     - §0A.1 says: stop after 3 rounds and escalate to the human with the open findings.
     - My own review of this code found it sound except for GK-1 and GK-4.
   - Fix: the owner either records that this gatekeeper review stands in for the missing re-reviews, or authorises a targeted re-review.

3. **GK-3 | major (process) | Path-triggered reviewers never produced a verdict, and no waiver is recorded**
   - Evidence:
     - **payments-integrity:** triggered because the diff touches the fee and payroll functions (record-fee-payment, issue-fee-document, enroll-finalize-billing, PayrollRunDetailPage, and the invoice and payroll CSV exports).
     - **privacy-guardian:** triggered by exports (process-export-job, CSV) and storage buckets.
     - **state-concurrency:** triggered by jobs (the `_shared/jobs.ts` fail_job path).
     - The changes are name rendering and error paths only, so the risk is low. But §0A.5 says a missing required reviewer fails the WP, and the WP-00 gatekeeper applied that rule (`FIXES_VERIFIED_R6.md:134`).
     - The 8 core reviewers and the §0A.6 floor for WP-01 (supply-chain, infra-config) are all present.
   - Fix: record an owner waiver in `docs/insa/_pending-changes.md`, or run these reviewers.

4. **GK-4 | minor | A malformed `settings` value turns into an array**
   - Location: `supabase/migrations/20260925000003_r6_tenant_settings_merge.sql:37`
   - Evidence: when `settings` is `[1]`, the merge returns `[1, {"branding": {…}}]`.
   - Fix: `case when jsonb_typeof(settings) = 'object' then settings else '{}' end || …`

5. **GK-5 | minor | Fee structures toggle after a failed load**
   - Location: `FeeStructuresPage.tsx:74-86`
   - Evidence: after a failed load the toggle is enabled and writes `billing` with only `blockUnpaidBalance`. Today that is the only billing key, so nothing is lost yet.
   - Fix: covered by the GK-1 fix.

6. **GK-6 | minor | Branding saves in two separate writes**
   - Location: `BrandingPage.tsx:93-100`
   - Evidence: the save is the RPC followed by a column update. If the second write fails, the save is half-applied, though the error does show.

7. **GK-7 | minor | Open round-3 minors are missing from `audit/backlog.md`**
   - Evidence: CQ m-2 (CSV API and 3 ad-hoc writers), CQ i-2 (`shortName` unused), i18n N-05 (no Eastern-Arabic webfont), N-06 (om `hijriEraSuffix`), N-07 (no component tests for other settings pages), DM3-4 (the round-1 ledger row is not marked superseded), plus GK-4 to GK-6.
   - Fix: copy them into the backlog.

8. **GK-8 | info | Not verifiable locally**
   - The rollback's deletion of the invited auth user.
   - Behaviour against real Supabase (there is no staging project).

9. **GK-9 | info | I did not write to the ledger or the backlog**
   - Your instruction not to modify tracked files overrides this agent's permission to append to the ledger. The proposed ledger entry is below for you to apply.

**CHECKED**
- All 21 WP-01 verdict files and each reviewer's latest verdict.
- Every round-3 blocker and major, re-run or mutation-tested as listed above.
- The new RPC: grants, security type and search_path, the RLS path for teacher, anon and super_admin, a missing row, the concurrency pattern.
- Rollback delete order against the tenant foreign keys.
- Docs: counts, residual-risk table, deploy note, OWNER_ACTIONS B1.
- The tree is clean at 5829420. I removed my `deno.lock`, scratch database and scratch copy.

**Tests added in the WP (round 3)**
- `tenant_settings_merge.sql` (9)
- `calendarPrefs.test.tsx` (11)
- `onboard-rollback.test.ts` (3)
- storage probe, 10 → 14
- storage policies, 16 → 20
- conventions fixtures for the new name forms

**Residual risks**
- PITR is off (D-03), so any settings wipe (GK-1) cannot be undone.
- The old frontend reads only the camelCase keys until the new frontend ships.
- There is no staging project.
- ACL parity is checked for EXECUTE and SELECT/INSERT only.
- No webfont for Eastern Arabic digits.
- The Zod/RHF form convention is deferred.

**Proposed ledger entry** (for `audit/FIXES_VERIFIED_R6.md`)
> Release gate (5829420): FAIL. All gates green; round-3 majors CQ M-1/N-01 (Calendar/ID card), TI-R3-1, TV-1, TV-2, and insa-docs 1 and 2 verified closed by mutation or planted policies. Open: GK-1 (major, Branding and Fee structures swallow the load error, so Save writes defaults over branding), GK-2 (round-3 surface not re-reviewed), GK-3 (payments-integrity, privacy and state-concurrency verdicts missing, no waiver). Minors GK-4 to GK-7 go to the backlog.

**What must change for a PASS**
1. Fix GK-1 in both pages, with a test.
2. Get owner acceptance, recorded in `docs/insa/_pending-changes.md`, of GK-2 and GK-3, or run the missing reviewers.
3. Copy the GK-7 minors into the backlog.
4. Re-run the gates.

**Deploy prerequisites for the owner to approve** (after the fixes)
- Capture `tenant_configs` into `audit/evidence/` before applying anything, since PITR is off.
- Apply migrations `20260925000002` then `20260925000003`.
- Deploy the frontend immediately after, with `npm run deploy` (never `--prebuilt`), and grep the served bundle for `merge_tenant_settings`.
- Redeploy the 9 Edge Functions.
- Run the post-checks:
  - no camelCase calendar keys remain;
  - `has_function_privilege('authenticated', 'public.merge_tenant_settings(text,jsonb)', 'execute')` is true, and for `anon` is false.
- The owner signs off on the visible "· DD/MM/YYYY G.C." now shown on every date, and on the Amharic/Oromo weekday initials (OWNER_ACTIONS B3).

Key files:
- /home/user/timhirt-school-saas/src/features/settings/BrandingPage.tsx
- /home/user/timhirt-school-saas/src/features/fees/FeeStructuresPage.tsx
- /home/user/timhirt-school-saas/supabase/migrations/20260925000003_r6_tenant_settings_merge.sql
- /home/user/timhirt-school-saas/audit/FIXES_VERIFIED_R6.md
- /home/user/timhirt-school-saas/audit/backlog.md
- /home/user/timhirt-school-saas/docs/insa/_pending-changes.md

VERDICT: FAIL
