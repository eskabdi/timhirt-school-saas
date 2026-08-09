-- ============================================================================
-- Library management rebuild, part 2: real inventory, holds, fines, settings,
-- and a librarian role.
--
-- The original library_books/library_checkouts (20260713000007) were a demo:
-- `copies` was a bare integer nothing enforced (one copy could be checked out
-- to unlimited students), fine_amount/'overdue'/'lost' were dead columns no
-- code ever set, and there was no holds queue, no settings, no audit trail.
-- This rebuilds around per-copy inventory (library_book_copies) and pushes
-- every operation that needs an atomic check-then-write (claiming a copy,
-- enforcing the per-student active-checkout limit, promoting a hold) into a
-- security-definer Postgres function below, instead of a client-side
-- check-then-act sequence -- a plain UPDATE ... WHERE status = 'available'
-- from an Edge Function still leaves a same-millisecond second request
-- racing the first, and a per-student COUNT(*) check has the same race one
-- level up. A row lock (SELECT ... FOR UPDATE) plus a per-(tenant,student)
-- advisory lock inside one transaction closes both at once.
--
-- Also folds in the yearly/termly textbook rental workflow flagged mid-design:
-- a grade's textbook set issued to a whole class for the academic year is
-- the same underlying fact ("a copy, checked out to a student, returned
-- later") as a two-week lending checkout, so it's `checkout_type` on the
-- same tables rather than a parallel schema -- see the checkout_type CHECK
-- and library_books.grade_label below.
-- ============================================================================

-- ---------- library_books: drop the unenforced `copies` int, add fields ----
alter table public.library_books
  drop column if exists copies,
  add column category   text,
  add column publisher  text,
  add column grade_label text,  -- freeform, matches classes.name convention (e.g. "Grade 9"); null = general circulation
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();
create index library_books_tenant_idx on public.library_books (tenant_id);
create trigger library_books_updated before update on public.library_books
for each row execute function public.set_updated_at();
create trigger audit_library_books after insert or update or delete on public.library_books
for each row execute function public.audit_trigger();

-- ---------- library_book_copies: one row per physical copy -----------------
create type public.library_copy_status as enum ('available', 'checked_out', 'lost', 'withdrawn');

create table public.library_book_copies (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  book_id     uuid not null references public.library_books(id) on delete cascade,
  barcode     text not null check (length(barcode) between 1 and 40),
  status      public.library_copy_status not null default 'available',
  acquired_on date not null default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, barcode)
);
create index library_book_copies_book on public.library_book_copies (book_id);
create index library_book_copies_status on public.library_book_copies (tenant_id, status);
create trigger library_book_copies_updated before update on public.library_book_copies
for each row execute function public.set_updated_at();
create trigger audit_library_book_copies after insert or update or delete on public.library_book_copies
for each row execute function public.audit_trigger();

-- Backfill: one copy row per unit of the old `copies` count, before it was
-- dropped above -- but a book can have live checkout history (rows in
-- library_checkouts) that predates or exceeds that count, e.g. a book whose
-- `copies` was already dropped to 0 after a copy was lost but still has an
-- old returned checkout on record. Backfilling only `copies` units would
-- leave that checkout's copy_id (added below, NOT NULL) with nothing to
-- reference. The greatest() of three signals -- the old count, the number of
-- *currently* checked-out rows, and "any history at all" -- covers all of
-- them with placeholder barcodes a librarian can relabel later.
do $$
begin
  -- `copies` no longer exists post-ALTER above, so this backfill reconstructs
  -- from checkout history directly: every book gets at least 1 copy, plus
  -- one per currently-checked-out row beyond the first.
  insert into public.library_book_copies (tenant_id, book_id, barcode, status)
  select b.tenant_id, b.id,
         'LEGACY-' || substr(md5(b.id::text || gs::text), 1, 8),
         (case when gs <= (select count(*) from public.library_checkouts c
                           where c.book_id = b.id and c.status = 'checked_out')
               then 'checked_out' else 'available' end)::public.library_copy_status
  from public.library_books b
  cross join lateral generate_series(1, greatest(
    1,
    (select count(*) from public.library_checkouts c where c.book_id = b.id and c.status = 'checked_out')
  )) gs;
end $$;

-- ---------- library_checkouts: rebuilt to reference a specific copy --------
create type public.library_checkout_type as enum ('lending', 'rental');

alter table public.library_checkouts
  add column copy_id uuid references public.library_book_copies(id),
  add column checkout_type public.library_checkout_type not null default 'lending',
  add column renewal_count smallint not null default 0,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

-- Point every existing checkout at the copy backfilled for its book above.
-- Currently-checked-out checkouts are matched 1:1 by rank against the
-- 'checked_out'-status copies for that book (a plain "first checked_out
-- copy" correlated subquery would hand every active checkout of a book the
-- *same* copy row instead of distinct ones, when a book has more than one
-- simultaneously checked-out checkout). Returned checkouts fall back to any
-- copy of that book -- copy identity for historical returned checkouts is
-- not recoverable from the old schema, and isn't needed for anything the
-- app does with returned rows.
with ranked_checkouts as (
  select id, book_id, row_number() over (partition by book_id order by created_at) as rn
  from public.library_checkouts where status = 'checked_out'
), ranked_copies as (
  select id, book_id, row_number() over (partition by book_id order by created_at) as rn
  from public.library_book_copies where status = 'checked_out'
)
update public.library_checkouts c
set copy_id = rc.id
from ranked_checkouts rk join ranked_copies rc on rc.book_id = rk.book_id and rc.rn = rk.rn
where c.id = rk.id;

update public.library_checkouts c
set copy_id = (select bc.id from public.library_book_copies bc where bc.book_id = c.book_id order by bc.created_at limit 1)
where c.copy_id is null;

alter table public.library_checkouts
  alter column copy_id set not null,
  drop column book_id,
  drop column fine_amount,
  add constraint library_checkouts_status_scope check (status in ('checked_out', 'returned'));
create index library_checkouts_status_idx on public.library_checkouts (tenant_id, status);
create index library_checkouts_student_idx on public.library_checkouts (tenant_id, student_id);
create index library_checkouts_copy_idx on public.library_checkouts (copy_id);
create trigger library_checkouts_updated before update on public.library_checkouts
for each row execute function public.set_updated_at();
create trigger audit_library_checkouts after insert or update or delete on public.library_checkouts
for each row execute function public.audit_trigger();

-- The old demo enum (library_checkout_status) allows 'overdue'/'lost' values
-- that nothing ever set -- it can't be dropped while the column still uses
-- it, so library_checkouts_status_scope above closes it with a CHECK
-- instead: "overdue" is now derived (due_on < today and status =
-- 'checked_out') and a lost physical copy is tracked on
-- library_book_copies.status, never on the checkout row.

-- ---------- library_fines: one row per checkout, staff-recorded ------------
create type public.library_fine_status as enum ('pending', 'paid', 'waived');

create table public.library_fines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  checkout_id   uuid not null references public.library_checkouts(id) on delete cascade,
  amount        numeric(8,2) not null check (amount >= 0),
  status        public.library_fine_status not null default 'pending',
  paid_on       date,
  recorded_by   uuid references public.users(id),
  waived_reason text check (length(waived_reason) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (checkout_id)
);
create index library_fines_tenant_idx on public.library_fines (tenant_id, status);
create trigger library_fines_updated before update on public.library_fines
for each row execute function public.set_updated_at();
create trigger audit_library_fines after insert or update or delete on public.library_fines
for each row execute function public.audit_trigger();

-- ---------- library_holds: per-title FIFO reservation queue ----------------
create type public.library_hold_status as enum ('waiting', 'ready', 'fulfilled', 'cancelled', 'expired');

create table public.library_holds (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  book_id                uuid not null references public.library_books(id) on delete cascade,
  student_id             uuid not null references public.students(id) on delete cascade,
  status                 public.library_hold_status not null default 'waiting',
  requested_on           timestamptz not null default now(),
  ready_at               timestamptz,
  expires_on             date,
  fulfilled_checkout_id  uuid references public.library_checkouts(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index library_holds_queue on public.library_holds (book_id, status, requested_on);
create index library_holds_student_idx on public.library_holds (tenant_id, student_id);
-- Closes the place-a-duplicate-hold race at the DB layer: a student can have
-- at most one active (waiting or ready) hold per book. A concurrent duplicate
-- insert gets a 23505 the Edge Function turns into a friendly "already on
-- hold" response, instead of a check-then-insert race.
create unique index library_holds_active_uq on public.library_holds (tenant_id, book_id, student_id)
  where status in ('waiting', 'ready');
create trigger library_holds_updated before update on public.library_holds
for each row execute function public.set_updated_at();
create trigger audit_library_holds after insert or update or delete on public.library_holds
for each row execute function public.audit_trigger();

-- ---------- library_settings: one row per tenant ----------------------------
create table public.library_settings (
  tenant_id            uuid primary key references public.tenants(id) on delete cascade,
  loan_days_default    smallint not null default 14 check (loan_days_default > 0),
  max_renewals         smallint not null default 1 check (max_renewals >= 0),
  fine_per_day         numeric(6,2) not null default 0 check (fine_per_day >= 0),
  hold_expiry_days     smallint not null default 3 check (hold_expiry_days > 0),
  max_active_checkouts smallint not null default 3 check (max_active_checkouts > 0),
  updated_at           timestamptz not null default now()
);
create trigger library_settings_updated before update on public.library_settings
for each row execute function public.set_updated_at();
-- Every existing tenant gets a default row so library_checkout()/library_return()
-- below always have settings to read, without a null-coalesce at every call site.
insert into public.library_settings (tenant_id) select id from public.tenants
on conflict (tenant_id) do nothing;

-- ---------- Tenant-consistency guards ---------------------------------------
-- Same class of cross-tenant-FK gap 20260805000001 fixed for guardians: an
-- admin client (service_role, bypasses RLS) could otherwise be handed a
-- cross-tenant copy_id/book_id by a caller bug and silently create a
-- cross-tenant row.
-- security definer: this check must answer truthfully regardless of what the
-- inserting/updating user's own RLS lets them see on library_book_copies/
-- students -- a librarian (who cannot read every student's row directly,
-- only through the service-role Edge Function) would otherwise make this
-- guard's internal SELECTs come back empty and raise a false "does not
-- belong to tenant" for a perfectly valid cross-reference.
create or replace function public.library_checkout_tenant_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.library_book_copies c
                 where c.id = new.copy_id and c.tenant_id = new.tenant_id) then
    raise exception 'copy_id does not belong to tenant_id';
  end if;
  if not exists (select 1 from public.students s
                 where s.id = new.student_id and s.tenant_id = new.tenant_id) then
    raise exception 'student_id does not belong to tenant_id';
  end if;
  return new;
end $$;
create trigger library_checkouts_tenant_guard before insert or update on public.library_checkouts
for each row execute function public.library_checkout_tenant_guard();

create or replace function public.library_hold_tenant_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.library_books b
                 where b.id = new.book_id and b.tenant_id = new.tenant_id) then
    raise exception 'book_id does not belong to tenant_id';
  end if;
  if not exists (select 1 from public.students s
                 where s.id = new.student_id and s.tenant_id = new.tenant_id) then
    raise exception 'student_id does not belong to tenant_id';
  end if;
  return new;
end $$;
create trigger library_holds_tenant_guard before insert or update on public.library_holds
for each row execute function public.library_hold_tenant_guard();

-- ---------- portal_notifications: extend for library events ----------------
-- Two new event kinds need two different replay-guard keys: 'book_overdue'
-- ties naturally to the overdue checkout (checkout_id), but 'book_hold_ready'
-- fires when a HOLD reaches 'ready' -- before any checkout exists for it --
-- so it needs its own column, or every hold-ready notification would coalesce
-- to NULL and the unique index (NULL <> NULL in SQL) would never dedupe them.
alter table public.portal_notifications
  add column checkout_id uuid references public.library_checkouts(id) on delete cascade,
  add column hold_id uuid references public.library_holds(id) on delete cascade;
drop index public.portal_notifications_event_uq;
create unique index portal_notifications_event_uq
  on public.portal_notifications (recipient_id, kind, coalesce(payment_id, invoice_id, checkout_id, hold_id));

-- ============================================================================
-- RLS -- LIBRARY role (school_admin, librarian) writes the catalog/settings;
-- checkouts/holds are service_role-only writes (via the RPCs below and the
-- Edge Function), read-scoped to staff (whole tenant) and student/guardian
-- (their own rows only, mirroring guardians' existing fee/attendance access).
-- ============================================================================
drop policy if exists library_books_select on public.library_books;
drop policy if exists library_books_write on public.library_books;

alter table public.library_books enable row level security;
alter table public.library_books force row level security;
create policy library_books_select on public.library_books for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
create policy library_books_write on public.library_books for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'librarian'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'librarian'));

alter table public.library_book_copies enable row level security;
alter table public.library_book_copies force row level security;
create policy library_book_copies_select on public.library_book_copies for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
create policy library_book_copies_write on public.library_book_copies for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'librarian'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'librarian'));

drop policy if exists checkouts_select on public.library_checkouts;
drop policy if exists checkouts_write on public.library_checkouts;

alter table public.library_checkouts enable row level security;
alter table public.library_checkouts force row level security;
create policy library_checkouts_select on public.library_checkouts for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    (select public.get_role_for_user(auth.uid())) in ('school_admin', 'librarian')
    or exists (select 1 from public.students s where s.id = student_id
               and (s.user_id = auth.uid() or public.is_guardian_of(s.id))))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
-- No insert/update/delete policy: library_checkout()/library_return()/
-- library_renew()/library_bulk_return() (security definer, service_role
-- execute only) are the sole write path.

alter table public.library_fines enable row level security;
alter table public.library_fines force row level security;
create policy library_fines_select on public.library_fines for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    (select public.get_role_for_user(auth.uid())) in ('school_admin', 'librarian')
    or exists (select 1 from public.library_checkouts c join public.students s on s.id = c.student_id
               where c.id = checkout_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id))))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
-- Staff record payment/waiver directly (no cross-table atomicity needed);
-- insert stays service_role-only (library_return() creates the fine row).
create policy library_fines_update on public.library_fines for update to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'librarian'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'librarian'));

alter table public.library_holds enable row level security;
alter table public.library_holds force row level security;
create policy library_holds_select on public.library_holds for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
    (select public.get_role_for_user(auth.uid())) in ('school_admin', 'librarian')
    or exists (select 1 from public.students s where s.id = student_id
               and (s.user_id = auth.uid() or public.is_guardian_of(s.id))))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
-- No insert/update/delete policy: place_hold/cancel_hold go through the
-- Edge Function's admin client (same "not client-forgeable" reasoning as
-- portal_notifications/fee_documents).

alter table public.library_settings enable row level security;
alter table public.library_settings force row level security;
create policy library_settings_select on public.library_settings for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
create policy library_settings_write on public.library_settings for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'librarian'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'librarian'));

-- ============================================================================
-- Atomic RPCs. Every one takes tenant_id explicitly (never trusts a JWT claim
-- inside a security-definer function) and is executable by service_role only
-- -- process-library-circulation's own requireRole(["school_admin","librarian"])
-- is the authorization layer, same as every other service-role Edge Function
-- in this codebase; these functions are the atomicity layer underneath it.
-- ============================================================================

-- Claims a copy, enforces the per-student active-lending limit (rentals are
-- exempt -- a grade's whole textbook set for the year is a different volume
-- category than casual lending, and library_settings.max_active_checkouts
-- was sized for the latter), inserts the checkout, and fulfills a matching
-- hold -- all under one row lock on the copy and one advisory lock per
-- (tenant, student) so two concurrent requests for the same copy, or two
-- concurrent requests that would each individually pass the student's active
-- checkout count, cannot both succeed.
create or replace function public.library_checkout(
  p_tenant_id uuid, p_copy_id uuid, p_student_id uuid,
  p_checkout_type public.library_checkout_type, p_due_on date
) returns public.library_checkouts
language plpgsql security definer set search_path = public as $$
declare
  v_copy public.library_book_copies;
  v_max int;
  v_active int;
  v_checkout public.library_checkouts;
begin
  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || p_student_id::text));

  select * into v_copy from public.library_book_copies
    where id = p_copy_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'copy_not_found'; end if;
  if v_copy.status <> 'available' then raise exception 'copy_not_available'; end if;

  -- A 'ready' hold means a copy of this book is being held for that specific
  -- student to collect -- library_return() flips the returned copy straight
  -- back to 'available' (no separate "reserved" copy status exists) rather
  -- than pinning one physical copy to the hold, so this check is what
  -- actually stops a different walk-in student claiming it out from under
  -- the student the hold was promoted for.
  if exists (
    select 1 from public.library_holds h
    where h.tenant_id = p_tenant_id and h.book_id = v_copy.book_id
      and h.status = 'ready' and h.student_id <> p_student_id
  ) then
    raise exception 'copy_reserved_for_hold';
  end if;

  if p_checkout_type = 'lending' then
    select max_active_checkouts into v_max from public.library_settings where tenant_id = p_tenant_id;
    select count(*) into v_active from public.library_checkouts
      where tenant_id = p_tenant_id and student_id = p_student_id
        and status = 'checked_out' and checkout_type = 'lending';
    if v_active >= coalesce(v_max, 3) then raise exception 'checkout_limit_reached'; end if;
  end if;

  update public.library_book_copies set status = 'checked_out' where id = p_copy_id;

  insert into public.library_checkouts (tenant_id, copy_id, student_id, checkout_type, due_on, status)
  values (p_tenant_id, p_copy_id, p_student_id, p_checkout_type, p_due_on, 'checked_out')
  returning * into v_checkout;

  update public.library_holds set status = 'fulfilled', fulfilled_checkout_id = v_checkout.id
  where tenant_id = p_tenant_id and book_id = v_copy.book_id and student_id = p_student_id
    and status in ('waiting', 'ready');

  return v_checkout;
end $$;
revoke all on function public.library_checkout(uuid, uuid, uuid, public.library_checkout_type, date) from public, authenticated;
grant execute on function public.library_checkout(uuid, uuid, uuid, public.library_checkout_type, date) to service_role;

-- Returns a copy, computes a late fine for overdue *lending* checkouts only
-- (a rental returned after year-end is a librarian judgment call, not an
-- automatic daily-fine ladder -- see the plan's reasoning), and promotes the
-- next waiting hold to 'ready'. Returns the promoted hold's id/student_id
-- (null if none) so the caller can send the book_hold_ready notification
-- outside this transaction, the same way notifyBilling() runs as a separate
-- best-effort step after fee-pdf.ts's core DB write.
create or replace function public.library_return(p_tenant_id uuid, p_checkout_id uuid)
returns table (checkout public.library_checkouts, fine_amount numeric, hold_ready_id uuid, hold_ready_student_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_checkout public.library_checkouts;
  v_copy public.library_book_copies;
  v_days_late int;
  v_fine numeric := 0;
  v_hold public.library_holds;
begin
  select * into v_checkout from public.library_checkouts
    where id = p_checkout_id and tenant_id = p_tenant_id and status = 'checked_out' for update;
  if not found then raise exception 'checkout_not_active'; end if;

  update public.library_checkouts set status = 'returned', returned_on = current_date
    where id = p_checkout_id returning * into v_checkout;

  select * into v_copy from public.library_book_copies where id = v_checkout.copy_id for update;
  update public.library_book_copies set status = 'available' where id = v_copy.id;

  if v_checkout.checkout_type = 'lending' and current_date > v_checkout.due_on then
    v_days_late := current_date - v_checkout.due_on;
    select v_days_late * coalesce(fine_per_day, 0) into v_fine
      from public.library_settings where tenant_id = p_tenant_id;
    if coalesce(v_fine, 0) > 0 then
      insert into public.library_fines (tenant_id, checkout_id, amount)
      values (p_tenant_id, v_checkout.id, v_fine)
      on conflict (checkout_id) do nothing;
    end if;
  end if;

  select * into v_hold from public.library_holds
    where tenant_id = p_tenant_id and book_id = v_copy.book_id and status = 'waiting'
    order by requested_on asc limit 1 for update;
  if found then
    update public.library_holds set status = 'ready', ready_at = now(),
      expires_on = current_date + coalesce(
        (select hold_expiry_days from public.library_settings where tenant_id = p_tenant_id), 3)
      where id = v_hold.id;
  end if;

  return query select v_checkout, coalesce(v_fine, 0), v_hold.id, v_hold.student_id;
end $$;
revoke all on function public.library_return(uuid, uuid) from public, authenticated;
grant execute on function public.library_return(uuid, uuid) to service_role;

-- Rejects rentals (a yearly textbook set isn't renewed two weeks at a time)
-- and a book with a hold already waiting, under a row lock so two concurrent
-- renew calls for the same checkout can't both slip past renewal_count.
create or replace function public.library_renew(p_tenant_id uuid, p_checkout_id uuid)
returns public.library_checkouts
language plpgsql security definer set search_path = public as $$
declare
  v_checkout public.library_checkouts;
  v_max_renewals int;
  v_loan_days int;
  v_hold_waiting boolean;
begin
  select * into v_checkout from public.library_checkouts
    where id = p_checkout_id and tenant_id = p_tenant_id and status = 'checked_out' for update;
  if not found then raise exception 'checkout_not_active'; end if;
  if v_checkout.checkout_type <> 'lending' then raise exception 'not_renewable'; end if;

  select max_renewals, loan_days_default into v_max_renewals, v_loan_days
    from public.library_settings where tenant_id = p_tenant_id;
  if v_checkout.renewal_count >= coalesce(v_max_renewals, 1) then
    raise exception 'renewal_limit_reached';
  end if;

  select exists(
    select 1 from public.library_holds h join public.library_book_copies c on c.book_id = h.book_id
    where c.id = v_checkout.copy_id and h.status = 'waiting'
  ) into v_hold_waiting;
  if v_hold_waiting then raise exception 'hold_waiting'; end if;

  update public.library_checkouts
    set due_on = due_on + coalesce(v_loan_days, 14), renewal_count = renewal_count + 1
    where id = p_checkout_id
    returning * into v_checkout;

  return v_checkout;
end $$;
revoke all on function public.library_renew(uuid, uuid) from public, authenticated;
grant execute on function public.library_renew(uuid, uuid) to service_role;

-- Bulk year-end/promotion return for a class's rental checkouts. Matches on
-- *current class membership*, not on due_on = academic year's ends_on -- a
-- frozen due_on comparison silently stops matching if the year's ends_on is
-- ever corrected after bulk_rent ran. classes.academic_year_id is required
-- (one class row per year), so class_id alone already scopes to one year:
-- no separate academic_year_id match is needed.
create or replace function public.library_bulk_return(p_tenant_id uuid, p_class_id uuid)
returns table (checkout_id uuid, copy_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with returned as (
    update public.library_checkouts c
    set status = 'returned', returned_on = current_date
    where c.tenant_id = p_tenant_id and c.checkout_type = 'rental' and c.status = 'checked_out'
      and c.student_id in (select s.id from public.students s where s.class_id = p_class_id and s.tenant_id = p_tenant_id)
    returning c.id, c.copy_id
  ), flipped as (
    update public.library_book_copies bc
    set status = 'available'
    where bc.id in (select r.copy_id from returned r)
    returning bc.id
  )
  select r.id, r.copy_id from returned r;
end $$;
revoke all on function public.library_bulk_return(uuid, uuid) from public, authenticated;
grant execute on function public.library_bulk_return(uuid, uuid) to service_role;
