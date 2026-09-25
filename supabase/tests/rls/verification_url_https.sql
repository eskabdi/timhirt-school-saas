-- ============================================================================
-- R6 WP-00 closeout (review FS-1): bank_payment_verifications.verification_url
-- accepts https only (20260925000001_r6_verification_url_https.sql).
-- ============================================================================
begin;
select plan(5);

insert into public.tenants (id, name, slug, status) values
  ('e7000000-0000-0000-0000-00000000000a', 'FS1 Tenant', 'fs1-tenant', 'active');
insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on, status) values
  ('e7001111-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-00000000000a', 2018, '2025-09-11', '2026-09-10', 'active');
insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('e7002222-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-00000000000a', 'e7001111-0000-0000-0000-000000000001', 'Grade 1', 'A');
insert into public.students (id, tenant_id, class_id, admission_no, first_name, last_name, date_of_birth, gender) values
  ('e7003333-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-00000000000a', 'e7002222-0000-0000-0000-000000000001', 'ADM-FS1-001', 'Abebe', 'Kebede', '2015-01-01', 'male');
insert into public.invoice_headers (id, tenant_id, student_id, due_date) values
  ('e7009999-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-00000000000a', 'e7003333-0000-0000-0000-000000000001', '2026-08-01');
insert into public.payments (id, tenant_id, invoice_id, amount, provider, provider_ref, status) values
  ('e7006666-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-00000000000a', 'e7009999-0000-0000-0000-000000000001', 100.00, 'bank', 'fs1-1', 'pending'),
  ('e7006666-0000-0000-0000-000000000002', 'e7000000-0000-0000-0000-00000000000a', 'e7009999-0000-0000-0000-000000000001', 100.00, 'bank', 'fs1-2', 'pending'),
  ('e7006666-0000-0000-0000-000000000003', 'e7000000-0000-0000-0000-00000000000a', 'e7009999-0000-0000-0000-000000000001', 100.00, 'bank', 'fs1-3', 'pending'),
  ('e7006666-0000-0000-0000-000000000004', 'e7000000-0000-0000-0000-00000000000a', 'e7009999-0000-0000-0000-000000000001', 100.00, 'bank', 'fs1-4', 'pending');

select lives_ok(
  $s$ insert into public.bank_payment_verifications (tenant_id, payment_id, payment_method, verification_url)
      values ('e7000000-0000-0000-0000-00000000000a', 'e7006666-0000-0000-0000-000000000001', 'cbe', 'https://apps.cbe.com.et:100/?id=FT1') $s$,
  'an https verification URL is accepted');
select throws_ok(
  $s$ insert into public.bank_payment_verifications (tenant_id, payment_id, payment_method, verification_url)
      values ('e7000000-0000-0000-0000-00000000000a', 'e7006666-0000-0000-0000-000000000002', 'cbe', 'javascript:alert(document.cookie)') $s$,
  '23514', null, 'a javascript: URL is rejected');
select throws_ok(
  $s$ insert into public.bank_payment_verifications (tenant_id, payment_id, payment_method, verification_url)
      values ('e7000000-0000-0000-0000-00000000000a', 'e7006666-0000-0000-0000-000000000003', 'cbe', 'data:text/html,<script>1</script>') $s$,
  '23514', null, 'a data: URL is rejected');
select throws_ok(
  $s$ insert into public.bank_payment_verifications (tenant_id, payment_id, payment_method, verification_url)
      values ('e7000000-0000-0000-0000-00000000000a', 'e7006666-0000-0000-0000-000000000004', 'cbe', 'http://apps.cbe.com.et/?id=FT1') $s$,
  '23514', null, 'a plain http URL is rejected');
select throws_ok(
  $s$ update public.bank_payment_verifications set verification_url = 'javascript:alert(1)'
      where payment_id = 'e7006666-0000-0000-0000-000000000001' $s$,
  '23514', null, 'an update cannot turn a stored URL into javascript:');

select * from finish();
rollback;
