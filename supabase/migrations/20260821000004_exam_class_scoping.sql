-- ============================================================================
-- HIGH fix: no class scoping in Grading. exams had no class_id (only
-- academic_term_id), grades had no class_id either, and
-- GradebookPage.tsx's roster query had no class filter at all -- every
-- score-entry screen listed the entire school's students regardless of
-- which exam was selected.
--
-- exams.class_id is added NULLABLE, not NOT NULL: production already has 2
-- real exams on the Abadir tenant (16 already-recorded grades hang off
-- them) with no historical signal for which of Abadir's 49 classes they
-- were meant for -- guessing one would be fabricating tenant data, which
-- this audit does not do. NULL means "legacy/unscoped exam", and behaves
-- exactly as before (no roster filtering, no class-match check) so those
-- existing rows and their grades are completely unaffected. Every NEW exam
-- going forward is required to carry a class_id by the frontend
-- (ExamsPage.tsx), which is how real enforcement actually takes effect --
-- Abadir's own school_admin can backfill class_id on those 2 legacy exams
-- through the ordinary edit UI whenever they choose to.
--
-- exam_guard mirrors attendance_guard/grade_guard's existing style
-- (BEFORE trigger, security definer): when class_id is set, it must belong
-- to the same tenant as the exam -- otherwise a school_admin could target
-- another tenant's class id (unreachable today since nothing populated
-- this column, but worth closing now that it exists).
--
-- grade_guard (already enforces score <= max_score, already stamps
-- entered_by server-side) gains one more check: when the exam being
-- scored has a class_id, the student being scored must belong to that
-- class. This is additive to the existing RLS write policy's
-- is_teacher_of_class(s.class_id) check (which restricts by the teacher's
-- own class assignment) -- this closes the remaining gap where a teacher
-- of class A could record a score against class B's exam for one of their
-- own class-A students, which the class-based RLS alone doesn't catch
-- since it only ever looks at the student's class, never the exam's.
-- ============================================================================

alter table public.exams add column class_id uuid references public.classes(id);

create or replace function public.exam_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.class_id is not null then
    if not exists (select 1 from public.classes c
                   where c.id = new.class_id and c.tenant_id = new.tenant_id) then
      raise exception 'class_not_in_tenant';
    end if;
  end if;
  return new;
end $$;
create trigger exam_guard before insert or update on public.exams
for each row execute function public.exam_guard();

create or replace function public.grade_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_max numeric; v_exam_class_id uuid; v_student_class_id uuid;
begin
  select max_score, class_id into v_max, v_exam_class_id from public.exams where id = new.exam_id;
  if new.score > v_max then raise exception 'score_exceeds_max'; end if;
  if v_exam_class_id is not null then
    select class_id into v_student_class_id from public.students where id = new.student_id;
    if v_student_class_id is distinct from v_exam_class_id then
      raise exception 'student_not_in_exam_class';
    end if;
  end if;
  new.entered_by := auth.uid();
  return new;
end $$;
