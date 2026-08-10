# Timhirt Live Production Audit — Findings

**Method:** Acting as platform super-admin, a new tenant ("QA - Harar Model
Secondary School", slug `qa-harar-model`) was created through the product's
real onboarding Edge Function (not raw SQL), its first admin invited and
logged in through the real Supabase invite-link flow, and the system then
driven end-to-end as that school — and as each role invited under it — using
direct REST calls that replicate exactly what the deployed frontend code
does (Chromium in this sandbox cannot reach the internet, so every "login"
and "click" below is the literal HTTP request the browser would have made,
read from source, not simulated). All test data is prefixed `QA-` /
`qa-harar-model` and is confined to one tenant; every pre-existing tenant
(Aw Abdal, Abadir) was only ever read, never written.

Severity: **Critical** = cross-tenant leak / auth bypass / data loss / wrong
money-or-grade output. **High** = school cannot complete a core workflow.
**Medium** = workaround exists. **Low** = polish.

Environment: production project `livqynxlibmccaycseer`, no staging exists.

---

## Onboarding

Tenant creation, admin invite, and first login all work end-to-end through
the real `onboard-tenant` function and Supabase's native invite-link flow;
academic-year and tenant-config auto-seeding are correct, but the function's
period auto-seed silently produces zero rows.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| Medium | `onboard-tenant` unconditionally inserts 9 `periods` rows (Period 1-8 + Break) for the new tenant, but production has **zero** period rows for the new tenant after a successful 201 response — confirmed still zero hours later, unrelated to any race condition. A school_admin logging into a brand-new tenant finds the Timetable Editor with no periods to place anything into. Not a dead end, though: `TimetableEditorPage.tsx` has a self-service "seed standard shift" one-click action offered exactly when a shift has no periods yet, so the gap is recoverable without support intervention — downgraded from an initial High assessment once that workaround was found. | `supabase/functions/onboard-tenant/index.ts:99-109` (insert code, silently produces 0 rows) vs. live `GET /rest/v1/periods?tenant_id=eq.ea037a5b-963f-499c-91a8-5d507a2b123b` → `content-range: */0`, both immediately after onboarding and again after unrelated work. Function returned 201 with `{tenant_id, ec_year}`, no error surfaced. Workaround: `TimetableEditorPage.tsx:187-199` `seedShiftPeriods` mutation, live-tested working (see Scheduling module). | Root-cause the silent failure (no Edge Function log access via REST here; reproduce the insert directly against the same shape to surface the real Postgres error — likely worth checking for an RLS/service-role mismatch specific to this one insert in the function). Low urgency given the in-app recovery path exists and is one click. |

**Works:** tenant row created (`status='trial'`), `public.users` row created
with correct `role='school_admin'` + `tenant_id`, invite email sent and its
link a real, working Supabase Auth invite (`type=invite`) that resolves to a
session and lets the new admin set a password via `PUT /auth/v1/user` —
exactly what `AcceptInvitePage.tsx` does — after which a normal
password-grant login succeeds. `academic_years` seeded correctly (1 row,
correct current EC year 2018, correct trilingual label, correct Gregorian
`starts_on`/`ends_on`). `tenant_configs` seeded correctly (default locale,
calendar flags, branding color). `academic_terms`, `subjects`,
`fee_structures`, `classes` are correctly empty — not part of onboarding's
auto-seed by design (terms need the separate "Generate 4 terms" action;
confirmed by reading `onboard-tenant/index.ts` in full).

---

## Academic Setup

Year/term generation, grade levels, classes/sections, subjects with grade
ranges, subject-teacher assignment, cycle-mismatch enforcement, capacity,
and homeroom-teacher assignment all work correctly; the one gap is that the
`invite-staff` Edge Function currently deployed to production is stale and
silently drops the teaching-cycle field the repo's code sends it.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| Medium | The **deployed** `invite-staff` Edge Function does not implement `teaching_cycle_key` at all — it silently accepts and discards the field instead of validating it, even though the repo's `supabase/functions/invite-staff/index.ts:49` declares it as a strict zod enum (`first_cycle\|second_cycle\|lower_secondary\|upper_secondary`) that should 400 on an invalid value. Proof: inviting a teacher with `teaching_cycle_key:"not_a_real_cycle_xyz"` (not a valid enum member, and not even a valid `grade_cycles.key` FK target) returned `201` and the resulting `teachers` row has `teaching_cycle_key: null`, not a validation error. A second invite with a genuinely valid value (`"first_cycle"`) also landed as `null`. This is a deploy-drift bug of exactly the kind `CLAUDE.md` warns about ("a `READY` deployment is not a shipped deployment") — the code, migration (`20260819000001`), and UI (`TeachersPage.tsx`) all exist and are correct, but the production Edge Function predates them. | `supabase/functions/invite-staff/index.ts:49,104` (repo's intended behavior) vs. live `POST /functions/v1/invite-staff` with `teaching_cycle_key:"not_a_real_cycle_xyz"` → `201 {"user_id":"4c8524f5-..."}`, then `GET /rest/v1/teachers?...` → `teaching_cycle_key: null` for both test invites. | Redeploy `invite-staff` (it's on the standard 14-function shared-file deploy list per the `deploy` skill). Workaround in the meantime: `TeachersPage.tsx`'s direct `teachers` table PATCH (confirmed working live, see below) lets an admin set the cycle immediately after invite. |

**Works:** "Generate 4 terms" (`AcademicYearsPage.tsx`) correctly reuses an
existing `academic_years` row by `ec_year`, computes an even 4-way Gregorian
split, and upserts with `ignoreDuplicates` — verified live: 4 terms created
spanning the full seeded year with no gaps/overlaps. Classes/sections
(`grade_level`, `section`, `capacity`) create correctly across cycles
(Grade 1-A, 5-A, 9-A tested). Subjects with `min_grade`/`max_grade` ranges
create correctly (Mathematics 1-12, English 1-12, Amharic 1-8, Biology
9-12). `invite-staff` itself works end-to-end for teacher/registrar/
accountant/librarian (all 4 real 201s, correct `users` + `teachers` rows,
correctly tenant-scoped, correctly rejects a caller-supplied
`teaching_cycle_key` that isn't wired — see above). The direct table-write
workaround for setting a teacher's cycle after invite (`TeachersPage.tsx`'s
`supabase.from("teachers").update({teaching_cycle_key})`) works and is
correctly enforced afterward: a matching-cycle assignment
(first_cycle teacher → Grade 1, first_cycle) succeeded; a mismatched
assignment (same teacher → Grade 9, lower_secondary) was correctly rejected
by the `class_subject_teachers_cycle_guard` trigger with
`teacher_outside_assigned_cycle`; the same mismatched assignment with
`cycle_override:true` correctly succeeded. Homeroom-teacher assignment
(`classes.homeroom_teacher_id`) works. `classes.capacity` is genuinely
enforced server-side inside `enroll_admission_application()` (confirmed by
reading the function; live capacity-exhaustion test carried out in the
Admissions module below, where capacity actually gets exercised).

---

## Admissions / Enrollment

The full pipeline — public application (with real Amharic-name fields),
document upload, review checklist, capacity-checked enrollment, guardian
linkage, ID card issuance, portal-account provisioning, first invoice, and
bulk CSV import — all work correctly end-to-end against production; the
gaps are three features the task brief specifically asks about that simply
don't exist (duplicate detection, transfer in/out, address cascading), plus
one cross-cutting date-presentation inconsistency.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| Medium | **No duplicate-applicant detection anywhere.** The exact same applicant (same name, DOB, guardian, phone) was submitted twice through the public form and both were accepted with distinct `application_id`s and no warning, flag, or block — server or client. `submit-admission/index.ts` does a single unconditional insert with no matching query against existing applications; `AdmissionsListPage.tsx`/`AdmissionReviewModal.tsx` have no "possible duplicate" indicator. A registrar has no help catching this short of eyeballing the list. | Live: two identical `POST /functions/v1/submit-admission` calls both returned `201` (`application_id: 9463e6c2…` and `7349587d…`). Grep for "duplicate" across `src/features/admissions` and `submit-admission/index.ts`: no matches. | Add a same-tenant match query (name + date_of_birth, or guardian_phone) before insert; surface a non-blocking "possible duplicate of application #X" warning to the reviewer rather than silently rejecting (a legitimate re-application after a rejection must still be possible). |
| Medium | **"Transfer in/out" does not exist as a feature.** `student_status` has a `'transferred'` enum value, and `StudentsListPage.tsx` can *filter* by it, but no code anywhere ever *sets* a student to `'transferred'` — no lightweight transfer-in intake (as distinct from a full admission application), no transfer-out action that captures a destination school and frees the vacated capacity slot, no leaving-certificate generation tied to it. A school can only reach this status via a raw database write. | `supabase/migrations/20260713000002_academic.sql:7` (enum). Grep across `src/`: zero writes of `status.*transferred`; `StudentsListPage.tsx:87` is a read-only filter option, nothing else references it. | Build a dedicated transfer-out action (capture destination + date, set status, free the class seat) and a transfer-in intake (lighter than the full admissions pipeline — no application/review stages needed for a student already vetted by another school). |
| Medium | **No Region/Zone/Woreda/Kebele cascading anywhere.** All four guardian-address fields (`guardian_region`, `guardian_subcity`, `guardian_woreda_kebele`, `guardian_house_number`) are plain free-text `<Input>` on the public form, validated server-side only as `z.string().trim().max(80).optional()` — no administrative-division list, no cascading Region→Zone→Woreda→Kebele selects, and the Region field defaults to the hardcoded string `"Addis Ababa"` regardless of the school's actual location (had to be manually overtyped to `"Harari"` for this Harar-based QA school). | `src/features/public/PublicAdmissionFormPage.tsx:279,571-583` (three plain `<Input>`s), `supabase/functions/submit-admission/index.ts:51-54` (freeform zod). | Either accept this is intentionally freeform (common for schools with no canonical address-list dependency) and drop it from the presentation as a gap, or build the cascading selects — but the hardcoded "Addis Ababa" default should at minimum come from the tenant's own configured region, not a constant. |
| Low | Generated PDFs (invoice, receipt, ID card) show **only the Gregorian date**, explicitly labeled "(GC)", with no Ethiopian-calendar equivalent anywhere on the document — unlike every other date surface in the app, which goes through `<EthDate/>`/`formatEth` per §17.2. Neither `_shared/fee-pdf.ts` nor `issue-id-card/index.ts` calls the Ethiopian-date engine at all. May be a deliberate choice (GC is standard on Ethiopian financial/bank documents), but it isn't documented as one anywhere in either file. | Live: `abebe_invoice.pdf` — "Issued: 2026-08-10 (GC)" / "Due: 2026-08-10 (GC)", no EC date. `abebe_idcard.pdf` — "DOB (GC): 2019-03-15", no EC date. `supabase/functions/issue-id-card/index.ts:314` (`new Date().toISOString().slice(0,10)`, no `toEthiopian`/`formatEth` import in the file at all). | If intentional, add a one-line comment saying so (matches this repo's own convention of flagging deliberate exceptions); if not, add the EC date alongside GC the same way `<EthDate/>` renders both in-app. |

**Works:** Public application submission (`submit-admission`) correctly
validates and stores parallel English/Amharic name fields, resolves the
tenant by slug only (never trusts a client-supplied `tenant_id`), and
returns a tracking code; `check-admission-status` correctly looks up by
that code and discloses only minimal applicant-safe fields. Document
upload (`upload-admission-document`) correctly accepts and stores a photo
against the application. The review checklist (six independent toggles +
stage) and the reject path both write correctly. `enroll_admission_application()`
correctly converts an application to a student atomically (student +
guardian insert + application update in one function), auto-generates the
admission number, and **genuinely enforces class capacity server-side** —
live-verified by enrolling one student into a capacity-1 section (succeeded)
then attempting a second directly via RPC, bypassing the UI's disabled-option
guard entirely (correctly rejected: `selected section is at capacity`).
`issue-id-card` produces a real two-page CR-80 PDF with a working QR
verify code (`verify-id` correctly resolves it publicly) and a Code128
barcode; **Ethiopic text genuinely renders correctly** when a template
field uses `fontFamily: NotoSerifEthiopic` (live-tested: "አበበ ከበደ ተስፋዬ"
renders with real glyphs, not tofu/blank — the font-loading defense in
`issue-id-card/index.ts:57-96` — SFNT magic-byte verification, loud
console.error on failure rather than a silent Helvetica fallback — is
working as designed). `provision-portal-accounts` correctly creates both
the no-email synthetic-address+temp-password path (used for the student
account and one guardian) and is architecturally identical to the already-
proven `inviteUserByEmail` path for a guardian who does have an email on
file. `enroll-finalize-billing` correctly creates an invoice header + line
item, renders a real PDF with correct ETB formatting (`ETB 1500.00`, no $
signs, correct 2-decimal rounding), and correctly produces no receipt when
no payment evidence was declared. Bulk CSV import
(`process-import-job`, entity_type=`students`) correctly parses
Amharic-name columns and Ethiopian-calendar date-of-birth columns
(`"2003-05-10"` EC → `"2011-01-18"` GC, a plausible conversion), resolves
an unambiguous grade-only class alias, and continues the same
admission-number sequence used by the manual-enrollment path (`QHR03-0001-2`
→ `QHR03-0003-8`/`QHR03-0004-6`) — both paths share one numbering scheme,
0 errors across the batch.

---

## Scheduling / Timetables

Manual period and slot management both work, and conflict prevention is
genuinely enforced at the database level for all three collision types
(class, teacher, room) rather than only in the UI; the one real defect is
that the two different places in this codebase that seed a starting set of
periods for a new tenant use two incompatible time conventions.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| Medium | **Two period-seeding code paths use two different, incompatible clock conventions, and neither is labeled.** `onboard-tenant/index.ts:99-109`'s (non-functional, see Onboarding) 9-row insert uses ordinary Western 24h time (`"08:30"`, `"09:10"` … `"14:10"`, a normal 8:30am–2:10pm school day). `TimetableEditorPage.tsx`'s "seed standard shift" action (`STANDARD_SHIFT_PERIODS`, the one actually reachable and working today) instead seeds literal **Ethiopian-clock** hour values verbatim per its own code comment ("its own Ethiopian clock values verbatim") — `"02:00"`–`"06:30"` for "morning," which is Ethiopian 2:00–6:30 (≈ Western 8:00am–12:30pm), not literal 2am–6:30am. Live-confirmed: seeding "morning shift" produced rows literally reading `starts_at: "02:00:00"`. The display layer (`TimetableEditorPage.tsx:357`, `p.starts_at.slice(0,5)}–{p.ends_at.slice(0,5)}`) prints this completely unqualified — no "Ethiopian time" label, no conversion — right next to a plain HTML `<input type="time">` (line 318/321) for manual entry, which is an ordinary Western-clock control with zero Ethiopian-clock awareness. A school_admin who manually adds a period next to auto-seeded ones will end up with some rows in Ethiopian-clock notation and some in Western-clock notation, visually indistinguishable, both just "HH:MM" in the same list — and any parent/teacher reading a raw "02:00" with no context will reasonably read it as 2am. | Live: `POST /rest/v1/periods` (seed standard morning shift) → `starts_at:"02:00:00"`. Compare `supabase/functions/onboard-tenant/index.ts:100` (`"08:30"`) to `src/features/timetable/TimetableEditorPage.tsx:34` (`"02:00"`) for the same "Period 1" concept. Display: `TimetableEditorPage.tsx:357`. | Pick one convention (Western is far less error-prone given the rest of the app already treats `time`/`timestamptz` columns in standard 24h form) and make both seeders agree; if Ethiopian-clock display is genuinely wanted for this one feature, build and use a real formatter (mirroring `<EthDate/>`'s pattern) instead of printing a raw unlabeled string, and swap the manual-entry `<input type="time">` for something that collects the same convention it displays. |

**Works:** Manual period CRUD (add/edit/delete) and the standard-shift
one-click seeder both write correctly. Timetable slot conflict prevention
is **genuinely enforced server-side**, not just UI-side — live-verified all
three collision types by direct REST inserts bypassing any client-side
guard: a class already booked for a given day+period correctly rejects a
second subject in that slot (`timetable_class_slot_unique`, 409); a teacher
already booked for that day+period correctly rejects a second class
assignment (`timetable_teacher_slot_unique`, 409); a room already in use
for that day+period correctly rejects a second class+teacher pair in it
(`timetable_room_slot_unique`, 409) — even across two entirely different
classes and teachers. This is a solid, well-designed piece of the product.

---

## Attendance

Daily roster marking works correctly, including a genuinely-enforced
holiday block and server-stamped `recorded_by`; but the module only ever
existed at day-granularity, one status value is wired into the data model
and dashboard yet unreachable from any marking UI, and retroactive edits
are both unrestricted and completely invisible.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| High | **Retroactive attendance edits are unrestricted and leave zero trail.** Any actor who can mark attendance at all (a teacher of that class, or `school_admin`/anyone `has_resource_permission(attendance, update)`) can silently rewrite any past date's record with no separate approval, no date-window limit, and — critically — `public.attendance` has no `audit_trigger` attached (unlike `students`/`guardians`, which do). Live-verified: flipped an already-saved "present" record to "absent" for a prior date; `audit_logs` showed `content-range: */0` both immediately before and immediately after, for `table_name=attendance` in this tenant. `recorded_at` also doesn't refresh on `UPDATE` (no `set_updated_at`-style trigger), so a retroactively-edited row is byte-for-byte indistinguishable from one marked correctly on the day. | Live: two `GET /rest/v1/audit_logs?...table_name=eq.attendance` calls (before/after) both `content-range: */0`. `supabase/migrations/20260713000003_attendance_grades_fees.sql:36` (only trigger on the table is `attendance_guard`, holiday-block + `recorded_by` stamp — no audit). | Attach an audit trigger to `attendance` (or a purpose-built one that also captures "changed N days after the fact"); consider gating an edit older than some threshold behind a stricter permission than the one used for same-day marking. |
| Medium | **No per-period attendance exists** — only whole-day. `public.attendance`'s unique key is `(tenant_id, student_id, attendance_date, class_id)`; there is no `period_id` column and no marking UI that offers one. A secondary school that wants attendance taken separately each class period (not just once a day) has no path to that at all. | `supabase/migrations/20260713000003_attendance_grades_fees.sql:10-20` (schema). `src/features/attendance/AttendanceMarkingPage.tsx` — one roster, one date, one status per student, no period selector anywhere. | Would need a schema change (add `period_id`, widen the unique key) plus a marking-UI rework — a real feature, not a quick fix; flagging as a gap for the school to weigh, since many Ethiopian primary/lower-secondary schools genuinely only need daily marking. |
| Medium | **`half_day` is a dead status** — added to the `attendance_status` enum and aggregated by the dashboard RPC, but no marking UI ever offers it. `AttendanceMarkingPage.tsx`'s `STATUSES` constant is hardcoded to `["present","absent","late","excused"]`; there is no fifth button/segment for it anywhere. A record can only ever become `half_day` via a direct database write. | `supabase/migrations/20260729000001_attendance_half_day.sql:18` (enum value added) + `supabase/migrations/20260729000002_dashboard.sql:155,164` (dashboard RPC counts it) vs. `src/features/attendance/AttendanceMarkingPage.tsx:13-14` (`STATUSES` missing it entirely). | Add `half_day` to `STATUSES`/`TONE` in the marking page (small, contained change) — the backend and reporting side are already built and waiting for it. |
| Medium | **No guardian notification exists for attendance at all** — marking a student absent/late triggers nothing: no `portal_notifications` row, no SMS (the SMS interface exists but has zero callers anywhere per this repo's own design — see Fees module), no email. A parent only ever finds out by checking the portal themselves. | Grep across the whole repo for any attendance→notification link: zero matches. Compare to Fees, where `notifyBilling()` genuinely fires on invoice/payment events (`enroll-finalize-billing/index.ts:156,178`). | Out of scope for a quick fix (no SMS provider is actually wired yet either — see Fees/Integrations), but worth listing explicitly as never built, since it's one of the more commonly expected features of a school attendance system. |

**Works:** Roster-based daily marking (pick a class + date, mark every
student with a segmented present/absent/late/excused control, save as one
batch) writes correctly via `upsert` on the natural key, so re-saving the
same day never duplicates. The holiday-block trigger is **genuinely
enforced**, not decorative — live-verified by creating a real
`calendar_events` "national" holiday row and then attempting to mark
attendance on that exact date: rejected with `attendance_blocked_holiday`
(400), exactly matching what the marking page's `holidayBlocked` banner is
built to surface. `recorded_by` is stamped server-side by the trigger
(`new.recorded_by := auth.uid()`), never trusted from the client, so a
forged "recorded by" value isn't possible via a direct API call either.
RLS correctly scopes writes to either a teacher of that specific class
(`is_teacher_of_class(class_id)`) or the permission-matrix-governed
admin/registrar role — a normal school day (2026-08-09, non-holiday) was
marked successfully as `school_admin`.

---

## Grading

Score-bound enforcement and audit logging both genuinely work; but the
gradebook has no concept of "this exam belongs to this class," which makes
it break down at any real school size, and three of the module's headline
features — GPA, class rank, and the Ethiopian grading scale actually being
applied to a score — are configured or displayed but never computed.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| High | **No class scoping anywhere in grading.** `exams` has no `class_id` (only `academic_term_id`); `grades` has no `class_id` either. `GradebookPage.tsx`'s student list is `supabase.from("students").select(...)` with **zero filter** — every score-entry screen shows literally every student in the entire school in one flat list, regardless of which class/grade the exam is actually for. At a school with more than a handful of students this is unusable, and nothing stops a teacher from entering a score for a student in a completely different grade than the exam was meant for — the system has no way to even express "this exam is for Grade 5" in the first place. | `supabase/migrations/20260713000003_attendance_grades_fees.sql:39-46` (`exams`, no class_id) and `:48-59` (`grades`, no class_id). `src/features/gradebook/GradebookPage.tsx:18` (`students-brief` query, no `.eq("class_id", ...)` anywhere in the file). | Add a `class_id` to `exams` (or a join table if one exam can span multiple sections of a grade) and filter the gradebook roster by it — the same shape `attendance`/`timetable_slots` already use successfully elsewhere in this codebase. |
| Medium | **"Current GPA" and "Class Rank" are permanently dead stat cards.** Both are rendered on `StudentDetailPage.tsx` and the Academic Record tab, and both are hardcoded to the literal string `"—"` — no query, no calculation, nothing. Grep across the entire repo for any rank/GPA computation (SQL function, RPC, or client-side aggregate) found none. | `src/features/students/StudentDetailPage.tsx:243,245` (`statCard(t("students.profile.currentGpa"), "—")`, `statCard(t("students.profile.classRank"), "—")`). `src/features/students/tabs/AcademicRecordTab.tsx:147-148` (same pattern, "Class Rank" card). | Build the actual aggregation (GPA from weighted exam scores per the grading scale; rank from ordering same-class students by that GPA/average) — this needs the class-scoping fix above to even be well-defined per exam. |
| Medium | **Grading Scales are configured but never applied.** `GradingScalesPage.tsx` lets a school define real percentage-to-letter bands (the actual Ethiopian A/B/C/D/F scale this repo's blueprint describes), but grep across `src/` shows `grading_scales` is referenced by exactly two files: the settings CRUD page itself, and the permissions matrix (which only governs who may edit the bands). No report card, gradebook view, or student profile ever looks up a score against these bands to show a letter grade. | Grep `grading_scales` across `src/`: `src/features/settings/GradingScalesPage.tsx`, `src/features/settings/access/PermissionsMatrixTab.tsx` only. | Wire a lookup (score/GPA → matching band → letter) into whichever surface actually needs to show it — most naturally the report card generator (see Report Cards module) and the dead GPA/rank cards above. |
| Medium | **No teacher-submit vs registrar-override workflow exists.** `grades_insert`/`grades_update` RLS grants write access identically to "teacher of that class" and to anyone with the `grades` permission-matrix grant, at all times — there's no submitted/locked state, no visible "entered by X, later changed by Y" in any UI (even though `audit_logs` genuinely does capture it server-side — see Works below). Functionally identical gap to Attendance's retroactive-edit finding, but at least here the underlying audit trail exists; only the UI to see it is missing. | `supabase/migrations/20260817000002_resource_permissions_academics.sql:280-288` (`grades_insert`/`grades_update`, no workflow-state check). | If a formal submit/override workflow is wanted, add a status column to gate `update` more strictly once a teacher has submitted; otherwise at minimum surface `audit_logs` history on a grade in the UI so a registrar can see it was overridden, since the data is already there. |
| Low | No "N students missing a mark" indicator anywhere in `GradebookPage.tsx` — an unscored student is just a blank input, indistinguishable from a 0 that hasn't been typed yet. | `src/features/gradebook/GradebookPage.tsx:48-56`. | Track and surface a distinct "not yet entered" state per cell. |

**Works:** Mark-bound enforcement is genuinely server-side, not just a
client-side `max` hint — live-verified: an 85/100 score on a real "Midterm
Exam" (max_score 100) saved correctly, and a 150/100 attempt on the same
exam was rejected with `score_exceeds_max` (400) by the `grade_guard`
trigger, exactly mirroring the capacity-enforcement pattern seen in
Admissions. `entered_by` is stamped server-side, never trusted from the
client (same pattern as attendance's `recorded_by`). Unlike attendance,
`grades` **does** have a real audit trail — `audit_trigger` is attached,
and a live insert produced a genuine `audit_logs` row with the full new
score, actor, and timestamp captured. Multiple weighted assessment types
per term (`exams.max_score`/`weight`) create and list correctly.

---

## Exams

Mark capture works (it's the same `grades`/`exams` mechanism already
verified in the Grading module above); everything else the task brief asks
about this module — scheduling, seating, result publication, and
unpaid-balance blocking — was never built.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| Medium | **No exam scheduling exists.** `exams` in this product is purely an assessment-type definition — `name_i18n`, `max_score`, `weight`, `academic_term_id`, and an unused `category` column — with no date, no start/end time, no room. There is no representation anywhere of "this exam sits on this day, in this room." | `supabase/migrations/20260713000003_attendance_grades_fees.sql:39-46` (full `exams` schema). Grep for `exam_date`/`exam_room`/`exam_schedule` across the whole repo: zero matches. | Would need a real scheduling table (or reuse `timetable_slots`/`calendar_events`-shaped fields) if exam-day logistics are wanted as a product feature. |
| Medium | **No seating chart / seat assignment feature exists at all.** Grep for "seating" across the entire repo (migrations and `src/`) returns zero matches. | Grep, zero hits. | Never built — flagging for completeness per the audit brief, not implying it's a regression. |
| Medium | **No result-publication gate.** A score is visible to the student and their guardian the instant it's saved — live-verified: entered an 85/100 Midterm score as `school_admin`, then immediately queried it as the logged-in student account and got it back with no delay, no "draft" state, no batch-release action anywhere. `grades_select` RLS has no `published`/`released` condition, and no such column exists on `grades` or `exams`. | Live: `POST /rest/v1/grades` (score 85) as school_admin, followed immediately by `GET /rest/v1/grades` as the student's own logged-in session → returns the row. `supabase/migrations/20260817000002_resource_permissions_academics.sql:273-279` (`grades_select`, no publish-state check). | If a school wants results held back until finalized (common practice — releasing marks class-by-class after review), add a `published_at`/`status` gate to the read policy for the student/guardian branch specifically (staff branches should stay unaffected). |
| Medium | **No unpaid-balance blocking anywhere.** Grep for any fee-balance check gating exam results, report cards, or grade visibility: zero matches in `src/`. A student with a large outstanding invoice sees their grades exactly the same as a student with a zero balance. | Grep across `src/` for `unpaid`/balance-gating patterns near grades/report-card code: no matches. | Never built — a common requirement in fee-funded schools; would need a check against `invoice_summary`/outstanding balance wired into whichever surface (report card generation is the most natural place) is meant to enforce it. |

**Works:** Mark capture and its guardrails are exactly what's documented
in the Grading module above — server-enforced score bounds, server-stamped
`entered_by`, and a real audit trail on every write. No additional
exam-specific mechanism exists beyond that, for better or worse.

---

*(Audit in progress — remaining modules appended below as they are tested.)*
