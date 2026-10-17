# WP-09 round 2: db-migration-reviewer (db)

- **Commit:** 01401ca

REVIEWER: db (db-migration-reviewer), round 2
WP: R6 WP-09 maker-checker. Commit 01401ca, worktree /home/user/rv-wp09. Focus: safety of 20260927000003.
VERDICT: FAIL (1 Medium, 1 Low, 2 Info)

The migration applies cleanly, fails safely and leaves existing data untouched. The FAIL is for one missing index.

FINDINGS

DB-R2-1 | Medium | supabase/migrations/20260927000003_r6_maker_checker_hardening.sql:78-81, 244-246, 259-263
- **Problem:** `public.payments` has no index on `invoice_id` or `tenant_id`. Its only indexes are the pkey, `payments_provider_ref_uq` and `payments_manual_ref_uq`. 000003 adds two things that depend on such an index:
  - the composite foreign key `payments_invoice_tenant_fkey (invoice_id, tenant_id)`, which has no supporting index on the referencing side;
  - two new per-insert scans of `payments` by invoice: the pending cash/bank sum in `payments_reject_void_invoice` and the Addis-day running total in `payments_manual_approval_gate`.
- **Why it matters:** the running-total trigger is SECURITY INVOKER, so its scan goes through the client's RLS policy row by row, across every tenant's payments. Both scans run while the invoice-header row lock is held. So every cash or bank payment gets slower as the whole platform's payments table grows, and the invoice stays locked the whole time.
- **Evidence:** on a populated copy with 300k payments rows, one client cash insert (accountant, tenant bb, an invoice with 1 payment), measured with EXPLAIN ANALYZE:
  - without an index: `payments_manual_approval_gate` 602 ms, `payments_reject_void_invoice` 31 ms, total 640 ms;
  - inside the same transaction after `create index payments_invoice_tenant_idx on public.payments (invoice_id, tenant_id)`: gate 11 ms, void check 1.8 ms, total 22 ms.
- **Reference:** the review checklist item "indexes that support RLS predicates and FKs".
- **Fix:** in 000003 (not yet deployed), or in a new 000004, add `create index if not exists payments_invoice_tenant_idx on public.payments (invoice_id, tenant_id);`. A plain CREATE INDEX is acceptable inside the deploy transaction, because production's payments table is small and `lock_timeout` is already set.

DB-R2-2 | Low | 000003:60-71 (forward-fix header)
- **Problem:** the forward-fix plan covers the composite FKs, the triggers and the earlier function definitions. It does not cover:
  - the `payments_provider_ref_uq` swap: the old index was unconditional and global (`20260713000010:171`), and now there are two partial indexes, one global for gateways and one per tenant for cash/bank;
  - restoring the old `approval_requests` checks (`status_check`, `decided_has_checker`, `tenant_scope`);
  - `approval_requests_transition_guard`. As postgres, `update approval_requests set decision_reason='x' where status='executed'` fails with `approval_invalid_transition`, so an operator's data fix needs `drop trigger` first. The notes do not say so.
- **Fix:** add these three items to the header, or to the deploy runbook.

DB-R2-3 | Info | 000003:74, 885
- **Problem:** `reset lock_timeout` puts the setting back to the server default, not to whatever the deploy wrapper had set. If the file fails, the rollback also undoes the `set`, so that path is safe.
- **Fix:** use `set local lock_timeout = '5s'` and drop the `reset`.

DB-R2-4 | Info (pre-existing, outside WP-09; not run end to end) | supabase/functions/enroll-finalize-billing/index.ts:127
- **Problem:** the insert uses `invoice_id: invoice.id`. That is the fee_invoices line id, but `payments.invoice_id` references `invoice_headers`. Header ids never equal line ids (`20260820000001:86-89` generates new ids). So an admission with payment evidence fails with FK violation 23503, and the 23505-only catch rethrows it. This was already true at 7c81fd7, and the new composite FK keeps it.
- **Fix:** use `invoice_id: headerId`, in its own WP.

CHECKED
- **Fresh database:** `run.sh` on `rv2_wp09_db` applied 114 migrations; all 66 pgTAP suites passed. `app-rpc-grants` reported 24 RPCs and 0 findings.
- **Separate transactions:** the 113 prior migrations each applied with `psql --single-transaction`, so 000001 and 000002 each ran in their own transaction. 000001 and 000002 together in one transaction fail with `unsafe use of new value "void" of enum type invoice_status` (DB-11 confirmed; the runbook must keep them separate). 000002 and 000003 together in one transaction apply.
- **Populated copy:** built from the 113 prior migrations and seeded with 2 tenants, 250 headers, 450 fee lines, 400 grades (one published term), 185 payments (cash/bank succeeded, chapa pending, chapa and cash failed with references), tenant_configs holding approvals for both tenants, and approval_requests in executed, rejected and expired states, plus a pending one already past `expires_at`, a pending transfer and a pending manual payment whose parked cash payment was filed through the real trigger.
  - 000003 applied in a single transaction in 0.075 s.
  - md5 snapshots of payments, fee_invoices, grades, approval_requests and tenant_configs are identical before and after.
  - All new constraints show `convalidated = t`: `invoice_headers_id_tenant_key`, both composite FKs, `status_check`, `decided_has_checker`, `tenant_scope`.
  - The `approval_actions.module` backfill is complete (only platform/WP-07 actions have a null module), and every module key it uses resolves through `has_module` for both tenants.
- **Lock timeout:** with a reader holding AccessShare on payments, 000003 aborted after 5.05 s at line 81 (`canceling statement due to lock timeout`) and rolled back completely (0 new constraints). The retry after the reader finished succeeded.
- **Composite FK on bad existing data:** with one cross-tenant payment row seeded, 000003 fails with a clear `payments_invoice_tenant_fkey` violation and rolls back fully. This matches the production and staging preflight (0 such rows).
- **provider_ref index swap:**
  - existing data builds both new indexes;
  - a rejected payment's reference (RCPT-PEND-1) can be reused;
  - the same cash reference in another tenant is accepted (`cash-1`);
  - a duplicate within the same tenant is refused with 23505 on `payments_manual_ref_uq`;
  - enroll-finalize-billing's idempotency lookup still holds, because its references contain the application id.
- **DB-1 fixed:**
  - refused with `results_published_locked`: moving a published exam to another term, changing its max_score or weight, moving an unpublished exam into a published term, deleting a published exam;
  - refused with `approval_required`: moving a grade into a published exam, editing a published grade;
  - still allowed: editing a grade in an unpublished term;
  - a client DELETE on grades removes 0 rows (there is no delete policy).
- **DB-2 fixed:** `amount_due = 0`, `status = 'paid'` and inserting a line already paid are refused with `invoice_amounts_locked`. Inserting a pending line and editing `due_date` still work.
- **DB-3 fixed:** see Lock timeout above.
- **DB-4:** the forward-fix plan is present but has the gaps in DB-R2-2.
- **DB-5:** accepted as documented. Re-applying 000003 fails closed at line 77 (`relation "invoice_headers_id_tenant_key" already exists`).
- **DB-6 fixed:** `verify_document` now has a `void` branch (read in the code, not run).
- **DB-7 fixed:** see provider_ref index swap above.
- **DB-8 fixed:** `approval_requests_checker`, `approval_requests_action` and `approval_requests_pending_expiry` exist.
- **DB-9 fixed:** there is no TRUNCATE grant to anon or authenticated on the three invoice tables, and a client `truncate` gets 42501.
- **tenant_configs guards:**
  - a direct client write to `settings.approvals` is refused (`approval_settings_rpc_only`);
  - `merge_tenant_settings('branding', …)`, updates to other columns (the BrandingPage path) and `set_approval_settings` still work;
  - `approvals` is preserved across a branding merge, and one `APPROVAL_SETTINGS` audit_logs row is written.
- **Requests:**
  - `decide_approval(rejected)` marks the parked payment failed;
  - `cancel_approval` on a pending request that is past expiry returns 'expired', and on a live one returns 'cancelled';
  - `submit_approval` works after the sweep;
  - the transition guard refuses reopening a rejected request and editing an executed one, even as postgres.

Scratch probes and seeds are in /tmp/rv2-wp09-db/ (`build.sh`, `seed2.sql`, `seed2b.sql`, `probes.sql`, `probes2.sql`, `m3.sql`). I also re-used the round-1 seed at `/tmp/rv1-wp09-db/seed.sql`. Databases left: `rv2_wp09_db`, `rv2_wp09_db_pop`, `rv2_wp09_db_pre`. I dropped my two scratch copies (`rv2_wp09_db_pop2`, `rv2_wp09_db_pre2`).
