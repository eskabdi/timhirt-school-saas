REVIEWER: data-protection reviewer (path-triggered, closes GK-3)
WP: R6 WP-01 (branch claude/timhirt-security-audit-kan0ei, HEAD 9ac652f; I reviewed `git diff da6055e..9ac652f`)
VERDICT: PASS

No blocker or major findings. This WP collects no new personal data, adds no Restricted columns, opens no new export path, and adds no new third-party flow. The name changes only affect display, and the new log lines only record the function or step name plus the error message. The findings below are minor or info. Most describe problems that already existed and are assigned to later WPs. The rest are things I could not verify, which I report as findings rather than passes.

FINDINGS

1. minor. /home/user/timhirt-school-saas/docs/insa/_pending-changes.md:157
   - Evidence: the WP-01 residual-risk row says "4 storage policies let every role in a tenant read a bucket … Tenant isolation holds; least privilege within a tenant is WP-05". That understates the risk:
     - The `documents` bucket holds staff national-ID and health/legal scans at a predictable path, `<tenant>/staff/<employee_id>/<doc_type>.<ext>` (/home/user/timhirt-school-saas/src/features/hr/staffApi.ts:67).
     - The "tenant read documents" SELECT policy (supabase/migrations/20260713000006_storage.sql:24) also allows `list()`.
     - So any student account (a minor) or parent account in the tenant can list and download every staff member's ID and health files. Through "tenant read report cards", any parent can read every other child's report card.
     - The row does not cite H-02 (rated High in the fix plan, line 178), does not name the data as Restricted, and records no owner acceptance or deadline.
   - Failure scenario: an INSA assessor or the owner reads the register and treats a live High exposure of Restricted data about minors and staff as a low-risk least-privilege gap.
   - Fix: reword the row to cite H-02 (High), name the data involved (national ID, health documents, minors' report cards), note that listing is possible, and record owner acceptance until WP-05 ships.

2. minor (existed before this WP). /home/user/timhirt-school-saas/supabase/functions/onboard-tenant/index.ts:126
   - Evidence: the catch block logs the raw `(err as Error).message`, and `err` can be an error thrown by `auth.admin.inviteUserByEmail`. Some GoTrue validation errors put the submitted address in the message (the form `Email address "…" is invalid`), and zod's `.email()` accepts some addresses GoTrue rejects.
   - Not verifiable: I could not confirm the exact message format of the deployed GoTrue version offline.
   - The rollback logging this WP added is clean: onboard-tenant/index.ts:129 and _shared/onboard-rollback.ts:22,25 log only step or table names and `message`, and the tenant id, user id and email are never logged.
   - Failure scenario: a failed onboarding writes the school admin's email into Edge Function logs.
   - Fix: when the error is an AuthError, log a fixed code (for example `error.code`) instead of `message`.

3. minor (not verifiable). supabase/functions/_shared/jobs.test.ts and supabase/functions/_shared/onboard-rollback.test.ts
   - Evidence: `deno` is not installed in this environment, so I could not run these tests. They also never check what gets logged. By reading the code, jobs.ts:16,18 logs only `fnName` and `message`, and `job_id` is a zod-validated UUID that is never logged. But no test pins the "no ids in logs" property.
   - Fix: stub `console.error` in both tests and assert that the job, tenant and user ids do not appear in the logged arguments.

4. info (existed before this WP, deferred). /home/user/timhirt-school-saas/supabase/functions/process-export-job/index.ts:57-61 and 91-194
   - Evidence: the school-admin export writes, in plaintext:
     - for staff: `national_id`, `personal_email`, kebele and house number;
     - for students (minors): `ethnicity` and `date_of_birth`;
     - guardian and emergency-contact phone numbers and emails.
   - `csvField` quotes cells but has no formula-injection guard. Student and guardian names can come from outside, so a formula-injection payload reaches the admin's spreadsheet.
   - This WP only changed the name helper and failJob here. The plan amendment (fix plan line 1212) moves this writer to `csvCell` in WP-12, and masking and export auditing are WP-04/WP-10 (fix plan lines 1176-1199).
   - Fix: track under WP-12 and WP-04/10 as planned. Ethnicity in a bulk export deserves an explicit data-minimisation decision.

5. info. /home/user/timhirt-school-saas/src/lib/csv.ts:7-11
   - `csvCell` correctly prefixes cells starting with `= + - @ TAB CR` and leaves pure numbers alone, and its tests pass.
   - The payroll export (src/features/hr/PayrollRunDetailPage.tsx:80) still puts bank account numbers into a client-side CSV that is not audited. That existed before this WP and is the WP-12 bank-transfer export.

6. info (not verifiable). supabase/tests/rls/catalog_storage_probe.sql and catalog_storage_policies.sql
   - The local Postgres refused the harness credentials (password and peer auth both failed), and run.sh would reset the shared schema anyway. So I did not run the pgTAP storage suites or check the onboarding rollback order against real foreign keys.
   - Static check only: the probe fixtures are synthetic (fake UUIDs, `@example.test` addresses, "Probe Tenant" names). No triggers on tenants/users/tenant_configs/academic_years/periods create other rows for the new tenant that the rollback would miss. `audit_logs.tenant_id` has no foreign key.

7. info. Middle names on receipts, ID cards, portal accounts and exports
   - No new data is collected. `students.middle_name` was already granted to `authenticated` (supabase/migrations/20260718000001_student_name_fields.sql:24). Staff `father_name` is only read by service-role Edge Functions.
   - `notifyBilling` (supabase/functions/_shared/fee-pdf.ts:335-354) stores ids and the amount only, with no name, so notifications carry no new detail.
   - ID cards, the export and the portal `user_metadata.full_name` already used First+Middle+Last before this WP; receipts and invoices now add the middle name.
   - The owner's decision is recorded in docs/insa/_pending-changes.md, with a matching fix-plan amendment (line 1273).

CHECKED
- WP-01 section and amendments in docs/audits/timhirt-production-fix-plan.md (lines 306ff, 1212, 1268, 1273, 1291), and H-02 / WP-05 / WP-10 scope.
- Diffs for src/lib/names.ts, supabase/functions/_shared/names.ts, src/lib/csv.ts and its callers (invoices, payroll), _shared/jobs.ts, _shared/onboard-rollback.ts, and the functions onboard-tenant, process-export-job, process-import-job, provision-portal-accounts, issue-id-card, issue-fee-document, record-fee-payment, enroll-finalize-billing and activate-sso-user.
- Every new frontend `.select()` string: only name columns were added. No Restricted columns (medical_notes, national_id, bank_account, tin_number, pension_no) were added. The discipline and clinic pages only gained middle_name. Column grants cover middle_name.
- Log lines in all the Edge Function code this WP touched: only function or step names plus `message`, with no ids, emails or stacks in the new code. No temp passwords are logged.
- The notification payload (notifyBilling) carries no names or sensitive detail.
- Migration 20260925000003 (merge_tenant_settings): runs as the caller under RLS, allows only a fixed list of settings sections, and logs nothing. Migration 20260925000002 classifies the calendar settings as non-sensitive.
- The evidence files under audit/evidence/ (wp00-closeout-deploy, wp00-dr1-signup-disabled, wp01-acl-parity, wp01-prod-calendar-and-schema-grants, wp01-prod-calendar-values, wp01-signup-disabled) and the added review files:
  - I searched all added lines for JWTs, `sbp_` tokens, emails, Ethiopian phone numbers and UUIDs. The hits were only the public project ref, `example.test` fixtures, a synthetic +251911000000 in a test, and a scratchpad session id.
  - The auth-config evidence keeps only non-secret keys. The account notes list dates only.
- `.gitleaksignore`: all 5 pinned fingerprints point at lines I read (a Stripe placeholder, a pgp_sym_encrypt example, a SQL comment). None is a real credential.
- Storage baselines and allow-list: synthetic probe data. The 4 known offenders are mapped to WP-05. Branding is allow-listed because it is the only public bucket.
- Ran `npx vitest run src/lib/csv.test.ts src/lib/names.test.ts`: 7/7 passed at HEAD 9ac652f.
- Not run (reported above): the Deno tests (no deno) and the pgTAP suites (DB credentials refused).

VERDICT: PASS
