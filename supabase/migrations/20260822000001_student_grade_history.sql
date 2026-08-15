-- ============================================================================
-- R4-A1: student profile grade-level tabs and the PDF transcript hardcoded
-- GRADE_TABS = [9,10,11,12] regardless of what grade the student is actually
-- in or has ever been in. There's no dedicated class-history table, but every
-- students row write has been captured by audit_students (20260713000002)
-- since day one -- every class_id a student has ever been assigned (at
-- enrollment and at every promotion) is recoverable from audit_logs.
--
-- get_student_grade_history() reads that history and returns the distinct,
-- sorted set of grade_levels the student has ever occupied (plus their
-- current class, as a fallback for any row whose creation somehow predates
-- an audit entry). It is SECURITY DEFINER purely to read audit_logs, which
-- is otherwise school_admin/super_admin-only (20260713000001) -- a student
-- viewing their own tab, or their guardian, or their teacher, has no route
-- to audit_logs directly. The function re-derives students_select's own
-- authorization branches (20260817000002) before returning anything, so it
-- widens nothing beyond what that policy already permits.
-- ============================================================================
create or replace function public.get_student_grade_history(p_student_id uuid)
returns smallint[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id  uuid := public.get_tenant_id_for_user(auth.uid());
  v_authorized boolean;
  v_class_id   uuid;
  v_result     smallint[];
begin
  if v_tenant_id is null then
    return array[]::smallint[];
  end if;

  select s.class_id into v_class_id from public.students s where s.id = p_student_id and s.tenant_id = v_tenant_id;
  if v_class_id is null then
    return array[]::smallint[];
  end if;

  select exists (
    select 1 from public.students s
    where s.id = p_student_id
      and s.tenant_id = v_tenant_id
      and (
        (select public.get_role_for_user(auth.uid())) = 'super_admin'
        or public.has_resource_permission(auth.uid(), 'students', 'read')
        or public.is_teacher_of_class(s.class_id)
        or s.user_id = auth.uid()
        or public.is_guardian_of(s.id)
      )
  ) into v_authorized;

  if not v_authorized then
    return array[]::smallint[];
  end if;

  select array_agg(distinct g order by g) into v_result
  from (
    select c.grade_level as g
    from public.audit_logs a
    join public.classes c on c.id = (a.new_data->>'class_id')::uuid
    where a.table_name = 'students' and a.row_id = p_student_id
      and a.new_data ? 'class_id' and a.new_data->>'class_id' is not null
    union
    select c.grade_level as g
    from public.audit_logs a
    join public.classes c on c.id = (a.old_data->>'class_id')::uuid
    where a.table_name = 'students' and a.row_id = p_student_id
      and a.old_data ? 'class_id' and a.old_data->>'class_id' is not null
    union
    select c.grade_level as g
    from public.classes c
    where c.id = v_class_id
  ) grades
  where g is not null;

  return coalesce(v_result, array[]::smallint[]);
end;
$$;

grant execute on function public.get_student_grade_history(uuid) to authenticated;
