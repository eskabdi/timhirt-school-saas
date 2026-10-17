**Verdict: PASS.** PERF9-1 is fixed, and I found no regressions or confirmed Critical/High/Medium findings.

**Setup:** commit 691f581 on a fresh database, rv6_wp09_perf. The harness applied 114 migrations and passed all 66 suites (2 known TODOs). I loaded my earlier seed and scale data (3 schools × 20k requests), then added:
- **Teacher maker:** 5,000 grade requests from the t1 teacher.
- **Module off:** fees switched off in school t2 (`tenant_module_overrides`).
- **Custom role:** the t3 teacher gets `invoices:approve` through a role.
- **Overrides:** a t3 accountant denied `invoices:approve`, and another t3 accountant granted `grades:approve`, with 300 grade requests from another maker so that grant has rows to show.
- **Super admin:** a super_admin and 50 requests with no school (`tenant_id` null).

I dropped the database afterwards. The worktree is unchanged.

**PERF9-1: inbox views.** Best of 5 EXPLAIN ANALYZE runs as `authenticated`, with the PostgREST-style lookups of maker and checker names. Old policy (and the old plain maker index) is measured in a rolled-back transaction.

| user | waiting | mine | history | badge |
|---|---|---|---|---|
| admin t1 | 48 → 3.7 ms | 12.6 → 1.3 ms | 1,757 → 22.9 ms | 44 → 4.1 ms |
| accountant t1 | 45 → 4.9 ms | 273 → 1.5 ms | 1,434 → 19.3 ms | 49 → 2.7 ms |
| teacher t1 | 15.9 → 2.8 ms | 162 → 1.1 ms | 1,655 → 14.6 ms | 13.6 → 3.7 ms |
| custom-role teacher t3 | 58 → 5.6 ms | 0.3 → 0.5 ms | 1,813 → 17.4 ms | 55 → 2.7 ms |
| accountant t3 (approve denied) | 50 → 2.7 ms | 285 → 0.9 ms | 1,113 → 13.9 ms | 48 → 2.4 ms |
| admin t2 (fees off) | 9.7 → 2.3 ms | 9.1 → 0.8 ms | 455 → 9.3 ms | 8.4 → 2.5 ms |

- **History plan:** the action lists run once each, as initplans (`approval_actions` scanned once per query, 18 rows). The policy no longer calls a function per row.
- **Mine plan:** an ordered index scan on `approval_requests_maker` that stops at 100 rows (0.6 ms).

**Row equivalence:** I collected every visible row for all 16 users under the new policy, then under the old policy text from a714c61, and compared them as multisets. There were 0 rows only in the new set and 0 only in the old.
- The custom-role teacher sees 19,166 rows.
- The accountant denied `invoices:approve` drops to 9,584 (their own requests only).
- The accountant granted `grades:approve` gains the 300 grade requests.
- The fees-off school hides its payment and void requests (834 rows for its admin).
- The super_admin sees the 50 requests with no school.

**Audit trigger and delete guard:** best of 5 inserts of 2,000 requests, in two runs.

| configuration | ms per 2,000 inserts |
|---|---|
| new `audit_approval_requests` | 139 / 153 |
| generic `audit_trigger()` it replaced | 206 / 220 |
| no audit trigger | 66 / 73 |
| new audit, delete guards dropped | 153 / 185 |

- **Audit trigger:** about 35 µs per row against about 70 µs for the generic one, so it is cheaper.
- **Delete guards:** no measurable cost on inserts, which don't fire them.
- **What they block:** DELETE as service_role is refused with `approval_request_immutable`. No migration, Edge Function or app code deletes requests. Nothing deletes into them by cascade either: the foreign keys to `tenants` and `users` don't cascade.

**PERF9-2: gradebook batching** (src/features/gradebook/GradebookPage.tsx:77-96)
- **Client code:** batches of 4 via `Promise.all`. `submitOne` catches its own errors, so one failure cannot abort the batch.
- **Database:** 60 `submit_approval` calls from 4 parallel sessions, with 200 stale pending requests for the expiry sweep, took 191 ms wall time. All 60 succeeded, with no deadlocks or lock errors, and the sweep expired the stale requests correctly. The sequential baseline took 313 ms.
- **Round trips:** 60 → 15. I did not measure client network latency (RTT).

**Findings**
- **PERF9R-1 | Info** | supabase/migrations/20260927000003_r6_maker_checker_hardening.sql:224-235
  - **Scenario:** History is still a bitmap scan of the whole school (BitmapOr from `tenant_id is null OR …`) followed by a top-N sort.
  - **Evidence:** about 0.8 µs per row: 25k rows took 20 ms, and a user with nothing visible took 10 ms over 20k rows.
  - **Effect:** time grows with the number of requests but stays small. No action needed. If a school ever reaches more than 200k requests, the History query could be split by tenant.

**Not checked:** the bundle-size delta (I did not run `npm run build`; the diff only touches 4 small components), and client RTT.

Scratch scripts are in /tmp/rv6-wp09-perf/ (`extra.sql`, `equiv.sql`, `perf.sql` and its output `perf.out`, `trig.sql`, `one.sh`, `seq.sh`).