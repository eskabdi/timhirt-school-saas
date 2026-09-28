# WP-09 round 3: security-reviewer (sec)

- **Commit:** b260bf2

REVIEWER: sec (security), round 3
WP: R6 WP-09 maker-checker, commit b260bf2 (worktree /home/user/rv-wp09), in the context of 7c81fd7..b260bf2
VERDICT: FAIL (1 Medium, 1 Info)

The harness is green on my own database, rv3_wp09_sec. All migrations and suites passed, including maker_checker_hardening (71/71), maker_checker (65/65), definer_lockdown (60/60) and catalog_definer_security (10/10). Log: /tmp/rv3-wp09-sec/run.log. I re-ran my round-2 probes p1–p6 from /tmp/rv2-wp09-sec/ unchanged; output is in /tmp/rv3-wp09-sec/rerun.txt.

## FINDINGS

### SEC-R3-1 (Medium): a recorder can split a payment past the approval threshold by back-dating or forward-dating `created_at`
- **Location:** supabase/migrations/20260927000003_r6_maker_checker_hardening.sql:282-286, the running-total SELECT inside `payments_reject_void_invoice`.
- **Cause:** the day's running total counts only rows whose `created_at` falls on today's Addis date. `created_at` can be set by the client: `authenticated` has table-level INSERT on `payments`, and neither the trigger nor any policy overrides the column.
- **Scenario:** an accountant, or any holder of `payments:create`, POSTs to `/rest/v1/payments` with `"created_at": "<some other day>"` on each split. Every row is then outside "today", so `v_today = 0` every time. Each split at or below the threshold is recorded as succeeded and credited at once, with no approval request. It also plants false dates in the finance and audit record.
- **Evidence:** /tmp/rv3-wp09-sec/p7.sql, run as accountant a0003 with threshold 300 on an invoice owing 800:
  ```
  bd1|OK rows=1  bd2|OK rows=1  bd3|OK rows=1
  pays|300.00|succeeded|2026-09-25
  pays|300.00|succeeded|2026-09-26
  pays|200.00|succeeded|2026-10-03
  approval reqs|0
  line|800.00|paid
  ```
  The same three inserts without `created_at` give succeeded, then pending, then pending (p3/p5 below). This is the same threshold-splitting bypass SEC-05 and SEC-R2-1 were meant to close, reached through a different input.
- **Fix:** in `payments_reject_void_invoice`, when `v_client` is true, force `new.created_at := now()`. Also force `new.paid_at` to `now()` for a succeeded row, or NULL for a parked one. Alternatively, revoke table INSERT from authenticated and grant INSERT only on the columns the client may set. Add a pgTAP case that inserts with a back-dated `created_at`.

### SEC-R3-2 (Info): generate-fee-invoices can fail the whole batch if a chosen header is voided concurrently
- **Location:** supabase/functions/generate-fee-invoices/index.ts:125-161, together with the new `fee_invoices_header_open_check`.
- **Behaviour:** the function reads which headers are "open", then inserts every line in one statement. If one of those headers is voided in between, the new trigger raises `invoice_void`. The whole batch then fails with a generic 500 (`errors.internal`); nothing is written and nothing leaks.
- **Status:** found by reading the code, not reproduced end to end. The trigger half is proven by the v1/v2 race below.
- **Fix:** optional. Retry once after re-reading the headers, or map `invoice_void` to a 409.

## Round-2 findings re-verified as fixed
- **SEC-R2-1 (fixed):** p5.sql, with a registrar who has `payments:create` and `payments:read` and can see 0 payments, now gives:
  ```
  300 succeeded, 300 pending, 200 pending
  approval reqs|2
  line|300.00|partial
  ```
  In round 2 all three were succeeded. A two-session race (threshold 1000, two parallel 600 payments on one invoice, /tmp/rv3-wp09-sec/s1.sql and s2.sql on the committed copy rv3_wp09_sec_race) gives s1 succeeded and s2 pending, so the header lock serialises the running total.
- **SEC-R2-2 (fixed):** p6.sql now gives `reg line into void|ERR 22023 invoice_void`, and the invoice stays void. In a race where session 1 holds the header FOR UPDATE and voids its lines while session 2 (the accountant) inserts a line, session 2 waits and then gets `invoice_void` from `fee_invoices_header_open_check` (/tmp/rv3-wp09-sec/v1.sql, v2.sql).
- **SEC-R2-4 (fixed):** `information_schema.role_table_grants` shows no TRUNCATE for anon or authenticated on grades, exams, students, subjects, academic_terms, classes, approval_requests, tenant_configs, fee_invoices, invoice_headers or payments.
- **SEC-R2-3 (Info, deferred to WP-14):** unchanged, as expected; `transfer via graduated` still gives OK.

## CHECKED
- **p1–p4 re-run: no regressions.**
  - Invoice write-downs are refused with `invoice_amounts_locked`.
  - Cross-tenant payments are refused with 23503 (foreign key) and 42501 (RLS).
  - The void-after-request case still gives `entity_changed`.
  - The published-results locks hold.
  - The approval RPCs still reject: maker approving their own request, replay, and cancel by someone else or from another tenant.
  - Overpaying still gives `amount_exceeds_balance`.
- **`payments_reject_void_invoice`:**
  - SECURITY DEFINER, `search_path` pinned.
  - Treats the caller as a client unless `current_setting('role')` is on the trusted list.
  - Returns early for another tenant; the RLS WITH CHECK then refuses the row, and the payments and fee_invoices insert policies require the caller's own tenant, so the early return is not a bypass.
  - No BEFORE trigger on payments fires after it and resets `status`. Triggers on payments: apply_manual_payment*, audit_payments, payments_request_approval (AFTER).
- **`fee_invoices_header_open_check`:**
  - Revoked from public, anon and authenticated.
  - Takes the header FOR SHARE first, which is consistent with the header-then-lines order in payments, the void approval and gateway settlement.
  - No SQL path inserts a fee line and a payment on the same header in one transaction, so there is no share-to-update lock upgrade. The Edge Functions use separate PostgREST requests, and there is no import path for fee_invoices.
  - enroll-finalize-billing now creates its header and line before its payment, and credits the payment to the header id.
- **record-fee-payment 409 `duplicate_reference`:**
  - `payments_manual_ref_uq` is per tenant, and RLS refuses another tenant's row first, so there is no cross-tenant oracle.
  - The error key exists in en, am and om.
- **GradebookPage:** `approval_already_pending` is now reported as a failed row, not dropped silently. It is UX only; the database still enforces the gate.
