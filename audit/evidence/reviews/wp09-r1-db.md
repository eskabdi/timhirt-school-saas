# WP-09 round 1: db-migration-reviewer (db)

Commit reviewed: `6d6f79f`. The harness is green (113 migrations, 65 suites). The migration applies to a populated copy (200 students, 400 grades, 400 fee lines) in 0.06 s, and a before/after snapshot is byte-identical. Probes are in `/tmp/rv1-wp09-db/`.

**VERDICT: FAIL** (2 major)

| ID | Severity | Location | Finding |
|---|---|---|---|
| DB-1 | major | `20260927000002:640-671` | Moving a published exam's term, editing the grade and moving it back leaves score 99, term still published, 0 requests. `max_score`/`weight` and moving a grade into a published exam are also open. |
| DB-2 | major | `:563-579` | A client can update fee_invoices `amount_due = 0` or `status = 'paid'` directly. |
| DB-3 | minor | header | No `lock_timeout`; a reader blocked the migration for 11 s and queued readers timed out. |
| DB-4 | minor | header | No forward-fix/rollback plan for the replaced objects. |
| DB-5 | minor | whole file | The DDL is not idempotent; it fails closed on re-apply. |
| DB-6 | minor | `verify_document`; reports | A void invoice verifies as `pending`; reports sum void lines. |
| DB-7 | minor | `payments_provider_ref_uq` | A rejected or expired payment keeps its `provider_ref`, so a corrected payment with the same reference is refused (23505). |
| DB-8 | info | indexes | No index on `checker_id`; the per-row permission call in the policy. |
| DB-9 | info | grants | `authenticated` keeps TRUNCATE on the invoice tables (not reachable via PostgREST). |
| DB-10 | info | production | Check on production for pre-existing pending cash/bank payments before deploy (expected 0). |
| DB-11 | info | deploy | 000001 and 000002 must be committed in separate transactions (enum value). |

## Checked OK

- Every new function pins `search_path`.
- Grants match the allow-list, and the guards fail on injected drift.
- FORCE RLS is on.
- Existing app writes still work.
- Trigger order is correct.
- The inventory is identical to a regenerated copy.
- app-rpc-grants: 23 RPCs, 0 findings.
