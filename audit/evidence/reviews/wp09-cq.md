# WP-09: code-quality-reviewer

- **Commit:** a6d673e

**REVIEWER:** code-quality reviewer (CQ)
**WP:** R6 WP-09, maker-checker (7c81fd7..a6d673e, worktree /home/user/rv-wp09)
**VERDICT: FAIL**. I confirmed two Medium findings. The gates pass: `tsc` exit 0, `eslint src` 0/0, `vitest` 100/100.

## Findings

**CQ-1 (Medium). Approved manual payments never send the guardian a "payment received" notice.**
- **Where:** `supabase/functions/record-fee-payment/index.ts:125-129` and `src/features/approvals/ApprovalsPage.tsx:96-98`.
- **Scenario:** A school leaves the default settings. With no `settings.approvals`, `approval_required` returns true and the threshold is 0 (`20260927000002_r6_maker_checker.sql:176-190`), so every cash or bank payment waits for approval. `record-fee-payment` returns 202 before `notifyBilling(... "payment_received")`. When the checker approves, the inbox only calls `issueFeeDocumentUrl("receipt", …)`, and `issue-fee-document` never notifies anyone.
- **Evidence:** The only places that emit `payment_received` are `record-fee-payment/index.ts:173` and `enroll-finalize-billing/index.ts:197`. Nothing on the `decide_approval` path emits it.
- **Effect:** Parents stop getting payment notices for all recorded payments. This is a silent regression from pre-WP-09 behaviour. The prior PAY-10 finding covered only the best-effort receipt, not the notice.
- **Fix:** Emit the notice when a `manual_payment_accept` is executed, either as a server-side step or as an Edge Function the inbox calls after the approval executes. Add a test for it.

**CQ-2 (Medium). The checker cannot tell which grade a `grade_edit_after_publish` request changes.**
- **Where:** `supabase/migrations/20260927000003_r6_maker_checker_hardening.sql:628-630` and `src/features/approvals/ApprovalsPage.tsx:115-118`.
- **Scenario:** A teacher files "score 45 → 90". The payload is just `{from:{score,remark}, to:{score,remark}}`. It names no student, exam or subject, and `entityLink` is `null` for grade actions. The checker sees two numbers and can only click Approve.
- **Evidence:** `grade_entry_after_publish` includes `student` (line 678), but the edit builder does not. Transfers include no student name either and rely on the link.
- **Effect:** Dual control stops working for published-grade changes, because the checker cannot verify anything.
- **Fix:** Add `student`, `exam` and `subject` display fields to the edit payload (the hash already covers the payload). Also add a link to the gradebook, and hide id keys the way `HIDDEN_FIELDS` already does.

**CQ-3 (Low). The inbox's success message is never visible.**
- **Where:** `ApprovalsPage.tsx:101, 203`.
- **Scenario:** In the "waiting" view, `onDecided()` invalidates the list. The decided card drops out and unmounts, taking the `role="status"` outcome with it. That includes the "expired, ask for a new one" outcome and the `approval_not_pending` error.
- **Fix:** Show a page-level toast or status message, or keep the decided card until the user dismisses it.

**CQ-4 (Low). Clearing a prefilled score records 0.**
- **Where:** `GradebookPage.tsx:127`.
- **Scenario:** Inputs are now prefilled from `existing`. Clearing one sets `Number("") = 0`, which counts as a change. Before publication that writes 0 directly; after publication it files a "→ 0" correction, and CQ-2 means the checker has no context for it.
- **Fix:** Treat `""` as "no edit" and remove the key from `scores`.

**CQ-5 (Low). Leftover and inconsistent code.**
- `AcademicYearsPage.tsx:46,159`: the `togglePublish` mutation keeps a vestigial `publish: true` parameter and a "toggle" name. It should become `publishResults({ termId })`.
- `DashboardShell.tsx:216`: the badge count excludes expired-pending requests, but the "waiting" view (`ApprovalsPage.tsx:39`) lists them, so the two disagree.
- Unmapped server codes fall back to `unknown`: `approval_action_unavailable`, `invalid_changes`, `results_unpublish_blocked`, `no_tenant`.

**CQ-6 (Low). The same error mapping is written three ways.**
- `invoice_changed_retry` is mapped separately in `FeeStructuresPage.tsx:185` and `InvoicesPage.tsx:125`.
- `InvoiceDetailPage.tsx:195` maps codes with its own chain of `message ===` comparisons instead of `approvalErrorKey`.
- **Fix:** Use one helper for Edge Function error codes.

**CQ-7 (Info). Typing idioms.**
- `profile!.id` inside an `enabled`-guarded `queryFn` (`ApprovalsPage.tsx:39-40`, `DashboardShell.tsx:216`).
- `selectedExam?.term as unknown as {...}` (`GradebookPage.tsx:33`).
- `.catch(() => undefined)` at `ApprovalsPage.tsx:97` swallows the receipt error; at least log it.

All of these follow existing codebase patterns, so they are not blockers.

## Checked
- **Gates:** I ran `npx tsc --noEmit`, `npx eslint src` and `npx vitest run` in /home/user/rv-wp09. All were clean.
- **Locales:** en/am/om parity for every `approvals.*` key, including all 27 `APPROVAL_ERRORS` plus `unknown`, and the `outcome`, `value`, `fields` and `action` groups.
- **Error codes:** I compared every `raise exception` code in migrations 000002 and 000003 with the client mapping. `approvalErrorKey` word-boundary ordering is fine; for example `invoice_already_void` is matched before `invoice_void`.
- **Client and Edge Functions:** I read the diffs of `approvals.ts`, `ApprovalsPage.tsx`, `ApprovalSettingsPage.tsx`, `GradebookPage.tsx`, `TransferStudentModal.tsx`, `AcademicYearsPage.tsx`, `InvoiceDetailPage.tsx`, `InvoicesPage.tsx`, `FeeStructuresPage.tsx`, `fees/api.ts`, `DashboardShell.tsx`, `router.tsx`, `useSecuritySettings.ts`, and the four Edge Functions.
- **SQL:** payload builders, the default of `approval_required`, and the `payment_received` emitters.
- **React Query:** keys and invalidation (`approval-requests`, `approvals-pending-count`, `grades`, `invoice-void-request`, `tenant-config`) and the default `staleTime` of 30s.
- **Prior rounds:** I checked audit/evidence/reviews/wp09-r1…r3 so these findings don't repeat them. PAY-10 is related to CQ-1 but covers only the receipt, not the notification.
- **Not verified:** I did not run the pgTAP suites or any behaviour in a browser. CQ-1 and CQ-2 are confirmed by reading the code paths and grepping every emitter, not by running them.
