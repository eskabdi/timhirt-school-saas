-- ============================================================================
-- 009 STORAGE — extended-module buckets (submissions, discipline evidence,
-- id-cards, moe exports). Same INSA upload hardening: MIME whitelist, 5MB cap,
-- randomized names, private buckets, signed URLs only.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('submissions',   'submissions',   false, 5242880, array['application/pdf','image/webp','image/png','image/jpeg']),
  ('evidence',      'evidence',      false, 5242880, array['image/webp','image/png','image/jpeg','application/pdf']),
  ('id-cards',      'id-cards',      false, 5242880, array['application/pdf']),
  ('moe-exports',   'moe-exports',   false, 10485760, array['text/csv','application/pdf'])
on conflict (id) do nothing;

create policy "student write own submission" on storage.objects for insert to authenticated
with check (bucket_id = 'submissions'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text);
create policy "tenant read submissions" on storage.objects for select to authenticated
using (bucket_id = 'submissions'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text);

create policy "staff write evidence" on storage.objects for insert to authenticated
with check (bucket_id = 'evidence'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','teacher'));
create policy "admin read evidence" on storage.objects for select to authenticated
using (bucket_id = 'evidence'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) = 'school_admin');

create policy "admin read id-cards" on storage.objects for select to authenticated
using (bucket_id = 'id-cards'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'));

create policy "admin read moe-exports" on storage.objects for select to authenticated
using (bucket_id = 'moe-exports'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) = 'school_admin');
