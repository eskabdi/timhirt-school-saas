# WP-09: security-reviewer re-check

- **Commit:** a6d673e

**REVIEWER:** sec (round-3b re-check)
**WP:** R6 WP-09, commit a6d673e (SEC-R3-1 fix)
**VERDICT:** PASS

SEC-R3-1 is fixed: the back-dated and forward-dated splits now park for approval. I found no new Critical, High or Medium issue.

**FINDINGS**

- **SEC-R3b-1 (Info).** Location: `supabase/migrations/20260927000003_r6_maker_checker_hardening.sql:263-265`. For a client row whose `tenant_id` is not the caller's school, the trigger returns before the new date stamping. This is harmless: RLS `WITH CHECK` refuses the row afterwards (probe `tenantB` gave `ERR 42501`). No fix needed. It is only a note in case the order of that early return ever changes.
- **SEC-R3b-2 (Info).** The `authenticated` role still has table-level UPDATE and DELETE on `payments`. The only thing blocking client edits is that no UPDATE or DELETE policy exists (only `payments_select`, `payments_manual_insert` and the restrictive `payments_module_gate`). Probes `upd-status`, `upd-created` and `del` all changed 0 rows. This is fine today, but the insert-time stamping does not protect against a future permissive UPDATE policy. Optional hardening: revoke UPDATE (at least on `status`, `paid_at` and `created_at`) and DELETE on `payments` from `authenticated`.

**CHECKED**

- **Test harness** on a fresh database `rv3b_wp09_sec` at a6d673e: `run.sh` exit code 0, "All suites passed". Log: `/tmp/rv3b-wp09-sec/run.log`.
- **Re-run of `/tmp/rv3-wp09-sec/p7.sql`** with a threshold of 300 and three inserts: 300 dated now−3d, 300 dated now−2d, and 200 dated now+5d.
  - Result: `300 succeeded`, `300 pending`, `200 pending`.
  - All three are stamped `created_at` = 2026-09-28, 2 approval requests were filed, and the invoice line shows `amount_paid` 300 / `partial`.
  - In round 3 all three settled. They now park.
- **The trigger sets `paid_at` from the final status.** Line 282 sets it to `now()` only for `succeeded`, and lines 298-299 clear it again when the payment is parked. A client `pending` insert that supplied `paid_at`/`created_at` = 2020-01-01 was stored as `created_at` 2026-09-28, `paid_at` NULL (probe `pending+paid_at`).
- **Other server-owned columns cannot be set by a client** (probe `/tmp/rv3b-wp09-sec/p8.sql`, run as accountant):
  - `provider='chapa'` (a gateway): RLS refuses it (42501). The `payments_manual_insert` WITH CHECK allows only cash or bank.
  - `status='failed'`: refused (42501). Only `succeeded` and `pending` pass, and the definer trigger can still turn `succeeded` into `pending`.
  - A tenant-B `tenant_id`: refused (42501).
  - UPDATE of `status`/`paid_at` or `created_at`, and DELETE: 0 rows each, because there is no policy for them.
  - `settle_gateway_payment` still excludes cash/bank rows (line 320), so a client-inserted manual `pending` row cannot be settled through the webhook.
- **Trusted inserts keep their declared dates.** As `service_role`, an insert with `created_at` 2026-01-05 and `paid_at` 2026-01-06 was stored with exactly those dates and status `succeeded`.
- **Trigger order.** `payments_reject_void_invoice` is the only BEFORE INSERT row trigger (tgtype 7). The credit and approval triggers are AFTER triggers, so they see the stamped values.
- **Insert paths.**
  - `record-fee-payment` inserts through `ctx.userClient`, so it is a client and gets stamped.
  - `enroll-finalize-billing` inserts through `adminClient` with a server-generated `paid_at` and a deterministic `adm-…` `provider_ref`. That path existed before this fix and nothing on it is chosen by the client.
- **The new suite assertions** (plan 73) exercise the back-dated split on header 8 and check that client rows have `created_at = now()` and a `paid_at` consistent with their status. They pass in the harness run.

Scratch files: `/tmp/rv3b-wp09-sec/p8.sql` and `/tmp/rv3b-wp09-sec/run.log`. As instructed, I did not write a report file or edit anything in `/home/user/rv-wp09`.
