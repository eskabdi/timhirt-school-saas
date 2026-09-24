# Timhirt Audit, Report 2: INSA Compliance Assessment

> **Report 2 of 3: produced after the INSA document was supplied.**
> Baseline: the owner-supplied **"INSA Technical Development Enforcer"**, which summarises INSA's *Web Application Security Testing Requirements* §4.2.1–4.2.5 and §5 (APIs) as Phases 1–6.
> This report stands on its own and is scoped to INSA readiness. The full technical findings (C-01 … L-12) are described in **Report 1** (baseline) and **Report 3** (consolidated).

| | |
|---|---|
| **Date** | 2026-09-24 |
| **Audited commit** | `07262fc` (code); blueprint `docs/school-saas-architecture-blueprint.md` at the same commit |
| **Mode** | Investigation only. No code, config or migration was changed. |
| **Method** | Each phase requirement was checked against (a) the running schema: all 105 migrations applied to a local Postgres 16, 55/55 pgTAP suites green; (b) the 32 Edge Functions and the frontend source; (c) the claims made in the blueprint's INSA-labelled sections (§2.1, §4.1, §4.4, §7.1, §10, Appendix D, Appendix E). |
| **Caveat** | The supplied document is a summary. It does not reproduce the official INSA text or map Phases to §4.2.x clauses, so this report is keyed to its Phase numbering. Map it clause by clause to the official INSA document before formal submission. |

---

## 1. Executive Summary

**INSA readiness verdict: NOT READY for submission.**

| Phase | Result |
|---|---|
| 1. Technical Architecture & Design (DFD, Architecture, ERD) | **Partial** |
| 2. Technical Stack & Features Inventory | **Fail** |
| 3. Coding & Implementation controls | **Partial** (session management fails) |
| 4. Security Functionality Document | **Fail** |
| 5. API Security Enforcement | **Fail** |
| 6. Testing Scope Artifacts | **Partial** |

Three things block submission:

1. **The documentation set misstates the system (H-07).** The blueprint's INSA sections claim integrations and controls that don't exist in the code: Stripe, SendGrid, Upstash, Sentry, a SIEM drain, HMAC-verified webhooks, MFA, a 30 min / 12 h session policy, Dependabot + `npm audit`, pinned dependencies, and OpenAPI exports. It also lists 5 actors where the system has 10 roles plus custom roles. An assessor who tests against these documents will find the discrepancies.
2. **Phase 5 API requirements are unmet.** There is no OpenAPI spec and no sample payloads (M-14). The Telebirr webhook signature is not validated (C-01, Critical). MFA is not enforced (H-05).
3. **Phase 3 session management does not meet the literal requirement (M-15).** Tokens are in Web Storage rather than Secure/HttpOnly/SameSite cookies, and the idle timeout is 60 min, enforced client-side only (INSA calls for 15–30 min).

**New findings raised by the INSA assessment:** H-07 (High), M-14, M-15, M-16 (Medium), L-13 (Low). M-08 was also extended with the audit-log redaction gap. M-15 replaces baseline L-11.

---

## 2. Phase-by-Phase Scorecard

| Phase / requirement | Rating | Evidence and gap |
|---|---|---|
| **1.1 DFD** (Level 0, Level 1–2; sensitive flows flagged) | Partial | Blueprint §4.4 has Mermaid L0/L1 with 🔒 PII/financial markers. **But** it shows Stripe and SendGrid rather than Telebirr, bank-URL verification, SMS gateways or SAML IdPs. There is no L2 for payments, admissions, payroll or impersonation. The public anonymous flows (admission, upload, verify-id, telebirr-notify) are missing (H-07). |
| **1.2 System architecture** (deployment, components, DMZ / TLS / WAF / IDS-IPS) | Partial | Blueprint §4.1 diagram and TLS 1.2+/HSTS are real (`vercel.json`). The claim that "gateway + Vercel edge act as WAF" is not backed by any firewall rule set, and nothing in the repo shows IDS/IPS or SIEM (M-16). The component list names Upstash and Sentry, which are not used (H-07). |
| **1.3 ERD** (PK/FK; sensitive fields marked; AES-256 or strong hashing enforced) | Partial | Blueprint §7.1 and §18.2 ERDs exist but predate about 60 migrations (library rebuild, invoice headers, SSO, impersonation, document templates…). Passwords are bcrypt (GoTrue) ✓. Sensitive fields (`national_id`, `bank_account`, `tin_number`, guardian phone, medical data) are **not** column-encrypted, only disk-encrypted (M-08). |
| **2 Stack and features inventory** | **Fail** | Blueprint Appendix E lists Stripe, SendGrid/Courier, Upstash, Sentry, shadcn/ui, TanStack Table, Recharts and date-fns. None of these are dependencies. It omits Telebirr, pdf-lib/fontkit, i18next/ICU, SMSala/AfroMessage/GeezSMS and SAML SSO. It lists **5 actors; the `user_role` enum has 10** (`hr_officer, accountant, registrar, librarian, pending` are missing), and the custom-role/resource-permission system is not described. WAF/IDS/SIEM entries are unevidenced (H-07, M-16). |
| **3 SQL injection prevention** | Pass | PostgREST + typed RPC parameters. Migration dynamic SQL uses `format('%I')` only. The `.or()` filter interpolation is filter-level only (L-12). |
| **3 XSS prevention** | Pass (residual) | `react/no-danger`, allow-list `RichText`, CSP `script-src 'self'`. Editor `innerHTML` (L-04). SVG in the public bucket (L-05). |
| **3 CSRF protection** | Pass (by design) | There are no auth cookies: every state change carries `Authorization: Bearer`, which a browser will not attach cross-site. This is justified in Blueprint §10.3. It is a documented deviation from the literal "CSRF token" wording; record it as an accepted equivalent control for the assessor. |
| **3 Session management** (Secure/HttpOnly/SameSite cookies; 15–30 min idle timeout) | **Fail** | Tokens live in `localStorage`/`sessionStorage`, not flagged cookies. The idle timeout defaults to **60 min** (`system_config.session_timeout_minutes`), is enforced only client-side (`useIdleLogout.ts`), and can be set to any value. There is no absolute session cap. Blueprint §10.3 claims 30 min / 12 h (M-15). |
| **3 Input validation** (allow-list) | Pass (residual) | Zod on every Edge Function and DB CHECK constraints. The MIME type is trusted on the public upload (M-09). |
| **3 Error handling** (generic to client, detail logged server-side) | Pass | `_shared/security.ts` `errors.*`; `console.error` with a message only. |
| **3 Secure file uploads** (type allow-list, scanning, outside web root, random names) | Partial | Bucket MIME/size limits and private buckets ✓. Random names on most paths, but staff registration docs use a deterministic `{docType}.{ext}`. **No malware scanning** and no magic-byte check (M-09). Storage read policies are over-broad (H-02). |
| **4 Security Functionality Document** | **Fail** | Blueprint §10 exists but contains untrue statements: webhooks HMAC-verified (C-01), 30 min / 12 h session (M-15), MFA, SIEM, "Dependabot + npm audit in CI", "Edge Function deps pinned" (M-13). It doesn't document custom roles/resource permissions, module gating, impersonation, SSO or storage policies. Logging: the `audit_trigger` redaction list is correct for phone/email/salary/medical but misses `national_id`, `date_of_birth` and address fields (M-08). |
| **5 Request/response samples** | **Fail** | None exist for the 32 Edge Functions (M-14). |
| **5 OpenAPI/Swagger** | **Fail** | No spec in the repo, although the blueprint's closing line references "OpenAPI exports" (M-14). |
| **5 Authentication** (OAuth/JWT with exp+iat, RS256; refresh tokens) | Partial / unverified | GoTrue JWT with a 3600 s `exp`, `iat` and rotating refresh with reuse detection ✓. The **RS256/ES256 claim cannot be verified from the repo**: `config.toml` has no signing-key configuration, and Supabase projects default to HS256 unless migrated to asymmetric keys. Check it in the dashboard. No MFA (H-05). |
| **5 Endpoint categorisation** | Pass | Every Edge Function header comment carries `[INSA category: PUBLIC/PRIVATE/INTERNAL]`, and §5 of this report inventories them. PostgREST/RPC routes are not categorised (the definer RPCs in H-01 are effectively Public). |
| **5 Third-party integration logic** (keys in env/vault; webhook signatures validated) | **Fail** | Keys in Vault ✓ (`manage-integration-credentials`). The **Telebirr webhook signature is not validated** (C-01), and `telebirr-query-order` responses aren't verified either. |
| **5 Authorization middleware** (least privilege before processing) | Partial | `requireRole()` runs on every private function. It ignores tenant suspension, module entitlement and the resource-permission matrix (H-04). |
| **6 Testing scope and staging accounts** | Partial | Blueprint Appendix D and `supabase/seed.sql` define assets and audit accounts (A/B tenants, cross-tenant tester) ✓. **But** the seed's production guard **fails open**: it refuses only when `app.environment = 'production'` and seeds when the setting is unset. The blueprint says it "asserts env = staging". Registrar and librarian accounts are missing. The asset table still uses `schoolsaas.example` placeholders (L-13). |

---

## 3. Blueprint Claims vs Implementation

The blueprint calls itself "the INSA-ready technical documentation set". Each INSA-relevant claim was checked against the code:

| Blueprint claim (section) | What the code actually does | Status |
|---|---|---|
| Payments via **Stripe**, webhook "signature verified" (§4.1, §4.4, §10.3, App. E) | Telebirr is the only gateway (Stripe/Chapa cancelled). `telebirr-notify` has **no signature verification** | ✗ False (C-01) |
| Email/SMS via **SendGrid/Courier** (§4.1, §4.4, App. E) | SMS via SMSala / AfroMessage / GeezSMS adapters (`_shared/sms.ts`) | ✗ Outdated |
| **Upstash Redis** rate limiting (§4.1, App. E) | Postgres `consume_rate_limit()` RPC, fail-closed | ✗ Outdated (the control is real) |
| **Sentry** alerting, **Logflare/Datadog SIEM** drain (§4.1, App. E) | No Sentry dependency, no log-drain configuration | ✗ Not implemented (M-16) |
| "Gateway + Vercel edge act as **WAF**"; IDS/IPS (§4.1) | Only headers in `vercel.json`; no firewall rules | ✗ Unevidenced (M-16) |
| **MFA** (§4.1, §10, App. D "MFA enrollment codes") | TOTP enabled in `config.toml`; no enrollment UI, no `aal2` enforcement | ✗ Not enforced (H-05) |
| Inactivity timeout **30 min**, absolute cap **12 h** (§10.3) | Default **60 min**, client-side only, adjustable; no absolute cap | ✗ False (M-15) |
| JWT **RS256/ES256** (§4.1, §8) | Not configured in repo; Supabase default is HS256 unless migrated | ? Unverified (check dashboard) |
| "Dependabot + `npm audit` in CI; Edge Function deps **pinned**" (App. E) | No `dependabot.yml`, no audit step; imports float (`@2`, `@3`, `@1`) | ✗ False (M-13) |
| **OpenAPI exports** referenced as part of the documentation set (closing line) | No OpenAPI/Swagger file anywhere | ✗ Missing (M-14) |
| Actor inventory: **5 roles** (§2.1, App. E) | `user_role` enum has **10**: + hr_officer, accountant, registrar, librarian, pending; plus tenant custom roles | ✗ Incomplete |
| Frontend libs: shadcn/ui, TanStack Table, Recharts, date-fns (App. E) | None in `package.json`; pdf-lib, fontkit, i18next/ICU used but not listed | ✗ Inaccurate |
| Files: "randomized names" (§10.2) | Most paths random; staff registration docs use deterministic `{docType}.{ext}` | ◐ Partial |
| Audit trigger redacts PII (§10.6) | Redacts phone/email/salary/medical; **not** national_id, DOB, address | ◐ Partial (M-08) |
| Staging seed "asserts env = staging" (App. D) | Refuses only if `app.environment = 'production'`; runs when unset | ✗ Fails open (L-13) |
| TLS 1.2+, HSTS preload, CSP, nosniff (§10.4–10.5) | Present in `vercel.json` | ✓ True |
| Bearer tokens, not cookies, so CSRF is N/A (§10.3) | True: all calls use the `Authorization` header | ✓ True (document as an equivalent control) |
| Generic client errors (§3, §10) | `_shared/security.ts` `errors.*` | ✓ True |
| Endpoint categorisation Public/Private/Internal | Every Edge Function header has an `[INSA category: …]` tag | ✓ True |

---

## 4. INSA-Specific Findings

These findings were raised by the INSA assessment. Full detail uses the same format as Reports 1 and 3.

| ID | Title | Severity | Category | File(s):Line(s) | Description | Evidence | Recommended Remediation |
|---|---|---|---|---|---|---|---|
| H-07 | INSA documentation set misstates implemented controls | **High** (compliance) | INSA Phases 1, 2, 4 · ISO A.5.37, A.5.36 · A04 | `docs/school-saas-architecture-blueprint.md` §2.1 (actors), §4.1 (architecture), §4.4 (DFD), §10 (Security Functionality Document), Appendix D, Appendix E, closing line | The blueprint is labelled as the INSA-ready documentation set, and much of it describes a different system. It lists **Stripe** (canceled; Telebirr is the only gateway), **SendGrid/Courier** (SMS goes via SMSala/AfroMessage/GeezSMS), **Upstash** (the limiter is Postgres `consume_rate_limit`), **Sentry**, a **Logflare/Datadog SIEM drain**, and shadcn/ui, TanStack Table, Recharts and date-fns (none of these are dependencies). It lists 5 actors; there are 10 roles plus custom roles. It claims "webhooks … valid HMAC signature" (false: C-01), "Inactivity timeout 30 min; absolute cap 12 h" (false: M-15), MFA (not enforced: H-05), "Dependabot + `npm audit` in CI; Edge Function deps pinned" (false: M-13) and "OpenAPI exports" (none: M-14). An assessor who tests against these documents will find the discrepancies, which undermines the whole submission. | `grep` for each named product in `package.json`, `src`, `supabase/functions`; `pg_enum` for `user_role`; `.github/` has no `dependabot.yml` | Rewrite the INSA set from the code: regenerate DFD L0/L1/L2 (payments, admissions, payroll, SSO, impersonation), the architecture diagram, ERD (from the live schema), the Actor Inventory (10 roles + custom roles + resource-permission matrix) and Appendix E (from `package.json` + Edge imports). Rewrite §10 so it states only what is implemented, with residual risks listed. Treat blueprint accuracy as a release gate. |
| M-14 | No OpenAPI specification or request/response samples | Medium | INSA Phase 5 · ISO A.5.37 | `supabase/functions/*` (32 functions); no `openapi*`/`swagger*` file in the repo | INSA Phase 5 requires an OpenAPI/Swagger spec that describes endpoints, headers and error codes, plus sample 200/400/401 payloads. There is neither. The only inventory is §5 of this report. The PostgREST surface (113 tables, 54 RPCs) is also undocumented. | `find . -iname '*openapi*'` → nothing | Hand-author `docs/api/openapi.yaml` for the Edge Functions (the Zod schemas map directly to request bodies; `errors.*` gives the 400/401/403/429/500 bodies). Include example payloads. Publish the PostgREST OpenAPI (`/rest/v1/` root) for the RPCs that remain after H-01. Add a CI check that every function directory has a spec entry. |
| M-15 | Session management deviates from INSA Phase 3 (formerly L-11) | Medium | INSA Phase 3 · A07 · ISO A.8.5 | supabase-js default `localStorage`; `src/features/platform/impersonation.ts:48` (super_admin session in `sessionStorage`); `src/features/auth/useIdleLogout.ts`; `system_config.session_timeout_minutes` = 60; `supabase/config.toml` (no `[auth.sessions] timebox/inactivity_timeout`) | INSA calls for session cookies with Secure/HttpOnly/SameSite and an explicit 15–30 min idle timeout. Here tokens are in Web Storage (readable by any XSS), the idle timeout is 60 min by default, is enforced only by the browser, and can be set to any value. There is no server-side inactivity or absolute timeout. | Config and code read | Set GoTrue `[auth.sessions] inactivity_timeout = "30m"` and `timebox = "12h"` (and in the hosted dashboard). Cap `session_timeout_minutes` at 30 via a CHECK. Consider `@supabase/ssr` with an HttpOnly cookie. Otherwise, record Bearer-in-storage + strict CSP as a formally accepted deviation. Never persist the super_admin's refresh token during impersonation. |
| M-16 | Claimed security infrastructure (WAF, IDS/IPS, SIEM) not evidenced | Medium | INSA Phases 1.2, 2 · A09 · ISO A.8.16, A.8.20 | Blueprint §4.1 ("gateway + Vercel edge act as WAF"), Appendix E ("Logflare/Datadog SIEM drain, Sentry alerting"); `vercel.json` (headers only); no firewall, log-drain or alerting config in the repo | Vercel's platform DDoS mitigation and the Supabase API gateway are not a configured WAF rule set. Nothing shows IDS/IPS, a log drain to a SIEM, or alerting on auth failures, rate-limit trips, RLS denials or the `telebirr-notify` warnings. INSA Phase 1.2 expects these layers to be explicit. | Repo read | Enable the Vercel Firewall (managed OWASP rules + rate limits) or put Cloudflare WAF in front. Configure a Supabase log drain to a SIEM (e.g. Datadog, or an ELK stack hosted in Ethiopia if data residency applies) with alert rules. Document the real layers in the architecture diagram. |
| L-13 | Staging seed guard fails open; testing scope incomplete | Low | INSA Phase 6 · ISO A.8.31 | `supabase/seed.sql:6-11`; Blueprint Appendix D | The guard raises only when `current_setting('app.environment') = 'production'`. If the setting is unset (the default) it proceeds, so audit accounts with known placeholder passwords could be seeded into production by mistake. The blueprint says it "asserts env = staging". The account list lacks registrar and librarian, and the asset URLs are `schoolsaas.example` placeholders. | Code read | Invert the guard: `if coalesce(current_setting('app.environment', true), '') <> 'staging' then raise exception`. Add registrar, librarian and pending-SSO audit accounts. Fill in the real staging asset URLs. |

**Extended baseline finding (INSA Phase 1.3 / Phase 4):**

| ID | Title | Severity | Category | File(s):Line(s) | Description | Evidence | Recommended Remediation |
|---|---|---|---|---|---|---|---|
| M-08 | Sensitive PII stored in plaintext; column-level controls incomplete | Medium | A02 · ISO A.8.24, A.5.34 | `employees` column grants (`national_id`, `date_of_birth`, `personal_email` granted to `authenticated`); `hr_employee_sensitive` (bank_account, TIN, pension_no) | National ID, bank account, TIN and guardian contacts are plaintext columns. Any role with `employees:read` (e.g. accountant) sees national ID and DOB. Only disk-level encryption at rest applies. `audit_trigger` redacts phone, email, salary and medical fields but **not** `national_id`, `date_of_birth` or address fields. Because `employees`, `students` and `guardians` are audited, national IDs are copied into `audit_logs` in cleartext. INSA Phase 1.3 requires AES-256 for sensitive fields. | `information_schema.column_privileges` | Move `national_id` into the sensitive view. Encrypt bank_account/TIN/national_id with Vault/pgsodium (TCE) and decrypt only in the view. Mask by default (last 4 digits). Write a data-classification register (§6 of this report can seed it). |

---

## 5. All Findings Mapped to INSA Phases

Every finding from the full audit, mapped to the INSA requirement it breaches. Rows marked "Project standard" are owner-mandated conventions, not INSA clauses.

| ID | Severity | Title | INSA phase / requirement |
|---|---|---|---|
| C-01 | Critical | Unauthenticated, unsigned Telebirr payment webhook settles invoices | P5 Third-party integration (webhook signature); P4 Security Functionality Doc (false HMAC claim) |
| H-01 | High | `SECURITY DEFINER` RPCs executable by `anon` with no auth or tenant checks | P5 Authorization enforcement; P3 Access control |
| H-02 | High | Storage `documents` and `report-cards` buckets readable and listable by every tenant member | P3 Secure file uploads; P5 Authorization enforcement |
| H-03 | High | GRADE_TABS shows unreached ("future") grades; history truncated after 1 year | P3 Business-logic integrity (secure implementation) |
| H-04 | High | Module gating and tenant suspension not enforced end-to-end (prior-fix regression) | P5 Authorization middleware (least privilege) |
| H-05 | High | MFA not enforced for any role, including super_admin | P5 Authentication mechanism; P3 Session management |
| H-06 | High | Applicant-declared payment converted into a `succeeded` payment at enrollment (latent), and admission receipts broken | P3 Input validation / business logic |
| H-07 | High | INSA documentation set misstates implemented controls | P1 DFD & Architecture; P2 Stack & Features Inventory; P4 Security Functionality Doc |
| M-01 | Medium | SSO domain claimed without ownership verification; direct table write bypasses Edge Function | P5 Authentication mechanism (SSO) |
| M-02 | Medium | Login brute-force lockout is advisory only | P5 Authentication (brute-force / rate limiting) |
| M-03 | Medium | Password policy enforced only in the browser | P5 Authentication (password policy) |
| M-04 | Medium | Impersonation is unscoped, unrevoked and misattributed | P3 Session management; P4 Logging |
| M-05 | Medium | CSV / formula injection in exports and the bank-transfer file | P3 Input validation / output encoding |
| M-06 | Medium | No maker-checker (dual control) on financial and academic changes | P4 Access control (RBAC, segregation of duties) |
| M-07 | Medium | Audit trail gaps and weak retention | P4 Logging |
| M-08 | Medium | Sensitive PII stored in plaintext; column-level controls incomplete | P1.3 ERD (sensitive-field encryption); P4 Logging (PII in logs) |
| M-09 | Medium | Public uploads trust the client MIME type; no malware scan; no CAPTCHA | P3 Secure file uploads |
| M-10 | Medium | Cross-tenant IDOR on `fee_structure_id` in `enroll-finalize-billing` | P5 Authorization enforcement |
| M-11 | Medium | Ge'ez numerals can still be enabled for date output | Project standard (Arabic numerals); not an INSA clause |
| M-12 | Medium | Ethiopian name format not respected (First + Last instead of First + Middle [+ Last]) | Project standard (Ethiopian names); not an INSA clause |
| M-13 | Medium | Vulnerable and unpinned components | P2 Libraries/Plugins inventory; P5 Third-party integration |
| M-14 | Medium | No OpenAPI specification or request/response samples | P5 API documentation & request/response files |
| M-15 | Medium | Session management deviates from INSA Phase 3 (formerly L-11) | P3 Session management |
| M-16 | Medium | Claimed security infrastructure (WAF, IDS/IPS, SIEM) not evidenced | P1.2 Security layers (WAF/IDS-IPS); P2 Security infrastructure |
| L-01 | Low | Amharic typography not on the Tayitu (primary) / Jiret (secondary) standard | Project standard (Tayitu/Jiret); not an INSA clause |
| L-02 | Low | `FORCE ROW LEVEL SECURITY` missing on 11 tables | P5 Authorization (defence in depth) |
| L-03 | Low | CORS `Access-Control-Allow-Origin: *` on every Edge Function | P5 / P3 (cross-origin policy) |
| L-04 | Low | `RichTextEditor` assigns stored HTML to `innerHTML` | P3 XSS prevention |
| L-05 | Low | Public `branding` bucket accepts `image/svg+xml` | P3 XSS / secure file uploads |
| L-06 | Low | Payment redirect URL built from the request `Origin` header | P3 Input validation |
| L-07 | Low | Cross-tenant oracles | P5 Authorization enforcement |
| L-08 | Low | Test harness and CI blind spots | P6 Testing scope |
| L-09 | Low | Naming-convention drift in stored JSON | Project standard (naming conventions); not an INSA clause |
| L-10 | Low | Repository documentation drift | P4 Documentation accuracy |
| L-12 | Low | PostgREST filter-string interpolation | P3 SQL/filter injection prevention |
| L-13 | Low | Staging seed guard fails open; testing scope incomplete | P6 Testing scope & staging accounts |

**By phase:**

| Phase | Findings |
|---|---|
| P1 Architecture / DFD / ERD | H-07, M-08, M-16 |
| P2 Stack & Features Inventory | H-07, M-13, M-16 |
| P3 Coding & Implementation | H-01, H-02, H-03, H-05, H-06, M-04, M-05, M-09, M-15, L-03, L-04, L-05, L-06, L-12 |
| P4 Security Functionality Document | C-01, H-07, M-04, M-06, M-07, M-08, L-10 |
| P5 API Security | C-01, H-01, H-02, H-04, H-05, M-01, M-02, M-03, M-10, M-13, M-14, L-02, L-03, L-07 |
| P6 Testing Scope | L-08, L-13 |

---

## 6. INSA Remediation Roadmap (no code changes made)

Order matters. Rewrite the documents **after** the controls they describe are fixed; otherwise they have to be written twice.

**Step 1: Close the blocking technical findings (P5 / P3)**
1. **C-01** Telebirr: inbound signature verification plus server-side `queryOrder` confirmation. Keep the gateway disabled in production until then.
2. **H-01, H-02, H-04, M-10** Authorization: revoke anon/PUBLIC execute on definer RPCs; role/ownership-scoped storage policies; `requireRole` checks tenant status, module and resource permission; tenant-check `fee_structure_id`.
3. **H-05** MFA enrollment plus `aal2` for privileged roles.
4. **M-15** GoTrue `[auth.sessions] inactivity_timeout = "30m"`, `timebox = "12h"`; cap `session_timeout_minutes` ≤ 30. Either move to HttpOnly-cookie sessions or record Bearer-in-storage + CSP as a formally accepted deviation.
5. **M-09** Magic-byte checks, malware scanning and CAPTCHA on public uploads.

**Step 2: Supply the missing INSA artefacts (P5 / P1.2)**
6. **M-14** `docs/api/openapi.yaml` for all 32 Edge Functions, with 200/400/401/403/429/500 sample payloads (derived from the Zod schemas and `errors.*`), plus the PostgREST/RPC surface.
7. **M-16** Vercel Firewall (managed OWASP rules) or Cloudflare WAF; Supabase log drain to a SIEM with alert rules.
8. **M-13** Dependabot, `npm audit` in CI, pinned Edge Function imports + `deno.lock`.
9. **L-13** Fail-closed staging seed guard; complete audit-account set; real staging URLs.

**Step 3: Rewrite the documentation set from the code (P1 / P2 / P4)**
10. **H-07** Regenerate: DFD L0/L1/L2 (payments, admissions, payroll, SSO, impersonation, public endpoints); architecture diagram showing the real security layers; ERD from the live schema with sensitive fields marked; Actor Inventory (10 roles + custom roles + resource-permission matrix); Stack Inventory from `package.json` + Edge imports; Security Functionality Document that states only what is implemented, with a residual-risk register (including the CSRF-equivalent control and any accepted deviations).
11. Map the final set clause by clause to the official INSA §4.2.1–4.2.5 / §5 text.
