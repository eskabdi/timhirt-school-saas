-- ============================================================================
-- Invoice consolidation.
--
-- fee_invoices has always been one row per (student, fee_structure) -- there
-- is no "invoice" grouping concept at all. A school with Tuition, Registration
-- and Library fees generates three separate rows per student, each its own
-- PDF and its own "Pay via Telebirr" button. That is unmanageable at scale
-- (the same student appears as N unrelated ledger rows) and does not match
-- how a real invoice works: one document, one due date, one payment, several
-- line items.
--
-- This adds a header table (`invoice_headers`) that fee_invoices rows attach
-- to. Deliberately NOT a rename of fee_invoices to "line_items" -- every RLS
-- policy, report, Edge Function and pgTAP suite already keys on fee_invoices
-- by name, and none of that logic actually cares whether a row is grouped;
-- it only cares about its own student_id/fee_structure_id/amount_due/
-- amount_paid/status, which are untouched here.
--
-- `payments.invoice_id` now points at invoice_headers(id), not fee_invoices
-- (the line item) as it used to. The first version of this migration kept it
-- pointing at a line item on the theory that apply_payment_to_invoice() /
-- settle_gateway_payment() (20260713000010) would need zero changes -- but a
-- Telebirr checkout is ONE external transaction with ONE tx_ref covering the
-- WHOLE invoice; settle_gateway_payment() credits exactly one payments row,
-- so that row has to be able to fund every line item under the header
-- atomically, not just one of them. Picking a single "primary" line item to
-- absorb the full amount would make that line's own amount_paid exceed its
-- amount_due while sibling lines stayed at zero -- the header TOTAL would
-- still add up, but every per-line Paid/Unpaid badge on the invoice would be
-- lying. So both functions now allocate a single payments.amount across the
-- header's unpaid fee_invoices rows (oldest created_at first), crediting
-- each one individually. For every legacy (pre-consolidation) row, its
-- header has exactly one line, so the loop allocates 100% of the payment to
-- it -- byte-for-byte the same result the old direct-by-id update produced.
--
-- Consolidation applies going forward only. Every EXISTING fee_invoices row
-- gets its own 1:1 header via backfill below -- no historical row is merged
-- with another, so every already-issued PDF, receipt and payment keeps
-- meaning exactly what it always did. Only new fee_invoices rows created
-- after this ships can share a header with siblings generated the same day
-- for the same student.
-- ============================================================================

create table public.invoice_headers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id),
  student_id uuid not null references public.students(id) on delete restrict,
  due_date   date not null,
  created_at timestamptz not null default now()
);
create index invoice_headers_tenant_student_due on public.invoice_headers (tenant_id, student_id, due_date);
create trigger audit_invoice_headers after insert or update or delete on public.invoice_headers
for each row execute function public.audit_trigger();

-- No status column: a header's status is always derived from its line items
-- (invoice_summary view below), the same "compute at read time, do not
-- denormalize-and-drift" choice dashboard_billing already makes.

alter table public.invoice_headers enable row level security;
alter table public.invoice_headers force row level security;
create policy invoice_headers_select on public.invoice_headers for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) in ('school_admin','accountant')
        or (student_id in (select s.id from public.students s
                            where s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
);
-- No insert/update/delete policy: written exclusively by service_role Edge
-- Functions (generate-fee-invoices, enroll-finalize-billing), same
-- not-client-forgeable reasoning as webhook_events/fee_documents.

alter table public.fee_invoices add column invoice_header_id uuid references public.invoice_headers(id);

-- One header per existing row, 1:1. A plain correlated INSERT..SELECT keyed
-- on (tenant_id, student_id, due_date, created_at) risks silently merging two
-- legacy rows that happen to share that tuple (e.g. two fee structures
-- generated in the same batch, whose created_at could resolve to the same
-- instant) -- a per-row loop keyed on each row's own primary key cannot.
do $$
declare r record; v_header_id uuid;
begin
  for r in
    select id, tenant_id, student_id, due_date, created_at
    from public.fee_invoices where invoice_header_id is null
  loop
    insert into public.invoice_headers (tenant_id, student_id, due_date, created_at)
    values (r.tenant_id, r.student_id, r.due_date, r.created_at)
    returning id into v_header_id;
    update public.fee_invoices set invoice_header_id = v_header_id where id = r.id;
  end loop;
end $$;

alter table public.fee_invoices alter column invoice_header_id set not null;
create index fee_invoices_header_idx on public.fee_invoices (invoice_header_id);

-- One invoice PDF per header (was: one per fee_invoices row) and portal
-- notifications keyed on the same header -- repoint both FKs from the
-- line-item id they used to reference to the 1:1 header just created for it.
-- Introspect the real constraint names rather than assuming Postgres's
-- default naming held (CLAUDE.md: verify, don't assume).
do $$
declare v_conname text;
begin
  select conname into v_conname from pg_constraint
  where conrelid = 'public.fee_documents'::regclass and contype = 'f'
    and conkey = (select array_agg(attnum) from pg_attribute
                  where attrelid = 'public.fee_documents'::regclass and attname = 'invoice_id');
  if v_conname is not null then
    execute format('alter table public.fee_documents drop constraint %I', v_conname);
  end if;

  select conname into v_conname from pg_constraint
  where conrelid = 'public.portal_notifications'::regclass and contype = 'f'
    and conkey = (select array_agg(attnum) from pg_attribute
                  where attrelid = 'public.portal_notifications'::regclass and attname = 'invoice_id');
  if v_conname is not null then
    execute format('alter table public.portal_notifications drop constraint %I', v_conname);
  end if;
end $$;

update public.fee_documents fd set invoice_id = fi.invoice_header_id
  from public.fee_invoices fi where fd.invoice_id = fi.id;
update public.portal_notifications pn set invoice_id = fi.invoice_header_id
  from public.fee_invoices fi where pn.invoice_id = fi.id;

alter table public.fee_documents
  add constraint fee_documents_invoice_id_fkey foreign key (invoice_id) references public.invoice_headers(id) on delete cascade;
alter table public.portal_notifications
  add constraint portal_notifications_invoice_id_fkey foreign key (invoice_id) references public.invoice_headers(id) on delete cascade;

-- fee_documents_select re-pointed to invoice_headers (it used to join
-- fee_invoices to reach student_id; the header already carries it directly).
drop policy if exists fee_documents_select on public.fee_documents;
create policy fee_documents_select on public.fee_documents for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) in ('school_admin','accountant')
        or exists (select 1 from public.invoice_headers h where h.id = invoice_id
                   and (h.student_id in (select s.id from public.students s
                                          where s.user_id = auth.uid() or public.is_guardian_of(s.id))))))
);

-- Repoint payments.invoice_id from the line item to its 1:1 header, same
-- introspect-then-drop approach as fee_documents/portal_notifications above.
do $$
declare v_conname text;
begin
  select conname into v_conname from pg_constraint
  where conrelid = 'public.payments'::regclass and contype = 'f'
    and conkey = (select array_agg(attnum) from pg_attribute
                  where attrelid = 'public.payments'::regclass and attname = 'invoice_id');
  if v_conname is not null then
    execute format('alter table public.payments drop constraint %I', v_conname);
  end if;
end $$;

update public.payments p set invoice_id = fi.invoice_header_id
  from public.fee_invoices fi where p.invoice_id = fi.id;

alter table public.payments
  add constraint payments_invoice_id_fkey foreign key (invoice_id) references public.invoice_headers(id) on delete restrict;

-- payments_select used to join fee_invoices to reach student_id; the header
-- already carries it directly, same shape as fee_documents_select above.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) in ('school_admin','accountant')
        or exists (select 1 from public.invoice_headers h where h.id = invoice_id
                   and (h.student_id in (select s.id from public.students s
                                          where s.user_id = auth.uid() or public.is_guardian_of(s.id))))))
);

-- bank_payment_verifications_select (20260808000001) joined payments to
-- fee_invoices to reach the student; that join now returns nothing since
-- payments.invoice_id points at the header. Repoint it the same way
-- fee_documents_select/payments_select were above.
drop policy if exists bank_payment_verifications_select on public.bank_payment_verifications;
create policy bank_payment_verifications_select on public.bank_payment_verifications for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    (select public.get_role_for_user(auth.uid())) in ('school_admin', 'registrar', 'accountant')
    or (payment_id is not null and exists (
          select 1 from public.payments p join public.invoice_headers h on h.id = p.invoice_id
          where p.id = payment_id and (h.student_id in (select s.id from public.students s
                                        where s.user_id = auth.uid() or public.is_guardian_of(s.id)))))
  ))
);

-- Both settlement paths now allocate one payment amount across a header's
-- unpaid line items, oldest first, instead of crediting a single fee_invoices
-- row directly by id.
create or replace function public.apply_payment_to_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_remaining numeric; v_credit numeric;
begin
  if new.status = 'succeeded' then
    v_remaining := new.amount;
    for r in
      select id, amount_due, amount_paid from public.fee_invoices
      where invoice_header_id = new.invoice_id and status <> 'paid'
      order by created_at for update
    loop
      exit when v_remaining <= 0;
      v_credit := least(v_remaining, r.amount_due - r.amount_paid);
      update public.fee_invoices
        set amount_paid = r.amount_paid + v_credit,
            status = (case when r.amount_paid + v_credit >= r.amount_due then 'paid' else 'partial' end)::public.invoice_status
        where id = r.id;
      v_remaining := v_remaining - v_credit;
    end loop;
  end if;
  return new;
end $$;

create or replace function public.settle_gateway_payment(
  p_tx_ref text, p_provider public.payment_provider, p_reported_amount numeric)
returns text language plpgsql security definer set search_path = public as $$
declare v_pay record; r record; v_remaining numeric; v_credit numeric;
begin
  -- replay guard first, but inside the same tx as the credit
  begin
    insert into public.webhook_events(id, provider) values (p_tx_ref, p_provider);
  exception when unique_violation then
    return 'duplicate';
  end;

  select id, invoice_id, amount into v_pay
  from public.payments where provider_ref = p_tx_ref and status = 'pending'
  for update limit 1;
  if v_pay.id is null then return 'not_found'; end if;

  if round(p_reported_amount, 2) <> round(v_pay.amount, 2) then
    return 'amount_mismatch';                     -- do NOT credit; leave pending
  end if;

  update public.payments set status = 'succeeded', paid_at = now() where id = v_pay.id;

  v_remaining := v_pay.amount;
  for r in
    select id, amount_due, amount_paid from public.fee_invoices
    where invoice_header_id = v_pay.invoice_id and status <> 'paid'
    order by created_at for update
  loop
    exit when v_remaining <= 0;
    v_credit := least(v_remaining, r.amount_due - r.amount_paid);
    update public.fee_invoices
      set amount_paid = r.amount_paid + v_credit,
          status = (case when r.amount_paid + v_credit >= r.amount_due then 'paid' else 'partial' end)::public.invoice_status
      where id = r.id;
    v_remaining := v_remaining - v_credit;
  end loop;

  return 'ok';
end $$;
revoke all on function public.settle_gateway_payment(text, public.payment_provider, numeric) from public, anon, authenticated;

-- verify_document(): the joined status column now comes from the header's
-- line items (aggregate), not a single fee_invoices row.
create or replace function public.verify_document(p_code text)
returns table (valid boolean, subject_type text, issued_on date, tenant_name text,
               doc_no text, amount numeric, invoice_status text)
language sql stable security definer set search_path = public as $$
  select true, c.subject_type, c.issued_on, t.name, null::text, null::numeric, null::text
  from public.id_cards c join public.tenants t on t.id = c.tenant_id where c.verify_code = p_code
  union all
  select true, d.kind::text, d.issued_on, t.name, d.doc_no, d.amount,
    (select case when bool_and(fi.status = 'paid') then 'paid'
                 when coalesce(sum(fi.amount_paid), 0) > 0 then 'partial'
                 else 'pending' end
     from public.fee_invoices fi where fi.invoice_header_id = d.invoice_id)
  from public.fee_documents d join public.tenants t on t.id = d.tenant_id where d.verify_code = p_code
$$;
revoke all on function public.verify_document(text) from public, anon, authenticated;
grant execute on function public.verify_document(text) to service_role;

-- One row per header: what the Invoices ledger list page and every "Pay via
-- Telebirr" / "Record payment" action now operate on. security_invoker so
-- invoice_headers_select/invoices_select (fee_invoices) RLS still governs
-- exactly what each caller can see through the view -- the view grants no
-- privilege of its own, same pattern as hr_employee_sensitive/
-- clinic_visit_detail (20260713000010).
create or replace view public.invoice_summary
with (security_invoker = true) as
select
  h.id, h.tenant_id, h.student_id, h.due_date, h.created_at,
  coalesce(sum(fi.amount_due), 0)  as amount_due,
  coalesce(sum(fi.amount_paid), 0) as amount_paid,
  (case when bool_and(fi.status = 'paid') then 'paid'
        when coalesce(sum(fi.amount_paid), 0) > 0 then 'partial'
        else 'pending' end)::public.invoice_status as status,
  count(fi.id) as line_count
from public.invoice_headers h
join public.fee_invoices fi on fi.invoice_header_id = h.id
group by h.id, h.tenant_id, h.student_id, h.due_date, h.created_at;

revoke all on public.invoice_summary from public, anon;
grant select on public.invoice_summary to authenticated;
