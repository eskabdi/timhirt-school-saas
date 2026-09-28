-- ============================================================================
-- R6 WP-09 round 1 review fixes (maker-checker hardening).
--
-- Round 1 found ways around the controls of 20260927000002 made of ordinary
-- client writes, and approvals that executed against a record that had moved
-- on. This migration closes them:
--
--  1. Tenant binding (TI-01, SEC-03). A payment and a fee line must belong to
--     the tenant of the invoice header they point at: composite foreign keys
--     on (header id, tenant_id). The crediting, void and settlement code also
--     filters on the tenant.
--  2. Invoice money is written only by trusted code (AZ-01, SEC-01, PAY-2,
--     SC-04, TI-03). A client may not change amount_due, amount_paid, status
--     or the line's header/student/structure/tenant, and may insert a line
--     only as unpaid and pending, into a header that is not void.
--  3. One lock order for an invoice (SC-01, SC-08): the invoice_headers row
--     first, then its fee_invoices rows by created_at. Payment inserts,
--     crediting, gateway settlement and the void executor all take it, so a
--     void and a payment on the same invoice serialise.
--  4. Approvals execute only against the state the checker saw (SEC-04,
--     PAY-1, PAY-3, SC-02). A void re-checks amount_due, amount_paid and the
--     open-line count against payload.from; a manual payment re-checks the
--     open balance. A client cash/bank payment may not exceed the open
--     balance less the other cash/bank payments still pending on the invoice.
--  5. Threshold splitting (SEC-05, PAY-4): the threshold compares the day's
--     running total of manual payments on the invoice (Addis day), not one
--     payment.
--  6. Published results (AZ-02, SEC-02, TI-02, AZ-05). The grade gate checks
--     the old and the new exam, and also gates INSERT. An exam whose term is
--     published cannot be moved to another term, re-scaled (max_score,
--     weight), moved to another class or deleted by a client, and no exam can
--     be moved into a published term. A missing grade is added after
--     publication through a new action, grade_entry_after_publish.
--  7. Expiry and withdrawal (TI-04, PAY-7, SC-03, SC-05, AZ-08). Stale
--     pending requests are expired inline (the caller's tenant) by
--     submit_approval, decide_approval and the new cancel_approval, so an
--     expired request no longer blocks its record forever; an expired or
--     withdrawn manual payment is marked failed. decide_approval on an
--     expired request records the expiry and returns 'expired'.
--  8. Module gating (AZ-04): approval_actions.module; a request is visible,
--     submittable and decidable only while the tenant has that module.
--  9. Approval settings (AZ-03, PAY-8): settings.approvals is written only by
--     set_approval_settings, and every change is written to audit_logs.
-- 10. Trusted-role allow-list (SEC-06): the enforcement triggers trust only
--     postgres, service_role and supabase_admin as current_user; every other
--     role is treated as a client.
-- 11. approval_requests invariants (TI-05, SC-09): tenant_id may be null only
--     for platform actions; a request's identity and payload never change and
--     its status moves only forward.
--
-- 12. Database review (DB-3, DB-7, DB-8, DB-9): lock_timeout; a rejected or
--     expired manual payment frees its reference for the corrected one;
--     indexes on approval_requests.checker_id and .action; TRUNCATE revoked
--     from clients on the invoice tables.
--
-- Deploy: apply once, after 20260927000001 and 20260927000002, each file in
-- its own transaction (000001 adds an enum value that 000002 uses). The
-- files are not idempotent; schema_migrations records them.
--
-- Forward fix (production has no backups, so there is no restore path):
--   * a single tenant blocked by the payment gate:
--     set_approval_settings(false, 0) as that school's admin;
--   * a trigger that misfires: `drop trigger <name> on <table>` (each is
--     independent) and ship a corrected function in the next migration;
--   * the composite foreign keys: drop payments_invoice_tenant_fkey /
--     fee_invoices_header_tenant_fkey and re-add the single-column FKs
--     (payments_invoice_id_fkey … on delete restrict,
--     fee_invoices_invoice_header_id_fkey) from 20260820000001;
--   * previous definitions: settle_gateway_payment and verify_document in
--     20260820000001; apply_payment_to_invoice, submit/decide/execute and the
--     guards in 20260927000002.
-- ============================================================================

set lock_timeout = '5s';

-- ------------------------------------------------------ 1. tenant binding --
alter table public.invoice_headers add constraint invoice_headers_id_tenant_key unique (id, tenant_id);
alter table public.payments
  drop constraint payments_invoice_id_fkey,
  add constraint payments_invoice_tenant_fkey foreign key (invoice_id, tenant_id)
    references public.invoice_headers (id, tenant_id) on delete restrict;
alter table public.fee_invoices
  drop constraint fee_invoices_invoice_header_id_fkey,
  add constraint fee_invoices_header_tenant_fkey foreign key (invoice_header_id, tenant_id)
    references public.invoice_headers (id, tenant_id);

-- ------------------------------------------------ 11. request invariants --
alter table public.approval_requests
  drop constraint approval_requests_status_check,
  add constraint approval_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'expired', 'executed', 'cancelled')),
  drop constraint decided_has_checker,
  add constraint decided_has_checker
    check (status in ('pending', 'expired', 'cancelled') or (checker_id is not null and decided_at is not null)),
  add constraint approval_requests_tenant_scope
    check (tenant_id is not null or action in ('tenant_activation', 'tenant_slug_change'));
create index approval_requests_pending_expiry on public.approval_requests (tenant_id, expires_at) where status = 'pending';

create function public.approval_requests_transition_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if (new.id, new.tenant_id, new.action, new.entity_table, new.entity_id, new.payload, new.payload_hash,
      new.maker_id, new.reason, new.created_at, new.expires_at)
     is distinct from
     (old.id, old.tenant_id, old.action, old.entity_table, old.entity_id, old.payload, old.payload_hash,
      old.maker_id, old.reason, old.created_at, old.expires_at) then
    raise exception 'approval_request_immutable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'pending' and new.status in ('approved', 'rejected', 'expired', 'cancelled'))
              or (old.status = 'approved' and new.status = 'executed')) then
    raise exception 'approval_invalid_transition' using errcode = '42501';
  end if;
  if old.status <> 'pending' and old.status is not distinct from new.status then
    raise exception 'approval_invalid_transition' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.approval_requests_transition_guard() from public, anon, authenticated;
create trigger approval_requests_transition_guard before update on public.approval_requests
  for each row execute function public.approval_requests_transition_guard();

-- ------------------------------------------------------ 8. module gating --
alter table public.approval_actions add column module text;
update public.approval_actions set module = case
  when action in ('manual_payment_accept', 'invoice_void', 'payment_verify', 'payment_reversal',
                  'school_bank_account_change', 'unclaimed_receipt_assign') then 'fees'
  when action in ('grade_edit_after_publish') then 'gradebook'
  when action in ('student_transfer_out', 'student_withdrawal') then 'sis'
  when action = 'admission_payment_accept' then 'admissions'
  when action = 'timetable_publish' then 'timetable'
  when action = 'bank_transfer_export' then 'hr_payroll'
end;

-- 6. A grade that did not exist when results were published.
insert into public.approval_actions (action, entity_table, checker_resource, platform_minimum, available, planned_wp, description, module)
values ('grade_entry_after_publish', 'grades', 'grades', true, true, null, 'Add a missing grade after results are published', 'gradebook');

-- The request's module must be on for the tenant (null module: platform or
-- core action, always visible).
create function public.approval_action_module_on(p_tenant uuid, p_action text)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce((select a.module is null or public.has_module(p_tenant, a.module)
                   from public.approval_actions a where a.action = p_action), false)
$$;
revoke execute on function public.approval_action_module_on(uuid, text) from public, anon;
grant execute on function public.approval_action_module_on(uuid, text) to authenticated;

drop policy approval_requests_select on public.approval_requests;
create policy approval_requests_select on public.approval_requests for select to authenticated using (
  (tenant_id is null and (select public.get_role_for_user(auth.uid())) = 'super_admin')
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
      and public.approval_action_module_on(tenant_id, action)
      and (maker_id = auth.uid()
           or public.has_resource_permission(auth.uid(),
                (select a.checker_resource from public.approval_actions a where a.action = approval_requests.action),
                'approve')))
);

-- ------------------------------------------------------------- 7. expiry --
-- Expires the pending requests past expires_at (one tenant, or all when
-- p_tenant is null) and fails the manual payments they parked.
create function public.expire_approvals_for(p_tenant uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  with expired as (
    update public.approval_requests set status = 'expired'
     where status = 'pending' and expires_at <= now()
       and (p_tenant is null or tenant_id = p_tenant)
    returning action, entity_id, tenant_id
  ), failed as (
    update public.payments p set status = 'failed'
      from expired e
     where e.action = 'manual_payment_accept' and p.id = e.entity_id and p.tenant_id = e.tenant_id
       and p.status = 'pending'
    returning p.id
  )
  select count(*) into n from expired;
  return n;
end $$;
revoke execute on function public.expire_approvals_for(uuid) from public, anon, authenticated;

create or replace function public.expire_approvals()
returns integer language sql security definer set search_path = public, pg_temp as $$
  select public.expire_approvals_for(null)
$$;
revoke execute on function public.expire_approvals() from public, anon, authenticated;

-- ------------------------------------------------ 3/4. invoice locking --
-- Crediting: header lock, then the header's open lines in created_at order.
create or replace function public.apply_payment_to_invoice()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_remaining numeric; v_credit numeric;
begin
  if new.status = 'succeeded' then
    perform 1 from public.invoice_headers where id = new.invoice_id and tenant_id = new.tenant_id for update;
    v_remaining := new.amount;
    for r in
      select id, amount_due, amount_paid from public.fee_invoices
      where invoice_header_id = new.invoice_id and tenant_id = new.tenant_id and status not in ('paid', 'void')
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

-- Every payment insert: lock the header, refuse a void invoice, and refuse a
-- client cash/bank payment above the open balance less the cash/bank
-- payments already waiting for approval on it. Trusted paths (service_role
-- Edge Functions) are not limited: an admission payment is recorded as
-- declared.
create or replace function public.payments_reject_void_invoice()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_lines int; v_open int; v_balance numeric; v_pending numeric;
  v_client boolean := coalesce(current_setting('role', true), 'none') not in ('none', 'service_role', 'postgres', 'supabase_admin');
begin
  -- A client row for another tenant is refused by RLS (WITH CHECK runs after
  -- BEFORE triggers); read nothing of that tenant first, or the errors below
  -- would tell the caller about its invoices (review TI-R2-1).
  if v_client and new.tenant_id is distinct from public.get_tenant_id_for_user(auth.uid()) then
    return new;
  end if;
  perform 1 from public.invoice_headers where id = new.invoice_id and tenant_id = new.tenant_id for update;
  if not found then
    return new;   -- the composite foreign key refuses it
  end if;
  select count(*), count(*) filter (where status <> 'void'),
         coalesce(sum(amount_due - amount_paid) filter (where status <> 'void'), 0)
    into v_lines, v_open, v_balance
    from public.fee_invoices where invoice_header_id = new.invoice_id and tenant_id = new.tenant_id;
  if v_lines > 0 and v_open = 0 then
    raise exception 'invoice_void' using errcode = '22023';
  end if;
  if v_client and new.provider in ('cash', 'bank') then
    select coalesce(sum(amount), 0) into v_pending from public.payments
     where invoice_id = new.invoice_id and tenant_id = new.tenant_id
       and provider in ('cash', 'bank') and status = 'pending';
    if new.amount > v_balance - v_pending then
      raise exception 'amount_exceeds_balance' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

-- 5. The threshold applies to the day's running total on the invoice.
create or replace function public.payments_manual_approval_gate()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_today numeric;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') and new.provider in ('cash', 'bank') then
    select coalesce(sum(p.amount), 0) into v_today from public.payments p
     where p.invoice_id = new.invoice_id and p.tenant_id = new.tenant_id
       and p.provider in ('cash', 'bank') and p.status in ('pending', 'succeeded')
       and (p.created_at at time zone 'Africa/Addis_Ababa')::date = (now() at time zone 'Africa/Addis_Ababa')::date;
    if new.status = 'pending'
       or coalesce(public.approval_required(new.tenant_id, 'manual_payment_accept', new.amount + v_today), true) then
      new.status := 'pending';
      new.paid_at := null;
    end if;
  end if;
  return new;
end $$;

-- Gateway settlement: same lock order; a void invoice is not credited (the
-- payment stays pending for staff, like an amount mismatch).
create or replace function public.settle_gateway_payment(
  p_tx_ref text, p_provider public.payment_provider, p_reported_amount numeric)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pay record; r record; v_remaining numeric; v_credit numeric;
begin
  begin
    insert into public.webhook_events(id, provider) values (p_tx_ref, p_provider);
  exception when unique_violation then
    return 'duplicate';
  end;

  select id, invoice_id, tenant_id, amount into v_pay
  from public.payments where provider_ref = p_tx_ref and provider = p_provider
    and provider not in ('cash', 'bank') and status = 'pending'   -- never a parked manual payment (TI-R2-3)
  for update limit 1;
  if v_pay.id is null then return 'not_found'; end if;

  if round(p_reported_amount, 2) <> round(v_pay.amount, 2) then
    return 'amount_mismatch';
  end if;

  perform 1 from public.invoice_headers where id = v_pay.invoice_id and tenant_id = v_pay.tenant_id for update;
  if not exists (select 1 from public.fee_invoices
                  where invoice_header_id = v_pay.invoice_id and tenant_id = v_pay.tenant_id and status <> 'void') then
    return 'invoice_void';
  end if;

  update public.payments set status = 'succeeded', paid_at = now() where id = v_pay.id;

  v_remaining := v_pay.amount;
  for r in
    select id, amount_due, amount_paid from public.fee_invoices
    where invoice_header_id = v_pay.invoice_id and tenant_id = v_pay.tenant_id and status not in ('paid', 'void')
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

-- A voided invoice verifies as void, not as owing (PAY-5).
create or replace function public.verify_document(p_code text)
returns table (valid boolean, subject_type text, issued_on date, tenant_name text,
               doc_no text, amount numeric, invoice_status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select true, c.subject_type, c.issued_on, t.name, null::text, null::numeric, null::text
  from public.id_cards c join public.tenants t on t.id = c.tenant_id where c.verify_code = p_code
  union all
  select true, d.kind::text, d.issued_on, t.name, d.doc_no, d.amount,
    (select case when bool_and(fi.status = 'void') then 'void'
                 when bool_and(fi.status in ('paid', 'void')) then 'paid'
                 when coalesce(sum(fi.amount_paid), 0) > 0 then 'partial'
                 else 'pending' end
     from public.fee_invoices fi where fi.invoice_header_id = d.invoice_id and fi.tenant_id = d.tenant_id)
  from public.fee_documents d join public.tenants t on t.id = d.tenant_id where d.verify_code = p_code
$$;

-- ------------------------------------------- 2. invoice client writes --
create or replace function public.fee_invoices_void_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'void' then
      raise exception 'approval_required' using errcode = '42501',
        hint = 'Voiding an invoice needs an approved invoice_void request (submit_approval).';
    end if;
    if new.status <> 'pending' or new.amount_paid <> 0 then
      raise exception 'invoice_amounts_locked' using errcode = '42501',
        hint = 'A new fee line starts unpaid; payments credit it.';
    end if;
    if exists (select 1 from public.fee_invoices where invoice_header_id = new.invoice_header_id)
       and not exists (select 1 from public.fee_invoices where invoice_header_id = new.invoice_header_id and status <> 'void') then
      raise exception 'invoice_void' using errcode = '22023';
    end if;
  elsif new.status = 'void' or old.status = 'void' then
    raise exception 'approval_required' using errcode = '42501',
      hint = 'Voiding an invoice needs an approved invoice_void request (submit_approval).';
  elsif (new.amount_due, new.amount_paid, new.status, new.invoice_header_id, new.tenant_id, new.student_id, new.fee_structure_id)
        is distinct from
        (old.amount_due, old.amount_paid, old.status, old.invoice_header_id, old.tenant_id, old.student_id, old.fee_structure_id) then
    raise exception 'invoice_amounts_locked' using errcode = '42501',
      hint = 'Amounts and status change only through payments and approved requests.';
  end if;
  return new;
end $$;

-- ------------------------------------------------ 6. published results --
create or replace function public.grades_publication_approval_gate()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(public.exam_results_published(new.exam_id), true) then
      raise exception 'approval_required' using errcode = '42501',
        hint = 'Results are published; a missing grade needs an approved grade_entry_after_publish request (submit_approval).';
    end if;
  elsif (new.score is distinct from old.score or new.remark is distinct from old.remark
         or new.exam_id is distinct from old.exam_id or new.student_id is distinct from old.student_id
         or new.subject_id is distinct from old.subject_id or new.tenant_id is distinct from old.tenant_id)
        and (coalesce(public.exam_results_published(old.exam_id), true)
             or coalesce(public.exam_results_published(new.exam_id), true)) then
    raise exception 'approval_required' using errcode = '42501',
      hint = 'Results are published; a grade change needs an approved grade_edit_after_publish request (submit_approval).';
  end if;
  return new;
end $$;
drop trigger grades_publication_approval_gate on public.grades;
create trigger grades_publication_approval_gate before insert or update on public.grades
  for each row execute function public.grades_publication_approval_gate();

-- An exam whose results are published keeps its term, scale and class; and
-- no exam moves into a published term.
create function public.exams_publication_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_new_published boolean;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if coalesce(public.exam_results_published(old.id), true) then
      raise exception 'results_published_locked' using errcode = '42501';
    end if;
    return old;
  end if;
  -- category splits a report card into CA and Final (review AZ-R2-1).
  if (new.academic_term_id, new.max_score, new.weight, new.class_id, new.tenant_id, new.category)
     is distinct from (old.academic_term_id, old.max_score, old.weight, old.class_id, old.tenant_id, old.category) then
    select t.results_published into v_new_published from public.academic_terms t where t.id = new.academic_term_id;
    if coalesce(public.exam_results_published(old.id), true) or coalesce(v_new_published, true) then
      raise exception 'results_published_locked' using errcode = '42501',
        hint = 'Results for this exam''s term are published; its term, scale and class cannot change.';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.exams_publication_guard() from public, anon, authenticated;
create trigger exams_publication_guard before update or delete on public.exams
  for each row execute function public.exams_publication_guard();

create or replace function public.academic_terms_unpublish_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and old.results_published and not new.results_published then
    raise exception 'results_unpublish_blocked' using errcode = '42501',
      hint = 'Published results stay published; correct a grade with a grade_edit_after_publish request.';
  end if;
  return new;
end $$;

create or replace function public.students_transfer_approval_gate()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and new.status = 'transferred' and old.status is distinct from 'transferred' then
    raise exception 'approval_required' using errcode = '42501',
      hint = 'A transfer out needs an approved student_transfer_out request (submit_approval).';
  end if;
  return new;
end $$;

-- ------------------------------------------------ 9. approval settings --
create function public.tenant_configs_approvals_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and (case when tg_op = 'INSERT' then new.settings -> 'approvals' is not null
               else (new.settings -> 'approvals') is distinct from (old.settings -> 'approvals') end) then
    raise exception 'approval_settings_rpc_only' using errcode = '42501',
      hint = 'Change the approval rules with set_approval_settings.';
  end if;
  return new;
end $$;
revoke execute on function public.tenant_configs_approvals_guard() from public, anon, authenticated;
create trigger tenant_configs_approvals_guard before insert or update of settings on public.tenant_configs
  for each row execute function public.tenant_configs_approvals_guard();

create function public.tenant_configs_approvals_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old jsonb := case when tg_op = 'UPDATE' then old.settings -> 'approvals' end;
begin
  if (new.settings -> 'approvals') is distinct from v_old then
    insert into public.audit_logs (tenant_id, actor_id, action, table_name, row_id, old_data, new_data)
    values (new.tenant_id, auth.uid(), 'APPROVAL_SETTINGS', 'tenant_configs', new.tenant_id,
            jsonb_build_object('approvals', v_old), jsonb_build_object('approvals', new.settings -> 'approvals'));
  end if;
  return new;
end $$;
revoke execute on function public.tenant_configs_approvals_audit() from public, anon, authenticated;
create trigger tenant_configs_approvals_audit after insert or update of settings on public.tenant_configs
  for each row execute function public.tenant_configs_approvals_audit();

-- ----------------------------------------------------------------- submit --
create or replace function public.submit_approval(p_action text, p_entity_id uuid, p_changes jsonb default '{}'::jsonb, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_act    public.approval_actions;
  v_entity uuid := p_entity_id;
  v_payload jsonb;
  v_id     uuid;
  r        record;
  v_score  numeric;
  v_remark text;
  v_to     text;
  v_on     date;
  v_student uuid;
  v_subject uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  v_tenant := public.get_tenant_id_for_user(v_uid);
  if v_tenant is null then raise exception 'no_tenant' using errcode = '42501'; end if;
  select * into v_act from public.approval_actions where action = p_action;
  if not found or not v_act.available or p_action = 'manual_payment_accept' then
    -- Manual payments are submitted by the payments trigger, not by hand.
    raise exception 'approval_action_unavailable' using errcode = '22023';
  end if;
  if v_act.module is not null and not coalesce(public.has_module(v_tenant, v_act.module), false) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;
  -- A stale pending request must not block a new one (or keep a parked
  -- payment blocking a void).
  perform public.expire_approvals_for(v_tenant);

  if p_action = 'invoice_void' then
    select h.id,
           coalesce(sum(fi.amount_due) filter (where fi.status <> 'void'), 0) as due,
           coalesce(sum(fi.amount_paid), 0) as paid,
           count(fi.id) filter (where fi.status <> 'void') as open_lines
      into r
      from public.invoice_headers h
      left join public.fee_invoices fi on fi.invoice_header_id = h.id and fi.tenant_id = h.tenant_id
     where h.id = p_entity_id and h.tenant_id = v_tenant
     group by h.id;
    if r.id is null or not coalesce(public.has_resource_permission(v_uid, 'fee_invoices', 'update'), false) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if r.open_lines = 0 then raise exception 'invoice_already_void' using errcode = '22023'; end if;
    if r.paid > 0 or exists (select 1 from public.payments p
                              where p.invoice_id = p_entity_id and p.tenant_id = v_tenant
                                and p.status in ('pending', 'succeeded')) then
      raise exception 'invoice_has_payments' using errcode = '22023';
    end if;
    v_payload := jsonb_build_object(
      'from', jsonb_build_object('amount_due', r.due, 'amount_paid', r.paid, 'open_lines', r.open_lines),
      'to',   jsonb_build_object('status', 'void'));

  elsif p_action = 'grade_edit_after_publish' then
    select g.id, g.exam_id, g.score, g.remark, s.class_id, e.max_score
      into r
      from public.grades g
      join public.students s on s.id = g.student_id
      join public.exams e on e.id = g.exam_id
     where g.id = p_entity_id and g.tenant_id = v_tenant;
    if r.id is null or not (coalesce(public.has_resource_permission(v_uid, 'grades', 'update'), false)
                            or public.is_teacher_of_class(r.class_id)) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if not coalesce(public.exam_results_published(r.exam_id), false) then
      raise exception 'approval_not_needed' using errcode = '22023';   -- edit it directly
    end if;
    if exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('score', 'remark')) then
      raise exception 'invalid_changes' using errcode = '22023';
    end if;
    v_score := r.score;
    if p_changes ? 'score' then
      if jsonb_typeof(p_changes -> 'score') <> 'number' then raise exception 'invalid_score' using errcode = '22023'; end if;
      v_score := (p_changes ->> 'score')::numeric;
      if v_score < 0 or v_score > r.max_score then raise exception 'invalid_score' using errcode = '22023'; end if;
    end if;
    v_remark := r.remark;
    if p_changes ? 'remark' then
      if jsonb_typeof(p_changes -> 'remark') not in ('string', 'null') then raise exception 'invalid_remark' using errcode = '22023'; end if;
      v_remark := nullif(btrim(p_changes ->> 'remark'), '');
      if char_length(v_remark) > 300 then raise exception 'invalid_remark' using errcode = '22023'; end if;
    end if;
    if v_score = r.score and v_remark is not distinct from r.remark then
      raise exception 'no_change' using errcode = '22023';
    end if;
    v_payload := jsonb_build_object(
      'from', jsonb_build_object('score', r.score, 'remark', r.remark),
      'to',   jsonb_build_object('score', v_score, 'remark', v_remark));

  elsif p_action = 'grade_entry_after_publish' then
    -- p_entity_id is the exam. The request's entity is the grade to be, with
    -- an id derived from (exam, student, subject), so a second request for
    -- the same grade is refused as already pending.
    if exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('student_id', 'subject_id', 'score', 'remark')) then
      raise exception 'invalid_changes' using errcode = '22023';
    end if;
    begin
      v_student := (p_changes ->> 'student_id')::uuid;
      v_subject := (p_changes ->> 'subject_id')::uuid;
    exception when others then
      raise exception 'invalid_changes' using errcode = '22023';
    end;
    select e.id, e.max_score, e.class_id as exam_class, s.class_id, s.status::text as student_status,
           s.first_name, s.middle_name, s.last_name
      into r
      from public.exams e
      join public.students s on s.id = v_student and s.tenant_id = v_tenant
     where e.id = p_entity_id and e.tenant_id = v_tenant;
    if r.id is null
       or not exists (select 1 from public.subjects sj where sj.id = v_subject and sj.tenant_id = v_tenant)
       or not (coalesce(public.has_resource_permission(v_uid, 'grades', 'create'), false)
               or public.is_teacher_of_class(r.class_id)) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if r.exam_class is not null and r.class_id is distinct from r.exam_class then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if not coalesce(public.exam_results_published(r.id), false) then
      raise exception 'approval_not_needed' using errcode = '22023';
    end if;
    if exists (select 1 from public.grades g where g.tenant_id = v_tenant and g.exam_id = r.id
                  and g.student_id = v_student and g.subject_id = v_subject) then
      raise exception 'grade_exists' using errcode = '22023';
    end if;
    if jsonb_typeof(p_changes -> 'score') is distinct from 'number' then raise exception 'invalid_score' using errcode = '22023'; end if;
    v_score := (p_changes ->> 'score')::numeric;
    if v_score < 0 or v_score > r.max_score then raise exception 'invalid_score' using errcode = '22023'; end if;
    v_remark := null;
    if p_changes ? 'remark' then
      if jsonb_typeof(p_changes -> 'remark') not in ('string', 'null') then raise exception 'invalid_remark' using errcode = '22023'; end if;
      v_remark := nullif(btrim(p_changes ->> 'remark'), '');
      if char_length(v_remark) > 300 then raise exception 'invalid_remark' using errcode = '22023'; end if;
    end if;
    v_entity := md5('grade_entry:' || r.id || ':' || v_student || ':' || v_subject)::uuid;
    v_payload := jsonb_build_object(
      'student', concat_ws(' ', r.first_name, r.middle_name, r.last_name),
      'exam_id', r.id, 'student_id', v_student, 'subject_id', v_subject,
      'from', jsonb_build_object('score', null, 'remark', null),
      'to',   jsonb_build_object('score', v_score, 'remark', v_remark));

  elsif p_action = 'student_transfer_out' then
    select st.id, st.status::text as status into r
      from public.students st where st.id = p_entity_id and st.tenant_id = v_tenant;
    if r.id is null or not coalesce(public.has_resource_permission(v_uid, 'students', 'update'), false) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if r.status <> 'active' then raise exception 'invalid_state' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('transferred_to', 'transferred_reason', 'transferred_on')) then
      raise exception 'invalid_changes' using errcode = '22023';
    end if;
    v_to := nullif(btrim(p_changes ->> 'transferred_to'), '');
    if v_to is null or char_length(v_to) > 200 then raise exception 'invalid_transferred_to' using errcode = '22023'; end if;
    if char_length(p_changes ->> 'transferred_reason') > 500 then raise exception 'reason_too_long' using errcode = '22023'; end if;
    begin
      v_on := (p_changes ->> 'transferred_on')::date;
    exception when others then
      raise exception 'invalid_transferred_on' using errcode = '22023';
    end;
    if v_on is null then raise exception 'invalid_transferred_on' using errcode = '22023'; end if;
    v_payload := jsonb_build_object(
      'from', jsonb_build_object('status', r.status),
      'to',   jsonb_build_object('status', 'transferred', 'transferred_to', v_to,
                                 'transferred_reason', nullif(btrim(p_changes ->> 'transferred_reason'), ''),
                                 'transferred_on', v_on));
  else
    raise exception 'approval_action_unavailable' using errcode = '22023';
  end if;

  begin
    insert into public.approval_requests (tenant_id, action, entity_table, entity_id, payload, payload_hash, maker_id, reason)
    values (v_tenant, p_action, v_act.entity_table, v_entity, v_payload, public.approval_payload_hash(v_payload), v_uid,
            nullif(btrim(p_reason), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'approval_already_pending' using errcode = '22023';
  end;
  return v_id;
end $$;

-- ---------------------------------------------------------------- execute --
create or replace function public.execute_approval(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.approval_requests;
  n int;
  v_to jsonb;
  v_from jsonb;
  v_pay public.payments;
  v_due numeric;
  v_paid numeric;
  v_open int;
  v_balance numeric;
begin
  select * into r from public.approval_requests where id = p_id for update;
  if not found or r.status <> 'approved' then raise exception 'approval_not_approved' using errcode = '22023'; end if;
  if public.approval_payload_hash(r.payload) <> r.payload_hash then
    raise exception 'payload_tampered' using errcode = '22023';
  end if;
  v_to := r.payload -> 'to';
  v_from := r.payload -> 'from';

  if r.action = 'manual_payment_accept' then
    select * into v_pay from public.payments where id = r.entity_id and tenant_id = r.tenant_id;
    if not found or v_pay.invoice_id is distinct from (r.payload ->> 'invoice_id')::uuid then
      raise exception 'entity_changed' using errcode = '40001';
    end if;
    -- Lock order: header, then lines. The approved amount must still be owed.
    perform 1 from public.invoice_headers where id = v_pay.invoice_id and tenant_id = r.tenant_id for update;
    perform 1 from public.fee_invoices where invoice_header_id = v_pay.invoice_id and tenant_id = r.tenant_id
      order by created_at for update;
    select coalesce(sum(amount_due - amount_paid) filter (where status <> 'void'), 0) into v_balance
      from public.fee_invoices where invoice_header_id = v_pay.invoice_id and tenant_id = r.tenant_id;
    if v_pay.amount > v_balance then
      raise exception 'entity_changed' using errcode = '40001',
        hint = 'The invoice no longer owes this amount.';
    end if;
    update public.payments set status = 'succeeded', paid_at = now()
     where id = r.entity_id and tenant_id = r.tenant_id and status = 'pending'
       and amount = (r.payload ->> 'amount')::numeric;
  elsif r.action = 'invoice_void' then
    perform 1 from public.invoice_headers where id = r.entity_id and tenant_id = r.tenant_id for update;
    perform 1 from public.fee_invoices where invoice_header_id = r.entity_id and tenant_id = r.tenant_id
      order by created_at for update;
    select coalesce(sum(amount_due) filter (where status <> 'void'), 0), coalesce(sum(amount_paid), 0),
           count(*) filter (where status <> 'void')
      into v_due, v_paid, v_open
      from public.fee_invoices where invoice_header_id = r.entity_id and tenant_id = r.tenant_id;
    -- The checker approved voiding exactly what the request showed.
    if v_due <> (v_from ->> 'amount_due')::numeric or v_paid <> (v_from ->> 'amount_paid')::numeric
       or v_open <> (v_from ->> 'open_lines')::int or v_paid > 0
       or exists (select 1 from public.payments where invoice_id = r.entity_id and tenant_id = r.tenant_id
                    and status in ('pending', 'succeeded')) then
      raise exception 'entity_changed' using errcode = '40001';
    end if;
    update public.fee_invoices set status = 'void'
     where invoice_header_id = r.entity_id and tenant_id = r.tenant_id and status <> 'void' and amount_paid = 0;
    get diagnostics n = row_count;
    if n <> v_open then raise exception 'entity_changed' using errcode = '40001'; end if;
  elsif r.action = 'grade_edit_after_publish' then
    update public.grades set score = (v_to ->> 'score')::numeric, remark = v_to ->> 'remark'
     where id = r.entity_id and tenant_id = r.tenant_id
       and score = (v_from ->> 'score')::numeric and remark is not distinct from (v_from ->> 'remark');
  elsif r.action = 'grade_entry_after_publish' then
    begin
      insert into public.grades (id, tenant_id, student_id, exam_id, subject_id, score, remark, entered_by)
      values (r.entity_id, r.tenant_id, (r.payload ->> 'student_id')::uuid, (r.payload ->> 'exam_id')::uuid,
              (r.payload ->> 'subject_id')::uuid, (v_to ->> 'score')::numeric, v_to ->> 'remark', r.maker_id);
    exception when unique_violation then
      raise exception 'entity_changed' using errcode = '40001';   -- entered meanwhile
    end;
    n := 1;
  elsif r.action = 'student_transfer_out' then
    update public.students
       set status = 'transferred', transferred_to = v_to ->> 'transferred_to',
           transferred_reason = v_to ->> 'transferred_reason', transferred_on = (v_to ->> 'transferred_on')::date
     where id = r.entity_id and tenant_id = r.tenant_id and status::text = v_from ->> 'status';
  else
    raise exception 'approval_action_unavailable' using errcode = '22023';
  end if;
  if r.action not in ('invoice_void', 'grade_entry_after_publish') then
    get diagnostics n = row_count;
  end if;
  if n = 0 then
    -- The entity moved on since the request was made; nothing is applied and
    -- the caller's transaction (the approval itself) rolls back.
    raise exception 'entity_changed' using errcode = '40001';
  end if;

  update public.approval_requests set status = 'executed', executed_at = now() where id = p_id;
end $$;

-- ----------------------------------------------------------------- decide --
create or replace function public.decide_approval(p_id uuid, p_decision text, p_payload_hash text, p_reason text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  r public.approval_requests;
  v_resource text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid_decision' using errcode = '22023'; end if;
  if p_reason is not null and char_length(p_reason) > 500 then raise exception 'reason_too_long' using errcode = '22023'; end if;

  select * into r from public.approval_requests where id = p_id for update;
  if not found
     or (r.tenant_id is null and public.get_role_for_user(v_uid) is distinct from 'super_admin')
     or (r.tenant_id is not null and r.tenant_id is distinct from public.get_tenant_id_for_user(v_uid))
     or (r.tenant_id is not null and not public.approval_action_module_on(r.tenant_id, r.action)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select checker_resource into v_resource from public.approval_actions where action = r.action;
  if not coalesce(public.has_resource_permission(v_uid, v_resource, 'approve'), false) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if r.maker_id = v_uid then raise exception 'maker_cannot_decide' using errcode = '42501'; end if;
  if r.status <> 'pending' then raise exception 'approval_not_pending' using errcode = '22023'; end if;
  if r.expires_at <= now() then
    -- Record the expiry (and fail a parked payment) instead of leaving the
    -- request pending, where it would block a fresh one. Only this request:
    -- a platform request has no tenant to scope a sweep to (TI-R2-5).
    update public.approval_requests set status = 'expired' where id = p_id;
    if r.action = 'manual_payment_accept' then
      update public.payments set status = 'failed' where id = r.entity_id and tenant_id = r.tenant_id and status = 'pending';
    end if;
    return 'expired';
  end if;
  if public.approval_payload_hash(r.payload) <> r.payload_hash then
    raise exception 'payload_tampered' using errcode = '22023';
  end if;
  if p_payload_hash is distinct from r.payload_hash then
    raise exception 'payload_mismatch' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and nullif(btrim(p_reason), '') is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  update public.approval_requests
     set status = p_decision, checker_id = v_uid, decided_at = now(), decision_reason = nullif(btrim(p_reason), '')
   where id = p_id;

  if p_decision = 'approved' then
    perform public.execute_approval(p_id);
    return 'executed';
  end if;
  if r.action = 'manual_payment_accept' then
    update public.payments set status = 'failed' where id = r.entity_id and tenant_id = r.tenant_id and status = 'pending';
  end if;
  return 'rejected';
end $$;

-- ----------------------------------------------------------------- cancel --
-- The maker withdraws their own pending request (a wrong score, the wrong
-- student). A withdrawn manual payment is marked failed.
create function public.cancel_approval(p_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  r public.approval_requests;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into r from public.approval_requests where id = p_id for update;
  if not found or r.maker_id is distinct from v_uid
     or r.tenant_id is distinct from public.get_tenant_id_for_user(v_uid)
     or not public.approval_action_module_on(r.tenant_id, r.action) then   -- AZ-R2-2
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if r.status <> 'pending' then raise exception 'approval_not_pending' using errcode = '22023'; end if;
  if r.expires_at <= now() then
    update public.approval_requests set status = 'expired' where id = p_id;
    if r.action = 'manual_payment_accept' then
      update public.payments set status = 'failed' where id = r.entity_id and tenant_id = r.tenant_id and status = 'pending';
    end if;
    return 'expired';
  end if;
  update public.approval_requests set status = 'cancelled' where id = p_id;
  if r.action = 'manual_payment_accept' then
    update public.payments set status = 'failed' where id = r.entity_id and tenant_id = r.tenant_id and status = 'pending';
  end if;
  return 'cancelled';
end $$;

-- ------------------------------------------------------------ settings RPC --
-- Unchanged, except that the tenant_configs triggers above now refuse any
-- other writer of settings.approvals and audit every change.

-- -------------------------------------------------------- 12. db review --
-- A cash/bank reference (receipt or bank transfer number) is unique within
-- the school, so another school's reference neither blocks nor is revealed
-- (TI-R2-2); a gateway transaction reference stays globally unique, since
-- settlement finds the payment by it.
drop index public.payments_provider_ref_uq;
create unique index payments_provider_ref_uq on public.payments (provider_ref)
  where provider_ref is not null and status <> 'failed' and provider not in ('cash', 'bank');
create unique index payments_manual_ref_uq on public.payments (tenant_id, provider_ref)
  where provider_ref is not null and status <> 'failed' and provider in ('cash', 'bank');
create index approval_requests_checker on public.approval_requests (checker_id);
create index approval_requests_action on public.approval_requests (action);
revoke truncate on public.fee_invoices, public.invoice_headers, public.payments from anon, authenticated;

-- ------------------------------------------------------------------ grants --
revoke execute on function
  public.submit_approval(text, uuid, jsonb, text),
  public.execute_approval(uuid),
  public.decide_approval(uuid, text, text, text),
  public.cancel_approval(uuid),
  public.apply_payment_to_invoice(),
  public.payments_reject_void_invoice(),
  public.settle_gateway_payment(text, public.payment_provider, numeric),
  public.verify_document(text)
from public, anon, authenticated;
grant execute on function
  public.submit_approval(text, uuid, jsonb, text),
  public.decide_approval(uuid, text, text, text),
  public.cancel_approval(uuid)
to authenticated;

reset lock_timeout;
