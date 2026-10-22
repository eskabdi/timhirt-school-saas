# WP-09 round 2: tenant-isolation-auditor (ti)

- **Commit:** 28ee1ba
- **Probes:** /tmp/rv2-wp09-ti/probe1-4.sql
- **Harness:** green, 114 migrations

**VERDICT: FAIL** (one High)

| ID | Severity | Location | Finding |
|---|---|---|---|
| TI-R2-1 | High | 000003:221-246 `payments_reject_void_invoice` | A client can insert with `tenant_id = B`. The definer BEFORE trigger then reads B's header and lines before RLS refuses the row. The error it raises reveals whether the header exists, whether it is void, and B's open balance (by binary search): 4001 → `amount_exceeds_balance`, 4000 → RLS error. It also takes a `FOR UPDATE` lock on B's header. |
| TI-R2-2 | Low | :839-841 | `payments_provider_ref_uq` is global. Tenant A is refused a reference that tenant B already uses, which confirms the reference exists somewhere. |
| TI-R2-3 | Info | :280-282 | `settle_gateway_payment` looks up the payment by `provider_ref` only, so it could settle a parked cash/bank payment (service_role only; no caller today). |
| TI-R2-4 | Info | :77-85 | The composite FKs need a preflight count of cross-tenant rows on staging and production. |
| TI-R2-5 | Info | decide/cancel | For a platform request (tenant null), deciding or cancelling expires stale requests in every tenant. |

Re-verified as fixed:
- TI-01, except the oracle reported above as TI-R2-1.
- TI-02 through TI-06.
- Grade entry, cancel and decide are all refused across tenants.
- The invoker triggers read under RLS.
