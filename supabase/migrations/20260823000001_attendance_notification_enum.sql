-- R4-B2: new portal_notification_kind labels for guardian attendance alerts.
-- Split into its own migration because a newly added enum label cannot be
-- used in the same transaction it was added in (see 20260813000001/2 for
-- the same split applied to the library rebuild).
alter type public.portal_notification_kind add value if not exists 'attendance_absent';
alter type public.portal_notification_kind add value if not exists 'attendance_late';
