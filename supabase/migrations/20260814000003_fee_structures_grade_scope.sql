-- ============================================================================
-- fee_structures gains two new scope columns so a fee can be billed at
-- grade-level (all sections of one grade -- also fixes the pre-existing bug
-- where FeeStructuresPage's "grade" picker actually only ever targeted one
-- arbitrary section, because classes has one row per section and the UI
-- picked the first section's class_id as a stand-in for the whole grade)
-- or at cycle-level (all grades within one of the four grade_cycles rows).
--
-- At most one of class_id / grade_level / grade_cycle_id may be set --
-- all-null keeps today's "all classes, tenant-wide" meaning unchanged. Both
-- new columns nullable, no backfill: every existing row already has
-- class_id set-or-null and now simply has grade_level/grade_cycle_id null,
-- which the CHECK still accepts (0 or 1 of the three set).
--
-- No RLS changes: fee_structures_write (20260713000005, school_admin only)
-- already governs the whole row.
-- ============================================================================

alter table public.fee_structures
  add column grade_level smallint check (grade_level between 0 and 12),
  add column grade_cycle_id uuid references public.grade_cycles(id),
  add constraint fee_structures_scope_check check (
    (case when class_id is not null then 1 else 0 end
   + case when grade_level is not null then 1 else 0 end
   + case when grade_cycle_id is not null then 1 else 0 end) <= 1
  );
