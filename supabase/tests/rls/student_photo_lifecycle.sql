-- ============================================================================
-- student-photos object lifecycle (migration 20260726000004).
--
-- The bucket shipped with SELECT and INSERT only, so a replaced photo could
-- never be removed — a retention problem, since a student photo is personal
-- data the school stops having a purpose for. UPDATE and DELETE were added and
-- must be scoped exactly like the INSERT policy: same tenant folder, and only
-- school_admin / registrar.
--
-- Storage policies had no coverage before this suite. They are the boundary
-- between one school's student photographs and another's.
-- ============================================================================
begin;
select plan(8);

insert into public.tenants (id, name, slug, status) values
  ('aaaa0000-0000-0000-0000-00000000000a', 'Photo Tenant A', 'photo-tenant-a', 'active'),
  ('bbbb0000-0000-0000-0000-00000000000b', 'Photo Tenant B', 'photo-tenant-b', 'active');

insert into auth.users (id) values
  ('c0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000003');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-00000000000a', 'registrar', 'Registrar A', 'reg-a@test.example'),
  ('c0000000-0000-0000-0000-000000000002', 'bbbb0000-0000-0000-0000-00000000000b', 'registrar', 'Registrar B', 'reg-b@test.example'),
  ('c0000000-0000-0000-0000-000000000003', 'aaaa0000-0000-0000-0000-00000000000a', 'teacher',   'Teacher A',   'tea-a@test.example');

insert into storage.buckets (id, name) values ('student-photos', 'student-photos')
on conflict (id) do nothing;

insert into storage.objects (bucket_id, name) values
  ('student-photos', 'aaaa0000-0000-0000-0000-00000000000a/student-1/photo.png');

set local role authenticated;

-- ---------- Tenant A's registrar owns the object ----------------------------
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from storage.objects
    where name = 'aaaa0000-0000-0000-0000-00000000000a/student-1/photo.png'),
  1, 'Registrar sees their own tenant''s photo');

select lives_ok($$
  update storage.objects set metadata = '{"replaced":true}'
   where name = 'aaaa0000-0000-0000-0000-00000000000a/student-1/photo.png'
$$, 'Registrar can replace a photo in their own tenant');

select is(
  (select metadata->>'replaced' from storage.objects
    where name = 'aaaa0000-0000-0000-0000-00000000000a/student-1/photo.png'),
  'true', 'The replacement actually landed');

-- ---------- Tenant B's registrar must not reach it --------------------------
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from storage.objects
    where name = 'aaaa0000-0000-0000-0000-00000000000a/student-1/photo.png'),
  0, 'Another tenant''s registrar cannot even see the photo');

with attempted as (
  update storage.objects set metadata = '{"hijacked":true}'
   where name = 'aaaa0000-0000-0000-0000-00000000000a/student-1/photo.png'
  returning 1)
select is((select count(*)::int from attempted), 0,
  'Another tenant''s registrar updates zero rows');

with attempted as (
  delete from storage.objects
   where name = 'aaaa0000-0000-0000-0000-00000000000a/student-1/photo.png'
  returning 1)
select is((select count(*)::int from attempted), 0,
  'Another tenant''s registrar deletes zero rows');

-- ---------- A teacher reads photos but must not destroy them ----------------
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-000000000003';

with attempted as (
  delete from storage.objects
   where name = 'aaaa0000-0000-0000-0000-00000000000a/student-1/photo.png'
  returning 1)
select is((select count(*)::int from attempted), 0,
  'A teacher in the same tenant cannot delete a photo');

-- ---------- Deletion is possible for the right role -------------------------
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-000000000001';

with attempted as (
  delete from storage.objects
   where name = 'aaaa0000-0000-0000-0000-00000000000a/student-1/photo.png'
  returning 1)
select is((select count(*)::int from attempted), 1,
  'Registrar can delete their own tenant''s photo — retention is actionable');

select * from finish();
rollback;
