-- ============================================================================
-- Regression for the promotion capacity/atomicity fix
-- (20260821000006_promotion_capacity_atomicity.sql). PromotionPage.tsx used
-- to write students.class_id directly per source class, so a capacity-1
-- class could be overfilled and a mid-batch failure left some classes
-- promoted and others not. promote_students_batch() must: reject the whole
-- batch (zero rows moved) when any target would exceed capacity, including
-- when two source classes combine to overflow a shared target; succeed and
-- move students atomically when there's no conflict; support the graduate
-- branch; and reject cross-tenant class references and callers without
-- students:update permission.
-- ============================================================================
begin;
select plan(13);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '99991111-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'admin-promo@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99991111-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'teacher-promo@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('99990000-0000-0000-0000-000000000001', 'Promo Tenant P', 'rls-test-promo-p', 'active', 'premium'),
  ('99990000-0000-0000-0000-000000000002', 'Promo Tenant Q', 'rls-test-promo-q', 'active', 'premium');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('99991111-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000001', 'school_admin', 'Promo Admin', 'admin-promo@test.example'),
  ('99991111-0000-0000-0000-000000000002', '99990000-0000-0000-0000-000000000001', 'teacher', 'Promo Teacher', 'teacher-promo@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('99992000-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000001', 2017, '2024-09-11', '2025-09-10', 'closed'),
  ('99992000-0000-0000-0000-000000000002', '99990000-0000-0000-0000-000000000001', 2018, '2025-09-11', '2026-09-10', 'active');

-- source1 (2 active students) -> target1 with capacity 1: overflow case
-- source2 (1 active student)  -> target1 with capacity 1: overflow-only-in-combination case
-- source3 (1 active student)  -> target3 with no capacity limit: no-conflict case
-- source4 (1 active student)  -> target1, alone, exactly at capacity: succeeds case
insert into public.classes (id, tenant_id, academic_year_id, name, section, grade_level, capacity) values
  ('99993000-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000001', '99992000-0000-0000-0000-000000000001', 'Grade 5', 'A', 5, null),
  ('99993000-0000-0000-0000-000000000002', '99990000-0000-0000-0000-000000000001', '99992000-0000-0000-0000-000000000001', 'Grade 5', 'B', 5, null),
  ('99993000-0000-0000-0000-000000000003', '99990000-0000-0000-0000-000000000001', '99992000-0000-0000-0000-000000000001', 'Grade 9', 'A', 9, null),
  ('99993000-0000-0000-0000-000000000004', '99990000-0000-0000-0000-000000000001', '99992000-0000-0000-0000-000000000001', 'Grade 5', 'C', 5, null),
  ('99994000-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000001', '99992000-0000-0000-0000-000000000002', 'Grade 6', 'A', 6, 1),
  ('99994000-0000-0000-0000-000000000003', '99990000-0000-0000-0000-000000000001', '99992000-0000-0000-0000-000000000002', 'Grade 10', 'A', 10, null);

-- a class in a different tenant, for the cross-tenant rejection test
insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('99992000-0000-0000-0000-000000000009', '99990000-0000-0000-0000-000000000002', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section, grade_level) values
  ('99995000-0000-0000-0000-000000000009', '99990000-0000-0000-0000-000000000002', '99992000-0000-0000-0000-000000000009', 'Grade 6', 'A', 6);

insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender, status) values
  ('99996000-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000001', '99993000-0000-0000-0000-000000000001', 'ADM-P-001', 'S1a', 'Student', '2015-01-01', 'male', 'active'),
  ('99996000-0000-0000-0000-000000000002', '99990000-0000-0000-0000-000000000001', '99993000-0000-0000-0000-000000000001', 'ADM-P-002', 'S1b', 'Student', '2015-01-01', 'male', 'active'),
  ('99996000-0000-0000-0000-000000000003', '99990000-0000-0000-0000-000000000001', '99993000-0000-0000-0000-000000000002', 'ADM-P-003', 'S2',  'Student', '2015-01-01', 'male', 'active'),
  ('99996000-0000-0000-0000-000000000004', '99990000-0000-0000-0000-000000000001', '99993000-0000-0000-0000-000000000003', 'ADM-P-004', 'S3',  'Student', '2011-01-01', 'male', 'active'),
  ('99996000-0000-0000-0000-000000000005', '99990000-0000-0000-0000-000000000001', '99993000-0000-0000-0000-000000000004', 'ADM-P-005', 'S4',  'Student', '2015-01-01', 'male', 'active');

set local role authenticated;
set local request.jwt.claim.sub = '99991111-0000-0000-0000-000000000001'; -- school_admin

-- ---------- 1: a single move that alone exceeds a capacity-1 target --------
select throws_ok(
  $$ select public.promote_students_batch(
       '[{"source_class_id":"99993000-0000-0000-0000-000000000001","target_class_id":"99994000-0000-0000-0000-000000000001"}]'::jsonb) $$,
  'P0001', null,
  'moving 2 students into a capacity-1 class is rejected'
);

select is(
  (select class_id from public.students where id = '99996000-0000-0000-0000-000000000001'),
  '99993000-0000-0000-0000-000000000001'::uuid,
  'rejected move: source1 student1 was NOT moved'
);
select is(
  (select class_id from public.students where id = '99996000-0000-0000-0000-000000000002'),
  '99993000-0000-0000-0000-000000000001'::uuid,
  'rejected move: source1 student2 was NOT moved'
);

-- ---------- 2: two source classes that individually fit but combine to overflow ----
select throws_ok(
  $$ select public.promote_students_batch(
       '[{"source_class_id":"99993000-0000-0000-0000-000000000002","target_class_id":"99994000-0000-0000-0000-000000000001"},
         {"source_class_id":"99993000-0000-0000-0000-000000000004","target_class_id":"99994000-0000-0000-0000-000000000001"}]'::jsonb) $$,
  'P0001', null,
  'two source classes that individually fit but together overflow the shared target are rejected as one batch'
);
select is(
  (select class_id from public.students where id = '99996000-0000-0000-0000-000000000003'),
  '99993000-0000-0000-0000-000000000002'::uuid,
  'combined-overflow rejection: neither source class moved (source2 student untouched)'
);
select is(
  (select class_id from public.students where id = '99996000-0000-0000-0000-000000000005'),
  '99993000-0000-0000-0000-000000000004'::uuid,
  'combined-overflow rejection: neither source class moved (source4 student untouched)'
);

-- ---------- 3: exactly-at-capacity succeeds ---------------------------------
select lives_ok(
  $$ select public.promote_students_batch(
       '[{"source_class_id":"99993000-0000-0000-0000-000000000004","target_class_id":"99994000-0000-0000-0000-000000000001"}]'::jsonb) $$,
  'a single student filling a capacity-1 target exactly succeeds'
);
select is(
  (select class_id from public.students where id = '99996000-0000-0000-0000-000000000005'),
  '99994000-0000-0000-0000-000000000001'::uuid,
  'student4 was actually moved into the capacity-1 target'
);

-- ---------- 4: multi-class, no-conflict batch moves + graduates atomically --
select results_eq(
  $$ select promoted_count, graduated_count from public.promote_students_batch(
       '[{"source_class_id":"99993000-0000-0000-0000-000000000002","target_class_id":"99994000-0000-0000-0000-000000000003"},
         {"source_class_id":"99993000-0000-0000-0000-000000000003","graduate":true}]'::jsonb) $$,
  $$ values (1, 1) $$,
  'a no-conflict multi-class batch reports 1 promoted + 1 graduated'
);
select is(
  (select class_id from public.students where id = '99996000-0000-0000-0000-000000000003'),
  '99994000-0000-0000-0000-000000000003'::uuid,
  'no-conflict batch: student actually promoted to the new-grade target'
);
select is(
  (select status from public.students where id = '99996000-0000-0000-0000-000000000004'),
  'graduated',
  'no-conflict batch: graduate branch actually sets status'
);

-- ---------- 5: cross-tenant class reference is rejected ---------------------
select throws_ok(
  $$ select public.promote_students_batch(
       '[{"source_class_id":"99993000-0000-0000-0000-000000000001","target_class_id":"99995000-0000-0000-0000-000000000009"}]'::jsonb) $$,
  'P0001', null,
  'a target_class_id belonging to a different tenant is rejected'
);

reset role;

-- ---------- 6: a caller without students:update permission is rejected -----
set local role authenticated;
set local request.jwt.claim.sub = '99991111-0000-0000-0000-000000000002'; -- teacher (no students:update)

select throws_ok(
  $$ select public.promote_students_batch(
       '[{"source_class_id":"99993000-0000-0000-0000-000000000001","target_class_id":"99994000-0000-0000-0000-000000000001"}]'::jsonb) $$,
  'P0001', null,
  'a caller without students:update permission (teacher) cannot run a promotion batch'
);

reset role;

select * from finish();
rollback;
