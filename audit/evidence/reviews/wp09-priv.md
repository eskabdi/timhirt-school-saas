REVIEWER: privacy (PRV9)
WP: R6 WP-09 maker-checker, worktree /home/user/rv-wp09 at a714c61 (range 7c81fd7..a714c61)
VERDICT: PASS. I found no Critical, High or Medium issue. I confirmed two Low findings by probe, and three Info items.

FINDINGS

PRV9-1 | Low | supabase/migrations/20260927000002_r6_maker_checker.sql:120-122 and :134-135; docs/insa/_pending-changes.md:193 and :225
- **Scenario:** A teacher submits a grade correction with the reason "Re-sit after hospitalisation for epilepsy". An admin submits a transfer with transferred_reason "Child protection case…".
  - Both requests are hidden from a super_admin in `approval_requests` (0 rows). The policy comment says this is because "tenant approvals carry student and payment data".
  - But `audit_approval_requests` copies the whole row into `audit_logs`: payload with the minor's full name, scores, transfer reason, plus `reason` and `decision_reason`. `audit_redact` strips none of these fields.
  - `audit_read` lets any super_admin read this cross-tenant, and any school_admin read it in the tenant, whatever their `approve` permission or module state.
- **Evidence (probe as super_admin):** `approval_requests` count 0, but `audit_logs where table_name='approval_requests'` returned 2 rows. Containing "epilepsy", "Child protection" and "Abebe" were all true. The doc's classification ("readable only by the maker and permitted checkers") and line 193 ("a super_admin sees only platform requests") are therefore wrong.
- **Why only Low:** super_admin already reads students, grades and discipline_incidents through `audit_logs`, so this is the existing M-07/M-08 exposure, and WP-10 plans to attach this trigger anyway.
- **Fix:**
  - Now: correct the classification and line 193 to say who can actually read the data, including the `audit_logs` copy.
  - WP-10: strip `payload`, `reason` and `decision_reason` from the audit copy and keep `payload_hash`, status and actors. The source row is immutable and retained, so nothing is lost. Alternatively, narrow super_admin's cross-tenant audit read.

PRV9-2 | Low | docs/insa/_pending-changes.md:225; 20260927000003:141 (guard is `before update` only)
- **Claim:** "no role (service_role included, through the transition guard) can change or delete them".
- **Evidence:** service_role holds DELETE and TRUNCATE on `approval_requests`. I deleted the transfer request as service_role and it succeeded (count dropped to 1). TRUNCATE fires no row-level audit trigger, so a truncate leaves no trace in `audit_logs`.
- **Fix:** either correct the retention and immutability text, or add a BEFORE DELETE guard and revoke TRUNCATE from service_role. If you add the guard, keep a documented erasure path for data-subject requests.

PRV9-3 | Info | docs/insa/_pending-changes.md:223 (ERD)
- The ERD says `entity_type/entity_id` and lists composite FKs `(tenant_id, maker_id)/(tenant_id, checker_id) → users`. The catalog has `entity_table`, and only single-column FKs on `maker_id`, `checker_id`, `tenant_id` and `action`. The composite FKs are on `payments` and `fee_invoices`.
- There is no practical cross-tenant effect: `submit_approval` sets the tenant and maker from the caller.
- **Fix:** correct the ERD.

PRV9-4 | Info | approval_requests_select (`maker_id = auth.uid()`)
- A teacher removed from the class still sees their own request, including the student's full name and the grade.
- Probe: "teacher1 after unassign|1|Abebe Kebede Tadesse".
- This is limited to what they submitted, so it is acceptable, but add it to the classification text.

PRV9-5 | Info | src/features/students/TransferStudentModal.tsx:31-33; _pending-changes.md:225
- The transfer reason is stored twice, as `payload.transferred_reason` and as `reason`. This is a minor data-minimisation point.
- "Purged only when the tenant is deleted": no tenant-deletion path exists (only `_shared/onboard-rollback.ts`), so retention is in practice indefinite. The doc defers the schedule to WP-18, which is acceptable as documented.

CHECKED
- Ran the harness on rv5_wp09_priv: 114 migrations, all suites passed. I dropped the database and removed the scratch directory afterwards.
- RLS probes with real `submit_approval` calls, a grade edit by teacher1 and a transfer by admin1. Visible rows per role:

| Role | Rows visible |
|---|---|
| teacher1 (maker) | 1, own request only |
| teacher2, other class | 0 |
| parent (guardian of the student) | 0 |
| student (the subject) | 0 |
| accountant (invoices:approve) | 0 grade or transfer requests |
| registrar | 0 |
| second school_admin | 2 |
| super_admin | 0 in `approval_requests`, 2 through `audit_logs` (PRV9-1) |
| accountant reading `audit_logs` | 0 |

- **What a requester can see beyond their submission:** the payment payload is only amount, provider, provider_ref and invoice_id. The grade payload's `from` values are ones the maker could already read. Beyond that the maker sees only the checker's name and `decision_reason`.
- **Notifications:** only `payment_received` (amount, invoice and payment ids) goes to the student and guardians, and only for an executed manual payment. No grade or transfer details go into any notification or SMS.
- **Edge Functions (4 changed):** logs record only `err.message`, and error bodies are fixed codes. No payload, names or amounts are echoed back.
- **Client:** the approvals, gradebook and transfer code has no console logging. `DashboardShell` and `InvoiceDetailPage` read only `id` and a count.
- **Docs and prior reviews:** read `audit_trigger`'s redaction list, the `audit_logs` policy, and the `approval_requests` grants and FKs from the catalog. Compared the classification, ERD and retention text with the catalog. Checked findings against the earlier wp09-* reviews; INSA-9 was addressed in the text, and PRV9-1 and PRV9-2 are new inaccuracies in that text.