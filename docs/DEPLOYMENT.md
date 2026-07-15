# Deployment Guide

## 1. Prerequisites
- Node 20+, npm
- Supabase CLI (`npm install -g supabase`)
- A Supabase project (staging + production recommended, §12.1)
- Vercel account (or any static host that can apply `vercel.json` headers)
- Chapa merchant account (ETB payments) + webhook secret — **not required before
  first deploy**; configure it afterward via `/platform/integrations` as
  super_admin, or via `supabase secrets set` below. `process-fee-payment`
  returns a clear "not configured yet" error rather than failing until either
  path is set up.
- Stripe account (optional, international-curriculum schools)

## 2. Database & Edge Functions

Migration `011` runs `create extension if not exists supabase_vault;`. Vault
ships enabled by default on current Supabase projects; on an older project,
enable it first via **Database → Extensions → supabase_vault** in the
dashboard (or `create extension supabase_vault cascade;` if you have
sufficient privileges), or `supabase db push` will fail on that migration.

```bash
supabase login
supabase link --project-ref <your-project-ref>

# Apply all 11 migrations (core -> academic -> attendance/fees -> HR/payroll ->
# RLS -> storage -> extended modules -> extended RLS -> extended storage ->
# security hardening -> integration credentials)
supabase db push

# Secrets for Edge Functions (never commit these). OPTIONAL as of migration
# 011: Chapa/Telebirr/Stripe/SMS credentials can instead be entered by
# super_admin at /platform/integrations, stored encrypted in Supabase Vault —
# Edge Functions check Vault first and fall back to these env vars. Set these
# only if you prefer infra-managed (CLI-driven) credential rotation.
supabase secrets set CHAPA_SECRET_KEY=sk_live_xxx
supabase secrets set CHAPA_WEBHOOK_SECRET=whsec_xxx
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx        # optional
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx      # optional

# Deploy all Edge Functions
supabase functions deploy run-payroll
supabase functions deploy process-fee-payment
supabase functions deploy chapa-webhook --no-verify-jwt
supabase functions deploy onboard-tenant
supabase functions deploy generate-payslip-pdf
supabase functions deploy submit-admission --no-verify-jwt
supabase functions deploy verify-id --no-verify-jwt
supabase functions deploy manage-integration-credentials
```

## 3. Bootstrap the first super_admin (do this before anything else)

`onboard-tenant` is the intended way to create a school (tenant) plus its
first `school_admin` — but it can only be **called by** an existing
super_admin, and a fresh database has none. Signing up or creating a user
through Supabase Auth alone is not enough: `auth.users` and `public.users`
are separate tables, and every RLS policy and every page in this app reads
`public.users.role`/`tenant_id`, not `auth.users`. A user with an Auth
account but no matching `public.users` row can log in successfully but sees
"—" on every stat and a blank name — nothing in the app works for them,
because `profile` resolves to `null`.

1. Create a user the normal way: sign up through `/login`'s flow, or add one
   via Supabase Studio → Authentication → Users → **Add user**.
2. Copy that user's UUID from the same screen.
3. In Studio → SQL Editor, run:

```sql
insert into public.users (id, tenant_id, role, full_name, email)
values ('<uuid-from-step-2>', null, 'super_admin', 'Your Name', 'you@example.com');
```

`tenant_id` must be `null` for `super_admin` (enforced by the
`tenant_required_unless_super` check constraint — §5.2). From here, sign in
as that user and either call `onboard-tenant` (creates a tenant + its
`school_admin` in one transaction, the intended path for every *subsequent*
school) or insert a `tenants` row and a `school_admin` `public.users` row
directly the same way, if you'd rather manage the first school by hand.

This is a one-time bootstrap per Supabase project — after the first
super_admin exists, everyone else onboards through the normal `onboard-tenant`
flow or an invite, never through raw SQL.

## 4. Seed statutory data & first tenant

`tax_brackets` and `pension_rates` are seeded by migration `004_hr_payroll.sql`
with the Federal Income Tax Proclamation No. 979/2016, Article 11, **as
amended by Proclamation No. 1395/2017 E.C. (=1395/2025 G.C.)**, plus the
Proclamation 715/2011 pension rates (7% employee / 11% employer, unaffected
by the 2025 amendment). **Verified 2026-07-15** by fetching the official
gazette directly (Ministry of Finance copy, mofed.gov.et) — every bracket
rate and boundary matches Article 11's table exactly, and every
`deduction_amount` was independently re-derived from those rates via
cumulative marginal-tax arithmetic rather than trusted from a prior source;
all six matched the seeded figures exactly. Full citation and derivation are
in migration `004`'s comment block.

One caveat remains: the amendment sets three different commencement dates
for different provisions, and the specific clause covering Article 11 (the
"all other provisions" bucket) was OCR-corrupted in the fetched PDF.
`effective_from` is seeded as `2025-07-08`, matching the clearly-legible date
set for the Alternative Minimum Tax clause in the same effective-date
article — the most likely reading given the clause structure, but **do one
final visual (non-OCR) check of that specific date against the gazette PDF
before go-live**. If it turns out to differ, insert a **new
`effective_from` row set** rather than editing the seeded rows, so any
payslip already generated under the current assumption stays reproducible.
See the worksheet below for hand-checked sample calculations.

Provision the first tenant via the `onboard-tenant` Edge Function (super_admin
JWT required) rather than direct SQL, so the invited admin, default config, and
current EC academic year are created consistently.

### Statutory verification worksheet (Proclamation No. 979/2016 Art. 11, as amended by 1395/2025)

Hand-computed against the seeded brackets; pension 7% employee / 11% employer
on basic salary only (§18.3, LOW fix). `income_tax = taxable × rate − deduction`.

| Basic (ETB) | Bracket | Income tax | Pension EE (7%) | Net = gross − tax − EE |
|---|---|---|---|---|
| 2,000.00 | 0–2000 @0% | 2000×0 − 0 = **0.00** | 140.00 | 1,860.00 |
| 2,000.01 | 2000.01–4000 @15% −300 | 300.0015 − 300 ≈ **0.00** | 140.00 | 1,860.01 |
| 5,000.00 | 4000.01–7000 @20% −500 | 1000 − 500 = **500.00** | 350.00 | **4,150.00** |
| 12,000.00 | 10000.01–14000 @30% −1350 | 3600 − 1350 = **2,250.00** | 840.00 | **8,910.00** |
| 20,000.00 | >14000 @35% −2050 | 7000 − 2050 = **4,950.00** | 1,400.00 | **13,650.00** |

Boundaries are continuous (e.g. tax at 4,000.00 = 300.00; at 4,000.01 ≈
300.002, rounding to the same cent) and every bracket transition was checked
the same way before this schedule was seeded.

**Source:** Federal Negarit Gazette, Income Tax (Amendment) Proclamation No.
1395/2017 E.C., Article 7 (amending Article 11 of Proclamation No. 979/2016).
Retrieved 2026-07-15 from the Ministry of Finance
(`income_tax_amendment_proc_no_1395-2017_compressed.pdf`, mofed.gov.et — the
Ministry of Justice's copy at justice.gov.et returned a bot-verification
challenge and was not accessible). The rates and bracket boundaries were read
directly from Article 11's table; `deduction_amount` values were independently
re-derived from those rates rather than read from the document, since the
gazette states marginal rates only and does not publish a deduction-shortcut
column — see `src/__tests__/payroll-math.test.ts` for the same math
property-tested in code.

## 5. Frontend

```bash
cp .env.example .env
# fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from the Supabase dashboard
npm ci
npm run build       # outputs dist/
npm run gen:types   # regenerate src/lib/database.types.ts after schema changes
```

Deploy `dist/` to Vercel (or similar). `vercel.json` ships the standard
security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy,
Permissions-Policy) that both 1321/2024's security-measures requirement and
general best practice call for — keep them if you switch hosts.

## 6. Staging test accounts (Appendix D)

`supabase/seed.sql` refuses to run unless `app.environment = staging`. Create
the audit accounts listed in the blueprint Appendix D via
`supabase auth admin` or the Studio, then insert matching `public.users` rows
with the roles under test (super_admin, school_admin ×2 tenants, hr_officer,
accountant, teacher, parent, student) to exercise the RLS cross-tenant matrix.

## 7. Post-deploy checklist

See `README.md` → "Pre-go-live checklist" for the full compliance/statutory sign-off list.
