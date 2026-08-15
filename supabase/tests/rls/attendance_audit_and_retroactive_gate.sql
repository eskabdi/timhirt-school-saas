-- ============================================================================
-- Regression for the attendance audit-trail + retroactive-edit-gate fix
-- (20260821000005_attendance_audit_and_retroactive_gate.sql). Marking and
-- editing attendance now writes to audit_logs; a plain teacher can still
-- edit today's record but not one older than the tenant's retroactive-edit
-- window (default 7 days); school_admin retains the override by default;
-- the window is configurable per-tenant via tenant_configs.
-- ============================================================================
begin;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'teacher-aag@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'admin-aag@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('cccccccc-3333-3333-3333-333333333333', 'Tenant AAG', 'rls-test-tenant-aag', 'active', 'premium');
insert into public.users (id, tenant_id, role, full_name, email) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'cccccccc-3333-3333-3333-333333333333', 'teacher', 'Teacher AAG', 'teacher-aag@test.example'),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'cccccccc-3333-3333-3333-333333333333', 'school_admin', 'Admin AAG', 'admin-aag@test.example');
insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('dddddddd-4444-4444-4444-444444444444', 'cccccccc-3333-3333-3333-333333333333', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('eeeeeeee-5555-5555-5555-555555555555', 'cccccccc-3333-3333-3333-333333333333', 'dddddddd-4444-4444-4444-444444444444', 'Grade 5', 'A');
insert into public.teachers (id, tenant_id, user_id, staff_no) values
  ('ffffffff-6666-6666-6666-666666666666', 'cccccccc-3333-3333-3333-333333333333', 'aaaaaaaa-1111-1111-1111-111111111111', 'T-AAG');
insert into public.subjects (id, tenant_id, code, name_i18n) values
  ('11111111-7777-7777-7777-777777777777', 'cccccccc-3333-3333-3333-333333333333', 'MATH', '{"en":"Math"}');
insert into public.class_subject_teachers (class_id, subject_id, teacher_id, tenant_id) values
  ('eeeeeeee-5555-5555-5555-555555555555', '11111111-7777-7777-7777-777777777777', 'ffffffff-6666-6666-6666-666666666666', 'cccccccc-3333-3333-3333-333333333333');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('22222222-8888-8888-8888-888888888888', 'cccccccc-3333-3333-3333-333333333333', 'eeeeeeee-5555-5555-5555-555555555555', 'ADM-AAG-1', 'X', 'Y', '2015-01-01', 'male');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-1111-1111-1111-111111111111';

insert into public.attendance (id, tenant_id, student_id, class_id, attendance_date, status) values
  ('33333333-9999-9999-9999-999999999999', 'cccccccc-3333-3333-3333-333333333333', '22222222-8888-8888-8888-888888888888', 'eeeeeeee-5555-5555-5555-555555555555', current_date - 30, 'present');
insert into public.attendance (id, tenant_id, student_id, class_id, attendance_date, status) values
  ('44444444-0000-0000-0000-000000000000', 'cccccccc-3333-3333-3333-333333333333', '22222222-8888-8888-8888-888888888888', 'eeeeeeee-5555-5555-5555-555555555555', current_date, 'present');

reset role;

-- ---------- audit trail: marking attendance writes to audit_logs ----------
select is((select count(*) from public.audit_logs where table_name = 'attendance' and action = 'insert')::int, 2,
  'both attendance inserts produced an audit_logs row');

-- ---------- teacher CAN still edit today's record --------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-1111-1111-1111-111111111111';
update public.attendance set status = 'late' where id = '44444444-0000-0000-0000-000000000000';
reset role;

select is((select status from public.attendance where id = '44444444-0000-0000-0000-000000000000')::text, 'late',
  'a plain teacher can still edit same-day attendance');

select is((select count(*) from public.audit_logs where table_name = 'attendance' and action = 'update')::int, 1,
  'the same-day edit is audited too');

-- ---------- teacher CANNOT edit a 30-day-old record -------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-1111-1111-1111-111111111111';
update public.attendance set status = 'absent' where id = '33333333-9999-9999-9999-999999999999';
reset role;

select is((select status from public.attendance where id = '33333333-9999-9999-9999-999999999999')::text, 'present',
  'a plain teacher''s retroactive edit past the window has no effect (blocked by the RESTRICTIVE policy)');

-- ---------- school_admin retains the override by default -------------------
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-2222-2222-2222-222222222222';
update public.attendance set status = 'excused' where id = '33333333-9999-9999-9999-999999999999';
reset role;

select is((select status from public.attendance where id = '33333333-9999-9999-9999-999999999999')::text, 'excused',
  'school_admin retains the retroactive-edit override by default');

select is((select count(*) from public.audit_logs where table_name = 'attendance' and action = 'update')::int, 2,
  'the admin''s override edit is audited too');

-- ---------- the window is configurable per-tenant ---------------------------
insert into public.tenant_configs (tenant_id, settings) values
  ('cccccccc-3333-3333-3333-333333333333', '{"attendance_retroactive_edit_days": 45}'::jsonb)
on conflict (tenant_id) do update set settings = excluded.settings;

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-1111-1111-1111-111111111111';
update public.attendance set status = 'absent' where id = '33333333-9999-9999-9999-999999999999';
reset role;

select is((select status from public.attendance where id = '33333333-9999-9999-9999-999999999999')::text, 'absent',
  'widening the tenant''s window to 45 days lets the teacher edit the same 30-day-old record');

select * from finish();
rollback;
