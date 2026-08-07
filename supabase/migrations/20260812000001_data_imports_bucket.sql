-- ============================================================================
-- Storage bucket for the bulk CSV import feature (Import/Export page). The
-- data_jobs table + create_import_job/update_job_progress/complete_job/
-- fail_job RPCs already existed (20260719000010_import_export.sql), but no
-- migration ever created the bucket the frontend uploads to -- every "Start
-- Import" click has been 404ing with "Bucket not found" since that feature
-- shipped. This is the missing half; process-import-job (a new Edge
-- Function) is the other half that actually parses the CSV and writes rows.
--
-- Path convention, matching what ImportExportPage.tsx already uploads to:
-- {tenant_id}/{job_id}/{filename}.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('data-imports', 'data-imports', false, 5242880,
   array['text/csv', 'application/vnd.ms-excel', 'application/csv', 'text/plain'])
on conflict (id) do nothing;

-- Import/Export is school_admin-only in the UI (DashboardShell nav gates
-- this route to ["school_admin"], same as every other settings page) --
-- storage policies mirror that here since RLS/the Edge Function's
-- requireRole() are the actual authorization layer, not the nav (§6.2).
create policy "school_admin upload own tenant import csv" on storage.objects
for insert to authenticated
with check (bucket_id = 'data-imports'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) = 'school_admin');

create policy "school_admin read own tenant import csv" on storage.objects
for select to authenticated
using (bucket_id = 'data-imports'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) = 'school_admin');

create policy "school_admin delete own tenant import csv" on storage.objects
for delete to authenticated
using (bucket_id = 'data-imports'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) = 'school_admin');
