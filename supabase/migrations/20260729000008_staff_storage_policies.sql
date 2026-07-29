-- ============================================================================
-- avatars bucket: hr_officer parity, and the update/delete policies staff
-- photo replacement needs.
--
-- Same trap as 20260729000007 already fixed on the `documents` bucket:
-- "admin write avatars" admits only school_admin and registrar, so an HR
-- officer running staff registration could fill in every field and fail on
-- the photo upload. And `avatars` has never had an UPDATE or DELETE policy —
-- fine for a write-once student avatar, but the registration stepper's photo
-- picker uploads with upsert:true, which Supabase Storage treats as an
-- insert-or-update: replacing an already-uploaded photo needs UPDATE too, or
-- the second attempt in the same session fails where the first succeeded.
-- ============================================================================

drop policy if exists "admin write avatars" on storage.objects;
create policy "admin write avatars" on storage.objects for insert to authenticated
with check (bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar','hr_officer'));

create policy "admin update avatars" on storage.objects for update to authenticated
using (bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar','hr_officer'));

create policy "admin delete avatars" on storage.objects for delete to authenticated
using (bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'));
