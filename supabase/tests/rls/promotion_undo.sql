-- ============================================================================
-- Promotion undo/reversal (20260826000001_promotion_undo.sql). Proves:
-- promote_students_batch() records a run_id and one promotion_run_students
-- row per student actually moved (move and graduate branches both), with
-- the real prior class_id/status captured; revert_promotion_run() restores
-- exactly that, reports how many it reverted; a student moved again after
-- the run is skipped rather than clobbered (partial revert); reverting
-- twice is refused outright; and a run cannot be reverted from another
-- tenant.
-- ============================================================================
begin;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '99981111-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin-pu@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99981111-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'admin-pu-b@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('99980000-0000-0000-0000-000000000001', 'Promo Undo Tenant', 'rls-test-promo-undo', 'active', 'premium'),
  ('99970000-0000-0000-0000-000000000002', 'Promo Undo Tenant B', 'rls-test-promo-undo-b', 'active', 'premium');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('99981111-0000-0000-0000-000000000001', '99980000-0000-0000-0000-000000000001', 'school_admin', 'PU Admin', 'admin-pu@test.example'),
  ('99981111-0000-0000-0000-000000000002', '99970000-0000-0000-0000-000000000002', 'school_admin', 'PU Admin B', 'admin-pu-b@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('99982000-0000-0000-0000-000000000001', '99980000-0000-0000-0000-000000000001', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section, grade_level, capacity) values
  ('99983000-0000-0000-0000-000000000001', '99980000-0000-0000-0000-000000000001', '99982000-0000-0000-0000-000000000001', 'Grade 5', 'A', 5, null),
  ('99983000-0000-0000-0000-000000000002', '99980000-0000-0000-0000-000000000001', '99982000-0000-0000-0000-000000000001', 'Grade 6', 'A', 6, null),
  ('99983000-0000-0000-0000-000000000003', '99980000-0000-0000-0000-000000000001', '99982000-0000-0000-0000-000000000001', 'Grade 9', 'A', 9, null);

-- student1: will be promoted (moved). student2: will be graduated.
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender, status) values
  ('99986000-0000-0000-0000-000000000001', '99980000-0000-0000-0000-000000000001', '99983000-0000-0000-0000-000000000001', 'ADM-PU-001', 'S1', 'Student', '2015-01-01', 'male', 'active'),
  ('99986000-0000-0000-0000-000000000002', '99980000-0000-0000-0000-000000000001', '99983000-0000-0000-0000-000000000003', 'ADM-PU-002', 'S2', 'Student', '2011-01-01', 'male', 'active');

set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000001'; -- school_admin

-- ---------- run the batch: one move, one graduate --------------------------
select is(
  (select run_id is not null from public.promote_students_batch(
     '[{"source_class_id":"99983000-0000-0000-0000-000000000001","target_class_id":"99983000-0000-0000-0000-000000000002"},
       {"source_class_id":"99983000-0000-0000-0000-000000000003","graduate":true}]'::jsonb)),
  true, 'promote_students_batch returns a non-null run_id'
);

-- Recover the run_id for the rest of the test.
do $$
declare v_run_id uuid;
begin
  select id into v_run_id from public.promotion_runs order by run_at desc limit 1;
  perform set_config('test.run_id', v_run_id::text, false);
end $$;

select is(
  (select class_id from public.students where id = '99986000-0000-0000-0000-000000000001'),
  '99983000-0000-0000-0000-000000000002', 'student1 was actually moved to the target class');

select is(
  (select status from public.students where id = '99986000-0000-0000-0000-000000000002'),
  'graduated', 'student2 was actually graduated');

select is(
  (select count(*)::int from public.promotion_run_students where run_id = current_setting('test.run_id')::uuid),
  2, 'exactly 2 promotion_run_students rows recorded (one move, one graduate)');

select is(
  (select (from_class_id, to_class_id) from public.promotion_run_students
   where run_id = current_setting('test.run_id')::uuid and student_id = '99986000-0000-0000-0000-000000000001'),
  ('99983000-0000-0000-0000-000000000001'::uuid, '99983000-0000-0000-0000-000000000002'::uuid),
  'the move row records the real prior and new class_id'
);

select is(
  (select (from_status, to_status) from public.promotion_run_students
   where run_id = current_setting('test.run_id')::uuid and student_id = '99986000-0000-0000-0000-000000000002'),
  ('active'::public.student_status, 'graduated'::public.student_status),
  'the graduate row records the real prior and new status'
);

-- ---------- someone edits student2 again AFTER the run, before any revert ---
update public.students set class_id = '99983000-0000-0000-0000-000000000002' where id = '99986000-0000-0000-0000-000000000002';

-- ---------- revert: student1 restores, student2 is skipped (state changed) --
select is(
  (select (reverted_count, skipped_count) from public.revert_promotion_run(current_setting('test.run_id')::uuid)),
  (1, 1),
  'revert reverts the untouched student and skips the one that changed since the run'
);

select is(
  (select class_id from public.students where id = '99986000-0000-0000-0000-000000000001'),
  '99983000-0000-0000-0000-000000000001', 'student1''s class_id is restored to the pre-promotion class'
);

-- ---------- double-revert is refused outright -------------------------------
select throws_ok(
  $$ select public.revert_promotion_run(current_setting('test.run_id')::uuid) $$,
  'P0001', 'promotion_run_already_reverted',
  'reverting the same run a second time is refused'
);

-- ---------- cross-tenant: tenant B cannot revert tenant A's run -------------
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000002'; -- tenant B admin

-- Reset reverted_at so this isn't just re-testing the double-revert guard --
-- prove the actual cross-tenant "not found" path, not the already-reverted one.
set local role postgres;
update public.promotion_runs set reverted_at = null, reverted_by = null where id = current_setting('test.run_id')::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '99981111-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.revert_promotion_run(current_setting('test.run_id')::uuid) $$,
  'P0001', 'promotion run not found',
  'a tenant B admin cannot revert a tenant A promotion run'
);

reset role;
select * from finish();
rollback;
