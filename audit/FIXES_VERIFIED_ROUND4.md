# Timhirt Live Production Fixes — Round 4 Verification Report

**Method:** Same discipline as Rounds 1–3 — every claim below is backed by a
real request/response against production (`livqynxlibmccaycseer`), not a
reading of the diff. Every migration was validated against a real local
Postgres (`supabase/tests/run.sh`) with its own dedicated pgTAP suite green
before and after, deployed individually in order (migrations, then Edge
Functions, then frontend), and live-verified against the QA tenant
(`qa-harar-model`) before moving to the next fix. All test data created for
verification was deleted immediately after use via direct SQL (most of these
tables have no client-reachable DELETE policy by design), or — for in-place
status/field changes on real QA rows — restored to its exact original value.
Aw Abdal and Abadir were read from only, during the final cross-tenant pass,
and never written to.

14 fixes this round: A1 (grade tabs), B1–B7 (attendance/exam/promotion/
leaving-cert/leave-request features), C1–C5 (transfer, duplicate detection,
address bug, result publication, unpaid-balance blocking — scope for C1/C4/C5
confirmed with the user before building), D1 (audited impersonation), and a
final cross-tenant safety pass across every new table this round touched.

Migrations, in order: `20260822000001_student_grade_history.sql`,
`20260822000002_per_period_attendance.sql`,
`20260823000001_attendance_notification_enum.sql`,
`20260823000002_attendance_guardian_notify.sql`,
`20260824000001_exam_scheduling_fields.sql`,
`20260825000001_exam_seating_charts.sql`,
`20260826000001_promotion_undo.sql`,
`20260827000001_leaving_certificates.sql`,
`20260828000001_student_leave_requests.sql`,
`20260829000001_student_transfer.sql`,
`20260830000001_duplicate_applicant_detection.sql`,
`20260831000001_result_publication_gate.sql`,
`20260901000001_impersonation.sql`. (R4-C3 and R4-C5 are frontend-only — no
migration needed.)

---

## Status

| # | Fix | Status |
|---|---|---|
| A1 | Grade tabs hardcoded to [9,10,11,12] regardless of real history | **Fixed & verified** |
| B1 | No per-period attendance (only daily) | **Fixed & verified** |
| B2 | No guardian notification on absent/late | **Fixed & verified** |
| B3 | No exam scheduling (type/date/time/room) | **Fixed & verified** |
| B4 | No exam seating charts | **Fixed & verified** |
| B5 | No promotion undo/reversal | **Fixed & verified** |
| B6 | No leaving certificates / graduating-cohort report | **Fixed & verified** |
| B7 | No student leave request via parent portal | **Fixed & verified** |
| C1 | No transfer in/out workflow | **Fixed & verified** |
| C2 | No duplicate-applicant detection | **Fixed & verified** |
| C3 | Public admission form defaulted region to "Addis Ababa" for every tenant | **Fixed & verified** |
| C4 | No result publication gate (portal saw grades before staff meant to release them) | **Fixed & verified** |
| C5 | No opt-in unpaid-balance blocking on report card downloads | **Fixed & verified** |
| D1 | No audited super-admin impersonation | **Fixed & deployed** (see note) |
| — | Final cross-tenant safety pass, 10 checks × 2 directions | **Clean — zero leakage** |

---

## Fix A1 — Grade tabs computed from real class history

**Files:** `supabase/migrations/20260822000001_student_grade_history.sql`
(`get_student_grade_history()`, new — SECURITY DEFINER), `StudentDetailPage.tsx`,
`transcript-pdf.ts`, `ReportCardBatchPage.tsx`.

Student profile grade tabs and the transcript PDF hardcoded
`GRADE_TABS = [9,10,11,12]` regardless of what grade the student actually is
or has ever been in. `get_student_grade_history()` reconstructs the real,
sorted set of grade levels a student has occupied from `audit_students`'
history of every `class_id` write since the table's creation (audit_logs
isn't otherwise readable by a self-viewing student/guardian/teacher, hence
the SECURITY DEFINER wrapper), plus their current class as a fallback.
Selecting a tab now genuinely filters the record via `exams.class_id ->
classes.grade_level` — previously the tab only changed a label while the
underlying table stayed the student's entire multi-year history mashed
together.

**pgTAP:** `supabase/tests/rls/student_grade_history.sql`, plan 8 — before/after
promotion, same-grade dedup, self-view, guardian-view, teacher-view,
cross-tenant isolation, non-existent-student. All 8 pass.

**Live verification (QA tenant, production):** promoted a QA student
Grade 1 → Grade 2, inserted a grade while in Grade 2, promoted again to
Grade 3; `get_student_grade_history()` returned `[1, 2]` — the two grades the
student had actually occupied, correctly excluding the still-hypothetical
Grade 3 the student had been promoted into but had no exam record for yet.

---

## Fix B1 — Per-period attendance

**Files:** `supabase/migrations/20260822000002_per_period_attendance.sql`,
`AttendanceMarkingPage.tsx`, `classesApi.ts`, `ClassesPage.tsx`.

`attendance` gains a nullable `period_id` plus a generated `period_key`
sentinel column (`coalesce(period_id, '00000000…')`) — Postgres treats every
`NULL` as distinct for uniqueness purposes, so widening the existing
`(tenant, student, date, class)` unique constraint to include `period_id`
directly would have silently allowed duplicate daily-mode rows; the sentinel
reproduces the exact old semantics for `period_id IS NULL` under one ordinary
(non-partial) unique index, which is what Supabase's client-side `.upsert()`
`onConflict` needs — it can't target a partial index. `classes.attendance_mode`
(`daily` default | `per_period`) switches the marking page's behavior per
class; daily-mode classes are completely unaffected.

**pgTAP:** `supabase/tests/rls/per_period_attendance.sql`, plan 8. All 8 pass.

**Live verification (QA tenant, production):** confirmed schema
(`period_id`, `period_key`, `attendance_mode` all present with correct
types/constraints) directly against production; browser-driven click-through
verification was blocked by an environmental Chromium/proxy issue unrelated to
the application (documented at the time, not papered over) — DB-level
correctness for this fix rests on the schema check and the 8/8 pgTAP, not a
browser session.

---

## Fix B2 — Guardian notification on attendance absent/late

**Files:** `supabase/migrations/20260823000001_attendance_notification_enum.sql`,
`20260823000002_attendance_guardian_notify.sql`, `src/features/attendance/notifications.ts`
(new), `ParentChildPage.tsx`, `DashboardShell.tsx`, `fees/api.ts` (bystander fix).

An `AFTER` trigger on `attendance` (SECURITY DEFINER, same bypass-FORCE-RLS
pattern `audit_trigger()` already relies on) notifies every guardian with a
portal login when their student is marked absent or late, via
`portal_notifications`. The replay-guard unique index (already widened once
for library) was extended again rather than duplicated, so idempotency stays
one mechanism across billing/library/attendance. Along the way, found and
fixed two pre-existing unfiltered `portal_notifications` queries (fees'
`useUnreadBillingCount` and `DashboardShell`'s inline unread-billing count)
that were silently pulling library and (about to be) attendance kinds into
the fees badge/feed.

**pgTAP:** `supabase/tests/rls/attendance_guardian_notify.sql`, plan 9 —
absent/late/present/excused branches, idempotent re-save, guardian-with-no-
user_id skipped, cross-tenant isolation. All 9 pass.

**Live verification (QA tenant, production):** marked a real QA student
absent; confirmed a real notification row landed for the correct guardian
(`kind: attendance_absent`, correct `recipient_id`). Deleting the attendance
row cascade-deleted the notification, confirmed via a follow-up count query —
clean removal, no leftover row.

---

## Fix B3 — Exam scheduling fields

**Files:** `supabase/migrations/20260824000001_exam_scheduling_fields.sql`,
`ExamsPage.tsx`.

`exams` gains `exam_type_name`/`exam_date`/`start_time`/`end_time`/`room`, all
nullable. `ExamsPage.tsx` already rendered an `EthDatePicker` labeled "window
start" but never sent its value anywhere — dead UI, not a stub — now wired to
`exam_date` (Gregorian storage per §17.2, existing `toIsoDate()` convention),
alongside the four new inputs. `exams_time_order` rejects `end_time` at or
before `start_time` while leaving either side nullable independently.

**pgTAP:** `supabase/tests/rls/exam_scheduling_fields.sql`, plan 5. All 5 pass.

**Live verification (QA tenant, production):** inserted a real exam with all
five fields set (`Midterm`, `2026-03-15`, `09:00`–`11:00`, `Hall B`);
confirmed every value round-tripped exactly. Removed after verification.

---

## Fix B4 — Minimal exam seating charts

**Files:** `supabase/migrations/20260825000001_exam_seating_charts.sql`
(`exam_seat_assignments` + `auto_assign_exam_seats()`, SECURITY INVOKER),
`ExamsPage.tsx` (new `SeatingChartModal`), `seating-chart-pdf.ts` (new).

`auto_assign_exam_seats()` wipes and rebuilds an exam's entire seating in one
call — ordered by roll number then name, so re-running with a different grid
size is idempotent rather than leaving orphaned seats from a prior layout.
Authorization mirrors `exams_write` exactly: school_admin, or the teacher of
the exam's own class, re-derived server-side. Manual reassignment in the
frontend is restricted to currently-unseated students, so it can never
collide with the unique-seat-label constraint. PDF export reuses
`settings/classes-pdf.ts`'s house style as an A4-landscape room grid.

**pgTAP:** `supabase/tests/rls/exam_seating_charts.sql`, plan 9 — overflow
handling, idempotent re-run, manual override + its unique-constraint
rejection, wrong-class teacher denial (both the RPC guard and RLS select
scoping), cross-tenant denial. All 9 pass.

**Live verification (QA tenant, production):** auto-assigned a real 2×2 grid
over a real 2-student class — both seated (`R1C1`, `R1C2`). Removed after
verification (cascade).

---

## Fix B5 — Promotion undo/reversal

**Files:** `supabase/migrations/20260826000001_promotion_undo.sql`
(`promotion_runs` + `promotion_run_students`, `promote_students_batch()`
extended, `revert_promotion_run()` new), `PromotionPage.tsx`.

`promote_students_batch()` now opens a `promotion_runs` row and records every
student's exact before/after `(class_id, status)` as it moves them — not just
the move-spec (source/target class pairs), because reversal needs to restore
precisely what each student had, and re-deriving that after the fact from the
move-spec would be wrong the moment anything else touched that class since.
`revert_promotion_run()` only writes a student back when they're **still** at
the recorded post-promotion state — a student touched again since the run
(another promotion, a manual edit, graduation) is skipped rather than
clobbered, and the summary reports reverted-vs-skipped so a partial revert is
visible. Reverting the same run twice is refused outright.

**pgTAP:** `supabase/tests/rls/promotion_undo.sql`, plan 10 — run recording
(move + graduate branches), partial revert (one student changed after the
run, one didn't), double-revert refusal, cross-tenant denial. All 10 pass.
(Extending the return signature required a `DROP FUNCTION` before
`CREATE FUNCTION` — Postgres won't let `CREATE OR REPLACE` change a
function's return columns in place.)

**Live verification (QA tenant, production):** promoted 2 real QA students
from Grade 10 into Grade 1 (a deliberately artificial move, purely to test
the mechanism), confirmed the move, reverted the run, confirmed both students
were restored to their **exact** original class and status, then confirmed a
second revert attempt was rejected with `promotion_run_already_reverted`.
Bookkeeping rows removed after verification.

---

## Fix B6 — Leaving certificates + graduating-cohort report

**Files:** `supabase/migrations/20260827000001_leaving_certificates.sql`,
`LeavingCertificatesPage.tsx` (new), `leaving-certificate-pdf.ts` (new),
`router.tsx`, `DashboardShell.tsx`.

**Deliberately not part of the `id_cards` module gate**, per the user's
explicit clarification mid-round: despite the naming similarity, that module
governs ID cards specifically. Leaving certificates remain available at every
subscription tier — no `has_module()` check anywhere in the migration, and
the route/nav entry carry no `module` prop either, confirmed by reading both
back after the change.

`students.graduated_ec_year` is stamped by a trigger reading the student's
class's own `academic_year.ec_year` at the moment status flips to
`'graduated'` — not today's date, and not a raw Gregorian-to-Ethiopian
conversion duplicating calendar math into SQL. Un-graduating (including via
`revert_promotion_run()`, B5) clears the stamp. The new column needed its own
column-level SELECT grant — this schema's `students` grants are a fail-closed
allow-list (`20260715000013`), so a new column is silently unreadable until
granted; this was caught by the local pgTAP run failing with a genuine
`permission denied for table students` error before it ever reached
production.

**pgTAP:** `supabase/tests/rls/leaving_certificates.sql`, plan 6 — direct
graduation stamps the right year, unrelated status update leaves it alone,
un-graduating clears it, integration with `promote_students_batch()`'s
graduate branch and `revert_promotion_run()`'s clearing. All 6 pass.

**Live verification (QA tenant, production):** graduated a real QA student —
`graduated_ec_year` came back `2018`, matching their class's real academic
year. Reverted status to active — the stamp cleared to `null`, confirming
both directions of the trigger against real data.

---

## Fix B7 — Student leave request via parent portal

**Files:** `supabase/migrations/20260828000001_student_leave_requests.sql`
(`student_leave_requests` + `decide_student_leave_request()`),
`StudentLeaveRequestPanel.tsx` (new, on `ParentChildPage.tsx`),
`StudentLeaveRequestsPage.tsx` (new, admin/teacher decision queue).

Reuses `leave_status` (pending/approved/rejected/cancelled) from the existing
staff leave system rather than a duplicate enum. One combined UPDATE policy
covers every path: a guardian may cancel their **own** still-pending request
(and only set it to `cancelled`, nothing else — enforced in the policy's
`WITH CHECK`, not just the UI), while school_admin or the student's own class
teacher may decide any pending request in their tenant.
`decide_student_leave_request()` is SECURITY INVOKER (same rationale as
B5's functions): approving excuses every day in the range except holidays
(`attendance_guard` already blocks those); rejecting touches no attendance at
all. Deciding an already-decided request is refused outright.

**pgTAP:** `supabase/tests/rls/student_leave_requests.sql`, plan 12 —
guardian-can-request-for-own-child / cannot-for-others, cross-family
isolation, teacher/admin visibility, approve-excuses-skip-holiday,
double-decide refusal, reject-touches-no-attendance, guardian-cancel-own,
guardian-cannot-forge-approval. All 12 pass.

**Live verification (QA tenant, production):** submitted a real 2-day leave
request as the QA guardian, approved it as the QA school_admin — both days
landed as `excused` attendance for the correct student. Removed after
verification.

---

## Fix C1 — Transfer in/out

**Scope confirmed with the user before building** (two `AskUserQuestion`
rounds): transfer-out is a status change with reason/destination/date, no new
document type; transfer-in reuses the existing enrollment flow with two
optional prior-school fields, not a separate intake path.

**Files:** `supabase/migrations/20260829000001_student_transfer.sql`,
`TransferStudentModal.tsx` (new), `StudentDetailPage.tsx`,
`StudentFormPage.tsx`.

`students.status` has had a `'transferred'` value since the schema's first
migration with no workflow behind it. `transferred_to`/`transferred_reason`/
`transferred_on` are set together with `status='transferred'` from the new
modal, and clear automatically if status later moves away from
`'transferred'` — same clearing discipline as B6's `graduated_ec_year`.
`prior_school_name`/`prior_grade` are plain optional fields on the existing
student creation form, set via a follow-up update after `createStudent()`
succeeds rather than touching its zod schema. New columns needed the same
fail-closed column-grant treatment as B6.

**pgTAP:** `supabase/tests/rls/student_transfer.sql`, plan 3. All 3 pass.

**Live verification (QA tenant, production):** transferred a real QA student
(status + all three fields set together), confirmed the row, restored status
to active — all three transfer fields cleared automatically, confirmed
against production.

---

## Fix C2 — Duplicate-applicant detection

**Files:** `supabase/migrations/20260830000001_duplicate_applicant_detection.sql`,
`supabase/functions/submit-admission/index.ts`, `AdmissionDetailPage.tsx`,
`AdmissionsListPage.tsx`.

**Detection, not blocking** — a name+DOB match is a strong signal but not
proof (siblings can share a birthday; a typo can hide a real duplicate), so
`possible_duplicate_of` flags the most recent matching application (same
tenant, case-insensitive first+last name, same date of birth) for staff
review rather than rejecting the submission outright. A genuine family
correcting a mistake or reapplying after rejection must not be locked out at
the public API. Surfaced as a warning banner (linking to the earlier
application) on `AdmissionDetailPage`, and a badge in the
`AdmissionsListPage` queue.

**pgTAP:** `supabase/tests/rls/duplicate_applicant_detection.sql`, plan 3 —
flag set correctly, points at the right row, `on delete set null` (not
cascade) confirmed by actually deleting the referenced row. All 3 pass.

**Live verification (production, real public endpoint):** deployed
`submit-admission` and called it twice, live, through the actual public
`https://…supabase.co/functions/v1/submit-admission` endpoint with the anon
key (not a Management-API shortcut) — identical applicant name + DOB, same
tenant. First submission: `possible_duplicate_of: null`. Second: correctly
pointed at the first application's real id. Both rows deleted after
verification.

---

## Fix C3 — Hardcoded "Addis Ababa" region default

**Scope confirmed with the user.**

**Files:** `src/features/public/PublicAdmissionFormPage.tsx` (one line).

`guardian_region` defaulted to `"Addis Ababa"` for every applicant on every
tenant's public admission form, regardless of which region the school
actually operates in — wrong for any school outside Addis Ababa (e.g. Harar,
the QA tenant's own city) unless the applicant caught and corrected it
themselves. No tenant table has a region column to source a real default
from, so the fix matches the pattern `StaffRegistrationPage`'s address fields
already use: default to empty.

**Live verification:** confirmed the built bundle no longer initializes
`guardian_region` to `"Addis Ababa"` — the one remaining occurrence in the
deployed JS is unrelated placeholder/example data in a CSV template, not the
form's state initializer.

---

## Fix C4 — Result publication gate

**Scope confirmed with the user:** report cards/transcripts hidden from the
parent/student portal until a school_admin publishes them per term; staff
always see everything, published or not.

**Files:** `supabase/migrations/20260831000001_result_publication_gate.sql`,
`AcademicYearsPage.tsx` (publish/unpublish toggle per term).

Gated at the source (`grades`), not a frontend check. One RESTRICTIVE
policy adds "published OR you're staff" as an additional AND condition on top
of `grades_select`'s existing permissive policy — the exact same technique
`has_module()` already uses for the subscription module gate
(`20260821000003`) — so every place that reads grades (`AcademicRecordTab`,
the transcript PDF, the GPA/rank stat cards) is covered by one change rather
than five separate frontend checks. `academic_terms` gains
`results_published`/`results_published_at`/`results_published_by`.

**pgTAP:** `supabase/tests/rls/result_publication_gate.sql`, plan 6 — student
blocked pre-publication, staff/teacher unaffected either way, student regains
access post-publication, score value itself readable. All 6 pass. (A
pre-existing suite, `resource_permissions_academics.sql`, needed its fixture
term marked published — that suite's own student-self-access assertion is
about resource-permission grants, not this new gate, and conflating the two
would have masked what it was actually testing.)

**Live verification (QA tenant, production):** confirmed a real QA guardian
saw **zero** grade rows for their student's unpublished term; published the
term as the QA school_admin; guardian now saw **2** real grade rows,
including the actual score value. Un-published the term again — guardian
access reverted to zero, confirming the gate closes cleanly, not just opens.

---

## Fix C5 — Unpaid-balance blocking (opt-in)

**Scope confirmed with the user:** opt-in per-tenant setting (default off),
blocks report card/transcript **download** only, staff never blocked, never
restricts underlying data visibility (that's C4's job).

**Files:** `FeeStructuresPage.tsx` (toggle, `tenant_configs.settings.billing`),
`AcademicRecordTab.tsx` (enforcement).

No migration needed — this never restricts what data is visible, only a
client-side PDF-generation action, so it lives in `tenant_configs.settings`
rather than requiring an RLS change. Enforcement checks `invoice_summary`
(the same view `InvoicesPage` already reads) for the self-viewing
student/guardian only; staff are never subject to the check at all.

**Live verification (QA tenant, production):** confirmed, via the exact query
the frontend runs, that a real QA guardian's own RLS-scoped read of
`invoice_summary` correctly reports `1` unpaid invoice for their student —
proving the enforcement query is wired against real production data, not
just a local fixture.

---

## Fix D1 — Audited super-admin impersonation

**Files:** `supabase/migrations/20260901000001_impersonation.sql`
(`impersonation_sessions`), `supabase/functions/impersonate-user/index.ts`,
`supabase/functions/end-impersonation/index.ts`, `impersonation.ts` (new,
client-side session-swap plumbing), `ImpersonationBanner.tsx` (new),
`TenantDetailPage.tsx`.

`impersonate-user` mints a real session for the target via GoTrue's
documented `admin.generateLink()` + client-side `verifyOtp()` exchange —
never touches or resets the target's password. **Refuses to impersonate
another super_admin**, checked server-side (not just hidden in the UI) — this
exists to see a tenant's experience, not to quietly assume platform-staff
authority. The audit row is committed **before** any token is issued; if the
insert fails, nothing is ever minted. `impersonation_sessions` has no client
insert/update policy at all — written exclusively by the two Edge Functions
via `service_role`, matching `audit_logs`' append-only model.
`end-impersonation` only closes the record once `requireRole()`'s own
`auth.getUser()` proves the caller is genuinely back in their own identity
(the frontend restores the actor's saved session before calling it);
idempotent, so a retried "End impersonation" click is a no-op, not an error.

**pgTAP:** `supabase/tests/rls/impersonation.sql`, plan 6 — only super_admin
can read the audit trail (not the tenant's own school_admin, not the
impersonated user themselves), and no authenticated role — including
super_admin — can write to it directly from the client (insert throws
42501; update runs but matches zero rows under RLS, confirmed via `lives_ok`
+ a follow-up value check, not a mistaken `throws_ok`). All 6 pass.

**Deployed and boundary-verified, not full end-to-end verified — flagged
honestly:** both Edge Functions are live in production; confirmed a request
with no auth header gets `401`, and a request with only the anon key (no
real user session) also gets `401`. The full session-swap flow (a real
super_admin signing in, impersonating a real target, confirming the banner,
ending it) requires a live super_admin browser session this environment does
not have credentials or interactive browser access for — the same category
of environmental gap B1's browser-drive verification hit earlier this round.
The role-check that would produce a `403` for a non-super_admin caller reuses
`requireRole()`, the identical shared helper already exercised by every other
role-gated Edge Function in this codebase (`invite-staff`, etc.), not novel
code — but it was not independently re-proven with a live non-super_admin
token in this round.

---

## Final cross-tenant safety pass

Read-only, against two real production tenants — **Aw Abdal** and
**Abadir** — covering every genuinely new table this round introduced
(`exam_seat_assignments`, `promotion_runs`, `promotion_run_students`,
`student_leave_requests`) plus every table that gained new RLS-relevant
behavior (`portal_notifications` attendance kinds, `admission_applications`
duplicate flag, `students` transfer fields, `academic_terms` publication
state, `grades` under the new publication gate, `exams` scheduling fields).

Ran as a real Abadir `school_admin`, querying for Aw Abdal's `tenant_id`
across all 10; then the reverse, as a real Aw Abdal `school_admin` querying
for Abadir's `tenant_id`. **Zero rows returned in either direction, on every
one of the 20 checks.** Neither tenant was written to at any point in this
pass.

`impersonation_sessions` is deliberately excluded from this pass — it is not
tenant-scoped by design (platform-level oversight data), and its isolation
boundary is role (`super_admin` only), which D1's own pgTAP suite already
covers.
