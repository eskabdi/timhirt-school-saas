# WP-09 round 2: state-concurrency-reviewer (sc)

- **Commit:** 01401ca

REVIEWER: sc (state/concurrency), round 2
WP: R6 WP-09 maker-checker. I reviewed commit 01401ca in /home/user/rv-wp09 (diff 7c81fd7..01401ca).
VERDICT: FAIL. One Medium finding is confirmed by a two-session probe.

The harness passes on my database rv2_wp09_sc: all suites, including maker_checker 65/65 and maker_checker_hardening 64/64. Probes and outputs are in /tmp/rv2-wp09-sc/. `run2.sh <name>` runs `<name>_s1.sql` and `<name>_s2.sql` as two parallel psql sessions, ordered with pg_sleep. The fixture comes from /tmp/rv1-wp09-sc/fixture.sql, plus /tmp/rv2-wp09-sc/setup.sql.

FINDINGS

SC-R2-1 | Medium | supabase/migrations/20260927000003_r6_maker_checker_hardening.sql:255-271 (payments_manual_approval_gate); trigger order set at 20260927000002_r6_maker_checker.sql:499 and :512
- **What goes wrong:** the day's running-total threshold (the SEC-05/PAY-4 fix) can be beaten by two payments recorded at the same time.
  - BEFORE triggers fire in name order, so `payments_manual_approval_gate` runs before `payments_reject_void_invoice`, the trigger that takes the invoice-header lock.
  - The gate therefore sums `v_today` without the lock, from a snapshot that cannot see a concurrent uncommitted payment.
  - Two accountants, or one user with two tabs or two parallel calls to record-fee-payment, each post an amount under the threshold. Both are credited directly and no approval request is filed.
- **Evidence** (`rD_s1.sql` / `rD_s2.sql`): threshold set to 3000 ETB. S1 inserts 2000 cash and holds the transaction for 3 s. S2 inserts 2000 cash on the same invoice 1 s later.
  - Result: both `succeeded`; the fee line has amount_paid 4000.00 (`partial`); 0 manual_payment_accept requests.
  - Control: the same two inserts run one after the other give `succeeded` then `pending`.
- **Fix:** take the header lock before the running total is computed. Either rename the triggers so the locking one sorts first (for example `payments_a_lock_header`), or compute the threshold inside `payments_reject_void_invoice` after its `FOR UPDATE` and set `new.status := 'pending'` there. That function is a definer, so the status decision must be based on the client check it already makes, not on current_user. Add a two-session regression test (dblink, or an isolation-style test).

SC-R2-2 | Low | 20260927000003:340-358 (fee_invoices_void_guard, INSERT branch); supabase/functions/generate-fee-invoices/index.ts:125-160
- **What goes wrong:** a fee line can be added to an invoice at the moment it is voided, so an approved void is partly undone.
  - The guard checks whether the header is void by reading without a lock.
  - The void executor holds the header `FOR UPDATE` and has already voided the lines, but has not committed.
  - A concurrent client insert passes the guard (its snapshot still shows open lines). It then waits only on the foreign-key KEY SHARE and succeeds after the void commits.
  - The same window exists in generate-fee-invoices: it picks open headers, then inserts later. A trusted insert skips the void check entirely.
- **Evidence** (`rF_s1.sql` / `rF_s2.sql`): S1 is admin2 approving invoice_void on H27, held for 3 s. S2 is admin1 inserting a 700 pending line into H27 1 s later.
  - Result: INSERT 0 1. H27 now has lines `5000 void` and `700 pending`, and its request is `executed`.
  - Control: the same insert into an already-void header, run on its own, is refused with `invoice_void`.
- **Fix:** in the INSERT branch, run `perform 1 from invoice_headers where id = new.invoice_header_id and tenant_id = new.tenant_id for share` before the void check, for trusted roles too. Only lock the header when it belongs to the caller's tenant, as TI-R2-1 does. FOR SHARE conflicts with the executor's FOR UPDATE and keeps the header-first lock order. For a trusted insert into a void header, raise, or skip the row in generate-fee-invoices.

SC-R2-3 | Low | src/features/gradebook/GradebookPage.tsx (save mutationFn, the `if (key !== "approval_already_pending")` branch)
- **What goes wrong:** a changed score can be silently dropped while the teacher is told it was submitted.
  - A teacher submits a correction to 80, then changes the same row to 85 and saves again.
  - The RPC refuses with `approval_already_pending`, but the page counts that as success: it clears the row and shows "correctionsSubmitted".
  - The checker then approves 80, not the 85 the teacher thinks was sent. The page does not offer to withdraw the old request.
- **Evidence:** read the code, not run in a browser. The database side is confirmed: a second submit_approval on the same entity raises approval_already_pending (seen in the stress run, w5.log).
- **Fix:** count `approval_already_pending` as a failed row ("already waiting; withdraw it in Approvals to change it"), or treat it as success only when the pending request's `payload.to.score` equals the new score.

SC-R2-4 | Info | 20260927000003:99-118 (approval_requests_transition_guard)
- **Observation:** a trusted role can move a request pending → approved with no execution, and checker_id / decided_at can be rewritten together with a status change. The guard does refuse executed → pending, a skip from pending to executed, a reason change, and an update to a terminal request that leaves its status the same.
- **Evidence:** misc.sql. As postgres, an UPDATE to `approved` succeeded and the request stayed approved.
- **Fix:** optional, since only trusted roles can do this. Freeze checker_id, decided_at and decision_reason once they are set.

SC-R2-5 | Info | 20260927000003:517 (sweep inside submit_approval)
- **Observation:** the tenant-wide sweep waits on the row lock of any request that another session is deciding at that moment, so a submit can block for as long as that decision's transaction takes. The expiry also rolls back when the submit fails validation. Neither is a correctness problem: the waiting sweep re-checks the row and skips it (rH).
- **Fix:** none required. Keep the WP-16 scheduler in the backlog.

CHECKED

**Round-1 findings re-verified as fixed (by running them):**
- **SC-01 (void vs payment):**
  - Void first (rA): the payment waits on the header lock, then fails with `invoice_void`; the line stays void with 0 paid.
  - Payment first (rB): the void executor waits, then raises `entity_changed`; nothing is voided.
  - Gateway settlement: settle filters out void lines and returns `invoice_void`. submit_approval and execute_approval also refuse a void while a payment is pending or succeeded, so the un-void path is closed.
- **SC-02 (two pending payments over the balance)** (rC): the second insert waits on the header lock, then fails with `amount_exceeds_balance`.
- **SC-02 (concurrent approve of two payments)** (rE): pending 3000 + 2000 while the invoice owes 4000. The two checkers serialise; the second gets `entity_changed` ("no longer owes"). Credited 4000 = payments succeeded 4000.
- **SC-03:**
  - Deciding an expired request returns `expired`, the request is recorded as expired and its payment as failed.
  - The inline sweep in submit_approval, racing an in-flight approve (rH), waits for it, then skips the executed row; the payment stays succeeded.
- **SC-04:** a client update of amount_paid or status raises `invoice_amounts_locked`.
- **SC-05 and cancel vs decide** (rG), both orders:
  - Cancel first: decide gets `approval_not_pending`; the payment is failed and the request cancelled.
  - Decide first: cancel gets `approval_not_pending`; the payment is credited once.
- **SC-06:** saving is now per row. SC-R2-3 covers the remaining already-pending gap.
- **SC-07:** ApprovalsPage decide and withdraw call onDecided (invalidate the queries) in both onSuccess and onError. The buttons are disabled while the mutation is pending, and the database serialises double clicks.
- **SC-08 (deadlock from lock order)**, stress runs with no deadlock and no money mismatch:
  - Seven concurrent workers × 40 iterations on one invoice, mixing trusted and client payment inserts, two checkers approving, a service_role fee line insert, cancel plus the submit sweep, and gateway inserts. The settle calls in this run failed with a permission error, so settlement was not exercised here (settle is revoked from service_role by the R6 hotfix, by design).
  - Six workers × 40 invoices, mixing void submit/approve, client payments, gateway settle run as postgres, service_role line inserts and payment approvals.
  - Integrity query over both runs: no header that is both void and open or paid, and amount_paid equals the succeeded payments in every case.
- **SC-09:** the transition guard refuses invalid transitions and payload changes, even for postgres (misc.sql); SC-R2-4 notes what it still allows.

**Lock order read in the code:** header → lines by created_at in apply_payment_to_invoice, payments_reject_void_invoice, settle_gateway_payment and execute_approval (payment and void). The request row lock is always taken before the header or the payment row.

**Not verified:** the GradebookPage and ApprovalsPage behaviour was read, not driven in a browser. generate-fee-invoices was not run as an Edge Function; its race is inferred from the same trigger path shown in rF.
