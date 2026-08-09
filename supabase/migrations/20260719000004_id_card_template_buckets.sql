-- ============================================================================
-- Tenant-customizable ID card templates + real student photos for
-- issue-id-card (§ "ready to print"). No new tables: the template layout
-- itself (background image path + positioned field list, per side) is
-- schema-free JSONB under tenant_configs.settings.idCardTemplate, the same
-- pattern BrandingPage.tsx already uses for settings.branding.primaryColor
-- -- a per-tenant document layout is exactly the kind of "config, not a
-- record with its own lifecycle" data that table exists for.
--
-- Two buckets:
--  - id-card-templates: the background images a school_admin uploads via
--    the Template Designer (Settings). school_admin only, matching the
--    other branding-adjacent settings pages.
--  - student-photos: the actual photo copied over from an admission
--    application's photo_path at enrollment (see EnrollStudentModal) --
--    students.avatar_path already existed as a column with nothing behind
--    it; this is the storage half of that. Read is broader (school_admin,
--    registrar, teacher) since a homeroom teacher legitimately needs to
--    recognize students, matching who can already read admission documents
--    plus teachers who already see class rosters.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('id-card-templates', 'id-card-templates', false, 2097152, array['image/jpeg','image/png','image/webp']),
  ('student-photos', 'student-photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "school_admin manage id card templates" on storage.objects for all to authenticated
using (bucket_id = 'id-card-templates'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (bucket_id = 'id-card-templates'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) = 'school_admin');

create policy "tenant read student photos" on storage.objects for select to authenticated
using (bucket_id = 'student-photos'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'registrar', 'teacher'));

create policy "registrar write student photos" on storage.objects for insert to authenticated
with check (bucket_id = 'student-photos'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'registrar'));
