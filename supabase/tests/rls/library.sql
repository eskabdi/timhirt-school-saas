-- ============================================================================
-- Library management (20260813000001/20260813000002): per-copy inventory,
-- holds, fines, settings, and the four atomic RPCs. Proves: cross-tenant
-- isolation, LIBRARY-role (school_admin/librarian) write gating with a
-- regression check that accountant lost the write access the original demo
-- schema accidentally gave it, student/guardian self-read scoping, no direct
-- authenticated write on checkouts/holds/fines (service_role/RPC only), the
-- tenant-consistency trigger, the duplicate-active-hold unique index, the
-- copy-reserved-for-a-ready-hold exemption, the lending/rental fine split,
-- and the portal_notifications replay guard extended to hold_id.
-- ============================================================================
begin;
select plan(29);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'aca00001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'lib-admin@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aca00001-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'lib-librarian@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aca00001-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'lib-teacher@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aca00001-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'lib-accountant@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aca00001-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'lib-student1@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aca00001-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'lib-parent1@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aca00001-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'lib-student2@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'acb00001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'lib-admin-b@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('aca00000-0000-0000-0000-00000000000a', 'Lib Tenant A', 'lib-tenant-a', 'active'),
  ('acb00000-0000-0000-0000-00000000000b', 'Lib Tenant B', 'lib-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('aca00001-0000-0000-0000-000000000001', 'aca00000-0000-0000-0000-00000000000a', 'school_admin', 'Lib Admin',      'lib-admin@test.example'),
  ('aca00001-0000-0000-0000-000000000002', 'aca00000-0000-0000-0000-00000000000a', 'librarian',    'Lib Librarian',  'lib-librarian@test.example'),
  ('aca00001-0000-0000-0000-000000000003', 'aca00000-0000-0000-0000-00000000000a', 'teacher',      'Lib Teacher',    'lib-teacher@test.example'),
  ('aca00001-0000-0000-0000-000000000004', 'aca00000-0000-0000-0000-00000000000a', 'accountant',   'Lib Accountant', 'lib-accountant@test.example'),
  ('aca00001-0000-0000-0000-000000000005', 'aca00000-0000-0000-0000-00000000000a', 'student',      'Lib Student 1',  'lib-student1@test.example'),
  ('aca00001-0000-0000-0000-000000000006', 'aca00000-0000-0000-0000-00000000000a', 'parent',       'Lib Parent 1',   'lib-parent1@test.example'),
  ('aca00001-0000-0000-0000-000000000007', 'aca00000-0000-0000-0000-00000000000a', 'student',      'Lib Student 2',  'lib-student2@test.example'),
  ('acb00001-0000-0000-0000-000000000001', 'acb00000-0000-0000-0000-00000000000b', 'school_admin', 'Lib Admin B',    'lib-admin-b@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('aca10000-0000-0000-0000-000000000001', 'aca00000-0000-0000-0000-00000000000a', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('aca20000-0000-0000-0000-000000000001', 'aca00000-0000-0000-0000-00000000000a', 'aca10000-0000-0000-0000-000000000001', 'Grade 9', 'A');
insert into public.students (id, tenant_id, class_id, user_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('aca30000-0000-0000-0000-000000000001', 'aca00000-0000-0000-0000-00000000000a', 'aca20000-0000-0000-0000-000000000001', 'aca00001-0000-0000-0000-000000000005', 'ADM-LIB-001', 'Stu', 'One', '2010-01-01', 'male'),
  ('aca30000-0000-0000-0000-000000000002', 'aca00000-0000-0000-0000-00000000000a', 'aca20000-0000-0000-0000-000000000001', 'aca00001-0000-0000-0000-000000000007', 'ADM-LIB-002', 'Stu', 'Two', '2010-02-02', 'male');
insert into public.guardians (id, tenant_id, student_id, user_id, relationship) values
  ('aca40000-0000-0000-0000-000000000001', 'aca00000-0000-0000-0000-00000000000a', 'aca30000-0000-0000-0000-000000000001', 'aca00001-0000-0000-0000-000000000006', 'mother');

insert into public.library_books (id, tenant_id, title) values
  ('aca50000-0000-0000-0000-000000000001', 'aca00000-0000-0000-0000-00000000000a', 'Lib Test Book');
insert into public.library_book_copies (id, tenant_id, book_id, barcode, status) values
  ('aca60000-0000-0000-0000-000000000001', 'aca00000-0000-0000-0000-00000000000a', 'aca50000-0000-0000-0000-000000000001', 'LT-001', 'available'),
  ('aca60000-0000-0000-0000-000000000002', 'aca00000-0000-0000-0000-00000000000a', 'aca50000-0000-0000-0000-000000000001', 'LT-002', 'available'),
  ('aca60000-0000-0000-0000-000000000003', 'aca00000-0000-0000-0000-00000000000a', 'aca50000-0000-0000-0000-000000000001', 'LT-003', 'available');
insert into public.library_settings (tenant_id, fine_per_day, max_active_checkouts, max_renewals) values
  ('aca00000-0000-0000-0000-00000000000a', 5.00, 1, 1);

-- ---------- write role gating (LIBRARY = school_admin, librarian) ----------
set local role authenticated;
set local request.jwt.claim.sub = 'aca00001-0000-0000-0000-000000000002'; -- librarian

select lives_ok(
  $stmt$ insert into public.library_books (tenant_id, title) values ('aca00000-0000-0000-0000-00000000000a', 'Librarian-Added Book') $stmt$,
  'librarian can insert into library_books');

set local request.jwt.claim.sub = 'aca00001-0000-0000-0000-000000000003'; -- teacher

select throws_ok(
  $stmt$ insert into public.library_books (tenant_id, title) values ('aca00000-0000-0000-0000-00000000000a', 'Teacher-Added Book') $stmt$,
  '42501', null, 'teacher cannot insert into library_books');

set local request.jwt.claim.sub = 'aca00001-0000-0000-0000-000000000004'; -- accountant

select throws_ok(
  $stmt$ insert into public.library_books (tenant_id, title) values ('aca00000-0000-0000-0000-00000000000a', 'Accountant-Added Book') $stmt$,
  '42501', null, 'accountant cannot insert into library_books -- regression: the demo schema wrongly allowed this');

-- ---------- cross-tenant isolation: books/copies ----------
set local request.jwt.claim.sub = 'acb00001-0000-0000-0000-000000000001'; -- school_admin, tenant B

select is(
  (select count(*)::int from public.library_books where id = 'aca50000-0000-0000-0000-000000000001'),
  0, 'cross-tenant admin sees 0 for tenant A''s book');
select is(
  (select count(*)::int from public.library_book_copies where id = 'aca60000-0000-0000-0000-000000000001'),
  0, 'cross-tenant admin sees 0 for tenant A''s copy');

reset role;

-- ---------- RPC: atomic checkout, service_role only ----------
set local role service_role;

select id as checkout1_id from public.library_checkout(
  'aca00000-0000-0000-0000-00000000000a', 'aca60000-0000-0000-0000-000000000001',
  'aca30000-0000-0000-0000-000000000001', 'lending', current_date + 14) \gset

select ok(:'checkout1_id' is not null, 'library_checkout() returns a new checkout row');

select is(
  (select status from public.library_book_copies where id = 'aca60000-0000-0000-0000-000000000001'),
  'checked_out', 'the claimed copy flips to checked_out');

select throws_ok(
  $stmt$ select public.library_checkout('aca00000-0000-0000-0000-00000000000a', 'aca60000-0000-0000-0000-000000000001',
    'aca30000-0000-0000-0000-000000000002', 'lending', current_date + 14) $stmt$,
  'P0001', 'copy_not_available', 'a second checkout of the same copy is rejected');

select throws_ok(
  $stmt$ select public.library_checkout('aca00000-0000-0000-0000-00000000000a', 'aca60000-0000-0000-0000-000000000002',
    'aca30000-0000-0000-0000-000000000001', 'lending', current_date + 14) $stmt$,
  'P0001', 'checkout_limit_reached', 'student 1''s second lending checkout attempt hits max_active_checkouts=1 (limit is per-student)');

-- student 2's first lending checkout should succeed (it is their first, limit is per-student)
select id as checkout2_id from public.library_checkout(
  'aca00000-0000-0000-0000-00000000000a', 'aca60000-0000-0000-0000-000000000002',
  'aca30000-0000-0000-0000-000000000002', 'lending', current_date - 7) \gset

select throws_ok(
  format($f$ select public.library_checkout('aca00000-0000-0000-0000-00000000000a', 'aca60000-0000-0000-0000-000000000003',
    'aca30000-0000-0000-0000-000000000002', 'lending', current_date + 14) $f$),
  'P0001', 'checkout_limit_reached', 'student 2''s second lending checkout hits max_active_checkouts=1');

-- but a rental for the same over-limit student is exempt from the lending cap
select id as rental_checkout_id from public.library_checkout(
  'aca00000-0000-0000-0000-00000000000a', 'aca60000-0000-0000-0000-000000000003',
  'aca30000-0000-0000-0000-000000000002', 'rental', current_date + 200) \gset

select ok(:'rental_checkout_id' is not null, 'a rental checkout is exempt from max_active_checkouts (a different volume category than lending)');

-- ---------- tenant-consistency trigger ----------
select throws_ok(
  $stmt$ insert into public.library_checkouts (tenant_id, copy_id, student_id, checkout_type, due_on, status)
         values ('acb00000-0000-0000-0000-00000000000b', 'aca60000-0000-0000-0000-000000000001', 'aca30000-0000-0000-0000-000000000001', 'lending', current_date + 14, 'checked_out') $stmt$,
  'P0001', null, 'the tenant-consistency trigger rejects a checkout whose copy_id belongs to a different tenant');

-- ---------- RLS: select on library_checkouts ----------
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'aca00001-0000-0000-0000-000000000005'; -- student 1 (self)

select is(
  (select count(*)::int from public.library_checkouts where id = :'checkout1_id'),
  1, 'student 1 sees their own checkout');

set local request.jwt.claim.sub = 'aca00001-0000-0000-0000-000000000007'; -- student 2, different family

select is(
  (select count(*)::int from public.library_checkouts where id = :'checkout1_id'),
  0, 'a different student in the same tenant sees 0 for student 1''s checkout');

set local request.jwt.claim.sub = 'aca00001-0000-0000-0000-000000000006'; -- parent 1, guardian of student 1

select is(
  (select count(*)::int from public.library_checkouts where id = :'checkout1_id'),
  1, 'the guardian of student 1 sees student 1''s checkout');

set local request.jwt.claim.sub = 'acb00001-0000-0000-0000-000000000001'; -- cross-tenant admin

select is(
  (select count(*)::int from public.library_checkouts where id = :'checkout1_id'),
  0, 'cross-tenant admin sees 0 for tenant A''s checkout');

-- ---------- no direct authenticated write on checkouts/holds/fines ----------
set local request.jwt.claim.sub = 'aca00001-0000-0000-0000-000000000002'; -- librarian, own tenant

select throws_ok(
  $stmt$ insert into public.library_checkouts (tenant_id, copy_id, student_id, checkout_type, due_on, status)
         values ('aca00000-0000-0000-0000-00000000000a', 'aca60000-0000-0000-0000-000000000001', 'aca30000-0000-0000-0000-000000000001', 'lending', current_date + 14, 'checked_out') $stmt$,
  '42501', null, 'even a librarian cannot INSERT library_checkouts directly -- service_role/RPC only');

select throws_ok(
  $stmt$ insert into public.library_holds (tenant_id, book_id, student_id) values
         ('aca00000-0000-0000-0000-00000000000a', 'aca50000-0000-0000-0000-000000000001', 'aca30000-0000-0000-0000-000000000001') $stmt$,
  '42501', null, 'authenticated cannot INSERT library_holds directly -- service_role only');

select throws_ok(
  format($f$ insert into public.library_fines (tenant_id, checkout_id, amount) values
         ('aca00000-0000-0000-0000-00000000000a', %L, 10.00) $f$, :'checkout1_id'),
  '42501', null, 'authenticated cannot INSERT library_fines directly -- only library_return() creates fines');

-- ---------- duplicate-active-hold unique index ----------
reset role;
set local role service_role;

insert into public.library_holds (tenant_id, book_id, student_id) values
  ('aca00000-0000-0000-0000-00000000000a', 'aca50000-0000-0000-0000-000000000001', 'aca30000-0000-0000-0000-000000000002');

select throws_ok(
  $stmt$ insert into public.library_holds (tenant_id, book_id, student_id) values
         ('aca00000-0000-0000-0000-00000000000a', 'aca50000-0000-0000-0000-000000000001', 'aca30000-0000-0000-0000-000000000002') $stmt$,
  '23505', null, 'a second active hold for the same student+book is rejected by the partial unique index');

-- ---------- copy-reserved-for-a-ready-hold exemption ----------
-- Must run before any other return touches a copy of this same book --
-- library_return() promotes the earliest 'waiting' hold on the *book*
-- whenever any of its copies comes back, so a return of copy 2 or 3 here
-- would consume student 2's hold before this assertion gets to it.
-- Returning checkout 1 (copy 1) is what should promote it.
select hold_ready_student_id as ready_for from public.library_return(
  'aca00000-0000-0000-0000-00000000000a', :'checkout1_id') \gset

select is(:'ready_for'::uuid, 'aca30000-0000-0000-0000-000000000002'::uuid, 'returning copy 1 promotes student 2''s waiting hold to ready');

select throws_ok(
  format($f$ select public.library_checkout('aca00000-0000-0000-0000-00000000000a', 'aca60000-0000-0000-0000-000000000001',
    'aca30000-0000-0000-0000-000000000001', 'lending', current_date + 14) $f$),
  'P0001', 'copy_reserved_for_hold', 'a different (non-holding) student cannot claim the copy held ready for student 2');

-- ---------- library_return(): rental has no fine, lending does ----------
select fine_amount as rental_fine from public.library_return(
  'aca00000-0000-0000-0000-00000000000a', :'rental_checkout_id') \gset

select is(:'rental_fine'::numeric, 0::numeric, 'a late RENTAL return produces no fine (deliberate exemption)');
select is(
  (select count(*)::int from public.library_fines where checkout_id = :'rental_checkout_id'),
  0, 'no library_fines row exists for the late rental return');

select fine_amount as lending_fine from public.library_return(
  'aca00000-0000-0000-0000-00000000000a', :'checkout2_id') \gset

select is(:'lending_fine'::numeric, 35::numeric, 'a late LENDING return (7 days, 5.00/day) produces a 35.00 fine');
select is(
  (select amount from public.library_fines where checkout_id = :'checkout2_id'),
  35.00, 'the fine row records the correct amount');

-- ---------- library_fines: staff can update, no direct insert ----------
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'aca00001-0000-0000-0000-000000000002'; -- librarian

select lives_ok(
  format($f$ update public.library_fines set status = 'paid', paid_on = current_date where checkout_id = %L $f$, :'checkout2_id'),
  'librarian can update (mark paid) a fine in their tenant');

select is(
  (select status from public.library_fines where checkout_id = :'checkout2_id'),
  'paid', 'the fine status is now paid');

-- ---------- portal_notifications replay guard extended to hold_id ----------
reset role;
set local role service_role;

insert into public.portal_notifications (tenant_id, recipient_id, student_id, kind, hold_id) values
  ('aca00000-0000-0000-0000-00000000000a', 'aca00001-0000-0000-0000-000000000007', 'aca30000-0000-0000-0000-000000000002',
   'book_hold_ready', (select id from public.library_holds where book_id = 'aca50000-0000-0000-0000-000000000001' and student_id = 'aca30000-0000-0000-0000-000000000002'));

select throws_ok(
  format($f$ insert into public.portal_notifications (tenant_id, recipient_id, student_id, kind, hold_id) values
         ('aca00000-0000-0000-0000-00000000000a', 'aca00001-0000-0000-0000-000000000007', 'aca30000-0000-0000-0000-000000000002',
          'book_hold_ready', %L) $f$,
    (select id from public.library_holds where book_id = 'aca50000-0000-0000-0000-000000000001' and student_id = 'aca30000-0000-0000-0000-000000000002')),
  '23505', null, 'a duplicate book_hold_ready notification for the same hold is rejected by the replay guard');

select * from finish();
rollback;
