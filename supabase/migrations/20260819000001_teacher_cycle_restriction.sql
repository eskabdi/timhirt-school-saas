-- ============================================================================
-- Teachers get an (optional) assigned grade-cycle, and class_subject_teachers
-- assignments are checked against it: a teacher whose teaching_cycle_key is
-- "first_cycle" cannot be assigned to a class in "second_cycle" (or any other
-- cycle) unless the admin explicitly overrides it for that one assignment.
--
-- teaching_cycle_key is nullable and NULL means "no cycle assigned yet" --
-- every existing teacher today, and every teacher invited through the quick
-- TeachersPage invite form tomorrow, stays fully unrestricted until an admin
-- sets it (same "null = no constraint" precedent as shift, 20260811000001).
--
-- The restriction is enforced by a trigger, not just client-side filtering --
-- cst_write RLS already lets any in-tenant school_admin write this table
-- directly (including via a future script, import, or API caller this UI
-- doesn't control), so client-side filtering alone would be advisory only.
-- ============================================================================

alter table public.teachers
  add column teaching_cycle_key text references public.grade_cycles(key);

alter table public.class_subject_teachers
  add column cycle_override boolean not null default false;

create or replace function public.enforce_teacher_cycle()
returns trigger language plpgsql as $$
declare
  v_teacher_cycle text;
  v_class_grade   smallint;
  v_class_cycle   text;
begin
  select teaching_cycle_key into v_teacher_cycle
  from public.teachers where id = new.teacher_id;
  if v_teacher_cycle is null then
    return new; -- teacher has no assigned cycle -- unrestricted
  end if;

  select grade_level into v_class_grade
  from public.classes where id = new.class_id;
  select key into v_class_cycle
  from public.grade_cycles where id = public.grade_cycle_for(v_class_grade);
  if v_class_cycle is null then
    return new; -- class has no resolvable cycle (e.g. KG/grade 0) -- unrestricted
  end if;

  if v_class_cycle <> v_teacher_cycle and not coalesce(new.cycle_override, false) then
    raise exception 'teacher_outside_assigned_cycle';
  end if;

  return new;
end $$;

-- Fires on insert (the only path the app uses today) and update (defensive --
-- nothing currently updates class_id/teacher_id on an existing row, but a
-- future caller changing either must re-check the same invariant).
create trigger class_subject_teachers_cycle_guard
before insert or update on public.class_subject_teachers
for each row execute function public.enforce_teacher_cycle();
