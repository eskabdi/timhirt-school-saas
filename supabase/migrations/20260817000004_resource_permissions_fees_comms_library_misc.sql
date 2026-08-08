-- ============================================================================
-- Role/user permissions matrix -- Phase 2, Fees/Comms/Library/Student
-- Services/Reports domain (the last of the four domain migrations).
--
-- Same rule as every prior migration in this series: only the flat
-- staff-role-list branch of a policy is ever replaced; every relationship
-- branch (student/guardian self-access via a join, audience/visibility
-- targeting) stays verbatim. Where a table has no super_admin bypass today
-- (id_cards, id_card_batches, clinic_visits, health_conditions,
-- hostel_visitor_logs, student_route_assignments, notification_log), none
-- is added. Column-level grants on clinic_visits/health_conditions'
-- sensitive columns are a completely separate mechanism, untouched here --
-- the matrix only ever gates row visibility of the already-narrowed column
-- set.
--
-- Read-only resources (service_role/Edge-Function-only writes, no client
-- write policy to gate): fee_documents, bank_payment_verifications,
-- library_checkouts, library_holds, notification_log -- only a 'read'
-- permission row exists for each.
-- ============================================================================

insert into public.permissions (key, module, resource, action, description) values
  ('fee_invoices:create', 'fees', 'fee_invoices', 'create', 'Create fee invoices'),
  ('fee_invoices:read',   'fees', 'fee_invoices', 'read',   'View fee invoices'),
  ('fee_invoices:update', 'fees', 'fee_invoices', 'update', 'Edit fee invoices'),
  ('fee_invoices:delete', 'fees', 'fee_invoices', 'delete', 'Delete fee invoices'),
  ('payments:create', 'fees', 'payments', 'create', 'Record manual payments'),
  ('payments:read',   'fees', 'payments', 'read',   'View payments'),
  ('fee_documents:read', 'fees', 'fee_documents', 'read', 'View fee documents'),
  ('bank_payment_verifications:read', 'fees', 'bank_payment_verifications', 'read', 'View bank payment verifications'),
  ('notices:create', 'communication', 'notices', 'create', 'Create notices'),
  ('notices:read',   'communication', 'notices', 'read',   'View notices'),
  ('notices:update', 'communication', 'notices', 'update', 'Edit notices'),
  ('notices:delete', 'communication', 'notices', 'delete', 'Delete notices'),
  ('announcements:create', 'communication', 'announcements', 'create', 'Create announcements'),
  ('announcements:read',   'communication', 'announcements', 'read',   'View announcements'),
  ('announcements:update', 'communication', 'announcements', 'update', 'Edit announcements'),
  ('announcements:delete', 'communication', 'announcements', 'delete', 'Delete announcements'),
  ('id_cards:create', 'id_cards', 'id_cards', 'create', 'Create ID cards'),
  ('id_cards:read',   'id_cards', 'id_cards', 'read',   'View ID cards'),
  ('id_cards:update', 'id_cards', 'id_cards', 'update', 'Edit ID cards'),
  ('id_cards:delete', 'id_cards', 'id_cards', 'delete', 'Delete ID cards'),
  ('id_card_batches:create', 'id_cards', 'id_card_batches', 'create', 'Create ID card batches'),
  ('id_card_batches:read',   'id_cards', 'id_card_batches', 'read',   'View ID card batches'),
  ('id_card_batches:update', 'id_cards', 'id_card_batches', 'update', 'Edit ID card batches'),
  ('id_card_batches:delete', 'id_cards', 'id_card_batches', 'delete', 'Delete ID card batches'),
  ('library_books:create', 'library', 'library_books', 'create', 'Create library books'),
  ('library_books:read',   'library', 'library_books', 'read',   'View library books'),
  ('library_books:update', 'library', 'library_books', 'update', 'Edit library books'),
  ('library_books:delete', 'library', 'library_books', 'delete', 'Delete library books'),
  ('library_book_copies:create', 'library', 'library_book_copies', 'create', 'Create library book copies'),
  ('library_book_copies:read',   'library', 'library_book_copies', 'read',   'View library book copies'),
  ('library_book_copies:update', 'library', 'library_book_copies', 'update', 'Edit library book copies'),
  ('library_book_copies:delete', 'library', 'library_book_copies', 'delete', 'Delete library book copies'),
  ('library_checkouts:read', 'library', 'library_checkouts', 'read', 'View library checkouts'),
  ('library_holds:read', 'library', 'library_holds', 'read', 'View library holds'),
  ('library_fines:read',   'library', 'library_fines', 'read',   'View library fines'),
  ('library_fines:update', 'library', 'library_fines', 'update', 'Edit library fines'),
  ('library_settings:create', 'library', 'library_settings', 'create', 'Create library settings'),
  ('library_settings:read',   'library', 'library_settings', 'read',   'View library settings'),
  ('library_settings:update', 'library', 'library_settings', 'update', 'Edit library settings'),
  ('library_settings:delete', 'library', 'library_settings', 'delete', 'Delete library settings'),
  ('clinic_visits:create', 'clinic', 'clinic_visits', 'create', 'Create clinic visits'),
  ('clinic_visits:read',   'clinic', 'clinic_visits', 'read',   'View clinic visits'),
  ('clinic_visits:update', 'clinic', 'clinic_visits', 'update', 'Edit clinic visits'),
  ('clinic_visits:delete', 'clinic', 'clinic_visits', 'delete', 'Delete clinic visits'),
  ('health_conditions:create', 'clinic', 'health_conditions', 'create', 'Create health conditions'),
  ('health_conditions:read',   'clinic', 'health_conditions', 'read',   'View health conditions'),
  ('health_conditions:update', 'clinic', 'health_conditions', 'update', 'Edit health conditions'),
  ('health_conditions:delete', 'clinic', 'health_conditions', 'delete', 'Delete health conditions'),
  ('hostel_allocations:create', 'hostel', 'hostel_allocations', 'create', 'Create hostel allocations'),
  ('hostel_allocations:read',   'hostel', 'hostel_allocations', 'read',   'View hostel allocations'),
  ('hostel_allocations:update', 'hostel', 'hostel_allocations', 'update', 'Edit hostel allocations'),
  ('hostel_allocations:delete', 'hostel', 'hostel_allocations', 'delete', 'Delete hostel allocations'),
  ('hostel_visitor_logs:create', 'hostel', 'hostel_visitor_logs', 'create', 'Create hostel visitor logs'),
  ('hostel_visitor_logs:read',   'hostel', 'hostel_visitor_logs', 'read',   'View hostel visitor logs'),
  ('hostel_visitor_logs:update', 'hostel', 'hostel_visitor_logs', 'update', 'Edit hostel visitor logs'),
  ('hostel_visitor_logs:delete', 'hostel', 'hostel_visitor_logs', 'delete', 'Delete hostel visitor logs'),
  ('student_route_assignments:create', 'transport', 'student_route_assignments', 'create', 'Assign transport routes'),
  ('student_route_assignments:read',   'transport', 'student_route_assignments', 'read',   'View transport route assignments'),
  ('student_route_assignments:update', 'transport', 'student_route_assignments', 'update', 'Edit transport route assignments'),
  ('student_route_assignments:delete', 'transport', 'student_route_assignments', 'delete', 'Delete transport route assignments'),
  ('moe_exports:create', 'reports', 'moe_exports', 'create', 'Create MoE exports'),
  ('moe_exports:read',   'reports', 'moe_exports', 'read',   'View MoE exports'),
  ('moe_exports:update', 'reports', 'moe_exports', 'update', 'Edit MoE exports'),
  ('moe_exports:delete', 'reports', 'moe_exports', 'delete', 'Delete MoE exports'),
  ('notification_log:read', 'communication', 'notification_log', 'read', 'View notification log')
on conflict (key) do nothing;

insert into public.resource_open_actions (resource, action) values
  ('library_books', 'read'), ('library_book_copies', 'read'), ('library_settings', 'read');

insert into public.resource_default_role_grants (resource, action, role) values
  ('library_books', 'create', 'school_admin'), ('library_books', 'create', 'librarian'),
  ('library_books', 'update', 'school_admin'), ('library_books', 'update', 'librarian'),
  ('library_books', 'delete', 'school_admin'), ('library_books', 'delete', 'librarian'),
  ('library_book_copies', 'create', 'school_admin'), ('library_book_copies', 'create', 'librarian'),
  ('library_book_copies', 'update', 'school_admin'), ('library_book_copies', 'update', 'librarian'),
  ('library_book_copies', 'delete', 'school_admin'), ('library_book_copies', 'delete', 'librarian'),
  ('library_settings', 'create', 'school_admin'), ('library_settings', 'create', 'librarian'),
  ('library_settings', 'update', 'school_admin'), ('library_settings', 'update', 'librarian'),
  ('library_settings', 'delete', 'school_admin'), ('library_settings', 'delete', 'librarian'),
  ('fee_invoices', 'read', 'school_admin'), ('fee_invoices', 'read', 'accountant'),
  ('fee_invoices', 'create', 'school_admin'), ('fee_invoices', 'create', 'accountant'),
  ('fee_invoices', 'update', 'school_admin'), ('fee_invoices', 'update', 'accountant'),
  ('fee_invoices', 'delete', 'school_admin'), ('fee_invoices', 'delete', 'accountant'),
  ('payments', 'read', 'school_admin'), ('payments', 'read', 'accountant'),
  ('payments', 'create', 'school_admin'), ('payments', 'create', 'accountant'),
  ('fee_documents', 'read', 'school_admin'), ('fee_documents', 'read', 'accountant'),
  ('bank_payment_verifications', 'read', 'school_admin'), ('bank_payment_verifications', 'read', 'registrar'), ('bank_payment_verifications', 'read', 'accountant'),
  ('notices', 'read', 'school_admin'), ('notices', 'read', 'registrar'),
  ('notices', 'create', 'school_admin'), ('notices', 'create', 'registrar'),
  ('notices', 'update', 'school_admin'), ('notices', 'update', 'registrar'),
  ('notices', 'delete', 'school_admin'), ('notices', 'delete', 'registrar'),
  ('announcements', 'read', 'school_admin'),
  ('announcements', 'create', 'school_admin'), ('announcements', 'create', 'teacher'),
  ('announcements', 'update', 'school_admin'), ('announcements', 'update', 'teacher'),
  ('announcements', 'delete', 'school_admin'), ('announcements', 'delete', 'teacher'),
  ('id_cards', 'read', 'school_admin'), ('id_cards', 'read', 'registrar'), ('id_cards', 'read', 'hr_officer'),
  ('id_cards', 'create', 'school_admin'), ('id_cards', 'create', 'registrar'), ('id_cards', 'create', 'hr_officer'),
  ('id_cards', 'update', 'school_admin'), ('id_cards', 'update', 'registrar'), ('id_cards', 'update', 'hr_officer'),
  ('id_cards', 'delete', 'school_admin'), ('id_cards', 'delete', 'registrar'), ('id_cards', 'delete', 'hr_officer'),
  ('id_card_batches', 'read', 'school_admin'), ('id_card_batches', 'read', 'registrar'), ('id_card_batches', 'read', 'hr_officer'),
  ('id_card_batches', 'create', 'school_admin'), ('id_card_batches', 'create', 'registrar'), ('id_card_batches', 'create', 'hr_officer'),
  ('id_card_batches', 'update', 'school_admin'), ('id_card_batches', 'update', 'registrar'), ('id_card_batches', 'update', 'hr_officer'),
  ('id_card_batches', 'delete', 'school_admin'), ('id_card_batches', 'delete', 'registrar'), ('id_card_batches', 'delete', 'hr_officer'),
  ('library_checkouts', 'read', 'school_admin'), ('library_checkouts', 'read', 'librarian'),
  ('library_holds', 'read', 'school_admin'), ('library_holds', 'read', 'librarian'),
  ('library_fines', 'read', 'school_admin'), ('library_fines', 'read', 'librarian'),
  ('library_fines', 'update', 'school_admin'), ('library_fines', 'update', 'librarian'),
  ('clinic_visits', 'read', 'school_admin'),
  ('clinic_visits', 'create', 'school_admin'), ('clinic_visits', 'update', 'school_admin'), ('clinic_visits', 'delete', 'school_admin'),
  ('health_conditions', 'read', 'school_admin'),
  ('health_conditions', 'create', 'school_admin'), ('health_conditions', 'update', 'school_admin'), ('health_conditions', 'delete', 'school_admin'),
  ('hostel_allocations', 'read', 'school_admin'),
  ('hostel_allocations', 'create', 'school_admin'), ('hostel_allocations', 'update', 'school_admin'), ('hostel_allocations', 'delete', 'school_admin'),
  ('hostel_visitor_logs', 'read', 'school_admin'),
  ('hostel_visitor_logs', 'create', 'school_admin'), ('hostel_visitor_logs', 'update', 'school_admin'), ('hostel_visitor_logs', 'delete', 'school_admin'),
  ('student_route_assignments', 'read', 'school_admin'),
  ('student_route_assignments', 'create', 'school_admin'), ('student_route_assignments', 'update', 'school_admin'), ('student_route_assignments', 'delete', 'school_admin'),
  ('moe_exports', 'read', 'school_admin'),
  ('moe_exports', 'create', 'school_admin'), ('moe_exports', 'update', 'school_admin'), ('moe_exports', 'delete', 'school_admin'),
  ('notification_log', 'read', 'school_admin');

-- ---------- library_books / library_book_copies / library_settings: open --
-- ---------- read, write = school_admin + librarian --------------------------
do $$
declare t text;
begin
  foreach t in array array['library_books', 'library_book_copies', 'library_settings']
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

-- ---------- clinic_visits / health_conditions / hostel_visitor_logs: -------
-- ---------- flat role only, no bypass, no relationship branch -------------
do $$
declare t text;
begin
  foreach t in array array['clinic_visits', 'health_conditions', 'hostel_visitor_logs']
  loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('drop policy if exists %1$s_write on public.%1$I', t);
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated using (
        tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        and public.has_resource_permission(auth.uid(), %1$L, 'read'))$f$, t);
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

-- ---------- id_cards / id_card_batches: flat 3-role list, no bypass -------
-- ---------- (id_card_batches was one combined 'for all' policy -- split ---
-- ---------- into 4, same as everywhere else in this series) --------------
do $$
declare t text;
begin
  foreach t in array array['id_cards', 'id_card_batches']
  loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('drop policy if exists %1$s_write on public.%1$I', t);
    execute format('drop policy if exists idbatch_all on public.%1$I', t);
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated using (
        tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        and public.has_resource_permission(auth.uid(), %1$L, 'read'))$f$, t);
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

-- ---------- fee_invoices: self/guardian branch preserved -------------------
drop policy if exists invoices_select on public.fee_invoices;
drop policy if exists invoices_write on public.fee_invoices;
create policy invoices_select on public.fee_invoices for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'fee_invoices', 'read')
        or exists (select 1 from public.students s where s.id = student_id
                   and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy invoices_insert on public.fee_invoices for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'fee_invoices', 'create'));
create policy invoices_update on public.fee_invoices for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'fee_invoices', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'fee_invoices', 'update'));
create policy invoices_delete on public.fee_invoices for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'fee_invoices', 'delete'));

-- ---------- payments: self/guardian branch preserved; insert-only write ---
-- ---------- (provider/status structural checks preserved verbatim) -------
drop policy if exists payments_select on public.payments;
drop policy if exists payments_manual_insert on public.payments;
create policy payments_select on public.payments for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'payments', 'read')
        or exists (select 1 from public.fee_invoices i join public.students s on s.id = i.student_id
                   where i.id = invoice_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy payments_manual_insert on public.payments for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'payments', 'create')
  and provider in ('cash','bank')
  and status = 'succeeded');

-- ---------- fee_documents: read-only, self/guardian branch preserved ------
drop policy if exists fee_documents_select on public.fee_documents;
create policy fee_documents_select on public.fee_documents for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'fee_documents', 'read')
        or exists (select 1 from public.fee_invoices i join public.students s on s.id = i.student_id
                   where i.id = invoice_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);

-- ---------- bank_payment_verifications: read-only, self/guardian branch ---
-- ---------- preserved (only reachable when payment_id is not null) --------
drop policy if exists bank_payment_verifications_select on public.bank_payment_verifications;
create policy bank_payment_verifications_select on public.bank_payment_verifications for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'bank_payment_verifications', 'read')
        or (payment_id is not null and exists (
              select 1 from public.payments p join public.fee_invoices i on i.id = p.invoice_id
              join public.students s on s.id = i.student_id
              where p.id = payment_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id))))))
);

-- ---------- notices: audience/visibility window branch is a targeting -----
-- ---------- rule, not a role grant -- stays untouched. Only the -----------
-- ---------- unconditional staff-bypass branch moves. ----------------------
drop policy if exists notices_select on public.notices;
drop policy if exists notices_write on public.notices;
create policy notices_select on public.notices for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'notices', 'read')
        or (current_date between visible_from and visible_to
            and (visible_all_school or visible_to_roles is null
                 or (select public.get_role_for_user(auth.uid())) = any (visible_to_roles)))))
);
create policy notices_insert on public.notices for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'notices', 'create'));
create policy notices_update on public.notices for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'notices', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'notices', 'update'));
create policy notices_delete on public.notices for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'notices', 'delete'));

-- ---------- announcements: audience enum branches (all/staff/parents/ ------
-- ---------- class) are targeting rules, not role grants -- stay untouched. -
-- ---------- Only the unconditional `role = 'school_admin'` catch-all moves.
drop policy if exists announcements_select on public.announcements;
drop policy if exists announcements_write on public.announcements;
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
        or public.has_resource_permission(auth.uid(), 'announcements', 'read')))
);
create policy announcements_insert on public.announcements for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'announcements', 'create'));
create policy announcements_update on public.announcements for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'announcements', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'announcements', 'update'));
create policy announcements_delete on public.announcements for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'announcements', 'delete'));

-- ---------- library_checkouts / library_holds: read-only, self/guardian ---
-- ---------- branch preserved, super_admin bypass present ------------------
drop policy if exists library_checkouts_select on public.library_checkouts;
create policy library_checkouts_select on public.library_checkouts for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    public.has_resource_permission(auth.uid(), 'library_checkouts', 'read')
    or exists (select 1 from public.students s where s.id = student_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id))))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);

drop policy if exists library_holds_select on public.library_holds;
create policy library_holds_select on public.library_holds for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    public.has_resource_permission(auth.uid(), 'library_holds', 'read')
    or exists (select 1 from public.students s where s.id = student_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id))))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);

-- ---------- library_fines: read+update only (no client insert/delete); ----
-- ---------- self/guardian branch preserved via checkout join --------------
drop policy if exists library_fines_select on public.library_fines;
drop policy if exists library_fines_update on public.library_fines;
create policy library_fines_select on public.library_fines for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    public.has_resource_permission(auth.uid(), 'library_fines', 'read')
    or exists (select 1 from public.library_checkouts c join public.students s on s.id = c.student_id
               where c.id = checkout_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id))))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
create policy library_fines_update on public.library_fines for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'library_fines', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'library_fines', 'update'));

-- ---------- hostel_allocations: self/guardian preserved, has bypass -------
drop policy if exists hostel_alloc_select on public.hostel_allocations;
drop policy if exists hostel_alloc_write on public.hostel_allocations;
create policy hostel_alloc_select on public.hostel_allocations for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        public.has_resource_permission(auth.uid(), 'hostel_allocations', 'read')
        or exists (select 1 from public.students s where s.id = student_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
create policy hostel_alloc_insert on public.hostel_allocations for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'hostel_allocations', 'create'));
create policy hostel_alloc_update on public.hostel_allocations for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'hostel_allocations', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'hostel_allocations', 'update'));
create policy hostel_alloc_delete on public.hostel_allocations for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'hostel_allocations', 'delete'));

-- ---------- student_route_assignments: self/guardian preserved, NO bypass -
drop policy if exists route_assign_select on public.student_route_assignments;
drop policy if exists route_assign_write on public.student_route_assignments;
create policy route_assign_select on public.student_route_assignments for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    public.has_resource_permission(auth.uid(), 'student_route_assignments', 'read')
    or exists (select 1 from public.students s where s.id = student_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id))))
);
create policy route_assign_insert on public.student_route_assignments for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'student_route_assignments', 'create'));
create policy route_assign_update on public.student_route_assignments for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'student_route_assignments', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'student_route_assignments', 'update'));
create policy route_assign_delete on public.student_route_assignments for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'student_route_assignments', 'delete'));

-- ---------- moe_exports: simple, flat role only, has super_admin bypass ---
-- ---------- on read only -----------------------------------------------
drop policy if exists moe_select on public.moe_exports;
drop policy if exists moe_write on public.moe_exports;
create policy moe_select on public.moe_exports for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
      and public.has_resource_permission(auth.uid(), 'moe_exports', 'read'))
);
create policy moe_insert on public.moe_exports for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'moe_exports', 'create'));
create policy moe_update on public.moe_exports for update to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'moe_exports', 'update'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and public.has_resource_permission(auth.uid(), 'moe_exports', 'update'));
create policy moe_delete on public.moe_exports for delete to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'moe_exports', 'delete'));

-- ---------- notification_log: read-only, flat role only, no bypass --------
drop policy if exists notiflog_select on public.notification_log;
create policy notiflog_select on public.notification_log for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'notification_log', 'read'));
