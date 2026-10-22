REVIEWER: perf (PERF9-)
WP: R6 WP-09 maker-checker, a714c61 (diff 7c81fd7..a714c61)
VERDICT: FAIL. One confirmed Medium finding.

The fixture: I ran run.sh on rv5_wp09_perf. It applied 114 migrations, all suites passed, with 2 known TODOs. Seed: 3 schools, 5 staff each, 600 students per school (1,800 total), 18k invoice headers and lines, 16.2k payments, and 5,000 approval_requests. I then scaled to 20k requests per school. All measurements are EXPLAIN ANALYZE as `authenticated` with the jwt sub set. The database has been dropped.

FINDINGS

PERF9-1 | Medium | supabase/migrations/20260927000003_r6_maker_checker_hardening.sql:171-179 (policy) and src/features/approvals/ApprovalsPage.tsx:39-42
- **Scenario:** the policy calls `approval_action_module_on()` → `has_module()`, plus `has_resource_permission()` with a subplan on approval_actions, once for every row of the school.
  - The policy's `tenant_id is null OR tenant_id = …` produces a BitmapOr, so the `order by created_at desc limit 100` is a full scan plus a sort. Postgres evaluates the policy on every row of the school before the limit applies.
  - Volume follows cash payments: with no `tenant_configs.approvals`, `approval_required` returns true. I measured this: an accountant's 500 ETB cash insert was parked as `pending` and a request was filed. A 600-student school paying monthly in cash produces about 6k requests a year.
- **Measured, History view (`status <> 'pending'`):**
  - 1,667 rows per school: 92 ms (admin), 122 ms (accountant). That is about 60–70 µs per row.
  - 20k rows per school: 1,437 ms (admin), 1,227 ms (accountant).
- **Measured, Mine view:** an accountant with 9.6k own requests: 383 ms (BitmapAnd, then the policy runs on 9,583 rows).
- **Index alone does not fix History:** with a temporary `(tenant_id, created_at desc)` index, History was still 1,223 ms (BitmapOr again).
- **Fix (measured in a rolled-back transaction):**
  - Compute the permitted actions once per query as initplans: `action = any((select array(select a.action from approval_actions a where a.module is null or has_module(<tenant>, a.module)))::text[]) and (maker_id = (select auth.uid()) or action = any((select array(select a.action from approval_actions a where has_resource_permission(auth.uid(), a.checker_resource, 'approve')))::text[]))`.
  - Result: History went from 1,227 ms to 20 ms with the same row count (19,417 = 19,417). The badge query took 3.9 ms.
  - Add `(maker_id, created_at desc)`: Mine went from 383 ms to 4.8 ms (ordered index scan, stops at 100).
  - Ship this in 000003 (not yet deployed) or in a 000004.

PERF9-2 | Low | src/features/gradebook/GradebookPage.tsx:79-89
- **Scenario:** after results are published, the gradebook sends one `submit_approval` RPC per corrected student, in a sequential `await` loop: an N+1.
- **Measured:** the database side costs 70 ms for 60 calls (about 1.2 ms each, admin maker). Client latency is about N × network round-trip. I did not measure the RTT from Ethiopia, so the end-to-end cost is not verified.
- Corrections after publication are expected to be rare and small, hence Low.
- **Fix:** run the calls through `Promise.allSettled` with a small concurrency limit, or add a batch RPC.

PERF9-3 | Info | supabase/migrations/20260927000003…:404-423, 426-449
- **Measured trigger overhead on bulk paths:**
  - fee_invoices: service_role inserting 600 lines (generate-fee-invoices for a whole school) took 61–63 ms against 49 ms with `fee_invoices_header_open_check` disabled. The check adds about 17 µs per row, using `fee_invoices_header_idx`.
  - grades: an admin upsert of 60 rows (gradebook bulk save) took 40.7 ms against 26.2 ms with the gate disabled. `grades_publication_approval_gate` costs about 100 µs per row.
- Both are acceptable.

PERF9-4 | Info | supabase/migrations/20260927000003…:255-303
- **Measured:** one accountant cash insert with 16.2k payments in the table took 15.9 ms in total: `payments_reject_void_invoice` 5.4 ms, `payments_request_approval` 4.1 ms. This uses `payments_invoice_tenant_idx`.
- record-fee-payment adds one extra read (waiting payments); it is not an N+1.
- On approval, ApprovalsPage issues one receipt per decision, not per list row.

PERF9-5 | Info | src/components/layout/DashboardShell.tsx:210-219
- The badge refetches every 60 s for each staff tab (no refetch in the background).
- **Measured:** 6–13 ms, a bitmap scan on `approval_requests_pending_expiry`.
- The invoice page's pending-void lookup uses `approval_requests_one_pending` (0.03 ms).

CHECKED
- The harness build (114 migrations and the pgTAP suites) on a fresh database.
- EXPLAIN ANALYZE on all four inbox queries, the badge and the pending-void lookup, as admin and as accountant, at 1.7k and 20k requests per school, before and after the candidate index and policy changes.
- How the policy's row predicate is planned: the BitmapOr and the per-row subplan, 1,168 to 10,334 loops.
- Trigger cost on fee_invoices (fresh headers and the append-to-open-header path), grades upsert, and a client payments insert, each with the trigger enabled and disabled.
- The default approval threshold behaviour (every cash payment is parked).
- 60 × `submit_approval` at the database level.
- The gradebook "existing grades" query with 60k grades: 14 ms, using the unique composite index.
- The Edge Function diffs: generate-fee-invoices still does batch reads plus one insert, and there is no new per-row call in issue-fee-document, record-fee-payment or enroll-finalize-billing.
- The expiry sweep runs inside `submit_approval` on the partial index.
- The approval pages are imported eagerly. This matches the router, which has no `lazy()` anywhere, and the two files total 16 KB of source.

Not checked: the bundle-size delta (I did not run `npm run build`), and client network round-trip latency.

Scratch scripts: /tmp/rv5-wp09-perf/seed.sql, scale.sql, q1.sql through q8.sql (q4.sql holds the rewritten policy), run.log.