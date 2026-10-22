REVIEWER: cal-ti (tenant isolation)
WP: Academic Calendar Engine slice 1 (commit 806c59b, /home/user/rv-wp09)
VERDICT: PASS. I found no Critical, High or Medium issue. I could not find a cross-tenant read, write, oracle or lock, and every probe I ran supports that.

FINDINGS

CAL-TI-1 (minor). Location: supabase/migrations/20261008000001_academic_calendar_engine.sql:587 (and the FK at 236-237).
- **Scenario:** the guard sets `new.tenant_id := v_cal.tenant_id` without checking what was passed in, so the composite FK `(calendar_id, tenant_id)` can never fail.
- **Evidence:** as table owner I inserted a row with tenant_id = A on B's draft calendar. The guard quietly stored it as tenant B. Nothing exploits this today because clients have no INSERT grant. But a future authoring RPC (slice 2) that takes a calendar_id from the client would write into another school's calendar with no error.
- **Fix:** raise `invalid_calendar` when `new.tenant_id is distinct from v_cal.tenant_id`, and let the FK do its job.

CAL-TI-2 (minor). Location: same file, line 599.
- **Scenario:** `v_target.calendar_id not in (moe_id, coalesce(region_id, moe_id))` evaluates to NULL when neither the MoE nor the region has published a calendar for that year, so the override check is skipped.
- **Evidence:** B (AA region) had a calendar for year+1 with no published layers. The owner's insert of an override pointing at an Oromia regional entry was accepted (1 row). It does not leak anything across tenants: the target is platform data, and `effective_calendar_entries` ignores targets outside the school's layers.
- **Fix:** `if not found or v_target.calendar_id is null or not (v_target.calendar_id = any(array_remove(array[moe, region], null)))`.

CAL-TI-3 (info). Location: lines 389-562.
- The invoker functions accept `p_tenant` from any authenticated caller. Isolation depends entirely on RLS on `tenants`, `school_calendars` and `academic_years`; if one of those policies is widened later, these functions leak.
- api.ts never passes `p_tenant`.
- **Suggestion:** ignore `p_tenant` unless `current_setting('role')` is a trusted context.

CAL-TI-4 (info).
- When a super_admin passes `p_tenant = B`, they get B's region and B's academic-year span. That matches the super_admin's existing read access to `tenants` and `academic_years`.
- The super_admin sees none of B's `school_calendars` or entries (0 rows). `create_school_calendar` refuses them with `not_allowed`.

CAL-TI-5 (minor, test gap). Location: supabase/tests/rls/academic_calendar_engine.sql:135-141.
- The suite only covers B reading A, and only through `effective_calendar_entries` and a count. It has no write probes per role, no `p_tenant` probes on `calendar_days`, `calendar_day_status` or `instructional_days`, and no oracle comparison.
- **Fix:** add the probes listed below.

CHECKED
- **Harness:** run.sh on rv_cal_ti finished with "All suites passed" (exit 0). academic_calendar_engine 37/37, catalog_definer_security 10/10, catalog_module_gate 8/9 plus the existing WP-06 TODO.
- **Users of school A** (admin, teacher, accountant, student, parent) against school B. B had a published year-1 calendar with an entry, a draft custom calendar for this year with a special closure, AA region, and a 2030 academic_years row.
  - SELECT on `school_calendars` and `school_calendar_entries` returned 0 rows.
  - INSERT, UPDATE and DELETE on both tables, and `SELECT … FOR UPDATE`, all failed with "permission denied".
- **Invoker functions with `p_tenant` = B:**
  - `calendar_year_settings` (this year, year-1, 2030): school id, status and origin were null, region was null, and the session came from the MoE only (B's academic_years span was not returned).
  - `effective_calendar_entries`: MoE rows only, and 0 of B's or AA's rows.
  - For `effective_calendar_entries`, the md5 of `calendar_days`, `calendar_day_status` on B's closure day, and `instructional_days`, the B result equalled the result for a nonexistent tenant (201 = 201). B's state cannot be told apart this way.
- **`create_school_calendar`:**
  - Every error comes from the caller's own tenant: A admin got `no_previous_calendar` even though B has a published year-1 calendar, and non-admin roles got `not_allowed`.
  - Recreating as custom then moe left B's calendars and entries unchanged (snapshot compared).
  - A's custom suppressions have tenant A and target only MoE or Oromia entries.
- **Overrides of another region:** an Oromia entry overriding an AA entry was refused with `invalid_override`, as was a school entry in AA pointing at an Oromia entry when the layers are published.
- **Locks:** while B admin held `create_school_calendar` open for 8s, A admin finished in 90ms with a 3s lock_timeout.
- **Anon:** permission denied on all 7 tables and on every function.
- **Catalog:**
  - All 7 tables have RLS ENABLE and FORCE.
  - The module gates use the exact catalog shape and are not baselined or allow-listed.
  - `create_school_calendar` is SECURITY DEFINER with search_path pinned, closed to anon, and in the allow-list.
  - The guard functions are invoker and not executable by anon or authenticated.
- **Platform tables:** no tenant_id and no tenant data. No function or view exposes whole `tenants` rows, so `tenants.edu_authority_id` is visible only under `tenants_select`. Audit rows for platform tables get tenant_id NULL, which `audit_read` shows only to super_admin.
- **Cleanup:** I dropped rv_cal_ti. Scratch files are in /tmp/rv-cal-ti/ (probe.sql, run_probe.sql, probe.out, lockA.sql, lockB.sql).

Files: /home/user/rv-wp09/supabase/migrations/20261008000001_academic_calendar_engine.sql, /home/user/rv-wp09/supabase/tests/rls/academic_calendar_engine.sql, /home/user/rv-wp09/src/features/academic-calendar/api.ts