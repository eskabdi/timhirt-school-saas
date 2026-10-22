# WP-09 round 1: state-concurrency-reviewer (sc)

Commit reviewed: `6d6f79f`. Probes: `/tmp/rv1-wp09-sc/` (two parallel psql sessions held open with pg_sleep).

The harness is green: maker_checker 65/65; vitest approvals 8/8.

**VERDICT: FAIL** (4 major)

| ID | Severity | Location | Finding |
|---|---|---|---|
| SC-01 | major | `execute_approval` void; `payments_reject_void_invoice`; `apply_payment_to_invoice`; `settle_gateway_payment` | A void races with a payment, and nothing locks the header. A: a line ends up void with 1000 paid. B: a payment succeeds and is credited nowhere. C: a Chapa settle un-voids the line (the filter `status <> 'paid'` includes void lines). |
| SC-02 | major | `execute_approval` manual payment; `record-fee-payment:71-72` | An approved payment executes on an invoice that is already paid. Two payments of 5000 against 5000 due: 5000 is collected and allocated to nothing. |
| SC-03 | major | `:117, 323, 403, 429-445` | An expired request can be neither decided nor resubmitted, so the entity is locked permanently, and the sweeper is not scheduled. |
| SC-04 | major | policy `invoices_update` | A client can write `amount_due`, `amount_paid` and `status` directly. |
| SC-05 | minor | status CHECK; ApprovalsPage | There is no cancel/withdraw. |
| SC-06 | minor | GradebookPage save | Batch submits are neither atomic nor idempotent; a retry is stuck on `approval_already_pending`. |
| SC-07 | minor | ApprovalsPage `decide` | No refetch on error, so the card goes stale. |
| SC-08 | info | void UPDATE vs credit `FOR UPDATE` | Possible deadlock from inconsistent lock order. |
| SC-09 | info | `approval_requests` | No trigger enforces state transitions for trusted roles. |
| SC-10 | info | `:521` | A trusted pending cash insert files no request. |

## Checked OK

- **Concurrent decides:** two checkers deciding at once serialize, and the payment is credited once.
- **Duplicate submits:** refused.
- **Stale entities:** stale grade and stale transfer are refused.
- **Terminal states** cannot be left through an RPC.
- **Client bypasses:** grade delete/reinsert and a direct transfer are refused.
