-- ============================================================================
-- enroll_admission_application() copied the guardian's phone and email onto
-- the new guardians row but never the name, and never set the new student's
-- admission_date at all. Student Profile's Primary Guardian card showed
-- phone/email correctly with a blank name, and Admission Date read "--" for
-- every auto-enrolled student. guardian_name is not-null on the application
-- (the applicant always gives it); admission_date is the day enrollment
-- actually happens, so it is not something the application itself carries --
-- current_date at the moment the RPC runs is correct.
--
-- Body is 20260802000001's verbatim otherwise. create or replace keeps the
-- existing grant.
-- ============================================================================
create or replace function public.enroll_admission_application(
  p_application_id uuid,
  p_class_id        uuid
) returns uuid
language plpgsql
as $$
declare
  v_app        public.admission_applications;
  v_capacity   int;
  v_enrolled   int;
  v_student_id uuid;
begin
  select * into v_app from public.admission_applications where id = p_application_id;
  if not found then
    raise exception 'application not found';
  end if;
  if v_app.converted_student_id is not null then
    raise exception 'application has already been enrolled';
  end if;

  select capacity into v_capacity from public.classes
    where id = p_class_id and tenant_id = v_app.tenant_id;
  if not found then
    raise exception 'class not found for this tenant';
  end if;

  if v_capacity is not null then
    select count(*) into v_enrolled from public.students
      where class_id = p_class_id and status = 'active';
    if v_enrolled >= v_capacity then
      raise exception 'selected section is at capacity';
    end if;
  end if;

  insert into public.students (
    tenant_id, class_id,
    first_name, first_name_am, middle_name, middle_name_am, last_name, last_name_am,
    date_of_birth, gender, ethnicity, admission_date
  ) values (
    v_app.tenant_id, p_class_id,
    v_app.applicant_first_name, v_app.applicant_first_name_am,
    v_app.applicant_middle_name, v_app.applicant_middle_name_am,
    v_app.applicant_last_name, v_app.applicant_last_name_am,
    v_app.date_of_birth, v_app.gender, v_app.ethnicity, current_date
  ) returning id into v_student_id;

  insert into public.guardians (tenant_id, student_id, full_name, relationship, phone, email)
  values (
    v_app.tenant_id, v_student_id, v_app.guardian_name,
    coalesce(v_app.guardian_relationship::text, 'guardian'),
    v_app.guardian_phone, v_app.guardian_email
  );

  update public.admission_applications
    set converted_student_id = v_student_id, assigned_class_id = p_class_id, stage = 'enrolled'
    where id = p_application_id;

  return v_student_id;
end;
$$;

grant execute on function public.enroll_admission_application(uuid, uuid) to authenticated;

-- Backfill students that already went through the buggy RPC. Scoped to the
-- enrollment path only (join on converted_student_id) -- a manually added
-- student's blank guardian name or admission date is a legitimate "not
-- recorded yet" state, not this bug, and is left alone.
update public.guardians g
set full_name = a.guardian_name
from public.admission_applications a
where a.converted_student_id = g.student_id
  and g.full_name is null
  and a.guardian_name is not null;

update public.students s
set admission_date = a.updated_at::date
from public.admission_applications a
where a.converted_student_id = s.id
  and s.admission_date is null;
