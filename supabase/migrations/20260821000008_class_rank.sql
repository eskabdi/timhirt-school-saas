-- ============================================================================
-- StudentDetailPage.tsx and AcademicRecordTab.tsx both hardcode a "Class
-- Rank" stat card to "—". Class rank was genuinely impossible before Round
-- 1's grading fix (exams had no class_id at all); it's buildable now, but
-- computing it requires reading every classmate's grades, which grades_select
-- (20260817000002_resource_permissions_academics.sql:273-278) correctly does
-- NOT allow a self-viewing student or guardian to do directly -- they can
-- only read their own child's/own grades. A rank NUMBER doesn't leak any
-- classmate's actual scores, so this is a narrow SECURITY DEFINER function
-- that computes and returns only the rank + roster size, re-deriving the
-- same authorization grades_select already grants for viewing THIS
-- student's own academic data (self, guardian, teacher-of-class, or
-- grades:read staff) before it will compute anything.
--
-- GPA-point ladder here is a literal copy of academic-record.ts's current
-- gradePoint() thresholds, so the rank card is consistent with the GPA card
-- it sits next to (both come from academic-record.ts's fetchAcademicRecord()
-- today). This will be replaced by a grading_scales-driven lookup in the
-- next fix, at which point this function is updated to match, in the same
-- migration that updates the client-side GPA/letter logic.
--
-- Scope note: like fetchAcademicRecord(), this aggregates ALL grades ever
-- recorded, not a single academic term -- there is no "current term" concept
-- plumbed through this screen anywhere in the app today, and scoping rank to
-- a term while the GPA card next to it stays all-time would make the two
-- numbers measure different things on the same screen.
-- ============================================================================
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
    select student_id,
           case
             when ca_total + final_total >= 90 then 4.0
             when ca_total + final_total >= 85 then 3.75
             when ca_total + final_total >= 80 then 3.5
             when ca_total + final_total >= 75 then 3.0
             when ca_total + final_total >= 70 then 2.5
             when ca_total + final_total >= 60 then 2.0
             when ca_total + final_total >= 50 then 1.0
             else 0
           end as points
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

grant execute on function public.get_class_rank(uuid, uuid) to authenticated;
