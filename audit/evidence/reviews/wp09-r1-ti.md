# WP-09 round 1: tenant-isolation-auditor (ti)

Commit reviewed: `6d6f79f` (worktree `/home/user/rv-wp09`). Probes: `/tmp/rv1-wp09-ti/probe{1,2,3}.sql` against database `rv1_wp09_ti`, each run in a rolled-back transaction.

**VERDICT: FAIL**

The harness is green (`maker_checker.sql` 65/65). But a two-tenant probe shows a tenant-A approval crediting tenant B's invoice. Three more probes bypass platform-minimum controls.

## Findings

| ID | Severity | Location | Finding |
|---|---|---|---|
| TI-01 | blocker | `20260927000002_r6_maker_checker.sql:478-483, 536-560, 346-349, 517-527` | A tenant-A payment can target a tenant-B `invoice_headers` id. Once approved, `apply_payment_to_invoice` (definer, no tenant filter) credits B's `fee_invoices`. B then cannot void the invoice (`invoice_has_payments`). `payments_reject_void_invoice` and the FK error also tell A whether a foreign header exists. Evidence: B's invoice shows `4000.00 partial` after A's approval. |
| TI-02 | major | `:640-655` (`grades_publication_approval_gate`) | Move the exam to an unpublished term, edit the grade, move it back: grade 50→99 with 0 requests. |
| TI-03 | major | `:567-579` (`fee_invoices_void_guard`) | `update fee_invoices set amount_due = 0` voids the invoice in effect, with no approval. |
| TI-04 | major | `:117, 403, 429-445` | `expire_approvals()` is never scheduled. An expired pending request blocks the entity for good: `approval_expired`, then `approval_already_pending`. |
| TI-05 | minor | `:95` | `approval_requests.tenant_id` is nullable, and nothing ties null to a platform action. |
| TI-06 | minor | `supabase/tests/rls/maker_checker.sql` | No cross-tenant target probes (payment, grade, transfer) and no test that the executor writes only in the request's tenant. |

## Proposed fixes

- **TI-01:**
  - Enforce the tenant match with a composite FK: `invoice_headers unique (id, tenant_id)` and `payments (invoice_id, tenant_id)`. Also add it to the insert policy.
  - Add a `tenant_id` filter to `apply_payment_to_invoice`, to `payments_reject_void_invoice` and to the payment-exists checks.
  - Add a pgTAP probe for all of the above.
- **TI-02:** add a trigger on `exams` that refuses a client change of `academic_term_id` when the old or new term is published. Gate new grades in a published term.
- **TI-03:** refuse a client decrease of `amount_due`/`amount_paid`, or revoke the column UPDATE from clients.
- **TI-04:** expire stale rows inline in `submit_approval`/`decide_approval`, and schedule `expire_approvals`.
- **TI-05:** add a CHECK that ties null `tenant_id` to platform actions.
- **TI-06:** add hard cross-tenant assertions.

## Checked OK

- RLS is enabled and forced on `approval_requests` and `approval_actions`. Client writes are revoked.
- `submit_approval` and `decide_approval` derive the tenant from `auth.uid()`, and a cross-tenant decide is refused.
- The trust-list uses `current_setting('role')`.
- Definer grants match the allow-list.
- Audit rows carry `tenant_id`.
- The Edge Functions insert under RLS with `header.tenant_id`.

Not verified: the frontend in a browser, and staging/production parity.
