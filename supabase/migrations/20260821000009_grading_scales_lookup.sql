-- ============================================================================
-- AcademicRecordTab.tsx hardcoded its own letter-grade ladder, completely
-- disconnected from the grading_scales/grade_bands a school configures in
-- Settings > Grading Scales. academic-record.ts (client) now looks up the
-- tenant's default scale for real, falling back to the old ladder only when
-- a tenant hasn't configured one yet (true for every tenant today -- no
-- default scale is seeded on tenant creation).
--
-- get_class_rank() (20260821000008_class_rank.sql) computed GPA with its
-- own literal copy of that same old ladder, so it must be updated the same
-- way here, in this same migration, or the GPA card and the rank card would
-- silently disagree about what a score is worth the moment a school
-- configures a real scale.
--
-- grade_point_for() is SECURITY DEFINER (like get_class_rank() that calls
-- it) purely so it can be called from within that SECURITY DEFINER context;
-- it does no authorization of its own -- grade_bands is already readable by
-- any authenticated user in the tenant (grading_scales_select /
-- grade_bands_select, 20260728000001_assignments_and_grading_scales.sql),
-- so there's nothing to gate here beyond what get_class_rank() already checks.
-- ============================================================================
create or replace function public.grade_point_for(p_tenant_id uuid, p_total numeric)
returns numeric
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_scale_id uuid;
  v_points   numeric;
begin
  select id into v_scale_id from public.grading_scales
    where tenant_id = p_tenant_id and is_default limit 1;

  if v_scale_id is null then
    -- Fallback ladder -- literal match of academic-record.ts's FALLBACK_BANDS,
    -- used for every tenant that hasn't configured a scale yet.
    return case
      when p_total >= 90 then 4.0
      when p_total >= 85 then 3.75
      when p_total >= 80 then 3.5
      when p_total >= 75 then 3.0
      when p_total >= 70 then 2.5
      when p_total >= 60 then 2.0
      when p_total >= 50 then 1.0
      else 0
    end;
  end if;

  select gpa_points into v_points from public.grade_bands
    where scale_id = v_scale_id and min_percent <= p_total
    order by min_percent desc limit 1;

  return coalesce(v_points, 0);
end;
$$;

grant execute on function public.grade_point_for(uuid, numeric) to authenticated;

create or replace function public.get_class_rank(p_student_id uuid, p_class_id uuid)
returns table(rank int, total_students int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id   uuid := public.get_tenant_id_for_user(auth.uid());
  v_authorized  boolean;
begin
  if v_tenant_id is null then
    return;
  end if;

  select exists (
    select 1 from public.students s
    where s.id = p_student_id
      and s.tenant_id = v_tenant_id
      and s.class_id = p_class_id
      and (
        (select public.get_role_for_user(auth.uid())) = 'super_admin'
        or coalesce(public.has_resource_permission(auth.uid(), 'grades', 'read'), false)
        or public.is_teacher_of_class(s.class_id)
        or s.user_id = auth.uid()
        or public.is_guardian_of(s.id)
      )
  ) into v_authorized;

  if not v_authorized then
    return;
  end if;

  return query
  with roster as (
    select id from public.students
    where class_id = p_class_id and tenant_id = v_tenant_id and status = 'active'
  ),
  per_subject as (
    select g.student_id, g.subject_id,
           sum(case when e.category = 'final' then g.score else 0 end) as final_total,
           sum(case when e.category is distinct from 'final' then g.score else 0 end) as ca_total
    from public.grades g
    join public.exams e on e.id = g.exam_id
    where g.student_id in (select id from roster)
    group by g.student_id, g.subject_id
  ),
  per_subject_points as (
    select student_id, public.grade_point_for(v_tenant_id, ca_total + final_total) as points
    from per_subject
  ),
  per_student_gpa as (
    select roster.id as student_id, coalesce(avg(psp.points), 0) as gpa
    from roster
    left join per_subject_points psp on psp.student_id = roster.id
    group by roster.id
  ),
  ranked as (
    select student_id, dense_rank() over (order by gpa desc) as rnk
    from per_student_gpa
  )
  select r.rnk::int, (select count(*) from roster)::int
  from ranked r
  where r.student_id = p_student_id;
end;
$$;
