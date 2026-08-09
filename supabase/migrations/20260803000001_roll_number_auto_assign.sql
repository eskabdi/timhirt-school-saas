-- ============================================================================
-- Roll number auto-assignment.
--
-- roll_number (20260720000002) has been a free-typed text field since it was
-- added: nothing computed it, so it either sat blank or drifted out of sync
-- with the section roster the moment a student transferred. This makes it
-- automatic wherever a student's class_id is set or changes: roll_number
-- becomes "how many students are already active in that section, plus one"
-- -- the same count() pattern enroll_admission_application (20260719000005)
-- already uses to enforce capacity, so a newly-enrolled student's roll number
-- and the capacity check agree on what "already in this section" means.
--
-- One trigger function, fired from two triggers, covers every write path
-- uniformly with no frontend changes required:
--   - BEFORE INSERT: the direct "Add Student" form, and
--     enroll_admission_application's insert (both leave class_id set at
--     creation, so both get a roll number immediately).
--   - BEFORE UPDATE OF class_id: EditProfileModal's section change, and
--     PromotionPage's bulk end-of-year UPDATE. "OF class_id" means editing
--     any other field never touches roll_number -- and the IS NOT DISTINCT
--     FROM guard below means re-saving the *same* class_id (EditProfileModal
--     always includes class_id in its patch when a class is selected, even
--     if unchanged) leaves a manually-corrected roll_number alone too.
--
-- pg_advisory_xact_lock serializes concurrent inserts/updates into the same
-- section within the same transaction scope -- cheap insurance against two
-- simultaneous enrollments both counting N and both landing on N+1.
-- ============================================================================

create or replace function public.assign_roll_number()
returns trigger
language plpgsql
as $$
declare
  v_count int;
begin
  if new.class_id is null then
    new.roll_number := null;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.class_id is not distinct from old.class_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.class_id::text, 0));

  select count(*) into v_count
  from public.students
  where class_id = new.class_id and status = 'active';

  new.roll_number := (v_count + 1)::text;
  return new;
end;
$$;

create trigger students_assign_roll_number_insert
before insert on public.students
for each row execute function public.assign_roll_number();

create trigger students_assign_roll_number_update
before update of class_id on public.students
for each row execute function public.assign_roll_number();
