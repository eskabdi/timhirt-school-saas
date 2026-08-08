-- ============================================================================
-- Ethiopian grade-cycle taxonomy: First Cycle (1-4), Second Cycle (5-8),
-- Lower Secondary (9-10), Upper Secondary (11-12).
--
-- Global, platform-wide reference catalog -- same shape and RLS pattern as
-- school_types/operational_modes (20260810000001): fixed option list, not
-- tenant-editable, seeded once, readable by anyone authenticated, writable
-- only by super_admin.
--
-- grade_cycle_for(smallint) is a small stable SQL helper so any policy,
-- view, or query can resolve "which cycle is grade N in" without repeating
-- the four boundary ranges by hand. Mirrored in TypeScript at
-- src/lib/gradeCycles.ts for client-side grouping without a round trip --
-- same two-independent-implementations approach as src/lib/ethiopian-date.ts
-- vs supabase/functions/_shared/ethiopian-date.ts.
--
-- Grade 0 (pre-primary/KG, allowed by classes.grade_level's own 0-12 check)
-- deliberately has no cycle: MoE's cycle taxonomy starts at Grade 1.
-- grade_cycle_for(0) returns null by design, not a bug.
-- ============================================================================

create table public.grade_cycles (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique check (key ~ '^[a-z_]+$'),
  name_i18n  jsonb not null,                                  -- {"en","am","om"} §16.4
  min_grade  smallint not null check (min_grade between 0 and 12),
  max_grade  smallint not null check (max_grade between 0 and 12),
  sort_order smallint not null,
  check (max_grade >= min_grade)
);

insert into public.grade_cycles (key, name_i18n, min_grade, max_grade, sort_order) values
  ('first_cycle',     '{"en":"First Cycle","am":"የመጀመሪያ ደረጃ","om":"Sadarkaa Jalqabaa"}',            1,  4,  1),
  ('second_cycle',    '{"en":"Second Cycle","am":"ሁለተኛ ደረጃ","om":"Sadarkaa Lammaffaa"}',            5,  8,  2),
  ('lower_secondary', '{"en":"Lower Secondary","am":"ዝቅተኛ ሁለተኛ ደረጃ","om":"Sadarkaa 2ffaa Gadaanaa"}', 9,  10, 3),
  ('upper_secondary', '{"en":"Upper Secondary","am":"ከፍተኛ ሁለተኛ ደረጃ","om":"Sadarkaa 2ffaa Olaanaa"}',  11, 12, 4);

alter table public.grade_cycles enable row level security;
alter table public.grade_cycles force row level security;
create policy grade_cycles_select on public.grade_cycles for select to authenticated using (true);
create policy grade_cycles_write on public.grade_cycles for all to authenticated
using ((select public.get_role_for_user(auth.uid())) = 'super_admin')
with check ((select public.get_role_for_user(auth.uid())) = 'super_admin');

create or replace function public.grade_cycle_for(p_grade_level smallint)
returns uuid language sql stable as $$
  select id from public.grade_cycles
  where p_grade_level between min_grade and max_grade
  limit 1
$$;
