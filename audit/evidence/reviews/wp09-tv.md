# WP-09: test-verifier (tv)

- **Commit:** a6d673e

**REVIEWER:** test-verifier (rv3, TV)
**WP:** R6 WP-09, maker-checker (dual control), commit a6d673e
**VERDICT: FAIL.** Two acceptance criteria can break without any test failing. I confirmed both by removing the protection and re-running the whole harness: it stayed green.

**FINDINGS**

**TV-1: Medium (security-relevant). Nothing tests that the checker needs `<resource>:approve`.**
- Location: `/home/user/rv-wp09/supabase/migrations/20260927000003_r6_maker_checker_hardening.sql:834` (the check in `decide_approval`); `/home/user/rv-wp09/supabase/tests/rls/maker_checker.sql:94-95`.
- Evidence: I replaced the check with `if false then`. All 66 suites still passed; the only non-ok lines were the two known `# TODO` baselines (WP-06, WP-05). Under that mutation, a same-tenant student called `decide_approval` on a pending 1200 ETB cash payment and got `executed`, and the invoice was credited 1200.00.
- Why the current test misses it: "a student cannot decide" passes the nil UUID `00000000-…`, so the call fails at "not found". It never reaches the permission check. The test that "a student sees no approval requests" only exercises the SELECT policy, and `decide_approval` is SECURITY DEFINER, so it bypasses that policy.
- Reference: plan WP-09 item 1 says "checkers need `<resource>:approve`".
- Fix: add an assertion where a same-tenant user without `invoices:approve` (the student, or a teacher) calls `decide_approval` with the real request id and hash. Expect 42501 `not_allowed` and the payment still `pending`. Do the same for `grades:approve`.

**TV-2: Medium. Nothing tests that a client cannot mark a parked payment `succeeded`.**
- Location: `/home/user/rv-wp09/supabase/tests/rls/maker_checker.sql`; the `payments` policies (the only client write policy is `payments_manual_insert`, `20260927000002_r6_maker_checker.sql:478`).
- Evidence: I added `grant update on payments to authenticated` plus a permissive UPDATE policy. All 66 suites stayed green (again only the known TODOs were not ok). In a probe, an accountant inserted a payment (parked as `pending`), then ran `update payments set status='succeeded'`. Result: payment `succeeded`, invoice `amount_paid` 1200.00 / `partial`, while the approval request was still `pending`. The dual-control guarantee depends only on the absence of an UPDATE policy, and no assertion or trigger backs that up.
- Reference: plan WP-09 item 3 ("credits only on `succeeded`"); CLAUDE.md "the database refuses the direct write from a client".
- Fix: add an assertion that a client UPDATE of `payments.status`/`amount` changes nothing (or raises), and that the invoice stays uncredited. Better still, add a trusted-role guard trigger on `payments` UPDATE like `fee_invoices_void_guard`. The same gap applies to DELETE on published `grades`: no policy allows it today, and no test would catch one being added.

**TV-3: Low. The per-action coverage the plan asks for is partial.**
- Location: `maker_checker.sql`.
- Evidence: self-approval is tested for payments and grade edits only. Payload tampering and hash mismatch are tested for the payment action only. `invoice_void`, `student_transfer_out` and `grade_entry_after_publish` have no maker-self-approval assertion. The checks are generic and run before the per-action dispatch, and my "maker" and "tamper" mutations were each caught (see CHECKED), so the risk is low.
- Fix: add one self-approve attempt per wired action.

**TV-4: Info. A mutation survived because a second layer catches it.**
- Evidence: with the caller-tenant clause removed from `decide_approval`, the cross-tenant test still passes. `approval_action_module_on` returns `f` for another tenant's id: I probed as tenant B's admin, who does hold `invoices:approve`. So the protection is real, but no test isolates each layer.

**TV-5: Low. The UI acceptance criterion (item 4: inbox, badge, approve/reject) has only helper unit tests.**
- Evidence: `approvals.test.ts` (10/10 passed) covers `diffRows`, `approvalErrorKey` and `isExpired`. There is no component or Playwright test of approving or rejecting. This is UX only, since the database enforces the rules.

**CHECKED**
- Full harness on `rv3_wp09_tv`: 114 migrations, all suites passed (`maker_checker` 65/65, `maker_checker_hardening` 73/73). No `todo`, `skip` or `.only` in the WP-09 suites.
- `vitest run src/features/approvals`: 10/10 passed.
- Mutations run in scratch databases (each a copy of `rv3_wp09_tv`); each count is failing assertions, not ok / errored:

| Removed protection | Caught? | Failing assertions |
|---|---|---|
| grades publication trigger | yes | mc 3 / 63 err; hardening 4 / 63 err |
| transfer trigger | yes | `student_transfer` 1 |
| `fee_invoices_void_guard` | yes | mc 1 / 63 err; hardening 4 |
| DELETE re-granted on invoices | yes | mc 2 / 63 err |
| maker check (function + constraint) | yes | mc 4 / 105 err |
| maker check (function only) | yes | mc 2 |
| stored-payload tamper check | yes | mc 1 |
| stored-hash vs sent-hash check | yes | mc 2 / 105 err |
| platform minimum | yes | mc 1 |
| payment parking | yes | mc 8 / 105 err; hardening 7 / 44 err |
| unpublish guard | yes | mc 2 / 45 err |
| expiry | yes | mc 2 |
| stale-grade re-check | yes | mc 2 |
| void re-check | yes | hardening SEC-04 ×2 |
| payment balance re-check | yes | SC-02 ×2 |
| `created_at` stamping | yes | SEC-R3-1 ×2 |
| `tenant_configs` guard | yes | AZ-03 + 44 err |
| direct `approval_requests` writes | yes | mc 3; hardening 1 |
| **checker permission** | **no** | TV-1 |
| **payments UPDATE policy** | **no** | TV-2 |
| caller-tenant clause | no | TV-4, second layer holds |

- Not run by me: `npm run typecheck`, `lint`, the full `vitest`, and `deno test`. I scoped this to verifying the tests, so their status is not verified.
- All `rv3_wp09_tv*` databases are dropped. Scratch scripts are in `/tmp/rv3-wp09-tv/`: `runsuites.sh`, `m_*.sql`, `probe*.sql`, `mut.log`.
