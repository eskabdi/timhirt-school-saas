-- ============================================================================
-- Guardian display name.
--
-- public.guardians has carried relationship/phone/email since 20260713000002
-- but never a name: the only name available was via the optional user_id link
-- to an actual portal account, so a guardian who has never been invited showed
-- as "—" everywhere. The public admission form already collects a guardian
-- name (admission_applications.guardian_name), and the student profile's Edit
-- Profile form now edits the guardian inline, so the column that both of those
-- need has to exist.
--
-- Nullable: existing rows have no name to backfill from here, and a guardian
-- linked to a portal user can still fall back to users.full_name at read time.
-- ============================================================================

alter table public.guardians
  add column if not exists full_name text
    check (full_name is null or length(full_name) between 1 and 120);  -- 🔒 PII

-- Backfill from the admission application that produced the student.
-- admission_applications.converted_student_id is set at enrollment, so it is
-- an exact link — no name matching required.
update public.guardians g
set full_name = a.guardian_name
from public.admission_applications a
where a.converted_student_id = g.student_id
  and a.tenant_id = g.tenant_id
  and g.full_name is null
  and a.guardian_name is not null;
