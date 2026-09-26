-- ============================================================================
-- R6 WP-09 (M-06), part 1 of 2: the 'void' invoice status.
--
-- Invoices are no longer deleted: a fee line is voided, and only through an
-- approved `invoice_void` maker-checker request (20260927000002). The label
-- is added in its own migration because a value added by ALTER TYPE … ADD
-- VALUE cannot be used in the same transaction, and the deploy wrapper runs
-- each migration file in one transaction.
-- ============================================================================
alter type public.invoice_status add value if not exists 'void';
