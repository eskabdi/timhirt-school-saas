-- ============================================================================
-- id_cards / id-cards bucket access for hr_officer — regression for C3.
--
-- idcards_select/idcards_write and both storage read policies on the
-- id-cards bucket admitted only school_admin/registrar before this
-- migration. hr_officer — the role issue-staff-id is actually gated to,
-- and the only non-school_admin role that can reach the staff module at
-- all — could not see or write a single row of its own output. Same shape
-- as the documents/avatars bucket gaps fixed in the registration commit.
-- ============================================================================
begin;
select plan(4);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'fc000001-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'idcard-hr-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'fc000002-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'idcard-hr-b@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('fa000000-0000-0000-0000-00000000000a', 'ID Card Tenant A', 'idcard-tenant-a', 'active'),
  ('fb000000-0000-0000-0000-00000000000b', 'ID Card Tenant B', 'idcard-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('fc000001-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-00000000000a', 'hr_officer', 'HR Officer A', 'idcard-hr-a@test.example'),
  ('fc000002-0000-0000-0000-000000000002', 'fb000000-0000-0000-0000-00000000000b', 'hr_officer', 'HR Officer B', 'idcard-hr-b@test.example');

insert into public.employees (id, tenant_id, employee_no, employee_type, full_name, hire_date) values
  ('fd000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-00000000000a', 'EMP-CARD-A', 'admin_staff', 'Card Subject A', current_date);

set local role authenticated;
set local request.jwt.claim.sub = 'fc000001-0000-0000-0000-000000000001';

-- hr_officer can create the batch + card their own issue-staff-id would write
-- (the Edge Function itself uses service_role and bypasses RLS entirely, but
-- idcards_write also gates any direct table access, so the fix has to cover
-- both — RLS is the authorization layer per §6.2, not just the function).
insert into public.id_card_batches (id, tenant_id, batch_type, status, created_by)
values ('fe000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-00000000000a', 'staff_id', 'done', 'fc000001-0000-0000-0000-000000000001');

select lives_ok(
  $stmt$ insert into public.id_cards (tenant_id, batch_id, subject_type, subject_id, verify_code)
         values ('fa000000-0000-0000-0000-00000000000a', 'fe000000-0000-0000-0000-00000000000a', 'staff',
                  'fd000000-0000-0000-0000-00000000000a', 'verify-code-hr-officer-test-a') $stmt$,
  'hr_officer can insert an id_cards row for their own tenant (idcards_write)');

select is(
  (select count(*) from public.id_cards where tenant_id = 'fa000000-0000-0000-0000-00000000000a')::int,
  1,
  'hr_officer can select the id_cards row they just wrote (idcards_select)');

-- ---------- Cross-tenant: hr_officer B must not see tenant A's card ----------
set local request.jwt.claim.sub = 'fc000002-0000-0000-0000-000000000002';

select is(
  (select count(*) from public.id_cards where tenant_id = 'fa000000-0000-0000-0000-00000000000a')::int,
  0,
  'hr_officer in a different tenant cannot see another tenant''s id_cards rows');

select throws_ok(
  $stmt$ insert into public.id_card_batches (tenant_id, batch_type, status, created_by)
         values ('fa000000-0000-0000-0000-00000000000a', 'staff_id', 'done', 'fc000002-0000-0000-0000-000000000002') $stmt$,
  '42501',
  null,
  'hr_officer cannot create a batch in a tenant that is not their own');

select * from finish();
rollback;
