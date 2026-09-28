# WP-09 round 2: payments-integrity-reviewer (pay)

- **Commit:** 01401ca

REVIEWER: pay
WP: R6 WP-09 maker-checker, round 2. I reviewed commit 01401ca in /home/user/rv-wp09 against 7c81fd7.
VERDICT: FAIL. PAY-R2-1 is a confirmed Medium finding. The round-1 threshold-splitting fix (PAY-4) works when payments are recorded one after another, but not when they are recorded at the same time.

The harness is green on my database rv2_wp09_pay: "All suites passed", EXIT 0 (log: /tmp/rv2-wp09-pay/run.log). I added a committed fixture of my own (/tmp/rv2-wp09-pay/fx2.sql): tenant A with a manual-payment threshold of 1000 ETB, tenant B, and eight invoices of 2000 ETB. Probes p1–p4.sql roll back. The two concurrency probes (ins.sql, ins2.sql) commit, into my database only.

FINDINGS

PAY-R2-1 | Medium | supabase/migrations/20260927000003_r6_maker_checker_hardening.sql:255-271 (`payments_manual_approval_gate`), with :221-252 and 20260927000002:499/512 (trigger names)
- **Scenario:** two cash/bank payments on the same invoice are recorded concurrently, for example two parallel `record-fee-payment` calls from one accountant. Each stays under the threshold on its own, but together they exceed it, and both are credited with no approval request.
- **Cause:** BEFORE INSERT triggers fire in name order. `payments_manual_approval_gate` runs before `payments_reject_void_invoice`, so it sums the day's running total before the invoice-header row lock is taken. The second transaction reads the total without the first's uncommitted row, decides "succeeded", and only then waits on the lock.
- **Evidence:** /tmp/rv2-wp09-pay/ins.sql, run twice concurrently as the accountant, 900 ETB each on header …0009-000000000004, threshold 1000. Both returned `inserted|succeeded`. Afterwards, payments were `900|succeeded` and `900|succeeded`, `fee_invoices` showed `1800.00|partial`, and there were 0 approval_requests.
- **Controls:** the same payments recorded one after another are gated correctly (p4.sql: 700+200+200 gives `pending`). The balance limit also serialises correctly under the same race (ins2.sql: two concurrent 1500 payments on a 2000 invoice gave `pending`, then `ERROR: amount_exceeds_balance`).
- **Fix:** take the header lock before reading the running total. Either move the lock into the gate through a small SECURITY DEFINER helper, since an invoker cannot `FOR UPDATE` invoice_headers, or rename the locking trigger so it fires first (e.g. `payments_a_lock_invoice`) and have the gate read after it. Add a two-session regression test.

PAY-R2-2 | Low | supabase/functions/record-fee-payment/index.ts:92-96
- **Scenario:** a receipt or bank reference that the school has already used gives a generic 500, because only `amount_exceeds_balance` and `invoice_void` are mapped. Any other database error falls through to `throw payErr`, then `errors.internal()`.
- **Evidence:** p3.sql, a second cash/bank payment in tenant A with provider_ref `RCPT-1` gives `ERROR: duplicate key value violates unique constraint "payments_manual_ref_uq"` (23505). The code path is plain from reading it; I did not run the Edge Function itself.
- **Fix:** map code 23505 to 409 `{error: "duplicate_reference"}` and add an i18n string for the invoice page.

PAY-R2-3 | Low (pre-existing since 20260820000001, not introduced by WP-09) | supabase/functions/enroll-finalize-billing/index.ts:126-131
- **Scenario:** the admission payment row is inserted with `invoice_id: invoice.id`, which is the fee_invoices line id. `payments.invoice_id` must be the invoice_headers id; the new composite FK is `(invoice_id, tenant_id) → invoice_headers`. For every invoice this function creates, the header id and line id differ, so the insert fails with 23503. That is thrown and swallowed as `billing_error: "billing_failed"`, so the declared admission payment is never recorded or credited. WP-09 only edited a comment in this file.
- **Evidence:** p3.sql, as service_role, inserting a payment with invoice_id set to fee line …000a-000000000007 gives `ERROR: … violates foreign key constraint "payments_invoice_tenant_fkey"`. The same insert with the header id succeeds.
- **Also:** `.maybeSingle()` at :84 for (student, structure) errors once a voided line and a re-issued line coexist, and that error is ignored, so a retry creates yet another invoice.
- **Fix:** use `invoice_id: headerId`, read `existingInvoice` with `.neq("status", "void")`, and add a backlog item.

PAY-R2-4 | Info | 20260927000003:224 compared with :259
- **Scenario:** the balance limit identifies a client by `current_setting('role')`, while the threshold gate uses `current_user`. Inside a SECURITY DEFINER RPC called by an authenticated user, the two disagree: the gate treats the insert as trusted while the balance limit treats it as a client.
- **Evidence:** a grep shows no definer function inserts into payments today, so nothing is reachable now.
- **Fix:** use one trust test in both triggers, or document the difference in the header.

PAY-R2-5 | Info | 20260927000003:260-263
- **Scenario:** the running total is per invoice and per Addis day. A payer can still split across days, or across two open headers for the same student. This matches the plan's wording.
- **Evidence:** p4.sql confirms the day boundary is correct. A payment 1 minute before Addis midnight is not counted; one 1 minute after is.
- **Fix:** none needed; record the limitation in the maker-checker register.

ROUND-1 FINDINGS RE-VERIFIED AS FIXED (each by probe unless marked as read only)
- **PAY-1:**
  - A pending payment counts against the balance: 1500 pending on 2000, then 600 gives `amount_exceeds_balance`, and 500 is accepted.
  - Execute re-checks the balance: after a 1000 gateway settlement, approving the parked 1500 gives `entity_changed` "The invoice no longer owes this amount", and the invoice stays at 1500 paid on 2000 (p1.sql).
  - The balance limit holds under concurrency (ins2.sql).
- **PAY-2:**
  - A client `amount_due=0` or `amount_paid=amount_due,status='paid'` gives `invoice_amounts_locked`.
  - A client DELETE on fee_invoices is refused, and a client UPDATE of payments changes 0 rows.
  - A client insert of a gateway payment is refused by RLS.
- **PAY-3:** a fee line added after the void request makes execute fail with `entity_changed` (p2.sql).
- **PAY-4:** fixed for payments recorded one after another, including the Addis-day window (p4.sql). It is not fixed under concurrency; see PAY-R2-1.
- **PAY-5:** `verify_document` on a voided invoice returns `void`. A payment against a void header is refused for both the client and service_role (`invoice_void`). The void checks in `issue-fee-document` (:63) and the refusal of a receipt for a non-succeeded payment (:113) were checked by reading only.
- **PAY-6:** the invoice_summary view derives `void`. The Fees, Financial and Platform reports, `AcademicRecordTab` and `generate-fee-invoices` all exclude void lines (read only). There is no unique index on fee_invoices (student, structure), so re-invoicing after a void is possible.
- **PAY-7:** with an expired pending payment request, `submit_approval('invoice_void')` succeeds. The expired request becomes `expired` and the parked payment becomes `failed` (p2.sql).
- **PAY-8:** a direct client update or removal of `settings.approvals` gives `approval_settings_rpc_only`. `set_approval_settings` writes an `APPROVAL_SETTINGS` audit row with before and after values. `merge_tenant_settings` is invoker and its section allow-list excludes `approvals`.
- **PAY-9:** the Zod rule rejects 1.005, 0.005 and 100.001 and accepts 9999999.99 and 33.3 (node test). The edge function and UI compare in cents and count waiting payments.
- **PAY-10:** backlog, as the fix table states. `issue-fee-document` now refuses a receipt for a payment that has not succeeded (read only).
- **PAY-11:** the list highlight excludes void, and a void filter option was added (read only).
- **provider_ref indexes:**
  - A cash/bank reference is unique per school: the same `RCPT-1` twice in tenant A is refused, while tenant B can use it.
  - Gateway references are unique across all schools: `GW-1` in tenant B, after tenant A used it, gives a violation of `payments_provider_ref_uq`.
  - A failed payment frees its reference (the index predicate excludes failed rows).
- **Admission path via service_role:** not limited by the balance check. A 2500 payment on a 2000 invoice succeeds and credits 2000, so the 500 excess is recorded but credited nowhere. This is by design ("recorded as declared"). See PAY-R2-3 for the wrong-id bug.

Files: /home/user/rv-wp09/supabase/migrations/20260927000003_r6_maker_checker_hardening.sql, /home/user/rv-wp09/supabase/functions/record-fee-payment/index.ts, /home/user/rv-wp09/supabase/functions/enroll-finalize-billing/index.ts. Probes are in /tmp/rv2-wp09-pay/: fx2.sql, p1.sql, p2.sql, p3.sql, p4.sql, ins.sql, ins2.sql and run.log.
