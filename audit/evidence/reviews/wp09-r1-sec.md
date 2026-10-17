# WP-09 round 1: security-reviewer (sec)

Commit reviewed: `6d6f79f`. Probes: `/tmp/rv1-wp09-sec/p1..p6.sql`, all rolled back.

The harness is green: maker_checker 65/65, definer_lockdown 60/60, catalog_definer_security 10/10.

**VERDICT: FAIL** (3 High, 1 Medium)

| ID | Severity | Location | Finding |
|---|---|---|---|
| SEC-01 | High | policy `invoices_update` (20260817000004:251); guard `20260927000002:567-579` | A client can update fee_invoices to settle it (`amount_paid = amount_due, status = 'paid'`) or write it off (`amount_due = 0`), with no payment and no approval. |
| SEC-02 | High | `:640-655`, `:660-671` | Published grades can be changed in three ways: (a) move the exam's term and move it back; (b) update a grade's `exam_id` into the published exam; (c) insert a grade into the published exam. `exams.max_score` on a published exam is also unguarded. |
| SEC-03 | High | `:478-483`, `:536-560` | A tenant-A payment against a tenant-B header is approved and credits B's invoice (`…000b \| 5000.00 \| paid`). |
| SEC-04 | Medium | `:350-356` | The invoice_void execution does not compare the header with `payload.from`. The maker raises `amount_due` or adds lines after submitting, and the approval voids more than the checker saw. |
| SEC-05 | Low | `:186-190` | The threshold can be split: 5 × 1000 with threshold 1000 all succeed with no request. |
| SEC-06 | Info | triggers at `:490, 570, 643, 663, 677` | The triggers deny-list `authenticated`/`anon` instead of allow-listing trusted roles. |
| SEC-07 | Info | `:429-445` | `expire_approvals` is not scheduled. |
| SEC-08 | Info | `enroll-finalize-billing:121-131` | The admission payment is unchecked (WP-04). |

## Checked OK

- **Deciding:** maker ≠ checker; replay is blocked by a row lock plus the status check; the payload hash is enforced; clients cannot write approval_requests; cross-tenant submit and decide are refused.
- **Grants:** definer grants match the allow-list.
- **Direct client writes:** DELETE is revoked; a direct void and a direct transfer are refused; the unpublish guard works.
- **Edge Functions:** they go through the user client, and receipts are issued only for a succeeded payment.
- **Injection and XSS:** no dynamic SQL and no `innerHTML`.
