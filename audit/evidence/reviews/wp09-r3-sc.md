# WP-09 round 3: state-concurrency-reviewer (sc)

- **Commit:** a6d673e

**VERDICT: PASS** (commit a6d673e, worktree /home/user/rv-wp09)

The full harness passes on my database `rv3_wp09_sc`: 114 migrations and every pgTAP suite, including `maker_checker` 65/65 and `maker_checker_hardening` 73/73. The only non-passing items are the 2 known TODOs (WP-05, WP-06). Probes and logs are in `/tmp/rv3-wp09-sc/`. `run2.sh <name>` runs `<name>_s1.sql` and `<name>_s2.sql` as two parallel psql sessions, ordered with `pg_sleep`. The fixture is `/tmp/rv1-wp09-sc/fixture.sql` plus `/tmp/rv2-wp09-sc/setup.sql`, with the threshold set to 3000 ETB for rD/rF and 250 ETB for the stress run.

## Round-2 findings re-verified as fixed

**SC-R2-1 (Medium, threshold race), fixed.** I re-ran rD against a6d673e.
- S1 (acc1) inserts 2000 cash on H24 and holds the transaction for 3 s. S2 (acc2) inserts 2000 cash on H24 one second later.
- S2 waited for S1 and got `pending`.
- Final state: payments `2000 succeeded` and `2000 pending`; the fee line has amount_paid 2000 (`partial`); 1 `manual_payment_accept` request. In round 2 both payments succeeded and no request was filed.
- Why it works: the threshold is now computed inside the SECURITY DEFINER `payments_reject_void_invoice` after `invoice_headers … FOR UPDATE` (20260927000003:266, 291-300), so the second insert counts the first. The client-supplied `created_at`/`paid_at` are overwritten (lines 277-283), and a parked payment has `paid_at` null.

**SC-R2-2 (Low, fee line added during a void), fixed.** I re-ran rF.
- S1 (admin2) approves `invoice_void` on H27 and holds for 3 s. S2 (admin1) inserts a 700 line into H27.
- S2 now waits and fails with `ERROR: invoice_void … fee_invoices_header_open_check() line 13`. H27 keeps only `5000 void`, and the request is `executed`. In round 2 the insert succeeded.
- I also checked the trusted path, service_role inserting several headers in one statement as generate-fee-invoices does:
  - **rJ (void first):** the insert over headers [21, 22, 29(voiding), 23] waits, then fails as a whole with `invoice_void`. No line is written, including on H21. The Edge Function maps this to 409 `invoice_changed_retry`. A re-run skips the void header, because a void line does not make a header "open".
  - **rI (insert first):** the approve waits about 1.5 s on the header FOR SHARE, then raises `entity_changed`. The decide transaction rolls back and nothing is voided. Details under SC-R3-1.

**SC-R2-3 (Low, gradebook), fixed.** I read the code; it was not driven in a browser.
- `src/features/gradebook/GradebookPage.tsx:82-86` now puts `approval_already_pending` into `failed`.
- `onSuccess` keeps those rows in `scores` (the `keep` set) and does not clear the reason.
- The en locale text is "A request for this is already waiting for approval. Withdraw it under Approvals to change it."
- A changed score is no longer silently dropped.

## Deadlock stress (reduced), new lock paths

Nine concurrent workers ran on 20 headers (H50..H69), 40 iterations each, twice:
- **g1:** service_role inserts across all 20 headers in ascending order in one statement (FOR SHARE on each header), holding the transaction for 50 ms.
- **g2:** the same in descending order over 50..65.
- **p1, p2:** client cash payments (acc1, acc2), which take the header FOR UPDATE.
- **t1:** trusted bank payments.
- **c1:** a gateway pending insert followed by `settle_gateway_payment` as postgres (payment row, then header).
- **a1, a2:** two checkers approving `manual_payment_accept`, holding the transaction for 20 ms.
- **v1:** submit and approve `invoice_void` on H66..69, which g1 keeps adding lines to.

Results:
- **No `deadlock detected` in any log.**
- Errors seen: `approval_not_pending` (the two checkers racing each other), `approval_already_pending`, and `entity_changed` (voids racing line inserts). All are expected.
- `integ.sql` found no header where amount_paid differs from its succeeded payments, no header with both void and open lines, and no overpaid line.
- 81 threshold-parked cash payments were approved and executed.

The lock order I read supports this:
- The multi-row insert takes only FOR SHARE, which is compatible across concurrent generate runs whatever order the rows are in.
- No path upgrades SHARE to UPDATE inside one transaction. enroll-finalize-billing and generate-fee-invoices insert headers, lines and payments in separate PostgREST calls, and no trigger on `fee_invoices` writes `invoice_headers`.
- Every other writer (the executors, the payment trigger, `apply_payment_to_invoice`, settle) touches one header, and each takes it before its lines.

## Findings

**SC-R3-1 | Info | 20260927000003 execute_approval, invoice_void branch (lines 762-776)**
- **Scenario (rI):** a generate run, or anyone else, adds a line to an invoice while its void is being approved. The approve raises `entity_changed` and the whole decide rolls back, so the request stays `pending`. The checker sees "Reject this request and make a new one."
- **Assessment:** this is correct, since the checker never saw the new line, and the database stays consistent.
- **Fix:** none required. Optionally, record the request as rejected or stale instead of leaving it pending.

**SC-R3-2 | Info | coverage**
- The stress run was short (about 5 s wall clock per run) at modest contention. It shows the absence of a deadlock under these interleavings, not a proof.
- The race fixes are still covered only by the recorded two-session probes, not by pgTAP (already in the backlog as PAY-R3-3).

## Checked

- Harness green at a6d673e.
- rD and rF re-run.
- New trusted multi-row probes rI and rJ.
- 9-worker stress runs with the integrity query.
- `payments_invoice_tenant_idx` exists.
- TRUNCATE is revoked from authenticated on grades, exams, students, approval_requests, tenant_configs, payments, fee_invoices and invoice_headers.
- Read: the payments trigger (client test via `current_setting('role')`, early return on a cross-tenant row, server-set dates), `fee_invoices_header_open_check`, the execute_approval lock order, the generate-fee-invoices and enroll-finalize-billing diffs, the record-fee-payment 409 `duplicate_reference`, and the gradebook diff.

**Not verified:** the Edge Functions were not run as deployed functions (their SQL was reproduced in psql), and the Gradebook and generate screens were not driven in a browser.
