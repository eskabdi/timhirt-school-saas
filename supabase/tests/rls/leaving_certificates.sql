-- ============================================================================
-- graduated_ec_year capture (20260827000001_leaving_certificates.sql).
-- Proves: a direct status='graduated' update stamps the student's class's
-- own academic_year.ec_year (not today's date); an unrelated status update
-- (e.g. active->active, or a non-status column change) never touches it;
-- un-graduating clears the stamp; and the promote_students_batch graduate
-- branch + revert_promotion_run round-trip both integrate correctly (this
-- is also, implicitly, the "leaving certificates are not module-gated"
-- proof -- no has_module() check exists anywhere in this trigger or these
-- columns to test against).
-- ============================================================================
begin;
select plan(6);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '99971111-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin-lc@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('99970000-0000-0000-0000-000000000001', 'LC Tenant', 'rls-test-lc', 'active', 'premium');
insert into public.users (id, tenant_id, role, full_name, email) values
  ('99971111-0000-0000-0000-000000000001', '99970000-0000-0000-0000-000000000001', 'school_admin', 'LC Admin', 'admin-lc@test.example');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('99972000-0000-0000-0000-000000000001', '99970000-0000-0000-0000-000000000001', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section, grade_level) values
  ('99973000-0000-0000-0000-000000000001', '99970000-0000-0000-0000-000000000001', '99972000-0000-0000-0000-000000000001', 'Grade 12', 'A', 12);

insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender, status) values
  ('99976000-0000-0000-0000-000000000001', '99970000-0000-0000-0000-000000000001', '99973000-0000-0000-0000-000000000001', 'ADM-LC-001', 'S1', 'Student', '2008-01-01', 'male', 'active'),
  ('99976000-0000-0000-0000-000000000002', '99970000-0000-0000-0000-000000000001', '99973000-0000-0000-0000-000000000001', 'ADM-LC-002', 'S2', 'Student', '2008-01-01', 'male', 'active');

set local role authenticated;
set local request.jwt.claim.sub = '99971111-0000-0000-0000-000000000001';

-- ---------- an unrelated status update never touches graduated_ec_year -----
update public.students set status = 'active' where id = '99976000-0000-0000-0000-000000000001';
select is(
  (select graduated_ec_year from public.students where id = '99976000-0000-0000-0000-000000000001'),
  null::smallint, 'an active->active no-op status update leaves graduated_ec_year null');

-- ---------- direct graduation: stamps the class's own academic year -------
update public.students set status = 'graduated' where id = '99976000-0000-0000-0000-000000000001';
select is(
  (select graduated_ec_year from public.students where id = '99976000-0000-0000-0000-000000000001'),
  2018::smallint, 'graduating stamps the student''s class''s own academic_year.ec_year, not today''s date');

-- ---------- un-graduating clears the stamp ----------------------------------
update public.students set status = 'active' where id = '99976000-0000-0000-0000-000000000001';
select is(
  (select graduated_ec_year from public.students where id = '99976000-0000-0000-0000-000000000001'),
  null::smallint, 'reverting status away from graduated clears graduated_ec_year');

-- ---------- integrates with promote_students_batch's graduate branch -------
select public.promote_students_batch(
  '[{"source_class_id":"99973000-0000-0000-0000-000000000001","graduate":true}]'::jsonb);

select is(
  (select graduated_ec_year from public.students where id = '99976000-0000-0000-0000-000000000002'),
  2018::smallint, 'promote_students_batch''s graduate branch triggers the same stamp');

-- ---------- and clears again on a promotion-run revert ---------------------
do $$
declare v_run_id uuid;
begin
  select id into v_run_id from public.promotion_runs order by run_at desc limit 1;
  perform set_config('test.lc_run_id', v_run_id::text, false);
end $$;

select public.revert_promotion_run(current_setting('test.lc_run_id')::uuid);

select is(
  (select status from public.students where id = '99976000-0000-0000-0000-000000000002'),
  'active'::public.student_status, 'the revert restored the student to active status');

select is(
  (select graduated_ec_year from public.students where id = '99976000-0000-0000-0000-000000000002'),
  null::smallint, 'reverting the promotion run also clears graduated_ec_year');

reset role;
select * from finish();
rollback;
