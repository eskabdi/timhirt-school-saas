-- ============================================================================
-- Closes a real duplicate-roll_number gap left open by assign_roll_number()
-- (20260803000001): that trigger computes a unique sequential roll_number on
-- INSERT and on class_id change, but never GUARANTEES uniqueness at the DB
-- level, and two paths bypass it entirely:
--
--   1. EditProfileModal lets staff free-type roll_number, and always
--      includes class_id in its patch even when unchanged (per
--      20260803000001's own header comment) -- a same-class resave hits the
--      trigger's "IS NOT DISTINCT FROM" guard and returns immediately,
--      never touching roll_number at all.
--   2. Nothing re-validates the manually-typed value against every other
--      active student already in that section.
--
-- Reproduced directly against real Postgres: two active students in the same
-- class_id, manually edited to the same roll_number, both persist with zero
-- error. This index makes that a constraint violation instead.
--
-- Scoped to status = 'active' (not the whole table), because a departed
-- student deliberately KEEPS their old roll_number, and the trigger
-- deliberately REUSES that freed slot for whoever is assigned into the
-- section next (proven by roll_number.sql:52-53, "a graduated student frees
-- up its roll position"). An inactive student's stale roll_number must not
-- conflict with that by design -- this index only ever compares among
-- students who are simultaneously active in the same section.
-- ============================================================================
create unique index students_active_roll_number_unique
  on public.students (class_id, roll_number)
  where status = 'active' and roll_number is not null;
