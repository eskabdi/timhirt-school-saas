-- ============================================================================
-- R4-C1: transfer in/out. students.status has had a 'transferred' value
-- since the schema's first migration, with no workflow behind it -- no way
-- to record where a student went, when, or why, and no way to capture
-- where an incoming student came from.
--
-- Transfer OUT: transferred_to/transferred_reason/transferred_on, set
-- together with status='transferred' from a form on the student's own
-- profile page (no new document type -- a status change with a reason,
-- per the confirmed scope). Cleared automatically if a school_admin later
-- moves the student off 'transferred' (e.g. correcting a mistake), same
-- clearing discipline as graduated_ec_year (20260827000001).
--
-- Transfer IN: prior_school_name/prior_grade are plain optional fields on
-- the existing student creation form -- no separate intake flow, per the
-- confirmed scope. They're free-text/historical record only, not linked
-- to any other table.
-- ============================================================================
alter table public.students
  add column transferred_to     text,
  add column transferred_reason text,
  add column transferred_on     date,
  add column prior_school_name  text,
  add column prior_grade        text;

grant select (transferred_to, transferred_reason, transferred_on, prior_school_name, prior_grade)
  on public.students to authenticated;

create or replace function public.student_clear_transfer_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'transferred' and old.status = 'transferred' then
    new.transferred_to := null;
    new.transferred_reason := null;
    new.transferred_on := null;
  end if;
  return new;
end;
$$;

create trigger students_clear_transfer_fields before update of status on public.students
for each row execute function public.student_clear_transfer_fields();
