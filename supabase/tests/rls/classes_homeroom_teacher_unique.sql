-- ============================================================================
-- Homeroom teacher uniqueness (migration 20260804000001).
--
-- Proves the partial unique index actually rejects a second class pointing
-- its homeroom_teacher_id at a teacher already homeroom elsewhere, that a
-- teacher CAN be reassigned to a different class (freeing the old one), and
-- that NULL stays unconstrained -- any number of classes can sit without a
-- homeroom teacher at once.
-- ============================================================================
begin;
select plan(5);

insert into public.tenants (id, name, slug, status) values
  ('aaaa1111-0000-0000-0000-00000000000a', 'Homeroom Tenant', 'homeroom-tenant', 'active');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaa1111-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'hr-teacher1@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('aaaa1111-0000-0000-0000-000000000002', 'aaaa1111-0000-0000-0000-00000000000a', 'teacher', 'Teacher One', 'hr-teacher1@test.example');

insert into public.teachers (id, tenant_id, user_id, staff_no) values
  ('aaaa1111-0000-0000-0000-00000000000b', 'aaaa1111-0000-0000-0000-00000000000a', 'aaaa1111-0000-0000-0000-000000000002', 'T-H1');

insert into public.academic_years (id, tenant_id, ec_year, label_i18n, starts_on, ends_on, status) values
  ('bbbb1111-0000-0000-0000-00000000000b', 'aaaa1111-0000-0000-0000-00000000000a',
   2018, '{"en":"2018"}'::jsonb, '2025-09-01', '2026-06-30', 'active');

insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('cccc1111-0000-0000-0000-00000000000c', 'aaaa1111-0000-0000-0000-00000000000a',
   'bbbb1111-0000-0000-0000-00000000000b', 'Grade 1', 'A'),
  ('dddd1111-0000-0000-0000-00000000000d', 'aaaa1111-0000-0000-0000-00000000000a',
   'bbbb1111-0000-0000-0000-00000000000b', 'Grade 1', 'B');

-- ---------- A teacher becomes homeroom of the first class ---------------------
select lives_ok(
  $stmt$ update public.classes set homeroom_teacher_id = 'aaaa1111-0000-0000-0000-00000000000b'
         where id = 'cccc1111-0000-0000-0000-00000000000c' $stmt$,
  'assigning a homeroom teacher to an unclaimed class succeeds');

-- ---------- THE regression that matters: same teacher, second class ----------
select throws_ok(
  $stmt$ update public.classes set homeroom_teacher_id = 'aaaa1111-0000-0000-0000-00000000000b'
         where id = 'dddd1111-0000-0000-0000-00000000000d' $stmt$,
  '23505', null,
  'the same teacher cannot be homeroom of a second class at the same time');

-- ---------- Two classes with no homeroom teacher: NULL stays unconstrained ---
select lives_ok(
  $stmt$ insert into public.classes (tenant_id, academic_year_id, name, section) values
         ('aaaa1111-0000-0000-0000-00000000000a', 'bbbb1111-0000-0000-0000-00000000000b', 'Grade 2', 'A'),
         ('aaaa1111-0000-0000-0000-00000000000a', 'bbbb1111-0000-0000-0000-00000000000b', 'Grade 2', 'B') $stmt$,
  'any number of classes can sit with no homeroom teacher (NULL is unconstrained)');

-- ---------- Freeing the first class lets the teacher move to the second ------
select lives_ok(
  $stmt$ update public.classes set homeroom_teacher_id = null
         where id = 'cccc1111-0000-0000-0000-00000000000c' $stmt$,
  'clearing the first class''s homeroom teacher frees the slot');

select lives_ok(
  $stmt$ update public.classes set homeroom_teacher_id = 'aaaa1111-0000-0000-0000-00000000000b'
         where id = 'dddd1111-0000-0000-0000-00000000000d' $stmt$,
  'the teacher can now become homeroom of the second class');

select * from finish();
rollback;
