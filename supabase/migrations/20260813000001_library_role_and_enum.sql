-- ============================================================================
-- Library management rebuild, part 1: new enum labels only.
--
-- Standalone file because a new enum label cannot be used in the same
-- transaction that adds it -- the schema rebuild in the next migration
-- (which creates policies/functions referencing 'librarian' and inserts
-- 'book_overdue'/'book_hold_ready' notification rows) needs these committed
-- first.
-- ============================================================================
alter type public.user_role add value 'librarian';
alter type public.portal_notification_kind add value 'book_overdue';
alter type public.portal_notification_kind add value 'book_hold_ready';
