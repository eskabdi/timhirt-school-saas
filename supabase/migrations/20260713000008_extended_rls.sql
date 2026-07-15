-- ============================================================================
-- 008 RLS — extended modules (§19.1). Fail-closed on every table; FORCE RLS.
-- Pattern reused throughout: tenant match + role scope, super_admin explicit.
-- ============================================================================

-- ---------- Generic tenant-admin tables (single admin-managed resource) ------
-- read = same tenant; write = school_admin (+ specific extra roles noted per table)
do $$
declare
  t text;
  extra_write text;
begin
  for t, extra_write in
    select * from (values
      ('hostel_buildings', ''), ('hostel_rooms', ''),
      ('inventory_items', ''), ('asset_register', ''),
      ('library_books', ''),
      ('transport_routes', ''), ('transport_stops', '')
      -- 'notification_templates' intentionally excluded (H-1 fix): it has no
      -- tenant_id column, so the generic loop's CREATE POLICY ... tenant_id = ...
      -- raised "column tenant_id does not exist" and aborted this entire
      -- migration on deploy. It is handled as a global table below instead.
    ) as v(t, extra_write)
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated using (
        tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        or (select public.get_role_for_user(auth.uid())) = 'super_admin')$f$, t);
    execute format($f$
      create policy %1$s_write on public.%1$I for all to authenticated
      using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and (select public.get_role_for_user(auth.uid())) in ('school_admin','accountant'))
      with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and (select public.get_role_for_user(auth.uid())) in ('school_admin','accountant'))$f$, t);
  end loop;
end $$;
-- notification_templates has no tenant_id (global); handle separately
alter table public.notification_templates disable row level security;
alter table public.notification_templates enable row level security;
alter table public.notification_templates force row level security;
drop policy if exists notification_templates_select on public.notification_templates;
drop policy if exists notification_templates_write on public.notification_templates;
create policy templates_read on public.notification_templates for select to authenticated using (true);
create policy templates_write on public.notification_templates for all to authenticated
using ((select public.get_role_for_user(auth.uid())) = 'super_admin')
with check ((select public.get_role_for_user(auth.uid())) = 'super_admin');

-- ---------- Admissions: registrar + school_admin write; public insert path is
-- via a dedicated Edge Function (service_role) not direct PostgREST insert ---
alter table public.admission_applications enable row level security;
alter table public.admission_applications force row level security;
create policy admissions_select on public.admission_applications for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar')
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
create policy admissions_write on public.admission_applications for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'));
-- No anonymous policy: public submissions go through the submit-admission
-- Edge Function (service_role, rate-limited, CAPTCHA-gated) — never direct table access.

-- ---------- Assignments: teachers own their class assignments ----------------
alter table public.assignments enable row level security;
alter table public.assignments force row level security;
create policy assignments_select on public.assignments for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) = 'school_admin'
        or public.is_teacher_of_class(class_id)
        or exists (select 1 from public.students s where s.class_id = assignments.class_id
                   and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy assignments_write on public.assignments for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and ((select public.get_role_for_user(auth.uid())) = 'school_admin' or public.is_teacher_of_class(class_id)))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and ((select public.get_role_for_user(auth.uid())) = 'school_admin' or public.is_teacher_of_class(class_id)));

alter table public.assignment_submissions enable row level security;
alter table public.assignment_submissions force row level security;
create policy submissions_select on public.assignment_submissions for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) = 'school_admin'
        or exists (select 1 from public.assignments a where a.id = assignment_id and public.is_teacher_of_class(a.class_id))
        or exists (select 1 from public.students s where s.id = student_id
                   and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy submissions_student_insert on public.assignment_submissions for insert to authenticated
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and exists (select 1 from public.students s where s.id = student_id and s.user_id = auth.uid()));
create policy submissions_teacher_grade on public.assignment_submissions for update to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (exists (select 1 from public.assignments a where a.id = assignment_id and public.is_teacher_of_class(a.class_id))
       or (select public.get_role_for_user(auth.uid())) = 'school_admin'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

-- ---------- Hostel allocations / visitor logs (admin-managed, student-scoped read)
alter table public.hostel_allocations enable row level security;
alter table public.hostel_allocations force row level security;
create policy hostel_alloc_select on public.hostel_allocations for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) = 'school_admin'
        or exists (select 1 from public.students s where s.id = student_id
                   and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy hostel_alloc_write on public.hostel_allocations for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin');

alter table public.hostel_visitor_logs enable row level security;
alter table public.hostel_visitor_logs force row level security;
create policy visitor_logs_select on public.hostel_visitor_logs for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) = 'school_admin');
create policy visitor_logs_write on public.hostel_visitor_logs for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin');

-- ---------- Inventory movements (admin/accountant write; append-friendly) ----
alter table public.inventory_movements enable row level security;
alter table public.inventory_movements force row level security;
create policy inv_move_select on public.inventory_movements for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','accountant'));
create policy inv_move_write on public.inventory_movements for insert to authenticated
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','accountant'));

-- ---------- Discipline: teachers can log incidents; admin manages all -------
alter table public.discipline_incidents enable row level security;
alter table public.discipline_incidents force row level security;
create policy discipline_select on public.discipline_incidents for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) = 'school_admin'
        or reported_by = auth.uid()
        or exists (select 1 from public.students s where s.id = student_id
                   and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy discipline_insert on public.discipline_incidents for insert to authenticated
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','teacher'));
create policy discipline_update on public.discipline_incidents for update to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

-- ---------- Clinic (medical PII — admin/nurse only, no student/parent select)
alter table public.clinic_visits enable row level security;
alter table public.clinic_visits force row level security;
create policy clinic_select on public.clinic_visits for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) = 'school_admin');
create policy clinic_write on public.clinic_visits for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin');

alter table public.health_conditions enable row level security;
alter table public.health_conditions force row level security;
create policy health_select on public.health_conditions for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) = 'school_admin');
create policy health_write on public.health_conditions for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin');

-- ---------- ID cards: admin/registrar manage; verify_code is looked up via
-- a SECURITY DEFINER function for the public /verify/:code route (no table
-- grant to anon — avoids leaking the whole registry) ---------------------------
alter table public.id_card_batches enable row level security;
alter table public.id_card_batches force row level security;
create policy idbatch_all on public.id_card_batches for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'));

alter table public.id_cards enable row level security;
alter table public.id_cards force row level security;
create policy idcards_select on public.id_cards for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'));
create policy idcards_write on public.id_cards for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'));

-- Public verification RPC — returns only non-sensitive fields, rate-limited at
-- the Edge/gateway layer; never exposes the id_cards table directly to anon.
create or replace function public.verify_id_card(p_code text)
returns table (subject_type text, issued_on date, tenant_name text, valid boolean)
language sql stable security definer set search_path = public as $$
  select c.subject_type, c.issued_on, t.name, true
  from public.id_cards c join public.tenants t on t.id = c.tenant_id
  where c.verify_code = p_code
$$;
revoke all on function public.verify_id_card(text) from public;
grant execute on function public.verify_id_card(text) to anon, authenticated;

-- ---------- Library checkouts (admin/librarian write; students see own) -----
alter table public.library_checkouts enable row level security;
alter table public.library_checkouts force row level security;
create policy checkouts_select on public.library_checkouts for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    (select public.get_role_for_user(auth.uid())) = 'school_admin'
    or exists (select 1 from public.students s where s.id = student_id
               and (s.user_id = auth.uid() or public.is_guardian_of(s.id))))
);
create policy checkouts_write on public.library_checkouts for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin');

-- ---------- Transport assignment (admin write; parent/student read own) -----
alter table public.student_route_assignments enable row level security;
alter table public.student_route_assignments force row level security;
create policy route_assign_select on public.student_route_assignments for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    (select public.get_role_for_user(auth.uid())) = 'school_admin'
    or exists (select 1 from public.students s where s.id = student_id
               and (s.user_id = auth.uid() or public.is_guardian_of(s.id))))
);
create policy route_assign_write on public.student_route_assignments for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin');

-- ---------- Announcements: audience-aware read ---------------------------------
alter table public.announcements enable row level security;
alter table public.announcements force row level security;
create policy announcements_select on public.announcements for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    audience = 'all'
    or (audience = 'staff' and (select public.get_role_for_user(auth.uid())) <> 'student' and (select public.get_role_for_user(auth.uid())) <> 'parent')
    or (audience = 'parents' and (select public.get_role_for_user(auth.uid())) in ('parent','school_admin'))
    or (audience = 'class' and (
          exists (select 1 from public.students s where s.class_id = announcements.class_id and s.user_id = auth.uid())
          or exists (select 1 from public.students s where s.class_id = announcements.class_id and public.is_guardian_of(s.id))
          or public.is_teacher_of_class(class_id)))
    or (select public.get_role_for_user(auth.uid())) = 'school_admin'))
);
create policy announcements_write on public.announcements for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','teacher'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','teacher'));

alter table public.notification_log enable row level security;
alter table public.notification_log force row level security;
create policy notiflog_select on public.notification_log for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) = 'school_admin');
-- writes: service_role only (send-bulk-notification Edge Function)

-- ---------- MoE exports (admin + super_admin only) ---------------------------
alter table public.moe_exports enable row level security;
alter table public.moe_exports force row level security;
create policy moe_select on public.moe_exports for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
      and (select public.get_role_for_user(auth.uid())) = 'school_admin'));
create policy moe_write on public.moe_exports for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin');

-- ---------- Timetable ------------------------------------------------------------
alter table public.timetable_slots enable row level security;
alter table public.timetable_slots force row level security;
create policy timetable_select on public.timetable_slots for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin');
create policy timetable_write on public.timetable_slots for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin');
