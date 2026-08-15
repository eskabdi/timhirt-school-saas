-- R4-B2: notify every guardian with a portal login when their student is
-- marked absent or late. Fires from the ordinary client-side attendance
-- upsert (school_admin/teacher role), not an Edge Function, so the insert
-- has to clear portal_notifications' FORCE RLS itself -- same
-- security-definer-bypasses-force-rls pattern audit_trigger() already
-- relies on for audit_logs.

alter table public.portal_notifications
  add column attendance_id uuid references public.attendance(id) on delete cascade;

-- Extend the existing replay-guard index (recipient, kind, one event ref) --
-- already widened once for library (checkout_id, hold_id) -- rather than
-- adding a parallel one. attendance_id joins the same coalesce chain, so one
-- notification survives per (recipient, kind, source-row), same idempotency
-- contract as billing and library.
drop index public.portal_notifications_event_uq;
create unique index portal_notifications_event_uq
  on public.portal_notifications (recipient_id, kind, coalesce(payment_id, invoice_id, checkout_id, hold_id, attendance_id));

create or replace function public.attendance_notify_guardians()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind public.portal_notification_kind;
  v_guardian record;
begin
  if new.status = 'absent' then
    v_kind := 'attendance_absent';
  elsif new.status = 'late' then
    v_kind := 'attendance_late';
  else
    return new;
  end if;

  for v_guardian in
    select user_id from public.guardians
    where student_id = new.student_id and user_id is not null
  loop
    insert into public.portal_notifications (tenant_id, recipient_id, student_id, kind, attendance_id)
    values (new.tenant_id, v_guardian.user_id, new.student_id, v_kind, new.id)
    on conflict do nothing;
  end loop;

  return new;
end;
$$;

create trigger attendance_notify_guardians
after insert or update of status on public.attendance
for each row execute function public.attendance_notify_guardians();
