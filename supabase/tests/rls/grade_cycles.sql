-- ============================================================================
-- grade_cycles (20260814000001) -- platform-global reference table for the
-- Ethiopian MoE grade-cycle bands (First/Second Cycle, Lower/Upper
-- Secondary), same shape and RLS pattern as school_types/operational_modes:
-- readable by anyone authenticated, writable only by super_admin.
-- grade_cycle_for() resolves a grade_level to its cycle id.
--
-- Also covers the two sibling migrations that ride on this table:
-- subjects.min_grade/max_grade (20260814000002) and
-- fee_structures.grade_level/grade_cycle_id (20260814000003) -- both are
-- plain columns governed by the existing subjects_write/fee_structures_write
-- policies (school_admin only), so this suite proves the CHECK constraints
-- and confirms those existing role gates still cover the new columns.
--
-- generate-fee-invoices' role-gating and dedup behavior is Deno/TS, not SQL
-- -- not pgTAP-testable here; covered by the plan's manual Verification
-- steps (role gating, double-call idempotency) instead.
-- ============================================================================
begin;
select plan(35);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '9c000001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'gc-admin@test.example',   crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9c000002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'gc-teacher@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9c000003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'gc-super@test.example',   crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9c000004-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'gc-teacher-b@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('9c000000-0000-0000-0000-00000000000a', 'GC Tenant A', 'gc-tenant-a', 'active'),
  ('9c000000-0000-0000-0000-00000000000b', 'GC Tenant B', 'gc-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('9c000001-0000-0000-0000-000000000001', '9c000000-0000-0000-0000-00000000000a', 'school_admin', 'GC Admin',     'gc-admin@test.example'),
  ('9c000002-0000-0000-0000-000000000002', '9c000000-0000-0000-0000-00000000000a', 'teacher',      'GC Teacher',   'gc-teacher@test.example'),
  ('9c000003-0000-0000-0000-000000000003', '9c000000-0000-0000-0000-00000000000a', 'super_admin',  'GC Super',     'gc-super@test.example'),
  ('9c000004-0000-0000-0000-000000000004', '9c000000-0000-0000-0000-00000000000b', 'teacher',      'GC Teacher B', 'gc-teacher-b@test.example');

insert into public.academic_years (id, tenant_id, ec_year, label_i18n, starts_on, ends_on, status) values
  ('9c000000-0000-0000-0000-0000000000a1', '9c000000-0000-0000-0000-00000000000a', 2017, '{}'::jsonb, '2024-09-01', '2025-07-01', 'active');

insert into public.classes (id, tenant_id, academic_year_id, name, section, grade_level) values
  ('9c000000-0000-0000-0000-0000000000c1', '9c000000-0000-0000-0000-00000000000a', '9c000000-0000-0000-0000-0000000000a1', 'Grade 5', 'A', 5);

-- ---------- 1. seed correctness ---------------------------------------------
select is(
  (select count(*)::int from public.grade_cycles), 4,
  'exactly 4 grade_cycles rows are seeded');

select is(
  (select min_grade::text || '-' || max_grade::text from public.grade_cycles where key = 'first_cycle'),
  '1-4', 'first_cycle spans grades 1-4');

select is(
  (select min_grade::text || '-' || max_grade::text from public.grade_cycles where key = 'second_cycle'),
  '5-8', 'second_cycle spans grades 5-8');

select is(
  (select min_grade::text || '-' || max_grade::text from public.grade_cycles where key = 'lower_secondary'),
  '9-10', 'lower_secondary spans grades 9-10');

select is(
  (select min_grade::text || '-' || max_grade::text from public.grade_cycles where key = 'upper_secondary'),
  '11-12', 'upper_secondary spans grades 11-12');

select is(
  (select count(*)::int from public.grade_cycles a join public.grade_cycles b
     on a.id <> b.id and a.min_grade <= b.max_grade and b.min_grade <= a.max_grade),
  0, 'no two cycles overlap');

-- ---------- 2. global read access (no tenant_id column at all) --------------
set local role authenticated;
set local request.jwt.claim.sub = '9c000002-0000-0000-0000-000000000002'; -- teacher, tenant A

select is(
  (select count(*)::int from public.grade_cycles), 4,
  'a teacher in tenant A can read all 4 grade_cycles');

set local request.jwt.claim.sub = '9c000004-0000-0000-0000-000000000004'; -- teacher, tenant B

select is(
  (select count(*)::int from public.grade_cycles), 4,
  'a teacher in tenant B can read the same 4 grade_cycles -- table is platform-global');

-- ---------- 3. write gating: super_admin only --------------------------------
set local request.jwt.claim.sub = '9c000002-0000-0000-0000-000000000002'; -- teacher (tenant A), not super_admin

select lives_ok(
  $stmt$ update public.grade_cycles set name_i18n = '{"en":"Hacked"}'::jsonb where key = 'first_cycle' $stmt$,
  'teacher''s write to grade_cycles runs without error (RLS filters, does not raise)');

set local request.jwt.claim.sub = '9c000003-0000-0000-0000-000000000003'; -- super_admin, verifying read

select is(
  (select name_i18n->>'en' from public.grade_cycles where key = 'first_cycle'), 'Primary School 1st Cycle',
  'name_i18n is unchanged -- the teacher''s write matched zero rows');

select lives_ok(
  $stmt$ update public.grade_cycles set name_i18n = '{"en":"First Cycle (renamed)"}'::jsonb where key = 'first_cycle' $stmt$,
  'super_admin can write grade_cycles');

select is(
  (select name_i18n->>'en' from public.grade_cycles where key = 'first_cycle'), 'First Cycle (renamed)',
  'grade_cycles write actually took effect for super_admin');

reset role;

-- ---------- 4. grade_cycle_for() boundaries ----------------------------------
select is((select key from public.grade_cycles where id = public.grade_cycle_for(1::smallint)),  'first_cycle',     'grade 1 -> first_cycle');
select is((select key from public.grade_cycles where id = public.grade_cycle_for(4::smallint)),  'first_cycle',     'grade 4 -> first_cycle');
select is((select key from public.grade_cycles where id = public.grade_cycle_for(5::smallint)),  'second_cycle',    'grade 5 -> second_cycle');
select is((select key from public.grade_cycles where id = public.grade_cycle_for(8::smallint)),  'second_cycle',    'grade 8 -> second_cycle');
select is((select key from public.grade_cycles where id = public.grade_cycle_for(9::smallint)),  'lower_secondary', 'grade 9 -> lower_secondary');
select is((select key from public.grade_cycles where id = public.grade_cycle_for(10::smallint)), 'lower_secondary', 'grade 10 -> lower_secondary');
select is((select key from public.grade_cycles where id = public.grade_cycle_for(11::smallint)), 'upper_secondary', 'grade 11 -> upper_secondary');
select is((select key from public.grade_cycles where id = public.grade_cycle_for(12::smallint)), 'upper_secondary', 'grade 12 -> upper_secondary');
select is(public.grade_cycle_for(0::smallint),  null::uuid, 'grade 0 (pre-primary/KG) has no cycle -- intentional');
select is(public.grade_cycle_for(13::smallint), null::uuid, 'grade 13 (out of range) degrades to no cycle');

-- ---------- 5. subjects.min_grade/max_grade CHECK ----------------------------
select throws_ok(
  $stmt$ insert into public.subjects (tenant_id, name_i18n, code, min_grade)
         values ('9c000000-0000-0000-0000-00000000000a', '{"en":"Civics"}'::jsonb, 'GCS-01', 9) $stmt$,
  '23514', null, 'min_grade set without max_grade is rejected');

select throws_ok(
  $stmt$ insert into public.subjects (tenant_id, name_i18n, code, min_grade, max_grade)
         values ('9c000000-0000-0000-0000-00000000000a', '{"en":"Civics"}'::jsonb, 'GCS-02', 9, 5) $stmt$,
  '23514', null, 'max_grade less than min_grade is rejected');

select lives_ok(
  $stmt$ insert into public.subjects (tenant_id, name_i18n, code)
         values ('9c000000-0000-0000-0000-00000000000a', '{"en":"General Studies"}'::jsonb, 'GCS-03') $stmt$,
  'both min_grade and max_grade null (applies to all grades) is accepted');

select lives_ok(
  $stmt$ insert into public.subjects (tenant_id, name_i18n, code, min_grade, max_grade)
         values ('9c000000-0000-0000-0000-00000000000a', '{"en":"Civics"}'::jsonb, 'GCS-04', 9, 12) $stmt$,
  'a valid grade range (9-12) is accepted');

-- ---------- 6. fee_structures scope CHECK ------------------------------------
select throws_ok(
  $stmt$ insert into public.fee_structures (tenant_id, name_i18n, amount, billing_cycle, class_id, grade_level)
         values ('9c000000-0000-0000-0000-00000000000a', '{"en":"Tuition"}'::jsonb, 100, 'term',
                 '9c000000-0000-0000-0000-0000000000c1', 5) $stmt$,
  '23514', null, 'class_id and grade_level both set is rejected');

select throws_ok(
  $stmt$ insert into public.fee_structures (tenant_id, name_i18n, amount, billing_cycle, class_id, grade_level, grade_cycle_id)
         values ('9c000000-0000-0000-0000-00000000000a', '{"en":"Tuition"}'::jsonb, 100, 'term',
                 '9c000000-0000-0000-0000-0000000000c1', 5,
                 (select id from public.grade_cycles where key = 'second_cycle')) $stmt$,
  '23514', null, 'all three of class_id/grade_level/grade_cycle_id set is rejected');

select lives_ok(
  $stmt$ insert into public.fee_structures (tenant_id, name_i18n, amount, billing_cycle, grade_level)
         values ('9c000000-0000-0000-0000-00000000000a', '{"en":"Tuition"}'::jsonb, 100, 'term', 5) $stmt$,
  'grade_level alone (whole-grade billing) is accepted');

select lives_ok(
  $stmt$ insert into public.fee_structures (tenant_id, name_i18n, amount, billing_cycle, grade_cycle_id)
         values ('9c000000-0000-0000-0000-00000000000a', '{"en":"Tuition"}'::jsonb, 100, 'term',
                 (select id from public.grade_cycles where key = 'second_cycle')) $stmt$,
  'grade_cycle_id alone (whole-cycle billing) is accepted');

select lives_ok(
  $stmt$ insert into public.fee_structures (tenant_id, name_i18n, amount, billing_cycle)
         values ('9c000000-0000-0000-0000-00000000000a', '{"en":"Tuition"}'::jsonb, 100, 'term') $stmt$,
  'all three scope columns null (tenant-wide, today''s existing meaning) is accepted');

-- ---------- 7. existing role gates still cover the new columns --------------
set local role authenticated;
set local request.jwt.claim.sub = '9c000002-0000-0000-0000-000000000002'; -- teacher, not school_admin

select lives_ok(
  $stmt$ update public.subjects set min_grade = 1, max_grade = 4 where code = 'GCS-03' $stmt$,
  'teacher''s write to subjects.min_grade/max_grade runs without error (RLS filters, does not raise)');

set local request.jwt.claim.sub = '9c000001-0000-0000-0000-000000000001'; -- school_admin, verifying

select is(
  (select min_grade from public.subjects where code = 'GCS-03'), null,
  'min_grade is unchanged -- the teacher''s write matched zero rows');

set local request.jwt.claim.sub = '9c000002-0000-0000-0000-000000000002'; -- teacher again

select lives_ok(
  $stmt$ update public.fee_structures set grade_level = 7 where grade_level = 5 $stmt$,
  'teacher''s write to fee_structures.grade_level runs without error (RLS filters, does not raise)');

set local request.jwt.claim.sub = '9c000001-0000-0000-0000-000000000001';

select is(
  (select grade_level from public.fee_structures where grade_level = 5), 5::smallint,
  'grade_level is unchanged -- the teacher''s write matched zero rows');

reset role;

select * from finish();
rollback;
