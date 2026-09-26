REVIEWER: payments-integrity (path-triggered, closes release-gate finding GK-3 for the payment/fee/payroll surface)
WP: R6 WP-01. Diff reviewed: `git diff da6055e..9ac652f` (head 9ac652f), limited to the payment, fee and payroll files.
VERDICT: PASS (no blocker or major findings; three minor and four info findings, listed below)

Overall: WP-01 changes no money logic. In the three Edge Functions and the fee/payroll pages, the edits are about names, CSV cells, and the billing toggle being saved through `merge_tenant_settings`. How payments are allocated, how amounts are computed and formatted in ETB, and who may approve payroll are all unchanged. No migration, grant or policy in the diff touches the RLS on payments, invoices or payroll tables. I found nothing that could credit a payment twice.

FINDINGS

1. id PAY-1 | minor | /home/user/timhirt-school-saas/src/features/fees/FeeStructuresPage.tsx:77-85 and :256
   - Evidence: the GK-5 fix (`disabled={!brandConfigLoaded}` plus a queryFn that throws on error) can be bypassed. The page shares the cache key `["tenant-config", tenant_id]` with other queries that behave differently:
     - `src/components/layout/DashboardShell.tsx:187-190`, `useBrandTheme.ts:13-17` and `StaffProfilePage.tsx:78-82` swallow the error and return `.data`, which is null.
     - `TimetableEditorPage.tsx:125-128` and `TeachersPage.tsx:188-192` select only `operational_mode_key`.
     - The global `staleTime` is 30 s (`src/app/providers.tsx:9`).
   - Failure scenario (a): DashboardShell's load fails. It caches `data=null` with status `success`. The admin opens Fee structures within 30 s, so no refetch happens. `isSuccess` is true, and the toggle is enabled and unchecked even though `billing.blockUnpaidBalance` is true in the database.
   - Failure scenario (b): the admin visits Timetable and then Fee structures within 30 s. The cached row has no `settings`, so the same wrong state shows with no error at all.
   - Impact: limited. The only write possible is `{billing:{blockUnpaidBalance:true}}`, and `billing` has no other keys, so nothing is lost. But the page shows the parent-portal download block as off when it is on. The GK-1/GK-5 fix is also not covered by any FeeStructuresPage test (none exists), although the gatekeeper asked for "a test".
   - Fix: give the page its own sub-key, e.g. `["tenant-config", tid, "billing"]`, as BrandingPage, ClassesPage and useCalendarPrefs already do. Add a component test for "load error → toggle disabled".

2. id PAY-2 | minor | /home/user/timhirt-school-saas/src/features/fees/FeeStructuresPage.tsx:86-95
   - Evidence: `toggleBlockUnpaid` has no `onError`, and `toggleBlockUnpaid.error` is never shown.
   - Failure scenario: a 42501 or a network failure makes the controlled checkbox silently snap back. The admin gets no message. This existed before WP-01.
   - Fix: show the mutation error, as the other settings pages do.

3. id PAY-3 | minor (pre-existing, owned by WP-12.2) | /home/user/timhirt-school-saas/src/features/hr/PayrollRunDetailPage.tsx:76-92
   - Evidence: `downloadBankFile` writes `csvCell(bankAccounts?.get(id) ?? "")`. It does not block rows with no bank account. It also does not wait for the `bankAccounts` query to load or check whether it failed.
   - Failure scenario: the sensitive-view query is still loading or has failed. The bank file then downloads with every `account_number` blank, and only the net pay amounts filled in.
   - WP-01 only switched this file to the shared `csvCell`. The check "bank-transfer export blocks missing accounts" is not met, and fix plan line 1872 assigns it to WP-12.2 (`export-bank-transfer`).
   - Fix (WP-12): refuse the export when any payslip has no account or the account query is not a success, and record an audit row for each export.

4. id PAY-4 | info | /home/user/timhirt-school-saas/src/lib/csv.ts:9
   - Evidence: the formula guard only looks at the first character, so cells starting with whitespace (e.g. `" =HYPERLINK(...)"`) or a full-width `＝` are not prefixed. Pure numeric strings are exempt, which is correct. I checked:
     - negative amounts from `toFixed(2)` stay numeric;
     - phone numbers like `+2519...` pass through;
     - all-digit bank account numbers are not prefixed with `'`, so bank uploads are not corrupted.
   - Fix (WP-12, when it widens `csvCell`): also check `s.trimStart()`.

5. id PAY-5 | info | /home/user/timhirt-school-saas/supabase/security/definer_anon_known.sql:13,46
   - Evidence: the new baseline lists `apply_payment_to_invoice()` and `payroll_run_transition()` as definer functions anon can execute.
   - Both are zero-argument trigger functions, which Postgres refuses to call outside a trigger. This is a recorded gap for WP-02, not a new weakening.

6. id PAY-6 | info | not verifiable here
   - `deno` is not installed in this environment, so I could not run `scripts/ci/deno-check.sh`.
   - I have not confirmed the Deno type-check of the changes to `record-fee-payment`, `issue-fee-document` and `enroll-finalize-billing` (including the `student.class as unknown as {…}` cast). By reading them, all three changes are name- and cast-only, and no error path changed.

7. id PAY-7 | info | /home/user/timhirt-school-saas/supabase/functions/_shared/names.ts:14, /home/user/timhirt-school-saas/src/lib/names.ts:18
   - `middle_name ?? father_name` is correct for students, which have only `middle_name`. Receipts, invoices, the enrolment PDFs, the invoice list, CSV and notifications now include the middle name. `fullName(null)` returns `""`, so a missing student does not throw during export.

CHECKED
- Every WP-01 hunk in the fee, payroll and CSV files listed above, plus `src/lib/names.ts` and `supabase/functions/_shared/names.ts`.
- `supabase/migrations/20260925000003_r6_tenant_settings_merge.sql`:
  - SECURITY INVOKER, with the tenant taken from `auth.uid()` rather than a parameter;
  - only four allowed section names; objects only;
  - `configs_write` (school_admin only) still enforces writes;
  - execute revoked from anon.
- Route guard: `fees/structures` is limited to school_admin, which matches the RLS.
- The WP diff over migrations, security baselines and shim: no grant or policy change on `payments`, `fee_invoices`/`invoice_headers`, `payroll_runs` or `payslips`. The payroll check that the approver is not the preparer is unchanged.
- Money handling in the touched code: amounts go through `Number(...).toFixed(2)` in CSV and `formatETB` in the UI. No `$` or USD. Balances in the PDFs come from lines re-read on the server after `apply_manual_payment_trg`.
- Tests run on HEAD 9ac652f:
  - `npx vitest run src/lib/csv.test.ts`: 3/3 passed.
  - `npx vitest run src/lib src/features`: 26/26 passed.
  - `npx tsc --noEmit`: clean.
  - `npx eslint` on the touched files: 0 problems.
- pgTAP on a fresh database (`review_payments_wp01`, since dropped): 110 migrations applied and all suites passed, including:
  - bank_verification 11/11
  - fee_documents 16/16
  - fee_payment_recording 12/12
  - invoice_consolidation 20/20
  - payroll_sod 7/7
  - resource_permissions_fees_comms_library 38/38
  - tenant_settings_merge 10/10 (a teacher gets 42501, other tenants are untouched, a non-object value is replaced, anon is refused)
- Out of scope for WP-01, as the task asked me to focus on this WP's surface: the submission state machine, duplicate TXN/voucher detection, dual control, receipt numbering and statement import. WP-01 did not touch them, so I did not review them.

VERDICT: PASS
