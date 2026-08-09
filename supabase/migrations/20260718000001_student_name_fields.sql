-- ============================================================================
-- Parity fix: the public /apply stepper collects middle name plus Amharic
-- spellings for first/middle/last name (applicant_first_name_am etc. on
-- admission_applications, migration 20260716000001), but the tenant-side
-- "Add Student" form only ever had first_name/last_name (English only) —
-- an admin re-entering a registered applicant as a student had nowhere to
-- put the same data the applicant already gave. Add the same four columns
-- here so both sides collect identical fields.
--
-- Nullable: existing students predate this field and have no middle/Amharic
-- name on file — not backfillable from anywhere, so left null rather than
-- forced to an empty string.
-- ============================================================================

alter table public.students
  add column middle_name    text check (middle_name is null or length(middle_name) between 1 and 80),
  add column first_name_am  text check (first_name_am is null or length(first_name_am) between 1 and 80),
  add column middle_name_am text check (middle_name_am is null or length(middle_name_am) between 1 and 80),
  add column last_name_am   text check (last_name_am is null or length(last_name_am) between 1 and 80);

-- first_name/last_name are 🔒 column-grant-restricted (migration 20260715000013)
-- and its own comment flags that new columns are unreadable until explicitly
-- granted — these are the same class of PII, granted the same way.
grant select (middle_name, first_name_am, middle_name_am, last_name_am)
  on public.students to authenticated;
