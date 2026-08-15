-- ============================================================================
-- Student transfer fields (20260829000001_student_transfer.sql). Proves:
-- transfer fields can be set together with status='transferred', and are
-- automatically cleared if the status later moves away from 'transferred'
-- (correcting a mistake), same discipline as graduated_ec_year.
-- ============================================================================
begin;
select plan(3);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '99951111-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin-st@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('99950000-0000-0000-0000-000000000001', 'ST Tenant', 'rls-test-st', 'active', 'premium');
insert into public.users (id, tenant_id, role, full_name, email) values
  ('99951111-0000-0000-0000-000000000001', '99950000-0000-0000-0000-000000000001', 'school_admin', 'ST Admin', 'admin-st@test.example');
insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('99952000-0000-0000-0000-000000000001', '99950000-0000-0000-0000-000000000001', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('99953000-0000-0000-0000-000000000001', '99950000-0000-0000-0000-000000000001', '99952000-0000-0000-0000-000000000001', 'Grade 6', 'A');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender, status) values
  ('99956000-0000-0000-0000-000000000001', '99950000-0000-0000-0000-000000000001', '99953000-0000-0000-0000-000000000001', 'ADM-ST-001', 'S1', 'Student', '2014-01-01', 'male', 'active');

set local role authenticated;
set local request.jwt.claim.sub = '99951111-0000-0000-0000-000000000001';

-- ---------- transfer out: fields land together with the status change -----
update public.students set status = 'transferred',
  transferred_to = 'Another School', transferred_reason = 'Family relocation', transferred_on = '2026-03-01'
  where id = '99956000-0000-0000-0000-000000000001';

select is(
  (select (transferred_to, transferred_reason, transferred_on) from public.students where id = '99956000-0000-0000-0000-000000000001'),
  ('Another School'::text, 'Family relocation'::text, '2026-03-01'::date),
  'transfer-out fields are stored together with the status change'
);

-- ---------- correcting the mistake clears the fields -----------------------
update public.students set status = 'active' where id = '99956000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.students
   where id = '99956000-0000-0000-0000-000000000001'
     and transferred_to is null and transferred_reason is null and transferred_on is null),
  1, 'moving status away from transferred clears all three transfer fields'
);

-- ---------- prior_school_name/prior_grade are ordinary settable columns ----
update public.students set prior_school_name = 'Old School', prior_grade = '5' where id = '99956000-0000-0000-0000-000000000001';

select is(
  (select (prior_school_name, prior_grade) from public.students where id = '99956000-0000-0000-0000-000000000001'),
  ('Old School'::text, '5'::text),
  'prior_school_name/prior_grade are plain settable fields, unaffected by the status trigger'
);

reset role;
select * from finish();
rollback;
