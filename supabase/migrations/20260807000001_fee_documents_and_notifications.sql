-- ============================================================================
-- Fee documents (invoice + receipt PDFs) and in-app portal billing
-- notifications. Extends the existing verify_id_card()/verify-id/QR pattern
-- (issue-id-card) rather than forking a parallel one: one fee_documents
-- table for both invoice and receipt PDFs, modeled directly on id_cards'
-- subject_type-discriminator shape.
--
-- No insert/update/delete policy on either new table -- both are written
-- exclusively by service_role Edge Functions (chapa-webhook,
-- record-fee-payment, issue-fee-document, enroll-finalize-billing), same
-- "not client-forgeable" reasoning as webhook_events.
-- ============================================================================

create type public.fee_document_kind as enum ('invoice', 'receipt');

create table public.fee_documents (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  kind        public.fee_document_kind not null,
  invoice_id  uuid not null references public.fee_invoices(id) on delete cascade,
  payment_id  uuid references public.payments(id) on delete cascade,
  doc_no      text not null,               -- e.g. INV-2018-<8 hex> / RCP-2018-<8 hex>
  verify_code text not null unique,        -- 48 hex chars, same generator as issue-id-card
  amount      numeric(12,2) not null check (amount >= 0),  -- frozen at generation time
  issued_on   date not null default current_date,
  pdf_path    text not null,
  created_by  uuid references public.users(id),  -- null when written by service_role (webhook)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint fee_documents_verify_code_entropy check (length(verify_code) >= 24),
  constraint fee_documents_receipt_needs_payment check ((kind = 'receipt') = (payment_id is not null)),
  unique (tenant_id, doc_no)
);
create unique index fee_documents_invoice_uq on public.fee_documents (invoice_id) where kind = 'invoice';
create unique index fee_documents_receipt_uq on public.fee_documents (payment_id) where kind = 'receipt';
create index fee_documents_lookup on public.fee_documents (tenant_id, invoice_id, kind);

create trigger fee_documents_updated before update on public.fee_documents
for each row execute function public.set_updated_at();
create trigger audit_fee_documents after insert or update or delete on public.fee_documents
for each row execute function public.audit_trigger();

alter table public.fee_documents enable row level security;
alter table public.fee_documents force row level security;
create policy fee_documents_select on public.fee_documents for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) in ('school_admin','accountant')
        or exists (select 1 from public.fee_invoices i join public.students s on s.id = i.student_id
                   where i.id = invoice_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);

-- ---------------------------------------------------------------------------
-- Portal notifications: one row per billing event delivered to a recipient's
-- in-app portal. Not a repurposed notification_log (unused scaffolding, FK'd
-- to announcements, wrong shape) -- same reasoning staff_messages already
-- used to justify a new `messages` table over stretching `notices`.
--
-- No title/body columns: `kind` is a closed set, rendered at read-time via
-- t(`fees.notifications.${kind}`, {...}) so the message stays locale-aware
-- instead of being frozen at insert time.
-- ---------------------------------------------------------------------------
create type public.portal_notification_kind as enum ('invoice_issued', 'payment_received', 'invoice_overdue');

create table public.portal_notifications (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  recipient_id uuid not null references public.users(id) on delete cascade,
  student_id   uuid references public.students(id) on delete cascade,
  kind         public.portal_notification_kind not null,
  invoice_id   uuid references public.fee_invoices(id) on delete cascade,
  payment_id   uuid references public.payments(id) on delete cascade,
  amount       numeric(12,2),
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index portal_notifications_unread on public.portal_notifications (tenant_id, recipient_id) where read_at is null;
create index portal_notifications_recipient on public.portal_notifications (recipient_id, created_at desc);
-- Replay guard: doubles as the idempotency check notifyBilling() relies on.
create unique index portal_notifications_event_uq
  on public.portal_notifications (recipient_id, kind, coalesce(payment_id, invoice_id));

alter table public.portal_notifications enable row level security;
alter table public.portal_notifications force row level security;
-- Deliberately no school_admin bypass, same model as `messages` -- a
-- billing notification is personal to its recipient, not staff-readable.
create policy portal_notifications_select on public.portal_notifications for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and recipient_id = auth.uid())
);
create policy portal_notifications_update on public.portal_notifications for update to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and recipient_id = auth.uid())
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and recipient_id = auth.uid());
-- no insert/delete policy: service_role only

-- ---------------------------------------------------------------------------
-- Storage: generated invoice/receipt PDFs. Staff get a direct read policy;
-- portal users (parent/student) receive short-TTL signed URLs minted
-- server-side by the generating Edge Function instead -- a
-- "guardian-of-the-student-on-the-invoice-on-this-path" rule isn't
-- expressible as a storage path-prefix policy.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('fee-documents', 'fee-documents', false, 2097152, array['application/pdf'])
on conflict (id) do nothing;

create policy "tenant read fee documents" on storage.objects for select to authenticated
using (bucket_id = 'fee-documents'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'accountant'));

-- ---------------------------------------------------------------------------
-- Verification RPC -- extends the existing verify_id_card() flow rather than
-- forking a parallel one. One QR target shape (/verify/:code), one Edge
-- Function (verify-id), one public page. Minimal-disclosure: never returns
-- student/guardian identity, matching id_cards' existing rule.
-- ---------------------------------------------------------------------------
create or replace function public.verify_document(p_code text)
returns table (valid boolean, subject_type text, issued_on date, tenant_name text,
               doc_no text, amount numeric, invoice_status text)
language sql stable security definer set search_path = public as $$
  select true, c.subject_type, c.issued_on, t.name, null::text, null::numeric, null::text
  from public.id_cards c join public.tenants t on t.id = c.tenant_id where c.verify_code = p_code
  union all
  select true, d.kind::text, d.issued_on, t.name, d.doc_no, d.amount, i.status::text
  from public.fee_documents d join public.tenants t on t.id = d.tenant_id
  join public.fee_invoices i on i.id = d.invoice_id where d.verify_code = p_code
$$;
revoke all on function public.verify_document(text) from public, anon, authenticated;
grant execute on function public.verify_document(text) to service_role;
