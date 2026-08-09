-- ============================================================================
-- Student registration stepper — extends admission_applications with the
-- fields the 4-step registration form (Student Info -> Guardian Details ->
-- Documents -> Fees) captures that the original single-page /apply form
-- didn't: bilingual (EN/AM) split names, gender, guardian relationship/
-- occupation/address, uploaded document paths, and payment intent.
--
-- New columns are nullable (no NOT NULL): "required" for the applicant is
-- enforced at the Zod/form layer (submit-admission, PublicAdmissionFormPage),
-- not the DB — this avoids a migration failure against any existing
-- admission_applications rows that predate these fields, and matches how
-- guardian_email/notes are already handled on this table.
--
-- applicant_name / guardian_name (existing columns, already read by
-- AdmissionsKanbanPage/AdmissionDetailPage) are kept and populated from the
-- new split fields at submission time, so existing list/detail views keep
-- working unmodified.
-- ============================================================================

create type public.guardian_relationship as enum ('father', 'mother', 'guardian', 'other');
create type public.registration_payment_method as enum ('cbe', 'awash_bank', 'telebirr');

alter table public.admission_applications
  add column applicant_first_name    text check (length(applicant_first_name) between 1 and 80),   -- 🔒
  add column applicant_first_name_am text check (length(applicant_first_name_am) between 1 and 80), -- 🔒
  add column applicant_middle_name    text check (length(applicant_middle_name) between 1 and 80),  -- 🔒
  add column applicant_middle_name_am text check (length(applicant_middle_name_am) between 1 and 80),-- 🔒
  add column applicant_last_name    text check (length(applicant_last_name) between 1 and 80),      -- 🔒
  add column applicant_last_name_am text check (length(applicant_last_name_am) between 1 and 80),   -- 🔒
  add column gender public.gender,

  add column guardian_name_am    text check (length(guardian_name_am) between 1 and 120),
  add column guardian_relationship public.guardian_relationship,
  add column guardian_occupation text check (length(guardian_occupation) <= 120),
  add column guardian_region      text check (length(guardian_region) <= 80),
  add column guardian_subcity     text check (length(guardian_subcity) <= 80),
  add column guardian_woreda_kebele text check (length(guardian_woreda_kebele) <= 80),
  add column guardian_house_number  text check (length(guardian_house_number) <= 40),

  add column birth_certificate_path text,  -- storage: admission-documents/{tenant_id}/{application_id}/{uuid}.{ext}
  add column transcript_path        text,
  add column photo_path             text,

  add column payment_method public.registration_payment_method,
  add column payment_receipt_path text,
  add column bus_service_opted boolean not null default false,
  add column fees_total_etb numeric(10,2) check (fees_total_etb >= 0);

-- ---------------------------------------------------------------------------
-- Storage: private bucket for the Documents/Fees steps' uploads. Written only
-- by upload-admission-document (service_role) -- same "no client-writable
-- policy, Edge Function is the only insert path" pattern as
-- admission_applications itself, since this is a public/anonymous flow.
-- Staff (school_admin/registrar) get tenant-scoped read, matching the
-- existing "documents" bucket's policy shape.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('admission-documents', 'admission-documents', false, 5242880,
   array['application/pdf', 'image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy "tenant read admission documents" on storage.objects for select to authenticated
using (bucket_id = 'admission-documents'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'registrar'));
