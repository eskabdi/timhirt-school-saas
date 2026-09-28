# WP-09 round 2: authz-reviewer (az)

- **Commit:** 28ee1ba
- **Probes:** /tmp/rv2-wp09-az/p1-p5.sql
- **Harness:** green

**VERDICT: PASS** (no Critical/High/Medium)

| ID | Severity | Location | Finding |
|---|---|---|---|
| AZ-R2-1 | Low | 000003 `exams_publication_guard` | `exams.category` is not locked. A published exam can be re-labelled CA/Final, which changes the report-card breakdown without approval. |
| AZ-R2-2 | Info | `cancel_approval` | No module check. The maker can still withdraw their own request while the module is off. |
| AZ-R2-3 | Info | `grade_guard` | A grade added after publication is stamped with the checker as `entered_by` (already in the backlog, WP-08). |
| AZ-R2-4 | Info | tenant_configs `configs_write` | Deleting the whole config row is not audited. The effect is stricter: approvals become required. |
| AZ-R2-5 | Info | database-wide | No aal2/impersonation checks on the approval RPCs (backlog, WP-07). |
| AZ-R2-6 | Info | permission tables | An admin can grant `*:approve` without approval (`privileged_role_grant`, WP-07). |

Re-verified as fixed: AZ-01, AZ-02, AZ-03, AZ-04, AZ-05 and AZ-08.

Also checked and holding:
- **grade_entry_after_publish:** the maker and checker matrix is correct.
- **Suspended tenant:** every path is refused.
- **Trusted-role bypass:** not reachable by a client.
- **Route guards:** match the database.
