-- ============================================================================
-- employee_status gains 'draft'.
--
-- Staff registration is a four-step form with "Save as Draft" on every step. A
-- half-entered employee has to be a real row — the stepper persists after each
-- step so a registrar can leave and come back, and so an upload in step 4 has
-- an employee_id to hang off — but it must not appear in headcounts, payroll
-- runs or the employee list until it is finished.
--
-- Alone in its own migration: ALTER TYPE ... ADD VALUE runs fine inside the
-- deploy wrapper's transaction, but the new label cannot be *used* in that same
-- transaction, and the next file's policies and defaults reference it.
-- ============================================================================

do $$ begin
  alter type public.employee_status add value if not exists 'draft';
exception when duplicate_object then null; end $$;
