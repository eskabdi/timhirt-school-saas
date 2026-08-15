-- ============================================================================
-- R4-B6: leaving certificates + graduating-cohort report.
--
-- Deliberately NOT part of the id_cards module gate, despite the naming
-- similarity -- that module governs ID cards specifically (id_cards/
-- id_card_batches, see 20260821000003_module_gating_rls.sql). Leaving
-- certificates remain available at every tier: no has_module() check
-- anywhere in this migration, and the frontend route/nav entry carry no
-- `module` prop either (see router.tsx/DashboardShell.tsx changes).
--
-- graduated_ec_year captures which Ethiopian academic year a student
-- graduated in, read from their class's own academic_year at the moment
-- status flips to 'graduated' -- not a raw Gregorian-to-Ethiopian date
-- conversion (which would need calendar math duplicated into SQL), and
-- not "today's EC year" (which would be wrong for a graduation backfilled
-- or corrected after the fact). This is also what "graduating cohort of EC
-- year X" actually means operationally: the year of the academic year they
-- left in, matching how promote_students_batch's graduate branch and any
-- manual status edit both already work through students.status.
-- ============================================================================
alter table public.students add column graduated_ec_year smallint;

-- Column-level grants on students are an explicit allow-list, fail-closed
-- for new columns (see 20260715000013_column_level_grants.sql) -- without
-- this, graduated_ec_year would silently be unreadable by every
-- authenticated role despite passing RLS.
grant select (graduated_ec_year) on public.students to authenticated;

create or replace function public.student_capture_graduation_year()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'graduated' and old.status is distinct from 'graduated' then
    select ay.ec_year into new.graduated_ec_year
    from public.classes c join public.academic_years ay on ay.id = c.academic_year_id
    where c.id = new.class_id;
  elsif new.status <> 'graduated' and old.status = 'graduated' then
    -- Un-graduating (e.g. a promotion-run revert) clears the stamp so a
    -- student back on an active roster doesn't still show up in a cohort
    -- report.
    new.graduated_ec_year := null;
  end if;
  return new;
end;
$$;

create trigger students_capture_graduation_year before update of status on public.students
for each row execute function public.student_capture_graduation_year();
