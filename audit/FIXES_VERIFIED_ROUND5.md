# Timhirt Live Production Fixes — Round 5 Verification Report

**Scope:** Tiered document customization — extended branding for Standard and
above, and a full template editor for Premium — across every generated
document.

**Method:** Same discipline as Rounds 1–4. Every claim below is backed by a
real request/response against production (`livqynxlibmccaycseer`) or by
driving the app in a browser, not by a reading of the diff. Each migration was
validated against a real local Postgres (`supabase/tests/run.sh` — 105
migrations, 54 pgTAP suites) with its own dedicated suite green, then deployed
in order (migrations → Edge Functions → frontend).

Round 5 relaxed one thing on the user's instruction: this project has no real
customers yet, so Aw Abdal, Abadir and the QA tenant are all dev/test data and
writes to any of them were permitted. The byte-identical-regression ceremony
of prior rounds was dropped **except** where a change touched the fixed layout
of an existing document, where it was kept (see R5-C6 below). All rows written
for verification were deleted afterwards and the deletion confirmed.

---

## Status

| # | Item | Status |
|---|---|---|
| A1 | Investigate the real tier/module mechanism before building | **Done — no parallel system introduced** |
| B1 | Register `branding_extended` for Standard and above | **Shipped & verified** |
| B2 | One shared branding accessor per runtime, applied to invoice/receipt/payslip | **Shipped & verified** |
| C1 | Register `document_templates` (Premium/Enterprise only) | **Shipped & verified** |
| C2 | `document_templates` table, write RLS requires school_admin **AND** the module | **Shipped & verified live** |
| C3 | Per-document-type field matrix | **Shipped — encoded once, shared by editor and preview** |
| C4 | Template editor UI, gated at RLS not just UI | **Shipped & driven in a browser** |
| C5 | Live preview, synthetic placeholder data only | **Shipped & verified — no real PII reachable** |
| C6 | Every "yes" generator reads the template, fixed layout when no row | **Shipped & verified — two real gaps found and fixed** |
| D1 | Both keys in the platform module matrix with correct tier defaults | **Verified in the rendered UI** |
| — | Final: both keys resolve across all three tenants; override-wins | **Clean** |
| — | Final: cross-tenant isolation on the new table | **Clean — zero leakage** |

Migrations, in order:
`20260902000001_branding_extended_module.sql`,
`20260903000001_document_templates.sql`.

New pgTAP suites: `supabase/tests/rls/branding_extended_module.sql` (9/9),
`supabase/tests/rls/document_templates.sql` (10/10).

---

## A1 — What the tier/module mechanism actually is

Read from the migrations rather than assumed. Three tables and one function:

- `modules` — the catalog (key, display_name, sort_order).
- `tier_modules` — **presence means included.** There is no boolean column;
  a tier without a row for a module simply does not have it.
- `tenant_module_overrides` — a boolean per (tenant, module). **The override
  wins in both directions**, so it can force a module on below its tier or off
  above it.
- `has_module(p_tenant_id, p_module_key)` — `SECURITY DEFINER`, resolves
  `coalesce(override, tier default, false)`.

No parallel tier-ranking was introduced. Neither new module compares tiers; both
are plain rows in `tier_modules`, which is why they appear in the platform
matrix with no code change (see D1).

**The Basic floor that must not regress:** Basic had 5 modules before this round
and has 5 after. Neither new key was added to it.

| tier | modules before | modules after | `branding_extended` | `document_templates` |
|---|---|---|---|---|
| basic | 5 | 5 | no | no |
| standard | 9 | 10 | yes | no |
| premium | 18 | 20 | yes | yes |
| enterprise | — (did not exist) | 20 | yes | yes |

(Counts read live from production after the round.)

`enterprise` did not exist and was created (sort_order 4) with premium's module
set copied to it, so "Premium and above" is expressible.

---

## B1 — `branding_extended` registered for Standard and above

Migration `20260902000001_branding_extended_module.sql`, all statements
`on conflict do nothing`. Live result from production:

```
key                sort_order  tiers
branding_extended  19          standard,premium,enterprise
```

pgTAP `branding_extended_module.sql` — 9/9. It asserts the tier defaults and
**override-wins in both directions**: forced ON for a Basic tenant resolves
true, forced OFF for a Premium tenant resolves false.

---

## B2 — One shared branding accessor per runtime

Two accessors, one per runtime, because the two runtimes have different
correctness requirements.

**Edge (`supabase/functions/_shared/branding.ts`).** `loadDocumentBranding()`
gates its **entire** result on `has_module(tenant_id, 'branding_extended')` and
returns `UNBRANDED` (school name `"School"`, no colour, no logo) when the module
is absent or the check fails. It never throws — a failed lookup renders as
today. Applied to invoice, receipt and payslip: the three server-rendered
documents that carried **no** branding at all before this round, so gating the
whole result cannot regress anything.

**Browser (`src/lib/documentBranding.ts`).** `useDocumentSchoolName()` is
**ungated and name-only.** The transcript, report card, leaving certificate and
seating chart already printed the school name at every tier including Basic;
gating that would be a regression sold as a feature. The brief is explicit that
ID cards and transcripts "stay always-on at every tier, unchanged", so the hook
deliberately does **not** expose logo or colour — that would be dead API surface
inviting exactly the change the brief rules out.

The frontend chain (read `tenant_configs.settings.branding`, pick the active
locale's name, fall back through English to the app name, treating empty strings
as unset) had been copy-pasted into four components **and had already drifted**:
ExamsPage's seating chart skipped branding entirely and printed the *product*
name. Fixed as part of the de-duplication.

Three call sites deliberately keep their own lookup and are named in the file
header: `StudentDetailPage` and `StaffProfilePage` also need `logoPath` for the
ID cards (unchanged this round), and `DashboardShell` is nav chrome, not a
generated document.

### Evidence — driven in a browser, not read

Both PDFs below were generated by clicking the real button in the real
component (Vite harness aliasing only `@/lib/supabase` and
`@/features/auth/useSession`, per the `verify` skill), then decoded out of the
resulting blob.

| document | letterhead line 1 |
|---|---|
| transcript (branding `{nameEn: "QA HARAR MODEL SCHOOL"}`) | `QA HARAR MODEL SCHOOL` |
| transcript (branding `{}` — negative control) | `Timhirt` (app name) |
| seating chart, after | `QA HARAR MODEL SCHOOL` |
| seating chart, before (`git show HEAD~1`) | `schoolName: t("app.name")` → `Timhirt` |

The negative control matters: without it, "the right name appeared" does not
distinguish a working accessor from a coincidence.

### Edge Functions carrying branding

`issue-fee-document` (v4), `record-fee-payment` (v5), `telebirr-notify` (v4),
`generate-payslip-pdf` (v7), `enroll-finalize-billing` (v3).

Payslip generation was ported from a hand-rolled raw-PDF writer to pdf-lib in
the process (`_shared/payslip-pdf.ts`) — the brief assumed it already shared the
fee-pdf machinery, and it did not.

---

## C1 / C2 — `document_templates` module and table

Migration `20260903000001_document_templates.sql` registers
`document_templates` (sort_order 20) for premium and enterprise only, and
creates the table.

Notable choices:

- `watermark_opacity numeric not null default 0.15 check (watermark_opacity > 0 and watermark_opacity <= 0.5)`.
  A range check rather than an array length check — see CLAUDE.md on
  `array_length` vs `cardinality`; here the trap is different but the lesson is
  the same, so the constraint was tested by trying to violate it (opacity 1.0
  → `23514`).
- `document_type` CHECK over 7 types. `id_card` is **excluded** — R5-B2 leaves
  ID cards unchanged at every tier, so there must be no way to configure one.
  Verified: inserting `id_card` is rejected.
- `unique (tenant_id, document_type)`.
- **SELECT is tenant-scoped, not admin-only.** Generators run as teachers and
  portal users; an admin-only read policy would mean only admins got the
  customized layout.
- **Write policy requires school_admin AND `has_module(tenant_id, 'document_templates')`.**
  Round 1's lesson applied deliberately rather than rediscovered: a UI-only gate
  is not a gate.

pgTAP `document_templates.sql` — 10/10, including: Premium school_admin **can**
write; Basic school_admin **cannot** (same role, missing module); a teacher in a
Premium tenant cannot write but **can** read.

### Live proof the module gate is in the write path, not just the UI

Run against production through PostgREST with a real QA school_admin JWT:

```
module ON  → PATCH header_text = "MODULE-ON"                  → 1 row, applied
force OFF  → PATCH header_text = "MODULE-OFF-SHOULD-NOT-LAND" → 0 rows
read-back with module OFF                                     → "MODULE-ON"
SELECT with module OFF                                        → still works
```

The rejected value never landed, and reads keep working with the module off —
which is required, or generators would lose the template the school already
configured.

### Cross-tenant isolation (production, real JWT)

One `invoice` template row was seeded for each of the three tenants as admin,
then queried as the QA school_admin:

| probe | result |
|---|---|
| `SELECT *` | 1 row — only `HDR-qa-harar-model` |
| `SELECT ?tenant_id=eq.<abadir>` | `[]` |
| `PATCH ?tenant_id=eq.<abadir>` with `header_text="PWNED"` | `[]` — 0 rows |
| Abadir's row afterwards | `HDR-abadir`, unmodified |

All three seeded rows and every override were deleted afterwards; confirmed
`templates: 0, overrides: 0`.

---

## C3 — Per-document-type field matrix

Encoded once, in `DOC_TYPES` in `DocumentTemplatesPage.tsx`, and consumed by
both the editor and the preview so the two cannot disagree.

| document type | header/footer | signature | watermark |
|---|---|---|---|
| transcript | yes | yes | yes |
| report_card | yes | yes | yes |
| invoice | yes | no | yes |
| receipt | yes | no | yes |
| payslip | yes | yes | no |
| leaving_certificate | yes | yes | yes |
| seating_chart | yes | no | no |

`id_card` is absent by design and is rejected by the table's CHECK.

---

## C4 — Editor UI, gated at RLS not just the UI

Driven in a browser in both states:

- **Module present:** 7 document-type cards, each with a `Customise` button;
  expanding one shows Header line, Footer line, Show signature line, Signature
  caption, Watermark text, Watermark opacity — exactly the C3 row for that type.
  The signature caption input is `disabled` until the toggle is on.
- **Module absent:** the form is not rendered at all; the page shows
  *"Document templates are available on the Premium plan. Contact your account
  manager to enable it."*

No `RequireModule` wrapper on the route — the page renders its own explanatory
empty state, and the database is the real gate (proved above).

---

## C5 — Live preview uses synthetic data only

The preview routes through the **real** generators — so what you see is what the
document will look like — but with invented inputs. Text decoded out of a
generated preview PDF:

```
Sample School · Sample Student · SAMPLE-0001 · Grade 10 · Sample Term
Sample Teacher · Issued: Sample date
```

Note the letterhead reads `Sample School`, **not** the tenant's real branding
(`QA HARAR MODEL SCHOOL`), even though the component had it in cache. No student
name, admission number, score, employee, or amount from the tenant's own data is
reachable through the preview — same posture as the `medical_notes` /
`tin_number` column revokes elsewhere in this schema.

Draft values apply live without saving. With all four fields filled, the decoded
PDF contains them in the correct positions:

```
line 4  Sample School      (letterhead)
line 6  WATERMARKTX        (painted before the body — pdf-lib has no z-index)
line 7  HEADERLINE
line 46 SIGCAPTION         (replaces the default "Authorized signature")
line 47 FOOTERLINE
```

Watermark opacity is a real ExtGState, not a lighter fill: the decompressed
content streams contain `/ExtGState`, `/ca 0.15`, and `/GS-9750469207 gs`
invoked immediately before the 45°-rotated watermark text.

---

## C6 — Every "yes" generator wired, fixed layout when no row

`loadDocumentTemplate` (Edge) and `fetchDocumentTemplate` (browser) both return
`null` when there is no row, and every helper is a no-op on `null` — so an
unconfigured document renders exactly as it did before this round.

The browser-side renderer is a **factory** taking `{ rgb, degrees }` rather than
importing pdf-lib directly, specifically so a static import would not defeat the
app-wide dynamic-import optimization. Verified against the **served** bundle:
pdf-lib is still its own 389,628-byte chunk (`assets/index-C3aD9wfV.js`),
reached through `import("./index-C3aD9wfV.js")` from the main bundle rather than
folded into it.

### Two real gaps found by running it

Neither was visible in the diff. Both are the reason this round's verification
was worth doing.

**1. The transcript ignored its configured header line.** C3 marks
`header: true` for transcript and report_card, and the editor offered the field,
but `buildTranscriptPdf` only called `watermark` / `signature` / `footer`. A
school could type a header, save it, and see nothing. Found by filling the
editor's fields in a browser and decoding the preview PDF — three of four probe
strings came back, one did not.

Fixed by drawing the header at a **fixed** y in the gap between the navy band
(ends at `842-76`) and the student block, rather than flowing into it, so the
block below keeps its exact `842-110` start. Regression check kept here despite
the round's relaxed ceremony, because this touches an existing document's fixed
layout: with no template row, before and after are both **2538 bytes with
identical extracted text**.

**2. `enroll-finalize-billing` rendered an un-branded, un-templated invoice and
receipt.** It calls the same `renderInvoicePdf` / `renderReceiptPdf` helpers as
`issue-fee-document` but was passing neither branding nor template — so a
Premium school would get its template on a *reissued* invoice and not on the one
generated at enrollment. Found by grepping every Edge Function for a call into
`fee-pdf`/`payslip-pdf` rather than trusting the four the brief named.

Deployed as v3. The deployed eszip contains `template: invoiceTemplate` and
`receiptTemplate`; unauthenticated calls still return 401; an authenticated call
with a bad payload returns the 400 validation error rather than a boot error, so
all four shared modules resolved.

`issue-id-card` and `issue-staff-id` also render PDFs and are **correctly**
untouched — R5-B2 leaves ID cards unchanged at every tier, and C3's matrix
excludes `id_card`.

### Final coverage against the matrix

| document | header | footer | signature | watermark |
|---|---|---|---|---|
| transcript | `transcript-pdf.ts` | ✓ | ✓ | ✓ |
| report_card | same builder | ✓ | ✓ | ✓ |
| invoice | `fee-pdf.ts:153` | `:191` | n/a | `:150` |
| receipt | `fee-pdf.ts:209` | `:251` | n/a | `:206` |
| payslip | `payslip-pdf.ts:87` | `:107` | `:106` | n/a |
| leaving_certificate | `:87` | `:132` | `:130` | `:75` |
| seating_chart | `:67` | `:100` | n/a | n/a |

The leaving certificate had a pre-existing fixed signature line; it is now
wrapped so a configured template **replaces** it rather than printing twice.

---

## D1 — Both keys in the platform module matrix

The matrix reads both axes straight from `modules` and `subscription_tiers`, so
a migration that registers a module appears with no code change. Confirmed by
rendering `ModulesMatrixPage` against the **real production rows** (20 modules,
4 tiers, 55 `tier_modules` rows pulled live) and reading `aria-pressed` off each
cell:

```
tier columns: ["Module","Basic","Standard","Premium","Enterprise"]
rows: 20
Extended Branding    basic=false  standard=true   premium=true  enterprise=true
Document Templates   basic=false  standard=false  premium=true  enterprise=true
```

Both rows fall on page 1 (PAGE_SIZE 25, 20 modules), so neither is hidden behind
pagination.

### Override wins over the tier default — on production, both directions

Run inside a transaction and rolled back:

| tenant | tier | key | tier default | override | `has_module` |
|---|---|---|---|---|---|
| abadir | premium | `branding_extended` | true | forced **off** | **false** |
| aw-abdal | basic | `document_templates` | false | forced **on** | **true** |
| qa-harar-model | premium | both | true | none | true |

Rollback confirmed: `leftover_overrides: 0`, and all three tenants resolve back
to their tier defaults.

---

## Final — both keys across all three real tenants

```
name                                slug             tier      branding_extended  document_templates  overrides
Abadir Elementary School            abadir           premium   true               true                0
Aw Abdal Secondary School           aw-abdal         basic     false              false               0
QA - Harar Model Secondary School   qa-harar-model   premium   true               true                0
```

Aw Abdal on Basic gets neither, which is the intended floor. No leftover
overrides anywhere.

---

## Gates

All green at `adc20d8`:

```
npx tsc --noEmit                 clean
npx eslint src                   213 files, 0 errors, 0 warnings
npx vitest run                   6 files, 48 tests passed
npm run check:i18n               0 hardcoded strings
npm run check:locales            common 2182 / apply 135 / calendar 18, parity en/am/om
npm run build                    ok
supabase/tests/run.sh            105 migrations, 54 suites, all passed
                                 branding_extended_module 9/9 · document_templates 10/10
```

`eslint` was proved to fail on purpose (a probe file with
`dangerouslySetInnerHTML` → `react/no-danger` error) before its clean run was
believed — two runners in this repo have previously reported green while
measuring nothing.

`check:i18n` flagged one line during this round: the seating-chart argument
list, as a single line, tripped the audit's wrapped-prose heuristic. Split
across lines; a false positive in the heuristic, not a missing translation.

---

## Deploy verification

A `READY` state proves nothing, so the served bytes were checked:

```
bundle: assets/index-dYC0dZGQ.js
livqynxlibmccaycseer   7   (env baked in — 0 would mean a blank page)
document_templates     2
documentTemplates      3
watermarkText          3
```

The transcript header fix is present in the served bundle as
`i.watermark(b,u,595,842),i.header(b,u,f,750),y=732` — `842-92` folded to 750 by
the minifier, with the student block still starting at 732.

Build log says `Running "npm run build"`, not `Using prebuilt build artifacts`.
`--prebuilt` was never passed. Two deploys failed with a bare
`Error: fetch failed` mid-upload; the deployment list was checked before each
retry to confirm nothing had shipped.

Edge Functions: 32 deployed, 32 in the repo — exact match, no drift.
`verify_jwt` unchanged on every function.

---

## Notes and deliberate non-decisions

**A downgrade does not revoke an already-configured template.** The write policy
checks `has_module`, but SELECT does not, so a tenant that drops from Premium to
Standard keeps its configured layouts on generated documents while losing the
ability to edit them. That follows C2 as written ("write requiring school_admin
AND has_module") and is the safe direction — gating the read would silently
change every document at the moment of a billing change. Flagging it as a
product decision rather than making it unilaterally.

**QA tenant state.** `branding.nameEn` on `qa-harar-model` is
`"QA HARAR MODEL SCHOOL"`, set during this round's verification. Left in place —
it is a sensible value for a QA tenant and the round explicitly permitted writes
to it. All `document_templates` rows and all `tenant_module_overrides` created
during verification were deleted; both confirmed at 0.

**Corrections to the brief.** Three of its premises were wrong and were checked
against the code before building rather than after: ID cards were assumed to
need gating (they must not be gated), one proposed B2 test had an impossible
shape, and the payslip was assumed to already share the fee-pdf machinery (it
was a hand-rolled raw-PDF writer, now ported).
