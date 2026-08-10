-- ============================================================================
-- Refund tracking fields on admission_applications (20260809000001). No new
-- RLS policy was added -- these columns are covered by the existing
-- admissions_write policy (school_admin/registrar, same tenant) from
-- 20260713000008_extended_rls.sql. Proves that coverage actually holds for
-- the new columns specifically, that a role outside admissions_write (e.g.
-- teacher) is silently filtered rather than able to write, cross-tenant
-- isolation holds, and the refund_notes length CHECK actually rejects.
-- ============================================================================
begin;
select plan(9);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'adf00001-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'adf-admin@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'adf00002-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'adf-registrar@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'adf00003-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'adf-teacher@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'adf00004-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'adf-admin-b@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('adf00000-0000-0000-0000-00000000000a', 'ADF Tenant A', 'adf-tenant-a', 'active', 'premium'),
  ('adf00000-0000-0000-0000-00000000000b', 'ADF Tenant B', 'adf-tenant-b', 'active', 'premium');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('adf00001-0000-0000-0000-000000000001', 'adf00000-0000-0000-0000-00000000000a', 'school_admin', 'ADF Admin',     'adf-admin@test.example'),
  ('adf00002-0000-0000-0000-000000000002', 'adf00000-0000-0000-0000-00000000000a', 'registrar',    'ADF Registrar', 'adf-registrar@test.example'),
  ('adf00003-0000-0000-0000-000000000003', 'adf00000-0000-0000-0000-00000000000a', 'teacher',      'ADF Teacher',   'adf-teacher@test.example'),
  ('adf00004-0000-0000-0000-000000000004', 'adf00000-0000-0000-0000-00000000000b', 'school_admin', 'ADF Admin B',   'adf-admin-b@test.example');

insert into public.admission_applications (id, tenant_id, applicant_name, date_of_birth, guardian_name, stage, payment_method, fees_total_etb, payment_receipt_path) values
  ('adf50000-0000-0000-0000-000000000001', 'adf00000-0000-0000-0000-00000000000a', 'Rejected Applicant', '2015-01-01', 'A Guardian', 'rejected', 'cbe', 5000.00, 'adf00000-0000-0000-0000-00000000000a/adf50000-0000-0000-0000-000000000001/r.jpg');

-- ---------- constraint: refund_notes length CHECK -----------------------------
select throws_ok(
  $stmt$ update public.admission_applications set refund_notes = repeat('x', 501) where id = 'adf50000-0000-0000-0000-000000000001' $stmt$,
  '23514', null, 'refund_notes longer than 500 chars is rejected');

-- ---------- RLS: school_admin and registrar can write refund fields -----------
set local role authenticated;
set local request.jwt.claim.sub = 'adf00001-0000-0000-0000-000000000001'; -- school_admin

select lives_ok(
  $stmt$ update public.admission_applications set refund_status = 'pending', refund_notes = 'awaiting bank transfer'
         where id = 'adf50000-0000-0000-0000-000000000001' $stmt$,
  'school_admin can mark refund pending');

select is(
  (select refund_status::text from public.admission_applications where id = 'adf50000-0000-0000-0000-000000000001'),
  'pending', 'refund_status is actually pending after the school_admin write');

set local request.jwt.claim.sub = 'adf00002-0000-0000-0000-000000000002'; -- registrar

select lives_ok(
  $stmt$ update public.admission_applications set refund_status = 'completed', refund_processed_at = now()
         where id = 'adf50000-0000-0000-0000-000000000001' $stmt$,
  'registrar can mark refund completed');

select is(
  (select refund_status::text from public.admission_applications where id = 'adf50000-0000-0000-0000-000000000001'),
  'completed', 'refund_status is actually completed after the registrar write');

-- ---------- RLS: a role outside admissions_write is silently filtered ---------
set local request.jwt.claim.sub = 'adf00003-0000-0000-0000-000000000003'; -- teacher, same tenant

select lives_ok(
  $stmt$ update public.admission_applications set refund_status = 'not_applicable'
         where id = 'adf50000-0000-0000-0000-000000000001' $stmt$,
  'teacher''s update runs without error (RLS filters, does not raise)');

-- Verified from school_admin's session: a teacher has no admissions_select
-- access at all, so re-reading as the teacher would itself return zero rows
-- and prove nothing about whether the update actually changed anything.
set local request.jwt.claim.sub = 'adf00001-0000-0000-0000-000000000001';

select is(
  (select refund_status::text from public.admission_applications where id = 'adf50000-0000-0000-0000-000000000001'),
  'completed', 'refund_status is unchanged -- the teacher''s update matched zero rows');

-- ---------- RLS: cross-tenant isolation ----------------------------------------
set local request.jwt.claim.sub = 'adf00004-0000-0000-0000-000000000004'; -- school_admin, tenant B

select lives_ok(
  $stmt$ update public.admission_applications set refund_status = 'not_applicable'
         where id = 'adf50000-0000-0000-0000-000000000001' $stmt$,
  'cross-tenant school_admin''s update runs without error (RLS filters, does not raise)');

set local request.jwt.claim.sub = 'adf00001-0000-0000-0000-000000000001';

select is(
  (select refund_status::text from public.admission_applications where id = 'adf50000-0000-0000-0000-000000000001'),
  'completed', 'refund_status is unchanged -- the cross-tenant update matched zero rows');

select * from finish();
rollback;
