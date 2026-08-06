-- ============================================================================
-- Bank-hosted PDF verification for payments — generalized across the public
-- admission flow AND ordinary fee payments (record-fee-payment), per an
-- explicit follow-up requirement ("not only for admissions, but also for
-- every other payment"). One shared allow-list, one shared verification
-- table, one shared server-side fetch helper (_shared/bank-verify.ts, added
-- separately) used from both call sites.
--
-- Reuses registration_payment_method (cbe/awash_bank/telebirr) rather than
-- minting a near-duplicate enum -- it already has exactly the value set
-- needed in both contexts.
-- ============================================================================

-- Platform-global allow-list. A bank's real domain isn't tenant-specific, so
-- this is not tenant-scoped. Ships EMPTY -- no guessed hostnames. A
-- super_admin must add real, verified domains before URL verification does
-- anything for a given payment method; until then it fails closed (see
-- verifyBankUrl in _shared/bank-verify.ts) and the UI simply doesn't offer
-- the URL option for that method -- image upload remains available.
create table public.bank_verification_domains (
  id             uuid primary key default gen_random_uuid(),
  payment_method public.registration_payment_method not null,
  hostname       text not null,   -- exact match only, no wildcards -- add each real subdomain explicitly
  label          text,
  created_by     uuid references public.users(id),
  created_at     timestamptz not null default now(),
  unique (payment_method, hostname)
);

alter table public.bank_verification_domains enable row level security;
alter table public.bank_verification_domains force row level security;

create policy bank_verification_domains_select on public.bank_verification_domains
  for select to authenticated using (true);

create policy bank_verification_domains_write on public.bank_verification_domains
  for all to authenticated
  using ((select public.get_role_for_user(auth.uid())) = 'super_admin')
  with check ((select public.get_role_for_user(auth.uid())) = 'super_admin');

create type public.bank_verification_status as enum ('pending', 'verified', 'failed');

create table public.bank_payment_verifications (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  admission_application_id uuid references public.admission_applications(id) on delete cascade,
  payment_id               uuid references public.payments(id) on delete cascade,
  payment_method           public.registration_payment_method not null,
  verification_url         text not null,
  pdf_path                 text,
  status                   public.bank_verification_status not null default 'pending',
  failure_reason           text,
  checked_at               timestamptz,
  created_at               timestamptz not null default now(),
  constraint bank_payment_verifications_one_target check (
    (admission_application_id is not null)::int + (payment_id is not null)::int = 1
  )
);

create index bank_payment_verifications_admission on public.bank_payment_verifications (admission_application_id)
  where admission_application_id is not null;
create index bank_payment_verifications_payment on public.bank_payment_verifications (payment_id)
  where payment_id is not null;

alter table public.bank_payment_verifications enable row level security;
alter table public.bank_payment_verifications force row level security;

create policy bank_payment_verifications_select on public.bank_payment_verifications for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    (select public.get_role_for_user(auth.uid())) in ('school_admin', 'registrar', 'accountant')
    or (payment_id is not null and exists (
          select 1 from public.payments p join public.fee_invoices i on i.id = p.invoice_id
          join public.students s on s.id = i.student_id
          where p.id = payment_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id))))
  ))
);
-- No insert/update/delete policy: written only by service_role Edge
-- Functions (verify-admission-bank-url, record-fee-payment), same
-- not-client-forgeable reasoning as webhook_events / fee_documents.

create trigger audit_bank_payment_verifications after insert or update or delete on public.bank_payment_verifications
for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- Storage: bank-hosted PDFs the system fetches and re-stores after passing
-- verifyBankUrl()'s checks. Kept separate from fee-documents (which holds
-- our own generated PDFs) matching this repo's existing granular-bucket-
-- per-purpose convention (payslips/id-cards/report-cards are all separate
-- despite conceptual overlap), and because its staff-read policy needs
-- `registrar` too (admission review), unlike fee-documents.
-- 10MB limit -- bank-hosted PDFs may be larger than our own generated ones.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('bank-verifications', 'bank-verifications', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy "tenant read bank verifications" on storage.objects for select to authenticated
using (bucket_id = 'bank-verifications'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'registrar', 'accountant'));
