-- ============================================================================
-- R6 WP-09 (M-06): maker-checker, proven with real calls
-- (20260927000002_r6_maker_checker.sql). For every wired action:
--   * the direct client write is refused (or parked as pending);
--   * the maker can never approve their own request;
--   * a payload changed after submit, or a hash the checker was not shown,
--     is refused;
--   * approval executes exactly the stored payload, rejection does not;
--   * another tenant can neither see nor decide the request;
--   * platform minimums cannot be switched off by the tenant.
-- ============================================================================
begin;
select plan(65);

-- Tenant A: two school admins, two accountants, a student user. Tenant B: an admin.
insert into auth.users (id, email) values
  ('0000000e-0000-0000-0000-0000000a0001', 'mc-admin1@example.test'),
  ('0000000e-0000-0000-0000-0000000a0002', 'mc-admin2@example.test'),
  ('0000000e-0000-0000-0000-0000000a0003', 'mc-acc1@example.test'),
  ('0000000e-0000-0000-0000-0000000a0004', 'mc-acc2@example.test'),
  ('0000000e-0000-0000-0000-0000000a0005', 'mc-student@example.test'),
  ('0000000e-0000-0000-0000-0000000b0001', 'mc-adminb@example.test');
insert into public.tenants (id, name, slug, status, tier_key) values
  ('0000000e-0000-0000-0000-00000000000a', 'MC Tenant A', 'mc-a', 'active', 'premium'),
  ('0000000e-0000-0000-0000-00000000000b', 'MC Tenant B', 'mc-b', 'active', 'premium');
insert into public.users (id, tenant_id, role, full_name, email) values
  ('0000000e-0000-0000-0000-0000000a0001', '0000000e-0000-0000-0000-00000000000a', 'school_admin', 'MC Admin One', 'mc-admin1@example.test'),
  ('0000000e-0000-0000-0000-0000000a0002', '0000000e-0000-0000-0000-00000000000a', 'school_admin', 'MC Admin Two', 'mc-admin2@example.test'),
  ('0000000e-0000-0000-0000-0000000a0003', '0000000e-0000-0000-0000-00000000000a', 'accountant',   'MC Acc One',   'mc-acc1@example.test'),
  ('0000000e-0000-0000-0000-0000000a0004', '0000000e-0000-0000-0000-00000000000a', 'accountant',   'MC Acc Two',   'mc-acc2@example.test'),
  ('0000000e-0000-0000-0000-0000000a0005', '0000000e-0000-0000-0000-00000000000a', 'student',      'MC Student',   'mc-student@example.test'),
  ('0000000e-0000-0000-0000-0000000b0001', '0000000e-0000-0000-0000-00000000000b', 'school_admin', 'MC Admin B',   'mc-adminb@example.test');

insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('0000000e-0000-0000-0001-000000000001', '0000000e-0000-0000-0000-00000000000a', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.academic_terms (id, tenant_id, academic_year_id, name_i18n, term_no, starts_on, ends_on, results_published) values
  ('0000000e-0000-0000-0002-000000000001', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0001-000000000001', '{"en":"Term 1"}', 1, '2025-09-11', '2026-01-10', false);
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('0000000e-0000-0000-0003-000000000001', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0001-000000000001', 'Grade 7', 'A');
insert into public.subjects (id, tenant_id, code, name_i18n) values
  ('0000000e-0000-0000-0004-000000000001', '0000000e-0000-0000-0000-00000000000a', 'MATH-MC', '{"en":"Math"}');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender, status, user_id) values
  ('0000000e-0000-0000-0005-000000000001', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0003-000000000001', 'ADM-MC-001', 'Abebe', 'Kebede', '2013-01-01', 'male', 'active', '0000000e-0000-0000-0000-0000000a0005'),
  ('0000000e-0000-0000-0005-000000000002', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0003-000000000001', 'ADM-MC-002', 'Almaz', 'Tesfaye', '2013-02-01', 'female', 'active', null);
insert into public.exams (id, tenant_id, academic_term_id, name_i18n, max_score) values
  ('0000000e-0000-0000-0006-000000000001', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0002-000000000001', '{"en":"Midterm"}', 100);
set local request.jwt.claim.sub = '0000000e-0000-0000-0000-0000000a0001';
insert into public.grades (id, tenant_id, student_id, exam_id, subject_id, score, entered_by) values
  ('0000000e-0000-0000-0007-000000000001', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0005-000000000001', '0000000e-0000-0000-0006-000000000001', '0000000e-0000-0000-0004-000000000001', 70, '0000000e-0000-0000-0000-0000000a0001');
set local request.jwt.claim.sub = '';

insert into public.fee_structures (id, tenant_id, name_i18n, amount, billing_cycle) values
  ('0000000e-0000-0000-0008-000000000001', '0000000e-0000-0000-0000-00000000000a', '{"en":"Tuition"}', 5000, 'monthly');
insert into public.invoice_headers (id, tenant_id, student_id, due_date) values
  ('0000000e-0000-0000-0009-000000000001', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0005-000000000001', '2026-08-01'),
  ('0000000e-0000-0000-0009-000000000002', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0005-000000000001', '2026-08-02');
insert into public.fee_invoices (id, tenant_id, student_id, fee_structure_id, amount_due, amount_paid, due_date, status, invoice_header_id) values
  ('0000000e-0000-0000-000a-000000000001', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0005-000000000001', '0000000e-0000-0000-0008-000000000001', 5000, 0, '2026-08-01', 'pending', '0000000e-0000-0000-0009-000000000001'),
  ('0000000e-0000-0000-000a-000000000002', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0005-000000000001', '0000000e-0000-0000-0008-000000000001', 800, 0, '2026-08-02', 'pending', '0000000e-0000-0000-0009-000000000002');
-- Another settings key that the approval settings RPC must leave alone.
insert into public.tenant_configs (tenant_id, settings) values
  ('0000000e-0000-0000-0000-00000000000a', '{"branding":{"schoolName":"MC"}}');

create function pg_temp.act_as(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  execute 'set local role ' || case when p is null then 'anon' else 'authenticated' end;
end $$;
-- New functions start closed since R6 WP-02; the switcher is called again
-- while already acting as a user.
grant execute on function pg_temp.act_as(uuid) to anon, authenticated;

-- =============================================== manual_payment_accept ======
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0003');   -- accountant 1 (maker)
insert into public.payments (id, tenant_id, invoice_id, amount, provider, provider_ref, status)
values ('0000000e-0000-0000-000b-000000000001', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0009-000000000001', 1200, 'cash', 'mc-cash-1', 'succeeded');
reset role;
select is((select status::text from public.payments where id = '0000000e-0000-0000-000b-000000000001'), 'pending',
  'a client cash payment is parked as pending, whatever status it asked for');
select is((select amount_paid from public.fee_invoices where id = '0000000e-0000-0000-000a-000000000001'), 0.00::numeric(12,2),
  '... and does not credit the invoice yet');
select is((select (maker_id, status) from public.approval_requests where entity_id = '0000000e-0000-0000-000b-000000000001'),
  ('0000000e-0000-0000-0000-0000000a0003'::uuid, 'pending'::text), '... and files a pending request with the recorder as maker');

select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0003');
select throws_ok($$ select public.decide_approval((select id from public.approval_requests where entity_id = '0000000e-0000-0000-000b-000000000001'), 'approved',
                   (select payload_hash from public.approval_requests where entity_id = '0000000e-0000-0000-000b-000000000001')) $$,
  '42501', 'maker_cannot_decide', 'the maker cannot approve their own payment');
reset role;
select is((select status from public.approval_requests where entity_id = '0000000e-0000-0000-000b-000000000001'), 'pending', '... and it stays pending');

select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0005');   -- student
select is((select count(*)::int from public.approval_requests), 0, 'a student sees no approval requests');
select throws_ok($$ select public.decide_approval('00000000-0000-0000-0000-000000000000', 'approved', 'x') $$, '42501', null,
  'a student cannot decide');
select pg_temp.act_as('0000000e-0000-0000-0000-0000000b0001');   -- tenant B admin
select is((select count(*)::int from public.approval_requests where tenant_id = '0000000e-0000-0000-0000-00000000000a'), 0,
  'another tenant''s admin sees none of tenant A''s requests');
reset role;
create temp table mc_ids as select id, payload_hash from public.approval_requests where entity_id = '0000000e-0000-0000-000b-000000000001';
grant select on mc_ids to authenticated, anon;
select pg_temp.act_as('0000000e-0000-0000-0000-0000000b0001');
select throws_ok($$ select public.decide_approval((select id from mc_ids), 'approved', (select payload_hash from mc_ids)) $$,
  '42501', 'not_allowed', 'another tenant''s admin cannot decide it, even knowing the id and hash');

select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0004');   -- accountant 2 (checker)
select is((select count(*)::int from public.approval_requests where entity_id = '0000000e-0000-0000-000b-000000000001'), 1,
  'a second accountant (invoices:approve) sees the request');
select throws_ok($$ select public.decide_approval((select id from mc_ids), 'approved', repeat('0', 64)) $$,
  '22023', 'payload_mismatch', 'approving with a hash other than the stored one is refused');

reset role;
update public.approval_requests set payload = jsonb_set(payload, '{amount}', '12000') where id = (select id from mc_ids);
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0004');
select throws_ok($$ select public.decide_approval((select id from mc_ids), 'approved', (select payload_hash from mc_ids)) $$,
  '22023', 'payload_tampered', 'a payload changed after submit is refused');
reset role;
update public.approval_requests set payload = jsonb_set(payload, '{amount}', '1200.00') where id = (select id from mc_ids);
select is(public.approval_payload_hash((select payload from public.approval_requests where id = (select id from mc_ids))),
  (select payload_hash from mc_ids), '(the payload is restored for the next step)');

select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0004');
select is(public.decide_approval((select id from mc_ids), 'approved', (select payload_hash from mc_ids)), 'executed',
  'the second accountant approves');
reset role;
select is((select status::text from public.payments where id = '0000000e-0000-0000-000b-000000000001'), 'succeeded', '... the payment succeeds');
select is((select (amount_paid, status::text) from public.fee_invoices where id = '0000000e-0000-0000-000a-000000000001'),
  (1200.00::numeric(12,2), 'partial'::text), '... and only now credits the invoice');
select is((select (status, checker_id) from public.approval_requests where id = (select id from mc_ids)),
  ('executed'::text, '0000000e-0000-0000-0000-0000000a0004'::uuid), '... the request is executed with the checker recorded');
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0004');
select throws_ok($$ select public.decide_approval((select id from mc_ids), 'approved', (select payload_hash from mc_ids)) $$,
  '22023', 'approval_not_pending', 'a decided request cannot be decided again');

-- Rejection.
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0003');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, status)
values ('0000000e-0000-0000-000b-000000000002', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0009-000000000001', 300, 'bank', 'succeeded');
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0001');
select throws_ok($$ select public.decide_approval((select id from public.approval_requests where entity_id = '0000000e-0000-0000-000b-000000000002'), 'rejected',
                   (select payload_hash from public.approval_requests where entity_id = '0000000e-0000-0000-000b-000000000002')) $$,
  '22023', 'reason_required', 'a rejection needs a reason');
select is(public.decide_approval((select id from public.approval_requests where entity_id = '0000000e-0000-0000-000b-000000000002'), 'rejected',
            (select payload_hash from public.approval_requests where entity_id = '0000000e-0000-0000-000b-000000000002'), 'No slip attached'),
  'rejected', 'a school admin rejects the bank payment with a reason');
reset role;
select is((select status::text from public.payments where id = '0000000e-0000-0000-000b-000000000002'), 'failed', '... the payment is marked failed');
select is((select amount_paid from public.fee_invoices where id = '0000000e-0000-0000-000a-000000000001'), 1200.00::numeric(12,2),
  '... and the invoice is not credited');

-- Thresholds and the tenant switch.
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0003');
select throws_ok($$ select public.set_approval_settings(true, 1000) $$, '42501', 'not_allowed', 'an accountant cannot change the approval rules');
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0001');
select lives_ok($$ select public.set_approval_settings(true, 1000) $$, 'a school admin sets a 1000 ETB threshold');
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0003');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, status)
values ('0000000e-0000-0000-000b-000000000003', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0009-000000000001', 400, 'cash', 'succeeded'),
       ('0000000e-0000-0000-000b-000000000004', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0009-000000000001', 1500, 'cash', 'succeeded');
reset role;
select is((select array_agg(status::text order by amount) from public.payments where id in ('0000000e-0000-0000-000b-000000000003', '0000000e-0000-0000-000b-000000000004')),
  array['succeeded', 'pending'], 'at or below the threshold a payment goes straight through; above it, it waits');
select is((select settings -> 'branding' from public.tenant_configs where tenant_id = '0000000e-0000-0000-0000-00000000000a'),
  '{"schoolName":"MC"}'::jsonb, 'set_approval_settings leaves every other settings key untouched');
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0001');
select lives_ok($$ select public.set_approval_settings(false, 0) $$, 'a school admin switches manual-payment approval off');
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0003');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, status)
values ('0000000e-0000-0000-000b-000000000005', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0009-000000000001', 100, 'cash', 'succeeded');
reset role;
select is((select status::text from public.payments where id = '0000000e-0000-0000-000b-000000000005'), 'succeeded',
  '... then payments go straight through');

-- ======================================================== invoice_void ======
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0003');
select throws_ok($$ update public.fee_invoices set status = 'void' where id = '0000000e-0000-0000-000a-000000000002' $$,
  '42501', 'approval_required', 'a client cannot void an invoice line directly');
select throws_ok($$ delete from public.fee_invoices where id = '0000000e-0000-0000-000a-000000000002' $$,
  '42501', null, 'a client cannot delete an invoice line');
select throws_ok($$ delete from public.invoice_headers where id = '0000000e-0000-0000-0009-000000000002' $$,
  '42501', null, 'a client cannot delete an invoice header');
select throws_ok($$ select public.submit_approval('invoice_void', '0000000e-0000-0000-0009-000000000001', '{}', 'duplicate') $$,
  '22023', 'invoice_has_payments', 'an invoice with money on it cannot be voided');
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0005');
select throws_ok($$ select public.submit_approval('invoice_void', '0000000e-0000-0000-0009-000000000002', '{}', 'x') $$,
  '42501', 'not_allowed', 'a student cannot request a void');
select pg_temp.act_as('0000000e-0000-0000-0000-0000000b0001');
select throws_ok($$ select public.submit_approval('invoice_void', '0000000e-0000-0000-0009-000000000002', '{}', 'x') $$,
  '42501', 'not_allowed', 'another tenant''s admin cannot request a void of tenant A''s invoice');
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0003');
select isnt(public.submit_approval('invoice_void', '0000000e-0000-0000-0009-000000000002', '{}', 'Issued twice'), null,
  'an accountant requests a void of the unpaid invoice');
select throws_ok($$ select public.submit_approval('invoice_void', '0000000e-0000-0000-0009-000000000002', '{}', 'again') $$,
  '22023', 'approval_already_pending', 'a second request for the same invoice is refused while one is pending');
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0004');
select is(public.decide_approval((select id from public.approval_requests where action = 'invoice_void'), 'approved',
            (select payload_hash from public.approval_requests where action = 'invoice_void')), 'executed',
  'the second accountant approves the void');
reset role;
select is((select status::text from public.invoice_summary where id = '0000000e-0000-0000-0009-000000000002'), 'void',
  '... and the invoice is void');
select throws_ok($$ insert into public.payments (tenant_id, invoice_id, amount, provider, status)
                   values ('0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0009-000000000002', 10, 'cash', 'succeeded') $$,
  '22023', 'invoice_void', 'no payment can be taken against a void invoice (trusted paths included)');
update public.tenant_configs set settings = settings || '{"approvals":{"actions":{"invoice_void":false,"grade_edit_after_publish":false}}}'
 where tenant_id = '0000000e-0000-0000-0000-00000000000a';
select ok(public.approval_required('0000000e-0000-0000-0000-00000000000a', 'invoice_void')
          and public.approval_required('0000000e-0000-0000-0000-00000000000a', 'grade_edit_after_publish'),
  'a tenant cannot switch off a platform-minimum action');

-- ============================================ grade_edit_after_publish ======
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0001');
select lives_ok($$ update public.grades set score = 72 where id = '0000000e-0000-0000-0007-000000000001' $$,
  'before publication a grade is edited directly');
reset role;
update public.academic_terms set results_published = true where id = '0000000e-0000-0000-0002-000000000001';
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0001');
select throws_ok($$ update public.grades set score = 95 where id = '0000000e-0000-0000-0007-000000000001' $$,
  '42501', 'approval_required', 'after publication a direct grade edit is refused');
select throws_ok($$ insert into public.grades (tenant_id, student_id, exam_id, subject_id, score)
                   values ('0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0005-000000000001', '0000000e-0000-0000-0006-000000000001', '0000000e-0000-0000-0004-000000000001', 95)
                   on conflict (tenant_id, student_id, exam_id, subject_id) do update set score = excluded.score $$,
  '42501', 'approval_required', '... and so is the gradebook''s upsert path');
select throws_ok($$ update public.academic_terms set results_published = false where id = '0000000e-0000-0000-0002-000000000001' $$,
  '42501', 'results_unpublish_blocked', 'a school admin cannot unpublish results to reopen direct edits');
select throws_ok($$ select public.submit_approval('grade_edit_after_publish', '0000000e-0000-0000-0007-000000000001', '{"score": 101}') $$,
  '22023', 'invalid_score', 'a proposed score above the exam maximum is refused');
select isnt(public.submit_approval('grade_edit_after_publish', '0000000e-0000-0000-0007-000000000001', '{"score": 90}', 'Marking error on Q4'), null,
  'admin one requests 72 -> 90');
select is((select payload from public.approval_requests where action = 'grade_edit_after_publish' and status = 'pending'),
  '{"to": {"score": 90, "remark": null}, "from": {"score": 72.00, "remark": null}}'::jsonb,
  'the stored payload is built by the server from the current grade, not taken from the client');
select throws_ok($$ select public.decide_approval((select id from public.approval_requests where action = 'grade_edit_after_publish' and status = 'pending'), 'approved',
                   (select payload_hash from public.approval_requests where action = 'grade_edit_after_publish' and status = 'pending')) $$,
  '42501', 'maker_cannot_decide', 'admin one cannot approve their own grade change');
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0002');
select is(public.decide_approval((select id from public.approval_requests where action = 'grade_edit_after_publish' and status = 'pending'), 'approved',
            (select payload_hash from public.approval_requests where action = 'grade_edit_after_publish' and status = 'pending')), 'executed',
  'admin two approves');
reset role;
select is((select score from public.grades where id = '0000000e-0000-0000-0007-000000000001'), 90.00::numeric(6,2), '... and the grade is now 90');

-- The grade moved between submit and approval: nothing is applied.
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0001');
select lives_ok($$ select public.submit_approval('grade_edit_after_publish', '0000000e-0000-0000-0007-000000000001', '{"score": 91}') $$,
  'admin one requests 90 -> 91');
reset role;
update public.grades set score = 60 where id = '0000000e-0000-0000-0007-000000000001';
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0002');
select throws_ok($$ select public.decide_approval((select id from public.approval_requests where action = 'grade_edit_after_publish' and status = 'pending'), 'approved',
                   (select payload_hash from public.approval_requests where action = 'grade_edit_after_publish' and status = 'pending')) $$,
  '40001', 'entity_changed', 'approving a change whose starting value no longer holds is refused');
reset role;
select is((select score from public.grades where id = '0000000e-0000-0000-0007-000000000001'), 60.00::numeric(6,2), '... the grade is untouched');

-- ================================================ student_transfer_out ======
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0001');
select throws_ok($$ select public.submit_approval('student_transfer_out', '0000000e-0000-0000-0005-000000000002', '{"transferred_to": "Nearby School"}') $$,
  '22023', 'invalid_transferred_on', 'a transfer request needs a date');
select lives_ok($$ select public.submit_approval('student_transfer_out', '0000000e-0000-0000-0005-000000000002',
                   '{"transferred_to": "Nearby School", "transferred_on": "2026-03-01", "transferred_reason": "Family moved"}') $$,
  'admin one requests a transfer out');
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0002');
select is(public.decide_approval((select id from public.approval_requests where action = 'student_transfer_out'), 'approved',
            (select payload_hash from public.approval_requests where action = 'student_transfer_out')), 'executed', 'admin two approves');
reset role;
select is((select (status::text, transferred_to, transferred_on) from public.students where id = '0000000e-0000-0000-0005-000000000002'),
  ('transferred'::text, 'Nearby School'::text, '2026-03-01'::date), '... and the student is transferred with the approved details');

-- ============================================== expiry and raw access ======
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0001');
select lives_ok($$ select public.set_approval_settings(true, 0) $$, '(approval switched back on)');
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0003');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, status)
values ('0000000e-0000-0000-000b-000000000006', '0000000e-0000-0000-0000-00000000000a', '0000000e-0000-0000-0009-000000000001', 50, 'cash', 'succeeded');
reset role;
update public.approval_requests set expires_at = now() - interval '1 minute' where entity_id = '0000000e-0000-0000-000b-000000000006';
select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0004');
select throws_ok($$ select public.decide_approval((select id from public.approval_requests where entity_id = '0000000e-0000-0000-000b-000000000006'), 'approved',
                   (select payload_hash from public.approval_requests where entity_id = '0000000e-0000-0000-000b-000000000006')) $$,
  '22023', 'approval_expired', 'an expired request cannot be approved');
reset role;
set local role service_role;
select ok(public.expire_approvals() >= 1, 'the expiry sweep marks it expired');
reset role;
select is((select status::text from public.payments where id = '0000000e-0000-0000-000b-000000000006'), 'failed', '... and fails the parked payment');

select pg_temp.act_as('0000000e-0000-0000-0000-0000000a0001');
select throws_ok($$ insert into public.approval_requests (tenant_id, action, entity_table, entity_id, payload_hash, maker_id, status, checker_id, decided_at)
                   values ('0000000e-0000-0000-0000-00000000000a', 'invoice_void', 'invoice_headers', gen_random_uuid(), 'x',
                           '0000000e-0000-0000-0000-0000000a0003', 'approved', '0000000e-0000-0000-0000-0000000a0001', now()) $$,
  '42501', null, 'no client can write an approval request directly');
select throws_ok($$ update public.approval_requests set status = 'approved' $$, '42501', null, 'no client can update an approval request directly');
select throws_ok($$ select public.execute_approval((select id from public.approval_requests limit 1)) $$, '42501', null,
  'execute_approval is service_role only');
select pg_temp.act_as(null);
select throws_ok($$ select public.submit_approval('invoice_void', gen_random_uuid()) $$, '42501', null, 'anon cannot submit');
reset role;

select * from finish();
rollback;
