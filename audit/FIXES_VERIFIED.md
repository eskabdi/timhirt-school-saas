# Timhirt Live Production Fixes — Verification Report

**Method:** Same discipline as the original audit — every claim below is backed by a
real request/response against production (`livqynxlibmccaycseer`), not a reading of
the diff. Each of the five fixes got its own migration, was validated against a
real local Postgres (`supabase/tests/run.sh`, all pgTAP suites green before and
after each migration), deployed individually, and live-verified against the QA
tenant (`qa-harar-model`) before moving to the next fix. All test data is
`QA-`-prefixed or confined to the QA tenant. Aw Abdal and Abadir (the two
pre-existing real tenants) were read-only throughout — verified by direct row-count
checks, never written to.

Migrations, in order: `20260821000001_resource_tables_rls.sql`,
`20260821000002_suspended_tenant_lockout.sql`, `20260821000003_module_gating_rls.sql`,
`20260821000004_exam_class_scoping.sql`, `20260821000005_attendance_audit_and_retroactive_gate.sql`.

---

## Fix 1 — RLS on `resource_open_actions` / `resource_default_role_grants`

**File:line:** `supabase/migrations/20260821000001_resource_tables_rls.sql:49-56` —
`enable row level security` + `force row level security` on both tables, one
`select`-only policy open to `authenticated`, no write policy (matches the
`webhook_events`/`fee_documents` idiom already in this codebase: `service_role`
bypasses RLS regardless, so omitting a write policy is sufficient and is the
established pattern here, not an oversight).

**Live verification (school_admin, QA tenant):**

```
POST /rest/v1/resource_open_actions {"resource":"payroll_runs","action":"read"}
  → 403 {"code":"42501","message":"new row violates row-level security policy for table \"resource_open_actions\""}

POST /rest/v1/resource_default_role_grants {"resource":"payroll_runs","action":"create","role":"student"}
  → 403 {"code":"42501","message":"new row violates row-level security policy for table \"resource_default_role_grants\""}
```

Both previously returned `201`. Reads still work (`GET` returned the existing 20
rows, `200`). Sanity check that `has_resource_permission()` itself still resolves
correctly through the now-RLS'd tables: school_admin created a `QA-SANITY` subject
via the ordinary `classes:create`-style fallback path — `201`, then deleted.

---

## Fix 2 — Suspended tenants lose access

**File:line:** `supabase/migrations/20260821000002_suspended_tenant_lockout.sql:29-38` —
`get_tenant_id_for_user()` now returns `NULL` for a non-`super_admin` caller whose
tenant has `status = 'suspended'`, so every one of the schema's 362
`tenant_id = get_tenant_id_for_user(...)` policies excludes all rows automatically.

**Live verification (QA tenant, suspended then reactivated):**

```
PATCH (management API) tenants SET status='suspended' → {"id":"...","status":"suspended"}

POST /auth/v1/token?grant_type=password (school_admin)     → 200 (login still succeeds, by design)
GET  /rest/v1/students?select=id,first_name,last_name       → 200 []          (was: full roster, 200)
POST /rest/v1/subjects {...}                                 → 403 RLS violation (was: 201)

PATCH (management API) tenants SET status='active'
GET  /rest/v1/students?select=id,first_name,last_name       → 200 [4 rows]    (access restored)
```

Note: an early probe using an unscoped `select=*` on `students` returned a `403
permission denied` from a *different* mechanism — the pre-existing
`medical_notes` column-level `REVOKE` (documented in the original audit as its own
Low-severity finding), not this fix. Re-tested with the same column-scoped
`select` the real frontend uses and got the clean `200 []` shown above.

---

## Fix 3 — Server-side module/plan gating

**File:line:** `supabase/migrations/20260821000003_module_gating_rls.sql` —
`has_module(tenant_id, module_key)` (override wins, else tier default, else
`false`) plus one `RESTRICTIVE` policy per module-gated table (56 tables across 17
of the 18 subscription modules; `messages` is deliberately excluded per
`router.tsx`'s own comment that it isn't a toggleable module). `RESTRICTIVE`
policies AND against the existing `PERMISSIVE` ones without editing any of the
schema's other policies.

**Live verification, using the same mechanism the platform console's module
toggle writes to (`tenant_module_overrides`, set as `super_admin` — that table has
always been `super_admin`-write-only, unrelated to this fix):**

```
INSERT tenant_module_overrides (tenant_id, module_key, enabled) VALUES (QA, 'library', false)  [as super_admin]

GET  /rest/v1/library_books   (school_admin)  → 200 []          (was: 200, full 2-row catalog)
POST /rest/v1/library_books   (school_admin)  → 403 "library_books_module_gate" (was: 201)

DELETE tenant_module_overrides WHERE module_key='library'  [as super_admin, reverts to tier default = enabled]
GET  /rest/v1/library_books   (school_admin)  → 200 [2 rows]    (access restored)
```

**Real-tenant safety check (read-only, no writes to either tenant):** Aw Abdal is on
`tier_key = 'basic'` (status `trial`) — confirmed **zero rows** across every table
outside its tier's default module set (fees, admissions, assignments, library,
hr_payroll, id_cards, hostel, discipline, clinic, transport, events, inventory,
reporting), so enforcing real tier limits changes nothing observable for it today.
Abadir is on `tier_key = 'premium'`, which includes every module by definition.
QA's own tier was raised to `premium` (a QA-owned tenant, not a pre-existing one)
purely so its existing test data across every module stayed reachable.

**Operational note for the platform team:** every tenant onboarded *before* this
fix effectively had full module access regardless of tier (enforcement was
UI-only). Any tenant on `basic` or `standard` whose tier doesn't match what
they've actually been using will now be genuinely restricted — Aw Abdal checked
clean, but this is worth a one-time audit across any other tenants before they're
created going forward.

---

## Fix 4 — Class scoping in Grading

**File:line:** `supabase/migrations/20260821000004_exam_class_scoping.sql` —
`exams.class_id` (nullable — see below), `exam_guard` trigger (rejects a
cross-tenant `class_id`), `grade_guard` trigger extended to reject a score for a
student outside the exam's class when one is set. Frontend:
`src/features/gradebook/GradebookPage.tsx` filters the roster to the selected
exam's class; `src/features/gradebook/ExamsPage.tsx` requires picking a class to
create an exam.

**Why nullable, not required:** production already has 2 real exams on Abadir
with 16 already-recorded grades and no historical signal for which of its 49
classes they were meant for. Guessing would have meant fabricating tenant data,
which this audit does not do. Confirmed via direct read: both of Abadir's exams
still have `class_id = NULL` after the migration, and all 16 grades are intact.

**Live verification (QA tenant, real REST calls matching the frontend's query
shape):**

```
POST /rest/v1/exams {name:"QA Scoped Exam", class_id: <Grade 1A>}   → 201

GET  /rest/v1/students?select=id,first_name,last_name&class_id=eq.<Grade 1A>
  → 200 [{"first_name":"Abebe", ...}]        (roster correctly scoped to one class)

POST /rest/v1/grades {student_id: <Abebe, in Grade 1A>, exam_id: <the exam>, score:91}
  → 201                                       (in-class student: succeeds)

POST /rest/v1/grades {student_id: <Chaltu, in Grade 5A>, exam_id: <the exam>, score:85}
  → 400 {"code":"P0001","message":"student_not_in_exam_class"}   (out-of-class: rejected)
```

`score_exceeds_max` (the pre-existing guard) still fires correctly — proven in the
pgTAP suite (`exam_class_scoping.sql`), not just asserted.

---

## Fix 5 — Attendance audit trail + retroactive-edit gate

**File:line:** `supabase/migrations/20260821000005_attendance_audit_and_retroactive_gate.sql` —
`audit_attendance` trigger (same `audit_trigger()` function already used on
`grades`/`students`/`payments`), plus a new `override_retroactive`
resource-permission action (wired the same way `attendance`'s existing
`read`/`create`/`update` actions already are — a `permissions` catalog row +
`resource_default_role_grants` giving `school_admin` the override by default) and
a `RESTRICTIVE` policy on `UPDATE` only: a plain teacher can edit same-day
attendance but not a record older than the tenant's retroactive-edit window
(`tenant_configs.settings->>'attendance_retroactive_edit_days'`, default 7 days).
`INSERT` (a first-time backdated entry) is untouched — the finding was specifically
about *rewriting* already-recorded days.

**Live verification (QA tenant):**

```
POST /rest/v1/attendance {date: today, status: present}          → 201

POST /rest/v1/attendance {date: 30 days ago, status: present}    → 201  (first-time entry, unaffected)

PATCH (teacher) /rest/v1/attendance?id=eq.<30-day-old row> {status:"absent"}
  → 200 []           (RLS UPDATE-filtering: matched 0 rows, not a thrown exception —
                       matches this repo's own documented 0-row-match pattern)
GET  same row                                                    → status still "present" (confirmed unchanged)

PATCH (school_admin) /rest/v1/attendance?id=eq.<same row> {status:"excused"}
  → 200 [{"status":"excused"}]     (override succeeds)

audit_logs (table_name='attendance'):
  insert  <today's row>       old=null      new=present
  insert  <30-day-old row>    old=null      new=present
  update  <30-day-old row>    old=present   new=excused    (the admin's override edit — audited)
```

The teacher's blocked attempt correctly produced **no** audit_logs row (nothing
was actually written), which is the correct outcome for a no-op.

---

## Cross-tenant safety — final confirmation

Neither Aw Abdal nor Abadir was written to at any point during this pass. Every
check against them was a plain `select` via the Management API (row counts, tier
key, exam `class_id` values, grade counts) — no `insert`/`update`/`delete`
statement in any of the five migrations or verification steps referenced either
tenant's id. QA tenant test rows created during verification that weren't already
`QA`-prefixed by construction (one stray `library_books` row and one `subjects`
row from early sanity checks) were deleted immediately after use.

---

## Five Things to Fix First — status

| # | Finding | Status |
|---|---|---|
| 1 | RLS gap on `resource_open_actions`/`resource_default_role_grants` | **Fixed & verified** |
| 2 | Tenant suspension doesn't restrict anything | **Fixed & verified** |
| 3 | Module/plan gating isn't enforced server-side | **Fixed & verified** |
| 4 | No class scoping in Grading | **Fixed & verified** |
| 5 | Attendance has no audit trail / unrestricted retroactive edits | **Fixed & verified** |

All five of FINDINGS.md's top-priority items are closed. The remaining findings in
FINDINGS.md (High/Medium/Low across the other modules, and the "Features Never
Built" list) are unchanged by this pass and still stand as documented there.

*`audit/cleanup_qa_school.sql` still has not been run — the QA tenant remains live
in production, now carrying additional test rows from this verification pass (all
`QA`-prefixed or otherwise accounted for above). It should still be reviewed and
run by the user when ready, per the same standing policy as the original audit.*
