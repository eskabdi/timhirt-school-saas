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
| Medium | `onboard-tenant` unconditionally inserts 9 `periods` rows (Period 1-8 + Break) for the new tenant, but production has **zero** period rows for the new tenant after a successful 201 response — confirmed still zero hours later, unrelated to any race condition. A school_admin logging into a brand-new tenant finds the Timetable Editor with no periods to place anything into. Not a dead end, though: `TimetableEditorPage.tsx` has a self-service "seed standard shift" one-click action offered exactly when a shift has no periods yet, so the gap is recoverable without support intervention — downgraded from an initial High assessment once that workaround was found. **This turns out to be one of two confirmed instances of the same class of gap — onboarding not keeping pace with new tenant-scoped default-settings tables — see `library_settings` in the Library module below (a different mechanism: that insert is never attempted at all, rather than attempted and silently failing, but the practical effect on a new school is the same shape of gap).** | `supabase/functions/onboard-tenant/index.ts:99-109` (insert code, silently produces 0 rows) vs. live `GET /rest/v1/periods?tenant_id=eq.ea037a5b-963f-499c-91a8-5d507a2b123b` → `content-range: */0`, both immediately after onboarding and again after unrelated work. Function returned 201 with `{tenant_id, ec_year}`, no error surfaced. Workaround: `TimetableEditorPage.tsx:187-199` `seedShiftPeriods` mutation, live-tested working (see Scheduling module). | Root-cause the silent failure (no Edge Function log access via REST here; reproduce the insert directly against the same shape to surface the real Postgres error — likely worth checking for an RLS/service-role mismatch specific to this one insert in the function). Low urgency given the in-app recovery path exists and is one click; see the Library module for the systemic fix recommendation. |

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
| Medium | **"Current GPA" and "Class Rank" stat cards are permanently dead**, even though a GPA formula genuinely exists elsewhere in the codebase. Both cards on `StudentDetailPage.tsx` and the Academic Record tab are hardcoded to the literal string `"—"` — no query, no calculation. A working GPA calculation (`gp()`) does exist, but only inside the transcript-PDF generator (see Report Cards module) — it's never called to populate these on-screen cards. Class rank has no calculation anywhere, in the PDF or otherwise. | `src/features/students/StudentDetailPage.tsx:243,245` (`statCard(t("students.profile.currentGpa"), "—")`, `statCard(t("students.profile.classRank"), "—")`). `src/features/students/tabs/AcademicRecordTab.tsx:147-148` (same pattern) vs. that same file's own working `gp()` at line 225, used only for the PDF. | Reuse the existing `gp()` logic for the on-screen card instead of leaving it stranded in the PDF path; build class rank fresh (needs the class-scoping fix above to be well-defined per exam). |
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

## Report Cards / Transcripts

The one real, working document generator (a per-student transcript,
correctly pulling live grade data and rendering an Ethiopian issue date)
sits right next to a completely dead batch-generation page, and the
transcript's grading logic quietly duplicates and diverges from the
school's own configured grading scale.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| High | **The class-level "Report Cards" batch page is a dead button.** `ReportCardBatchPage.tsx` lets an admin check off classes and shows a "Queue PDF (N)" button — but that `<Button>` has **no `onClick` handler at all**. Selecting classes and clicking it does nothing, with no error, no loading state, nothing. This is the only report-card entry point that operates at class scale rather than one student at a time. | `src/features/gradebook/ReportCardBatchPage.tsx:23` — `<Button disabled={!selected.length} className="mt-2">{t("gradebook.queuePdf", ...)}</Button>`, no `onClick` prop anywhere in the 29-line file. | Wire it to the same transcript-generation logic `AcademicRecordTab.tsx` already has working, looped over the selected classes' rosters — or remove the page/button until it's built, since a visible, clickable, silently-inert button is worse than no button. |
| Medium | **The one working transcript generator hardcodes its own grading scale, disconnected from the school's configured one.** `AcademicRecordTab.tsx`'s `letter()` function is a fixed ladder (`90→A+, 85→A, 80→A-, 75→B+, 70→B, 60→C, 50→D, else F`) baked directly into the component — completely independent of the `grading_scales` table a school configures in Settings (see Grading module). A school that customizes its grading bands gets a transcript PDF that silently uses this hardcoded scale instead, with no indication anywhere that the two have diverged. | `src/features/students/tabs/AcademicRecordTab.tsx:13-22` (hardcoded `letter()`) vs. `src/features/settings/GradingScalesPage.tsx` (the actual configurable scale, never read from here). | Replace the hardcoded ladder with a real lookup against the tenant's `grading_scales` rows. |
| Medium | **No conduct or homeroom-teacher remark appears anywhere on the transcript.** A separate Behavioral tab (discipline records + merits, its own migration and full UI) exists on the student profile, but `transcript-pdf.ts` has zero reference to conduct, remarks, or homeroom — grep confirms no overlap between the two features at all. A real report card conventionally carries at least one of these. | Grep for `homeroom`/`conduct`/`remark` in `src/features/students/transcript-pdf.ts`: no matches. | Add a conduct/remark section to the transcript render, sourced from the existing Behavioral tab data — the data already exists, it's just never read by the document generator. |

**Works:** The per-student transcript (`AcademicRecordTab.tsx`'s
"Download PDF") is a genuinely functional document, not a stub — it
queries real `grades` rows for the student, aggregates CA/Final/Total per
subject, computes a class GPA, and renders school branding pulled from the
same `tenant_configs` row the ID cards use (so branding stays visually
consistent across documents). Its issue date is rendered through
`formatEth()`, correctly showing the Ethiopian calendar date — a useful
positive contrast against the invoice/ID-card PDFs elsewhere in this audit,
which show Gregorian only. Worth noting: the GPA-calculation logic this
page uses (`gp()`) proves the underlying formula already exists in the
codebase — it's only the separate, always-"—" "Current GPA" stat card
(Grading module) that never calls it, not a missing calculation overall.

---

## Promotion / Graduation

A real, working bulk promotion feature exists — but it has no atomicity
across the classes in one run, its own capacity warning is purely visual
and doesn't stop the operation, there's no undo, and the two document
outputs a real school expects at this workflow stage (a graduating cohort
report, a leaving certificate) don't exist.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| High | **Promotion silently bypasses class capacity.** `PromotionPage.tsx` computes `overCapacity` and renders a red warning line under the target-class dropdown, but never uses it to disable the "Run promotion" button or block the mutation — it's decoration, not a guard. Live-verified: promoted 2 students (Fasika, Yonas) into a freshly-created Grade 10-A section with `capacity: 1`; both landed in it with no error. Contrast with Admissions, where `enroll_admission_application()` genuinely enforces the same capacity concept server-side — promotion goes through a bare `students` table `UPDATE` with no equivalent guard at any layer. | `src/features/settings/PromotionPage.tsx:149` (`overCapacity` computed) vs. `:177-179` (`Button` never reads it, `disabled` only checks `!sourceClasses?.length`). Live: `PATCH /rest/v1/students?class_id=eq.<Grade9>&status=eq.active {class_id:<Grade10, capacity 1>}` → `204`, both students landed there. | Move the capacity check server-side (a trigger on `students`, or route the update through a checked RPC the same way enrollment already does) rather than leaving it as a client-only cosmetic warning. |
| Medium | **The whole promotion run is not atomic.** `promote.mutate()` loops over source classes and issues one separate `await supabase.from("students").update(...)` per class, sequentially, with no transaction and no RPC wrapping them together. If the browser closes, the network drops, or any later class's update throws, the classes already processed stay promoted and the rest don't — with no way to tell, after the fact, which run partially completed short of manually diffing every class roster. | `src/features/settings/PromotionPage.tsx:81-101` (the `for` loop, one `await` per class, no transaction/RPC). | Wrap the whole batch in a single `SECURITY DEFINER` Postgres function (same pattern already used for `enroll_admission_application`) so a partial failure genuinely rolls back everything, not just the one class it was on. |
| Medium | **No undo.** Once run, there's no "reverse this promotion" action anywhere in the product. `students` does have `audit_trigger` attached (so `audit_logs` technically holds the prior `class_id` for anyone willing to reconstruct it by hand from raw JSON), but there's no UI or function that uses that to actually revert a run. | Grep for "undo"/"revert" near promotion: no matches. `audit_students` trigger confirmed present (`supabase/migrations/20260713000002_academic.sql:89`) as the only thing preserving the "before" state. | A dedicated revert action reading the relevant `audit_logs` rows for a given promotion batch would close this — the raw data to do it already exists. |
| Medium | **No leaving certificate and no graduating-cohort report exist.** Setting a section to "Graduate" just flips `students.status` to `'graduated'` — no PDF, no document, no batch report of "everyone who graduated in EC year X" (there's no graduation-year/cohort column on `students` at all, so even a manual report couldn't reconstruct "who graduated when" once the moment passes). This repo's only document generators are ID cards, transcripts, and fee invoices/receipts — none of them cover a leaving/graduation certificate. | `src/features/settings/PromotionPage.tsx:88-92` (bare `status: "graduated"` update, no document call). Grep for "leaving certificate"/cohort tracking across the repo: no matches; `students` schema (`supabase/migrations/20260713000002_academic.sql:65-84`) has no graduation-year column. | Add a `graduated_ec_year` (or similar) column stamped at promotion time, and a document generator reusing the existing transcript/ID-card PDF infrastructure for a leaving certificate. |
| Low | Requesting `return=representation` on a `students` `UPDATE` (a one-line, easy-to-reach-for change for a future developer chaining `.select()` after `.update()`) fails outright for every `authenticated` caller with a confusing `permission denied for table students` — caused by `revoke select (medical_notes) on public.students from authenticated` (§10.4/PII hardening) combined with PostgREST's implicit `select *` for the returned row. Not a live bug today (the current code never requests it), but a landmine for the next person who does. | Live: identical `PATCH` with `Prefer: return=representation` added → `403 permission denied for table students`; the same call without it → `204`. `supabase/migrations/20260713000002_academic.sql:93` (the revoke). | Worth a one-line comment on the `students` table or the revoke itself warning that `return=representation` breaks for this specific table. |

**Works:** The core promote-or-graduate mechanism itself is real:
`PromotionPage.tsx` correctly lists source/target academic years, pre-fills
an unambiguous grade+1 class mapping when exactly one candidate exists,
lets an admin override any mapping or mark a class "Graduate" instead, and
the underlying `UPDATE` (capacity aside) genuinely moves every active
student in a source class to its target in one call, or flips them to
`status='graduated'` when that's the choice.

---

## Fees

This is the most solid money-handling module in the audit: fee structures,
bulk invoice generation with real dedup and header consolidation, partial
payment allocation, over-payment rejection, and receipt generation all
work correctly and were live-verified end-to-end in ETB.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| Low | Invoice/receipt document numbers (`INV-2026-920A6587`, `RCP-2026-DA67A4B4`) are `{PREFIX}-{year}-{random hex}`, not sequential/gapless. Some school accounting practices expect strictly sequential numbering for audit purposes; this scheme is unguessable (a real security plus — prevents enumeration) but not sequential. Flagging for the school to weigh, not asserting it's wrong. | Live: `abebe_invoice.pdf` (`INV-2026-920A6587`), `receipt2.pdf` (`RCP-2026-DA67A4B4`). | If sequential numbering is required, add a per-tenant sequence and keep the random verify-code separately for the QR/anti-enumeration purpose — the two don't have to be the same string. |
| — (not a defect, noted for completeness) | The gateway-payment replay/out-of-order-idempotency guard (`settle_gateway_payment`) could not be exercised **live end-to-end through a real webhook** in this audit — it's only reachable through `telebirr-notify`/`telebirr-query-order`, and this session has no live Telebirr testbed credentials (the same "genuinely blocked on live testbed credentials" limitation the Telebirr build itself documents). What *was* verified: the function is revoked from `anon`/`authenticated` (service_role only, confirmed via migration), its replay guard is a `webhook_events` insert with `id text primary key` keyed to the provider's tx_ref — so a replayed tx_ref hits a real Postgres unique-violation and returns `'duplicate'` before any credit logic runs — and the entire credit/mark-paid sequence executes inside one PL/pgSQL function body, which Postgres runs as a single implicit transaction, so a mid-function error cannot leave a half-credited invoice. This was also pgTAP-verified earlier in this project's history. Flagging the live-webhook gap honestly rather than fabricating a test that wasn't actually run. | `supabase/migrations/20260820000001_invoice_consolidation.sql:217-254` (function body), `:255` (`revoke all ... from public, anon, authenticated`). `supabase/migrations/20260713000003_attendance_grades_fees.sql:113-117` (`webhook_events.id text primary key`). | When live Telebirr testbed credentials become available, run a real notify → replay → out-of-order sequence against them, matching the plan this repo already wrote for that gap. |

**Works — all live-verified end to end, real ETB amounts, real PDFs:**
Fee structures scope correctly (whole-school tested here; grade/class/cycle
scoping columns confirmed via schema). `generate-fee-invoices` correctly
deduplicates (4 matched, 1 already-invoiced student correctly skipped, 3
new invoices created) and correctly consolidates onto one open
`invoice_headers` row per student/due-date rather than creating duplicates.
`record-fee-payment` correctly allocates a **partial** payment (500 of
1500 ETB → `status:"partial"`), correctly **rejects** an over-payment
attempt (2000 ETB against a 1000 ETB remaining balance →
`amount_exceeds_balance`, 400 — over-payment is actively prevented, not
mishandled), and correctly closes an invoice to `status:"paid"` exactly
when the final payment brings `amount_paid` to `amount_due` (1500/1500).
Receipt PDFs render correctly in ETB (`ETB 1500.00`, no `$`), show the
correct running balance (`Balance after this payment: ETB 0.00`), and
include a working QR verify code. `invoice_summary` (the view backing the
Invoices ledger and its outstanding-balance reporting) correctly reflects
real per-student status after all of the above.

---

## HR / Staff

Employee records, contracts, self-service leave, and document storage all
work correctly and are properly audited; the one real gap is that leave
can only ever be filed by the employee's own portal login, with no path
for HR to record leave on behalf of staff who don't have one.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| Medium | **Leave requests can only be self-filed — no HR/admin-on-behalf-of path.** `leave_file_own` (the only INSERT policy on `leave_requests`, unchanged by the later permissions-matrix rewrite) requires the caller to be the employee themselves. Live-verified: `school_admin` attempting to insert a leave request for an employee got `403 new row violates row-level security policy`; the same insert succeeded once made by the employee's own logged-in account. A school with support staff who have no portal login (common — not everyone gets an account) has no way to record their leave at all. | Live: `POST /rest/v1/leave_requests` as `school_admin` on behalf of another employee → `403`. Same payload as the employee's own session → `201`. `supabase/migrations/20260713000005_rls_policies.sql:299` (`leave_file_own`, insert restricted to the filer's own `employees.user_id`). | Add an HR-officer/school_admin insert path (mirroring how `enroll-finalize-billing` lets a registrar do something RLS alone wouldn't) for staff without portal accounts. |

**Works:** Employee records (`employees`) create correctly with PII column
grants properly enforced — `tin_number`/`pension_no`/`bank_account` are
revoked from the generic `authenticated` role at the column level, exactly
as documented. Employment contracts (`employment_contracts`) record real
ETB basic salary, contract type, and start date correctly. Leave types are
configurable per tenant. Self-service leave submission is correctly
RLS-gated to the filing employee, defaults to `pending`, and a
`school_admin` approval correctly transitions it to `approved` with
`decided_by`/`decided_at` stamped. Employee documents use a real private
Storage bucket (`documents`) with signed URLs, not a stub. `employees`,
`employment_contracts`, and `leave_requests` all carry a real
`audit_trigger`, consistent with this module's overall good governance
posture (a notable contrast to Attendance's missing audit trail).

---

## Payroll

The statutory engine itself is the best-verified piece of code in this
whole audit — real Ethiopian tax law, correctly applied, with genuine
segregation-of-duties and closed-period protections enforced at the
database level. The gaps are a self-flagged, still-unresolved source-data
uncertainty in the code's own comments, and a genuinely missing bank
disbursement export.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| Medium | **No bank-transfer/disbursement file export exists.** A payroll run only offers per-employee individual payslip PDFs (`generate-payslip-pdf`) and an "Approve" action — there is no batch CSV/text export listing account numbers and net pay for a bank upload. `PayrollRunDetailPage.tsx`'s only per-row action is a single payslip link; grep for any CSV/bank-file export tied to a payroll run: no matches. | `src/features/hr/PayrollRunDetailPage.tsx` (full file read — table + per-row payslip link only, no batch export). Grep `downloadCsv`/`bank.?transfer`/`disbursement` across `src/features/hr/`: only a per-employee bank-account-number *display/edit* field (`PayrollTab.tsx:202`, "Disbursement Details"), not a payroll-run export. | Add a "Download bank file" action on an approved run, reusing the account numbers already captured per employee. |
| Low (self-flagged in the code, still open) | The tax bracket schedule's `effective_from` date was reconstructed from **OCR-corrupted source text** — the code's own comment says the true commencement date for "all other provisions" (which Article 11's rate table falls under) couldn't be read cleanly from the fetched gazette PDF, so `2025-07-08` was used as a best guess (matching the date set for a different provision, Alternative Minimum Tax) and the comment explicitly says: *"STILL RECOMMEND a final visual (non-OCR) confirmation of that specific clause against the gazette PDF before go-live."* That confirmation does not appear to have happened — the same uncertain date is still the only row in production. Every rate/bracket-boundary figure itself is separately verified and correct; it's specifically this one date that's unconfirmed. | `supabase/migrations/20260713000004_hr_payroll.sql:118-130` (the comment) vs. `:132` (`insert into tax_brackets ... values ('2025-07-08', ...)` — the one row using that date, unchanged). | Do the recommended visual confirmation against the actual gazette PDF before this schedule is relied on for a real payroll run at a live school. |

**Works — extensively live-verified with real ETB figures:** PAYE
calculation is correct: an 8,000 ETB basic salary produced exactly
1,150.00 ETB income tax, matching the documented bracket
(7,000.01–10,000: 25% − 850 deduction → `8000×0.25−850=1150`) by hand.
**Pension correctly has no ceiling/cap** — 7%/11% applied to the full
basic salary with no artificial cap anywhere in the code, which is the
statutorily-correct behavior under Ethiopian Pension Proclamation 715/2011
(the task brief's explicit "flag any ceiling cap as defect" concern: there
is no cap here, which is correct, not a defect). **Segregation of duties
is genuinely enforced at the database level**, not just the UI —
live-verified: the same user who prepared a run was rejected from
approving it (`sod_preparer_cannot_approve`, 400) via a real DB check
constraint, and approval by a different role (accountant) succeeded.
**Closed-period re-run is correctly refused** — live-verified: re-running
`run-payroll` for an already-`approved` period was rejected outright,
protecting a closed run from being silently recalculated. An employee
whose contract still has the placeholder `basic_salary: 0` is correctly
excluded from the run (reported in `skipped_no_salary`) rather than
silently minting a real ETB 0 "paid" payslip for them. No salary figures
are ever written to server logs, matching the file's own stated INSA
intent.

---

## Library

Circulation is atomic and race-safe, holds and duplicate-hold rejection
work, and librarian scope is correctly enforced; the one defect is the
same onboarding-drift pattern already found in Scheduling, now confirmed
in a second table.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| Medium | **`library_settings` has the same class of onboarding-drift gap already found for `periods` (Scheduling module) — a second confirmed instance, though a different mechanism (never attempted, vs. attempted-and-silently-failed for `periods`).** The row is seeded by a one-time backfill (`insert into library_settings select id from tenants on conflict do nothing`, run once when that migration shipped) that `onboard-tenant` never mirrors for tenants created afterward. Live-confirmed: the QA tenant had **zero** `library_settings` rows. Unlike `periods`, this doesn't block the feature — both `library_checkout()` and `library_return()` defensively `coalesce()` every setting they read (`max_active_checkouts` → 3, `fine_per_day` → 0) — but the practical effect is a new school's fine rate is silently **0 ETB/day** (no fines ever charged) until someone happens to visit Library Settings and save a real value, with nothing prompting them to. | Live: `GET /rest/v1/library_settings?tenant_id=eq.<QA tenant>` → `[]`. `supabase/migrations/20260813000002_library_rebuild.sql:207-210` (one-time backfill) vs. `supabase/functions/onboard-tenant/index.ts` (no `library_settings` insert anywhere in the function). Coalesce confirmed at `:408` (`coalesce(v_max, 3)`) and `:459,461` (`coalesce(fine_per_day, 0)`, `coalesce(v_fine, 0)`). | Since this is now a confirmed two-instance pattern (see Scheduling module too), fix it once at the root: have `onboard-tenant` seed every tenant-scoped settings table a fresh school needs (`periods`, `library_settings`, and audit for any others following the same shape) instead of relying on each migration's one-time backfill to somehow stay current. |

**Works:** Checkout is genuinely atomic — `library_checkout()` takes a
per-(tenant, student) advisory lock and re-checks copy availability
`for update` inside the transaction, live-verified end to end (checked out
a real copy to a real student, correct 14-day-out due date computed with
the Africa/Addis_Ababa-aware `+3h` local-date logic, not a raw UTC date).
Returns correctly flip the copy back to `available` and correctly computed
a genuine `fine_amount: 0` for an on-time return — the overdue/nonzero-fine
arithmetic itself (`days_late × fine_per_day`, no cap) was verified by
reading `library_return()`'s SQL rather than forced live, because
`library_checkouts` turns out to be properly write-protected: a direct
`PATCH` attempting to backdate a checkout's `due_on` silently matched zero
rows (confirmed by re-reading the row afterward) — the table has no direct
authenticated write path at all, only the vetted, atomic RPC can touch it,
which is itself a good integrity property worth recording. Holds work
correctly, including genuine duplicate-hold rejection via a partial unique
index (`already_on_hold`, live-verified). The librarian role is correctly
authorized for circulation end to end (checkout/return/hold all succeeded
under a real librarian login, not just `school_admin`).

---

## Parent / Student Portals

Isolation is genuinely correct — every cross-child, cross-student, and
audience-targeting attempt made in this audit was blocked — and the one
real gap (SMS) was already known and explicitly out of scope for this
phase of the product, not a surprise.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| Medium (known, not new) | **SMS delivery is not wired to anything.** `_shared/sms.ts`'s adapters (SMSala/AfroMessage/GeezSMS) exist with real request shapes, but grep across every Edge Function for a caller of any of them returns zero matches — nothing in this codebase ever sends an SMS today, Amharic or otherwise, so "announcements/SMS with Amharic encoding" only has an in-app half (which works — see below) and no SMS half. In-app Amharic content itself renders correctly (see Works). | Grep for `sms.ts`/`getActiveSmsProvider`/`smsalaAdapter` outside `_shared/sms.ts`: zero call sites. | Wire a real trigger (e.g. into `notifyBilling`/`notifyLibrary`) once an SMS provider account exists to test against — the adapter code is otherwise ready. |

**Works:** Every isolation boundary tested held. A guardian's own child's
record is visible (`students` by id → returns Abebe); the **same
guardian querying a different, unrelated student directly by ID gets an
empty result**, both for the student record itself and for that other
student's `grades`. A **student** account gets an empty result querying
another student's `attendance`, and correctly sees only their own `grades`
row. Announcement audience-targeting is genuinely enforced, not
cosmetic — live-verified with three real accounts: a `staff`-audience
announcement was invisible to both the student and the guardian; a
`parents`-audience announcement (with real Amharic title/body:
"እባክዎ በሚቀጥለው ሳምንት የወላጆች ስብሰባ ላይ ይገኙ።") was correctly visible to the
guardian with the Amharic text intact, and correctly invisible to the
student account. `invoice_summary` (fee balance) correctly scopes to only
the guardian's own child's invoice.

---

## Super-Admin Console

This module contains the single most important finding of the audit:
**neither of the platform's two access-control levers — tenant suspension
and per-tenant module/plan gating — actually restricts anything.** Both
are real, clickable, confirmation-free actions in the console that update
a database row and change nothing else. Everything else in this module
(school list, cross-tenant usage/billing metrics, audit log search) is
genuinely built and working.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| **Critical** | **Suspending a tenant does not lock it out.** `tenants.status` has a `suspended` value and the console has a real "Suspend" button, but no RLS policy anywhere in the schema checks `tenants.status` — every policy scopes purely by `tenant_id` match. Live-verified end to end: set the QA tenant to `status: 'suspended'` as `super_admin`, then, with no other change, `school_admin` **logged in fresh** (200, real session), **read students** (200, full roster), and **created a new subject** (201) — all while the tenant showed as suspended. Grep for the word "suspended" outside the enum definition itself: zero matches anywhere in RLS or Edge Function code. A school that stops paying, or is suspended for a policy violation, keeps operating with zero technical restriction — the console's suspend button is a label change, not a control. | Live: `PATCH /rest/v1/tenants {status:"suspended"}` → `200`, followed by school_admin `POST /auth/v1/token` → `200`, `GET /rest/v1/students` → full roster `200`, `POST /rest/v1/subjects` → `201`. Grep for `suspended` across `supabase/migrations`: only the enum declaration (`20260713000001_core.sql`). Reverted to `active` immediately after the test. | Every RLS policy (or a single shared helper `get_tenant_id_for_user`/equivalent gate) needs to check the caller's tenant status and deny non-super_admin access when `suspended`. This is the highest-priority fix in the entire audit. |
| **Critical** | **Module/plan gating is enforced nowhere except the sidebar.** Confirmed first by the code's own comment (`RequireModule.tsx:1-4`: *"UX-only gate... RLS/DB enforcement of module gating is a deliberate follow-up, not done here"*), then live-verified: disabled the `library` module for the QA tenant via `tenant_module_overrides` (the exact mechanism the console's plan/module toggle writes to), and `school_admin` **still read** `library_books` (200, full catalog) and **still created** a new book (201) directly against the table — completely bypassing the now-hidden nav link. A school on the cheapest plan has full API-level access to every module regardless of what they're paying for; only the sidebar link disappears. | `src/features/auth/RequireModule.tsx:1-18` (the comment + the actual gate, which only ever redirects a React Router route — never touches a query). Live: `POST /rest/v1/tenant_module_overrides {module_key:"library", enabled:false}` → `201`, then `GET /rest/v1/library_books` as school_admin → full list `200`, `POST /rest/v1/library_books` → `201`. Reverted immediately after. | Same shape of fix as suspension: module entitlement needs to be checked inside RLS (or a `has_module` security-definer helper called from each module's policies), not only in the React route guard. |
| Medium | **The platform's own most powerful actions are completely unaudited.** Neither `tenants` nor `tenant_module_overrides` has an `audit_trigger` attached (every other governance-sensitive table in this codebase — `students`, `grades`, `employees`, `payments` — does). Suspending a school or toggling its paid modules leaves **zero** row in `audit_logs`, even though the platform's own Audit Log search (in `PlatformReportPage.tsx`) is a real, working feature for everything that *does* get logged. Live-confirmed: querying `audit_logs` for `table_name=tenants` on the QA tenant, immediately after the suspend/reactivate test above, returned an empty list. | Grep for `create trigger.*tenants` / `tenant_module_overrides` audit triggers across all migrations: no matches for either table. Live: `GET /rest/v1/audit_logs?table_name=eq.tenants` → `[]`, right after a real suspend + reactivate had just happened. | Attach `audit_trigger` to both tables — this is a small, contained fix and closes a real compliance gap on the platform's most sensitive actions. |
| Medium | **Impersonation does not exist.** Grep for "impersonat" (any case) across the entire repository: zero matches, in either migrations or `src/`. A super_admin cannot "log in as" a tenant's admin for support purposes through any built mechanism — only the credential-level workaround this audit itself has been using (real invite links / temp passwords) would let anyone act as a tenant's user, and that's not a support tool, it's the onboarding mechanism. | Grep for `impersonat` (case-insensitive) repo-wide: no matches. | Never built — flagging for completeness, not implying urgency relative to the two Critical findings above. |

**Works:** Tenant creation (see Onboarding), the platform-wide tenant list
with plan/tier display, and **cross-tenant usage & billing metrics**
(`PlatformReportPage.tsx` — student counts, invoice totals aggregated in
real ETB across every tenant, using the super_admin's unscoped RLS branch
deliberately, not a workaround) are all genuinely built and functioning,
not stubs. **Audit log search itself works correctly** — the gap is not
in the search feature, it's that two specific tables were never wired to
produce log rows in the first place (see above).

---

## Cross-Tenant Isolation

Every ordinary tenant-scoped table held up under direct attack — but the
two platform-wide permission tables flagged as a preliminary risk in this
project's earlier static-analysis pass turned out, live, to be worse than
suspected: **any authenticated user of any role, from any single tenant,
can write directly into them and change authorization behavior for every
tenant on the platform at once.**

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| **Critical** | **`resource_open_actions` and `resource_default_role_grants` have no RLS at all, are global (no `tenant_id` column), and directly drive `has_resource_permission()` — the function every "resource-aware" RLS policy in this schema (`grades`, `attendance`, `announcements`, and more) falls back to.** Live-verified as the QA tenant's `school_admin` (an ordinary tenant-scoped role, no elevated platform access): `POST /rest/v1/resource_open_actions {resource:"payroll_runs", action:"read"}` → **`201`**, and `POST /rest/v1/resource_default_role_grants {resource:"payroll_runs", action:"create", role:"student"}` → **`201`**. Both rows, had they been left in place, would have applied platform-wide the instant they were written — the first making every tenant's payroll data world-readable to any authenticated user regardless of role; the second letting a **student** role create payroll runs everywhere. Both were deleted immediately after confirming the write succeeded (verified via a super_admin read showing only the legitimate pre-existing rows remained). | Live: two `201` responses from a `school_admin` session, confirmed removed afterward via `GET` as `super_admin`. `supabase/migrations/20260817000001_resource_permissions_core_v2.sql:49-60` (`create table resource_open_actions`/`resource_default_role_grants`, no `enable row level security` anywhere in the file, no `tenant_id` column on either table). | This is the single highest-priority fix in the entire audit — enable RLS on both tables with `super_admin`-only write access (matching `modules`/`subscription_tiers`'s existing pattern in the same schema), before anything else. |

**Works:** Every ordinary tenant-scoped table tested resisted direct
cross-tenant attack, both via unfiltered queries (RLS auto-scoped
correctly to the caller's own tenant every time) and via explicit
attempts naming another real tenant's ID directly in the request —
`students`, `invoice_summary`, `employees` (PII fields), `id_cards`, and
`admission_applications` against both **Aw Abdal Secondary School** and
**Abadir Elementary School** (the two pre-existing production tenants)
all correctly returned empty results with no error message leaking
whether the target row existed. A direct storage-object fetch using a
guessed cross-tenant path was also correctly denied. No read or write
against either pre-existing tenant succeeded at any point in this audit.

---

## Domain-Conformance Sweep (ETB, calendar, timezone, fonts, i18n, address)

The two actual CI gates for this concern both pass cleanly against the
real codebase, and every live-rendered document/date checked throughout
this audit was correct; the one gap found is a calendar preference that
saves successfully but is never read back by anything.

| Severity | What's wrong | Evidence (file:line or response) | Fix |
|---|---|---|---|
| Medium | **The "Show Ge'ez numerals" calendar preference is a dead setting.** `CalendarPreferencesPage.tsx` saves `tenant_configs.settings.calendar.geezNumerals` correctly (confirmed: the QA tenant's row round-trips it), but nothing anywhere else in the app ever reads it back. `<EthDate/>`'s `geez` prop defaults to `false` and grep confirms **zero** call sites anywhere in `src/` pass `geez={...}` at all — the toggle a school_admin flips in Settings has no effect on a single date displayed anywhere in the product. (The `toGeez()` conversion function itself is correct — proper ፩–፱/፲–፺/፻ numeral construction, verified by reading it — it's simply never invoked with the tenant's actual preference.) | `src/features/settings/CalendarPreferencesPage.tsx:14,24,30` (save-only). `src/components/EthDate.tsx:32,34` (`geez = false` default). Grep for `geez={` across `src/`: zero matches anywhere outside that one settings page. | Wire the tenant's `calendar.geezNumerals` setting into whatever renders `<EthDate/>` app-wide (most naturally via a context/hook alongside the existing locale context), or remove the toggle until it does something. |

**Works:** Both of this repo's actual automated gates for this concern
pass cleanly against the real codebase, run live in this audit (not
assumed): `npm run check:locales` → `2057/135/18` keys with full
en/am/om parity across the `common`/`apply`/`calendar` namespaces, zero
drift; `npm run check:i18n` → `0` hardcoded strings detected. Grep for
`toLocaleDateString` across `src/` found zero live usages (the only match
is a comment explaining why the code deliberately avoids it). ETB
formatting was correct on every real document generated in this audit —
invoices, receipts, payslips (`ETB 1500.00`-style, no `$`, correct
rounding) — see Fees and Payroll. Ethiopian-calendar correctness held
throughout: `academic_years`/`academic_terms` EC↔GC conversion, term
boundary math, and `<EthDate/>`/`formatEth` rendering were all correct
wherever exercised across the audit. Arabic numerals are used everywhere
by default (`geezNumerals: false`), and — as a side effect of the dead
setting above — can never leak in accidentally even if a school enables
the toggle, which is a safe failure mode even though the feature itself
doesn't work. `Africa/Addis_Ababa` (fixed UTC+3, no DST) is handled
correctly and explicitly where a same-day local-date decision actually
matters (`process-library-circulation/index.ts`'s `todayLocal()`).
Ethiopic (Noto Serif Ethiopic) genuinely renders correctly in generated
PDFs, not just in-app — see the Admissions module's live ID-card test.
Region/Zone/Woreda/Kebele address cascading does not exist (plain
free-text fields) — already documented in the Admissions module, not
repeated here.

---

*(Audit in progress — remaining modules appended below as they are tested.)*
