-- ============================================================================
-- Storage for generated ID card PDFs (issue-id-card Edge Function). No table
-- schema change needed here -- id_cards/id_card_batches already exist
-- (20260713000007_extended_modules.sql) with the pdf_path column and RLS
-- this bucket's policies mirror.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('id-cards', 'id-cards', false, 2097152, array['application/pdf'])
on conflict (id) do nothing;

create policy "tenant read id cards" on storage.objects for select to authenticated
using (bucket_id = 'id-cards'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'registrar'));
