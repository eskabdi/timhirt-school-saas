# WP-09 round 3: db-migration-reviewer (db)

- **Commit:** b260bf2

REVIEWER: db (db-migration-reviewer), round 3
WP: R6 WP-09 maker-checker. Commit b260bf2, worktree /home/user/rv-wp09. Scope: 20260927000003 as edited in place, plus the Edge Function changes that touch the database.
VERDICT: PASS (0 Critical/High/Medium, 1 Info)

FINDINGS

DB-R3-1 | Info | supabase/migrations/20260927000003_r6_maker_checker_hardening.sql:80-83 (forward-fix note)
- **Problem:** the note for reverting to the global `payments_provider_ref_uq` says "check for per-school duplicates first". The new indexes allow two kinds of rows that break the old global index:
  - the same cash/bank reference used by two different schools;
  - a failed payment's reference that was later reused.
  A per-school check does not catch the cross-school case.
- **Evidence:** on the migrated copy I reused the failed ref `RCPT-FAILED-1` and then followed the note (drop both indexes, create the global one). The create failed with `could not create unique index "payments_provider_ref_uq"`. The other forward-fix commands work as written. Disabling `approval_requests_transition_guard`, running `update … set decision_reason` on an executed row and re-enabling the trigger, all in one transaction, returned the row.
- **Fix:** reword the note as "check `select provider_ref from payments where provider_ref is not null group by 1 having count(*)>1` returns no rows (across all schools, failed rows included) first". This is documentation only and blocks nothing.

ROUND-2 FINDINGS RE-VERIFIED AS FIXED
- **DB-R2-1 (payments index): fixed.** I built a populated copy (113 prior migrations, the round-1/2 seeds, plus a third tenant with 30k headers and 300k payments), then applied 000003. It created `payments_invoice_tenant_idx (invoice_id, tenant_id)`, and the whole migration took 0.59 s including the index build and FK validation. One accountant cash insert, measured with EXPLAIN ANALYZE:
  - with the index: `payments_reject_void_invoice` 8.9 ms, total 22.4 ms;
  - with the index dropped in the same transaction: 164.8 ms, total 177.4 ms.

  The index column order matches the composite FK `payments_invoice_tenant_fkey`.
- **DB-R2-2 (forward-fix notes): fixed.** All three gaps are now covered: the provider_ref swap, the approval_requests checks, and the transition-guard procedure (which I ran). The only remaining issue is the wording in DB-R3-1.
- **DB-R2-3 (`set local lock_timeout`): fixed.** Production's deploy wrapper applies each file in its own transaction through the Management API (`audit/evidence/wp01-wp02-deploy-20260927T165645Z.txt`, step 1). I reproduced that with `begin; \i m3.sql; show lock_timeout; commit; show lock_timeout;`: it showed `5s` inside and `0` after the commit, so nothing leaks. `run.sh` applies files outside a transaction; there `set local` only prints `WARNING: SET LOCAL can only be used in transaction blocks`. psql exits 0 and the harness is green, so it is harmless.
- **DB-R2-4 (enroll-finalize-billing header id): fixed in the code, not run end to end.** index.ts:128-129 now inserts `invoice_id: headerId`, and `headerId` is assigned on both branches. The payment it now inserts works at the database level. As service_role, an insert against a header succeeds, and a declared amount is not limited.

CHECKED
- **Fresh database (`rv3_wp09_db`):** `run.sh` applied 114 migrations and all 66 suites passed, including maker_checker 65/65 and maker_checker_hardening 71/71. `app-rpc-grants` reported 24 RPCs and 0 findings.
- **Populated copy (`rv3_wp09_db_pop`):** built with `build.sh`, which applies each of the 113 prior migrations in its own transaction. Seeds:
  - 2 tenants, 250 headers, 450 fee lines, 400 grades;
  - 185 payments, including a parked cash payment filed through the real 000002 trigger;
  - requests in every status.

  Results:
  - 000003 applied in one transaction in 0.074 s;
  - the md5 snapshots of payments, fee_invoices, grades, approval_requests, tenant_configs and audit_logs are identical before and after;
  - every new constraint shows `convalidated = t`;
  - `payments_manual_approval_gate` (function and trigger) is gone;
  - `fee_invoices_header_open_check` and `payments_reject_void_invoice` are SECURITY DEFINER with `search_path = public, pg_temp`, and neither anon nor authenticated can execute them;
  - there are no TRUNCATE grants to anon or authenticated on the 11 WP-09 tables.
- **Lock timeout:** a reader held AccessShare on payments. 000003 aborted after 5.05 s at m3.sql:100 (the payments FK) and rolled back completely: 0 new constraints, no new index, the old gate still present, data unchanged. Once the reader finished, the retry succeeded and the data was still unchanged.
- **New threshold logic (client):** threshold 500. For one accountant on one invoice:
  - 300 → succeeded;
  - a second 300 the same day → pending (running total);
  - an amount over the balance → `amount_exceeds_balance`;
  - a duplicate cash ref in the same school (when the amount fits) → 23505 on `payments_manual_ref_uq`, which record-fee-payment maps to 409.

  One behaviour to note: when the amount also exceeds the balance, the balance error wins over the duplicate error.
- **fee_invoices_header_open_check, two sessions:**
  - Session 1 (postgres) held FOR UPDATE on a header and voided its lines.
  - Session 2 inserted a fee line as service_role. It waited 3.0 s, then got `invoice_void` (the check refuses every caller). There was no deadlock.
- **Lock ordering:** `grep` finds only two callers that insert into fee_invoices, `generate-fee-invoices` and `enroll-finalize-billing`. Each insert is its own PostgREST transaction, and no migration inserts into fee_invoices. So no path takes FOR SHARE on a header and then upgrades to FOR UPDATE in the same transaction.
  - A generate-fee-invoices batch that races a void fails the whole batch with a 500. That is fail-closed, and a retry creates a new header.
- **Cleanup:** I dropped every `rv2_wp09_db*` database (7) and my scratch copies `rv3_wp09_db_pop_big` and `rv3_wp09_db_pop_lock`. `rv3_wp09_db` and `rv3_wp09_db_pop` remain.

Probes and seeds are in /tmp/rv3-wp09-db/ (`build.sh`, `seed1.sql`, `seed2a.sql`, `seed2b.sql`, `wrap.sql`, `perf.sql`, `snap.sql`, `before.txt`, `after.txt`, `m3blocked.txt`).
