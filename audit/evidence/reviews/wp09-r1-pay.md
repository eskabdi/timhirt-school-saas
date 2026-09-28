# WP-09 round 1: payments-integrity-reviewer (pay)

Commit reviewed: `6d6f79f`. Probes: `/tmp/rv1-wp09-pay/p1..p6.sql`, all rolled back.

The harness is green: maker_checker 65/65, fee_payment_recording 12/12, invoice_consolidation 20/20.

**VERDICT: FAIL** (3 blockers, 5 majors, 3 minors)

| ID | Severity | Location | Finding |
|---|---|---|---|
| PAY-1 | blocker | `record-fee-payment/index.ts:72-77`; `execute_approval`; `apply_payment_to_invoice` | Pending payments do not count against the balance, and execute does not check the balance. Two 800 payments on an 800 invoice both succeed, and dashboard "collected" shows 1600. |
| PAY-2 | blocker | `fee_invoices_void_guard`; policy `invoices_update` | A client can write `amount_due = 0`, or `amount_paid = amount_due, status = 'paid'`, directly. |
| PAY-3 | blocker | `execute_approval` invoice_void branch | The void executes against the entity's state at decide time, not the reviewed `from` (800 reviewed → 50000 voided). |
| PAY-4 | major | payments gate / `approval_required` | The threshold can be split: 3 × 900 with threshold 1000 all post. |
| PAY-5 | major | `issue-fee-document:67-69`; `verify_document` | A void invoice still issues and verifies as `pending`. |
| PAY-6 | major | Fees, Financial and Platform reports; `AcademicRecordTab:83`; `generate-fee-invoices:110-133` | Void lines are counted as owed, block transcripts, and are treated as open headers. A student whose invoice was voided can never be re-invoiced. |
| PAY-7 | major | `:117, 403, 429-445` | Expiry is unscheduled. An expired request deadlocks its entity, and a pending payment blocks voids forever. |
| PAY-8 | major | `set_approval_settings`; tenant_configs | Lowering or disabling the control leaves no audit row. |
| PAY-9 | minor | `record-fee-payment:42,77` | More than 2 decimal places are accepted, and the tolerance is 0.01. |
| PAY-10 | minor | `ApprovalsPage:94-98` | The receipt for an approved payment is issued best-effort by the browser. |
| PAY-11 | minor | `InvoicesPage:380` | A void invoice is highlighted as unpaid. |

## Checked OK

- **Money columns:** numeric(12,2).
- **Crediting:** each payment is credited once; clients cannot update or delete payments.
- **Maker/checker and hash:** covered by the harness and passing.
- **Voids:** a partially paid invoice cannot be voided, and a payment against a void header is refused.
- **Summaries:** `invoice_summary` and `dashboard_billing` exclude void lines.
