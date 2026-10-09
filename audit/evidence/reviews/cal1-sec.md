REVIEWER: CAL-SEC (security review: OWASP / ASVS L2 / INSA)
WP: Academic Calendar Engine slice 1 (`e40f87b..806c59b`, worktree /home/user/rv-wp09)
VERDICT: PASS. I found no Critical, High or Medium issue. There are 3 Low and 1 Info finding.

FINDINGS

**CAL-SEC-01 (Low): a user with only `create` can wipe a draft they cannot see.**
- Location: `/home/user/rv-wp09/supabase/migrations/20261008000001_academic_calendar_engine.sql:676-686`
- Scenario: `create_school_calendar` only checks `academic_calendar:create`. When a draft already exists it deletes all the draft's entries and changes its origin. But `school_calendars_select` (line 274) only shows drafts to users with `update`.
- Probe: I gave a teacher a per-user override for `create` only. That teacher saw 0 calendars, called `create_school_calendar(y,'moe')`, and the admin's `custom` draft with 3 suppression rows became `moe` with 0 rows.
- Impact today is small: a default role grant cannot do this, it needs a per-user override, and slice-1 drafts only hold generated rows. Slice 2 drafts will hold hand-written entries.
- Fix: require `academic_calendar:update` (or refuse with `calendar_exists`) when a draft already exists.

**CAL-SEC-02 (Low, not reachable yet): the entry guard's override-target check fails open on NULL.**
- Location: `…20261008000001_academic_calendar_engine.sql:599`
- Cause: `v_target.calendar_id not in (moe_calendar_id, coalesce(region_calendar_id, moe_calendar_id))` evaluates to NULL when no MoE calendar is published for that year, so the check does not raise.
- Probe: as the table owner I inserted a suppression row into school B's year y+1 calendar (no MoE calendar published) targeting an Oromia year-y entry. It was accepted.
- Why it is only latent: clients have no write path in slice 1, `effective_calendar_entries` ignores overrides of entries outside the school's layers, and the locked check still runs. Slice 2 editors will depend on this guard.
- Fix: `if not found or not coalesce(v_target.calendar_id = any(array[v_settings.moe_calendar_id, v_settings.region_calendar_id]), false) then raise …`

**CAL-SEC-03 (Low): `calendar_days`, `calendar_day_status` and `instructional_days` take about 1.3–1.8 s per call, even for one day.**
- Location: `…20261008000001_academic_calendar_engine.sql:483-562`
- Cause: the functions have no row estimates, so the planner assumes 1000 rows each. The plan cost comes out around 1.4e12, which turns on JIT compilation. Locally, `generate_series` showed 1311 ms. With `set jit = off` the same calls take 9 ms (one day) and 20 ms (400 days).
- Exposure: every authenticated user can execute these and there is no rate limit. The app does not call them yet. I could not verify whether JIT is on in production.
- Fix: add `rows` estimates or `set jit = off` on these functions. Otherwise, revoke them from `authenticated` until the attendance slice uses them. That slice will call `calendar_day_status` per row, so it matters there too.

**CAL-SEC-04 (Info): raw Postgres error text reaches direct RPC callers.**
- Probe: `calendar_days('5874000-01-01','5874001-01-01')` returns "date out of range for timestamp".
- No internal detail beyond that; the UI never calls it, and `calendarErrorKey` maps only known codes and otherwise shows "unknown".
- Fix (optional): clamp `p_from`/`p_to` to a sane window, e.g. EC 2000–2100.

CHECKED
- **Harness:** `run.sh` on `rv_cal_sec`: 115 migrations, all suites pass, including `catalog_definer_security` (2 existing WP-05/06 TODOs). `app-rpc-grants.py`: 27 RPCs, 0 findings. The database is dropped and the scratch directory removed.
- **`create_school_calendar`:**
  - The tenant comes only from `auth.uid()`. Super admin or no tenant gives `not_allowed`.
  - Permission, `events` module, origin and year (current EC year ±1, Addis time) are all checked before any write.
  - The previous-year source is restricted to the caller's own tenant and to a published or closed calendar, so it cannot copy from another school.
  - The 500-entry cap is enforced by a per-insert trigger, so a copy cannot bypass it.
  - The draft is locked with `FOR UPDATE`; a published calendar gives `calendar_exists`.
  - `search_path` is pinned, the function is revoked from public/anon and granted to `authenticated`, and it is on the allow-list.
- **Invoker functions with `p_tenant`:** school B passing school A's id gets no region (tenants RLS), no school calendar and no academic year (probe), and `calendar_days` shows none of A's regional types. With no caller (service role or postgres) the functions return only MoE layers.
- **RLS on all 7 tables:**
  - FORCE RLS is on and anon has no access.
  - `authenticated` has no INSERT, UPDATE, DELETE or TRUNCATE (probed: "permission denied").
  - Authority drafts are hidden from schools.
  - A teacher cannot see the school draft or its entries and gets the full MoE (16) + region (3) layers.
  - The module gate applies to both school tables.
- **Guard triggers:**
  - Switching an override to a locked target by UPDATE raises `calendar_entry_locked`.
  - A regional override of a locked MoE entry raises.
  - A closed calendar rejects new entries and updates (existing test). Changing `calendar_id`/`tenant_id` is blocked.
  - Locks are also enforced when reading: `not t.locked` in `overridden`.
  - Deleting a suppression row only restores the entry it hid.
- **Settings normaliser:** other sections and unknown keys are kept, the old numeral cleanup still works, `hijri_holidays` is strictly boolean, and `create or replace` keeps grants and comments.
- **Client:**
  - The colours in inline styles come from the database and are CHECK-constrained to `#rrggbb`; React style objects are used, with no `innerHTML`.
  - Names render as text through `tField`.
  - Error mapping never shows server text.
  - The route requires a staff role and the `events` module.
  - Hijri holidays are display only.
- **Not verifiable:** in production the definer RPC and trigger path depend on the postgres role bypassing FORCE RLS (the harness postgres is a superuser). This is an existing repo-wide assumption, not new in this change.