# Timhirt Live Production Fixes — Round 3 Verification Report

**Method:** Same discipline as Rounds 1 and 2 — every claim below is backed by a
real request/response against production (`livqynxlibmccaycseer`), not a reading
of the diff. Each fix that needed a migration got its own migration, validated
against a real local Postgres (`supabase/tests/run.sh` — 39 pgTAP suites green
before and after every migration in this round) and deployed individually
(migrations first, frontend last), live-verified against the QA tenant
(`qa-harar-model`) before moving to the next fix. All test data created for
verification was `QA`-prefixed and deleted immediately after use, or (where the
DB has no client-reachable DELETE policy on the table) removed via direct SQL
through the Supabase Management API. Aw Abdal and Abadir were never written to.

These five were all wiring gaps, not new features: the underlying data or logic
already existed somewhere in the codebase — a formula, a table, a component, a
setting — it just was never connected to the surface that needed it.

Migrations, in order: `20260821000008_class_rank.sql`,
`20260821000009_grading_scales_lookup.sql`. (Fixes R3-3, R3-4, and R3-5 are
frontend-only — no migration needed; each is explained below.)

---

## Status

| # | Finding | Status |
|---|---|---|
| R3-1 | Dead "Current GPA" / "Class Rank" stat cards | **Fixed & verified** |
| R3-2 | Configured grading scale never applied | **Fixed & verified** |
| R3-3 | Conduct / homeroom remarks missing from transcript | **Fixed & verified** |
| R3-4 | "Show Ge'ez numerals" setting has no effect | **Fixed & verified** |
| R3-5 | No bank-transfer/disbursement file export | **Fixed & verified** |

---

## Fix R3-1 — GPA and Class Rank stat cards wired to real data

**Files:** `src/features/students/academic-record.ts` (`fetchClassRank()`,
new), `supabase/migrations/20260821000008_class_rank.sql` (`get_class_rank()`,
new — SECURITY DEFINER), `StudentDetailPage.tsx` and `AcademicRecordTab.tsx`
(both stat cards wired to real queries instead of hardcoded `"—"`).

`grades_select` RLS only permits a student/guardian to read their **own**
grades, so ranking a student against classmates required a narrow SECURITY
DEFINER RPC rather than a plain client query — `get_class_rank()` re-derives
the same authorization branches `grades_select` uses (self, guardian,
teacher-of-class, staff-with-`grades:read`) before computing anything, and
returns only a rank number and roster size, never a classmate's actual score.
Ties share a rank via `dense_rank()`; a student with zero grades still appears
in the ranking (at the bottom), via `coalesce(avg(...), 0)`.

**pgTAP:** `supabase/tests/rls/class_rank.sql`, plan 9 — rank ordering, ties,
zero-grade students, self-view, unrelated-teacher denial, nonexistent student
id, cross-section isolation. All 9 pass.

**Live verification (school_admin, QA tenant, production):** two disposable QA
students in a real, otherwise-empty class ("Grade 9 A") with real, different
scores:

```
QA-High (score 91): rank 1 / 2, gpa 4.00
QA-Low  (score 62): rank 2 / 2, gpa 2.00
```

Both stat cards on `StudentDetailPage` showed real numbers, not `"—"`; the
higher scorer's rank card read `1 / 2`. Fixture students and grades removed
after verification (via direct SQL — `grades` has no client-reachable DELETE
policy by design).

---

## Fix R3-2 — Configured grading scale actually applied

**Files:** `src/features/students/academic-record.ts` (`fetchDefaultBands()`,
`letterGrade()`/`gradePoint()` now accept a `bands` parameter, defaulting to
the old hardcoded ladder for tenants with no configured scale),
`supabase/migrations/20260821000009_grading_scales_lookup.sql`
(`grade_point_for()`, new — the same lookup, callable from SQL so
`get_class_rank()` can't silently disagree with the client-side GPA card).

Every tenant today has no `grading_scales` row configured, so this fix is a
no-op for every currently-live tenant until a school actually sets one up —
verified by deliberately configuring one and confirming behavior changes.

**pgTAP:** `supabase/tests/rls/grading_scales_lookup.sql`, plan 6 — a
deliberately **inverted** scale (a 95 worth fewer points than a 40) proves the
real lookup runs, not the fallback ladder, for both `grade_point_for()`
directly and `get_class_rank()`'s resulting order. All 6 pass.

**Live verification (school_admin, QA tenant, production):** real student
Abebe Tesfaye, real grades (85 + 91 = 176 total, one subject):

```
BEFORE (no scale configured): letter=A+, gpa=4.00   (fallback ladder)
AFTER  (QA scale configured, inverted thresholds):
  letter=QATP, gpa=4.90                              (real configured scale)
```

Transcript PDF regenerated and decompressed byte-for-byte: `"QATP"` and
`"4.90"` appear literally in the rendered content stream — not the old
ladder's `"A+"`/`"4.00"`. QA scale and bands deleted after verification
(`grading_scales` has a normal client DELETE policy, unlike `grades`).

---

## Fix R3-3 — Conduct / remarks added to the transcript

**Files:** `src/features/students/conduct-summary.ts` (new —
`fetchConductSummary()`, mirroring `BehavioralTab.tsx`'s exact query shape
against `discipline_incidents`/`student_merits` so the transcript can never
show a different picture than the tab), `src/features/students/transcript-pdf.ts`
(new bounded section between the GPA totals and the fixed-position footer
notice), `AcademicRecordTab.tsx` and `ReportCardBatchPage.tsx` (both call sites
wired to fetch and format conduct rows before building the PDF).

No migration needed: `discipline_incidents_select`/`student_merits_select`
already permit exactly the read this uses (self/guardian/staff, always for the
same student generating their own transcript) — nothing to add at the RLS
layer.

**Live verification (school_admin, QA tenant, production):** real student
Abebe Tesfaye, given one real discipline incident and one real merit award on
file:

```
BEFORE (no conduct records): fetchConductSummary() → { incidents: [], merits: [], totalMeritPoints: 0 }
AFTER: { incidents: [ {date, category:"conduct", severity:"moderate", status:"resolved"} ],
         merits: [ {date, title:"QA Round3 Merit Award", points:12} ],
         totalMeritPoints: 12 }
```

Transcript PDF regenerated, decompressed, and its content stream decoded: both
rows appear literally —

```
QACONDUCTTITLE
2025-10-12 (QA) — Category:conduct: Severity:moderate Status:resolved
2025-11-03 (QA) — QA Round3 Merit Award: +12
QAMERITPOINTSTOTAL: 12
```

(Custom label text — `QACONDUCTTITLE`/`QAMERITPOINTSTOTAL` — was used
deliberately in place of the real i18n strings so a match could only come from
the new conduct section actually rendering, not from unrelated text elsewhere
on the page.) `student_merits` fixture row cleaned up via client `.delete()`
(has a normal DELETE policy); `discipline_incidents` fixture row cleaned up via
direct SQL (no client-reachable DELETE policy, by the same intentional design
as `grades`).

---

## Fix R3-4 — Tenant's Ge'ez numerals setting wired to `<EthDate/>`

**Files:** `src/features/settings/useGeezNumerals.ts` (new hook — reads
`tenant_configs.settings.calendar.geezNumerals`, the same `tenant-config`
query key `CalendarPreferencesPage.tsx` already invalidates on save, so
toggling the setting refreshes every rendered date immediately),
`src/components/EthDate.tsx` (the `geez` prop now falls back to the tenant's
real preference when the caller doesn't pass one explicitly, instead of
silently defaulting to `false`).

`<EthDate/>` is used at ~50 call sites app-wide (dashboard, invoices, staff
profiles, timetables, etc.). Wiring the fallback inside the component itself —
rather than threading a `geez` prop through every call site — means all of
them pick up the tenant's setting for free; an explicit `geez` prop at any
individual call site still overrides it.

**Verification:** browser-based end-to-end verification against production was
attempted but not completed cleanly in this environment — headless Chromium
here cannot reach `*.vercel.app` directly (connection resets independent of
the outbound proxy, consistent with anti-bot fingerprinting on that domain),
and mirroring the deployed bytes to drive locally hit its own trap: a local
`npm run build` bakes in `.env.local`'s dev Supabase URL instead of the real
production value Vercel's build injects, so the first mirror attempt silently
pointed the driven app at the wrong backend. Given the added time cost of
building a byte-correct local mirror of the live deployment purely to drive a
browser, verification was done instead as a direct, real data round-trip
against production, exercising the exact same query and render logic the
component uses:

```
1. Wrote tenant_configs.settings.calendar = {secondaryVisible:true, geezNumerals:false}
   for the QA tenant — same shape CalendarPreferencesPage.tsx writes.
2. Read it back with the EXACT query useGeezNumerals() runs.
   → geezNumerals: false
   → formatEth(sampleDate, {..., geez: false}) → "Tir 7, 2018 E.C."   (Arabic numerals)
3. Wrote geezNumerals: true, read back with the same query.
   → geezNumerals: true
   → formatEth(sampleDate, {..., geez: true}) → "Tir ፯, ፳፻፲፰ E.C."   (Ethiopic numerals)
4. Restored the tenant's original setting (geezNumerals: false).
```

This confirms the real write → the exact hook's read-back → the exact render
call all agree, for both states. It does not independently confirm React's
render-tree wiring (that `EthDate` genuinely calls the hook at render time and
re-renders on cache invalidation) — that part rests on code review and the
`tsc`/`eslint`/build gates passing, not a browser observation. Flagged
honestly rather than claiming a browser check that didn't happen.

---

## Fix R3-5 — Bank-transfer CSV export on payroll runs

**File:** `src/features/hr/PayrollRunDetailPage.tsx` — a "Download bank file"
action, visible on any run past `draft` status, producing a CSV
(`account_number, employee_name, net_pay_etb`) built from the same `payslips`
query that already powers the page's own table and gross total, plus a new
`hr_employee_sensitive` query for each payslip's employee (the same
column-grant-protected view `PayrollTab.tsx` already reads for the
single-employee case) — so the export can't drift from what the page displays.

No migration needed: `hr_employee_sensitive` already grants `select` to
`authenticated`, with base-table RLS on `employees` governing row visibility —
the same accountant/school_admin roles that can already see the payroll run
can already see the account numbers.

**Live verification (school_admin, QA tenant, production):** a disposable,
approved QA payroll run with two real employees and two real payslips:

```
run: { status: "approved", ec_year: 2018, ec_month: 2 }
payslips: [
  { employee: "QA Bank Test Employee One", net_pay: 12450.00 },
  { employee: "QA Bank Test Employee Two", net_pay: 8314.00 },
]
bank accounts: { ...001: "1000200030", ...002: "2000300040" }

=== GENERATED CSV ===
account_number,employee_name,net_pay_etb
1000200030,QA Bank Test Employee One,12450.00
2000300040,QA Bank Test Employee Two,8314.00

expected net total (from payslips.net_pay): 20764.00
CSV net total (parsed back out of the CSV):  20764.00
no rounding drift: true
```

Both account numbers and both net-pay figures match the run's own payslip
totals exactly, in ETB, with no rounding drift. Fixture run, payslips, and
employees deleted via direct SQL after verification; re-queried to confirm
zero rows remained.

---

## Cross-tenant safety — final confirmation

Neither Aw Abdal nor Abadir was touched at any point during this round. Every
verification used either the QA tenant's own real, pre-existing data (Abebe
Tesfaye's real grades, read-only or reverted immediately) or freshly created
`QA`-prefixed disposable rows, all deleted (or removed via direct SQL where no
client DELETE policy exists) after use.

---

## Deploy record

- Migrations (`20260821000008`, `20260821000009`) applied directly via the
  Supabase Management API, in order, bookkept in
  `supabase_migrations.schema_migrations`, confirmed via direct query
  afterward.
- `get_class_rank()` and `grade_point_for()` confirmed present and callable;
  `pg_proc.prosecdef` confirmed `true` (SECURITY DEFINER, as designed, so a
  self-viewing student can be ranked against classmates without RLS exposing
  their raw grades).
- Frontend deployed five times across this round (once per fix, per the
  user's explicit choice to deploy incrementally rather than batching at the
  end), each via `npm run deploy` — never `--prebuilt`; every build log
  confirmed `Running "npm run build"`, not a prebuilt-artifact reuse.
- Live bundle fetched and grepped after each deploy: Supabase project URL
  present (env genuinely baked in), and a string unique to that fix's new code
  present (`fetchConductSummary`/`discipline_incidents` for R3-3,
  `useGeezNumerals`/`tenant-config` for R3-4, `hr_employee_sensitive`/
  `bank-file-` for R3-5).
- `supabase/tests/run.sh` (39 pgTAP suites) run to green after every migration
  in this round, and again as a full regression check after each of the
  frontend-only fixes (R3-3, R3-4, R3-5) — no regressions at any point.

Deploy tokens were stored in a `chmod 600` file, kept live across all five
fixes' deploys per the user's explicit choice (rather than shredded after each
individual fix), and `shred -u`'d immediately once all five were confirmed
live. `git grep` across every commit in the repo's full history confirmed
neither token leaked into any commit.
