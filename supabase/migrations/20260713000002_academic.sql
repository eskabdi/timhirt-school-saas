-- ============================================================================
-- 002 ACADEMIC — Ethiopian-calendar-aware academic structure + SIS
-- §17.5: Gregorian is canonical storage; ec_year is a denormalized EC label.
-- ============================================================================

create type public.gender as enum ('male','female','other');
create type public.student_status as enum ('active','graduated','transferred');
create type public.event_type as enum ('holiday','exam_window','custom','national');

create table public.academic_years (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id),
  ec_year    smallint not null check (ec_year between 1990 and 2200),  -- ዓ.ም
  label_i18n jsonb not null default '{}'::jsonb,
  starts_on  date not null,          -- Gregorian (canonical)
  ends_on    date not null,
  status     text not null default 'draft' check (status in ('draft','active','closed')),
  unique (tenant_id, ec_year),
  check (starts_on < ends_on)
);

create table public.academic_terms (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id),
  academic_year_id uuid not null references public.academic_years(id),
  name_i18n        jsonb not null,
  term_no          smallint not null check (term_no between 1 and 4),
  starts_on        date not null,
  ends_on          date not null,
  unique (tenant_id, academic_year_id, term_no),
  check (starts_on < ends_on)
);

-- Holidays & closures (seeded from the Ethiopian calendar engine — §17.6)
create table public.calendar_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id),
  academic_year_id uuid references public.academic_years(id),
  event_date       date not null,   -- Gregorian
  name_i18n        jsonb not null,
  event_type       public.event_type not null default 'holiday',
  created_at       timestamptz not null default now()
);
create index calendar_events_td on public.calendar_events (tenant_id, event_date);

create table public.classes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id),
  academic_year_id    uuid not null references public.academic_years(id),
  name                text not null check (length(name) between 1 and 40),
  section             text check (length(section) <= 10),
  homeroom_teacher_id uuid,
  created_at          timestamptz not null default now()
);
create index classes_tenant_idx on public.classes (tenant_id, academic_year_id);

create table public.subjects (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name_i18n jsonb not null,                              -- {"en","am","om"} §16.4
  code      text not null check (code ~ '^[A-Z0-9\-]{2,12}$'),
  unique (tenant_id, code)
);

create table public.students (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  user_id       uuid references public.users(id),
  class_id      uuid not null references public.classes(id),
  admission_no  text not null check (admission_no ~ '^[A-Z0-9\-/]{3,20}$'),
  first_name    text not null check (length(first_name) between 1 and 80),  -- 🔒
  last_name     text not null check (length(last_name)  between 1 and 80),  -- 🔒
  date_of_birth date not null check (date_of_birth < current_date),          -- 🔒
  gender        public.gender not null,
  medical_notes text,                                    -- 🔒 column-grant restricted
  avatar_path   text,
  status        public.student_status not null default 'active',
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(first_name,'')||' '||coalesce(last_name,'')||' '||coalesce(admission_no,''))
  ) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, admission_no)
);
create index students_tenant_class on public.students (tenant_id, class_id);
create index students_fts on public.students using gin (search_vector);
create trigger students_updated before update on public.students
for each row execute function public.set_updated_at();
create trigger audit_students after insert or update or delete on public.students
for each row execute function public.audit_trigger();

-- 🔒 Field-level control: medical notes hidden from generic authenticated role
revoke select (medical_notes) on public.students from authenticated;

create table public.guardians (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id),
  student_id   uuid not null references public.students(id) on delete cascade,
  user_id      uuid references public.users(id),
  relationship text not null check (relationship in ('mother','father','guardian','other')),
  phone        text check (phone ~ '^\+?[0-9]{7,15}$'),  -- 🔒
  email        text,                                      -- 🔒
  created_at   timestamptz not null default now()
);
create index guardians_student on public.guardians (tenant_id, student_id);
create trigger audit_guardians after insert or update or delete on public.guardians
for each row execute function public.audit_trigger();

create table public.teachers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  user_id     uuid not null references public.users(id),
  employee_id uuid,                                       -- FK added in 004 (HR master)
  staff_no    text not null,
  unique (tenant_id, staff_no),
  unique (tenant_id, user_id)
);

create table public.class_subject_teachers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id),
  class_id   uuid not null references public.classes(id),
  subject_id uuid not null references public.subjects(id),
  teacher_id uuid not null references public.teachers(id),
  unique (tenant_id, class_id, subject_id, teacher_id)
);

-- Helper reused by many policies: is caller a teacher of this class?
create or replace function public.is_teacher_of_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.class_subject_teachers cst
    join public.teachers t on t.id = cst.teacher_id
    where t.user_id = auth.uid() and cst.class_id = p_class_id)
$$;

create or replace function public.is_guardian_of(p_student_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.guardians g
                 where g.student_id = p_student_id and g.user_id = auth.uid())
$$;
