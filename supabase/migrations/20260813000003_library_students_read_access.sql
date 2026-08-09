-- ============================================================================
-- The circulation desk's student search (LibraryCirculationPage.tsx) queries
-- `students` directly through the RLS-scoped client, the same as every other
-- staff search feature in this app. students_select (20260713000005) never
-- anticipated a librarian role and only admits school_admin/registrar (plus
-- self/guardian/teacher-of-class) -- without this, a librarian's own student
-- search silently returns zero rows tenant-wide, not an error, so the gap
-- would have shipped invisibly.
-- ============================================================================
drop policy students_select on public.students;
create policy students_select on public.students for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar','librarian')
        or public.is_teacher_of_class(class_id)
        or user_id = auth.uid()
        or public.is_guardian_of(id)))
);
