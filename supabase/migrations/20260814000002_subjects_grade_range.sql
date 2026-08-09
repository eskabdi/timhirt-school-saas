-- ============================================================================
-- subjects gains an explicit, staff-editable grade-applicability range,
-- independent of which classes currently teach it (curriculum planning
-- ahead of scheduling). min_grade/max_grade over a single grade_cycle_id FK
-- because a subject can legitimately span two cycles (e.g. "Civics", grades
-- 9-12) -- a range is strictly more expressive while the UI can still offer
-- a one-click "pick a cycle" shortcut that fills both fields from that
-- cycle's own min_grade/max_grade.
--
-- Both columns nullable: null/null = applies to all grades (today's
-- implicit behavior, unchanged for every existing row -- no backfill
-- needed). No RLS changes: subjects_write (20260713000005, school_admin
-- only) already governs the whole row including these new columns.
-- ============================================================================

alter table public.subjects
  add column min_grade smallint check (min_grade between 0 and 12),
  add column max_grade smallint check (max_grade between 0 and 12),
  add constraint subjects_grade_range_check check (
    (min_grade is null and max_grade is null)
    or (min_grade is not null and max_grade is not null and max_grade >= min_grade)
  );
