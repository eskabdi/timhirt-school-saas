-- ============================================================================
-- Behavioral tab (Student Profile, tab 4): disciplinary incidents get a
-- category + workflow status; a new student_merits table backs Merits & Awards.
-- discipline_incidents keeps table-level grants (not in the column-revoke set),
-- so the added columns are readable without an extra grant.
-- ============================================================================

alter table public.discipline_incidents
  add column if not exists category text
    check (category is null or category in ('conduct','attendance','academic','property','safety','other')),
  add column if not exists status text not null default 'open'
    check (status in ('open','resolved','escalated'));

-- ---- Merits & Awards -------------------------------------------------------
create table if not exists public.student_merits (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  title       text not null check (length(title) between 1 and 150),
  description text check (description is null or length(description) <= 500),
  category    text check (category is null or category in ('academic','sports','arts','leadership','conduct','service','other')),
  points      integer not null default 0,
  awarded_on  date not null default current_date,
  awarded_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_student_merits_student on public.student_merits(tenant_id, student_id);

alter table public.student_merits enable row level security;
alter table public.student_merits force row level security;

create policy student_merits_select on public.student_merits for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
      and (
        (select public.get_role_for_user(auth.uid())) in ('school_admin','teacher','registrar')
        or exists (select 1 from public.students s where s.id = student_id and s.user_id = auth.uid())
        or exists (select 1 from public.guardians g where g.student_id = student_merits.student_id and g.user_id = auth.uid())
      )));

create policy student_merits_write on public.student_merits for all to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
    and (select public.get_role_for_user(auth.uid())) in ('school_admin','teacher'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
    and (select public.get_role_for_user(auth.uid())) in ('school_admin','teacher'));

grant select on public.student_merits to authenticated;

comment on table public.student_merits is 'Merit points and awards for a student (Behavioral tab).';
