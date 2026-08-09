-- Timetable, restructured from freeform time ranges to discrete periods.
--
-- timetable_slots had zero conflict-prevention: no constraint stopped the
-- same teacher, class, or room being double-booked in the same slot, and
-- the "periods" a school actually thinks in ("Period 3", not "09:40-10:20")
-- had no representation at all -- TimetableEditorPage derived grid rows from
-- whatever distinct starts_at values happened to already have a slot, so an
-- entirely empty period was invisible rather than an empty row to fill.
--
-- This migration: (1) a real periods table, backfilled per-tenant from each
-- tenant's own existing distinct (starts_at, ends_at) pairs so live data is
-- reinterpreted rather than discarded, with a sensible default 8-period day
-- seeded for any tenant that has no slots yet to derive periods from;
-- (2) timetable_slots points at period_id instead of storing its own times;
-- (3) three constraints that actually prevent double-booking.

-- ---------------------------------------------------------------------------
-- 1. periods
-- ---------------------------------------------------------------------------
create table public.periods (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  period_no  smallint not null check (period_no > 0),
  label      text,
  starts_at  time not null,
  ends_at    time not null,
  is_break   boolean not null default false,
  unique (tenant_id, period_no),
  check (ends_at > starts_at)
);
create index periods_tenant on public.periods (tenant_id, period_no);

alter table public.periods enable row level security;
alter table public.periods force row level security;
-- Same shape as timetable_select/timetable_write (20260713000008): anyone in
-- the tenant reads the schedule, only school_admin edits it.
create policy periods_select on public.periods for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
create policy periods_write on public.periods for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) = 'school_admin');

-- ---------------------------------------------------------------------------
-- 2. Backfill: one period per distinct (starts_at, ends_at) pair each tenant
--    already has in use, ordered by start time.
-- ---------------------------------------------------------------------------
insert into public.periods (tenant_id, period_no, starts_at, ends_at)
select tenant_id,
       (row_number() over (partition by tenant_id order by starts_at))::smallint as period_no,
       starts_at, ends_at
from (select distinct tenant_id, starts_at, ends_at from public.timetable_slots) d;

-- Tenants with no timetable_slots yet (so no periods derived above) get a
-- default 8-period Ethiopian school day, editable later same as any other
-- period once a periods-management UI exists -- this just means Timetable
-- Editor never opens to a grid with literally no rows to place anything into.
insert into public.periods (tenant_id, period_no, label, starts_at, ends_at, is_break)
select t.id, p.period_no, p.label, p.starts_at, p.ends_at, p.is_break
from public.tenants t
cross join (values
  (1, 'Period 1', '08:30'::time, '09:10'::time, false),
  (2, 'Period 2', '09:10'::time, '09:50'::time, false),
  (3, 'Period 3', '09:50'::time, '10:30'::time, false),
  (4, 'Period 4', '10:30'::time, '11:10'::time, false),
  (5, 'Break',    '11:10'::time, '11:30'::time, true),
  (6, 'Period 5', '11:30'::time, '12:10'::time, false),
  (7, 'Period 6', '12:10'::time, '12:50'::time, false),
  (8, 'Period 7', '12:50'::time, '13:30'::time, false),
  (9, 'Period 8', '13:30'::time, '14:10'::time, false)
) as p(period_no, label, starts_at, ends_at, is_break)
where not exists (select 1 from public.periods pp where pp.tenant_id = t.id);

-- ---------------------------------------------------------------------------
-- 3. timetable_slots: point at period_id, drop the freeform times
-- ---------------------------------------------------------------------------
alter table public.timetable_slots add column period_id uuid references public.periods(id);

update public.timetable_slots ts
set period_id = p.id
from public.periods p
where p.tenant_id = ts.tenant_id and p.starts_at = ts.starts_at and p.ends_at = ts.ends_at;

alter table public.timetable_slots alter column period_id set not null;
-- Drops the (starts_at, ends_at)-referencing check constraint along with the
-- columns it depends on -- no separate `drop constraint` needed.
alter table public.timetable_slots drop column starts_at, drop column ends_at;

-- ---------------------------------------------------------------------------
-- 4. Real conflict prevention, replacing "none": a class, a teacher, and (if
--    named) a room can each only be in one place per day+period.
--
-- NOTE for deploy: if a production tenant already has an accumulated double-
-- booking (nothing ever stopped one), these constraints will fail to apply
-- until the conflicting rows are resolved -- check for duplicates on
-- (tenant_id, class_id/teacher_id, day_of_week, period_id) before running
-- this migration against a database with real timetable data in it.
-- ---------------------------------------------------------------------------
alter table public.timetable_slots
  add constraint timetable_class_slot_unique unique (tenant_id, class_id, day_of_week, period_id),
  add constraint timetable_teacher_slot_unique unique (tenant_id, teacher_id, day_of_week, period_id);

create unique index timetable_room_slot_unique on public.timetable_slots (tenant_id, room, day_of_week, period_id)
  where room is not null;

-- ---------------------------------------------------------------------------
-- 5. How many periods/week a class needs of a subject from its assigned
--    teacher -- null means "not tracked", both the manual UI's progress
--    indicator and the generation engine skip an unset target.
-- ---------------------------------------------------------------------------
alter table public.class_subject_teachers
  add column periods_per_week smallint check (periods_per_week is null or periods_per_week between 1 and 20);
