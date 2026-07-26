-- ============================================================================
-- student-photos: complete the object lifecycle.
--
-- 20260719000004 granted SELECT and INSERT and nothing else. Both writers
-- (students/api.ts and EnrollStudentModal) mint a fresh
-- <tenant>/<student>/<uuid>.png on every upload, so replacing a photo pointed
-- students.avatar_path at the new object and left the old one in the bucket —
-- unreferenced, unreachable through the UI, and impossible to remove because no
-- policy permitted a delete.
--
-- That is a data-retention problem before it is a housekeeping one: a student
-- photo is biometric-adjacent personal data, and Proclamation No. 1321/2024
-- expects it to stop existing when the controller no longer has a purpose for
-- it. "We kept every photo the registrar ever replaced, forever, and cannot
-- delete them" is not a defensible position.
--
-- Grants UPDATE (so a deterministic path can be overwritten in place) and
-- DELETE (so the previous object can be removed, and so a withdrawn student's
-- photo can be erased on request), both scoped exactly like the existing INSERT
-- policy: same tenant folder, same two roles.
-- ============================================================================

create policy "registrar replace student photos" on storage.objects for update to authenticated
using (bucket_id = 'student-photos'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'registrar'))
with check (bucket_id = 'student-photos'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'registrar'));

create policy "registrar delete student photos" on storage.objects for delete to authenticated
using (bucket_id = 'student-photos'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'registrar'));
