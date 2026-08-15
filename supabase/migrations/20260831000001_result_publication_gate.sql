-- ============================================================================
-- R4-C4: result publication gate. Confirmed scope: report cards/transcripts
-- hidden from the parent/student portal until a school_admin publishes
-- them per term; staff (school_admin, teachers, anyone with grades:read)
-- always see everything, published or not.
--
-- Gated at the source: grades, not a frontend check. Everything that
-- renders a student's academic record -- AcademicRecordTab, the transcript
-- PDF, the GPA/rank stat cards -- already reads through fetchAcademicRecord()
-- / a direct grades query, all of which go through RLS. One RESTRICTIVE
-- policy (same technique as has_module()'s module gate, 20260821000003)
-- adds "published OR you're staff" as an additional AND condition on top
-- of grades_select's existing permissive policy, rather than touching that
-- policy or any of the ~5 places that read grades.
-- ============================================================================
alter table public.academic_terms
  add column results_published    boolean not null default false,
  add column results_published_at timestamptz,
  add column results_published_by uuid references public.users(id);

create policy grades_publication_gate on public.grades as restrictive for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (select public.get_role_for_user(auth.uid())) = 'school_admin'
  or exists (select 1 from public.students s where s.id = student_id and public.is_teacher_of_class(s.class_id))
  or public.has_resource_permission(auth.uid(), 'grades', 'read')
  or exists (
    select 1 from public.exams e join public.academic_terms t on t.id = e.academic_term_id
    where e.id = exam_id and t.results_published = true
  )
);
