-- ============================================================================
-- Ethnicity on the admission application, and carried across on enrolment.
--
-- 20260729000002 added students.ethnicity for the dashboard's breakdown, but
-- nothing wrote it: no form collected it, and enroll_admission_application
-- copied only names, date of birth and gender from the application onto the
-- new student row. The chart would have read "not recorded" for every student
-- forever.
--
-- Collecting it on the application is the right place. It is asked once, by
-- the family, in their own words, rather than being guessed at later by a
-- registrar — and enrolment then carries it over rather than losing it.
-- ============================================================================

alter table public.admission_applications
  add column if not exists ethnicity text;

-- Same shape rule as students.ethnicity, and for the same reason: the set of
-- groups is not enumerated in the database. Ethiopia's census counts more than
-- eighty and the official list is revised as regions are reorganised, so a
-- membership constraint would mean a migration every time a school enrolled a
-- student the list forgot — and would push the smallest communities into
-- 'other', which is precisely the outcome the column exists to prevent. The
-- offered list lives in src/lib/ethnic-groups.ts.
do $$ begin
  alter table public.admission_applications add constraint admissions_ethnicity_check
    check (ethnicity is null or ethnicity ~ '^[a-z][a-z0-9_]{1,39}$');
exception when duplicate_object then null; end $$;

comment on column public.admission_applications.ethnicity is
  'Self-declared ethnic group, as a lower_snake key. Copied to '
  'students.ethnicity by enroll_admission_application(). Nullable: a family '
  'that declines to answer must still be able to submit an application.';

-- ---------------------------------------------------------------------------
-- enroll_admission_application: carry ethnicity onto the student row.
--
-- Body is 20260719000005's verbatim, plus the one column. 20260719000001 also
-- defines this function, but ...0005 replaced it (and dropped the older 3-arg
-- signature so PostgREST cannot route to a stale one), so ...0005 is the only
-- live definition and the only one that needs editing.
--
-- create or replace keeps existing grants; the grant is restated at the bottom
-- anyway so the function survives a future drop-and-recreate with its access
-- intact.
-- ---------------------------------------------------------------------------
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
    set converted_student_id = v_student_id, assigned_class_id = p_class_id
    where id = p_application_id;

  return v_student_id;
end;
$$;

grant execute on function public.enroll_admission_application(uuid, uuid) to authenticated;
