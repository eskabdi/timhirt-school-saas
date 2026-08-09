-- ============================================================================
-- enroll_admission_application never wrote stage = 'enrolled'. It required
-- the application to already be at 'registered' and, on success, only set
-- converted_student_id + assigned_class_id -- stage stayed 'registered'
-- forever. Meanwhile AdmissionReviewModal's "Enrollment Status" dropdown
-- lets a reviewer pick 'enrolled' directly as a plain label update with no
-- student ever created. The two were disconnected: neither path produced a
-- row where stage = 'enrolled' actually meant a student exists.
--
-- Fix: the RPC itself now sets stage = 'enrolled' as part of its one
-- transaction, and the stage gate is relaxed to "not already converted"
-- rather than "must currently read registered" -- AdmissionReviewModal is
-- becoming a second caller that can enroll directly from any prior stage
-- (a reviewer picking 'enrolled' from the dropdown is exactly the
-- deliberate, explicit action the original comment on this function
-- required; requiring it to also have visited 'registered' first added
-- nothing). converted_student_id remains the one guard that actually
-- matters: an application enrolled twice would orphan a second student row.
--
-- Body is 20260729000003's verbatim otherwise (ethnicity carried through).
-- create or replace keeps the existing grant.
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
    date_of_birth, gender, ethnicity
  ) values (
    v_app.tenant_id, p_class_id,
    v_app.applicant_first_name, v_app.applicant_first_name_am,
    v_app.applicant_middle_name, v_app.applicant_middle_name_am,
    v_app.applicant_last_name, v_app.applicant_last_name_am,
    v_app.date_of_birth, v_app.gender, v_app.ethnicity
  ) returning id into v_student_id;

  insert into public.guardians (tenant_id, student_id, relationship, phone, email)
  values (
    v_app.tenant_id, v_student_id,
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
