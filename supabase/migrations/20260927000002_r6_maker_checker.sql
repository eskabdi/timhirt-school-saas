-- ============================================================================
-- R6 WP-09 (M-06): maker-checker (dual control) framework.
--
-- One person proposes a sensitive change (the maker), a different person with
-- the `<resource>:approve` permission accepts or rejects it (the checker), and
-- only then does the change happen. Enforcement is in the database, not the
-- UI: a client (PostgREST, `authenticated`) that tries the change directly is
-- refused or parked, whatever page or script it comes from.
--
--   approval_actions   registry: which actions exist, which permission a
--                      checker needs, which are platform minimums (a tenant
--                      cannot switch them off), which are wired up yet.
--   approval_requests  one row per request. No client can INSERT, UPDATE or
--                      DELETE it; transitions only via the RPCs below.
--   submit_approval    maker → pending (invoice void, grade edit after
--                      publication, transfer out). Manual payments are
--                      submitted by a trigger on `payments`.
--   decide_approval    checker → approved | rejected. Checker ≠ maker, status
--                      pending, not expired, stored payload hash unchanged and
--                      equal to the hash the checker was shown. Approval
--                      executes the change in the same transaction.
--   execute_approval   the service path that applies an approved request
--                      (service_role only; decide_approval calls it).
--   expire_approvals   sweep for pending requests past expires_at.
--
-- Wired up in this WP (the rest are registered and wired by the WP named in
-- approval_actions.planned_wp):
--   manual_payment_accept      cash/bank payment by a client → 'pending'; it
--                              credits the invoice only when approved.
--                              Threshold: settings.approvals.
--                              manual_payment_threshold_etb (default 0, i.e.
--                              every payment). Tenants may switch it off.
--   invoice_void               DELETE on fee_invoices/invoice_headers revoked
--                              from clients; lines become 'void' only through
--                              an approved request. Platform minimum.
--   grade_edit_after_publish   a client UPDATE of a grade whose term has
--                              published results is refused, and a client
--                              cannot unpublish a term's results (that would
--                              reopen direct edits). Platform minimum.
--   student_transfer_out       a client UPDATE of students.status to
--                              'transferred' is refused. Platform minimum.
--
-- "Client" means the statement runs as `authenticated` or `anon`, i.e.
-- `current_user` inside a SECURITY INVOKER trigger. Inside a SECURITY DEFINER
-- function current_user is the function owner, so execute_approval and the
-- existing trusted RPCs (gateway settlement, enrolment billing through
-- service_role) are not re-gated. Note the contrast with WP-02, which tests
-- current_setting('role'): that stays 'authenticated' inside a definer
-- function and so identifies the end user, not the code path.
--
-- New SECURITY DEFINER functions are revoked from PUBLIC/anon/authenticated
-- here and re-granted exactly as listed in supabase/security/
-- definer_allowlist.sql (catalog_definer_security.sql enforces the match).
-- ============================================================================

-- ---------------------------------------------------------------- registry --
create table public.approval_actions (
  action           text primary key,
  entity_table     text not null,
  checker_resource text not null,   -- checker needs has_resource_permission(uid, checker_resource, 'approve')
  platform_minimum boolean not null default false,
  available        boolean not null default false,
  planned_wp       text,
  description      text not null,
  constraint approval_actions_planned check (available or planned_wp is not null)
);

insert into public.approval_actions (action, entity_table, checker_resource, platform_minimum, available, planned_wp, description) values
  ('manual_payment_accept',     'payments',               'invoices',               false, true,  null,    'Accept a cash or bank payment recorded by staff'),
  ('invoice_void',              'invoice_headers',        'invoices',               true,  true,  null,    'Void an unpaid invoice'),
  ('grade_edit_after_publish',  'grades',                 'grades',                 true,  true,  null,    'Change a grade after results are published'),
  ('student_transfer_out',      'students',               'students',               true,  true,  null,    'Mark a student as transferred out'),
  ('admission_payment_accept',  'admission_applications', 'admission_applications', false, false, 'WP-04', 'Accept an admission payment'),
  ('student_withdrawal',        'students',               'students',               false, false, 'WP-14', 'Withdraw a student'),
  ('timetable_publish',         'timetable_versions',     'timetable',              false, false, 'WP-15', 'Publish a timetable'),
  ('bank_transfer_export',      'payroll_runs',           'payroll',                false, false, 'WP-12', 'Export a payroll bank-transfer file'),
  ('privileged_role_grant',     'users',                  'users',                  true,  false, 'WP-07', 'Grant a privileged role'),
  ('mfa_reset',                 'users',                  'users',                  false, false, 'WP-07', 'Reset a user''s MFA'),
  ('impersonate_minor_account', 'users',                  'users',                  false, false, 'WP-07', 'Impersonate a minor''s account'),
  ('tenant_activation',         'tenants',                'tenants',                false, false, 'WP-20', 'Activate a tenant'),
  ('tenant_slug_change',        'tenants',                'tenants',                false, false, 'WP-20', 'Change a tenant''s slug'),
  ('payment_verify',            'payments',               'invoices',               false, false, 'WP-03', 'Verify a bank-transfer voucher'),
  ('payment_reversal',          'payments',               'invoices',               false, false, 'WP-03', 'Reverse a payment'),
  ('school_bank_account_change','school_bank_accounts',   'invoices',               false, false, 'WP-03', 'Change the school''s bank account'),
  ('unclaimed_receipt_assign',  'payments',               'invoices',               false, false, 'WP-03', 'Assign an unclaimed receipt to an invoice');

alter table public.approval_actions enable row level security;
alter table public.approval_actions force row level security;
create policy approval_actions_select on public.approval_actions for select to authenticated using (true);
revoke insert, update, delete, truncate on public.approval_actions from anon, authenticated;

-- ---------------------------------------------------------------- requests --
create table public.approval_requests (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references public.tenants(id),          -- null for platform actions
  action          text not null references public.approval_actions(action),
  entity_table    text not null,
  entity_id       uuid not null,
  payload         jsonb not null default '{}'::jsonb,
  payload_hash    text not null,                               -- sha256 of payload::text
  status          text not null default 'pending'
                  check (status in ('pending','approved','rejected','expired','executed')),
  maker_id        uuid not null references public.users(id),
  checker_id      uuid references public.users(id),
  decided_at      timestamptz,
  executed_at     timestamptz,
  expires_at      timestamptz not null default now() + interval '7 days',
  reason          text check (char_length(reason) <= 500),          -- the maker's
  decision_reason text check (char_length(decision_reason) <= 500), -- the checker's
  created_at      timestamptz not null default now(),
  constraint checker_not_maker check (checker_id is null or checker_id <> maker_id),
  constraint decided_has_checker check (status in ('pending','expired') or (checker_id is not null and decided_at is not null))
);
create index approval_requests_tenant_status on public.approval_requests (tenant_id, status, created_at desc);
create index approval_requests_maker on public.approval_requests (maker_id);
-- One open request per entity and action: a second submit is refused.
create unique index approval_requests_one_pending on public.approval_requests (action, entity_id) where status = 'pending';

alter table public.approval_requests enable row level security;
alter table public.approval_requests force row level security;
-- Makers see their own requests; checkers see the tenant's requests for the
-- actions they may approve. A super_admin sees only platform requests
-- (tenant_id null): tenant approvals carry student and payment data.
create policy approval_requests_select on public.approval_requests for select to authenticated using (
  (tenant_id is null and (select public.get_role_for_user(auth.uid())) = 'super_admin')
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
      and (maker_id = auth.uid()
           or public.has_resource_permission(auth.uid(),
                (select a.checker_resource from public.approval_actions a where a.action = approval_requests.action),
                'approve')))
);
revoke insert, update, delete, truncate on public.approval_requests from anon, authenticated;
revoke all on public.approval_requests from anon;

create trigger audit_approval_requests after insert or update or delete on public.approval_requests
  for each row execute function public.audit_trigger();

-- ------------------------------------------------------------ permissions --
-- Checkers: `invoices:approve` (fees:approve) for payments and voids,
-- `grades:approve` (gradebook:publish) for grade edits, and a new
-- `students:approve` for transfers. Defaults: school_admin for all;
-- accountant also for payments and voids.
insert into public.permissions (key, module, resource, action, description)
values ('students:approve_transfer', 'sis', 'students', 'approve', 'Approve student transfers (maker-checker)')
on conflict (key) do nothing;
insert into public.resource_default_role_grants (resource, action, role) values
  ('invoices', 'approve', 'school_admin'),
  ('invoices', 'approve', 'accountant'),
  ('grades',   'approve', 'school_admin'),
  ('students', 'approve', 'school_admin')
on conflict do nothing;

-- ---------------------------------------------------------------- helpers --
create function public.approval_payload_hash(p jsonb) returns text
language sql immutable set search_path = public, pg_temp as $$
  select encode(sha256(convert_to(p::text, 'UTF8')), 'hex')
$$;
revoke execute on function public.approval_payload_hash(jsonb) from public, anon;

-- Does this tenant require approval for this action (and amount)? Platform
-- minimums always do. Otherwise settings.approvals.actions.<action> = false
-- switches it off, and manual payments at or below
-- settings.approvals.manual_payment_threshold_etb skip it. Malformed settings
-- fall back to "required". An end user may ask only about their own tenant.
create function public.approval_required(p_tenant uuid, p_action text, p_amount numeric default null)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_min boolean;
  v_cfg jsonb;
  v_threshold numeric := 0;
begin
  if coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon')
     and p_tenant is distinct from public.get_tenant_id_for_user(auth.uid()) then
    return null;
  end if;
  select platform_minimum into v_min from public.approval_actions where action = p_action and available;
  if not found then return false; end if;
  if v_min then return true; end if;

  select settings -> 'approvals' into v_cfg from public.tenant_configs where tenant_id = p_tenant;
  if jsonb_typeof(v_cfg) is distinct from 'object' then return true; end if;
  if jsonb_typeof(v_cfg -> 'actions') = 'object'
     and (v_cfg -> 'actions' -> p_action) = 'false'::jsonb then
    return false;
  end if;
  if p_action = 'manual_payment_accept' then
    if jsonb_typeof(v_cfg -> 'manual_payment_threshold_etb') = 'number' then
      v_threshold := greatest((v_cfg ->> 'manual_payment_threshold_etb')::numeric, 0);
    end if;
    return coalesce(p_amount, 0) > v_threshold;
  end if;
  return true;
end $$;

-- Are the results of this exam's term published? End users: own tenant only.
create function public.exam_results_published(p_exam_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(t.results_published, false)
  from public.exams e join public.academic_terms t on t.id = e.academic_term_id
  where e.id = p_exam_id
    and (coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon')
         or e.tenant_id = public.get_tenant_id_for_user(auth.uid()))
$$;

-- ----------------------------------------------------------------- submit --
create function public.submit_approval(p_action text, p_entity_id uuid, p_changes jsonb default '{}'::jsonb, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_act    public.approval_actions;
  v_payload jsonb;
  v_id     uuid;
  r        record;
  v_score  numeric;
  v_remark text;
  v_to     text;
  v_on     date;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  v_tenant := public.get_tenant_id_for_user(v_uid);
  if v_tenant is null then raise exception 'no_tenant' using errcode = '42501'; end if;
  select * into v_act from public.approval_actions where action = p_action;
  if not found or not v_act.available or p_action = 'manual_payment_accept' then
    -- Manual payments are submitted by the payments trigger, not by hand.
    raise exception 'approval_action_unavailable' using errcode = '22023';
  end if;
  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;

  if p_action = 'invoice_void' then
    select h.id,
           coalesce(sum(fi.amount_due) filter (where fi.status <> 'void'), 0) as due,
           coalesce(sum(fi.amount_paid), 0) as paid,
           count(fi.id) filter (where fi.status <> 'void') as open_lines
      into r
      from public.invoice_headers h
      left join public.fee_invoices fi on fi.invoice_header_id = h.id
     where h.id = p_entity_id and h.tenant_id = v_tenant
     group by h.id;
    if r.id is null or not coalesce(public.has_resource_permission(v_uid, 'fee_invoices', 'update'), false) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if r.open_lines = 0 then raise exception 'invoice_already_void' using errcode = '22023'; end if;
    if r.paid > 0 or exists (select 1 from public.payments p where p.invoice_id = p_entity_id and p.status in ('pending','succeeded')) then
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
  end if;

  begin
    insert into public.approval_requests (tenant_id, action, entity_table, entity_id, payload, payload_hash, maker_id, reason)
    values (v_tenant, p_action, v_act.entity_table, p_entity_id, v_payload, public.approval_payload_hash(v_payload), v_uid,
            nullif(btrim(p_reason), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'approval_already_pending' using errcode = '22023';
  end;
  return v_id;
end $$;

-- ---------------------------------------------------------------- execute --
create function public.execute_approval(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.approval_requests;
  n int;
  v_to jsonb;
  v_from jsonb;
begin
  select * into r from public.approval_requests where id = p_id for update;
  if not found or r.status <> 'approved' then raise exception 'approval_not_approved' using errcode = '22023'; end if;
  if public.approval_payload_hash(r.payload) <> r.payload_hash then
    raise exception 'payload_tampered' using errcode = '22023';
  end if;
  v_to := r.payload -> 'to';
  v_from := r.payload -> 'from';

  if r.action = 'manual_payment_accept' then
    update public.payments set status = 'succeeded', paid_at = now()
     where id = r.entity_id and tenant_id = r.tenant_id and status = 'pending'
       and amount = (r.payload ->> 'amount')::numeric;
  elsif r.action = 'invoice_void' then
    if exists (select 1 from public.fee_invoices where invoice_header_id = r.entity_id and amount_paid > 0)
       or exists (select 1 from public.payments where invoice_id = r.entity_id and status in ('pending','succeeded')) then
      raise exception 'entity_changed' using errcode = '40001';
    end if;
    update public.fee_invoices set status = 'void'
     where invoice_header_id = r.entity_id and tenant_id = r.tenant_id and status <> 'void';
  elsif r.action = 'grade_edit_after_publish' then
    update public.grades set score = (v_to ->> 'score')::numeric, remark = v_to ->> 'remark'
     where id = r.entity_id and tenant_id = r.tenant_id
       and score = (v_from ->> 'score')::numeric and remark is not distinct from (v_from ->> 'remark');
  elsif r.action = 'student_transfer_out' then
    update public.students
       set status = 'transferred', transferred_to = v_to ->> 'transferred_to',
           transferred_reason = v_to ->> 'transferred_reason', transferred_on = (v_to ->> 'transferred_on')::date
     where id = r.entity_id and tenant_id = r.tenant_id and status::text = v_from ->> 'status';
  else
    raise exception 'approval_action_unavailable' using errcode = '22023';
  end if;
  get diagnostics n = row_count;
  if n = 0 then
    -- The entity moved on since the request was made; nothing is applied and
    -- the caller's transaction (the approval itself) rolls back.
    raise exception 'entity_changed' using errcode = '40001';
  end if;

  update public.approval_requests set status = 'executed', executed_at = now() where id = p_id;
end $$;

-- ----------------------------------------------------------------- decide --
create function public.decide_approval(p_id uuid, p_decision text, p_payload_hash text, p_reason text default null)
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
     or (r.tenant_id is not null and r.tenant_id is distinct from public.get_tenant_id_for_user(v_uid)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select checker_resource into v_resource from public.approval_actions where action = r.action;
  if not coalesce(public.has_resource_permission(v_uid, v_resource, 'approve'), false) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if r.maker_id = v_uid then raise exception 'maker_cannot_decide' using errcode = '42501'; end if;
  if r.status <> 'pending' then raise exception 'approval_not_pending' using errcode = '22023'; end if;
  if r.expires_at <= now() then raise exception 'approval_expired' using errcode = '22023'; end if;
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
    update public.payments set status = 'failed' where id = r.entity_id and status = 'pending';
  end if;
  return 'rejected';
end $$;

-- ----------------------------------------------------------------- expire --
create function public.expire_approvals()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  with expired as (
    update public.approval_requests set status = 'expired'
     where status = 'pending' and expires_at <= now()
    returning action, entity_id
  ), failed as (
    update public.payments p set status = 'failed'
      from expired e
     where e.action = 'manual_payment_accept' and p.id = e.entity_id and p.status = 'pending'
    returning p.id
  )
  select count(*) into n from expired;
  return n;
end $$;

-- ------------------------------------------------------------ settings RPC --
-- The approval settings are merged into tenant_configs.settings server-side,
-- so this page never rewrites keys it did not read.
create function public.set_approval_settings(p_manual_payment_enabled boolean, p_manual_payment_threshold_etb numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.get_tenant_id_for_user(auth.uid());
  v_cfg jsonb;
begin
  if v_uid is null or v_tenant is null or public.get_role_for_user(v_uid) is distinct from 'school_admin' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_manual_payment_enabled is null or p_manual_payment_threshold_etb is null
     or p_manual_payment_threshold_etb < 0 or p_manual_payment_threshold_etb > 10000000 then
    raise exception 'invalid_settings' using errcode = '22023';
  end if;
  v_cfg := jsonb_build_object(
    'manual_payment_threshold_etb', round(p_manual_payment_threshold_etb, 2),
    'actions', jsonb_build_object('manual_payment_accept', p_manual_payment_enabled));
  insert into public.tenant_configs (tenant_id, settings) values (v_tenant, jsonb_build_object('approvals', v_cfg))
  on conflict (tenant_id) do update
    set settings = coalesce(public.tenant_configs.settings, '{}'::jsonb) || jsonb_build_object('approvals', v_cfg),
        updated_at = now();
  return v_cfg;
end $$;

-- --------------------------------------------------- enforcement: payments --
-- A client may record a cash/bank payment as 'succeeded' or 'pending'; the
-- gate below decides which it becomes.
drop policy if exists payments_manual_insert on public.payments;
create policy payments_manual_insert on public.payments for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and public.has_resource_permission(auth.uid(), 'payments', 'create')
  and provider in ('cash', 'bank')
  and status in ('succeeded', 'pending')
);

-- SECURITY INVOKER on purpose: current_user tells a client insert apart from
-- a trusted definer path (see header).
create function public.payments_manual_approval_gate()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon') and new.provider in ('cash', 'bank')
     and (new.status = 'pending'
          or coalesce(public.approval_required(new.tenant_id, 'manual_payment_accept', new.amount), true)) then
    new.status := 'pending';
    new.paid_at := null;
  end if;
  return new;
end $$;
revoke execute on function public.payments_manual_approval_gate() from public, anon, authenticated;
create trigger payments_manual_approval_gate before insert on public.payments
  for each row execute function public.payments_manual_approval_gate();

-- No payment can be taken against an invoice whose lines are all void.
create function public.payments_reject_void_invoice()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.fee_invoices where invoice_header_id = new.invoice_id)
     and not exists (select 1 from public.fee_invoices where invoice_header_id = new.invoice_id and status <> 'void') then
    raise exception 'invoice_void' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger payments_reject_void_invoice before insert on public.payments
  for each row execute function public.payments_reject_void_invoice();

-- A parked manual payment files its approval request, with the recording
-- user as maker.
create function public.payments_request_approval()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_payload jsonb;
begin
  if auth.uid() is null then return new; end if;
  v_payload := jsonb_build_object(
    'amount', new.amount, 'provider', new.provider, 'provider_ref', new.provider_ref, 'invoice_id', new.invoice_id,
    'from', jsonb_build_object('status', 'pending'),
    'to',   jsonb_build_object('status', 'succeeded'));
  insert into public.approval_requests (tenant_id, action, entity_table, entity_id, payload, payload_hash, maker_id)
  values (new.tenant_id, 'manual_payment_accept', 'payments', new.id, v_payload, public.approval_payload_hash(v_payload), auth.uid());
  return new;
end $$;
create trigger payments_request_approval after insert on public.payments
  for each row when (new.status = 'pending' and new.provider in ('cash', 'bank'))
  execute function public.payments_request_approval();

-- Crediting: on insert as before (succeeded rows only), and now also when an
-- approved payment moves pending → succeeded.
create or replace function public.apply_payment_to_invoice()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_remaining numeric; v_credit numeric;
begin
  if new.status = 'succeeded' then
    v_remaining := new.amount;
    for r in
      select id, amount_due, amount_paid from public.fee_invoices
      where invoice_header_id = new.invoice_id and status not in ('paid', 'void')
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
create trigger apply_manual_payment_on_approval_trg after update of status on public.payments
  for each row when (old.status is distinct from new.status and new.status = 'succeeded' and new.provider in ('cash', 'bank'))
  execute function public.apply_payment_to_invoice();

-- ---------------------------------------------- enforcement: invoice void --
drop policy if exists invoices_delete on public.fee_invoices;
revoke delete on public.fee_invoices from anon, authenticated;
revoke delete on public.invoice_headers from anon, authenticated;

create function public.fee_invoices_void_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.status = 'void' or (tg_op = 'UPDATE' and old.status = 'void')) then
    raise exception 'approval_required' using errcode = '42501',
      hint = 'Voiding an invoice needs an approved invoice_void request (submit_approval).';
  end if;
  return new;
end $$;
revoke execute on function public.fee_invoices_void_guard() from public, anon, authenticated;
create trigger fee_invoices_void_guard before insert or update on public.fee_invoices
  for each row execute function public.fee_invoices_void_guard();

-- Void lines are not money owed.
create or replace view public.invoice_summary with (security_invoker = true) as
  select h.id, h.tenant_id, h.student_id, h.due_date, h.created_at,
         coalesce(sum(fi.amount_due) filter (where fi.status <> 'void'), 0::numeric) as amount_due,
         coalesce(sum(fi.amount_paid), 0::numeric) as amount_paid,
         (case
            when bool_and(fi.status = 'void') then 'void'
            when bool_and(fi.status in ('paid', 'void')) then 'paid'
            when coalesce(sum(fi.amount_paid), 0::numeric) > 0::numeric then 'partial'
            else 'pending'
          end)::public.invoice_status as status,
         count(fi.id) as line_count
  from public.invoice_headers h
  join public.fee_invoices fi on fi.invoice_header_id = h.id
  group by h.id, h.tenant_id, h.student_id, h.due_date, h.created_at;

create or replace function public.dashboard_billing(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := (select public.get_tenant_id_for_user(auth.uid()));
  v_result jsonb;
begin
  if v_tenant is null or not public.dashboard_can_read_finance() then
    return jsonb_build_object('collected', 0, 'overdue', 0,
                              'to_be_collected', 0, 'by_fee_type', '[]'::jsonb);
  end if;

  select jsonb_build_object(
    'collected', coalesce((
      select sum(p.amount) from public.payments p
      where p.tenant_id = v_tenant and p.status = 'succeeded'
        and p.paid_at::date between p_from and p_to), 0),
    -- Outstanding balance, not invoice face value: a partially paid invoice
    -- is overdue for the remainder only. Void lines are not owed (WP-09).
    'overdue', coalesce((
      select sum(i.amount_due - i.amount_paid) from public.fee_invoices i
      where i.tenant_id = v_tenant and i.status not in ('paid', 'void')
        and i.due_date < current_date), 0),
    'to_be_collected', coalesce((
      select sum(i.amount_due - i.amount_paid) from public.fee_invoices i
      where i.tenant_id = v_tenant and i.status not in ('paid', 'void')
        and i.due_date >= current_date), 0),
    'by_fee_type', coalesce((
      select jsonb_agg(jsonb_build_object('name_i18n', name_i18n, 'total', total)
                       order by total desc)
      from (
        select fs.name_i18n, sum(p.amount) total
        from public.payments p
        join public.fee_invoices i on i.id = p.invoice_id
        join public.fee_structures fs on fs.id = i.fee_structure_id
        where p.tenant_id = v_tenant and p.status = 'succeeded'
          and p.paid_at::date between p_from and p_to
        group by fs.name_i18n) z), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

-- ----------------------------------- enforcement: grade edit after publish --
create function public.grades_publication_approval_gate()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.score is distinct from old.score or new.remark is distinct from old.remark
          or new.exam_id is distinct from old.exam_id or new.student_id is distinct from old.student_id
          or new.subject_id is distinct from old.subject_id)
     and coalesce(public.exam_results_published(old.exam_id), true) then
    raise exception 'approval_required' using errcode = '42501',
      hint = 'Results are published; a grade change needs an approved grade_edit_after_publish request (submit_approval).';
  end if;
  return new;
end $$;
revoke execute on function public.grades_publication_approval_gate() from public, anon, authenticated;
create trigger grades_publication_approval_gate before update on public.grades
  for each row execute function public.grades_publication_approval_gate();

-- Unpublishing would reopen direct edits (unpublish → edit → republish
-- sidesteps the request), so a client can no longer take published results
-- back. Corrections go through grade_edit_after_publish.
create function public.academic_terms_unpublish_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon') and old.results_published and not new.results_published then
    raise exception 'results_unpublish_blocked' using errcode = '42501',
      hint = 'Published results stay published; correct a grade with a grade_edit_after_publish request.';
  end if;
  return new;
end $$;
revoke execute on function public.academic_terms_unpublish_guard() from public, anon, authenticated;
create trigger academic_terms_unpublish_guard before update of results_published on public.academic_terms
  for each row execute function public.academic_terms_unpublish_guard();

-- --------------------------------------- enforcement: student transfer out --
create function public.students_transfer_approval_gate()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.status = 'transferred' and old.status is distinct from 'transferred' then
    raise exception 'approval_required' using errcode = '42501',
      hint = 'A transfer out needs an approved student_transfer_out request (submit_approval).';
  end if;
  return new;
end $$;
revoke execute on function public.students_transfer_approval_gate() from public, anon, authenticated;
create trigger students_transfer_approval_gate before update of status on public.students
  for each row execute function public.students_transfer_approval_gate();

-- ------------------------------------------------------------------ grants --
revoke execute on function
  public.approval_required(uuid, text, numeric),
  public.exam_results_published(uuid),
  public.submit_approval(text, uuid, jsonb, text),
  public.execute_approval(uuid),
  public.decide_approval(uuid, text, text, text),
  public.expire_approvals(),
  public.set_approval_settings(boolean, numeric),
  public.payments_reject_void_invoice(),
  public.payments_request_approval()
from public, anon, authenticated;

grant execute on function
  public.approval_required(uuid, text, numeric),
  public.exam_results_published(uuid),
  public.submit_approval(text, uuid, jsonb, text),
  public.decide_approval(uuid, text, text, text),
  public.set_approval_settings(boolean, numeric)
to authenticated;
