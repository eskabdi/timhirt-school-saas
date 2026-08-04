-- ============================================================================
-- A teacher can be homeroom of at most one class at a time.
--
-- homeroom_teacher_id (20260713000002) has never carried a uniqueness
-- constraint: ClassesPage's Add/Edit modals (classesApi.createClass /
-- updateClass) could silently point two different classes' homeroom_teacher_id
-- at the same teacher, with nothing catching it -- the second save would just
-- succeed and both classes would show that teacher as homeroom.
--
-- A partial unique index, not a plain `unique` column constraint: NULL means
-- "no homeroom teacher assigned yet," and that has to stay unconstrained so
-- any number of classes can sit without one. Postgres already treats NULLs as
-- distinct in a unique index, so `where homeroom_teacher_id is not null` is
-- belt-and-braces here rather than load-bearing -- it makes the intent
-- explicit instead of relying on that as a side effect.
-- ============================================================================
create unique index classes_homeroom_teacher_unique
  on public.classes (homeroom_teacher_id)
  where homeroom_teacher_id is not null;
