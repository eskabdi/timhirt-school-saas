-- ============================================================================
-- R6 WP-09 round 1 review fixes (20260927000003_r6_maker_checker_hardening):
-- each reviewer probe that got around the controls, replayed as a hard
-- assertion. IDs in the descriptions are the review findings.
-- ============================================================================
begin;
select plan(59);

insert into auth.users (id, email) values
  ('0000000f-0000-0000-0000-0000000a0001', 'mh-admin1@example.test'),
  ('0000000f-0000-0000-0000-0000000a0002', 'mh-admin2@example.test'),
  ('0000000f-0000-0000-0000-0000000a0003', 'mh-acc1@example.test'),
  ('0000000f-0000-0000-0000-0000000a0004', 'mh-acc2@example.test'),
  ('0000000f-0000-0000-0000-0000000b0001', 'mh-adminb@example.test');
insert into public.tenants (id, name, slug, status, tier_key) values
  ('0000000f-0000-0000-0000-00000000000a', 'MH Tenant A', 'mh-a', 'active', 'premium'),
  ('0000000f-0000-0000-0000-00000000000b', 'MH Tenant B', 'mh-b', 'active', 'premium');
insert into public.users (id, tenant_id, role, full_name, email) values
  ('0000000f-0000-0000-0000-0000000a0001', '0000000f-0000-0000-0000-00000000000a', 'school_admin', 'MH Admin One', 'mh-admin1@example.test'),
  ('0000000f-0000-0000-0000-0000000a0002', '0000000f-0000-0000-0000-00000000000a', 'school_admin', 'MH Admin Two', 'mh-admin2@example.test'),
  ('0000000f-0000-0000-0000-0000000a0003', '0000000f-0000-0000-0000-00000000000a', 'accountant',   'MH Acc One',   'mh-acc1@example.test'),
  ('0000000f-0000-0000-0000-0000000a0004', '0000000f-0000-0000-0000-00000000000a', 'accountant',   'MH Acc Two',   'mh-acc2@example.test'),
  ('0000000f-0000-0000-0000-0000000b0001', '0000000f-0000-0000-0000-00000000000b', 'school_admin', 'MH Admin B',   'mh-adminb@example.test');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('0000000f-0000-0000-0001-000000000001', '0000000f-0000-0000-0000-00000000000a', 2018, '2025-09-11', '2026-09-10', 'active'),
  ('0000000f-0000-0000-0001-0000000000b1', '0000000f-0000-0000-0000-00000000000b', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.academic_terms (id, tenant_id, academic_year_id, name_i18n, term_no, starts_on, ends_on, results_published) values
  ('0000000f-0000-0000-0002-000000000001', '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0001-000000000001', '{"en":"Term 1"}', 1, '2025-09-11', '2026-01-10', false),
  ('0000000f-0000-0000-0002-000000000002', '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0001-000000000001', '{"en":"Term 2"}', 2, '2026-01-11', '2026-05-10', false);
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('0000000f-0000-0000-0003-000000000001', '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0001-000000000001', 'Grade 7', 'A'),
  ('0000000f-0000-0000-0003-0000000000b1', '0000000f-0000-0000-0000-00000000000b', '0000000f-0000-0000-0001-0000000000b1', 'Grade 7', 'A');
insert into public.subjects (id, tenant_id, code, name_i18n) values
  ('0000000f-0000-0000-0004-000000000001', '0000000f-0000-0000-0000-00000000000a', 'MATH-MH', '{"en":"Math"}');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, middle_name, last_name, date_of_birth, gender, status) values
  ('0000000f-0000-0000-0005-000000000001', '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0003-000000000001', 'ADM-MH-001', 'Abebe', 'Kebede', 'Tadesse', '2013-01-01', 'male', 'active'),
  ('0000000f-0000-0000-0005-000000000002', '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0003-000000000001', 'ADM-MH-002', 'Almaz', 'Tesfaye', 'Bekele', '2013-02-01', 'female', 'active'),
  ('0000000f-0000-0000-0005-0000000000b1', '0000000f-0000-0000-0000-00000000000b', '0000000f-0000-0000-0003-0000000000b1', 'ADM-MHB-001', 'Hana', 'Girma', 'Ayele', '2013-03-01', 'female', 'active');
insert into public.exams (id, tenant_id, academic_term_id, name_i18n, max_score, class_id) values
  ('0000000f-0000-0000-0006-000000000001', '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0002-000000000001', '{"en":"Midterm"}', 100, '0000000f-0000-0000-0003-000000000001'),
  ('0000000f-0000-0000-0006-000000000002', '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0002-000000000002', '{"en":"Quiz"}', 100, '0000000f-0000-0000-0003-000000000001');
set local request.jwt.claim.sub = '0000000f-0000-0000-0000-0000000a0001';
insert into public.grades (id, tenant_id, student_id, exam_id, subject_id, score, entered_by) values
  ('0000000f-0000-0000-0007-000000000001', '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0005-000000000001', '0000000f-0000-0000-0006-000000000001', '0000000f-0000-0000-0004-000000000001', 50, '0000000f-0000-0000-0000-0000000a0001'),
  ('0000000f-0000-0000-0007-000000000002', '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0005-000000000002', '0000000f-0000-0000-0006-000000000002', '0000000f-0000-0000-0004-000000000001', 40, '0000000f-0000-0000-0000-0000000a0001');
set local request.jwt.claim.sub = '';
update public.academic_terms set results_published = true where id = '0000000f-0000-0000-0002-000000000001';

insert into public.fee_structures (id, tenant_id, name_i18n, amount, billing_cycle) values
  ('0000000f-0000-0000-0008-000000000001', '0000000f-0000-0000-0000-00000000000a', '{"en":"Tuition"}', 800, 'monthly'),
  ('0000000f-0000-0000-0008-0000000000b1', '0000000f-0000-0000-0000-00000000000b', '{"en":"Tuition"}', 4000, 'monthly');
-- Headers 1-6 in A (one per scenario), 9 in B.
insert into public.invoice_headers (id, tenant_id, student_id, due_date)
select ('0000000f-0000-0000-0009-00000000000' || n)::uuid, '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0005-000000000001', '2026-08-01'
from generate_series(1, 6) n;
insert into public.invoice_headers (id, tenant_id, student_id, due_date) values
  ('0000000f-0000-0000-0009-000000000009', '0000000f-0000-0000-0000-00000000000b', '0000000f-0000-0000-0005-0000000000b1', '2026-08-01');
insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, due_date, invoice_header_id)
select ('0000000f-0000-0000-000a-00000000000' || n)::uuid, '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0005-000000000001',
       '0000000f-0000-0000-0008-000000000001', 800, '2026-08-01', ('0000000f-0000-0000-0009-00000000000' || n)::uuid
from generate_series(1, 6) n;
insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, due_date, invoice_header_id) values
  ('0000000f-0000-0000-000a-000000000009', '0000000f-0000-0000-0000-00000000000b', '0000000f-0000-0000-0005-0000000000b1',
   '0000000f-0000-0000-0008-0000000000b1', 4000, '2026-08-01', '0000000f-0000-0000-0009-000000000009');
insert into public.tenant_configs (tenant_id, settings) values ('0000000f-0000-0000-0000-00000000000a', '{}');

create function pg_temp.act_as(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  execute 'set local role ' || case when p is null then 'anon' else 'authenticated' end;
end $$;
grant execute on function pg_temp.act_as(uuid) to anon, authenticated;
create function pg_temp.req(p_entity uuid) returns public.approval_requests language sql as $$
  -- now() is fixed within the test transaction, so prefer the open request.
  select * from public.approval_requests where entity_id = p_entity order by (status = 'pending') desc, created_at desc limit 1
$$;
grant execute on function pg_temp.req(uuid) to authenticated;

-- ============================================== TI-01: tenant binding ======
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0003');
select throws_ok($$ insert into public.payments (tenant_id, invoice_id, amount, provider, status)
                    values ('0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0009-000000000009', 4000, 'cash', 'succeeded') $$,
  '23503', null, 'TI-01: a tenant-A payment against a tenant-B invoice header is refused');
select throws_ok($$ insert into public.fee_invoices (tenant_id, student_id, fee_structure_id, amount_due, due_date, invoice_header_id)
                    values ('0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0005-000000000001', '0000000f-0000-0000-0008-000000000001',
                            100, '2026-08-01', '0000000f-0000-0000-0009-000000000009') $$,
  '23503', null, 'TI-01: a tenant-A fee line cannot join a tenant-B invoice header');
reset role;
select is((select amount_paid from public.fee_invoices where id = '0000000f-0000-0000-000a-000000000009'), 0.00::numeric(12,2),
  'TI-01: the tenant-B invoice is untouched');

-- ============================== AZ-01/SEC-01/PAY-2: invoice money locked ===
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0003');
select throws_ok($$ update public.fee_invoices set amount_due = 0 where id = '0000000f-0000-0000-000a-000000000001' $$,
  '42501', 'invoice_amounts_locked', 'a client cannot write an invoice down to nothing');
select throws_ok($$ update public.fee_invoices set amount_paid = amount_due, status = 'paid' where id = '0000000f-0000-0000-000a-000000000001' $$,
  '42501', 'invoice_amounts_locked', 'a client cannot mark an invoice paid without a payment');
select throws_ok($$ update public.fee_invoices set invoice_header_id = '0000000f-0000-0000-0009-000000000002' where id = '0000000f-0000-0000-000a-000000000001' $$,
  '42501', 'invoice_amounts_locked', 'a client cannot move a fee line to another invoice');
select lives_ok($$ update public.fee_invoices set due_date = '2026-08-15' where id = '0000000f-0000-0000-000a-000000000001' $$,
  'a client can still change a line''s due date');
select throws_ok($$ insert into public.fee_invoices (tenant_id, student_id, fee_structure_id, amount_due, amount_paid, due_date, status, invoice_header_id)
                    values ('0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0005-000000000001', '0000000f-0000-0000-0008-000000000001',
                            100, 100, '2026-08-01', 'paid', '0000000f-0000-0000-0009-000000000001') $$,
  '42501', 'invoice_amounts_locked', 'a client cannot insert a fee line that is already paid');
reset role;

-- ========================== SEC-04/PAY-3: a void executes what was shown ===
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0003');
select lives_ok($$ select public.submit_approval('invoice_void', '0000000f-0000-0000-0009-000000000002', '{}', 'duplicate') $$,
  'the accountant asks to void an 800 ETB invoice');
select lives_ok($$ insert into public.fee_invoices (tenant_id, student_id, fee_structure_id, amount_due, due_date, invoice_header_id)
                   values ('0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0005-000000000001', '0000000f-0000-0000-0008-000000000001',
                           25000, '2026-08-01', '0000000f-0000-0000-0009-000000000002') $$,
  '(a 25000 line is then added to the same invoice)');
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0004');
select throws_ok($$ select public.decide_approval((pg_temp.req('0000000f-0000-0000-0009-000000000002')).id, 'approved',
                                                  (pg_temp.req('0000000f-0000-0000-0009-000000000002')).payload_hash) $$,
  '40001', 'entity_changed', 'SEC-04: approving "void 800" does not void an invoice that now owes 25800');
reset role;
select is((select count(*)::int from public.fee_invoices where invoice_header_id = '0000000f-0000-0000-0009-000000000002' and status = 'void'), 0,
  'SEC-04: nothing was voided');

-- ======================= PAY-1/SC-02: no payment beyond what is owed ======
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0003');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, status)
values ('0000000f-0000-0000-000b-000000000031', '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0009-000000000003', 800, 'cash', 'succeeded');
select throws_ok($$ insert into public.payments (tenant_id, invoice_id, amount, provider, status)
                    values ('0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0009-000000000003', 800, 'cash', 'succeeded') $$,
  '22023', 'amount_exceeds_balance', 'PAY-1: a second 800 on an 800 invoice with 800 already waiting is refused');
reset role;
-- The invoice is then paid another way (a trusted path), before the checker acts.
insert into public.payments (tenant_id, invoice_id, amount, provider, status)
values ('0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0009-000000000003', 800, 'bank', 'succeeded');
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0004');
select throws_ok($$ select public.decide_approval((pg_temp.req('0000000f-0000-0000-000b-000000000031')).id, 'approved',
                                                  (pg_temp.req('0000000f-0000-0000-000b-000000000031')).payload_hash) $$,
  '40001', 'entity_changed', 'SC-02: an approved payment is refused when the invoice no longer owes it');
reset role;
select is((select status::text from public.payments where id = '0000000f-0000-0000-000b-000000000031'), 'pending',
  'SC-02: ... and the payment stays pending, uncredited');

-- ==================================== SEC-05/PAY-4: threshold splitting ===
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0001');
select lives_ok($$ select public.set_approval_settings(true, 500) $$, 'a 500 ETB threshold');
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0003');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, status) values
  ('0000000f-0000-0000-000b-000000000041', '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0009-000000000004', 200, 'cash', 'succeeded');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, status) values
  ('0000000f-0000-0000-000b-000000000042', '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0009-000000000004', 200, 'cash', 'succeeded');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, status) values
  ('0000000f-0000-0000-000b-000000000043', '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0009-000000000004', 200, 'cash', 'succeeded');
reset role;
select is((select array_agg(status::text order by id) from public.payments where invoice_id = '0000000f-0000-0000-0009-000000000004'),
  array['succeeded', 'succeeded', 'pending'], 'SEC-05: the payment that takes the day''s total over the threshold waits for approval');
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0001');
select lives_ok($$ select public.set_approval_settings(true, 0) $$, '(threshold back to 0)');
reset role;

-- ============================================ AZ-03/PAY-8: settings audit ==
select is((select count(*)::int from public.audit_logs where table_name = 'tenant_configs' and action = 'APPROVAL_SETTINGS'
             and tenant_id = '0000000f-0000-0000-0000-00000000000a'), 2,
  'AZ-03: each approval-rules change is in the audit log');
select is((select actor_id from public.audit_logs where action = 'APPROVAL_SETTINGS' and tenant_id = '0000000f-0000-0000-0000-00000000000a'
           order by id desc limit 1), '0000000f-0000-0000-0000-0000000a0001'::uuid, 'AZ-03: ... with the admin who made it');
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0001');
select throws_ok($$ update public.tenant_configs set settings = settings || '{"approvals":{"actions":{"manual_payment_accept":false}}}'
                    where tenant_id = '0000000f-0000-0000-0000-00000000000a' $$,
  '42501', 'approval_settings_rpc_only', 'AZ-03: the approval rules cannot be switched off with a direct write');
select lives_ok($$ update public.tenant_configs set settings = settings || '{"branding":{"schoolName":"MH"}}'
                   where tenant_id = '0000000f-0000-0000-0000-00000000000a' $$,
  'other settings are still written directly');
reset role;

-- ================================== AZ-02/SEC-02/TI-02: published results ==
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0001');
select throws_ok($$ update public.exams set academic_term_id = '0000000f-0000-0000-0002-000000000002' where id = '0000000f-0000-0000-0006-000000000001' $$,
  '42501', 'results_published_locked', 'AZ-02: a published exam cannot be moved to an unpublished term');
select throws_ok($$ update public.exams set max_score = 50 where id = '0000000f-0000-0000-0006-000000000001' $$,
  '42501', 'results_published_locked', 'AZ-02: a published exam cannot be re-scaled');
select throws_ok($$ update public.exams set weight = 3 where id = '0000000f-0000-0000-0006-000000000001' $$,
  '42501', 'results_published_locked', 'AZ-02: a published exam''s weight cannot change');
select throws_ok($$ update public.exams set academic_term_id = '0000000f-0000-0000-0002-000000000001' where id = '0000000f-0000-0000-0006-000000000002' $$,
  '42501', 'results_published_locked', 'AZ-02: an exam cannot be moved into a published term');
select throws_ok($$ delete from public.exams where id = '0000000f-0000-0000-0006-000000000001' $$,
  '42501', 'results_published_locked', 'a published exam cannot be deleted');
select lives_ok($$ update public.exams set max_score = 80 where id = '0000000f-0000-0000-0006-000000000002' $$,
  'an unpublished exam can still be edited');
select lives_ok($$ update public.exams set name_i18n = '{"en":"Midterm exam"}' where id = '0000000f-0000-0000-0006-000000000001' $$,
  'a published exam can still be renamed');
select throws_ok($$ update public.grades set exam_id = '0000000f-0000-0000-0006-000000000001', score = 100 where id = '0000000f-0000-0000-0007-000000000002' $$,
  '42501', 'approval_required', 'SEC-02: a grade cannot be moved into a published exam');
select throws_ok($$ insert into public.grades (tenant_id, student_id, exam_id, subject_id, score, entered_by)
                    values ('0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0005-000000000002', '0000000f-0000-0000-0006-000000000001',
                            '0000000f-0000-0000-0004-000000000001', 100, '0000000f-0000-0000-0000-0000000a0001') $$,
  '42501', 'approval_required', 'AZ-05: a grade cannot be added directly to a published exam');
select lives_ok($$ update public.grades set score = 45 where id = '0000000f-0000-0000-0007-000000000002' $$,
  'a grade in an unpublished exam is still edited directly');

-- grade_entry_after_publish: the missing grade goes through a request.
select throws_ok($$ select public.submit_approval('grade_entry_after_publish', '0000000f-0000-0000-0006-000000000001',
                      '{"student_id":"0000000f-0000-0000-0005-000000000001","subject_id":"0000000f-0000-0000-0004-000000000001","score":90}', 'late') $$,
  '22023', 'grade_exists', 'a grade that already exists is corrected, not entered');
select throws_ok($$ select public.submit_approval('grade_entry_after_publish', '0000000f-0000-0000-0006-000000000001',
                      '{"student_id":"0000000f-0000-0000-0005-0000000000b1","subject_id":"0000000f-0000-0000-0004-000000000001","score":90}', 'late') $$,
  '42501', 'not_allowed', 'TI-06: a grade entry for another tenant''s student is refused');
select throws_ok($$ select public.submit_approval('grade_entry_after_publish', '0000000f-0000-0000-0006-000000000002',
                      '{"student_id":"0000000f-0000-0000-0005-000000000002","subject_id":"0000000f-0000-0000-0004-000000000001","score":90}', 'late') $$,
  '22023', 'approval_not_needed', 'an unpublished exam takes the grade directly');
select lives_ok($$ select public.submit_approval('grade_entry_after_publish', '0000000f-0000-0000-0006-000000000001',
                      '{"student_id":"0000000f-0000-0000-0005-000000000002","subject_id":"0000000f-0000-0000-0004-000000000001","score":88}', 'sick on exam day') $$,
  'a missing grade in a published exam is submitted as a request');
select throws_ok($$ select public.submit_approval('grade_entry_after_publish', '0000000f-0000-0000-0006-000000000001',
                      '{"student_id":"0000000f-0000-0000-0005-000000000002","subject_id":"0000000f-0000-0000-0004-000000000001","score":89}', 'again') $$,
  '22023', 'approval_already_pending', 'a second request for the same grade is refused');
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0002');
select is(public.decide_approval(
    (select id from public.approval_requests where action = 'grade_entry_after_publish' and status = 'pending'), 'approved',
    (select payload_hash from public.approval_requests where action = 'grade_entry_after_publish' and status = 'pending')),
  'executed', 'a second admin approves the entry');
reset role;
select is((select score from public.grades where student_id = '0000000f-0000-0000-0005-000000000002' and exam_id = '0000000f-0000-0000-0006-000000000001'),
  88.00::numeric(6,2), '... and the grade exists with the requested score');

-- ======================================= TI-04/SC-03: expiry, withdrawal ==
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0001');
select lives_ok($$ select public.submit_approval('student_transfer_out', '0000000f-0000-0000-0005-000000000001',
                     '{"transferred_to":"Other School","transferred_on":"2026-06-01"}', null) $$, 'a transfer is requested');
reset role;
set local session_replication_role = replica;   -- age it below the immutability trigger
update public.approval_requests set expires_at = now() - interval '1 minute' where entity_id = '0000000f-0000-0000-0005-000000000001';
set local session_replication_role = origin;
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0001');
select lives_ok($$ select public.submit_approval('student_transfer_out', '0000000f-0000-0000-0005-000000000001',
                     '{"transferred_to":"Other School","transferred_on":"2026-06-02"}', null) $$,
  'TI-04: an expired request no longer blocks a new one');
reset role;
select is((select array_agg(status order by status) from public.approval_requests where entity_id = '0000000f-0000-0000-0005-000000000001'),
  array['expired', 'pending'], 'TI-04: the stale request is recorded as expired');

select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0002');
select throws_ok($$ select public.cancel_approval((pg_temp.req('0000000f-0000-0000-0005-000000000001')).id) $$,
  '42501', 'not_allowed', 'SC-05: only the maker can withdraw a request');
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0001');
select is(public.cancel_approval((pg_temp.req('0000000f-0000-0000-0005-000000000001')).id), 'cancelled', 'SC-05: the maker withdraws it');
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0003');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, provider_ref, status)
values ('0000000f-0000-0000-000b-000000000051', '0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0009-000000000005', 300, 'cash', 'RCPT-77', 'succeeded');
select is(public.cancel_approval((pg_temp.req('0000000f-0000-0000-000b-000000000051')).id), 'cancelled', 'a mistyped payment is withdrawn');
reset role;
select is((select status::text from public.payments where id = '0000000f-0000-0000-000b-000000000051'), 'failed', '... and marked failed');
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0003');
select lives_ok($$ insert into public.payments (tenant_id, invoice_id, amount, provider, provider_ref, status)
                   values ('0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0009-000000000005', 350, 'cash', 'RCPT-77', 'succeeded') $$,
  'DB-7: the corrected payment reuses the receipt number');
reset role;

-- ================================================ AZ-04: module gating ======
insert into public.tenant_module_overrides (tenant_id, module_key, enabled) values ('0000000f-0000-0000-0000-00000000000a', 'fees', false);
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0004');
select is((select count(*)::int from public.approval_requests where action = 'manual_payment_accept'), 0,
  'AZ-04: with the fees module off, payment requests are not visible');
select throws_ok($$ select public.decide_approval('00000000-0000-0000-0000-000000000000'::uuid, 'approved', 'x') $$,
  '42501', 'not_allowed', '(deciding an unknown id is refused)');
reset role;
create temp table mh_pay as select id, payload_hash from public.approval_requests
  where entity_id = '0000000f-0000-0000-000b-000000000031';
grant select on mh_pay to authenticated;
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0004');
select throws_ok($$ select public.decide_approval((select id from mh_pay), 'rejected', (select payload_hash from mh_pay), 'no') $$,
  '42501', 'not_allowed', 'AZ-04: ... nor decidable');
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0003');
select throws_ok($$ select public.submit_approval('invoice_void', '0000000f-0000-0000-0009-000000000006', '{}', null) $$,
  '42501', 'not_allowed', 'AZ-04: ... nor submittable');
reset role;
delete from public.tenant_module_overrides where tenant_id = '0000000f-0000-0000-0000-00000000000a';

-- =========================================== SC-09/TI-05: invariants =====
select throws_ok($$ update public.approval_requests set payload = '{}' where entity_id = '0000000f-0000-0000-000b-000000000031' $$,
  '42501', 'approval_request_immutable', 'SC-09: a request''s payload never changes, even for the database owner');
select throws_ok($$ update public.approval_requests set status = 'pending'
                   where action = 'grade_entry_after_publish' and status = 'executed' $$,
  '42501', 'approval_invalid_transition', 'SC-09: an executed request never goes back to pending');
select throws_ok($$ insert into public.approval_requests (tenant_id, action, entity_table, entity_id, payload_hash, maker_id)
                   values (null, 'invoice_void', 'invoice_headers', gen_random_uuid(), 'x', '0000000f-0000-0000-0000-0000000a0003') $$,
  '23514', null, 'TI-05: only a platform action may have no tenant');

-- ============================== PAY-5/SC-01: a void invoice stays void ====
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0003');
select lives_ok($$ select public.submit_approval('invoice_void', '0000000f-0000-0000-0009-000000000006', '{}', 'duplicate') $$, 'void requested');
select pg_temp.act_as('0000000f-0000-0000-0000-0000000a0004');
select is(public.decide_approval((pg_temp.req('0000000f-0000-0000-0009-000000000006')).id, 'approved',
                                 (pg_temp.req('0000000f-0000-0000-0009-000000000006')).payload_hash), 'executed', 'void approved');
reset role;
insert into public.fee_documents (tenant_id, kind, invoice_id, doc_no, verify_code, amount, pdf_path)
values ('0000000f-0000-0000-0000-00000000000a', 'invoice', '0000000f-0000-0000-0009-000000000006', 'INV-MH-6', 'mhvoid0000000000000000aa', 800, 'x.pdf');
select is((select invoice_status from public.verify_document('mhvoid0000000000000000aa')), 'void', 'PAY-5: a voided invoice verifies as void');
insert into public.payments (tenant_id, invoice_id, amount, provider, provider_ref, status)
values ('0000000f-0000-0000-0000-00000000000a', '0000000f-0000-0000-0009-000000000001', 800, 'chapa', 'mh-tx-1', 'pending');
set local session_replication_role = replica;   -- point the pending gateway payment at the void invoice
update public.payments set invoice_id = '0000000f-0000-0000-0009-000000000006' where provider_ref = 'mh-tx-1';
set local session_replication_role = origin;
select is(public.settle_gateway_payment('mh-tx-1', 'chapa', 800), 'invoice_void', 'SC-01: gateway settlement does not credit a void invoice');
select is((select status::text from public.fee_invoices where id = '0000000f-0000-0000-000a-000000000006'), 'void', 'SC-01: ... which stays void');

select * from finish();
rollback;
