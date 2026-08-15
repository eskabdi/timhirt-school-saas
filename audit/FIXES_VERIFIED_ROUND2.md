# Timhirt Live Production Fixes — Round 2 Verification Report

**Method:** Same discipline as Round 1 — every claim below is backed by a real
request/response against production (`livqynxlibmccaycseer`), not a reading of the
diff. Each fix got its own migration, was validated against a real local Postgres
(`supabase/tests/run.sh`, all pgTAP suites green before and after each migration —
38 suites, 61 new assertions across the three new suites), deployed individually
(migrations first, frontend last), and live-verified against the QA tenant
(`qa-harar-model`) before moving to the next fix. All test data created for
verification was `QA`-prefixed and deleted immediately after use. Aw Abdal and
Abadir were never written to.

One severity correction from the source task: the third item ("Leave requests can
only be self-filed") was tagged **Medium** in the original `FINDINGS.md`, not
High — it's grouped with the other two here at the requester's instruction, not
because its severity changed.

Migrations, in order: `20260821000006_promotion_capacity_atomicity.sql`,
`20260821000007_leave_file_on_behalf.sql`. (Fix R2-1 is a frontend-only change —
no migration.)

---

## Status

| # | Finding | Severity | Status |
|---|---|---|---|
| R2-1 | Report Cards batch button has no `onClick` | High | **Fixed & verified** |
| R2-2 | Promotion silently bypasses class capacity (+ non-atomic) | High | **Fixed & verified** — RPC path enforced; a raw table `PATCH` bypassing the RPC is still unguarded, same as this codebase's existing enrollment-capacity pattern (see below) |
| R2-3 | Leave requests can only be self-filed | Medium | **Fixed & verified** |

---

## Fix R2-1 — Report Cards batch button wired to real transcript generation

**File:line:** `src/features/gradebook/ReportCardBatchPage.tsx` — the `generate()`
function (new) is wired to the button's `onClick`; it loops every active student
across the selected classes' rosters and calls `fetchAcademicRecord()` +
`buildTranscriptPdf()` per student. Those two functions were extracted verbatim
from `AcademicRecordTab.tsx`'s existing working "Download Official PDF" button
into a new shared module, `src/features/students/academic-record.ts`, so the
batch page reuses the exact same query/aggregation/grading logic rather than a
second implementation — `AcademicRecordTab.tsx` itself is unchanged in behavior
(same query shape, same output), only its own copy of the logic was replaced with
a call to the shared module.

**Verification harness note:** Chromium in this sandbox cannot reach the internet
at all (confirmed via direct proxy diagnostics, a constraint beyond what browsing
here normally hits), so browser-driven verification wasn't available. Instead,
the exact unmodified source files (`academic-record.ts`, `transcript-pdf.ts`)
were bundled with esbuild and run directly in Node against production Supabase —
a stronger check than a browser download-count would have given, since it
verifies real PDF byte content per student rather than an HTTP 200 or a
download-event count.

**Live verification (school_admin, QA tenant, against the newly deployed
production bundle):** selected the first two classes (Grade 1 A, Grade 5 A),
looped their full active rosters (2 students):

```
Abebe Tesfaye (QHR03-0001-2): 1948 bytes, PDF magic=true, subjects=1, gpa=4.00
Chaltu Gudeta (QHR03-0002-0): 1737 bytes, PDF magic=true, subjects=0, gpa=0.00
succeeded: 2 / 2, failed: []
```

Chaltu's `subjects=0` is real, not a bug — she genuinely has no grades recorded
on this QA tenant. Abebe's PDF was decompressed and its embedded-font glyph
strings decoded to confirm real content, not just a valid-looking file:

```
QA Harar Model Secondary School / Academic Record / Student / Abebe Tesfaye
Admission No / QHR03-0001-2 / Grade / Grade 1-A
Mathematics / - / 176.0 / 0.0 / 176.0 / A+ / Pass
Semester totals / 176.0 / 100 / GPA / 4.00
```

`176.0` matches the raw `grades` table exactly (two real rows, scores 85 + 91).
The deployed production bundle was independently confirmed to contain the new
code: `grep -c 'promote_students_batch|generatingProgress' /assets/index-*.js`
found the RPC call and all three locales' new i18n strings.

---

## Fix R2-2 — Promotion capacity enforcement + atomicity

**File:line:** `supabase/migrations/20260821000006_promotion_capacity_atomicity.sql`
— `promote_students_batch(p_moves jsonb)`. Checks every target class's
post-promotion headcount (aggregated across every source class in the same batch
that targets it) against capacity **before any row is written**; the whole batch
runs as one function call/transaction, so a capacity failure on any single move
rolls back the entire batch. `src/features/settings/PromotionPage.tsx` — the
`promote` mutation now calls the RPC instead of issuing direct
`students.update()` calls per class; the "Run promotion" button's `disabled`
state now reflects a real (batch-aware) capacity check (`hasCapacityConflict`),
not the previously-decorative `overCapacity` flag that was computed but never
read.

**Design note, stated explicitly:** the fix instruction described this as "same
pattern as `enroll_admission_application()`... SECURITY DEFINER" — but reading
that function (`supabase/migrations/20260719000001_enrollment_bridge.sql:30-38`)
shows it is deliberately **SECURITY INVOKER**, with a comment explaining exactly
why: it adds atomicity across multiple writes, not new authority, relying on the
caller's own RLS. `promote_students_batch` follows that same real pattern
(SECURITY INVOKER), not the literal SECURITY DEFINER description — flagging this
the same way the severity correction above is flagged, rather than silently
building something inconsistent with the codebase's own stated reasoning.

**Live verification (school_admin, QA tenant, production):**

```
PROBE 1 — capacity-1 class already has 2 real students (Fasika, Yonas — this
is live evidence the original bug produced this exact state). Attempted to
move Grade 1 A's active student into it:
  → 400 P0001 "promotion would exceed capacity for class Grade 10 A
     (capacity 1, would enroll 3)"
  Grade 1 A student confirmed UNMOVED afterward.

PROBE 2 — a disposable QA class/student, moved into a fresh capacity-1
target with 0 current occupants (exactly at capacity):
  → 200, {"promoted_count":1,"graduated_count":0}
  Student's class_id confirmed changed to the target.

PROBE 3 — a no-conflict multi-class batch: one promotion (unlimited-capacity
target) + one graduate, in the same call:
  → 200, {"promoted_count":1,"graduated_count":1}
  Both students' rows confirmed correct (moved / status=graduated) afterward.
```

**Re-running the exact original probe** (`PATCH /rest/v1/students?class_id=eq.<
source>&status=eq.active {class_id:<capacity-1 target>}`, the raw table write
`PromotionPage.tsx` used to issue directly):

```
PATCH /rest/v1/students (raw, bypassing the RPC) → 200, student moved,
capacity-1 target now holds 3 active students.
```

**This still succeeds** — reported honestly rather than glossed over. The fix
protects the actual reachable application path (`PromotionPage.tsx` now calls
`promote_students_batch` exclusively; there is no other UI code that writes
`students.class_id` for promotion), but does not add a table-level `CHECK` or
trigger stopping an arbitrary direct `PATCH` from exceeding capacity. This
matches the exact same architecture this codebase already uses for the
analogous case: `enroll_admission_application()` checks capacity only inside
the RPC, not via a table constraint, and a direct `INSERT` into `students` with
a capacity-full `class_id` is equally unguarded there. This fix is consistent
with that established precedent, not a new gap — but it's a real, live-confirmed
fact about the fix's actual boundary, not a hypothetical. (Reverted the raw-PATCH
test move immediately after confirming the result.)

---

## Fix R2-3 — HR/admin can file leave on an employee's behalf

**File:line:** `supabase/migrations/20260821000007_leave_file_on_behalf.sql` —
`leave_file_on_behalf`, an **additional** INSERT policy on `leave_requests`
(Postgres RLS OR's multiple permissive policies together for the same command,
so this is additive, not a replacement). `leave_file_own`'s original conditions
are unchanged; it only gained one new check, shared with the new policy, that
`filed_by` (if supplied at all) must equal the caller's own id — protecting the
new audit column rather than loosening who may self-file. A new
`leave_requests:create` resource permission was added, granted by default to
`school_admin` and `hr_officer`. `filed_by uuid default auth.uid()` was added to
`leave_requests`, backfilled for existing rows from the employee's own
`user_id` (self-filing was the only path before this fix).

**Live verification (school_admin, QA tenant, production):** created a
disposable QA employee with **no `auth.users` identity at all** (`user_id:
null`) — exactly the case the original finding cited:

```
POST /rest/v1/leave_requests
  {tenant_id, employee_id: <no-login employee>, leave_type_id, starts_on,
   ends_on, status:"pending"}
  as school_admin
  → 201
  {"id":"...","filed_by":"97ac565f-...","status":"pending", ...}
```

`filed_by` on the returned row matches the school_admin's own `auth.uid()`
exactly, not the employee. Queried by `employee_id` (the same shape the
employee's own leave-history view would use) — the request is present, `200`,
1 row. `audit_logs` for this insert: `actor_id` = the school_admin's
`auth.uid()`, matching `filed_by` — the real filer is captured, distinguishable
from `employee_id` (whose leave it is).

```
PATCH ... audit_logs row for this insert:
  actor_id: 97ac565f-fcf1-4069-85fa-b969015da626  (school_admin)
  new_data.employee_id: 04d32369-...  (the no-login employee)
  new_data.filed_by: 97ac565f-fcf1-4069-85fa-b969015da626  (matches actor_id)
```

**Re-running the exact original probe** (`POST /rest/v1/leave_requests` as
`school_admin` on behalf of another employee, which previously returned `403`):
now returns `201` as shown above — was `403`, now works.

Test data (the disposable employee and its leave request) deleted immediately
after verification.

---

## Cross-tenant safety — final confirmation

Neither Aw Abdal nor Abadir was touched at any point during this pass. Every
Round 2 verification used either the QA tenant's own real data (Fasika/Yonas's
pre-existing over-capacity state, Abebe/Chaltu's real grades — read-only, or
reverted immediately after a deliberate probe) or freshly created `QA`-prefixed
disposable rows, all deleted after use.

---

## Deploy record

- Migrations applied directly via the Supabase Management API, in order,
  bookkept in `supabase_migrations.schema_migrations` (`20260821000006`,
  `20260821000007`), confirmed via direct query afterward.
- `promote_students_batch`'s `pg_proc.prosecdef` confirmed `false` (SECURITY
  INVOKER, as designed — see the design note above).
- `leave_requests`'s policy list confirmed to include both `leave_file_own` and
  `leave_file_on_behalf` (`polcmd: 'a'`, i.e. INSERT) after migration.
- Frontend deployed via `npm run deploy` (never `--prebuilt`); build log
  confirmed `Running "npm run build"`, not a prebuilt-artifact reuse.
- Live bundle fetched and grepped post-deploy: Supabase project URL present (env
  genuinely baked in), `promote_students_batch` RPC name present, all three
  locales' new `gradebook.generatingProgress` strings present.

Deploy tokens were stored in a `chmod 600` file, used only for this deploy, and
`shred -u`'d immediately after; `git grep` across the repo confirmed neither
token leaked into any commit.
