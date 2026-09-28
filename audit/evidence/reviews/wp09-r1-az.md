# WP-09 round 1: authz-reviewer (az)

Commit reviewed: `6d6f79f`. Probes: `/tmp/rv1-wp09-az/probe{1..5}.sql` (rolled back; database dropped afterwards). The harness is green.

**VERDICT: FAIL** (2 High, 2 Medium)

| ID | Severity | Location | Finding |
|---|---|---|---|
| AZ-01 | High | `20260927000002:562-579`, policy `invoices_update` | An accountant can set `amount_paid = amount_due, status = 'paid'` or `amount_due = 0` on fee_invoices directly. No payment and no approval (`5000.00\|5000.00\|paid`). |
| AZ-02 | High | `:196-203, 640-655` | School_admin moves the exam to a new unpublished term, edits the grade, moves it back: score 99, 0 requests. `update exams set max_score` on a published exam also succeeds. |
| AZ-03 | Medium | `:450-472`, policy `configs_write` | Approval settings can be switched off (via the RPC or a direct tenant_configs update) and back on without any audit row. A payment recorded in between is `succeeded` with no request. |
| AZ-04 | Medium | select policy `:124-131`, submit, decide, `module_gate_allowlist.sql` | With a module off, approval_requests are still visible and submit/decide still execute (payment credited, invoice voided, student transferred), even though the module gates on the target tables refuse. |
| AZ-05 | Low | `:654` | INSERT of a grade into a published exam is not gated (already in backlog, WP-08). |
| AZ-06 | Info | `record-fee-payment/index.ts:52` | No module/aal2 check on the Edge path; the aal/impersonation parts belong to WP-07. |
| AZ-07 | Info | `enroll-finalize-billing/index.ts:126` | Admission payment is not maker-checked (planned `admission_payment_accept`, WP-04). |
| AZ-08 | Info | `:429-445` | No `cancel_approval` RPC, and the expiry sweep is unscheduled. |

## Checked OK

- **Role matrix:** only the right roles can submit or decide.
- **Maker ≠ checker:** enforced both by the RPC and by a CHECK constraint.
- **Request integrity:** the hash, expiry and pending state are re-checked, and the row is locked.
- **Client writes:** clients cannot write approval_requests, and `execute_approval` is service_role only.
- **Visibility matches decide rights**, and a cross-tenant decide is refused.
- **Suspended tenant:** every path is refused.
- **Route guards** match the database.
- **WP-02 trust list** is applied.
- **Unpublishing and deletion:** results cannot be unpublished, and an exam with published grades cannot be deleted.
- **Receipts** are issued only for a succeeded payment.
