# WP-09 round 2: security-reviewer (sec)

- **Commit:** 01401ca

REVIEWER: sec (security reviewer, OWASP/ASVS L2), round 2
WP: R6 WP-09 maker-checker. Commit 01401ca (worktree /home/user/rv-wp09); I diffed 7c81fd7..01401ca.
VERDICT: FAIL (1 Medium, 1 Low, 2 Info)

The harness is green on my own database, rv2_wp09_sec. It ran every migration including 20260927000003, and all suites passed, including maker_checker_hardening, definer_lockdown and catalog_definer_security. Probes are in /tmp/rv2-wp09-sec/p1.sql through p6.sql (fixture: /tmp/rv2-wp09-sec/fixture.sql). All of them are rolled back.

## Findings

### SEC-R2-1 (Medium): the threshold-splitting fix (SEC-05/PAY-4) can be bypassed by any payment recorder who is not school_admin or accountant
- **Location:** supabase/migrations/20260927000003_r6_maker_checker_hardening.sql:255-271 (`payments_manual_approval_gate`, the running total at :260-263).
- **Cause:** the trigger is SECURITY INVOKER, so its "today's running total" SELECT on payments runs under the caller's RLS.
  - `payments_select` is role-based: super_admin, or school_admin/accountant of the tenant, or a guardian/student of the invoice.
  - `payments_manual_insert` is permission-based: anyone with `payments:create`.
- **Scenario:** a school admin gives a registrar (a cashier) `payments:create`, plus `payments:read`, through `user_permission_overrides`. The registrar sees 0 payments, so `v_today = 0` on every insert. Each payment at or below the threshold is recorded as succeeded directly over PostgREST (`POST /rest/v1/payments`). The Edge Function's `requireRole` check does not apply to that path.
- **Evidence (p5.sql, threshold 300, invoice owes 800):**
  ```
  visible payments|0
  split1|OK  split2|OK  split3|OK
  pays|300.00|succeeded  pays|300.00|succeeded  pays|200.00|succeeded
  approval reqs|0
  line|800.00|paid
  ```
  The same three inserts made as the accountant (p3.sql) give succeeded, then pending, then pending, as intended.
- **Fix:** compute the running total in definer code. Either move it into `payments_reject_void_invoice`, which is already SECURITY DEFINER and tenant-bound, holds the header lock and fires after the gate; or use a tenant-bound SECURITY DEFINER helper. Park the row there (`new.status := 'pending'`). Add a pgTAP case with a non-accountant recorder.

### SEC-R2-2 (Low): a user with `fee_invoices:create` but no `fee_invoices:read` can add a line to a void invoice, which un-voids it without approval
- **Location:** 000003:355-358 (`fee_invoices_void_guard`, the INSERT branch).
- **Cause:** the "is this header void" check is an invoker read of fee_invoices, so it runs under `invoices_select`. A caller who cannot read the lines sees no rows and passes the check.
- **Evidence (p6.sql):**
  ```
  accountant line into void|ERR 22023 invoice_void     (correct)
  reg visible lines|0
  reg line into void|OK rows=1
  verify-like status|not void
  ```
  The invoice owes again, and payments are then accepted against it.
- **Precondition:** an admin must deny read while granting create. That is uncommon, hence Low.
- **Fix:** do the void-header check in a SECURITY DEFINER helper bound to the tenant (or a definer trigger), under the header lock.

### SEC-R2-3 (Info): moving a student to `graduated` takes them off the active roster (and class rank) with no approval
- **Location:** students_transfer_approval_gate (000003:438-447) gates only `transferred`.
- **Evidence (p2.sql):** `transfer via graduated|OK rows=1`, with `transferred_to` set.
- **Why Info:** `student_withdrawal` is deliberately deferred to WP-14 in approval_actions.
- **Fix:** none needed in WP-09. Note it for WP-14, which should cover every status that leaves `active` except graduation run by a trusted job.

### SEC-R2-4 (Info): `authenticated` still has the TRUNCATE privilege on grades, exams, students, subjects, academic_terms and classes
- **Evidence:** `information_schema.role_table_grants` in the harness. This mirrors Supabase defaults.
- **Reachability:** PostgREST cannot issue TRUNCATE, so it is not reachable today. Round 1 revoked it only on the invoice tables (DB-9).
- **Fix:** revoke it on the WP-09-protected tables as defence in depth (a later WP is fine).

## Round-1 findings re-verified as fixed (probes re-run on 01401ca)

- **SEC-01 (p1.sql):** the client write-downs are refused with `invoice_amounts_locked`: `amount_paid = amount_due, status = 'paid'`, `amount_due = 0`, `status = 'partial'`, a new `fee_structure_id`, and inserting a line with status `overdue`.
  - DELETE on lines and headers is refused (permission denied).
  - Inserting a header is refused by RLS. A header UPDATE affects 0 rows (no policy).
  - Payment UPDATE and DELETE affect 0 rows. A gateway-provider insert is refused by RLS.
  - Negative amounts are refused by CHECK constraints. Changing `fee_structures.amount` does not touch invoices.
- **SEC-02 (p2.sql):**
  - Moving a published exam's term, `max_score`, `category` or delete gives `results_published_locked`.
  - A grade `exam_id` moved into or out of a published exam, an INSERT into a published exam, and an upsert with ON CONFLICT all give `approval_required`.
  - An exam newly inserted into a published term cannot be graded without approval.
  - Deleting a grade affects 0 rows (no policy). Deleting the term, subject or student is blocked by the NO ACTION foreign keys.
  - Unpublishing gives `results_unpublish_blocked`.
- **SEC-03 (p3.sql):** a tenant-A payment against a B header fails with 23503 (the composite FK). A row claiming tenant B fails with 42501 (RLS). B's line is untouched (`0.00|pending`).
- **SEC-04 (p3.sql):** after a void request, a 100 ETB payment lands, and the approval fails with `entity_changed`. The suite also covers the "extra line added" variant.
- **SEC-05:** fixed for school_admin/accountant (300 succeeded, then 300 and 200 parked; an overpayment gives `amount_exceeds_balance`). Reopened for other recorders; see SEC-R2-1.
- **SEC-06:** every enforcement trigger in 000003 allow-lists current_user as postgres, service_role or supabase_admin. `payments_reject_void_invoice` uses `current_setting('role')`, which is correct for a definer. The only definer RPCs `authenticated` can call that write the guarded tables are submit_approval, decide_approval, cancel_approval, set_approval_settings, auto_assign_exam_seats and create_import_job/create_export_job. Import and enroll only insert (SEC-08 stays in the WP-04 backlog).

## Also checked
- **New RPCs (p4.sql):** `grade_entry_after_publish` refuses an accountant with no grades permission, a tenant-B student, an existing grade, a score above the maximum, a `"NaN"` score, extra keys and a reason over 500 characters.
  - Maker cannot approve own; replay gives `approval_not_pending`.
  - `cancel_approval` is refused for a non-maker and for an executed request. Tenant B cannot see or cancel A's requests.
  - A negative `grade_edit` score is refused.
- **Approval settings:** an accountant calling `set_approval_settings` gets `not_allowed`.
  - Writing `settings.approvals` directly gives `approval_settings_rpc_only`; `merge_tenant_settings('approvals')` is refused.
  - Deleting tenant_configs fails closed (approval required).
  - The BrandingPage and onboard-tenant writers do not trip the guard.
- **Injection/XSS:**
  - No dynamic SQL in the WP-09 functions.
  - New UI error text goes through the allow-listed `approvalErrorKey`, and there is no `dangerouslySetInnerHTML` or `innerHTML`. A stored `<img onerror>` remark is inert as text.
- **Edge Functions:**
  - record-fee-payment: amount in cents with 2 decimals and a cap; returns 202 with no receipt while pending.
  - issue-fee-document: refuses a receipt for a payment that has not succeeded, and an invoice whose lines are all void.
  - generate-fee-invoices: skips void lines.
- **Lock order:** request row, then invoice header, then lines, then payments, consistently in decide, execute and the payment path. I found no inverse order a single client statement can produce.

Files: /home/user/rv-wp09/supabase/migrations/20260927000003_r6_maker_checker_hardening.sql, /tmp/rv2-wp09-sec/p1.sql through p6.sql, /tmp/rv2-wp09-sec/fixture.sql
