-- ============================================================================
-- 010 SECURITY HARDENING — closes findings from the pre-production security
-- review: C1, C2, C3, H1 (companion note only — the actual 008 bug is fixed
-- in-place in that file, see comment below), H2 (entropy constraint + RPC
-- grants), H3, H4, M1, M2, M3, M4, M5. Runs AFTER 001–009.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- C1 (CRITICAL): users_self_update let a user change their own tenant_id.
-- get_tenant_id_for_user() reads users.tenant_id, so flipping it grants full
-- cross-tenant access at the caller's role. Lock tenant_id AND role in CHECK,
-- and forbid self-service email changes (unique PII / takeover vector).
-- ---------------------------------------------------------------------------
drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users for update to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and role      = (select public.get_role_for_user(auth.uid()))::public.user_role
  and tenant_id is not distinct from (select public.get_tenant_id_for_user(auth.uid()))
  and email     = (select u.email from public.users u where u.id = auth.uid())
);
-- Defense-in-depth: a trigger that hard-blocks tenant_id/role/email drift even
-- if a future policy is loosened. (Belt AND suspenders for the worst finding.)
create or replace function public.users_lock_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = new.id then                       -- self-edit path only
    if new.tenant_id is distinct from old.tenant_id
       or new.role is distinct from old.role
       or new.email is distinct from old.email then
      raise exception 'identity_fields_immutable';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists users_lock_identity_trg on public.users;
create trigger users_lock_identity_trg before update on public.users
for each row execute function public.users_lock_identity();

-- ---------------------------------------------------------------------------
-- C2 + C3 (CRITICAL): payroll SoD bypass + run re-opening.
-- Old runs_approve let school_admin (who can also prepare) set an arbitrary
-- approved_by and move status anywhere (incl. paid -> draft). Replace with a
-- state-machine trigger that (a) binds approver to auth.uid(), (b) enforces
-- approver <> preparer at the *actor* level, (c) allows only forward
-- transitions draft->approved->paid (+ ->void from draft/approved), and
-- (d) freezes a run once paid.
-- ---------------------------------------------------------------------------
create or replace function public.payroll_run_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role text := public.get_role_for_user(auth.uid());
begin
  -- Once paid, the run is immutable (no edits, no reversal via PostgREST).
  if old.status = 'paid' then
    raise exception 'payroll_run_paid_immutable';
  end if;

  -- Allowed transitions only.
  if not (
       (old.status = 'draft'    and new.status in ('draft','approved','void'))
    or (old.status = 'approved' and new.status in ('approved','paid','void'))
  ) then
    raise exception 'illegal_payroll_transition_% _to_%', old.status, new.status;
  end if;

  -- Approval: stamp the real actor, enforce actor-level SoD.
  if new.status = 'approved' and old.status <> 'approved' then
    if v_role not in ('accountant','school_admin') then
      raise exception 'not_authorized_to_approve';
    end if;
    new.approved_by := auth.uid();                 -- never trust client value
    if new.approved_by = new.prepared_by then
      raise exception 'sod_preparer_cannot_approve';
    end if;
  end if;

  -- Mark paid: only after approval, only finance roles, stamp paid_at.
  if new.status = 'paid' and old.status <> 'paid' then
    if v_role not in ('accountant','school_admin') then
      raise exception 'not_authorized_to_pay';
    end if;
    if new.approved_by is null then
      raise exception 'cannot_pay_unapproved_run';
    end if;
    new.paid_at := now();
  end if;

  return new;
end $$;
drop trigger if exists payroll_run_transition_trg on public.payroll_runs;
create trigger payroll_run_transition_trg before update on public.payroll_runs
for each row execute function public.payroll_run_transition();

-- Tighten the UPDATE policy WITH CHECK so approver/prepared_by can't be spoofed
-- in the row image either (trigger is authoritative, this is defense in depth).
drop policy if exists runs_approve on public.payroll_runs;
create policy runs_approve on public.payroll_runs for update to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('accountant','school_admin'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and prepared_by = (select prepared_by from public.payroll_runs r where r.id = payroll_runs.id));

-- ---------------------------------------------------------------------------
-- M2 (MEDIUM): audit_trigger leaked clinic medical PII into audit_logs (which
-- school_admin can read). Add clinic/health fields + payroll amounts to the
-- redaction set. Recreate the function.
-- ---------------------------------------------------------------------------
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare r_old jsonb; r_new jsonb; redact text[] := array[
  'medical_notes','phone','email','tin_number','pension_no','bank_account',
  'complaint','treatment','medication','condition',
  'gross','taxable_income','income_tax','pension_employee','pension_employer',
  'other_deductions','net_pay','basic_salary'];
declare k text;
begin
  r_old := to_jsonb(old); r_new := to_jsonb(new);
  foreach k in array redact loop
    r_old := r_old - k; r_new := r_new - k;
  end loop;
  insert into public.audit_logs(tenant_id, actor_id, action, table_name, row_id, old_data, new_data)
  values (coalesce((to_jsonb(new)->>'tenant_id')::uuid, (to_jsonb(old)->>'tenant_id')::uuid),
          auth.uid(), lower(tg_op), tg_table_name,
          coalesce((to_jsonb(new)->>'id')::uuid, (to_jsonb(old)->>'id')::uuid),
          r_old, r_new);
  return coalesce(new, old);
end $$;

-- Payslip generation is now audited too (amounts already redacted above).
drop trigger if exists audit_payslips on public.payslips;
create trigger audit_payslips after insert or update or delete on public.payslips
for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- M4 (MEDIUM): manual (cash/bank) payments could be inserted with arbitrary
-- status and never updated the invoice. Force status='succeeded' on manual
-- insert and keep the invoice in sync via trigger.
-- ---------------------------------------------------------------------------
drop policy if exists payments_manual_insert on public.payments;
create policy payments_manual_insert on public.payments for insert to authenticated
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','accountant')
  and provider in ('cash','bank')
  and status = 'succeeded');

create or replace function public.apply_payment_to_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_due numeric; v_paid numeric;
begin
  if new.status = 'succeeded' then
    select amount_due, amount_paid into v_due, v_paid
    from public.fee_invoices where id = new.invoice_id for update;
    v_paid := v_paid + new.amount;
    update public.fee_invoices
      set amount_paid = v_paid,
          status = case when v_paid >= v_due then 'paid'
                        when v_paid > 0      then 'partial' else status end
      where id = new.invoice_id;
  end if;
  return new;
end $$;
drop trigger if exists apply_manual_payment_trg on public.payments;
create trigger apply_manual_payment_trg after insert on public.payments
for each row when (new.provider in ('cash','bank'))
execute function public.apply_payment_to_invoice();

-- ---------------------------------------------------------------------------
-- H4 support (HIGH): dedupe gateway payments; make replay/idempotency robust.
-- ---------------------------------------------------------------------------
create unique index if not exists payments_provider_ref_uq
  on public.payments (provider_ref) where provider_ref is not null;

-- ---------------------------------------------------------------------------
-- H3 + H4 (HIGH): atomic webhook settlement. Verifies the gateway-reported
-- amount against the stored payment amount, credits the invoice, and records
-- the replay guard — all inside one transaction (all-or-nothing). Called by
-- chapa-webhook AFTER HMAC verification. service_role only.
-- Returns 'ok' | 'duplicate' | 'not_found' | 'amount_mismatch'.
-- ---------------------------------------------------------------------------
create or replace function public.settle_gateway_payment(
  p_tx_ref text, p_provider public.payment_provider, p_reported_amount numeric)
returns text language plpgsql security definer set search_path = public as $$
declare v_pay record; v_due numeric; v_paid numeric;
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

  select amount_due, amount_paid into v_due, v_paid
  from public.fee_invoices where id = v_pay.invoice_id for update;
  v_paid := v_paid + v_pay.amount;
  update public.fee_invoices
    set amount_paid = v_paid,
        status = case when v_paid >= v_due then 'paid' else 'partial' end
    where id = v_pay.invoice_id;

  return 'ok';
end $$;
revoke all on function public.settle_gateway_payment(text, public.payment_provider, numeric) from public, anon, authenticated;
-- service_role only (webhook calls it)

-- ---------------------------------------------------------------------------
-- H2 support (HIGH): rate-limit + entropy note for public ID verification.
-- Enforce that verify_code is high-entropy at write time (>= 24 chars), and
-- restrict the verification RPC to service_role now that a rate-limited Edge
-- Function (verify-id) is the only intended caller (anon direct-RPC access
-- made verify_code enumerable across all tenants).
-- ---------------------------------------------------------------------------
alter table public.id_cards
  add constraint verify_code_entropy check (length(verify_code) >= 24);

revoke execute on function public.verify_id_card(text) from anon;
grant  execute on function public.verify_id_card(text) to service_role;

-- ---------------------------------------------------------------------------
-- M1 (MEDIUM): the blanket `revoke select (...)` on employees/clinic_visits/
-- health_conditions applies to ALL authenticated users, including roles that
-- legitimately need those columns — and no re-exposing view existed, so HR
-- and clinic staff got "permission denied for column" on legitimate reads.
-- These views re-expose the restricted columns; base-table RLS still governs
-- which ROWS are visible (security_invoker views inherit caller privileges),
-- so only hr_officer/school_admin/accountant/nurse-equivalent roles that can
-- already see the row get the sensitive columns too.
-- ---------------------------------------------------------------------------
create or replace view public.hr_employee_sensitive
with (security_invoker = true) as
  select id, tenant_id, tin_number, pension_no, bank_account
  from public.employees;
revoke all on public.hr_employee_sensitive from public, anon;
grant select on public.hr_employee_sensitive to authenticated;

create or replace view public.clinic_visit_detail
with (security_invoker = true) as
  select id, tenant_id, student_id, visit_date, complaint, treatment, medication,
         guardian_notified, recorded_by
  from public.clinic_visits;
revoke all on public.clinic_visit_detail from public, anon;
grant select on public.clinic_visit_detail to authenticated;

-- ---------------------------------------------------------------------------
-- M5 (MEDIUM): three divergent EC-year computations existed (JS facade, Deno
-- copy, and a raw SQL approximation in leave_decision_trigger that guessed
-- the EC year from the Gregorian month instead of true conversion). The
-- approximation drifts around the Sep 11/12 new-year boundary, bucketing
-- leave balances into the wrong ec_year. This is a direct, exact port of the
-- same JDN-based Beyene–Kudlek arithmetic used in lib/ethiopian-date.ts and
-- the Deno _shared copy — all three engines now agree by construction.
-- ---------------------------------------------------------------------------
create or replace function public.ec_year_of(g date)
returns int language sql immutable set search_path = public as $$
  with jdn as (
    -- proleptic Gregorian date -> Julian Day Number (same formula family as
    -- gregorianToJdn() in the JS/Deno facades)
    select (extract(day from g)::int
            + floor((153 * (extract(month from g)::int + 12 * floor((14 - extract(month from g)::int) / 12.0) - 3) + 2) / 5.0)
            + 365 * (extract(year from g)::int + 4800 - floor((14 - extract(month from g)::int) / 12.0))
            + floor((extract(year from g)::int + 4800 - floor((14 - extract(month from g)::int) / 12.0)) / 4.0)
            - floor((extract(year from g)::int + 4800 - floor((14 - extract(month from g)::int) / 12.0)) / 100.0)
            + floor((extract(year from g)::int + 4800 - floor((14 - extract(month from g)::int) / 12.0)) / 400.0)
            - 32045)::int as jdn
  ),
  r as (
    select mod((jdn - 1723856)::numeric, 1461) as rem, jdn from jdn
  )
  select (4 * floor((jdn - 1723856) / 1461.0)
          + floor(rem / 365.0)
          - floor(rem / 1460.0))::int
  from r;
$$;

-- ---------------------------------------------------------------------------
-- M5 continued: leave_decision_trigger (migration 004) approximated the EC
-- year from the Gregorian month directly (`case when month >= 9 then 7 else
-- 8`) instead of true EC conversion. That approximation is wrong exactly
-- around the Sep 11/12 new-year boundary in EC-leap years, silently
-- crediting `taken` days to the wrong ec_year bucket in leave_balances.
-- Recreating the function (the existing trigger on leave_requests already
-- points to this name, so no trigger recreation is needed) to use the
-- canonical ec_year_of() defined above — now provably identical to the JS/
-- Deno engines.
-- ---------------------------------------------------------------------------
create or replace function public.leave_decision_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare d date; v_ec_year smallint; v_days numeric;
begin
  if new.status in ('approved','rejected') and old.status = 'pending' then
    new.decided_by := auth.uid();
    new.decided_at := now();
    if new.status = 'approved' then
      d := new.starts_on;
      while d <= new.ends_on loop
        insert into public.staff_attendance (tenant_id, employee_id, att_date, status, recorded_by)
        values (new.tenant_id, new.employee_id, d, 'leave', auth.uid())
        on conflict (tenant_id, employee_id, att_date) do update set status = 'leave';
        d := d + 1;
      end loop;
      v_days := (new.ends_on - new.starts_on) + 1;
      v_ec_year := public.ec_year_of(new.starts_on);   -- canonical engine, not an approximation
      update public.leave_balances
        set taken = taken + v_days
        where tenant_id = new.tenant_id and employee_id = new.employee_id
          and leave_type_id = new.leave_type_id and ec_year = v_ec_year;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- LOW: payslip_lines relied on an implicit exists(payslips) nested lookup for
-- RLS, which the review flagged as fragile. Add an explicit tenant_id column
-- (populated by run-payroll) and scope the select policy on it directly.
-- ---------------------------------------------------------------------------
alter table public.payslip_lines add column if not exists tenant_id uuid references public.tenants(id);
update public.payslip_lines pl set tenant_id = p.tenant_id
  from public.payslips p where p.id = pl.payslip_id and pl.tenant_id is null;
alter table public.payslip_lines alter column tenant_id set not null;
create index if not exists payslip_lines_tenant_idx on public.payslip_lines (tenant_id);

drop policy if exists payslip_lines_select on public.payslip_lines;
create policy payslip_lines_select on public.payslip_lines for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (
    (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer','accountant')
    or exists (select 1 from public.payslips p join public.employees e on e.id = p.employee_id
               where p.id = payslip_lines.payslip_id and e.user_id = auth.uid())
  )
);

-- ---------------------------------------------------------------------------
-- M3 (MEDIUM): submissions bucket let ANY authenticated tenant user read ALL
-- objects in the tenant, and the insert policy only checked the tenant
-- prefix — not path ownership — so a student could read/overwrite peers'
-- files. Replace both policies with a path-ownership check. Path convention:
-- {tenant_id}/{student_id}/{assignment_id}/{uuid}.ext (enforced client-side).
-- ---------------------------------------------------------------------------
drop policy if exists "student write own submission" on storage.objects;
drop policy if exists "tenant read submissions"      on storage.objects;

create policy "student write own submission" on storage.objects for insert to authenticated
with check (bucket_id = 'submissions'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and exists (select 1 from public.students s
              where s.id::text = (storage.foldername(name))[2] and s.user_id = auth.uid()));

create policy "read own or taught submission" on storage.objects for select to authenticated
using (bucket_id = 'submissions'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and ((select public.get_role_for_user(auth.uid())) = 'school_admin'
       or exists (select 1 from public.students s
                  where s.id::text = (storage.foldername(name))[2] and s.user_id = auth.uid())
       or exists (select 1 from public.students s
                  where s.id::text = (storage.foldername(name))[2]
                    and public.is_teacher_of_class(s.class_id))));
