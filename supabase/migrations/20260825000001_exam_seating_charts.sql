-- R4-B4: minimal exam seating charts. One assignment row per (exam,
-- student); seat_label is a free string ("R2C3") so a school can lay out
-- rows/columns however the room actually is. Scoped to the exam's OWN
-- class_id when set (mirrors exam_class_scoping's "legacy exam = no
-- class_id = no extra restriction" rule) -- a seating chart only makes
-- sense once an exam has a class to seat, but nothing here requires it
-- retroactively of existing exams.
create table public.exam_seat_assignments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  exam_id     uuid not null references public.exams(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  seat_label  text not null check (char_length(seat_label) between 1 and 20),
  created_at  timestamptz not null default now(),
  unique (tenant_id, exam_id, student_id),
  unique (tenant_id, exam_id, seat_label)
);
create index exam_seat_assignments_exam on public.exam_seat_assignments (tenant_id, exam_id);

alter table public.exam_seat_assignments enable row level security;
alter table public.exam_seat_assignments force row level security;

-- Same authorization shape as exams_write: school_admin, or the teacher of
-- the exam's own class (re-derived via a join, not trusted from the row).
create policy exam_seat_assignments_select on public.exam_seat_assignments for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) = 'school_admin'
        or exists (select 1 from public.exams e where e.id = exam_id and public.is_teacher_of_class(e.class_id))))
);
create policy exam_seat_assignments_write on public.exam_seat_assignments for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
  (select public.get_role_for_user(auth.uid())) = 'school_admin'
  or exists (select 1 from public.exams e where e.id = exam_id and public.is_teacher_of_class(e.class_id))))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
  (select public.get_role_for_user(auth.uid())) = 'school_admin'
  or exists (select 1 from public.exams e where e.id = exam_id and public.is_teacher_of_class(e.class_id))));

create trigger audit_exam_seat_assignments after insert or update or delete on public.exam_seat_assignments
for each row execute function public.audit_trigger();

-- Auto-assign: wipes and rebuilds every seat for the exam in one call, so
-- re-running with different rows/cols is idempotent rather than leaving
-- orphaned seats from a previous layout. Ordered by roll_number (numeric,
-- since it's stored as free text) then name, for a deterministic, familiar
-- room order. security definer only to re-derive the exam's tenant/class
-- scope server-side and to let the same RLS check (is_teacher_of_class /
-- school_admin) gate a multi-row rebuild that the ordinary write policy
-- alone can express only per-row.
create or replace function public.auto_assign_exam_seats(p_exam_id uuid, p_rows int, p_cols int)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_tenant_id uuid; v_class_id uuid; v_role text;
  v_student record; v_seq int := 0; v_assigned int := 0;
begin
  select tenant_id, class_id into v_tenant_id, v_class_id from public.exams where id = p_exam_id;
  if v_tenant_id is null then raise exception 'exam_not_found'; end if;
  if v_tenant_id is distinct from (select public.get_tenant_id_for_user(auth.uid())) then
    raise exception 'cross_tenant_denied';
  end if;
  v_role := (select public.get_role_for_user(auth.uid()));
  if v_role is distinct from 'school_admin' and not public.is_teacher_of_class(v_class_id) then
    raise exception 'not_authorized';
  end if;
  if v_class_id is null then raise exception 'exam_has_no_class'; end if;
  if p_rows < 1 or p_cols < 1 then raise exception 'invalid_grid'; end if;

  delete from public.exam_seat_assignments where exam_id = p_exam_id;

  for v_student in
    select id from public.students where class_id = v_class_id
    order by nullif(roll_number, '')::int nulls last, last_name, first_name
  loop
    if v_seq >= p_rows * p_cols then exit; end if;
    insert into public.exam_seat_assignments (tenant_id, exam_id, student_id, seat_label)
    values (v_tenant_id, p_exam_id, v_student.id, format('R%sC%s', v_seq / p_cols + 1, v_seq % p_cols + 1));
    v_seq := v_seq + 1;
    v_assigned := v_assigned + 1;
  end loop;

  return v_assigned;
end;
$$;
