-- ============================================================================
-- Role/user permissions matrix -- Phase 2, Academics & SIS domain.
--
-- Rewires 19 tables onto has_resource_permission(). The rule for every one
-- of them, without exception: only the flat staff-role-list branch of a
-- policy is replaced by a matrix check. Every relationship branch already in
-- a policy -- is_teacher_of_class(), is_guardian_of(), self
-- (`user_id = auth.uid()` / `s.user_id = auth.uid()`), reported_by -- is
-- copied verbatim, unchanged, into the new policy text. Where a table's
-- WITH CHECK re-validates less than its USING (grades_update, attendance_
-- update: WITH CHECK is tenant-only, no role recheck), that asymmetry is
-- preserved exactly, not "fixed" to be symmetric. Where a table has no
-- super_admin bypass today (all the write-side policies below), none is
-- added. Where an action has no existing policy at all (grades/attendance/
-- assignment_submissions/discipline_incidents have no DELETE policy;
-- assignment_submissions' student-self INSERT has no staff-role branch to
-- replace), no permission row or policy is created for that action -- there
-- is nothing for the matrix to gate.
-- ============================================================================

insert into public.permissions (key, module, resource, action, description) values
  ('students:create', 'sis', 'students', 'create', 'Create students'),
  ('students:read',   'sis', 'students', 'read',   'View students'),
  ('students:update', 'sis', 'students', 'update', 'Edit students'),
  ('students:delete', 'sis', 'students', 'delete', 'Delete students'),
  ('guardians:create', 'sis', 'guardians', 'create', 'Create guardians'),
  ('guardians:read',   'sis', 'guardians', 'read',   'View guardians'),
  ('guardians:update', 'sis', 'guardians', 'update', 'Edit guardians'),
  ('guardians:delete', 'sis', 'guardians', 'delete', 'Delete guardians'),
  ('teachers:create', 'academics', 'teachers', 'create', 'Create teachers'),
  ('teachers:read',   'academics', 'teachers', 'read',   'View teachers'),
  ('teachers:update', 'academics', 'teachers', 'update', 'Edit teachers'),
  ('teachers:delete', 'academics', 'teachers', 'delete', 'Delete teachers'),
  ('grades:create', 'gradebook', 'grades', 'create', 'Enter grades'),
  ('grades:read',   'gradebook', 'grades', 'read',   'View grades'),
  ('grades:update', 'gradebook', 'grades', 'update', 'Edit grades'),
  ('attendance:create', 'attendance', 'attendance', 'create', 'Mark attendance'),
  ('attendance:read',   'attendance', 'attendance', 'read',   'View attendance'),
  ('attendance:update', 'attendance', 'attendance', 'update', 'Edit attendance'),
  ('exams:create', 'academics', 'exams', 'create', 'Create exams'),
  ('exams:read',   'academics', 'exams', 'read',   'View exams'),
  ('exams:update', 'academics', 'exams', 'update', 'Edit exams'),
  ('exams:delete', 'academics', 'exams', 'delete', 'Delete exams'),
  ('assignments:create', 'assignments', 'assignments', 'create', 'Create assignments'),
  ('assignments:read',   'assignments', 'assignments', 'read',   'View assignments'),
  ('assignments:update', 'assignments', 'assignments', 'update', 'Edit assignments'),
  ('assignments:delete', 'assignments', 'assignments', 'delete', 'Delete assignments'),
  ('assignment_sections:create', 'assignments', 'assignment_sections', 'create', 'Create assignment sections'),
  ('assignment_sections:read',   'assignments', 'assignment_sections', 'read',   'View assignment sections'),
  ('assignment_sections:update', 'assignments', 'assignment_sections', 'update', 'Edit assignment sections'),
  ('assignment_sections:delete', 'assignments', 'assignment_sections', 'delete', 'Delete assignment sections'),
  ('assignment_attachments:create', 'assignments', 'assignment_attachments', 'create', 'Create assignment attachments'),
  ('assignment_attachments:read',   'assignments', 'assignment_attachments', 'read',   'View assignment attachments'),
  ('assignment_attachments:update', 'assignments', 'assignment_attachments', 'update', 'Edit assignment attachments'),
  ('assignment_attachments:delete', 'assignments', 'assignment_attachments', 'delete', 'Delete assignment attachments'),
  ('assignment_submissions:read',   'assignments', 'assignment_submissions', 'read',   'View assignment submissions'),
  ('assignment_submissions:update', 'assignments', 'assignment_submissions', 'update', 'Grade assignment submissions'),
  ('discipline_incidents:create', 'discipline', 'discipline_incidents', 'create', 'File discipline incidents'),
  ('discipline_incidents:read',   'discipline', 'discipline_incidents', 'read',   'View discipline incidents'),
  ('discipline_incidents:update', 'discipline', 'discipline_incidents', 'update', 'Edit discipline incidents'),
  ('student_merits:create', 'discipline', 'student_merits', 'create', 'Award student merits'),
  ('student_merits:read',   'discipline', 'student_merits', 'read',   'View student merits'),
  ('student_merits:update', 'discipline', 'student_merits', 'update', 'Edit student merits'),
  ('student_merits:delete', 'discipline', 'student_merits', 'delete', 'Delete student merits'),
  ('class_subject_teachers:create', 'academics', 'class_subject_teachers', 'create', 'Assign teacher to class/subject'),
  ('class_subject_teachers:read',   'academics', 'class_subject_teachers', 'read',   'View class/subject/teacher assignments'),
  ('class_subject_teachers:update', 'academics', 'class_subject_teachers', 'update', 'Edit class/subject/teacher assignments'),
  ('class_subject_teachers:delete', 'academics', 'class_subject_teachers', 'delete', 'Remove class/subject/teacher assignments'),
  ('periods:create', 'academics', 'periods', 'create', 'Create timetable periods'),
  ('periods:read',   'academics', 'periods', 'read',   'View timetable periods'),
  ('periods:update', 'academics', 'periods', 'update', 'Edit timetable periods'),
  ('periods:delete', 'academics', 'periods', 'delete', 'Delete timetable periods'),
  ('academic_years:create', 'academics', 'academic_years', 'create', 'Create academic years'),
  ('academic_years:read',   'academics', 'academic_years', 'read',   'View academic years'),
  ('academic_years:update', 'academics', 'academic_years', 'update', 'Edit academic years'),
  ('academic_years:delete', 'academics', 'academic_years', 'delete', 'Delete academic years'),
  ('academic_terms:create', 'academics', 'academic_terms', 'create', 'Create academic terms'),
  ('academic_terms:read',   'academics', 'academic_terms', 'read',   'View academic terms'),
  ('academic_terms:update', 'academics', 'academic_terms', 'update', 'Edit academic terms'),
  ('academic_terms:delete', 'academics', 'academic_terms', 'delete', 'Delete academic terms'),
  ('grading_scales:create', 'academics', 'grading_scales', 'create', 'Create grading scales'),
  ('grading_scales:read',   'academics', 'grading_scales', 'read',   'View grading scales'),
  ('grading_scales:update', 'academics', 'grading_scales', 'update', 'Edit grading scales'),
  ('grading_scales:delete', 'academics', 'grading_scales', 'delete', 'Delete grading scales'),
  ('grade_bands:create', 'academics', 'grade_bands', 'create', 'Create grade bands'),
  ('grade_bands:read',   'academics', 'grade_bands', 'read',   'View grade bands'),
  ('grade_bands:update', 'academics', 'grade_bands', 'update', 'Edit grade bands'),
  ('grade_bands:delete', 'academics', 'grade_bands', 'delete', 'Delete grade bands'),
  ('report_templates:create', 'academics', 'report_templates', 'create', 'Create report templates'),
  ('report_templates:read',   'academics', 'report_templates', 'read',   'View report templates'),
  ('report_templates:update', 'academics', 'report_templates', 'update', 'Edit report templates'),
  ('report_templates:delete', 'academics', 'report_templates', 'delete', 'Delete report templates'),
  ('admission_applications:create', 'admissions', 'admission_applications', 'create', 'Create admission applications'),
  ('admission_applications:read',   'admissions', 'admission_applications', 'read',   'View admission applications'),
  ('admission_applications:update', 'admissions', 'admission_applications', 'update', 'Edit admission applications'),
  ('admission_applications:delete', 'admissions', 'admission_applications', 'delete', 'Delete admission applications')
on conflict (key) do nothing;

insert into public.resource_open_actions (resource, action) values
  ('teachers', 'read'), ('class_subject_teachers', 'read'), ('periods', 'read'),
  ('academic_years', 'read'), ('academic_terms', 'read'), ('exams', 'read'),
  ('grading_scales', 'read'), ('grade_bands', 'read'), ('report_templates', 'read'),
  ('assignment_sections', 'read'), ('assignment_attachments', 'read');

insert into public.resource_default_role_grants (resource, action, role) values
  ('teachers', 'create', 'school_admin'), ('teachers', 'create', 'hr_officer'),
  ('teachers', 'update', 'school_admin'), ('teachers', 'update', 'hr_officer'),
  ('teachers', 'delete', 'school_admin'), ('teachers', 'delete', 'hr_officer'),
  ('class_subject_teachers', 'create', 'school_admin'), ('class_subject_teachers', 'update', 'school_admin'), ('class_subject_teachers', 'delete', 'school_admin'),
  ('periods', 'create', 'school_admin'), ('periods', 'update', 'school_admin'), ('periods', 'delete', 'school_admin'),
  ('academic_years', 'create', 'school_admin'), ('academic_years', 'update', 'school_admin'), ('academic_years', 'delete', 'school_admin'),
  ('academic_terms', 'create', 'school_admin'), ('academic_terms', 'update', 'school_admin'), ('academic_terms', 'delete', 'school_admin'),
  ('exams', 'create', 'school_admin'), ('exams', 'update', 'school_admin'), ('exams', 'delete', 'school_admin'),
  ('grading_scales', 'create', 'school_admin'), ('grading_scales', 'update', 'school_admin'), ('grading_scales', 'delete', 'school_admin'),
  ('grade_bands', 'create', 'school_admin'), ('grade_bands', 'update', 'school_admin'), ('grade_bands', 'delete', 'school_admin'),
  ('report_templates', 'create', 'school_admin'), ('report_templates', 'update', 'school_admin'), ('report_templates', 'delete', 'school_admin'),
  ('assignment_sections', 'create', 'school_admin'), ('assignment_sections', 'create', 'teacher'),
  ('assignment_sections', 'update', 'school_admin'), ('assignment_sections', 'update', 'teacher'),
  ('assignment_sections', 'delete', 'school_admin'), ('assignment_sections', 'delete', 'teacher'),
  ('assignment_attachments', 'create', 'school_admin'), ('assignment_attachments', 'create', 'teacher'),
  ('assignment_attachments', 'update', 'school_admin'), ('assignment_attachments', 'update', 'teacher'),
  ('assignment_attachments', 'delete', 'school_admin'), ('assignment_attachments', 'delete', 'teacher'),
  ('students', 'read', 'school_admin'), ('students', 'read', 'registrar'), ('students', 'read', 'librarian'),
  ('students', 'create', 'school_admin'), ('students', 'create', 'registrar'),
  ('students', 'update', 'school_admin'), ('students', 'update', 'registrar'),
  ('students', 'delete', 'school_admin'), ('students', 'delete', 'registrar'),
  ('guardians', 'read', 'school_admin'), ('guardians', 'read', 'registrar'),
  ('guardians', 'create', 'school_admin'), ('guardians', 'create', 'registrar'),
  ('guardians', 'update', 'school_admin'), ('guardians', 'update', 'registrar'),
  ('guardians', 'delete', 'school_admin'), ('guardians', 'delete', 'registrar'),
  ('grades', 'read', 'school_admin'), ('grades', 'create', 'school_admin'), ('grades', 'update', 'school_admin'),
  ('attendance', 'read', 'school_admin'), ('attendance', 'create', 'school_admin'), ('attendance', 'update', 'school_admin'),
  ('assignments', 'read', 'school_admin'), ('assignments', 'create', 'school_admin'),
  ('assignments', 'update', 'school_admin'), ('assignments', 'delete', 'school_admin'),
  ('assignment_submissions', 'read', 'school_admin'), ('assignment_submissions', 'update', 'school_admin'),
  ('discipline_incidents', 'read', 'school_admin'),
  ('discipline_incidents', 'create', 'school_admin'), ('discipline_incidents', 'create', 'teacher'),
  ('discipline_incidents', 'update', 'school_admin'),
  ('student_merits', 'read', 'school_admin'), ('student_merits', 'read', 'teacher'), ('student_merits', 'read', 'registrar'),
  ('student_merits', 'create', 'school_admin'), ('student_merits', 'create', 'teacher'),
  ('student_merits', 'update', 'school_admin'), ('student_merits', 'update', 'teacher'),
  ('student_merits', 'delete', 'school_admin'), ('student_merits', 'delete', 'teacher'),
  ('admission_applications', 'read', 'school_admin'), ('admission_applications', 'read', 'registrar'),
  ('admission_applications', 'create', 'school_admin'), ('admission_applications', 'create', 'registrar'),
  ('admission_applications', 'update', 'school_admin'), ('admission_applications', 'update', 'registrar'),
  ('admission_applications', 'delete', 'school_admin'), ('admission_applications', 'delete', 'registrar');

-- ---------- simple resources: open read, write = school_admin only ---------
do $$
declare t text;
begin
  foreach t in array array['class_subject_teachers', 'periods', 'academic_years', 'academic_terms',
                           'exams', 'grading_scales', 'grade_bands', 'report_templates']
  loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('drop policy if exists %1$s_write on public.%1$I', t);
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated using (
        (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
         and public.has_resource_permission(auth.uid(), %1$L, 'read'))
        or (select public.get_role_for_user(auth.uid())) = 'super_admin')$f$, t);
    execute format($f$
      create policy %1$s_insert on public.%1$I for insert to authenticated with check (
        tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        and public.has_resource_permission(auth.uid(), %1$L, 'create'))$f$, t);
    execute format($f$
      create policy %1$s_update on public.%1$I for update to authenticated
      using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and public.has_resource_permission(auth.uid(), %1$L, 'update'))
      with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and public.has_resource_permission(auth.uid(), %1$L, 'update'))$f$, t);
    execute format($f$
      create policy %1$s_delete on public.%1$I for delete to authenticated using (
        tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        and public.has_resource_permission(auth.uid(), %1$L, 'delete'))$f$, t);
  end loop;
end $$;

-- ---------- teachers: open read, write = school_admin + hr_officer ---------
drop policy if exists teachers_select on public.teachers;
drop policy if exists teachers_write on public.teachers;
create policy teachers_select on public.teachers for select to authenticated using (
  (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
   and public.has_resource_permission(auth.uid(), 'teachers', 'read'))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin');
create policy teachers_insert on public.teachers for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'teachers', 'create'));
create policy teachers_update on public.teachers for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'teachers', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'teachers', 'update'));
create policy teachers_delete on public.teachers for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'teachers', 'delete'));

-- ---------- assignment_sections / assignment_attachments: open read, ------
-- ---------- write = school_admin + teacher (unscoped by class today) ------
do $$
declare t text;
begin
  foreach t in array array['assignment_sections', 'assignment_attachments']
  loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('drop policy if exists %1$s_write on public.%1$I', t);
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated using (
        (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
         and public.has_resource_permission(auth.uid(), %1$L, 'read'))
        or (select public.get_role_for_user(auth.uid())) = 'super_admin')$f$, t);
    execute format($f$
      create policy %1$s_insert on public.%1$I for insert to authenticated with check (
        tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        and public.has_resource_permission(auth.uid(), %1$L, 'create'))$f$, t);
    execute format($f$
      create policy %1$s_update on public.%1$I for update to authenticated
      using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and public.has_resource_permission(auth.uid(), %1$L, 'update'))
      with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and public.has_resource_permission(auth.uid(), %1$L, 'update'))$f$, t);
    execute format($f$
      create policy %1$s_delete on public.%1$I for delete to authenticated using (
        tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        and public.has_resource_permission(auth.uid(), %1$L, 'delete'))$f$, t);
  end loop;
end $$;

-- ---------- students: relationship branches preserved verbatim -------------
drop policy if exists students_select on public.students;
drop policy if exists students_write on public.students;
create policy students_select on public.students for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'students', 'read')
        or public.is_teacher_of_class(class_id)
        or user_id = auth.uid()
        or public.is_guardian_of(id)))
);
create policy students_insert on public.students for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'students', 'create'));
create policy students_update on public.students for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'students', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'students', 'update'));
create policy students_delete on public.students for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'students', 'delete'));

-- ---------- guardians: self branch preserved verbatim -----------------------
drop policy if exists guardians_select on public.guardians;
drop policy if exists guardians_write on public.guardians;
create policy guardians_select on public.guardians for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'guardians', 'read')
        or user_id = auth.uid()))
);
create policy guardians_insert on public.guardians for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'guardians', 'create'));
create policy guardians_update on public.guardians for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'guardians', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'guardians', 'update'));
create policy guardians_delete on public.guardians for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'guardians', 'delete'));

-- ---------- grades: teacher-of-class/self/guardian preserved; no DELETE ----
-- ---------- policy exists today, so none is created. UPDATE's WITH CHECK --
-- ---------- stays tenant-only, matching the original asymmetry. -----------
drop policy if exists grades_select on public.grades;
drop policy if exists grades_write on public.grades;
drop policy if exists grades_update on public.grades;
create policy grades_select on public.grades for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'grades', 'read')
        or exists (select 1 from public.students s where s.id = student_id
                   and (public.is_teacher_of_class(s.class_id) or s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy grades_insert on public.grades for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (public.has_resource_permission(auth.uid(), 'grades', 'create')
       or exists (select 1 from public.students s where s.id = student_id and public.is_teacher_of_class(s.class_id))));
create policy grades_update on public.grades for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
         and (public.has_resource_permission(auth.uid(), 'grades', 'update')
              or exists (select 1 from public.students s where s.id = student_id and public.is_teacher_of_class(s.class_id))))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

-- ---------- attendance: same shape as grades, no DELETE policy -------------
drop policy if exists attendance_select on public.attendance;
drop policy if exists attendance_write on public.attendance;
drop policy if exists attendance_update on public.attendance;
create policy attendance_select on public.attendance for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'attendance', 'read')
        or public.is_teacher_of_class(class_id)
        or exists (select 1 from public.students s where s.id = student_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy attendance_insert on public.attendance for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (public.has_resource_permission(auth.uid(), 'attendance', 'create') or public.is_teacher_of_class(class_id)));
create policy attendance_update on public.attendance for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
         and (public.has_resource_permission(auth.uid(), 'attendance', 'update') or public.is_teacher_of_class(class_id)))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

-- ---------- assignments: is_teacher_of_class preserved on all 4 actions ----
drop policy if exists assignments_select on public.assignments;
drop policy if exists assignments_write on public.assignments;
create policy assignments_select on public.assignments for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'assignments', 'read')
        or public.is_teacher_of_class(class_id)
        or exists (select 1 from public.students s where s.class_id = assignments.class_id
                   and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy assignments_insert on public.assignments for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (public.has_resource_permission(auth.uid(), 'assignments', 'create') or public.is_teacher_of_class(class_id)));
create policy assignments_update on public.assignments for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
         and (public.has_resource_permission(auth.uid(), 'assignments', 'update') or public.is_teacher_of_class(class_id)))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
         and (public.has_resource_permission(auth.uid(), 'assignments', 'update') or public.is_teacher_of_class(class_id)));
create policy assignments_delete on public.assignments for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (public.has_resource_permission(auth.uid(), 'assignments', 'delete') or public.is_teacher_of_class(class_id)));

-- ---------- assignment_submissions: student-self INSERT has no staff-role --
-- ---------- branch, so it is left completely untouched (no 'create' -------
-- ---------- permission exists for this resource). -------------------------
drop policy if exists submissions_select on public.assignment_submissions;
drop policy if exists submissions_teacher_grade on public.assignment_submissions;
create policy submissions_select on public.assignment_submissions for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'assignment_submissions', 'read')
        or exists (select 1 from public.assignments a where a.id = assignment_id and public.is_teacher_of_class(a.class_id))
        or exists (select 1 from public.students s where s.id = student_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy submissions_teacher_grade on public.assignment_submissions for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
         and (exists (select 1 from public.assignments a where a.id = assignment_id and public.is_teacher_of_class(a.class_id))
              or public.has_resource_permission(auth.uid(), 'assignment_submissions', 'update')))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

-- ---------- discipline_incidents: reported_by/self/guardian preserved; -----
-- ---------- INSERT's flat role list has no relationship branch to keep. ---
drop policy if exists discipline_select on public.discipline_incidents;
drop policy if exists discipline_insert on public.discipline_incidents;
drop policy if exists discipline_update on public.discipline_incidents;
create policy discipline_select on public.discipline_incidents for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'discipline_incidents', 'read')
        or reported_by = auth.uid()
        or exists (select 1 from public.students s where s.id = student_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy discipline_insert on public.discipline_incidents for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'discipline_incidents', 'create'));
create policy discipline_update on public.discipline_incidents for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'discipline_incidents', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

-- ---------- student_merits: self/guardian preserved -------------------------
drop policy if exists student_merits_select on public.student_merits;
drop policy if exists student_merits_write on public.student_merits;
create policy student_merits_select on public.student_merits for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'student_merits', 'read')
        or exists (select 1 from public.students s where s.id = student_id and s.user_id = auth.uid())
        or exists (select 1 from public.guardians g where g.student_id = student_merits.student_id and g.user_id = auth.uid())))
);
create policy student_merits_insert on public.student_merits for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'student_merits', 'create'));
create policy student_merits_update on public.student_merits for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'student_merits', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'student_merits', 'update'));
create policy student_merits_delete on public.student_merits for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'student_merits', 'delete'));

-- ---------- admission_applications: simple, no relationship branch --------
drop policy if exists admissions_select on public.admission_applications;
drop policy if exists admissions_write on public.admission_applications;
create policy admissions_select on public.admission_applications for select to authenticated using (
  (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
   and public.has_resource_permission(auth.uid(), 'admission_applications', 'read'))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin');
create policy admissions_insert on public.admission_applications for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'admission_applications', 'create'));
create policy admissions_update on public.admission_applications for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'admission_applications', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'admission_applications', 'update'));
create policy admissions_delete on public.admission_applications for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'admission_applications', 'delete'));
