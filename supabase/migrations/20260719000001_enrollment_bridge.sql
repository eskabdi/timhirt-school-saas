-- ============================================================================
-- Post-admission enrollment bridge (K-12 workflow stages 6-7):
--
-- Today a 'registered' application does nothing — converted_student_id
-- exists but nothing ever writes it, and the only way to create a student
-- is a disconnected manual form (re-typing everything the applicant already
-- gave). This adds the missing bridge: enroll_admission_application() turns
-- a registered application into a student + guardian row atomically.
--
-- Grade vs. section: applicants pick only a grade at apply time (e.g.
-- "Grade 5"), never a specific section — the section (A/B/C…) is assigned
-- by the admin at enrollment, based on remaining seats. grade_level gives
-- classes a numeric order independent of the free-text name/section labels,
-- so the grade picker sorts correctly and (later) promotion logic can
-- compute "next grade" without parsing strings.
-- ============================================================================

alter table public.classes
  add column grade_level smallint check (grade_level between 0 and 12),
  add column capacity    int      check (capacity is null or capacity > 0);

-- desired_class_id (a specific section-level class) is kept for historical
-- rows but is no longer written by submit-admission. desired_grade is the
-- applicant's grade-only choice; assigned_class_id is the section an admin
-- places the student into at enrollment (set by the function below).
alter table public.admission_applications
  add column desired_grade     text check (length(desired_grade) between 1 and 40),
  add column assigned_class_id uuid references public.classes(id);

-- ---------------------------------------------------------------------------
-- enroll_admission_application: atomically converts a 'registered'
-- application into a student + guardian, capacity-checked against the
-- chosen section. SECURITY INVOKER (the default — not declared here) so it
-- runs under the caller's own RLS: only school_admin/registrar can actually
-- insert into students/guardians or update admission_applications (see
-- 20260713000005_rls_policies.sql, 20260713000008_extended_rls.sql) — this
-- function only adds atomicity across those three writes, it grants no new
-- authority.
-- ---------------------------------------------------------------------------
create or replace function public.enroll_admission_application(
  p_application_id uuid,
  p_class_id        uuid,
  p_admission_no    text
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
  if v_app.stage <> 'registered' then
    raise exception 'application is not at the registered stage';
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
    tenant_id, class_id, admission_no,
    first_name, first_name_am, middle_name, middle_name_am, last_name, last_name_am,
    date_of_birth, gender
  ) values (
    v_app.tenant_id, p_class_id, p_admission_no,
    v_app.applicant_first_name, v_app.applicant_first_name_am,
    v_app.applicant_middle_name, v_app.applicant_middle_name_am,
    v_app.applicant_last_name, v_app.applicant_last_name_am,
    v_app.date_of_birth, v_app.gender
  ) returning id into v_student_id;

  insert into public.guardians (tenant_id, student_id, relationship, phone, email)
  values (
    v_app.tenant_id, v_student_id,
    coalesce(v_app.guardian_relationship::text, 'guardian'),
    v_app.guardian_phone, v_app.guardian_email
  );

  update public.admission_applications
    set converted_student_id = v_student_id, assigned_class_id = p_class_id
    where id = p_application_id;

  return v_student_id;
end;
$$;

grant execute on function public.enroll_admission_application(uuid, uuid, text) to authenticated;
