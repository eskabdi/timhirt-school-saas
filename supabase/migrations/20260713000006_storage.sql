-- ============================================================================
-- 006 STORAGE — private buckets; INSA secure-upload controls
-- (extension/MIME whitelist + 5MB cap set on buckets; randomized object names
--  enforced by app convention {tenant_id}/.../{uuid}.{ext}; reads via 60s
--  signed URLs only.)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',      'avatars',      false, 5242880, array['image/webp','image/png','image/jpeg']),
  ('documents',    'documents',    false, 5242880, array['application/pdf','image/webp','image/png','image/jpeg']),
  ('report-cards', 'report-cards', false, 5242880, array['application/pdf']),
  ('payslips',     'payslips',     false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

-- Tenant-scoped read on avatars/documents; report-cards & payslips written by
-- service_role only, read via the same tenant-prefix rule.
create policy "tenant read avatars" on storage.objects for select to authenticated
using (bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text);
create policy "admin write avatars" on storage.objects for insert to authenticated
with check (bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'));

create policy "tenant read documents" on storage.objects for select to authenticated
using (bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text);
create policy "admin write documents" on storage.objects for insert to authenticated
with check (bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'));

create policy "tenant read report cards" on storage.objects for select to authenticated
using (bucket_id = 'report-cards'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text);

-- Payslips: finance roles or path-owner employee (path = tenant/ec_year/ec_month/employee_id/file)
create policy "payslip read" on storage.objects for select to authenticated
using (bucket_id = 'payslips'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and ((select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer','accountant')
       or exists (select 1 from public.employees e
                  where e.user_id = auth.uid()
                    and e.id::text = (storage.foldername(name))[4])));
