REVIEWER: TV-GK (independent re-check of GK-1)
WP: R6 WP-09 maker-checker, at commit c8a388d (read-only worktree /home/user/rv-wp09)
VERDICT: PASS

GK-1 is fixed. Both TV-1 probes now reach the `<resource>:approve` check in decide_approval. Each one fails when that check is mutated away. I found no blocker or major issue. One of your claims is only partly true: with the whole check mutated to `if false`, the run aborts **before** the grade case (details in TV-GK-1). The other mismatch is a wording error in the brief (TV-GK-2).

FINDINGS

- **TV-GK-1** (minor). Location: `supabase/tests/rls/maker_checker_hardening.sql:426`
  - Evidence: with `if false` in place of the approve check, assertions 76 ("caught: no exception") and 77 ("have: succeeded / want: pending") fail as you claimed. Line 426 then makes a bare call: `select is(public.decide_approval(...), 'executed', 'an admin approves the parked payment')`. It raises `approval_not_pending`, because the teacher has already approved the payment, and this aborts the transaction. psql printed 29 ERROR lines and ran no assertion after 79, so the grade case (84–86) never ran under this mutation.
  - Impact: the gate still goes red. run.sh counts 2 failures and 29 errors, so the mutation is caught. The grades probe is shown independently by the grades-only mutation (85–86 fail, 0 errors). The weakness is that a regression in the payment path hides the result of the grades probe.
  - Fix: run the admin approval at line 426 inside `lives_ok(...)` and assert the 'executed' outcome separately (payment status = succeeded). Or move the grade TV-1 block so it no longer comes after an unwrapped call that depends on the payment probe.

- **TV-GK-2** (info). Location: `supabase/migrations/20260927000003_r6_maker_checker_hardening.sql:911-921`
  - Evidence: the brief says the tenant, module and maker checks come before the permission check. Only the not-found, tenant and module checks (lines 911–915) come before it. `maker_cannot_decide` (line 921) comes after.
  - Impact on the probes: none. Under both "check off" mutations the teacher's call ran to completion (payment credited, grade changed 50.00 -> 55.00). So every later refusal (maker, status, expiry, tamper, hash) was also passed, and the teacher is not the maker.

CHECKED

1. **Full harness on a fresh database `tv_gk`.** I ran it as pgtest with PGHOST=/tmp/pgsock and PGPORT=5433, after chmod a+rX on supabase and rm -f /tmp/mm.sql.
   - Result: "115 migrations applied", 67 suites, "All suites passed", exit 0.
   - maker_checker_hardening.sql: 92/92 assertions.
   - The only TODOs are the existing WP-06 entry (catalog_module_gate #4) and WP-05 entry (catalog_storage_policies #7).
   - The suite has no skip() and no todo().
2. **Baseline single-suite run (`psql -qtA -f`).** 92 ok, 0 not ok, 0 ERROR. Assertion numbering: 75 = payment request exists, 76/77 = payment probe and payment still parked, 84 = grade request exists, 85/86 = grade probe and grade unchanged.
3. **Mutations.** I dumped decide_approval with pg_get_functiondef, edited it with sed or perl, re-applied it, and ran the suite. Each re-apply was checked with a diff, and the edited lines were confirmed in the live function.
   - **M1, whole check `if false`:** not ok 76, not ok 77, then the abort at line 426 described in TV-GK-1.
   - **M2, check skipped only when `v_resource = 'grades'`:** not ok 85 ("caught: no exception"), not ok 86 ("have: 55.00, want: 50.00"). The other 90 pass, 0 ERRORs, and the run reaches 92.
   - **M3, probe that the check is reached:** I gave the permission-check refusal a distinct message, `not_allowed_AT_PERMISSION_CHECK resource=%`. 76 then caught `...resource=invoices` and 85 caught `...resource=grades`; everything else passed. So both probes get past the not-found, tenant and module checks, and they are refused by `has_resource_permission` returning false for the teacher (…a0010), not by an earlier refusal.
4. **The pre-fix suite was vacuous.** The parent commit's version (c8a388d^, plan 88) passed 88/88 with 0 errors under M1. That confirms GK-1 was real and that c8a388d fixes it.
5. **Test hygiene.**
   - The temp tables tv1_pay, tv1_grade and tv1_score are read as the owner, and existence is asserted before each probe (75, 84).
   - `grant select on tv1_*` covers only the test's own temp copies of the id and hash. It gives the system under test no new privileges.
   - act_as sets `role authenticated` and the JWT sub.
6. **Restore.** I restored the original function. Its pg_get_functiondef md5 (feffec93e6ac34bdd2a130c9bfd0fa1a) matches the pre-mutation dump. ACL is unchanged (postgres, service_role and authenticated have EXECUTE), it is still SECURITY DEFINER, and search_path is still `public, pg_temp`. A suite re-run gave 92 ok and 0 errors.
7. **Cleanup.** I dropped `tv_gk` and confirmed it is gone. The server is still accepting connections on /tmp/pgsock:5433. I touched no other database and edited no repository file.

Scratch outputs (base.out, m1.out, m2.out, m3.out, old_m1.out, final.out, plus the orig/m1/m2/m3.sql definitions) are in /tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/.