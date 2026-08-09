-- ============================================================================
-- CRITICAL fix: two RLS policies queried their own table directly inside a
-- USING/WITH CHECK clause instead of going through a SECURITY DEFINER escape
-- function. Postgres detects this at runtime and aborts with "infinite
-- recursion detected in policy for relation X" (42P17) — meaning the C-1 and
-- C-2/C-3 regression-tested paths (self-service identity lock, payroll SoD)
-- never actually ran; every attempt to hit them errored out before the
-- intended `identity_fields_immutable` / `sod_preparer_cannot_approve`
-- exceptions could fire. Found by running supabase/tests/rls/*.sql locally.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- users_self_update (migration 010): the `role` and `tenant_id` checks
-- correctly route through get_role_for_user()/get_tenant_id_for_user()
-- (SECURITY DEFINER, safe), but the `email` check was a raw subquery against
-- public.users from inside a policy defined ON public.users — recursion.
-- Add a matching SECURITY DEFINER helper and use it instead.
-- ---------------------------------------------------------------------------
create or replace function public.get_email_for_user(user_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  return (select email from public.users where id = user_id);
end;
$$;

drop policy if exists users_self_update on public.users;

create policy users_self_update on public.users for update to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and role      = (select public.get_role_for_user(auth.uid()))::public.user_role
  and tenant_id is not distinct from (select public.get_tenant_id_for_user(auth.uid()))
  and email     = (select public.get_email_for_user(auth.uid()))
);

-- ---------------------------------------------------------------------------
-- runs_approve (migration 010): WITH CHECK compared new.prepared_by against
-- `(select prepared_by from public.payroll_runs r where r.id = payroll_runs.id)`
-- — again a raw subquery against the same table the policy protects.
-- The prepared_by-immutability guarantee that subquery existed for is exactly
-- what a BEFORE UPDATE trigger is for: it already has `old`/`new` as plain
-- record fields, no query (and therefore no RLS re-evaluation) required.
-- Move the check into payroll_run_transition() and drop it from the policy.
-- (Also fixes a stray space in the illegal-transition error message:
-- 'illegal_payroll_transition_% _to_%' -> '..._%_to_%'.)
-- ---------------------------------------------------------------------------
create or replace function public.payroll_run_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role text := public.get_role_for_user(auth.uid());
begin
  -- Once paid, the run is immutable (no edits, no reversal via PostgREST).
  if old.status = 'paid' then
    raise exception 'payroll_run_paid_immutable';
  end if;

  -- prepared_by is fixed at insert time; no update path may rewrite it.
  if new.prepared_by is distinct from old.prepared_by then
    raise exception 'prepared_by_immutable';
  end if;

  -- Allowed transitions only.
  if not (
       (old.status = 'draft'    and new.status in ('draft','approved','void'))
    or (old.status = 'approved' and new.status in ('approved','paid','void'))
  ) then
    raise exception 'illegal_payroll_transition_%_to_%', old.status, new.status;
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

drop policy if exists runs_approve on public.payroll_runs;

create policy runs_approve on public.payroll_runs for update to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('accountant','school_admin'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())));
