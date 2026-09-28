# WP-09 round 3: payments-integrity-reviewer (pay)

- **Commit:** b260bf2

REVIEWER: pay
WP: R6 WP-09 maker-checker, round 3. I reviewed commit b260bf2 in /home/user/rv-wp09, in the context of the full change 7c81fd7..b260bf2.
VERDICT: PASS. All four of my round-2 findings are fixed, and I found no new Critical, High or Medium issue.

**Harness:** I ran `supabase/tests/run.sh` on my own database, rv3_wp09_pay, against b260bf2. Result: "All suites passed", EXIT 0. `maker_checker.sql` 65/65 and `maker_checker_hardening.sql` 71/71. Log: /tmp/rv3-wp09-pay/run.log. I loaded my round-2 fixture (/tmp/rv2-wp09-pay/fx2.sql: tenant A with a threshold of 1000 ETB and eight invoices of 2000 ETB), ran the probes below, and then dropped the database.

FINDINGS

PAY-R3-1 | Low | supabase/functions/generate-fee-invoices/index.ts:125-160, together with the new trigger at 20260927000003:395-414
- **Scenario:** the function chooses each student's open header in a read, then inserts all fee lines in one batch. If a void of one of those headers is approved between the read and the insert, the new definer trigger `fee_invoices_header_open_check` correctly raises `invoice_void`. But that one error aborts the whole batch, so no student gets an invoice, and the caller sees a generic 500.
- **Evidence:** the trigger half is proven. /tmp/rv3-wp09-pay/va.sql held a header lock and voided its lines; at the same time, vb.sql inserted a line as service_role on that header. The insert waited, then failed with `ERROR: invoice_void … fee_invoices_header_open_check()`. The batch-abort consequence I established by reading the code; I did not run the Edge Function.
- **Fix:** on `invoice_void`, re-read the open headers and retry once, or give the affected student a fresh header. A backlog item is enough.

PAY-R3-2 | Info | supabase/migrations/20260927000003_r6_maker_checker_hardening.sql:93
- **Scenario:** `set local lock_timeout` only takes effect inside a transaction. The deploy wrapper runs each file in a transaction, so it works there. `run.sh` applies migrations without one (run.sh:35), so in the harness the statement is a silent no-op, and the timeout is never exercised locally.
- **Fix:** none required. Optionally, the wrapper could note that it depends on this.

PAY-R3-3 | Info | supabase/tests/rls/maker_checker_hardening.sql
- **Observation:** the concurrency fix has no automated regression test, because pgTAP runs in a single session. It is covered only by the recorded probe evidence in audit/evidence/wp09-r2-race-probes.txt, and by my probe below.

**Other things I looked at for breakage, with no issue found:**
- **Lock ordering:** every path takes the header lock first. Payment insert takes FOR UPDATE, fee-line insert takes FOR SHARE, and void execution takes the header and then its lines. No migration function inserts a fee line and then a payment in the same transaction. `enroll-finalize-billing` and `generate-fee-invoices` go through PostgREST, where each call is its own transaction. So I found no share-to-update lock upgrade that could deadlock.
- **`enroll-finalize-billing`:** re-invoicing after a void creates a new header, which has no lines, so the new trigger lets it through.
- **Gradebook `approval_already_pending`:** the key is in `approvals.ts:68` and in all three locales. The row is kept for retry.

ROUND-2 FINDINGS RE-VERIFIED AS FIXED

- **PAY-R2-1 (concurrent threshold split): fixed.**
  - I re-ran /tmp/rv2-wp09-pay/ins.sql in two concurrent sessions as the accountant: 900 ETB each on header …0009-000000000004, threshold 1000.
  - Session A returned `inserted|succeeded`. Session B waited on the header lock, then returned `inserted|pending`.
  - Afterwards the payments were `900|succeeded` and `900|pending`, the invoice line was `900.00|partial`, and there was one `manual_payment_accept|pending` approval request. In round 2 both payments succeeded and no approval request was created.
  - The balance limit still holds under the same race (ins2.sql): the first 1500 payment went `pending`, and the second failed with `amount_exceeds_balance`.
- **PAY-R2-2 (duplicate reference): fixed.**
  - `record-fee-payment/index.ts:96-100` maps SQLSTATE 23505 to 409 `duplicate_reference`.
  - `callFunction` (src/lib/functions.ts:13) turns the body's `error` into the thrown message, and `InvoiceDetailPage.tsx:197` shows `fees.errors.duplicateReference`, which exists in en, am and om.
  - The database half is probed: a client reusing a reference in the same tenant gets 23505 from `payments_manual_ref_uq`.
  - The only other unique index a payment insert can hit, `approval_requests_one_pending`, is keyed per payment, so it cannot raise a false 409.
  - I did not run the Edge Function itself.
- **PAY-R2-3 (`enroll-finalize-billing` invoice_id): fixed.**
  - The payment now uses `headerId` (:128-129), and the lookup of an existing invoice now skips void lines and takes the latest one (`.neq("status","void").order(created_at desc).limit(1)`).
  - Probe: a service_role `bank` payment of 2000 on header …0009-000000000007 succeeded, and the line became `2000.00|paid`.
- **PAY-R2-4 (one trust test): fixed.**
  - The invoker gate using `current_user` was dropped. Both the balance check and the threshold now live in the definer `payments_reject_void_invoice`, with one test on `current_setting('role')`.
  - Probe: a throwaway SECURITY DEFINER function, called as authenticated, inserted a 1500 cash payment and got `pending/postgres/authenticated`. So a definer RPC is treated as a client, and the threshold applied.

Files:
- /home/user/rv-wp09/supabase/migrations/20260927000003_r6_maker_checker_hardening.sql
- /home/user/rv-wp09/supabase/functions/record-fee-payment/index.ts
- /home/user/rv-wp09/supabase/functions/enroll-finalize-billing/index.ts
- /home/user/rv-wp09/supabase/functions/generate-fee-invoices/index.ts

Probes and outputs are in /tmp/rv3-wp09-pay/: ins.sql, ins2.sql, va.sql, vb.sql, and the matching *.out files plus run.log.
