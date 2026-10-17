REVIEWER: CAL-DB4 (database delta review, round 4)
WP: Academic Calendar Engine slice 1 and the invite-state fix, at 0129fef in /home/user/rv-wp09. Scope: `git diff 6133b48..0129fef -- supabase/`. The worktree is unchanged (HEAD 0129fef, clean). I did not review e429947 because it changes no code.

VERDICT: PASS. There are no blockers and no majors. CAL-DB3-03 and CAL-DB3-04 are fixed, and I proved both by running them. **CAL-DB3-01 is not fixed**: it still fails CI in EC 2020. I have carried it as DB4-01 (minor). There are two more minor findings and three info items.

FINDINGS

**CAL-DB4-01 (minor): CAL-DB3-01 is still open.** Assertion 62 fails when the engine year is 2020, i.e. from 2027-09-12 to 2028-09-10.
- Location: /home/user/rv-wp09/supabase/tests/rls/academic_calendar_engine.sql:296-303.
- What changed: the probe day moved to Hamle 15 of y-1, and the comment claims it holds "for every year, the 2019 seed included". It does not.
- Why it fails: when y = 2020, y-1 = 2019 has the seeded MoE session (2026-08-31 to 2027-07-07). Hamle 15, 2019 (2027-07-22) is therefore "out_of_session" with `in_session = f`, not NULL.
- Evidence: I faked `pg_temp.y()` and `create_school_calendar`'s `v_now_year`.
  - 2019 and 2021 to 2029 each give 76/76.
  - 2020 gives 75/76, `not ok 62`. The debug row was `(2027-07-22,2019,out_of_session,,f,f,t,f)`, and calendar_days returned the same row.
- Fix: make the assertion independent of the year by comparing the two answers to each other: `calendar_day_status(d)` row `is not distinct from` the `calendar_days(d, d+400)` row for d. Optionally add `in_session is not true`. Do not expect NULL.

**CAL-DB4-02 (minor): no test catches losing the `authenticated` grant on `ec_session_in_year`, which the academic_years fallback depends on.**
- Location: migration :68-82 (the grant) and :494 (the call). `calendar_year_settings` is SECURITY INVOKER and executable by authenticated.
- Evidence:
  - I revoked EXECUTE from authenticated and ran the whole calendar suite: still 76/76.
  - As a signed-in school admin on a seeded DB, `calendar_year_settings(2018)` returns 2025-09-11..2026-09-10 with the grant. Without it, it fails with `ERROR: permission denied for function ec_session_in_year`.
  - The suite's CAL-DB3-03 assertions (:376, :379) call the function as postgres. catalog #8 covers policies, views, defaults and CHECKs, not invoker function bodies.
- The grant is correct today. This is a regression-test gap of the kind e429947's new rule targets.
- Fix: run one of the :376/:379 probes under `pg_temp.act_as(<school B admin>)`.

**CAL-DB4-03 (minor, not verifiable here): whether `postgres` can SELECT `auth.users` in production is unproven, and `tenant_admin_invite_states` depends on it.**
- Location: /home/user/rv-wp09/supabase/migrations/20261017000001_tenant_admin_invite_states.sql:28-36.
- Why the harness cannot show it: there postgres is a superuser and owns the shimmed auth.users.
- What production evidence shows: auth.users belongs to supabase_auth_admin. wp01-prod-calendar-and-schema-grants-*.txt records SELECT only for anon, authenticated and service_role (all false); it does not record postgres.
- No earlier migration reads auth.users from a function, so this is the first. I expect it to work, since it is the usual Supabase definer pattern, but I have not verified it.
- A staging apply will not catch a problem either, because plpgsql bodies are not resolved at CREATE time.
- Impact if it fails: status and resend return 500 (fail closed); invites are unaffected, as the header says.
- Fix: before deploying to production, run `select has_table_privilege('postgres','auth.users','select')` on staging, and call the function as service_role.

**CAL-DB4-04 (info): `limit 200` silently truncates.**
- Location: invite-states migration :36, and index.ts:86 (`.find` over the capped list).
- Evidence: with 300 school_admins in one tenant, it returned 200 rows. A resend for an admin outside the first 200 by id would get 400. This is unrealistic for one school; documenting the cap is enough.

**CAL-DB4-05 (info): password-less SSO admins.**
- `password_set` is false for SSO-provisioned users (tenant SSO exists, and pending users can be promoted), so the console shows them as pending.
- The confirmed-user resend branch (index.ts:111, `resetPasswordForEmail`) would report `resent: true`. I believe GoTrue's recover lookup skips `is_sso_user` accounts, so no email is sent; this is not verified here.
- Consider returning `is_sso_user` and treating such users as accepted.
- That branch also sends Supabase's "Reset password" template, not the invite template. AcceptInvitePage accepts any session, so the flow works, but the email wording differs.

**CAL-DB4-06 (info): authority_calendars_guard freezes `ec_year` but not `authority_id`.**
- Moving an MoE calendar to a region would leave regional overrides pointing at a non-MoE target. Only service_role writes these, so it is a sibling of CAL-DB3-04.
- The ec_year change raises `invalid_range` (22023), which is acceptable but semantically loose.

Status of round-3 items:
- DB3-01: open (DB4-01).
- DB3-02: grid.ts changed in this commit, but it is outside the supabase/ scope, so I did not re-verify it.
- DB3-03: fixed.
- DB3-04: fixed.
- DB3-05: unchanged (info).

CHECKED

**Harness**
- Fresh DB rv_caldb4_a, run as OS user pgtest: 116 migrations, 68/68 suites passed.
  - academic_calendar_engine 76/76, tenant_admin_invite_states 9/9, catalog_definer_security 10/10, maker_checker 65/65, maker_checker_hardening 93/93.
  - Only the two existing TODOs remain (WP-06, WP-05).
- app-rpc-grants: 28 app RPCs, 0 findings.

**Mutation proofs: each new assertion fails when the code it protects is removed**
- Dropping the ec_session_in_year filter in calendar_year_settings: `not ok 76`.
- Dropping the ec_year-immutability clause: `not ok 67`.
- Dropping the outside_year branch: the copy aborts with `ERROR: invalid_range`, so the CAL-TV-12 test discriminates.
- Adding `authenticated` to the trusted roles in tenant_admin_invite_states: `not ok 8`.
- Reverting password_set to email_confirmed_at: `not ok 1`.
- A stray EXECUTE grant to authenticated on the new definer function: catalog_definer_security `not ok 1`.

**ec_session_in_year**
- Properties: IMMUTABLE and STRICT, not a definer. search_path pinned. ACL: postgres, service_role and authenticated; no anon or PUBLIC.
- Its dependencies ec_to_gregorian and ec_days_in_month are immutable too.
- Boundaries: Nehase 1 of y-1 is accepted. Nehase 1 minus one day, Tikimt 30 plus one day, and Pagume end plus one day are rejected. NULL input returns NULL, which excludes the row in the fallback. The authority columns are NOT NULL.
- The app's convention (Meskerem 1 to Pagume 5) and full-year spans are accepted for every EC year from 2000 to 2100.

**Production academic_years**
- All production rows satisfy the helper:
  - (2018, 2025-09-11, 2026-09-10) is Meskerem 1 to Pagume 5, 2018: true.
  - (2019, 2026-09-11, 2027-09-10) is Meskerem 1 to Pagume 5, 2019, where Pagume 6 is 2027-09-11: true.
- On a seeded DB at the 114 production migrations, calendar_year_settings gives:
  - 2018: the academic-year fallback (2025-09-11..2026-09-10), both as postgres and as a signed-in school admin.
  - 2019: the seeded MoE session (2026-08-31..2027-07-07), so the fallback is not reached.
- The fallback ignores 0 of 2,004 production-shaped rows.

**create_school_calendar**
- The outside_year window matches school_calendar_entries_guard exactly (Meskerem 1 −60 to Pagume end +60).
- The check runs before the locked_date check, so a copy can no longer abort on invalid_range.

**tenant_admin_invite_states**
- SECURITY DEFINER and STABLE, search_path pinned. EXECUTE only for postgres and service_role. Not in definer_allowlist.sql, as intended.
- It refuses an untrusted role even when that role has EXECUTE (42501).
- It returns no email, hash or token.
- coalesce handles both '' and NULL encrypted_password, as tested on the seeded DB.
- EXPLAIN shows the users_tenant_idx bitmap scan plus a users_pkey nested loop.

**Migration safety on the seeded copy** (rv_caldb4_b: 114 migrations, 2,000 tenants, 2,004 academic_years, 300 admins, 300 auth.users)
- Each file applied with `psql -1`: calendar migration 0.39 s, invite-states migration 0.04 s.
- Re-applying fails cleanly and rolls back: calendar at line 45 (`ec_to_gregorian already exists`), invite-states at line 38 (`already exists`).
- md5 checksums of academic_years and users are unchanged, and the counts are unchanged.
- The calendar migration keeps `set local lock_timeout = '5s'` and its forward-fix header. The invite migration creates one function (no table locks) and has a forward-fix note.
- I did not repeat the lock-timeout drill from round 3, since this delta adds only functions.

**Environment**
- When I resumed, Postgres was down (stale socket, pid 7141 gone). It was being restarted by someone else at 22:45:19 UTC and became ready at 22:45:23. I did not start or stop it.
- Both review DBs (rv_caldb4_a, rv_caldb4_b) have been dropped.
- My probe and mutation scripts are in /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/ (the harness log is run-a.txt).