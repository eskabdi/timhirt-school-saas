-- ============================================================================
-- Teacher grade-cycle restriction (migration 20260819000001). Proves:
-- a teacher with no teaching_cycle_key set can be assigned to any class
-- (existing behavior, unaffected); a same-cycle assignment succeeds; a
-- cross-cycle assignment is rejected UNLESS cycle_override=true; a class
-- with no resolvable cycle (grade 0 / KG) is never restricted either way.
-- ============================================================================
begin;
select plan(8);

insert into public.tenants (id, name, slug, status) values
  ('dcda0000-0000-0000-0000-00000000000a', 'Cycle Tenant', 'cycle-tenant', 'active');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'dcda0001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'cyc-teacher1@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'dcda0002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'cyc-teacher2@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('dcda0001-0000-0000-0000-000000000001', 'dcda0000-0000-0000-0000-00000000000a', 'teacher', 'Cycle Teacher One', 'cyc-teacher1@test.example'),
  ('dcda0002-0000-0000-0000-000000000002', 'dcda0000-0000-0000-0000-00000000000a', 'teacher', 'Cycle Teacher Two', 'cyc-teacher2@test.example');

-- Teacher One is restricted to first_cycle (grades 1-4); Teacher Two has no
-- cycle set at all -- the "existing teachers unaffected" case.
insert into public.teachers (id, tenant_id, user_id, staff_no, teaching_cycle_key) values
  ('dcda0003-0000-0000-0000-000000000003', 'dcda0000-0000-0000-0000-00000000000a', 'dcda0001-0000-0000-0000-000000000001', 'T-CYC1', 'first_cycle');
insert into public.teachers (id, tenant_id, user_id, staff_no) values
  ('dcda0004-0000-0000-0000-000000000004', 'dcda0000-0000-0000-0000-00000000000a', 'dcda0002-0000-0000-0000-000000000002', 'T-CYC2');

insert into public.academic_years (id, tenant_id, ec_year, label_i18n, starts_on, ends_on, status) values
  ('dcda0005-0000-0000-0000-000000000005', 'dcda0000-0000-0000-0000-00000000000a', 2018, '{"en":"2018"}'::jsonb, '2025-09-01', '2026-06-30', 'active');

-- Grade 2 -> first_cycle; Grade 6 -> second_cycle; Grade 0 (KG) -> no cycle.
insert into public.classes (id, tenant_id, academic_year_id, name, section, grade_level) values
  ('dcda0006-0000-0000-0000-000000000006', 'dcda0000-0000-0000-0000-00000000000a', 'dcda0005-0000-0000-0000-000000000005', 'Grade 2', 'A', 2),
  ('dcda0007-0000-0000-0000-000000000007', 'dcda0000-0000-0000-0000-00000000000a', 'dcda0005-0000-0000-0000-000000000005', 'Grade 6', 'A', 6),
  ('dcda0008-0000-0000-0000-000000000008', 'dcda0000-0000-0000-0000-00000000000a', 'dcda0005-0000-0000-0000-000000000005', 'KG', 'A', 0);

insert into public.subjects (id, tenant_id, name_i18n, code) values
  ('dcda0009-0000-0000-0000-000000000009', 'dcda0000-0000-0000-0000-00000000000a', '{"en":"Math"}', 'MATH');

-- ---------- Same-cycle assignment succeeds ------------------------------------
select lives_ok(
  $stmt$ insert into public.class_subject_teachers (tenant_id, class_id, subject_id, teacher_id) values
         ('dcda0000-0000-0000-0000-00000000000a', 'dcda0006-0000-0000-0000-000000000006', 'dcda0009-0000-0000-0000-000000000009', 'dcda0003-0000-0000-0000-000000000003') $stmt$,
  'assigning a first_cycle teacher to a first_cycle (grade 2) class succeeds');

-- ---------- Cross-cycle assignment without override is rejected --------------
select throws_ok(
  $stmt$ insert into public.class_subject_teachers (tenant_id, class_id, subject_id, teacher_id) values
         ('dcda0000-0000-0000-0000-00000000000a', 'dcda0007-0000-0000-0000-000000000007', 'dcda0009-0000-0000-0000-000000000009', 'dcda0003-0000-0000-0000-000000000003') $stmt$,
  'P0001', 'teacher_outside_assigned_cycle',
  'assigning a first_cycle teacher to a second_cycle (grade 6) class is rejected without an override');

select is(
  (select count(*)::int from public.class_subject_teachers where teacher_id = 'dcda0003-0000-0000-0000-000000000003' and class_id = 'dcda0007-0000-0000-0000-000000000007'),
  0, 'the rejected cross-cycle assignment did not partially insert');

-- ---------- Cross-cycle assignment WITH override succeeds --------------------
select lives_ok(
  $stmt$ insert into public.class_subject_teachers (tenant_id, class_id, subject_id, teacher_id, cycle_override) values
         ('dcda0000-0000-0000-0000-00000000000a', 'dcda0007-0000-0000-0000-000000000007', 'dcda0009-0000-0000-0000-000000000009', 'dcda0003-0000-0000-0000-000000000003', true) $stmt$,
  'the same cross-cycle assignment succeeds once cycle_override=true is set explicitly');

-- ---------- A class with no resolvable cycle (KG/grade 0) is never restricted -
select lives_ok(
  $stmt$ insert into public.class_subject_teachers (tenant_id, class_id, subject_id, teacher_id) values
         ('dcda0000-0000-0000-0000-00000000000a', 'dcda0008-0000-0000-0000-000000000008', 'dcda0009-0000-0000-0000-000000000009', 'dcda0003-0000-0000-0000-000000000003') $stmt$,
  'a first_cycle teacher can be assigned to a KG (grade 0, no cycle) class with no override needed');

-- ---------- A teacher with no cycle set is unrestricted -----------------------
select lives_ok(
  $stmt$ insert into public.class_subject_teachers (tenant_id, class_id, subject_id, teacher_id) values
         ('dcda0000-0000-0000-0000-00000000000a', 'dcda0007-0000-0000-0000-000000000007', 'dcda0009-0000-0000-0000-000000000009', 'dcda0004-0000-0000-0000-000000000004') $stmt$,
  'a teacher with teaching_cycle_key = null (unset) can be assigned to any class, no override needed');

-- ---------- teachers.teaching_cycle_key rejects an unknown cycle key ---------
select throws_ok(
  $stmt$ update public.teachers set teaching_cycle_key = 'not_a_real_cycle' where id = 'dcda0004-0000-0000-0000-000000000004' $stmt$,
  '23503', null,
  'teaching_cycle_key is FK-checked against grade_cycles(key) -- an unknown key is rejected');

select is(
  (select teaching_cycle_key from public.teachers where id = 'dcda0004-0000-0000-0000-000000000004'),
  null, 'the rejected update left teaching_cycle_key unchanged (still null)');

select * from finish();
rollback;
