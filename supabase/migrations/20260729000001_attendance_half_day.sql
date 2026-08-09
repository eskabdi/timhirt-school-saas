-- ============================================================================
-- attendance_status gains 'half_day'.
--
-- The dashboard's weekly attendance chart plots three series — present, absent
-- and half day — and the enum only carried present/absent/late/excused. A half
-- day is not a late arrival: the student was there for part of the timetable
-- by arrangement, which is a different fact about the day and one schools bill
-- and report on separately.
--
-- This is deliberately alone in its own migration. ALTER TYPE ... ADD VALUE
-- runs fine inside the deploy wrapper's transaction, but the new label cannot
-- be *used* in that same transaction. Keeping the functions that read it in
-- the next file guarantees that separation regardless of how the two are
-- batched.
-- ============================================================================

do $$ begin
  alter type public.attendance_status add value if not exists 'half_day';
exception when duplicate_object then null; end $$;
