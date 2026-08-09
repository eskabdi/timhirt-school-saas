-- ============================================================================
-- Fields + storage + table backing the six rebuilt screens (Branding,
-- Timetable Master, Student Profile tabs, Academic Record, Attendance,
-- Custom Report Builder). Branding itself stays schema-free JSONB under
-- tenant_configs.settings.branding (same pattern as settings.idCardTemplate);
-- only its uploaded assets need a bucket.
-- ============================================================================

-- ---- Student profile: demographics + enrollment fields shown on the tabs ---
alter table public.students
  add column if not exists blood_type       text check (blood_type is null or blood_type in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  add column if not exists primary_language text check (primary_language is null or length(primary_language) <= 40),
  add column if not exists roll_number      text check (roll_number is null or length(roll_number) <= 20),
  add column if not exists admission_date   date;

-- students has table-level SELECT revoked (20260715000013): columns added later
-- are unreadable until granted. None of these four are 🔒, so grant them back.
grant select (blood_type, primary_language, roll_number, admission_date)
  on public.students to authenticated;

-- ---- Attendance: free-text reason/note shown in the Attendance Log ---------
alter table public.attendance
  add column if not exists reason text check (reason is null or length(reason) <= 300);

-- ---- Exams: CA vs Final split for the Academic Record transcript -----------
alter table public.exams
  add column if not exists category text check (category is null or category in ('ca','final'));

-- ---- Branding assets bucket (logo + certificate seal) ----------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('branding', 'branding', true, 2097152, array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do nothing;

create policy "school_admin manage branding" on storage.objects for all to authenticated
using (bucket_id = 'branding'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) = 'school_admin')
with check (bucket_id = 'branding'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) = 'school_admin');

create policy "public read branding" on storage.objects for select to authenticated, anon
using (bucket_id = 'branding');

-- ---- Custom Report Builder: saved templates -------------------------------
create table if not exists public.report_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(name) between 1 and 120),
  description text check (description is null or length(description) <= 500),
  data_source text not null default 'students',
  config      jsonb not null default '{}'::jsonb,   -- filters + selected columns
  schedule    text,                                 -- null = ad hoc; else recurrence label
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_report_templates_tenant on public.report_templates(tenant_id);

alter table public.report_templates enable row level security;
alter table public.report_templates force row level security;

create policy report_templates_select on public.report_templates for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  or (select public.get_role_for_user(auth.uid())) = 'super_admin');

create policy report_templates_write on public.report_templates for all to authenticated
  using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
    and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar','accountant'))
  with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
    and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar','accountant'));

grant select on public.report_templates to authenticated;

comment on table public.report_templates is 'Saved Custom Report Builder configurations (filters + columns + schedule).';
