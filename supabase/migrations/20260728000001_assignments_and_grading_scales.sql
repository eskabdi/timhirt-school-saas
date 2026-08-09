-- ============================================================================
-- Assignment Management and Grading Scales.
--
-- The assignments table held title/class/subject/due_date and nothing the
-- Assignment Management screen actually asks for. Grading scales had no table
-- at all — the settings page was a placeholder card.
-- ============================================================================

-- ---------- Assignments -----------------------------------------------------
alter table public.assignments
  -- Rich text, rendered through components/ui/RichText's allow-list walk. The
  -- older `description` column stays: legacy rows have plain text in it, and
  -- the form falls back to it when instructions_html is null. New writes only
  -- touch instructions_html.
  add column if not exists instructions_html text,
  add column if not exists due_time          time not null default '23:59',
  add column if not exists category          text,
  add column if not exists submission_types  text[] not null default '{file_upload}',
  add column if not exists status            text not null default 'draft',
  add column if not exists published_at      timestamptz;

do $$ begin
  alter table public.assignments add constraint assignments_status_check
    check (status in ('draft', 'published'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.assignments add constraint assignments_category_check
    check (category is null or category in
      ('continuous_assessment', 'homework', 'project', 'quiz', 'lab_work', 'final_exam'));
exception when duplicate_object then null; end $$;

-- A submission the school cannot accept in any form is a configuration error,
-- not a valid assignment.
--
-- cardinality(), not array_length(): array_length('{}', 1) is NULL, and a CHECK
-- only rejects on FALSE — so the array_length form silently accepted the empty
-- array it was written to forbid. cardinality('{}') is 0.
do $$ begin
  alter table public.assignments add constraint assignments_submission_types_check
    check (
      cardinality(submission_types) >= 1
      and submission_types <@ array['file_upload', 'online_text', 'physical']::text[]
    );
exception when duplicate_object then null; end $$;

comment on column public.assignments.class_id is
  'DEPRECATED as the section list — public.assignment_sections is authoritative '
  'and carries every targeted section. Kept nullable so legacy rows still '
  'resolve; new writes set it to the first selected section only.';

-- ---------- Target sections -------------------------------------------------
-- One assignment goes out to several sections (G10-A and G10-B), which a single
-- class_id cannot express.
create table if not exists public.assignment_sections (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  class_id      uuid not null references public.classes(id)     on delete cascade,
  tenant_id     uuid not null references public.tenants(id)     on delete cascade,
  primary key (assignment_id, class_id)
);

create index if not exists assignment_sections_class_idx
  on public.assignment_sections (class_id);

-- Existing assignments each target exactly the one section they were created
-- with; without this the student portal would go blank for every old row the
-- moment the reads switch to the join table.
insert into public.assignment_sections (assignment_id, class_id, tenant_id)
select a.id, a.class_id, a.tenant_id
from public.assignments a
where a.class_id is not null
on conflict do nothing;

alter table public.assignment_sections enable row level security;
alter table public.assignment_sections force row level security;

create policy assignment_sections_select on public.assignment_sections
  for select to authenticated
  using ((select public.get_role_for_user(auth.uid())) = 'super_admin'
     or tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

create policy assignment_sections_write on public.assignment_sections
  for all to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
     and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'teacher'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
     and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'teacher'));

-- ---------- Attachments -----------------------------------------------------
-- Teacher-supplied briefs and worksheets. Separate from `submissions`, which is
-- student work: different writers, different retention, different size ceiling.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assignment-attachments', 'assignment-attachments', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- Path is <tenant_id>/<assignment_id>/<uuid>.<ext>; the leading segment is what
-- every policy below checks.
create policy "tenant read assignment attachments" on storage.objects for select to authenticated
using (bucket_id = 'assignment-attachments'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text);

create policy "staff write assignment attachments" on storage.objects for insert to authenticated
with check (bucket_id = 'assignment-attachments'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'teacher'));

create policy "staff delete assignment attachments" on storage.objects for delete to authenticated
using (bucket_id = 'assignment-attachments'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'teacher'));

create table if not exists public.assignment_attachments (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id)     on delete cascade,
  path          text not null,
  file_name     text not null check (length(file_name) between 1 and 255),
  mime_type     text,
  size_bytes    bigint check (size_bytes is null or size_bytes <= 10485760),
  uploaded_by   uuid references public.users(id),
  created_at    timestamptz not null default now()
);

create index if not exists assignment_attachments_assignment_idx
  on public.assignment_attachments (assignment_id);

alter table public.assignment_attachments enable row level security;
alter table public.assignment_attachments force row level security;

create policy assignment_attachments_select on public.assignment_attachments
  for select to authenticated
  using ((select public.get_role_for_user(auth.uid())) = 'super_admin'
     or tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

create policy assignment_attachments_write on public.assignment_attachments
  for all to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
     and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'teacher'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
     and (select public.get_role_for_user(auth.uid())) in ('school_admin', 'teacher'));

-- ---------- Grading scales --------------------------------------------------
create table if not exists public.grading_scales (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(name) between 1 and 120),
  description text check (description is null or length(description) <= 400),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Exactly one default per tenant, enforced by the index rather than by whoever
-- happens to be writing.
create unique index if not exists grading_scales_one_default_per_tenant
  on public.grading_scales (tenant_id) where is_default;

create table if not exists public.grade_bands (
  id               uuid primary key default gen_random_uuid(),
  scale_id         uuid not null references public.grading_scales(id) on delete cascade,
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  letter           text not null check (length(letter) between 1 and 4),
  min_percent      numeric(5,2) not null check (min_percent >= 0 and min_percent <= 100),
  gpa_points       numeric(3,2) not null check (gpa_points >= 0 and gpa_points <= 5),
  -- {"en": "Superior", "am": "ከፍተኛ"} — the screen shows both in one column.
  description_i18n jsonb not null default '{}'::jsonb,
  is_pass          boolean not null default true,
  sort_order       integer not null default 0,
  unique (scale_id, letter)
);

create index if not exists grade_bands_scale_idx on public.grade_bands (scale_id, sort_order);

alter table public.grading_scales enable row level security;
alter table public.grading_scales force row level security;
alter table public.grade_bands   enable row level security;
alter table public.grade_bands   force row level security;

-- Everyone in the tenant reads the scale — a student seeing "B+" needs to know
-- what it means. Only school_admin edits it.
create policy grading_scales_select on public.grading_scales
  for select to authenticated
  using ((select public.get_role_for_user(auth.uid())) = 'super_admin'
     or tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

create policy grading_scales_write on public.grading_scales
  for all to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
     and (select public.get_role_for_user(auth.uid())) = 'school_admin')
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
     and (select public.get_role_for_user(auth.uid())) = 'school_admin');

create policy grade_bands_select on public.grade_bands
  for select to authenticated
  using ((select public.get_role_for_user(auth.uid())) = 'super_admin'
     or tenant_id = (select public.get_tenant_id_for_user(auth.uid())));

create policy grade_bands_write on public.grade_bands
  for all to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
     and (select public.get_role_for_user(auth.uid())) = 'school_admin')
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
     and (select public.get_role_for_user(auth.uid())) = 'school_admin');

comment on table public.grade_bands is
  'Letter-grade bands for a scale. min_percent is the inclusive floor; the band '
  'runs up to the next band''s floor. is_pass drives the Pass/Fail status column.';
