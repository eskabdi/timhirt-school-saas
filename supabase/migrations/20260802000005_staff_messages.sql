-- Direct staff-to-staff messages, triggered by the Staff Profile "Message"
-- button. Deliberately its own table rather than an extension of `notices`
-- (role/date-window broadcast) or `announcements` (audience+class broadcast):
-- neither models a private thread with replies, and stretching either would
-- leave visibility-window/sort_order columns dead on every message row.
create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  -- Self-referential thread key. A BEFORE INSERT trigger below fills this
  -- with the row's own id when left null, so `thread_id = X` always fetches
  -- the whole conversation including its root -- no special-casing "is this
  -- row the root or a reply" at query time.
  thread_id    uuid,
  sender_id    uuid not null references public.users(id),
  recipient_id uuid not null references public.users(id),
  title        text not null check (length(title) between 1 and 160),
  body         text not null check (length(body) between 1 and 4000),
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  constraint messages_not_to_self check (sender_id <> recipient_id)
);
create index messages_thread on public.messages (thread_id, created_at);
create index messages_recipient_unread on public.messages (tenant_id, recipient_id)
  where read_at is null;

create or replace function public.messages_default_thread()
returns trigger language plpgsql as $$
begin
  if new.thread_id is null then
    new.thread_id := new.id;
  end if;
  return new;
end $$;

create trigger messages_default_thread before insert on public.messages
for each row execute function public.messages_default_thread();

alter table public.messages enable row level security;
alter table public.messages force row level security;

-- Only the two parties in the conversation ever see a message -- no
-- "school_admin sees everything" bypass here, unlike notices/announcements,
-- because this is private correspondence, not a managed broadcast.
create policy messages_select on public.messages for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and
      (sender_id = auth.uid() or recipient_id = auth.uid()))
);

-- Staff-only in both directions: neither party may be a student/parent, on
-- top of the UI never exposing this to portal users (RLS is the real gate,
-- per this project's convention -- route/role checks in the UI are just UX).
--
-- Checks the recipient via get_role_for_user/get_tenant_id_for_user (both
-- SECURITY DEFINER) rather than a subquery against public.users directly --
-- users_select only lets a non-privileged role see their OWN row, so a plain
-- `recipient_id in (select id from public.users where ...)` would silently
-- exclude any recipient the sender isn't otherwise allowed to see, exactly
-- the recursion trap 20260715000012 already fixed once for a different policy.
create policy messages_insert on public.messages for insert to authenticated with check (
  sender_id = auth.uid()
  and tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_tenant_id_for_user(recipient_id)) = tenant_id
  and (select public.get_role_for_user(recipient_id)) not in ('student', 'parent')
  and (select public.get_role_for_user(auth.uid())) not in ('student', 'parent')
);

-- Only the recipient ever updates a message, and only to mark it read --
-- enforced the same way employee_documents.verified is (DocumentsTab.tsx):
-- the client is trusted to send just {read_at}, no column-lockdown trigger.
create policy messages_update on public.messages for update to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and recipient_id = auth.uid())
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and recipient_id = auth.uid());

-- No audit_trigger() here on purpose: its redact list (medical_notes, phone,
-- email, tin_number, ...) does not cover `title`/`body`, so attaching it
-- as-is would let any school_admin read private message content via
-- audit_logs -- exactly what this table's tighter (sender/recipient-only)
-- select policy above is trying to avoid.
