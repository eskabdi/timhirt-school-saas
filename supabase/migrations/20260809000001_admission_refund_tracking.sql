-- ============================================================================
-- Refund tracking for admission registration payments. A rejected (or
-- otherwise never-enrolled) applicant may have already paid the declared
-- registration fee (admission_applications.fees_total_etb, receipt on file
-- at payment_receipt_path) -- that payment structurally cannot enter the
-- fee_invoices/payments schema, since fee_invoices.student_id is NOT NULL
-- and a rejected applicant never gets a students row. This adds a minimal
-- status flag directly on the application so staff can track the refund
-- through to completion, discovered as a real gap: an applicant was
-- rejected with a 5000 ETB registration payment already on file and there
-- was no way to record that it needed to go back to the family.
--
-- No new RLS policy: these are new columns on an existing table, already
-- covered by admissions_write (school_admin/registrar, same tenant) from
-- 20260713000008_extended_rls.sql.
-- ============================================================================

create type public.admission_refund_status as enum ('not_applicable', 'pending', 'completed');

alter table public.admission_applications
  add column refund_status public.admission_refund_status not null default 'not_applicable',
  add column refund_notes text check (length(refund_notes) <= 500),
  add column refund_processed_at timestamptz,
  add column refund_processed_by uuid references public.users(id);
