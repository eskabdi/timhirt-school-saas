REVIEWER: AC9 (API contract)
WP: R6 WP-09 (maker-checker), worktree /home/user/rv-wp09 at a714c61, diff 7c81fd7..a714c61
VERDICT: PASS. I confirmed nothing at Critical, High or Medium. All three findings are Low: two documentation errors and one untranslated message path.

FINDINGS

AC9-1 · Low · /home/user/rv-wp09/docs/insa/_pending-changes.md:221
- **Problem:** the OpenAPI example request for `record-fee-payment` sends `"provider_ref":"R-0012"`. The function's Zod field is `reference` (`supabase/functions/record-fee-payment/index.ts:45`, used at :88).
- **Effect:** `z.object` is not strict, so it silently strips the unknown key. A caller who copies the example records a payment with no reference. That bypasses `payments_manual_ref_uq`, so they can never get the documented 409 `duplicate_reference`.
- **Also:** the example response `202 {"status":"pending_approval"}` leaves out `payment_id`, `receipt_url: null` and `bank_verification`, which the contract table at :217 lists.
- **Fix:** use `"reference"` and the full 202 body. Optionally make the schema `.strict()`.

AC9-2 · Low · /home/user/rv-wp09/docs/insa/_pending-changes.md:218 and :224
- **:218:** says `issue-fee-document` returns a 400 "generic `bad_request`". The real body is `{"error":"Invalid request"}` (`_shared/security.ts:34`), and no code `bad_request` exists anywhere.
- **:224 (ERD):** claims "composite FKs `(tenant_id, maker_id)`/`(tenant_id, checker_id)` → users". In the migrated database, `approval_requests_maker_id_fkey` and `approval_requests_checker_id_fkey` are single-column FKs to `users(id)`; no migration creates composite ones (grep of 000002/000003). The composite FKs WP-09 really added (`payments_invoice_tenant_fkey`, `fee_invoices_header_tenant_fkey`) are not in the ERD.
- **Impact:** none on behaviour; maker and checker ids come from `auth.uid()` after a tenant check. But the INSA document describes a tenant-binding control that does not exist. It looks like a misreading of earlier review INSA-9.
- **Fix:** correct both lines.

AC9-3 · Low · /home/user/rv-wp09/src/features/fees/InvoiceDetailPage.tsx:174 and :193-198
- **Problem:** the server contract says amount is at most 10,000,000 with at most 2 decimals. The client checks neither: `step="0.01"` does nothing because there is no `<form>` submit.
- **Scenario:** an accountant types 100.555. The server Zod refine rejects it (100.555*100 = 10055.4999…, so the refine's tolerance check fails). It returns 400 `{"error":"Invalid request"}`, and `onError` falls through to the raw message, so am/om users see the English "Invalid request".
- **Fix:** check both rules before submitting with the existing `fees.errors.invalidAmount` message, or map the generic 400 to a translated key.

CHECKED
- **RPC signatures vs client:** checked in the database for `submit_approval`, `decide_approval`, `cancel_approval` and `set_approval_settings`. Parameter names, types and return types match `approvals.ts` and `ApprovalSettingsPage.tsx`. Return values `executed`/`rejected`/`expired`/`cancelled` all have `approvals.outcome.*` keys.
- **Grants:** checked with `has_function_privilege` and matching the doc. Private: submit/decide/cancel, set_approval_settings, exam_results_published, approval_action_module_on (invoker). Internal: execute_approval, expire_approvals(_for), approval_required (client EXECUTE gives 42501 as `authenticated`; the INSA-1 fix holds), approval_payload_hash. Disabled: settle_gateway_payment, cleanup_old_audit_logs. anon has none.
- **Inventory counts:** 29 / 25 / 2 / 22 / 0 = 78, matching the doc and `definer_inventory.md`.
- **app-rpc-grants.py:** 24 app RPCs, 0 findings.
- **Error mapping:** every exception string in 000003 that a client can reach maps through `approvalErrorKey` or falls to `unknown`. All `APPROVAL_ERRORS` keys plus `unknown`, `fees.errors.{duplicateReference,invoiceChangedRetry,overpayment}` and `fees.invoiceStatus.void` exist in en/am/om. The regex does not confuse `invoice_void` with `invoice_already_void`.
- **record-fee-payment, replayed as authenticated in psql:**
  - An insert asked as `succeeded` comes back `pending`, `paid_at` null, and files a `manual_payment_accept` request with `invoice_id` in the payload. So the 202 path is real.
  - A reused reference gives 23505 on `payments_manual_ref_uq`, which maps to 409.
  - Over-balance including pending gives 22023 `amount_exceeds_balance`, which maps to 400.
- **callFunction:** treats 202 as ok. The UI shows `fees.paymentAwaitingApproval` and no receipt, and maps all three error codes. There is no unhandled 202 or 409 path.
- **generate-fee-invoices:** a service_role insert into a void header raises `invoice_void`, so the 409 `invoice_changed_retry` regex matches. Both `FeeStructuresPage` and `InvoicesPage` map it.
- **issue-fee-document:** refuses receipts unless the payment is `succeeded`. The UI offers receipts only for `succeeded` payments. The checker-side receipt after approval is best effort.
- **enroll-finalize-billing:** the header id is used for the payment, and only a non-void invoice is reused.
- **Read paths:** `exam_results_published` returns null for another tenant's exam. The PostgREST embed FK names in `APPROVAL_SELECT` exist.
- **Gates:**
  - pgTAP full run on a fresh `rv5_wp09_api`: 114 migrations, 66 suites, all green (maker_checker 65/65, hardening 82/82).
  - `deno check` on the 4 functions: exit 0, with a negative control that fails. No deno.lock left behind.
  - vitest for approvals and useSecuritySettings: 12/12.
- **Cleanup:** the database is dropped, `/tmp/rv5-wp09-api` is removed, and the worktree is clean.
- **Not checked:** I did not call the deployed Edge Functions over HTTP. Status codes were confirmed by reading the code and replaying the SQL in psql.