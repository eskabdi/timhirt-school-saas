REVIEWER: performance-reviewer
WP: WP-02 (round 3; `c4ecfac..7c81fd7` plus `67a627d..f4d5924`, head f4d5924)
VERDICT: FAIL

The plpgsql rewrite fixes most of DM-1: the round-1 SQL bodies cost 4 to 6 times the pre-WP-02 read time, and the head is well below that. But `has_module` on its own still costs about 4 times as much per call. It runs on every row of a seq scan, including other tenants' rows. So a small tenant sharing tables with a larger one pays 1.7 to 1.9 times the pre-WP-02 read cost. The backlog and the verification ledger say "within ~10%". I measured a cheap fix that brings it to about 1.1–1.2x.

FINDINGS:
  - id: PERF-1
    severity: major
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:224-228 (has_module caller check); audit/backlog.md:76; audit/FIXES_VERIFIED_R6.md:622
    evidence: |
      Setup: local PG16, 2 tenants on the standard tier. Tenant A has 10k students and 100k attendance rows; tenant B has 5k and 50k. Three copies of the same data, differing only in helper bodies: pre-WP-02 (bodies from c4ecfac), head f4d5924, and the round-1 SQL bodies from 7c81fd7. Old and new runs were interleaved; figures are medians of 5 unless noted. Wall-clock times are inflated by load from other reviewers on the box; the ratios come from interleaved runs.
      Per call, with an argument that changes per row (20k calls, tenant B admin, median of 3):
        has_module               old 150-208 ms  new 598-773 ms  (about 7.5 -> 30-35 µs; same on the own-tenant and foreign-tenant paths)
        get_tenant_id_for_user   old 172-180     new 346-360     (2.0x; usually an initplan, so once per statement)
        has_resource_permission  old ~1050       new ~900-970    (no regression)
      Plan as tenant B admin, head: `Seq Scan on attendance ... Filter: (($0 = 'super_admin') OR has_module(tenant_id, 'attendance')) AND ... Rows Removed by Filter: 100000`. The restrictive module gate is evaluated on every row in the table, including other tenants' rows.
      Whole queries, as B admin (5k students, 50k attendance: the scale the ledger used):
        count students    old 407 ms    new 775 ms    (1.90x)
        count attendance  old 4,393 ms  new 7,638 ms  (1.73x; close to the 8 s authenticated statement_timeout)
      Tenant A:
        list_page (listStudents shape)               admin 1.52x  teacher 1.19x
        students count                               admin 1.37x  teacher 1.68x
        AttendanceOverviewPage 30-day query          admin 8.7 -> 10.2 s (1.17x)  teacher 17.4 -> 20.2 s (1.15x)
      Round-1 SQL bodies, for reference: 4.2-4.7 s on students and 42-46 s on attendance (5.6x), so the round-2 change helped a lot, but it did not get back to the pre-WP-02 cost.
      Why the gap was missed: the ledger measured a single tenant, so the cross-tenant row path never ran. It also committed no seed and no EXPLAIN output. The cost grows with total rows across all tenants, not with the caller's own tenant.
    reference: §0A.4 "doc/control mismatch"; review DM-1 fix ("record a before/after EXPLAIN ANALYZE"); availability (Supabase authenticated statement_timeout 8 s)
    fix: |
      Replace the two nested plpgsql calls in has_module's caller check with one lookup, keeping the same semantics (super_admin, or the caller's own tenant and not suspended):
        if coalesce(current_setting('role', true), 'none') not in ('none','service_role','postgres','supabase_admin')
           and not exists (select 1 from public.users c left join public.tenants ct on ct.id = c.tenant_id
                           where c.id = auth.uid()
                             and (c.role = 'super_admin'
                                  or (c.tenant_id = p_tenant_id and ct.status is distinct from 'suspended'))) then
          return false;
        end if;
      I measured this on a scratch copy:
        - per call: 228 ms / 20k, against 153 old and 731 at head;
        - B students: 497 ms, against 422 / 740;
        - B attendance: 4,819 ms, against 4,194 / 7,440;
        - A students: 758 ms, against 681 / 937.
      On that copy these suites passed: definer_lockdown 58/58, tenant_suspension_lockout 6/6, module_gating 8/8, branding_extended_module 9/9. catalog_module_gate failed only its existing WP-06 TODO.
      Then correct backlog:76 and FIXES_VERIFIED_R6.md:622 to the measured figures. Commit the seed script and the before/after EXPLAIN ANALYZE output as evidence, with at least two tenants.
  - id: PERF-2
    severity: minor
    location: supabase/migrations/20260926000001_r6_definer_lockdown.sql:345-360 (attendance_retroactive_edit_window_days)
    evidence: |
      The function is still SQL, and for every row it calls the plpgsql get_tenant_id_for_user(auth.uid()).
      Per call (20k): old 82-93 ms, new 505-554 ms (about 6x). It is evaluated per row by the attendance_retroactive_edit_gate UPDATE policy.
      In practice the effect is small. Updating one class (50 rows) on a date 18 days ago, outside the window: admin 60 -> 67 ms, teacher 20 -> 29 ms. Updating a recent date: no measurable change. Insert of 50 rows: no regression.
    reference: helper functions must be cheap under RLS
    fix: Use the same single lookup as in PERF-1 (compare p_tenant_id to `(select tenant_id from public.users where id = auth.uid())`, keeping the suspension rule), or rewrite in plpgsql. Otherwise add it to the backlog row.
  - id: PERF-3
    severity: minor
    location: pre-existing policies (for example 20260821000003_module_gating_rls.sql students_module_gate / attendance_module_gate); audit/backlog.md:76
    evidence: |
      This existed before WP-02, and WP-02 makes it worse.
      - Every tenant-table read is a seq scan, or a full scan of the index's non-leading columns, with the per-row definer gates run on every row before the tenant equality filters anything out.
      - Pre-WP-02, AttendanceOverviewPage already takes 8.7 s (admin) and 17.4 s (teacher) at 10k students over 30 days, which is past the 8 s statement_timeout.
      - has_resource_permission (about 50 µs/call) is the largest per-row cost.
      - The backlog row plans the initplan / tenant-less has_module move for WP-06, but it does not mention has_resource_permission, or the fact that each tenant's queries scan every other tenant's rows.
    reference: performance checklist (no seq scans on large tenant tables; cheap helpers)
    fix: Widen the WP-06 backlog row to cover:
      - initplan forms for has_resource_permission as well (`(select has_resource_permission(auth.uid(), …))` is statement-constant);
      - a tenant-equality qual that is evaluated before the module gate;
      - an EXPLAIN budget test at 10k students, with at least 2 tenants.
  - id: PERF-4
    severity: info
    location: src/lib/useSecuritySettings.ts:36-39
    evidence: |
      The query key is now ["security-settings", userId], with enabled: !!userId, so React Query deduplicates it and there is no N+1.
      Bundle, built out-of-tree with `vite build` at 67a627d and f4d5924: dist 3,532,703 -> 3,532,351 bytes. JS total 2,944,776 -> 2,944,424 bytes (-352 bytes). No new chunk, and no lazy-loading change.
      WP-02 changes no Edge Function.
    reference: bundle-delta and N+1 check
    fix: none
CHECKED:
  - I read the WP-02 text (plan §329-385), §0A.4 and §0A.6, the full final migration, both diff ranges (the src, CI, test and backlog parts), definer_lockdown.sql, the catalog_definer_security.sql diff, app-rpc-grants.py, the r2 db-migration review (DM-1), and backlog.md:76 / FIXES_VERIFIED_R6.md:622.
  - `PGDATABASE=rv3_wp02_perf ./supabase/tests/run.sh` applied all migrations, and every suite passed ("All suites passed").
  - Seeded 2 tenants, 3,003 users, 300 classes, 15k students and 150k attendance rows, plus a school_admin and a teacher (5 classes) in A and an admin in B. Cloned the database three ways (pre-WP-02 / head / round-1 SQL bodies) and confirmed the helper languages in each copy.
  - EXPLAIN ANALYZE as school_admin and teacher on these queries:
    - students count, the listStudents page shape, students by class;
    - attendance count, class-day, 30-day page, the AttendanceOverviewPage query, and the StudentDetail/AttendanceTab student_id query (index scan on attendance_unique_key);
    - attendance INSERT for a class;
    - attendance UPDATE inside and outside the retroactive window (this path runs attendance_retroactive_edit_window_days).
  - Measured per-call cost of has_module (own and foreign tenant), get_tenant_id_for_user, has_resource_permission and attendance_retroactive_edit_window_days. The 20k-call loops use an argument that changes per row, because a constant-argument version collapses into a one-time filter; I discarded that run.
  - All modified helpers are STABLE (has_module, get_tenant_id_for_user and get_role_for_user are plpgsql; the others are SQL). The one-lookup has_module variant was checked against the 5 related suites on a scratch database copy (not committed).
  - Bundle delta via out-of-tree builds of both commits; the React Query key and gating of useSecuritySettings; no Edge Function changes in the WP-02 ranges.
  - Not verified:
    - production or staging volumes, and production's Postgres version and statement_timeout (no remote access, by instruction);
    - the timetable solver budgets (not touched by WP-02);
    - the full gate suite (tsc, eslint, vitest, deno-check, semgrep), which is outside the performance scope.
  - Cleanup:
    - dropped rv3_wp02_perf, _old, _sql and _fix (0 remain);
    - removed my scratch build trees;
    - `git status` in /home/user/rv-wp02 is clean at f4d5924, with no deno.lock or __pycache__ left.
    - Early on I wrote bench.sh, seed.sql, cls, old_helpers.sql and sql_helpers.sql directly in the shared scratchpad root before noticing other agents use it. That may have overwritten files of the same name from other agents; my later files are under scratchpad/rv3perf/.
