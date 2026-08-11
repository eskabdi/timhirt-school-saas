-- ============================================================================
-- R4-B1: per-period attendance. Nullable period_id preserves "whole day" for
-- every existing row and every school that never turns this on.
--
-- The old uniqueness invariant -- one row per (tenant, student, date, class)
-- -- must be reproduced EXACTLY for the period_id IS NULL case. A plain
-- multi-column UNIQUE constraint would NOT do this: Postgres treats every
-- NULL as distinct from every other NULL for uniqueness purposes, so
-- widening the existing constraint to include period_id would silently
-- allow duplicate "whole day" rows the moment period_id is nullable.
--
-- Two PARTIAL unique indexes would fix the NULL semantics, but the client
-- upserts through a single .upsert(rows, { onConflict: "..." }) call, and
-- Postgres's plain `ON CONFLICT (columns)` inference does NOT match a
-- partial index unless the exact predicate is repeated in the ON CONFLICT
-- clause itself -- which the Supabase/PostgREST upsert API has no way to
-- express. period_key sidesteps this: a generated, stored column that
-- normalizes NULL to a fixed sentinel UUID, so ONE ordinary (non-partial)
-- unique index enforces the identical uniqueness semantics and a single
-- plain onConflict column list resolves correctly from the client either way.
-- ============================================================================
alter table public.attendance add column period_id uuid references public.periods(id);

alter table public.attendance drop constraint attendance_tenant_id_student_id_attendance_date_class_id_key;

alter table public.attendance add column period_key uuid
  generated always as (coalesce(period_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored;

alter table public.attendance add constraint attendance_unique_key
  unique (tenant_id, student_id, attendance_date, class_id, period_key);

-- attendance_guard (20260713000003) is already a BEFORE INSERT/UPDATE
-- trigger on this exact table -- extended in place rather than adding a
-- second trigger, same as exam_class_scoping's guard on exams.class_id
-- (20260821000004): when period_id is set, it must belong to the same
-- tenant as the attendance row itself.
create or replace function public.attendance_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.calendar_events ce
             where ce.tenant_id = new.tenant_id
               and ce.event_date = new.attendance_date
               and ce.event_type in ('holiday','national')) then
    raise exception 'attendance_blocked_holiday';
  end if;
  if new.period_id is not null and not exists (
    select 1 from public.periods p where p.id = new.period_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'period_id must belong to the same tenant';
  end if;
  new.recorded_by := auth.uid();   -- never trusted from client
  return new;
end $$;

-- Per-class switch: 'daily' (default, unchanged behavior) or 'per_period'
-- (marking UI shows a period selector and records one row per period).
create type public.attendance_mode as enum ('daily', 'per_period');
alter table public.classes add column attendance_mode public.attendance_mode not null default 'daily';
