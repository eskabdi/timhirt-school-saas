-- ============================================================================
-- possible_duplicate_of (20260830000001_duplicate_applicant_detection.sql).
-- Proves: an application can reference an earlier one as a possible
-- duplicate, and deleting the earlier one clears the reference (sets null)
-- rather than cascading the delete onto the newer, real application --
-- this is advisory metadata, not a relationship the newer row's existence
-- should depend on.
-- ============================================================================
begin;
select plan(3);

insert into public.tenants (id, name, slug, status, tier_key) values
  ('99941000-0000-0000-0000-000000000001', 'DUP Tenant', 'rls-test-dup', 'active', 'premium');

insert into public.admission_applications (id, tenant_id, applicant_name, date_of_birth, guardian_name, guardian_phone) values
  ('99942000-0000-0000-0000-000000000001', '99941000-0000-0000-0000-000000000001', 'First Application', '2016-01-01', 'Guardian One', '+251911000001');

select lives_ok(
  $$ insert into public.admission_applications (id, tenant_id, applicant_name, date_of_birth, guardian_name, guardian_phone, possible_duplicate_of)
     values ('99942000-0000-0000-0000-000000000002', '99941000-0000-0000-0000-000000000001', 'First Application', '2016-01-01', 'Guardian One', '+251911000001', '99942000-0000-0000-0000-000000000001') $$,
  'a new application can flag itself as a possible duplicate of an earlier one'
);

select is(
  (select possible_duplicate_of from public.admission_applications where id = '99942000-0000-0000-0000-000000000002'),
  '99942000-0000-0000-0000-000000000001'::uuid, 'the flag points at the correct earlier application');

delete from public.admission_applications where id = '99942000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.admission_applications where id = '99942000-0000-0000-0000-000000000002'),
  1, 'deleting the earlier (referenced) application does NOT cascade-delete the newer one -- on delete set null, not cascade');

select * from finish();
rollback;
