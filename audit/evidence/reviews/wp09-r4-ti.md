REVIEWER: tenant-isolation re-check (TI-R3)
WP: R6 WP-09 (maker-checker), commit a714c61, diff 7c81fd7..a714c61
VERDICT: PASS. TI-R2-1 is fixed. The sweep found no cross-tenant read, write, oracle or lock.

**Harness.** `run.sh` passes on rv5_wp09_ti at a714c61 (EXIT 0, "All suites passed"). maker_checker.sql is 65/65 and maker_checker_hardening.sql is 82/82. Log: /tmp/rv5-wp09-ti/run.log. The database has been dropped.

**TI-R2-1: fixed (verified by running the probes).**
- **Fix:** `payments_reject_void_invoice` (000003:263-265) and `fee_invoices_header_open_check` (000003:408-412) now return early. They do so for a client (role GUC not in the trusted list) whose `new.tenant_id` differs from `get_tenant_id_for_user(auth.uid())`. This is the same predicate as the INSERT WITH CHECK. So an early return happens only on a row that RLS refuses anyway, and it bypasses nothing.
- **Probe:** I replayed /tmp/rv2-wp09-ti/probe1.sql as the tenant-A accountant. Each of these inserts with `tenant_id=B` now gets the same `42501 new row violates row-level security policy`:
  - amount 4001 (above B's 4000 balance)
  - amount 4000
  - a header id that does not exist
  - B's header after it was voided
- `tenant_id=A` with B's header id gets 23503 `payments_invoice_tenant_fkey`. It is identical for an open B header, a void B header and a header that does not exist (P6/P7).
- **Lock (two sessions, with a control):** session 1 kept the tenant-A client's failed insert (tenant_id=B on B's header) open. Session 2 then ran `SELECT … FOR UPDATE NOWAIT` on that header and got the row, so no lock was taken. In the control, a tenant-A insert into an A header made session 2 fail with "could not obtain lock", so the probe can detect a lock. The fee_invoices variant gave the same result: B's header was not locked, and the A-header control was blocked.
- **Regression test:** maker_checker_hardening.sql:106-114 asserts 42501 both above and below B's balance. On the round-2 code the 4001 case raised 22023, so this test would have failed there.

**Sweep (run as tenant-A admin or accountant against committed tenant-B data)**
- **fee_invoices with tenant_id=B on B's header:** open and void give the same RLS error. With tenant_id=A, a B header (open or void) and a header that does not exist give the same 23503.
- **submit_approval:** `invoice_void` on an open B header, a void B header and a header that does not exist all return `not_allowed`. So does `student_transfer_out` on a B student (with a pending B request) and on a student that does not exist. The grade actions bind exam, student and subject to `v_tenant` (read at 000003:583-660). So `approval_already_pending` cannot reveal another tenant's entity.
- **decide_approval / cancel_approval:** a B request id and a random id both return `not_allowed`. The B request stays `pending`.
- **Reads:** approval_requests rows outside tenant A are 0. tenant_configs rows for B are 0.
- **Direct calls:** `approval_required` is denied to authenticated. `exam_results_published` answers only for the caller's own tenant (000002:196-202), and on a B exam the grades gate raises the same `approval_required` as on an exam that does not exist.
- **tenant_configs:**
  - An insert for tenant B with `approvals` is refused by the invoker guard, which looks only at the new row.
  - An insert for B without `approvals` gets the RLS error.
  - An update of B's row affects 0 rows.
  - `set_approval_settings` uses the caller's own tenant.
- **Reading only (not exploited):**
  - expire_approvals_for(v_tenant) is scoped to the tenant. Decide-time expiry touches only that one request (TI-R2-5).
  - execute_approval filters every write and the portal_notifications insert by `r.tenant_id`.
  - The AFTER triggers (`payments_request_approval`, `apply_payment_to_invoice`) and `tenant_configs_approvals_audit` run after the RLS check and filter by `new.tenant_id`.
  - `settle_gateway_payment` excludes cash and bank payments.
  - `invoice_summary` is security_invoker.
  - `approval_actions` is a global catalog with no tenant data.
  - The `approval_requests_one_pending (action, entity_id)` index cannot collide across tenants, because every entity id is validated in the caller's tenant.
- **Edge Functions (diff only):** record-fee-payment uses the user's client (RLS). In generate-fee-invoices, the service-role queries are keyed by a structure read through RLS and by `structure.tenant_id`.

FINDINGS
- **TI-R3-1 (minor, test gap):** location `supabase/tests/rls/maker_checker_hardening.sql:106-114`.
  - Evidence: only the balance variant of TI-R2-1 is asserted. Three things I verified by hand have no test: the void-status oracle (a tenant_id=B payment on a void B header), the `fee_invoices_header_open_check` early return (a fee line with tenant_id=B on a void B header), and the absence of a lock.
  - Fix: add two `throws_ok(…, '42501')` assertions, one for each void case.
- **TI-R3-2 (info, already tracked, not WP-09):** location `supabase/functions/enroll-finalize-billing/index.ts:79-81`.
  - Evidence: `fee_structures` is still fetched with adminClient by `p.fee_structure_id` and no tenant filter. This code is unchanged in this diff.
  - It is tracked as M-10 / WP-04 in the plan (line 193). It is not counted against this WP.

CHECKED
- The round-2 report; the 000002 and 000003 definer functions, triggers and policies.
- The live catalog: policies and triggers on payments, fee_invoices, invoice_headers, approval_requests, approval_actions, tenant_configs, grades, students, exams and academic_terms.
- The full harness run.
- Probe scripts: /tmp/rv5-wp09-ti/p1.sql, sweep.sql and lock1-4.sql.
- The Edge Function diffs.