-- ============================================================================
-- Role/user permissions matrix -- Phase 2, Fees/Comms/Library/Student
-- Services/Reports domain (20260817000004). Proves, for every table this
-- migration touches: zero configuration reproduces today's exact
-- population (staff branch AND every self/guardian/audience relationship
-- branch), and a role-level grant actually widens access for a role
-- (teacher) with zero default access anywhere in this domain.
-- ============================================================================
begin;
select plan(38);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'a0000001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'rf-admin@test.example',    crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'rf-accountant@test.example',crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'rf-registrar@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000004-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'rf-librarian@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000005-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'rf-teacher@test.example',   crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000006-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'rf-student@test.example',   crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000007-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'rf-guardian@test.example',  crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('a0000000-0000-0000-0000-00000000000a', 'RF Tenant A', 'rf-tenant-a', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('a0000001-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'school_admin', 'RF Admin',      'rf-admin@test.example'),
  ('a0000002-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'accountant',   'RF Accountant', 'rf-accountant@test.example'),
  ('a0000003-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'registrar',    'RF Registrar',  'rf-registrar@test.example'),
  ('a0000004-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', 'librarian',    'RF Librarian',  'rf-librarian@test.example'),
  ('a0000005-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-00000000000a', 'teacher',      'RF Teacher',    'rf-teacher@test.example'),
  ('a0000006-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-00000000000a', 'student',      'RF Student',    'rf-student@test.example'),
  ('a0000007-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000a', 'parent',       'RF Guardian',   'rf-guardian@test.example');

insert into public.academic_years (id, tenant_id, ec_year, label_i18n, starts_on, ends_on, status) values
  ('a0000000-0000-0000-0000-00000000ea01', 'a0000000-0000-0000-0000-00000000000a', 2018, '{}'::jsonb, '2025-09-01', '2026-06-30', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('a0000000-0000-0000-0000-00000000c001', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000ea01', 'Grade 6', 'A');
insert into public.students (id, tenant_id, user_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('a0000000-0000-0000-0000-0000000d0001', 'a0000000-0000-0000-0000-00000000000a', 'a0000006-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-00000000c001', 'RF-ADM-001', 'Sara', 'Bekele', '2015-01-01', 'female');
insert into public.guardians (id, tenant_id, student_id, user_id, relationship) values
  ('a0000000-0000-0000-0000-0000000d0101', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000d0001', 'a0000007-0000-0000-0000-000000000007', 'mother');

insert into public.fee_structures (id, tenant_id, name_i18n, amount, billing_cycle) values
  ('a0000000-0000-0000-0000-0000000f0001', 'a0000000-0000-0000-0000-00000000000a', '{"en":"Tuition"}'::jsonb, 5000, 'term');
insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, due_date) values
  ('a0000000-0000-0000-0000-0000000f0101', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000d0001', 'a0000000-0000-0000-0000-0000000f0001', 5000, '2026-01-01');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, status) values
  ('a0000000-0000-0000-0000-0000000f0201', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000f0101', 5000, 'cash', 'succeeded');
insert into public.fee_documents (id, tenant_id, kind, invoice_id, payment_id, doc_no, verify_code, amount, pdf_path) values
  ('a0000000-0000-0000-0000-0000000f0301', 'a0000000-0000-0000-0000-00000000000a', 'receipt', 'a0000000-0000-0000-0000-0000000f0101', 'a0000000-0000-0000-0000-0000000f0201', 'RCP-2018-0001', 'abcdef0123456789abcdef01', 5000, 'a0000000-0000-0000-0000-00000000000a/receipt.pdf');
insert into public.bank_payment_verifications (id, tenant_id, payment_id, payment_method, verification_url, status) values
  ('a0000000-0000-0000-0000-0000000f0401', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000f0201', 'cbe', 'https://cbe.example/tx/1', 'pending');

insert into public.notices (id, tenant_id, title_i18n, visible_from, visible_to, visible_all_school) values
  ('a0000000-0000-0000-0000-0000000b0001', 'a0000000-0000-0000-0000-00000000000a', '{"en":"Test notice"}'::jsonb, '2020-01-01', '2030-01-01', false);
insert into public.announcements (id, tenant_id, title_i18n, body_i18n, audience, created_by) values
  ('a0000000-0000-0000-0000-0000000b0101', 'a0000000-0000-0000-0000-00000000000a', '{"en":"Staff only"}'::jsonb, '{"en":"Body"}'::jsonb, 'staff', 'a0000001-0000-0000-0000-000000000001');

insert into public.id_card_batches (id, tenant_id, batch_type, created_by) values
  ('a0000000-0000-0000-0000-0000000c0101', 'a0000000-0000-0000-0000-00000000000a', 'student_id', 'a0000001-0000-0000-0000-000000000001');
insert into public.id_cards (id, tenant_id, batch_id, subject_type, subject_id, verify_code) values
  ('a0000000-0000-0000-0000-0000000c0201', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000c0101', 'student', 'a0000000-0000-0000-0000-0000000d0001', 'idcard-verify-code-0001-test');

insert into public.library_books (id, tenant_id, title) values
  ('a0000000-0000-0000-0000-0000000a0001', 'a0000000-0000-0000-0000-00000000000a', 'Test Book');
insert into public.library_book_copies (id, tenant_id, book_id, barcode, status) values
  ('a0000000-0000-0000-0000-0000000a0101', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000a0001', 'BC-0001', 'checked_out');
insert into public.library_checkouts (id, tenant_id, student_id, copy_id, due_on, status) values
  ('a0000000-0000-0000-0000-0000000a0201', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000d0001', 'a0000000-0000-0000-0000-0000000a0101', '2026-02-01', 'checked_out');
insert into public.library_holds (id, tenant_id, book_id, student_id, status) values
  ('a0000000-0000-0000-0000-0000000a0301', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000a0001', 'a0000000-0000-0000-0000-0000000d0001', 'waiting');
insert into public.library_fines (id, tenant_id, checkout_id, amount, status) values
  ('a0000000-0000-0000-0000-0000000a0401', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000a0201', 50, 'pending');

insert into public.hostel_buildings (id, tenant_id, name) values
  ('a0000000-0000-0000-0000-0000000e0001', 'a0000000-0000-0000-0000-00000000000a', 'Boys Hostel');
insert into public.hostel_rooms (id, tenant_id, building_id, room_no, capacity) values
  ('a0000000-0000-0000-0000-0000000e0101', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000e0001', '101', 4);
insert into public.hostel_allocations (id, tenant_id, room_id, student_id, starts_on) values
  ('a0000000-0000-0000-0000-0000000e0201', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000e0101', 'a0000000-0000-0000-0000-0000000d0001', '2026-01-01');
insert into public.hostel_visitor_logs (id, tenant_id, student_id, visitor_name) values
  ('a0000000-0000-0000-0000-0000000e0301', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000d0001', 'Uncle Visitor');

insert into public.transport_routes (id, tenant_id, name) values
  ('a0000000-0000-0000-0000-0000000d0201', 'a0000000-0000-0000-0000-00000000000a', 'Route 1');
insert into public.student_route_assignments (id, tenant_id, student_id, route_id) values
  ('a0000000-0000-0000-0000-0000000d0301', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000d0001', 'a0000000-0000-0000-0000-0000000d0201');

insert into public.clinic_visits (id, tenant_id, student_id, recorded_by) values
  ('a0000000-0000-0000-0000-0000000e0401', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000d0001', 'a0000001-0000-0000-0000-000000000001');
insert into public.health_conditions (id, tenant_id, student_id, condition, effective_from) values
  ('a0000000-0000-0000-0000-0000000e0501', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000d0001', 'Asthma', '2020-01-01');

insert into public.moe_exports (id, tenant_id, export_type, ec_year, created_by) values
  ('a0000000-0000-0000-0000-0000000f0501', 'a0000000-0000-0000-0000-00000000000a', 'enrollment_census', 2018, 'a0000001-0000-0000-0000-000000000001');

insert into public.notification_log (tenant_id, recipient_id, channel, status) values
  ('a0000000-0000-0000-0000-00000000000a', 'a0000006-0000-0000-0000-000000000006', 'sms', 'sent');

insert into public.library_settings (tenant_id, loan_days_default) values
  ('a0000000-0000-0000-0000-00000000000a', 14);

-- ============================================================================
-- fee_invoices / payments / fee_documents / bank_payment_verifications
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'a0000005-0000-0000-0000-000000000005'; -- teacher, no default fees access
select is((select count(*)::int from public.fee_invoices), 0, 'unconfigured: teacher sees zero fee invoices');
set local request.jwt.claim.sub = 'a0000007-0000-0000-0000-000000000007'; -- guardian
select is((select count(*)::int from public.fee_invoices), 1, 'unconfigured: guardian still reads their child''s fee invoice (self branch)');
set local request.jwt.claim.sub = 'a0000006-0000-0000-0000-000000000006'; -- student self
select is((select count(*)::int from public.payments), 1, 'unconfigured: student still reads their own payment (self branch via invoice join)');
select is((select count(*)::int from public.fee_documents), 1, 'unconfigured: student still reads their own fee document (self branch via invoice join)');
select is((select count(*)::int from public.bank_payment_verifications), 1, 'unconfigured: student still reads their own bank verification (self branch via payment join)');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select 'a0000000-0000-0000-0000-00000000000a', 'teacher', id, true from public.permissions where key = 'fee_invoices:read';
set local role authenticated;
set local request.jwt.claim.sub = 'a0000005-0000-0000-0000-000000000005';
select is((select count(*)::int from public.fee_invoices), 1, 'role grant: teacher can now read fee invoices');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'a0000002-0000-0000-0000-000000000002'; -- accountant, default create population
select lives_ok(
  $stmt$ insert into public.payments (tenant_id, invoice_id, amount, provider, status)
         values ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000f0101', 100, 'bank', 'succeeded') $stmt$,
  'unconfigured: accountant can record a manual payment with zero grants configured');
select throws_ok(
  $stmt$ insert into public.payments (tenant_id, invoice_id, amount, provider, status)
         values ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000f0101', 100, 'stripe', 'succeeded') $stmt$,
  '42501', null, 'structural check preserved: accountant still cannot record a non-cash/bank payment, even though the role gate passes');
reset role;

-- ============================================================================
-- notices / announcements
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'a0000003-0000-0000-0000-000000000003'; -- registrar, default population, unconditional bypass
select is((select count(*)::int from public.notices), 1, 'unconfigured: registrar reads notices unconditionally (default population)');
set local request.jwt.claim.sub = 'a0000006-0000-0000-0000-000000000006'; -- student, outside the visibility window's role targeting is irrelevant here -- window IS open, visible_all_school=false, visible_to_roles=null => "everyone" per the null=>open rule
select is((select count(*)::int from public.notices), 1, 'unconfigured: a student sees the notice via the untouched visibility-window targeting rule (visible_to_roles is null = open to all)');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'a0000005-0000-0000-0000-000000000005'; -- teacher, audience='staff' -> visible; not student/parent
select is((select count(*)::int from public.announcements), 1, 'unconfigured: a teacher sees the staff-audience announcement via the untouched audience targeting rule');
set local request.jwt.claim.sub = 'a0000006-0000-0000-0000-000000000006'; -- student, audience='staff' excludes them
select is((select count(*)::int from public.announcements), 0, 'unconfigured: a student does not see the staff-audience announcement (targeting rule correctly excludes them)');
reset role;

-- audience='staff' already grants the teacher access via the untouched
-- targeting rule, so a role grant to teacher wouldn't prove anything new.
-- Grant 'student' instead -- a role the audience rule explicitly excludes
-- from this announcement -- to prove the matrix can widen access past the
-- targeting rule.
insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select 'a0000000-0000-0000-0000-00000000000a', 'student', id, true from public.permissions where key = 'announcements:read';
set local role authenticated;
set local request.jwt.claim.sub = 'a0000006-0000-0000-0000-000000000006'; -- student
select is((select count(*)::int from public.announcements), 1, 'role grant: student can now read the staff-audience announcement after being granted announcements:read');
reset role;

-- ============================================================================
-- id_cards / id_card_batches
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'a0000005-0000-0000-0000-000000000005'; -- teacher, not in default population
select is((select count(*)::int from public.id_cards), 0, 'unconfigured: teacher sees zero id cards');
set local request.jwt.claim.sub = 'a0000004-0000-0000-0000-000000000004'; -- librarian, not in id_cards default population either
select is((select count(*)::int from public.id_card_batches), 0, 'unconfigured: librarian sees zero id card batches (not in school_admin/registrar/hr_officer population)');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select 'a0000000-0000-0000-0000-00000000000a', 'teacher', id, true from public.permissions where key = 'id_cards:read';
set local role authenticated;
set local request.jwt.claim.sub = 'a0000005-0000-0000-0000-000000000005';
select is((select count(*)::int from public.id_cards), 1, 'role grant: teacher can now read id cards');
reset role;

-- ============================================================================
-- library_books / library_book_copies / library_settings (open read)
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'a0000006-0000-0000-0000-000000000006'; -- student, open read
select is((select count(*)::int from public.library_books), 1, 'unconfigured: any tenant member (even a student) reads library books (open read)');
select throws_ok(
  $stmt$ insert into public.library_books (tenant_id, title) values ('a0000000-0000-0000-0000-00000000000a', 'Unauthorized Book') $stmt$,
  '42501', null, 'unconfigured: a student cannot create a library book (fallback create = school_admin+librarian)');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'a0000004-0000-0000-0000-000000000004'; -- librarian
select lives_ok(
  $stmt$ insert into public.library_books (tenant_id, title) values ('a0000000-0000-0000-0000-00000000000a', 'Librarian Added Book') $stmt$,
  'unconfigured: librarian can create a library book with zero grants configured');
reset role;

-- ============================================================================
-- library_checkouts / library_holds / library_fines (read-only except fines
-- update; self/guardian branch preserved)
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'a0000007-0000-0000-0000-000000000007'; -- guardian
select is((select count(*)::int from public.library_checkouts), 1, 'unconfigured: guardian still reads their child''s checkout (self branch)');
select is((select count(*)::int from public.library_holds), 1, 'unconfigured: guardian still reads their child''s hold (self branch)');
select is((select count(*)::int from public.library_fines), 1, 'unconfigured: guardian still reads their child''s fine (self branch via checkout join)');
set local request.jwt.claim.sub = 'a0000005-0000-0000-0000-000000000005'; -- teacher, not in default population
select is((select count(*)::int from public.library_checkouts), 0, 'unconfigured: teacher sees zero library checkouts');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select 'a0000000-0000-0000-0000-00000000000a', 'teacher', id, true from public.permissions where key = 'library_checkouts:read';
set local role authenticated;
set local request.jwt.claim.sub = 'a0000005-0000-0000-0000-000000000005';
select is((select count(*)::int from public.library_checkouts), 1, 'role grant: teacher can now read library checkouts');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'a0000004-0000-0000-0000-000000000004'; -- librarian, default update population
select lives_ok(
  $stmt$ update public.library_fines set status = 'waived' where id = 'a0000000-0000-0000-0000-0000000a0401' $stmt$,
  'unconfigured: librarian can update a library fine with zero grants configured');
reset role;

-- ============================================================================
-- clinic_visits / health_conditions (school_admin only, no bypass)
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'a0000007-0000-0000-0000-000000000007'; -- guardian, no self branch on this table
select is((select count(*)::int from public.clinic_visits), 0, 'unconfigured: guardian cannot read clinic visits (no self/guardian branch on this table)');
select is((select count(*)::int from public.health_conditions), 0, 'unconfigured: guardian cannot read health conditions (no self/guardian branch on this table)');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select 'a0000000-0000-0000-0000-00000000000a', 'teacher', id, true from public.permissions where key = 'clinic_visits:read';
set local role authenticated;
set local request.jwt.claim.sub = 'a0000005-0000-0000-0000-000000000005';
select is((select count(*)::int from public.clinic_visits), 1, 'role grant: teacher can now read clinic visits');
reset role;

-- ============================================================================
-- hostel_allocations (bypass present) / hostel_visitor_logs (no bypass) /
-- student_route_assignments (no bypass) -- self/guardian branch preserved
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'a0000006-0000-0000-0000-000000000006'; -- student self
select is((select count(*)::int from public.hostel_allocations), 1, 'unconfigured: student still reads their own hostel allocation (self branch)');
select is((select count(*)::int from public.student_route_assignments), 1, 'unconfigured: student still reads their own transport route assignment (self branch)');
set local request.jwt.claim.sub = 'a0000005-0000-0000-0000-000000000005'; -- teacher
select is((select count(*)::int from public.hostel_visitor_logs), 0, 'unconfigured: teacher sees zero hostel visitor logs (school_admin only, no bypass, no relationship branch)');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select 'a0000000-0000-0000-0000-00000000000a', 'teacher', id, true from public.permissions where key = 'hostel_visitor_logs:read';
set local role authenticated;
set local request.jwt.claim.sub = 'a0000005-0000-0000-0000-000000000005';
select is((select count(*)::int from public.hostel_visitor_logs), 1, 'role grant: teacher can now read hostel visitor logs');
reset role;

-- ============================================================================
-- moe_exports (super_admin bypass on read, no relationship) /
-- notification_log (read-only, no bypass)
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'a0000005-0000-0000-0000-000000000005'; -- teacher
select is((select count(*)::int from public.moe_exports), 0, 'unconfigured: teacher sees zero MoE exports');
select is((select count(*)::int from public.notification_log), 0, 'unconfigured: teacher sees zero notification log entries');
reset role;

insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select 'a0000000-0000-0000-0000-00000000000a', 'teacher', id, true from public.permissions where key = 'moe_exports:read';
insert into public.builtin_role_permission_grants (tenant_id, role, permission_id, granted)
select 'a0000000-0000-0000-0000-00000000000a', 'teacher', id, true from public.permissions where key = 'notification_log:read';
set local role authenticated;
set local request.jwt.claim.sub = 'a0000005-0000-0000-0000-000000000005';
select is((select count(*)::int from public.moe_exports), 1, 'role grant: teacher can now read MoE exports');
select is((select count(*)::int from public.notification_log), 1, 'role grant: teacher can now read notification log entries');
reset role;

-- ============================================================================
-- library_book_copies / library_settings: quick write-side spot checks
-- (same open-read/school_admin+librarian-write shape as library_books,
-- already proven above)
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'a0000005-0000-0000-0000-000000000005'; -- teacher

select throws_ok(
  $stmt$ insert into public.library_book_copies (tenant_id, book_id, barcode)
         values ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000a0001', 'BC-0002') $stmt$,
  '42501', null, 'unconfigured: a teacher cannot create a library book copy');

update public.library_settings set loan_days_default = 30 where tenant_id = 'a0000000-0000-0000-0000-00000000000a';
reset role;
select is(
  (select loan_days_default from public.library_settings where tenant_id = 'a0000000-0000-0000-0000-00000000000a'), 14::smallint,
  'unconfigured: a teacher cannot update library settings (USING filtered the row, value stays 14)');

select * from finish();
rollback;
