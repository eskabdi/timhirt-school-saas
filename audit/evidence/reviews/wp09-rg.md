**REVIEWER:** rg (regression guard)
**WP:** R6 WP-09, maker-checker (dual control). Commit `7cb1fc4`, diff `7c81fd7..7cb1fc4`; the WP-09-only part is `455ef8f` plus `b2fb56c..7cb1fc4`.
**VERDICT:** PASS. There are no confirmed Critical, High or Medium findings. Earlier fixes and prior-round guarantees still hold after WP-09.

## FINDINGS

**RG-1 · minor · `supabase/migrations/20260927000003_r6_maker_checker_hardening.sql:938-942`**
- **Unrequested behaviour change:** before this migration, `payments_provider_ref_uq` was one unique index across all schools. That blocked the same cash/bank reference being used at two schools. Cash/bank references are now unique only within a school (`payments_manual_ref_uq (tenant_id, provider_ref)`), and failed rows no longer count.
- **Scenario:** one CBE transfer reference is recorded as a bank payment at school A and again at school B. Before WP-09 the second insert failed with 23505. Now both succeed. `bank_payment_verifications` has only a primary key, so nothing else catches the reuse.
- **Reference:** plan §6 requires "duplicate TXN/voucher blocked across tenants" (WP-03 provides that later). FIXES_VERIFIED line 815 records the TI-R2-2 change but does not mention the lost protection.
- **Fix:** record this in `audit/backlog.md` and `docs/insa/_pending-changes.md` as a known gap until WP-03, or keep a cross-school duplicate check for `provider = 'bank'` inside the definer insert path.

**RG-2 · minor · `supabase/security/definer_allowlist.sql:45` and `…0002:~700` grant**
- `approval_required(uuid,text,numeric)` is still executable by authenticated. The allow-list reason says it is "called by the invoker payments gate as the inserting user", but 000003:252-253 dropped that gate.
- The catalog shows its only caller is the definer `payments_reject_void_invoice()`. No policy, view or app `.rpc()` calls it (app-rpc-grants lists 24 RPCs and it is not one).
- **Fix:** revoke it from authenticated and remove the allow-list row (it still answers only for the caller's own school), or at least correct the reason.

**RG-3 · info · `CLAUDE.md` Dual control paragraph**
- It says "The enforcement triggers are SECURITY INVOKER and trust only `current_user`". The payment gate, `payments_reject_void_invoice`, is SECURITY DEFINER and trusts `current_setting('role')`, and `fee_invoices_header_open_check` also runs for service_role.
- **Fix:** name those two as the definer exceptions.

**RG-4 · info · `supabase/functions/enroll-finalize-billing/index.ts:128-129`**
- **Unrequested behaviour change (a bug fix):** `invoice_id` changed from `invoice.id` (a fee line) to `headerId`.
- `payments.invoice_id` has referenced `invoice_headers` since `20260820000001:161`. So before this change, enrolment with payment evidence and a newly created header would have failed on the foreign key.
- No Edge or pgTAP test covers this path. Record it in FIXES_VERIFIED as a found-and-fixed bug.

**RG-5 · minor · not verifiable · 000003:98-106 (composite foreign keys)**
- The migration adds foreign keys on `payments(invoice_id, tenant_id)` and `fee_invoices(invoice_header_id, tenant_id)` against production data.
- Staging has no data, and no pre-deploy query for school mismatches is recorded. A mismatched row would make the deploy transaction fail (it is not destructive).
- **Fix:** before deploy, run a read-only query on production for rows whose school differs from their header's school.

**RG-6 · info · not verifiable**
- `semgrep-rule-test.py` could not run because semgrep is not installed.
- `deno` is not on PATH. I ran the check with a cached deno 2.9.6 binary instead.

## CHECKED
- **Full harness** on `rv4_wp09_rg` (since dropped): 114 migrations, 66 suites, all passing. The only TODOs are the known WP-06 module-gate and WP-05 storage ones.
  - Suites: `maker_checker_hardening` 81/81, `maker_checker` 65/65, `definer_lockdown` 60/60, `catalog_definer_security` 10/10, `catalog_rls_coverage`, `catalog_storage_probe`, `r6_hotfix`, `r6_hotfix_library_anon`, `tenant_suspension_lockout`, `webhook_settlement`, `promotion_*`, `student_transfer`.
  - Tests changed from the old behaviour (`fee_payment_recording`, `invoice_consolidation`, `resource_permissions_fees_comms_library`, `student_transfer`): I read the diffs and none of them weakens an assertion.
- **§7 guards:** the `resource_permissions*` suites, `catalog_module_gate`, `class_rank`, `grading_scales_lookup`, `payroll_sod` 7/7 and Vitest (16 files, 100 tests) are green. `grade_history_ledger` and `export-bank-transfer` do not exist yet (WP-08/12).
- **Other gates:** app-rpc-grants reports 0 findings. `tsc`, `eslint src`, `check:i18n` (0), `check:locales` and `build` all exit 0. deno-check passes: 28 functions, 3 baselined.
- **§5 queries:**
  - Q1 and Q2 return 0 rows.
  - Q3 returns only the tables already known to WP-06, plus `approval_requests`, which is on the allow-list.
  - Q5 returns 0 rows.
  - Q6: `verify_audit_chain()` does not exist yet (WP-10).
- **WP-00 containment:** `settle_gateway_payment` is still not executable by anon, authenticated or service_role, and its DECOMMISSIONED comment survives CREATE OR REPLACE. `cleanup_old_audit_logs` is still revoked from every API role.
- **Writers of each guarded table:**
  - I grepped every writer of payments, fee_invoices, invoice_headers, grades, exams, students.status, academic_terms.results_published and tenant_configs.settings in `src/`, Edge Functions and `pg_proc`.
  - The invoker callers are `promote_students_batch`, `revert_promotion_run`, `merge_tenant_settings` and `enroll_admission_application`. None writes `transferred`, touches `approvals`, or unpublishes.
  - The Edge Function writers all use the service key. `process-import-job` only writes `fee_structures` and inserts students.
  - Every settings writer goes through `mergeTenantSettings`.
  - No client code updates or deletes invoices or payments, and nothing writes an `overdue` status.
  - All definer functions and the guarded tables are owned by postgres.
- **Runtime probes** (one transaction, rolled back):
  - An admin upsert of a grade on an unpublished exam works for both a new and an existing row.
  - Merging the branding section keeps `approvals`.
  - A 500 ETB payment under a 1000 ETB threshold is credited.
  - A school with no approval settings parks the payment as pending. This is the plan's "default 0 = always" and is documented in OWNER_ACTIONS.
  - The service-role bank payment (the enrolment path) is credited.
  - A service-role transfer and a fee line added to an open header both work.
  - A direct change to `graduated` and publishing a term both work.
- **Suspension:** the approval RPCs get the school through `get_tenant_id_for_user`, so the suspension lockout still applies.
- **Void status consumers:** `invoice_summary`, `dashboard_billing` and `verify_document` are unchanged apart from the void handling, and every client that shows a status handles `void`.
- **Documentation:** CLAUDE.md's migration and suite counts (114 migrations, 66 suites) and its deployed-state paragraph are accurate.
- **Read-only:** the worktree status is clean.