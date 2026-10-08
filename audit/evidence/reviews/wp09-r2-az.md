REVIEWER: AZ9R (authorization/security re-check, last WP-09 fix commit)
WP: R6 WP-09 maker-checker, commit 691f581 (diff a714c61..691f581)
VERDICT: PASS. I found no Critical, High or Medium issue, and every probe below was run.

FINDINGS
- AZ9R-1 (info). Location: /tmp/rv6-wp09-az/run.log. The full harness passed on a fresh database, rv6_wp09_az, which I have since dropped. Every suite passed, including maker_checker_hardening.sql (88/88), maker_checker.sql (65/65) and catalog_definer_security.sql (10/10). No fix needed.
- AZ9R-2 (info, process slip by me). While setting up the zod probe I briefly copied a scratch file into /home/user/timhirt-school-saas/node_modules/ (gitignored). I deleted it straight away. The rv-wp09 worktree is clean. No repository source file was touched.

CHECKED
1. approval_requests_select (migration 20260927000003, around line 218), new initplan form against the old per-row form. Probe: /tmp/rv6-wp09-az/parity.sql.
   - Setup in one transaction: 4 tenants (active A and B, suspended S, trial T), 16 users and 260 requests. That covers every tenant-scoped action for every maker, rows in A made by B's admin, and platform rows with a null tenant.
   - Tenant A has `sis` turned off and T has `fees` turned off.
   - Permission cases covered: a custom role granting students:approve and fees:approve to a teacher; a user-level grant of gradebook:publish; a user-level revoke of fees:approve for an accountant; a built-in role grant for registrar and hr_officer; a built-in revoke of gradebook:publish for school_admin.
   - Also covered: a super_admin with no tenant, a super_admin with a tenant, an unknown sub and an empty sub (auth.uid() null).
   - I recorded the visible ids for each caller under the new policy, swapped in the old policy text and recorded them again. The symmetric difference is 0 rows.
   - Spot checks:
     - Makers see their own rows.
     - Checkers see only actions they may approve: the revoked accountant sees only their own 14 rows, and the school_admin sees no grade actions.
     - With `sis` off, nobody sees transfer or withdrawal rows, the custom-role teacher included.
     - The suspended-tenant admin, the unknown user and the null uid see 0 rows.
     - A no-tenant super_admin sees only the 4 platform rows. B's admin sees none of A's rows except the ones B made.
   - Platform rows that would have a null checker_resource or a tenant_id/action mismatch are impossible: the FK to approval_actions, the tenant_scope CHECK and the NOT NULL checker_resource on all 18 actions rule them out.
   - The approval_actions SELECT policy is `true`, so the in-policy subqueries see the same rows in both forms.
2. audit_approval_requests:
   - It is SECURITY DEFINER with search_path pinned to `public, pg_temp`. EXECUTE is held only by postgres and service_role.
   - Called directly as authenticated: "permission denied for function".
   - It is not in the allow-list and the catalog guard passes.
   - Flow probe (/tmp/rv6-wp09-az/flow.sql): submit by the maker, decide by a second admin, which approves and executes and sets the invoice to `void`, then expire_approvals().
   - Result: 5 audit rows, each with the right tenant. The actor is the maker on inserts and the checker on approve/execute. Status is present, and no row contains payload, reason, decision_reason or the SECRET marker text.
   - The probe's expiry row shows a leftover JWT sub as actor; that comes from my test session, not the code.
3. no_delete triggers and the TRUNCATE revoke:
   - DELETE as postgres and as service_role, and TRUNCATE as postgres, all fail with `approval_request_immutable`. TRUNCATE as service_role fails with "permission denied".
   - expire_approvals and decide/execute still work.
   - No migration, Edge Function, script or test deletes approval_requests.
   - The FKs from tenants and users are NO ACTION, so tenant offboarding and user deletion were already blocked by any existing request. onboard-rollback.ts only removes a tenant or user it just created, which has no requests yet.
4. record-fee-payment `.strict()`:
   - The only caller is src/features/fees/api.ts:22. It sends invoice_id, amount, provider, reference and bank_verification, with bank_verification limited to payment_method and verification_url.
   - Keys left undefined are dropped by JSON.stringify.
   - I ran the schema through zod 3.25.76 (Deno is not installed here, so I used Node): the cash and bank payloads the client builds are accepted, and an extra top-level `provider_ref` or an extra key inside bank_verification is rejected.
   - No other code calls the function. The enroll flows use their own functions.

Probe scripts: /tmp/rv6-wp09-az/parity.sql, /tmp/rv6-wp09-az/flow.sql, /tmp/rv6-wp09-az/strict.mjs