-- ============================================================================
-- Wires operational_mode (20260810000001: Full-Day / Double Shift) into the
-- timetable engine and teacher scheduling.
--
-- A double-shift school runs two parallel sessions -- e.g. a morning shift
-- 07:30-12:00 and an afternoon shift 12:30-17:00 -- so "Period 1" means a
-- different literal clock time depending which shift a class belongs to.
-- That needs its own period row per shift (a single row can't hold two
-- starts_at/ends_at pairs), so `shift` lands on periods, not just classes.
--
-- All three new columns are nullable and mean "no shift constraint" when
-- null -- a full-day tenant (or any tenant before this ships) never sets
-- them, and every existing row/query keeps working unchanged. generateTimetable()
-- (src/features/timetable/generateTimetable.ts) treats a null shift on
-- either side of the match as a wildcard.
--
-- No new RLS policy is needed for any of the three columns: periods_write,
-- classes_write, and teachers_write already gate UPDATE at the row level for
-- school_admin (teachers_write also hr_officer) in-tenant, and none of the
-- three tables has ever had a column-level SELECT grant narrowed (unlike
-- employees -- see 20260713000010_security_hardening.sql's trap, which does
-- not apply here).
-- ============================================================================

create type public.shift as enum ('morning', 'afternoon');

alter table public.classes add column shift public.shift;
alter table public.teachers add column shift public.shift;

alter table public.periods add column shift public.shift;
-- Two shifts legitimately share the same period_no (each shift numbers its
-- own periods 1..N), so period_no alone can no longer be the uniqueness key.
alter table public.periods drop constraint periods_tenant_id_period_no_key;
alter table public.periods add constraint periods_tenant_period_shift_unique unique (tenant_id, period_no, shift);
