# Timhirt — Full-Status Security, Architecture & Compliance Audit

| | |
|---|---|
| **Date** | 2026-09-24 |
| **Audited commit** | `07262fc` (branch `claude/timhirt-security-audit-kan0ei`, identical to `claude/project-deployment-w0brxd` HEAD) |
| **Mode** | Investigation only. No code, config or migration was changed. |
| **Scope** | 105 migrations, 113 public tables, 5 views, 32 Edge Functions + `_shared`, 16 storage buckets, React/Vite frontend, CI, dependencies |
| **Previous audit cycle** | `audit/FINDINGS.md` + `audit/FIXES_VERIFIED*.md` (Rounds 1–5, last commit `7d39346`) |
| **Deployment caveat** | Per `CLAUDE.md`, Round 5 and the EC-"today" fix are **not deployed**. Every finding here is about the code in the repo. Production may be running older code, so each finding needs re-checking against the live project before it is closed. |

## How this audit was performed

1. **Live database, not just reading the SQL.** A throwaway Postgres 16 + pgTAP cluster was started locally. All **105 migrations were applied** through `supabase/tests/run.sh`, and **all 55 pgTAP suites passed**. RLS status, policies, grants, views, `SECURITY DEFINER` functions and storage policies were then read from the live catalog (`pg_class`, `pg_policies`, `has_*_privilege`), not from the migration text.
2. **Programmatic policy scan.** All 374 policies were parsed. Every permissive policy was checked for tenant scoping (`get_tenant_id_for_user`). Every top-level `OR` branch was checked for a branch that widens access past the tenant.
3. **Exploit probes.** Every High or Critical database finding was reproduced as `anon` or `authenticated` with a JWT claim, inside a `BEGIN … ROLLBACK` transaction. The probes are non-destructive; the SQL is in Appendix A. One change to the local harness: the probes run `GRANT USAGE ON SCHEMA public TO anon` inside the transaction. Real Supabase grants this, the test shim does not (see L-08).
4. **Edge Functions**: all 32 were read (auth, role list, rate limit, validation, service-role use, tenant checks).
5. **Static sweeps**: XSS sinks, secrets, dynamic SQL and PostgREST filter interpolation, currency, fonts, Ge'ez numerals, name formatting, naming conventions, `npm audit`.

> **INSA methodology assumption (flagged explicitly).** `/docs` contains no INSA Web Application Security Testing checklist. The blueprint cites §21.9 for INSA reasoning, but that section does not exist (the document ends at §20). This audit therefore uses **OWASP WSTG / ASVS Level 2 categories as a stand-in for the INSA methodology**: Info Gathering, Config Mgmt, AuthN, Session Mgmt, AuthZ, Input Validation, Error Handling, Cryptography, Business Logic, Client-Side. Before an INSA submission, re-map this report onto the official INSA checklist.

---

## 1. Executive Summary

**Overall risk rating: HIGH.** It becomes **CRITICAL** the moment the Telebirr gateway is configured, because of C-01.

The base-table RLS layer is strong and has held up across five fix rounds:

- 113 of 113 tables have RLS enabled.
- 102 of 113 tables also have `FORCE ROW LEVEL SECURITY`.
- Every permissive policy scopes by tenant or is a deliberate global-reference/super-admin policy.
- The cross-tenant pgTAP matrix passes.
- Payroll maker-checker is enforced in the database.
- Column-level grants protect the sensitive columns of `students`, `employees`, `clinic_visits` and `health_conditions`.

Every serious finding sits **around** that layer rather than in it:

| # | Headline | Severity |
|---|---|---|
| C-01 | `telebirr-notify` is a public, **unsigned** payment webhook. A parent can get their own `merch_order_id` from `process-fee-payment` and POST a forged `Completed` event. The invoice is marked paid and a receipt is issued. | **Critical** |
| H-01 | **13 `SECURITY DEFINER` RPCs can be executed by `anon`** and do no auth or tenant check. Proven: anon reads any user's email by UUID, injects health alerts into any tenant and rewrites any tenant's export jobs. An authenticated tenant-A user can create jobs inside tenant B. | High |
| H-02 | Storage: **every student and parent can list and download every staff HR document** (national ID, contracts, health/legal) **and every classmate's report card** in their school. | High |
| H-03 | **GRADE_TABS regression.** After a promotion undo or class correction, the student profile and transcript still show a tab for a grade the student never reached. History is also silently truncated once audit logs pass 365 days. | High |
| H-04 | **Module gating and tenant suspension are not enforced end-to-end.** 5 feature tables have no gate, 2 sensitive views bypass the gate, and the service-role Edge Functions (e.g. `run-payroll`, `process-library-circulation`, `submit-admission`) check neither `has_module()` nor the tenant's suspension status. | High |
| H-05 | **MFA is not enforced for anyone**, including super_admin, who can impersonate any user. | High |
| H-06 | Enrollment turns an **anonymous applicant's self-declared payment amount** into a `succeeded` payment. This is currently masked by a foreign-key bug that also breaks admission receipts. | High |

**Tenant isolation verdict:** it holds at the **base-table RLS layer** but **not end-to-end**. The breaks are:

- **Cross-tenant:** the definer RPCs in H-01 and one service-role IDOR (M-10).
- **Inside a tenant:** storage over-exposure (H-02).
- **Financial integrity:** the unsigned webhook (C-01).

**Findings by severity: 1 Critical · 6 High · 13 Medium · 12 Low = 32.**

---

## 2. Compliance Scorecard

### 2.1 OWASP Top 10 (2021)

| Category | Rating | Justification |
|---|---|---|
| A01 Broken Access Control | **Fail** | Base RLS is solid, but H-01 (anon/cross-tenant RPCs), H-02 (storage), H-04 (module/suspension bypass) and M-10 (IDOR) break it. |
| A02 Cryptographic Failures | Partial | TLS/HSTS are enforced and integration secrets live in Vault. National ID, bank account and TIN are stored in plaintext with no column encryption (M-08). |
| A03 Injection | Partial | No SQL injection found: migrations use `format('%I')` and all access goes through PostgREST/RPC. CSV/formula injection in exports (M-05). Raw search terms are interpolated into PostgREST `.or()` filters (L-12). |
| A04 Insecure Design | **Fail** | Unsigned payment webhook (C-01), self-declared payments credited (H-06), no maker-checker on payments or grades (M-06), no CAPTCHA on the public form (M-09). |
| A05 Security Misconfiguration | Partial | Strong CSP/HSTS in `vercel.json`. Default PUBLIC EXECUTE left on definer functions (H-01), CORS `*` (L-03), FORCE RLS inconsistent (L-02). |
| A06 Vulnerable & Outdated Components | Partial | 1 moderate runtime advisory (react-router-dom). Dev tooling has 1 critical and 5 high. No audit step in CI. Edge Function imports float on major versions (M-13). |
| A07 Identification & Authentication Failures | **Fail** | No MFA enforcement (H-05). Login lockout is advisory only (M-02). Password policy is client-side only (M-03). |
| A08 Software & Data Integrity Failures | **Fail** | Unsigned webhook (C-01). No Deno lockfile (M-13). |
| A09 Security Logging & Monitoring Failures | Partial | 31 tables have audit triggers. No audit on role/permission/module/suspension/SSO changes or on exports. The purge function can be called by anyone (M-07, H-01). |
| A10 Server-Side Request Forgery | Pass (residual) | `bank-verify.ts` and `manage-sso-provider` use an allow-list or private-IP rejection, `redirect:"manual"`, timeouts and size caps. DNS-rebinding risk remains and is acknowledged in the code. |

### 2.2 ISO/IEC 27001:2022 Annex A control families

| Control family | Rating | Justification |
|---|---|---|
| A.5.15–5.18 / A.8.2–8.3 Access control & privileged access | **Fail** | H-01, H-02, H-04. Privileged roles have no MFA (H-05). Impersonation is not scoped (M-04). |
| A.8.5 Secure authentication | **Fail** | H-05, M-02, M-03 |
| A.8.24 Use of cryptography | Partial | TLS and Vault are fine. PII columns are unencrypted (M-08). |
| A.8.15–8.16 Logging & monitoring | Partial | Good coverage of data tables. Gaps on identity/configuration changes and exports (M-07). |
| A.8.20–8.23 Network / communications security | Pass (residual) | HSTS preload, CSP, `frame-ancestors 'none'`. CORS `*` (L-03). |
| A.8.25–8.29 Secure development & testing | Partial | Excellent pgTAP gate. The harness cannot see anon exposure; no SAST, secret scanning or dependency audit in CI (L-08, M-13). |
| A.8.8 Technical vulnerability management | Partial | M-13 |
| A.5.34 Privacy & PII protection | **Fail** | H-02 exposes minors' report cards and staff national IDs. M-08. |
| A.8.32 Change management | Partial | Undeployed changes are documented, but there is no release gate tying repo state to production (see the deployment caveat above). |

### 2.3 INSA stand-in (OWASP WSTG / ASVS L2 categories)

| WSTG category | Rating | Justification |
|---|---|---|
| Information Gathering | Partial | `get_email_for_user` is an anon email oracle (H-01). `has_module` works as a cross-tenant oracle (L-07). `sso-domain-lookup` returns a minimal response. |
| Configuration & Deployment Mgmt | Partial | Secure headers are present. Definer EXECUTE is left at its default (H-01). CORS `*`. |
| Identity Management | Partial | Invite-only sign-up. SSO domains are claimed without an ownership check (M-01). |
| Authentication | **Fail** | H-05, M-02, M-03 |
| Session Management | Partial | 1 h JWT with refresh rotation and reuse detection. Idle logout is client-side only. Impersonation sessions are not revoked (M-04). Tokens are in Web Storage (L-11). |
| Authorization | **Fail** | H-01, H-02, H-04, M-10 |
| Input Validation | Partial | Zod allow-lists on every Edge Function. MIME type is trusted from the client (M-09). CSV injection (M-05). Filter interpolation (L-12). |
| Error Handling | Pass | Generic client errors (`errors.*`); detail only in server logs. |
| Cryptography | Partial | M-08 |
| Business Logic | **Fail** | C-01, H-03, H-06, M-06 |
| Client-Side | Pass (residual) | No `dangerouslySetInnerHTML`; allow-list RichText renderer. The editor uses `innerHTML`, mitigated by CSP (L-04). SVG in the public bucket (L-05). |

---

## 3. Detailed Findings

The OWASP / ISO references use the codes from §2.

### Critical

| ID | Title | Severity | Category | File(s):Line(s) | Description | Evidence | Recommended Remediation |
|---|---|---|---|---|---|---|---|
| C-01 | Unauthenticated, unsigned Telebirr payment webhook settles invoices | **Critical** | A08, A04, A01 · ISO A.8.26 · WSTG Business Logic | `supabase/functions/telebirr-notify/index.ts:36-70,145-153`; `supabase/config.toml:35-36`; `supabase/functions/process-fee-payment/index.ts:67,109` | `telebirr-notify` has `verify_jwt=false` and does no signature check (acknowledged as a "pre-production blocker" in the header comment). It trusts `merch_order_id`, `trade_status` and `total_amount` from the request body and calls `settle_gateway_payment` with service_role. `process-fee-payment` returns the deterministic `merch_order_id` (`t<header-uuid><cents>`) to the caller. A parent can therefore start a checkout, never pay, and POST `{"merch_order_id":…,"trade_status":"Completed","total_amount":<balance>}`. The invoice is credited and a receipt PDF plus notification are issued. `trade_status:"Failure"` can also void any pending payment. | Code path read end-to-end. Settlement allocates `p_reported_amount` across the invoice's lines; the replay/amount guard only compares against the pending row, whose amount the attacker already knows from the checkout response. | **Block production enablement of Telebirr.** (1) Verify Telebirr's RSA signature using the provider public key; fail closed while the key is missing. (2) Before settling, confirm server-to-server with `queryOrder` (the `telebirr-query-order` plumbing already exists); settle only on `PAY_SUCCESS`. (3) Make `merch_order_id` non-derivable (random nonce stored on the pending row). (4) Rate-limit the endpoint and add an IP allow-list for Ethio Telecom. (5) Add a pgTAP/integration test proving an unsigned POST cannot settle. |

### High

| ID | Title | Severity | Category | File(s):Line(s) | Description | Evidence | Recommended Remediation |
|---|---|---|---|---|---|---|---|
| H-01 | `SECURITY DEFINER` RPCs executable by `anon` with no auth or tenant checks | **High** | A01, A05, A09 · ISO A.8.3 · WSTG AuthZ | `20260719000010_import_export.sql` (`create_import_job`, `create_export_job`, `update_job_progress`, `complete_job`, `fail_job`, grants `:148-150`); `20260719000011_system_health.sql` (`record_health_metric`, `create_health_alert`, `acknowledge_alert`, grants `:128-130`); `20260719000009_system_config.sql` (`get_config`); `20260719000006_audit_logging.sql` (`cleanup_old_audit_logs`); `20260715000012_rls_recursion_fix.sql:19` (`get_email_for_user`); backup `cleanup_expired_backups` / `timeout_stalled_backups` | 42 `SECURITY DEFINER` functions keep the default `PUBLIC` EXECUTE grant, so `anon` can reach them via `/rest/v1/rpc/*`. Most are guarded or trigger-only. These are not: they take a caller-supplied `p_tenant_id` / `p_job_id` / `user_id` and run as the owner, bypassing RLS. **13 of them have no `search_path` pinned** either. | **Probed (Appendix A-1):** as `anon`, `get_email_for_user(<tenant-B admin id>)` → `adm-b@x.et`. `create_health_alert(<tenant B>, 'critical', 'Your account is locked, call +251…')` inserted into B. `complete_job(<B's job>, 999, 'attacker/path.csv')` changed B's job to completed with an attacker path. `get_config()` returned platform security thresholds. As an authenticated **tenant-A** admin, `create_export_job(<tenant B>)` created a job in B, and `has_module(<B>,…)` answered for B. | `REVOKE EXECUTE … FROM PUBLIC, anon` on **every** definer function, then re-grant narrowly. Inside each tenant-parameterised function, derive the tenant from `get_tenant_id_for_user(auth.uid())` instead of trusting the argument. Revoke the job/health/cleanup functions from `authenticated` entirely (service-role or `pg_cron` only). `set search_path = public` on the 13. Add a pgTAP suite that asserts *no* definer function is anon-executable (it needs L-08's shim fix first). |
| H-02 | Storage `documents` and `report-cards` buckets readable and listable by every tenant member | **High** | A01 · ISO A.5.34, A.8.3 · WSTG AuthZ | `supabase/migrations/20260713000006_storage.sql:24` ("tenant read documents"), `:32` ("tenant read report cards"); writer `src/features/hr/staffApi.ts:67,100` | Both SELECT policies check only `foldername[1] = tenant`. There is no role or ownership predicate. `documents` holds `{tenant}/staff/{employee}/national_id.pdf`, contracts and health/legal files. `report-cards` holds every student's report card. SELECT also authorises the Storage *list* API, so paths do not need to be guessed. | **Probed (A-2):** as a `student`, `select … from storage.objects` returned `documents/<tenant>/staff/e1/national_id.pdf` and `report-cards/<tenant>/other-student/term1.pdf`. | Replace with role/ownership-scoped policies: documents → school_admin/hr_officer, or the employee whose id is `foldername[3]`; report cards → staff with grades:read, or the student/guardian whose id is in the path (mirror the `submissions` policy). Audit `avatars` and `assignment-attachments` the same way. Add pgTAP suites for storage policies. |
| H-03 | GRADE_TABS shows unreached ("future") grades; history truncated after 1 year | **High** | A04 · WSTG Business Logic (project rule 3) | `supabase/migrations/20260822000001_student_grade_history.sql:19-…`; consumers `src/features/students/academic-record.ts:85-93`, `src/features/students/tabs/AcademicRecordTab.tsx:31-41`, transcript via the same tabs | `get_student_grade_history()` builds the tab set from **every `class_id` that ever appeared** in `audit_logs.old_data/new_data` for the student, plus the current class. There is no upper bound at the current grade. A promotion that is later undone (R4-B5) or a mistaken class assignment leaves the higher grade in the set permanently. The source is also `audit_logs`, which `cleanup_old_audit_logs()` purges after 365 days (and anon can trigger it, H-01), so earlier grades silently disappear. | **Probed (A-3):** a student in G10 moved to G11 and back to G10. The RPC returned `{10,11}`, which is a tab for an unreached grade. | Derive history from an authoritative enrollment/promotion ledger (`promotion_run_students` minus reversed runs, plus current class), not from `audit_logs`. Filter `g <= current grade_level`, and exclude grades that only came from reversed promotions. Add pgTAP cases for undo, correction and >365-day history. |
| H-04 | Module gating and tenant suspension not enforced end-to-end (prior-fix regression) | **High** | A01, A04 · ISO A.8.3 (project rule 2) | Tables: `health_alerts`, `employee_emergency_contacts`, `employee_qualifications`, `employee_subjects`, `exam_seat_assignments`, `student_leave_requests` (+ `promotion_*`, `report_templates`); views `hr_employee_sensitive`, `clinic_visit_detail` (policies `hr_sensitive_view_read` / `clinic_detail_view_read` are `TO timhirt_view_owner`, while the gate is `TO authenticated`); `supabase/functions/_shared/security.ts:50-78`; `run-payroll/index.ts:23-70`; `process-library-circulation/index.ts`; `submit-admission/index.ts:163-190` | (a) The R1 module-gating fix covered 58 tables. The tables above were added later or missed, and are not in the migration's "deliberately not gated" list. (b) Security-barrier views run as `timhirt_view_owner`, so the `authenticated`-scoped restrictive gate never applies: HR bank/TIN and clinic detail stay readable with the module disabled. (c) `requireRole()` only checks `users.role` via service_role. It checks neither `has_module()`, nor `tenants.status` (suspension is enforced only through `get_tenant_id_for_user` in RLS), nor the custom-role/resource-permission matrix. Functions that do all their work with `adminClient` (`run-payroll`, `process-library-circulation`, `invite-staff`, `activate-sso-user`, `manage-sso-provider`, `submit-admission`) therefore work for a **suspended** tenant or one without the module. | Catalog: `pg_policies` restrictive-policy list vs module table map (§4). Code read of `requireRole`. | Add restrictive gates to the listed tables. Add `has_module()` to the view-owner policies. Extend `requireRole(req, roles, {module})` to reject when `tenants.status <> 'active'` or `has_module()` is false, and consult `has_resource_permission` so edge and RLS authorization cannot diverge. Add a catalog test: "every table with `tenant_id` either has a module gate or is on an explicit allow-list." |
| H-05 | MFA not enforced for any role, including super_admin | **High** | A07 · ISO A.8.5 · WSTG AuthN | `supabase/config.toml` (`[auth.mfa.totp] enroll_enabled=true`); no `mfa` / `aal` reference anywhere in `src/` | TOTP is switched on in GoTrue, but there is no enrollment UI, no `aal2` check in route guards, and no `aal2` requirement in RLS or Edge Functions. super_admin can impersonate any user (M-04), manage integration credentials and suspend tenants, all on a single factor. | `grep -rn "mfa\|aal" src` → nothing | Add TOTP enrollment. Require `aal2` for super_admin/school_admin/accountant/hr_officer: check `auth.jwt()->>'aal' = 'aal2'` in privileged RLS paths and in `requireRole()`. Require step-up before impersonation and credential changes. |
| H-06 | Applicant-declared payment converted into a `succeeded` payment at enrollment (latent), and admission receipts broken | **High** | A04 · WSTG Business Logic | `supabase/functions/enroll-finalize-billing/index.ts:117-131`; `supabase/functions/upload-admission-document/index.ts:34-38,85-94` | `fees_total_etb` (0–1,000,000) and `payment_method` come from the **anonymous** upload form. On enrollment, the function inserts a `payments` row with `status:'succeeded'` for that amount. The only condition is that *a* receipt file exists; bank verification is not required. `apply_payment_to_invoice` then credits the invoice. **Currently masked:** the insert passes `invoice_id: invoice.id` (a `fee_invoices` id), but `payments.invoice_id` references `invoice_headers(id)`. The insert fails with an FK violation and becomes `billingError`, so admission receipts are never produced (functional regression from the R3/R5 invoice consolidation). Fixing only the FK activates the fraud path. | Catalog: `payments_invoice_id_fkey → invoice_headers(id)`; trigger `apply_manual_payment_trg`. | Never credit an anonymous declaration. Create the payment as `pending` and require either a `bank_payment_verifications.status='verified'` row or explicit staff approval by a second user (maker-checker, M-06). Cap it at the invoice amount. Fix the FK (`invoice_id: headerId`) in the same change. |

### Medium

| ID | Title | Severity | Category | File(s):Line(s) | Description | Evidence | Recommended Remediation |
|---|---|---|---|---|---|---|---|
| M-01 | SSO domain claimed without ownership verification; direct table write bypasses Edge Function | Medium | A07, A01 · ISO A.8.5 | `supabase/migrations/20260817000009_tenant_sso_providers.sql:45`; `supabase/functions/manage-sso-provider/index.ts`; `complete-sso-login/index.ts` (domain → tenant); `sso-domain-lookup/index.ts` | `tenant_sso_providers_admin_manage` is a `FOR ALL` policy, so a school_admin can INSERT any `domain` through PostgREST (the pgTAP suite proves the insert). That skips the Edge Function's GoTrue sync and SSRF checks. There is no DNS-TXT or email proof of domain ownership, and `domain` is globally unique. Consequences: squatting (e.g. `gmail.com`, another school's domain, `moe.gov.et`) blocks the rightful tenant; the login page redirects users of that domain to SSO (it falls back to password on error); and `complete-sso-login` routes that domain's SSO users into the squatter's tenant as `pending`. | Policy definition; `tenant_sso_providers.sql` test 1 | Make the table write-only through the Edge Function (drop INSERT/UPDATE for authenticated). Require DNS-TXT domain verification before `enabled=true`. Block public-mail domains. In `complete-sso-login`, pick the tenant from the SSO provider id in `identities[].provider`, not the email domain. |
| M-02 | Login brute-force lockout is advisory only | Medium | A07 · WSTG AuthN | `src/features/auth/LoginPage.tsx:95-115`; `supabase/functions/check-login-attempt/index.ts:47-58` | The lockout is a separate Edge Function that the SPA calls before `signInWithPassword`. An attacker calls GoTrue `/auth/v1/token?grant_type=password` directly and never touches it. The IP bucket is keyed on the **first** `X-Forwarded-For` entry, which may be client-controlled (same pattern in `verify-id`, `submit-admission`, `check-admission-status`, `upload-admission-document`, `verify-admission-bank-url`, `sso-domain-lookup`). | Code read | Rely on GoTrue's own rate limits (configure them in the dashboard). Use a GoTrue **Auth Hook** (password-verification hook) to enforce per-account lockout server-side. Derive client IP from the platform-trusted header (check what Supabase's gateway sets). |
| M-03 | Password policy enforced only in the browser | Medium | A07 · ISO A.8.5 | `src/lib/passwordPolicy.ts`; `system_config.password_*`; `supabase/config.toml` (no `minimum_password_length` / `password_requirements`) | Complexity rules from `/platform/security` are checked client-side. GoTrue's server policy is at its default (6 characters, no classes), so direct API password set/reset bypasses the tenant policy. | Config read | Set `[auth] minimum_password_length` and `password_requirements` (and the same in the hosted dashboard). Enable leaked-password protection. Treat `system_config` as display-only or sync it to GoTrue. |
| M-04 | Impersonation is unscoped, unrevoked and misattributed | Medium | A01, A09 · ISO A.8.2, A.8.15 | `supabase/functions/impersonate-user/index.ts`; `end-impersonation/index.ts`; `src/features/platform/impersonation.ts` | A magic-link session for the target gives **full read/write** as that user. Parents and students (minors' data) can be targets. There is no time box. `end-impersonation` only stamps `ended_at` and does not revoke the target session's refresh token. Writes made while impersonating are logged in `audit_logs` as the target user, with no actor linkage. There is no MFA step-up (H-05) and no tenant notification. | Code read | Mint a short-lived, read-only session, or carry an `impersonator` claim that RLS/audit can read. Record `actor_id` in `audit_logs` when present. Revoke the session (`auth.admin.signOut(target, 'others')` or a session-id revoke) on end or after N minutes. Restrict targets to staff unless a second approver signs off. Notify the tenant's school_admin. |
| M-05 | CSV / formula injection in exports and the bank-transfer file | Medium | A03 · WSTG Input Validation | `supabase/functions/process-export-job/index.ts:55-60`; `src/features/hr/PayrollRunDetailPage.tsx:15-18,78-95`; other client CSV writers in `InvoicesPage.tsx`, `AuditLogsPage.tsx`, `ClassesPage.tsx` | Cells are quoted, but leading `= + - @ \t \r` is not neutralised. Student and guardian names come from the **anonymous** admission form, so `=HYPERLINK(...)` or DDE payloads run when staff open the export in Excel. `csvCell` also doesn't quote `\r`. | Code read | Prefix a `'` on cells starting with `= + - @ \t \r`, quote `\r`, and add a UTF-8 BOM for Amharic. Centralise this in one `csv.ts` helper and unit-test it. |
| M-06 | No maker-checker (dual control) on financial and academic changes | Medium | A04 · ISO A.5.3 (segregation of duties) | RLS for `payments` (`payments_manual_insert`), `fee_invoices` (accountant has `delete`), `grades` (update after publication), `record-fee-payment`, `student_transfer` / withdrawal | Only payroll approval has DB-enforced separation of duties (`payroll_sod` suite). A single accountant can record a cash or bank payment (credited immediately by `apply_manual_payment_trg`), delete invoices and issue receipts. Grade changes after `results_published` need no second approval. Transfers and withdrawals need no approval. | `resource_default_role_grants`; triggers | Add a `pending_approval` state and approver ≠ maker CHECK/trigger (reuse the `payroll_run_transition` pattern) for manual payments above a threshold, invoice void/delete, post-publication grade edits, and transfer-out. |
| M-07 | Audit trail gaps and weak retention | Medium | A09 · ISO A.8.15 | `supabase/migrations/20260719000006_audit_logging.sql`; the trigger list in §4 | `audit_trigger` covers 31 tables but **not** `users` (role changes), `user_roles`, `role_permissions`, `user_permission_overrides`, `tenant_module_overrides`, `tenants` (suspension), `tenant_sso_providers`, `salary_components` / `employee_salary_components` (salary changes), `health_conditions` (medical), `data_jobs` (exports). The bank-file download is a pure client action and is never logged. Retention is 365 days, and the purge RPC can be called by anon (H-01). | Catalog query of `pg_trigger` | Add triggers to the listed tables. Log exports and bank-file downloads through an Edge Function. Make `audit_logs` append-only with a hash chain or ship it to external immutable storage. Align retention with Ethiopian record-keeping (≥ 5–7 years for financial and academic records). |
| M-08 | Sensitive PII stored in plaintext; column-level controls incomplete | Medium | A02 · ISO A.8.24, A.5.34 | `employees` column grants (`national_id`, `date_of_birth`, `personal_email` granted to `authenticated`); `hr_employee_sensitive` (bank_account, TIN, pension_no) | National ID, bank account, TIN and guardian contacts are plaintext columns. Any role with `employees:read` (e.g. accountant) sees national ID and DOB. Only disk-level encryption at rest applies. | `information_schema.column_privileges` | Move `national_id` into the sensitive view. Encrypt bank_account/TIN/national_id with Vault/pgsodium (TCE) and decrypt only in the view. Mask by default (last 4 digits). Write a data-classification register (§6 of this report can seed it). |
| M-09 | Public uploads trust the client MIME type; no malware scan; no CAPTCHA | Medium | A04, A05 · WSTG Input Validation | `supabase/functions/upload-admission-document/index.ts:60-62`; `submit-admission/index.ts:7-8` (CAPTCHA acknowledged as TODO) | `file.type` is supplied by the browser. There is no magic-byte sniffing and no AV scan before staff open the files. The public form is protected only by per-IP rate limits (spoofable, see M-02). | Code read | Sniff magic bytes (PDF/PNG/JPEG/WebP) and re-encode images. Quarantine uploads until scanned (ClamAV sidecar or a provider scan). Add Cloudflare Turnstile/hCaptcha verified server-side. |
| M-10 | Cross-tenant IDOR on `fee_structure_id` in `enroll-finalize-billing` | Medium | A01 | `supabase/functions/enroll-finalize-billing/index.ts:76-78` | The fee structure is fetched with the service-role client by id, with no `tenant_id = application.tenant_id` check. A registrar can bill a student against another tenant's fee structure (name and amount leak onto the invoice PDF). UUID knowledge is required. | Code read | Read it through `ctx.userClient`, or add `.eq("tenant_id", application.tenant_id)`. |
| M-11 | Ge'ez numerals can still be enabled for date output | Medium | Project rule 4 · WSTG Client-Side (conformance) | `src/components/EthDate.tsx:40-48`; `src/components/EthDatePicker.tsx:141-200`; `src/features/settings/CalendarPreferencesPage.tsx:14-47`; `src/features/settings/useGeezNumerals.ts` | R3-4 *wired* the tenant `geezNumerals` toggle into `<EthDate/>`. When a school enables it, every rendered EC date shows ፩ ፪ ፫…. That contradicts the Arabic-numerals-only standard. The toggle label is also hard-coded English (not i18n). | Code read | Remove the toggle and the `geez` prop, and always pass `geez:false` to `formatEth`. Keep `toGeez` only if it is needed elsewhere. Backfill `tenant_configs.settings.calendar.geezNumerals=false`. Add a unit test asserting no U+1369–U+137C in `formatEth` output. |
| M-12 | Ethiopian name format not respected (First + Last instead of First + Middle [+ Last]) | Medium | Project rule 9 · data integrity on legal documents | ~25 sites, e.g. `supabase/functions/record-fee-payment/index.ts:124`, `telebirr-notify/index.ts:118-120`, `issue-fee-document/index.ts:71`, `enroll-finalize-billing/index.ts:66`, `src/features/students/LeavingCertificatesPage.tsx:65`, `src/features/gradebook/ReportCardBatchPage.tsx:64`, `AttendanceMarkingPage.tsx:149`, `InvoicesPage.tsx:65`, `ParentChildPage.tsx:43` | Rendering `first_name + last_name` drops the father's name, so the displayed short name is wrong: it should be First + Middle. Receipts, leaving certificates and report cards carry legally incorrect names. `initialsFor()` in `issue-id-card` / `issue-staff-id` uses first + last. There is no shared formatter. | Grep | Add `formatName(p, 'full' \| 'short')` in `src/lib` and in `_shared`: full = First Middle Last, short = First Middle. Replace every call site. Add a lint rule or a grep gate in CI. |
| M-13 | Vulnerable and unpinned components | Medium | A06, A08 · ISO A.8.8 | `package.json`; Edge Function imports `npm:@supabase/supabase-js@2`, `npm:zod@3`, `npm:pdf-lib@1`, `npm:@pdf-lib/fontkit@1` | `npm audit`: **runtime** `react-router-dom` moderate (open redirect → XSS, GHSA-wrjc-x8rr-h8h6). **Dev**: `vitest` critical, `vite` high, plus `brace-expansion` / `browserslist` / `js-yaml` / `nanoid` high (dev-server/tooling only). Edge Functions float on major versions with no `deno.lock`, so each deploy can pull new code. CI has no audit step. | `npm audit --json` | Upgrade react-router-dom, vite and vitest. Pin exact Edge Function versions plus a `deno.lock`. Add `npm audit --omit=dev --audit-level=high` and Dependabot/Renovate to CI. |

### Low

| ID | Title | Severity | Category | File(s):Line(s) | Description | Evidence | Recommended Remediation |
|---|---|---|---|---|---|---|---|
| L-01 | Amharic typography not on the Tayitu (primary) / Jiret (secondary) standard | Low | Project rule 5 | `tailwind.config.ts:59-60` (`'Noto Sans Ethiopic'`, never bundled); Noto Serif Ethiopic in `transcript-pdf.ts`, `student-profile-pdf.ts`, `leaving-certificate-pdf.ts`, `seating-chart-pdf.ts`, `classes-pdf.ts`, `timetable-pdf.ts`, `staff-profile-pdf.ts`, `issue-id-card`; `_shared/fee-pdf.ts` / `payslip-pdf.ts` embed no Ethiopic font | Tayitu and Jiret are only offered in the ID-card designer. The UI falls back to the system font. Server PDFs drop Amharic glyphs entirely. | Grep | UI stack `['Tayitu','Jiret',…]` with `@font-face` for both. Swap the PDF embeds to Tayitu with a Jiret fallback. Embed Tayitu in the Edge Function PDFs. Remove Noto. |
| L-02 | `FORCE ROW LEVEL SECURITY` missing on 11 tables | Low | A05 | `backup_jobs`, `data_jobs`, `feature_flags`, `health_alerts`, `permissions`, `restore_jobs`, `role_permissions`, `roles`, `system_config`, `system_health`, `user_roles` | This is inconsistent with the other 102 tables. It only matters for the table owner, but it is defence-in-depth drift. | Catalog | `alter table … force row level security` on each. |
| L-03 | CORS `Access-Control-Allow-Origin: *` on every Edge Function | Low | A05 · ISO A.8.20 | `supabase/functions/_shared/security.ts:17-21` | Auth is a bearer token, not a cookie, so this is not a CSRF vector. Still broader than needed. | Code | Echo an allow-listed `Origin` (the prod Vercel domain plus localhost in dev). |
| L-04 | `RichTextEditor` assigns stored HTML to `innerHTML` | Low | A03 (XSS) | `src/components/ui/RichTextEditor.tsx:49` | Stored notice/assignment HTML is written back into a contentEditable. CSP `script-src 'self'` blocks inline handlers, which contains the impact. | Code | Sanitise through the same allow-list walker as `RichText.tsx` before assigning. |
| L-05 | Public `branding` bucket accepts `image/svg+xml` | Low | A03, A05 | `storage.buckets` (`branding`, public) | SVG is active content served from the storage origin. | Catalog | Drop SVG, or rasterise and sanitise server-side. |
| L-06 | Payment redirect URL built from the request `Origin` header | Low | A01 (open redirect) | `supabase/functions/process-fee-payment/index.ts:93` | Any caller-chosen origin becomes Telebirr's `redirectUrl`. | Code | Use a fixed `APP_URL` env var. |
| L-07 | Cross-tenant oracles | Low | A01 (info) | `has_module(p_tenant_id, …)`; `get_config()` | They reveal another tenant's module subscription and the platform security thresholds. | Probe A-1 | Covered by the H-01 revoke plus deriving the tenant internally. |
| L-08 | Test harness and CI blind spots | Low | ISO A.8.29 | `supabase/tests/shim.sql` (no `grant usage on schema public to anon`); `.github/workflows/ci.yml` | pgTAP cannot detect anon exposure (H-01 stayed invisible to 55 green suites). CI has no SAST, no secret scanning and no dependency audit. Actions are pinned by tag, not SHA. | Harness run | Mirror Supabase role grants in the shim. Add CodeQL/Semgrep, gitleaks and `npm audit`. Pin actions by SHA. |
| L-09 | Naming-convention drift in stored JSON | Low | Project rule 7 | `tenant_configs.settings.calendar.{geezNumerals,secondaryVisible}` | SQL identifiers are clean (0 camelCase columns or functions) and TS has 0 snake_case locals, but the persisted jsonb keys are camelCase. | Catalog + grep | Standardise jsonb keys to snake_case in a migration with a read-both transition. |
| L-10 | Documentation and architecture drift | Low | ISO A.5.37 | `CLAUDE.md` ("38 migrations + 5 pgTAP suites"; actual 105 / 55); blueprint cites §21.9 (absent); no INSA checklist; no DFD/ERD/OpenAPI for the 32 Edge Functions in `/docs` | Security documentation lags behind the code. | Repo read | Regenerate the ERD/DFD. Publish an OpenAPI spec for the Edge Functions (§5 can seed it). Add the INSA checklist and §21. |
| L-11 | Auth tokens in Web Storage | Low | A07 (session) | supabase-js default `localStorage`; `src/features/platform/impersonation.ts:48` keeps the **super_admin's** session in `sessionStorage` | Any XSS would exfiltrate the tokens. CSP reduces the likelihood. | Code | Accept the risk with CSP, or move to `@supabase/ssr` httpOnly cookies. Never persist the super_admin refresh token during impersonation (re-authenticate instead). |
| L-12 | PostgREST filter-string interpolation | Low | A03 | `src/features/library/libraryApi.ts:30,144`; `src/features/settings/classesApi.ts:28` | A raw search term inside `.or()` can inject extra filter clauses. RLS still bounds the result set, so this is filter manipulation, not escalation. | Grep | Escape `, ( ) .` in terms, or use `.ilike()` chains or an RPC. |

---

## 4. Multi-Tenant Isolation Matrix

Source: the live catalog after applying all 105 migrations. **S/I/U/D** = number of permissive and restrictive policies that apply to SELECT / INSERT / UPDATE / DELETE (`FOR ALL` counts toward each). "Module gate" = a restrictive `*_module_gate` policy exists. Every permissive policy on a tenant table was verified to AND `tenant_id = get_tenant_id_for_user(auth.uid())`, with super_admin as the only non-tenant `OR` branch. Exceptions: `users_self_update` / `users_select` (`id = auth.uid()`, self-row only).

**Summary.** RLS is on for 113/113 tables and FORCE for 102/113. There are 0 permissive cross-tenant branches. The *table-level* verdict is PASS everywhere. The FAIL and PARTIAL rows are where RPCs, views or missing gates undermine the table (H-01, H-04, M-01).

**Audit-trigger coverage (M-07):** `admission_applications, attendance, bank_payment_verifications, classes, clinic_visits, discipline_incidents, document_templates, employee_documents, employees, employment_contracts, exam_seat_assignments, fee_documents, fee_invoices, grades, guardians, invoice_headers, leave_requests, library_*, notices, payments, payroll_runs, payslips, platform_integrations, staff_performance_reviews, student_leave_requests, students, teachers`.

| Table | RLS | FORCE | Tenant column | S/I/U/D policies | Module gate | Verdict | Notes |
|---|---|---|---|---|---|---|---|
| `academic_terms` | Y | Y | tenant_id | 1/1/1/1 | N | PASS |  |
| `academic_years` | Y | Y | tenant_id | 1/1/1/1 | N | PASS |  |
| `admission_applications` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `announcements` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `asset_register` | Y | Y | tenant_id | 2/1/1/1 | N | PASS | No module gate (documented: orphan table) |
| `assignment_attachments` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `assignment_sections` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `assignment_submissions` | Y | Y | tenant_id | 2/2/2/1 | Y | PASS |  |
| `assignments` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `attendance` | Y | Y | tenant_id | 2/2/3/1 | Y | PASS | Module gate + restrictive retroactive-edit gate |
| `audit_logs` | Y | Y | tenant_id | 1/0/0/0 | N | **FAIL via RPC** | Read school_admin/super_admin; no client write; purge fn anon-callable (H-01) |
| `backup_jobs` | Y | **N** | tenant_id | 2/1/1/1 | N | PASS | FORCE off |
| `bank_payment_verifications` | Y | Y | tenant_id | 1/0/0/0 | N | PASS | Not module-gated (documented: shared by admissions/fees) |
| `bank_verification_domains` | Y | Y | — (global) | 2/1/1/1 | n/a | PASS (global) | Global reference (no tenant col); read-all, write super_admin |
| `builtin_role_permission_grants` | Y | Y | tenant_id | 2/1/1/1 | N | PASS |  |
| `calendar_events` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `class_subject_teachers` | Y | Y | tenant_id | 3/2/2/2 | N | PASS |  |
| `classes` | Y | Y | tenant_id | 1/1/1/1 | N | PASS |  |
| `clinic_visits` | Y | Y | tenant_id | 5/3/3/3 | Y | PASS | Table SELECT revoked; clinic_visit_detail view bypasses module gate |
| `data_jobs` | Y | **N** | tenant_id | 1/1/1/0 | N | **FAIL via RPC** | FORCE off; RPCs create_export_job/complete_job/fail_job bypass RLS cross-tenant (H-01) |
| `discipline_incidents` | Y | Y | tenant_id | 2/2/2/1 | Y | PASS |  |
| `document_templates` | Y | Y | tenant_id | 2/1/1/1 | N | PASS |  |
| `employee_documents` | Y | Y | tenant_id | 3/2/2/2 | Y | PASS |  |
| `employee_emergency_contacts` | Y | Y | tenant_id | 2/1/1/1 | N | PARTIAL (gate) | **No module gate (hr_payroll)** (H-04) |
| `employee_qualifications` | Y | Y | tenant_id | 2/1/1/1 | N | PARTIAL (gate) | **No module gate (hr_payroll)** (H-04) |
| `employee_salary_components` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `employee_subjects` | Y | Y | tenant_id | 2/1/1/1 | N | PARTIAL (gate) | **No module gate (hr_payroll)** (H-04) |
| `employees` | Y | Y | tenant_id | 3/2/2/2 | Y | PASS | Table SELECT revoked; column grants; national_id/DOB still granted (M-08); hr_employee_sensitive view bypasses module gate |
| `employment_contracts` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `exam_seat_assignments` | Y | Y | tenant_id | 2/1/1/1 | N | PARTIAL (gate) | **No module gate (gradebook)** (H-04) |
| `exams` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `feature_flags` | Y | **N** | tenant_id | 2/1/1/1 | N | PASS | FORCE off |
| `fee_documents` | Y | Y | tenant_id | 2/1/1/1 | Y | PASS |  |
| `fee_invoices` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `fee_structures` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `grade_bands` | Y | Y | tenant_id | 1/1/1/1 | N | PASS |  |
| `grade_cycles` | Y | Y | — (global) | 2/1/1/1 | n/a | PASS (global) | Global reference; read-all, write super_admin |
| `grades` | Y | Y | tenant_id | 3/2/2/1 | Y | PASS | Module gate + restrictive publication gate |
| `grading_scales` | Y | Y | tenant_id | 1/1/1/1 | N | PASS |  |
| `guardians` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `health_alerts` | Y | **N** | tenant_id | 1/1/1/1 | N | **FAIL via RPC** | **No module gate (clinic)**; RPC create_health_alert/acknowledge_alert bypass RLS cross-tenant (H-01); FORCE off |
| `health_conditions` | Y | Y | tenant_id | 4/3/3/3 | Y | PASS | Table SELECT revoked; column grants; not audited (M-07) |
| `hostel_allocations` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `hostel_buildings` | Y | Y | tenant_id | 3/2/2/2 | Y | PASS |  |
| `hostel_rooms` | Y | Y | tenant_id | 3/2/2/2 | Y | PASS |  |
| `hostel_visitor_logs` | Y | Y | tenant_id | 4/3/3/3 | Y | PASS |  |
| `id_card_batches` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `id_cards` | Y | Y | tenant_id | 4/3/3/3 | Y | PASS |  |
| `impersonation_sessions` | Y | Y | — (global) | 1/0/0/0 | n/a | PASS (global) | Platform audit; super_admin read, service-role write only |
| `inventory_items` | Y | Y | tenant_id | 3/2/2/2 | Y | PASS |  |
| `inventory_movements` | Y | Y | tenant_id | 2/2/1/1 | Y | PASS |  |
| `invoice_headers` | Y | Y | tenant_id | 2/1/1/1 | Y | PASS |  |
| `leave_balances` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `leave_requests` | Y | Y | tenant_id | 2/3/3/1 | Y | PASS |  |
| `leave_types` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `library_book_copies` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `library_books` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `library_checkouts` | Y | Y | tenant_id | 2/1/1/1 | Y | PASS |  |
| `library_fines` | Y | Y | tenant_id | 2/1/2/1 | Y | PASS |  |
| `library_holds` | Y | Y | tenant_id | 2/1/1/1 | Y | PASS |  |
| `library_settings` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `messages` | Y | Y | tenant_id | 1/1/1/0 | N | PASS | Not module-gated by design (sender/recipient RLS) |
| `modules` | Y | Y | — (global) | 2/1/1/1 | n/a | PASS (global) | Global catalog; read-all, write super_admin |
| `moe_exports` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `notices` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `notification_log` | Y | Y | tenant_id | 2/1/1/1 | Y | PASS |  |
| `notification_templates` | Y | Y | — (global) | 2/1/1/1 | n/a | PASS (global) | Global; read-all, write super_admin |
| `operational_modes` | Y | Y | — (global) | 2/1/1/1 | n/a | PASS (global) | Global; read-all, write super_admin |
| `payments` | Y | Y | tenant_id | 2/2/1/1 | Y | PASS | Client inserts only via payments_manual_insert; gateway rows service-role |
| `payroll_runs` | Y | Y | tenant_id | 2/2/2/1 | Y | PASS |  |
| `payslip_lines` | Y | Y | tenant_id | 2/1/1/1 | Y | PASS | Tenant via join to payslips |
| `payslips` | Y | Y | tenant_id | 2/1/1/1 | Y | PASS |  |
| `pension_rates` | Y | Y | — (global) | 2/1/1/1 | n/a | PASS (global) | Global statutory; read-all, write super_admin |
| `periods` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `permissions` | Y | **N** | — (global) | 1/0/0/0 | n/a | PASS (global) | Global catalog; public read, no write policy |
| `platform_integrations` | Y | Y | — (global) | 1/0/0/0 | n/a | PASS (global) | Platform-only; super_admin read, no client write (secrets in Vault) |
| `portal_notifications` | Y | Y | tenant_id | 1/0/1/0 | N | PASS | Recipient-scoped; no client INSERT |
| `promotion_run_students` | Y | Y | tenant_id | 1/1/0/0 | N | PASS | No module gate; no UPDATE/DELETE policy (immutable) |
| `promotion_runs` | Y | Y | tenant_id | 1/1/1/0 | N | PASS | No module gate |
| `rate_limits` | Y | Y | — (global) | 0/0/0/0 | n/a | PASS (global) | No policies + no grants: service-role only |
| `report_templates` | Y | Y | tenant_id | 1/1/1/1 | N | PASS | No module gate |
| `resource_default_role_grants` | Y | Y | — (global) | 1/0/0/0 | n/a | PASS (global) | Global; read-all, NO write policy (R1 regression item - PASS) |
| `resource_open_actions` | Y | Y | — (global) | 1/0/0/0 | n/a | PASS (global) | Global; read-all, NO write policy (R1 regression item - PASS) |
| `restore_jobs` | Y | **N** | tenant_id | 2/1/1/1 | N | PASS | FORCE off |
| `role_permissions` | Y | **N** | — (global) | 2/1/1/1 | N | PASS | FORCE off; not audited |
| `roles` | Y | **N** | tenant_id | 2/1/1/1 | N | PASS | FORCE off |
| `salary_components` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `school_types` | Y | Y | — (global) | 2/1/1/1 | n/a | PASS (global) | Global; read-all, write super_admin |
| `staff_attendance` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `staff_performance_reviews` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `student_leave_requests` | Y | Y | tenant_id | 1/1/1/0 | N | PARTIAL (gate) | **No module gate** (H-04) |
| `student_merits` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `student_route_assignments` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS |  |
| `students` | Y | Y | tenant_id | 2/2/2/2 | Y | PASS | Table SELECT revoked; column-level grants |
| `subjects` | Y | Y | tenant_id | 1/1/1/1 | N | PASS |  |
| `subscription_tiers` | Y | Y | — (global) | 2/1/1/1 | n/a | PASS (global) | Global; read-all, write super_admin |
| `system_config` | Y | **N** | tenant_id | 2/1/1/1 | N | **FAIL via RPC** | FORCE off; tenant_id NULL rows = platform config; get_config() anon-readable (H-01) |
| `system_health` | Y | **N** | tenant_id | 1/1/0/0 | N | **FAIL via RPC** | FORCE off; RPC record_health_metric writes any tenant (H-01) |
| `tax_brackets` | Y | Y | — (global) | 2/1/1/1 | n/a | PASS (global) | Global statutory; read-all, write super_admin |
| `teachers` | Y | Y | tenant_id | 1/1/1/1 | N | PASS |  |
| `telebirr_token_cache` | Y | Y | — (global) | 0/0/0/0 | n/a | PASS (global) | No policies: deny-all to clients (service-role only) |
| `tenant_configs` | Y | Y | tenant_id | 2/1/1/1 | N | PASS | Core config, not gated (documented) |
| `tenant_module_overrides` | Y | Y | tenant_id | 2/1/1/1 | N | PASS |  |
| `tenant_sso_providers` | Y | Y | tenant_id | 2/1/1/1 | N | PARTIAL | school_admin can write directly (bypasses Edge Function) (M-01) |
| `tenants` | Y | Y | — (global) | 2/1/1/1 | n/a | PASS (global) | Row = tenant; own row or super_admin |
| `tier_modules` | Y | Y | — (global) | 2/1/1/1 | n/a | PASS (global) | Global; read-all, write super_admin |
| `timetable_slots` | Y | Y | tenant_id | 3/2/2/2 | Y | PASS |  |
| `transport_routes` | Y | Y | tenant_id | 3/2/2/2 | Y | PASS |  |
| `transport_stops` | Y | Y | tenant_id | 3/2/2/2 | Y | PASS |  |
| `user_permission_overrides` | Y | Y | tenant_id | 2/1/1/1 | N | PASS |  |
| `user_roles` | Y | **N** | tenant_id | 2/1/1/1 | N | PASS | FORCE off; not audited |
| `users` | Y | Y | tenant_id | 1/0/1/0 | N | PASS | Self-update locked (role/tenant/email) by WITH CHECK + trigger; not audited (M-07) |
| `webhook_events` | Y | Y | — (global) | 0/0/0/0 | n/a | PASS (global) | No policies: deny-all to clients (service-role only) |

### Views

| View | security_invoker | Owner | Verdict |
|---|---|---|---|
| `invoice_summary` | true | postgres | PASS (caller's RLS applies) |
| `hr_employee_sensitive` | false (security_barrier) | `timhirt_view_owner` (no BYPASSRLS) | PARTIAL: tenant/role scoped via `hr_sensitive_view_read`, but **bypasses the hr_payroll module gate** (H-04) |
| `clinic_visit_detail` | false (security_barrier) | `timhirt_view_owner` | PARTIAL: tenant + school_admin scoped, **bypasses the clinic module gate** (H-04) |

### Storage buckets

| Bucket | Public | Read scope | Verdict |
|---|---|---|---|
| `documents` | N | **any tenant member** | **FAIL** (H-02). Holds staff national IDs, contracts, health/legal files |
| `report-cards` | N | **any tenant member** | **FAIL** (H-02) |
| `avatars`, `assignment-attachments` | N | any tenant member | Acceptable, but review under a least-privilege model |
| `branding` | **Y** | anyone | By design. SVG allowed (L-05) |
| `admission-documents`, `bank-verifications`, `fee-documents`, `id-cards`, `evidence`, `moe-exports`, `payslips`, `student-photos`, `submissions`, `data-imports`, `id-card-templates` | N | role- and/or owner-scoped within tenant | PASS |

---

## 5. API / Edge Function Inventory

Classification follows the blueprint: **Public** = no JWT; **Private** = tenant users; **Internal** = platform/super_admin or post-auth plumbing. The generic error body (`{"error":"Invalid request"}` / 401 / 403 / 429 / 500) is shared through `_shared/security.ts` and applies to every row. All endpoints are `POST` (+ `OPTIONS`). `submit-admission` also accepts `GET ?tenant_slug=`.

| Endpoint (`/functions/v1/…`) | Method | Class | Auth (verify_jwt / roles) | Rate-limited | Input-validated | Notes |
|---|---|---|---|---|---|---|
| `telebirr-notify` | POST | Public | **none**, **no signature** | **No** | **No schema** | **C-01**. Settles payments from an unauthenticated body |
| `verify-id` | POST | Public | none | Y (20/min/IP) | Zod | Code ≥ 24 chars. Returns minimal fields |
| `check-login-attempt` | POST | Public | none | Y (config-driven) | Zod | Advisory only (M-02) |
| `sso-domain-lookup` | POST | Public | none | Y (20/min/IP) | Zod | Returns `{sso:boolean}` only |
| `submit-admission` | GET/POST | Public | none | Y (IP) | Zod (22 rules) | No CAPTCHA, no tenant-status/module check (H-04, M-09) |
| `check-admission-status` | POST | Public | none | Y (20/min/IP) | Zod | ~50-bit tracking code. 300 s signed URLs |
| `upload-admission-document` | POST (multipart) | Public | none (stage-gated by application id) | Y (20/h/IP) | UUID/enum; **MIME trusted** | M-09. Feeds H-06 |
| `verify-admission-bank-url` | POST | Public | none (stage-gated) | Y (10/h/IP) | Zod | SSRF-guarded fetch with allow-list |
| `process-fee-payment` | POST | Private | JWT; parent/school_admin/accountant + RLS on header | Y | Zod | Returns deterministic `merch_order_id` (C-01). Origin-based redirect (L-06) |
| `record-fee-payment` | POST | Private | JWT; school_admin/accountant; RLS insert | Y | Zod | No maker-checker (M-06) |
| `issue-fee-document` | POST | Private | JWT; admin/accountant/parent/student; RLS reads | Y | Zod | 300 s signed URL |
| `enroll-finalize-billing` | POST | Private | JWT; admin/registrar/accountant | Y | Zod | H-06, M-10 |
| `generate-fee-invoices` | POST | Private | JWT; admin/accountant; RLS on structure | Y | Zod | OK |
| `telebirr-query-order` | POST | Private | JWT; admin/accountant | Y | Zod | Response not signature-verified (documented) |
| `run-payroll` | POST | Private | JWT; hr_officer/school_admin; **service-role only** | Y | Zod | No module/suspension check (H-04). SoD enforced in DB at approval |
| `generate-payslip-pdf` | POST | Private | JWT; staff roles + RLS read | Y | Zod | 60 s signed URL |
| `invite-staff` | POST | Private | JWT; school_admin/hr_officer (HR limited role set) | Y | Zod | Service-role; no suspension check |
| `provision-portal-accounts` | POST | Private | JWT; school_admin/registrar | Y | Zod | |
| `issue-id-card` | POST | Private | JWT; school_admin/registrar | Y | Zod | 48-hex verify code |
| `issue-staff-id` | POST | Private | JWT; school_admin/hr_officer | Y | Zod | |
| `process-import-job` | POST | Private | JWT; school_admin; RLS job read | Y | Zod + row validation | |
| `process-export-job` | POST | Private | JWT; school_admin; RLS job read | Y (5/min) | Zod | CSV injection (M-05). Export not audited (M-07) |
| `process-library-circulation` | POST | Private | JWT; school_admin/librarian; **service-role** | Y | Zod (16) | No module check (H-04) |
| `manage-sso-provider` | POST | Private | JWT; school_admin | Y | Zod | SSRF guard. Domain not verified (M-01) |
| `activate-sso-user` | POST | Private | JWT; school_admin, same-tenant pending only | Y | Zod | Role cap enforced |
| `complete-sso-login` | POST | Internal | JWT (any authenticated SSO user) | Y (5/min) | n/a | Tenant chosen by email domain (M-01) |
| `onboard-tenant` | POST | Internal | JWT; super_admin | Y | Zod | |
| `invite-tenant-admin` | POST | Internal | JWT; super_admin | Y | Zod | |
| `manage-integration-credentials` | POST | Internal | JWT; super_admin | Y | Zod | Writes Vault |
| `telebirr-generate-keypair` | POST | Internal | JWT; super_admin | Y | none needed | |
| `impersonate-user` | POST | Internal | JWT; super_admin; never targets super_admin | Y (10/h) | Zod | M-04. No MFA (H-05) |
| `end-impersonation` | POST | Internal | JWT; super_admin, actor must match | **No** | Zod | Does not revoke the session (M-04) |

**Direct PostgREST surface:** all 113 tables are exposed through `/rest/v1` with RLS. The RPC surface includes 54 `SECURITY DEFINER` functions executable by `authenticated`, **42 of them also by `anon`** (H-01).

---

## 6. Regression Check Results

| # | Prior-fix item | Result | Evidence |
|---|---|---|---|
| 1 | RLS on resource permission tables (`resource_open_actions`, `resource_default_role_grants`) | **PASS** | RLS + FORCE on both. SELECT-only policy, no INSERT/UPDATE/DELETE policy, so clients cannot write. `resource_permissions*` pgTAP suites (147 assertions) green. |
| 2 | Module gating enforced beyond UI | **FAIL (partial regression)** | 58 tables gated. Not gated: 5 feature tables added or missed since R1, 2 definer views bypass the gate, and service-role Edge Functions skip `has_module()` and tenant suspension (H-04). |
| 3 | GPA / class-rank stat cards computed from real data | **PASS** | `AcademicRecordTab.tsx` uses `fetchAcademicRecord` (GPA from grades × `grade_bands`) and `get_class_rank()` (definer, tenant + relationship checked). `class_rank.sql` 9/9. |
| 4 | Grading-scale lookup wired correctly | **PASS** | `grade_point_for()` / `grading_scales` → `grade_bands`. `grading_scales_lookup.sql` 6/6. The frontend `gradePoint(total, bands)` reads the tenant's configured bands. |
| 5 | Ge'ez-numeral settings → Arabic-numeral-only output | **FAIL** | R3-4 did the opposite of the current standard: the tenant toggle now switches **all** `<EthDate/>` output to Ge'ez (M-11). Default is `false` (Arabic), so tenants that never touched the toggle comply. |
| 6 | Bank-transfer CSV export correctness/security | **PARTIAL** | Tenant isolation **PASS**: `payroll_runs` / `payslips` RLS + `hr_employee_sensitive` (tenant + role scoped). No cross-tenant path found. Security gaps: no formula-injection neutralisation (M-05); download not audited (M-07); generated client-side; employees without an account export a blank field silently. Correctness: `net_pay` fixed to 2 dp, ETB header OK. |
| + | GRADE_TABS dynamic, past + current only (explicitly requested) | **FAIL** | Dynamic (no hard-coding), but it exposes unreached grades after an undo/correction and loses history after the 365-day purge (H-03, probe A-3). |

---

## 7. Prioritised Remediation Roadmap (no code changes made)

### P0 — Critical (before any production payment traffic; days)
1. **C-01** Keep Telebirr disabled in production (`platform_integrations` unset) until inbound signature verification plus server-side `queryOrder` confirmation ship. Randomise `merch_order_id`.

### P1 — High (next sprint)
2. **H-01** One migration: `REVOKE EXECUTE … FROM PUBLIC, anon` on all definer functions. Re-grant the minimum set. Derive the tenant internally. Pin `search_path`. Fix the shim (L-08) and add a catalog pgTAP guard.
3. **H-02** Rewrite the `documents` and `report-cards` storage SELECT policies to role/ownership scope, then add storage pgTAP suites.
4. **H-05** MFA enrollment plus an `aal2` requirement for super_admin/school_admin/accountant/hr_officer, and step-up for impersonation.
5. **H-03** Rebuild `get_student_grade_history()` on an enrollment/promotion ledger, capped at the current grade. Add undo/correction tests.
6. **H-04** Add gates to the missing tables and views. Extend `requireRole` with tenant-status + `has_module` + resource-permission checks.
7. **H-06** Fix the `payments.invoice_id` FK bug **together with** a pending/approval state for applicant-declared payments. Never ship the FK fix alone.

### P2 — Medium (within the quarter)
8. **M-06 / M-04 / M-07** Maker-checker for payments, voids and post-publication grades. Scoped, revocable, attributed impersonation. Audit triggers on identity/config tables, audited exports, longer append-only retention.
9. **M-01 / M-02 / M-03** SSO domain verification with Edge-Function-only writes. GoTrue-side lockout (auth hook) and trusted client IP. Server-side password policy.
10. **M-08 / M-09 / M-10 / M-05** Encrypt and mask national ID/bank/TIN. Magic-byte checks, AV scanning and CAPTCHA on public uploads. Tenant-check `fee_structure_id`. Shared CSV-safe writer.
11. **M-11 / M-12** Remove Ge'ez date rendering. Introduce `formatName(full|short)` and replace the ~25 call sites.
12. **M-13** Upgrade react-router-dom/vite/vitest. Pin Edge Function deps plus `deno.lock`. Add `npm audit` to CI.

### P3 — Low (backlog / hardening)
13. L-01 Tayitu/Jiret everywhere · L-02 FORCE RLS on 11 tables · L-03 CORS allow-list · L-04 sanitise the editor · L-05 no SVG in the public bucket · L-06 fixed `APP_URL` · L-07 (closed by H-01) · L-08 SAST, secret scanning, SHA-pinned actions · L-09 jsonb snake_case · L-10 refresh CLAUDE.md, ERD/DFD, OpenAPI, INSA checklist · L-11 httpOnly cookie sessions · L-12 escape filter terms.

---

## Appendix A — Reproduction probes (non-destructive)

All probes ran against a disposable local Postgres (`/tmp/pgval`, port 5433) after `supabase/tests/run.sh`, each inside `BEGIN … ROLLBACK`. Nothing touched a shared or production database.

**A-1 (H-01) — anon / cross-tenant definer RPCs**
```sql
begin;
grant usage on schema public to anon;  -- mirrors real Supabase; rolled back
-- fixtures: tenants A and B, school_admins in each, one queued export job in B
set local role anon;
select public.get_email_for_user('<tenant-B user id>');           -- → 'adm-b@x.et'
select public.create_health_alert('<tenant B>','security','critical','Your account is locked, call +251...');  -- inserted
select public.complete_job('<B job id>', 999, 'attacker/path.csv');  -- job → completed, attacker path
select public.get_config('login_max_attempts','<any uuid>');        -- → 5
reset role;
set local role authenticated; set local request.jwt.claim.sub = '<tenant-A admin>';
select public.create_export_job('<tenant B>','students');          -- → new job id in tenant B
select public.has_module('<tenant B>','hr_payroll');                -- cross-tenant oracle
rollback;
```

**A-2 (H-02) — storage over-exposure**
```sql
begin;
-- fixture: tenant A, a user with role 'student'
insert into storage.objects (bucket_id,name) values
 ('documents','<A>/staff/e1/national_id.pdf'), ('report-cards','<A>/other-student/term1.pdf');
set local role authenticated; set local request.jwt.claim.sub = '<student>';
select bucket_id, name from storage.objects;   -- both rows returned
rollback;
```

**A-3 (H-03) — GRADE_TABS future grade after undo**
```sql
begin;
-- fixture: classes G10 (grade_level 10) and G11 (11); student in G10
update public.students set class_id = '<G11>' where id = '<student>';  -- promotion
update public.students set class_id = '<G10>' where id = '<student>';  -- undo
set local role authenticated; set local request.jwt.claim.sub = '<school_admin>';
select public.get_student_grade_history('<student>');   -- → {10,11}
rollback;
```

## Appendix B — Positive controls observed (keep)

- RLS on 113/113 tables. Consistent `get_tenant_id_for_user()`, which also locks out suspended tenants. Cross-tenant pgTAP matrix.
- Column-level `REVOKE SELECT` + security-barrier views for HR and clinic data.
- Payroll SoD enforced in the DB (`payroll_run_transition`, approver ≠ preparer).
- Restrictive grade-publication gate and attendance retroactive-edit gate.
- Postgres-backed, fail-closed rate limiter.
- Zod allow-list validation on every Edge Function. Generic error bodies.
- SSRF defences (allow-list, private-IP rejection, `redirect:"manual"`, timeouts, size caps).
- Integration secrets in Supabase Vault. `.env*` git-ignored. No service-role key in `src/`.
- CSP `script-src 'self'`, `frame-ancestors 'none'`, HSTS preload, nosniff, strict referrer policy.
- `react/no-danger` lint plus an allow-list rich-text renderer.
- Currency: ETB everywhere (`formatETB`, `Intl` `currency:"ETB"`, PDF `ETB n.nn`). No `$`/USD found.
- SQL naming: 0 camelCase columns or functions. TS: 0 snake_case local variables.
