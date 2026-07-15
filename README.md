# Timhirt — Ethiopian School Management SaaS

A production-ready, multi-tenant School Management System for Ethiopian
educational institutions. Built to the project's v1.0/v2.0 architecture
blueprint: React 18 + TypeScript + Vite + Tailwind + shadcn-style primitives +
TanStack Query on the frontend; Supabase (Postgres + PostgREST + Auth + Edge
Functions + Storage) on the backend, with **no custom API server** — Row Level
Security is the sole authorization layer. Security controls are built into
every migration, policy, and Edge Function to satisfy Ethiopia's Personal
Data Protection Proclamation No. 1321/2024 (the actual binding law for a
system processing student/guardian/staff PII) and general OWASP/NIST/ISO
27001 practice; alignment with INSA's Web Application Security Testing
Requirements is carried as an optional, not asserted-mandatory, extra —
see blueprint §21.9 for the reasoning.

## What's inside

| Area | Highlights |
|---|---|
| **Multi-tenancy** | Shared schema + fail-closed RLS; every table `tenant_id`-scoped; `FORCE ROW LEVEL SECURITY`; explicit super_admin policy clause |
| **Ethiopian calendar** | `lib/ethiopian-date.ts` — pure Beyene–Kudlek EC↔GC facade (zero runtime deps), `<EthDatePicker/>` 13-month grid, Geez numerals, holiday-aware attendance blocking. **Gregorian is canonical storage; EC is presentation-only.** |
| **Trilingual i18n** | `react-i18next` + ICU; English / Amharic (አማርኛ) / Afaan Oromoo; `jsonb` i18n columns for tenant-authored labels; `t_field()` SQL helper |
| **HR & Payroll** | Effective-dated tax brackets (Proclamation No. 1395/2025) & pension rates (Proc. 715/2011, basic-salary-only base); `run-payroll` Edge Function computes gross→tax→pension→net; segregation of duties enforced by a DB state-machine trigger (`approved_by <> prepared_by`, forward-only transitions, immutable once `paid`) |
| **Payments** | Chapa (aggregates Telebirr/CBE Birr/cards) + Stripe; server-derived amounts; atomic settlement RPC — HMAC-verified, amount-checked, and replay-protected in a single transaction; **credentials configurable by super_admin through the UI** (`/platform/integrations`, Supabase Vault-backed) — no CLI/infra access required, though `supabase secrets set` still works as a fallback |
| **18 modules** | SIS, Attendance, Timetable, Gradebook, Fees, Communication, Reporting, Library, Transport, HR & Payroll, Admissions, Assignments, Hostel, Inventory, Discipline, Clinic, ID Cards/Certificates, Events, MoE Reporting |
| **57 routes** | Admin, Teacher, Student, Parent, Public (`/apply`, rate-limited `/verify`), and Platform (`super_admin`, including self-service `/platform/integrations`) surfaces |
| **Security** | Column-level grants on 🔒 fields with HR/clinic re-exposing views for authorized roles, immutable user identity fields (`tenant_id`/`role`/`email` locked by policy + trigger), append-only redacted audit log, CSP/HSTS headers, staging test-account scaffold |

## Project layout

```
supabase/
  migrations/     14 migrations: core → academic → attendance/fees → HR/payroll
                  → RLS → storage → extended modules → extended RLS → storage
                  → security hardening → base table grants → RLS recursion fix
                  → column-level grants → integration credentials (Vault)
  functions/      run-payroll · process-fee-payment · chapa-webhook
                  onboard-tenant · invite-tenant-admin · generate-payslip-pdf
                  submit-admission · verify-id · manage-integration-credentials
                  _shared/  (security middleware + Ethiopian date engine)
  seed.sql        staging test-account scaffold (refuses to run in prod)
src/
  app/            router (57 routes), providers, root component
  components/     EthDatePicker, EthDate, DashboardShell, PlatformShell, ui primitives
  features/       one folder per module (students, hr, fees, admissions, …)
  lib/            ethiopian-date.ts facade, i18n.ts, supabase.ts, queryKeys.ts
  locales/        en / am / om — common.json + calendar.json
  __tests__/      Ethiopian calendar edge-case unit tests (§17.8 checklist)
docs/
  DEPLOYMENT.md   Step-by-step deploy guide
```

## Quick start (local)

```bash
npm install
cp .env.example .env          # fill in your Supabase project URL/anon key
supabase start                # local Postgres + Auth + Storage (Docker)
supabase db push               # apply all 14 migrations
npm run dev                    # http://localhost:5173
```

Run the Ethiopian calendar test suite:

```bash
npm run test
```

Type-check and build:

```bash
npx tsc --noEmit
npm run build
```

## Deploying to production

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full runbook —
migrations, Edge Function secrets, tenant onboarding, and the `vercel.json`
security headers. **If you've deployed and a logged-in user sees "—" on
every stat and no name in the header, you've hit the first-super_admin
chicken-and-egg gap — see DEPLOYMENT.md §3, "Bootstrap the first
super_admin," for the one-time SQL fix.**

## Security review status (v2.1)

This build closes every finding from the staff-level pre-production security
review: **C1** (cross-tenant takeover via self-service `tenant_id` update),
**C2/C3** (payroll segregation-of-duties bypass + paid-run reversal), **H1**
(migration `008` wouldn't deploy — `notification_templates` had no
`tenant_id`), **H2** (unrate-limited, enumerable public ID verification),
**H3/H4** (non-atomic webhook settlement, no amount check), **M1** (column
grants with no re-exposing view broke legitimate HR/clinic reads), **M2**
(clinic PII leaking into the audit log), **M3** (submission storage let any
tenant user read/overwrite peers' files), **M4** (manual payments could skip
invoice sync), **M5** (three divergent EC-year computations), plus the LOW
batch (pension base, rate-limiter durability note, EC-facade lint rule,
`payslip_lines` RLS, payslip audit trigger). See
`supabase/migrations/20260713000010_security_hardening.sql` for the
consolidated fix and `supabase/tests/` for the regression tests that guard
each one.

## Pre-go-live checklist

- [x] ~~Confirm the exact gazetted commencement date for Proclamation No. 1395/2025~~ **Verified 2026-07-15** against the official gazette (Federal Negarit Gazette, Proclamation No. 1395/2017 E.C., via mofed.gov.et) — all bracket rates and deduction amounts match exactly, independently re-derived and cross-checked. `effective_from` updated to `2025-07-08` in migration `004`, the date confirmed for the Alternative Minimum Tax clause; Article 11 (Employment Income Tax Rates) falls under the same amendment's general "all other provisions" effective-date clause, whose exact date was OCR-corrupted in the fetched PDF — **recommend one final visual (non-OCR) check of that specific clause** before go-live, everything else about this schedule is fully verified. See the citation in migration `004`'s comment block and the worksheet in `docs/DEPLOYMENT.md`.
- [ ] Confirm pension rates (7% employee / 11% employer on **basic salary only**, Proc. 715/2011)
- [ ] Self-host Noto Sans Ethiopic (don't depend on a font CDN in production)
- [ ] Verify the Chapa webhook signature scheme against Chapa's current docs (header name; raw-body vs. secret-hash signing) — flagged `UNVERIFIED` in `chapa-webhook/index.ts`
- [ ] Shadow at least one payroll run against the worksheet in `docs/DEPLOYMENT.md`
- [ ] Have Amharic/Afaan Oromoo strings reviewed by an education-domain speaker
- [ ] Confirm every staff `auth.users` row has a linked `employees.user_id` (required for payroll/leave self-service)
- [ ] Run the RLS cross-tenant matrix (`supabase/tests/rls/cross_tenant_matrix.sql`) using the Appendix D staging accounts — Tenant A vs Tenant B must return zero rows for `students`, `payslips`, `fee_invoices`, `employees`, including via embedded relations
- [ ] Run the payroll SoD and math regression tests (`supabase/tests/rls/payroll_sod.sql`, `npm run test` for the bracket-boundary property test)
- [ ] Back the in-memory rate limiter (`_shared/security.ts`) with a shared store (Upstash Redis or a Postgres table) before scaling beyond a single low-traffic region
- [ ] Configure Chapa/Telebirr/SMS-gateway credentials — either through `/platform/integrations` as super_admin (Vault-backed, no CLI access needed) or via `supabase secrets set` for infra-managed deployments; both are read by the Edge Functions, Vault first
- [ ] Rotate all Edge Function secrets before go-live; confirm `service_role` key is never in `.env` files committed to git

## Architecture reference

This build follows the two source blueprints included in the project:
`school-saas-architecture-blueprint.md` (v1.0, sections 1–15 + Appendices A–E)
and its v2.0 extension (sections 16–20: Internationalization, Ethiopian
Calendar Architecture, HR & Payroll, Extended Module & Page Inventory, Data
Models & Migrations).
