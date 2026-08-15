-- ============================================================================
-- exam scheduling fields (20260824000001): exam_type_name/exam_date/
-- start_time/end_time/room, all nullable. Proves: an exam can be created
-- with none of them set (existing behavior unaffected), all five can be
-- set together, and exams_time_order rejects an end_time at or before
-- start_time while allowing either side to be null on its own.
-- ============================================================================
begin;
select plan(5);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'e5f00001-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'esf-admin@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('e5f00000-0000-0000-0000-00000000000a', 'ESF Tenant', 'esf-tenant', 'active');
insert into public.users (id, tenant_id, role, full_name, email) values
  ('e5f00001-0000-0000-0000-000000000001', 'e5f00000-0000-0000-0000-00000000000a', 'school_admin', 'ESF Admin', 'esf-admin@test.example');
insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('e5f10000-0000-0000-0000-000000000001', 'e5f00000-0000-0000-0000-00000000000a', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.academic_terms (id, tenant_id, academic_year_id, name_i18n, term_no, starts_on, ends_on) values
  ('e5f19999-0000-0000-0000-000000000001', 'e5f00000-0000-0000-0000-00000000000a', 'e5f10000-0000-0000-0000-000000000001', '{"en":"Term 1"}', 1, '2025-09-11', '2026-01-10');

set local role authenticated;
set local request.jwt.claim.sub = 'e5f00001-0000-0000-0000-000000000001';

-- ---------- unscheduled exam: all five columns stay null, unaffected --------
select lives_ok(
  $$ insert into public.exams (id, tenant_id, academic_term_id, name_i18n, max_score)
     values ('e5f50000-0000-0000-0000-000000000001', 'e5f00000-0000-0000-0000-00000000000a',
             'e5f19999-0000-0000-0000-000000000001', '{"en":"Unscheduled"}', 100) $$,
  'an exam with no scheduling fields set still inserts (existing behavior unaffected)'
);

select is(
  (select count(*)::int from public.exams
   where id = 'e5f50000-0000-0000-0000-000000000001'
     and exam_type_name is null and exam_date is null and start_time is null and end_time is null and room is null),
  1, 'all five scheduling columns default to null');

-- ---------- fully scheduled exam ---------------------------------------------
select lives_ok(
  $$ insert into public.exams (id, tenant_id, academic_term_id, name_i18n, max_score,
       exam_type_name, exam_date, start_time, end_time, room)
     values ('e5f50000-0000-0000-0000-000000000002', 'e5f00000-0000-0000-0000-00000000000a',
             'e5f19999-0000-0000-0000-000000000001', '{"en":"Midterm"}', 100,
             'Midterm', '2026-03-15', '09:00', '11:00', 'Hall B') $$,
  'an exam with all five scheduling fields set inserts cleanly'
);

-- ---------- exams_time_order: end must be after start ------------------------
select throws_ok(
  $$ insert into public.exams (tenant_id, academic_term_id, name_i18n, max_score, start_time, end_time)
     values ('e5f00000-0000-0000-0000-00000000000a', 'e5f19999-0000-0000-0000-000000000001',
             '{"en":"Bad Times"}', 100, '11:00', '09:00') $$,
  '23514', null, 'exams_time_order rejects end_time before start_time'
);

select lives_ok(
  $$ insert into public.exams (tenant_id, academic_term_id, name_i18n, max_score, start_time)
     values ('e5f00000-0000-0000-0000-00000000000a', 'e5f19999-0000-0000-0000-000000000001',
             '{"en":"Start Only"}', 100, '09:00') $$,
  'exams_time_order allows start_time set with end_time still null'
);

reset role;
select * from finish();
rollback;
