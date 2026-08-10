-- ============================================================================
-- Payroll segregation-of-duties + immutability — regression test for C2/C3.
-- Verifies: (a) approver is always bound to auth.uid(), never a client-
-- supplied value; (b) the preparer cannot approve their own run; (c) only
-- forward transitions are allowed; (d) a paid run is fully immutable.
-- ============================================================================
begin;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '33333333-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'hr@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '44444444-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'accountant@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('cccccccc-0000-0000-0000-000000000001', 'Tenant C', 'rls-test-tenant-c', 'active', 'premium');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('33333333-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'school_admin', 'School Admin (preparer)', 'hr@test.example'),
  ('44444444-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 'accountant', 'Accountant (approver)', 'accountant@test.example');

-- ---------- Act as the school_admin: prepare a draft run ---------------------
-- Preparer must be a role that can both insert (runs_insert: school_admin/
-- hr_officer) and approve (runs_approve: accountant/school_admin) so the
-- self-approval attempt below actually reaches the trigger's SoD check
-- instead of being silently filtered out earlier by the runs_approve RLS
-- policy's role gate (which would also block hr_officer, but for the wrong
-- reason — that's role authorization, not segregation of duties). school_admin
-- is the only role in both sets.
set local role authenticated;
set local request.jwt.claim.sub = '33333333-0000-0000-0000-000000000001';

insert into public.payroll_runs (id, tenant_id, ec_year, ec_month, status, prepared_by)
values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 2018, 1, 'draft', '33333333-0000-0000-0000-000000000001');

-- SoD: the preparer trying to approve their own run must fail.
select throws_ok(
  $stmt$ update public.payroll_runs set status = 'approved', approved_by = '33333333-0000-0000-0000-000000000001'
         where id = 'dddddddd-0000-0000-0000-000000000001' $stmt$,
  'sod_preparer_cannot_approve',
  'Preparer cannot approve their own payroll run (C-2 regression)');

-- ---------- Switch to accountant: approve for real ---------------------------
set local request.jwt.claim.sub = '44444444-0000-0000-0000-000000000002';

-- Client attempts to spoof approved_by to someone else entirely — trigger
-- must override with the real actor (auth.uid()), never trust the client value.
update public.payroll_runs set status = 'approved', approved_by = '33333333-0000-0000-0000-000000000001'
where id = 'dddddddd-0000-0000-0000-000000000001';

select is(
  (select approved_by from public.payroll_runs where id = 'dddddddd-0000-0000-0000-000000000001'),
  '44444444-0000-0000-0000-000000000002'::uuid,
  'approved_by is always the real caller, never a client-supplied value');

select is(
  (select status from public.payroll_runs where id = 'dddddddd-0000-0000-0000-000000000001'),
  'approved', 'Run correctly transitioned to approved');

-- Illegal transition: approved cannot jump back to draft. The exact message
-- is dynamic (old/new status interpolated in), so this needs LIKE matching
-- (throws_like), not an exact-string match (throws_ok would compare the "%"
-- literally rather than as a wildcard).
select throws_like(
  $stmt$ update public.payroll_runs set status = 'draft'
         where id = 'dddddddd-0000-0000-0000-000000000001' $stmt$,
  'illegal_payroll_transition_%',
  'approved -> draft is rejected (illegal transition)');

-- Mark paid (legal transition, finance role).
update public.payroll_runs set status = 'paid' where id = 'dddddddd-0000-0000-0000-000000000001';

select is(
  (select status from public.payroll_runs where id = 'dddddddd-0000-0000-0000-000000000001'),
  'paid', 'Run correctly transitioned to paid');

-- C-3 regression: once paid, the run is fully immutable — even a "no-op"
-- update (touching an unrelated column) must be rejected.
select throws_ok(
  $stmt$ update public.payroll_runs set notes = 'late edit attempt'
         where id = 'dddddddd-0000-0000-0000-000000000001' $stmt$,
  'payroll_run_paid_immutable',
  'A paid run cannot be edited at all (C-3 regression)');

select throws_ok(
  $stmt$ update public.payroll_runs set status = 'draft'
         where id = 'dddddddd-0000-0000-0000-000000000001' $stmt$,
  'payroll_run_paid_immutable',
  'A paid run cannot be reopened to draft (C-3 regression)');

select * from finish();
rollback;
