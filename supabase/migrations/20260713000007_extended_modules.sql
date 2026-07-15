-- ============================================================================
-- 007 EXTENDED MODULES (§19.1) — Admissions, Assignments, Hostel, Inventory,
-- Discipline, Clinic, ID Cards, Library, Transport, MoE Reporting,
-- Communication Hub. All tables: tenant_id + standard RLS shape + audit.
-- ============================================================================

create type public.admission_stage as enum ('applied','shortlisted','offered','registered','rejected');
create type public.announcement_audience as enum ('all','staff','parents','class');
create type public.discipline_severity as enum ('minor','moderate','major');
create type public.library_checkout_status as enum ('checked_out','returned','overdue','lost');

-- ---------- Admissions & Enrollment ------------------------------------------
create table public.admission_applications (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id),
  applicant_name   text not null check (length(applicant_name) between 1 and 120), -- 🔒
  date_of_birth    date not null check (date_of_birth < current_date),              -- 🔒
  guardian_name    text not null check (length(guardian_name) between 1 and 120),
  guardian_phone   text check (guardian_phone ~ '^\+?[0-9]{7,15}$'),                -- 🔒
  guardian_email   text,                                                             -- 🔒
  desired_class_id uuid references public.classes(id),
  desired_ec_year  smallint,
  stage            public.admission_stage not null default 'applied',
  notes            text check (length(notes) <= 1000),
  converted_student_id uuid references public.students(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index admissions_tenant_stage on public.admission_applications (tenant_id, stage);
create trigger admissions_updated before update on public.admission_applications
for each row execute function public.set_updated_at();
create trigger audit_admissions after insert or update or delete on public.admission_applications
for each row execute function public.audit_trigger();

-- ---------- Assignments & Learning Resources ---------------------------------
create table public.assignments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  class_id    uuid not null references public.classes(id),
  subject_id  uuid not null references public.subjects(id),
  title       text not null check (length(title) between 1 and 150),
  description text check (length(description) <= 3000),
  due_date    date not null,          -- Gregorian canonical; EC shown via facade
  max_score   numeric(6,2) check (max_score > 0),
  created_by  uuid not null,
  created_at  timestamptz not null default now()
);
create index assignments_class on public.assignments (tenant_id, class_id, due_date);

create table public.assignment_submissions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id    uuid not null references public.students(id),
  file_path     text,                 -- Storage: submissions bucket
  submitted_at  timestamptz,
  score         numeric(6,2),
  feedback      text check (length(feedback) <= 1000),
  unique (assignment_id, student_id)
);

-- ---------- Hostel / Dormitory ------------------------------------------------
create table public.hostel_buildings (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id),
  name       text not null check (length(name) between 1 and 80)
);
create table public.hostel_rooms (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  building_id uuid not null references public.hostel_buildings(id) on delete cascade,
  room_no     text not null,
  capacity    smallint not null check (capacity > 0),
  unique (tenant_id, building_id, room_no)
);
create table public.hostel_allocations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id),
  room_id    uuid not null references public.hostel_rooms(id),
  student_id uuid not null references public.students(id),
  starts_on  date not null,
  ends_on    date,
  unique (tenant_id, student_id, starts_on)
);
create table public.hostel_visitor_logs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id),
  student_id   uuid not null references public.students(id),
  visitor_name text not null check (length(visitor_name) between 1 and 120),
  leave_date   date,
  return_date  date,
  notes        text check (length(notes) <= 500)
);

-- ---------- Inventory & Fixed Assets ------------------------------------------
create table public.inventory_items (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id),
  name       text not null check (length(name) between 1 and 120),
  sku        text check (sku ~ '^[A-Z0-9\-]{2,20}$'),
  unit       text not null default 'unit',
  reorder_level numeric(10,2) not null default 0
);
create table public.inventory_movements (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id),
  item_id      uuid not null references public.inventory_items(id),
  movement_type text not null check (movement_type in ('in','out')),
  quantity     numeric(10,2) not null check (quantity > 0),
  movement_date date not null,
  recorded_by  uuid not null,
  notes        text check (length(notes) <= 300)
);
create table public.asset_register (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  name          text not null check (length(name) between 1 and 120),
  purchase_date date,
  purchase_cost numeric(12,2) check (purchase_cost >= 0),
  custodian_id  uuid references public.employees(id),
  status        text not null default 'in_use' check (status in ('in_use','maintenance','disposed'))
);

-- ---------- Discipline & Behavior ---------------------------------------------
create table public.discipline_incidents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id),
  student_id   uuid not null references public.students(id),
  incident_date date not null,
  description  text not null check (length(description) between 1 and 2000),
  severity     public.discipline_severity not null default 'minor',
  witness      text check (length(witness) <= 200),
  evidence_path text,                 -- Storage
  action_taken text check (length(action_taken) <= 1000),
  points       smallint not null default 0,  -- negative = demerit
  reported_by  uuid not null,
  created_at   timestamptz not null default now()
);
create index discipline_student on public.discipline_incidents (tenant_id, student_id);
create trigger audit_discipline after insert or update or delete on public.discipline_incidents
for each row execute function public.audit_trigger();

-- ---------- Clinic / Health Records (inherits medical_notes-grade security) --
create table public.clinic_visits (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id),
  student_id   uuid not null references public.students(id),
  visit_date   timestamptz not null default now(),
  complaint    text check (length(complaint) <= 500),          -- 🔒
  treatment    text check (length(treatment) <= 1000),         -- 🔒
  medication   text check (length(medication) <= 500),         -- 🔒
  guardian_notified boolean not null default false,
  recorded_by  uuid not null
);
create index clinic_student on public.clinic_visits (tenant_id, student_id);
revoke select (complaint, treatment, medication) on public.clinic_visits from authenticated;
create trigger audit_clinic after insert or update or delete on public.clinic_visits
for each row execute function public.audit_trigger();

create table public.health_conditions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  student_id  uuid not null references public.students(id),
  condition   text not null check (length(condition) <= 300),  -- 🔒 allergy/condition
  effective_from date not null,
  effective_to   date
);
revoke select (condition) on public.health_conditions from authenticated;

-- ---------- ID Cards & Certificates -------------------------------------------
create table public.id_card_batches (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id),
  batch_type   text not null check (batch_type in ('student_id','staff_id','transcript','certificate')),
  status       text not null default 'queued' check (status in ('queued','processing','done','failed')),
  created_by   uuid not null,
  created_at   timestamptz not null default now()
);
create table public.id_cards (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  batch_id      uuid not null references public.id_card_batches(id) on delete cascade,
  subject_type  text not null check (subject_type in ('student','staff')),
  subject_id    uuid not null,
  verify_code   text not null unique,                -- public QR verification code (§19.2 /verify/:code)
  issued_on     date not null default current_date,
  pdf_path      text
);
create index id_cards_verify on public.id_cards (verify_code);

-- ---------- Library -------------------------------------------------------------
create table public.library_books (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  title     text not null check (length(title) between 1 and 200),
  author    text,
  isbn      text,
  copies    smallint not null default 1 check (copies >= 0)
);
create table public.library_checkouts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  book_id     uuid not null references public.library_books(id),
  student_id  uuid not null references public.students(id),
  checked_out_on date not null default current_date,
  due_on      date not null,
  returned_on date,
  status      public.library_checkout_status not null default 'checked_out',
  fine_amount numeric(8,2) not null default 0
);

-- ---------- Transport -------------------------------------------------------------
create table public.transport_routes (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name      text not null check (length(name) between 1 and 100),
  vehicle_no text,
  driver_name text
);
create table public.transport_stops (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  route_id  uuid not null references public.transport_routes(id) on delete cascade,
  name      text not null,
  sequence  smallint not null
);
create table public.student_route_assignments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id),
  student_id uuid not null references public.students(id),
  route_id   uuid not null references public.transport_routes(id),
  stop_id    uuid references public.transport_stops(id),
  unique (tenant_id, student_id)
);

-- ---------- Communication Hub ------------------------------------------------
create table public.announcements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  title_i18n    jsonb not null,
  body_i18n     jsonb not null,
  audience      public.announcement_audience not null default 'all',
  class_id      uuid references public.classes(id),
  created_by    uuid not null,
  published_at  timestamptz not null default now()
);
create index announcements_tenant on public.announcements (tenant_id, published_at desc);
create table public.notification_log (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references public.tenants(id),
  announcement_id uuid references public.announcements(id),
  recipient_id uuid not null,
  channel      text not null check (channel in ('email','sms','in_app')),
  status       text not null default 'queued' check (status in ('queued','sent','failed')),
  created_at   timestamptz not null default now()
);
create table public.notification_templates (
  id      uuid primary key default gen_random_uuid(),
  event   text not null,
  locale  public.app_locale not null,
  subject text,
  body    text not null,
  unique (event, locale)
);

-- ---------- MoE / Regional Reporting ------------------------------------------
create table public.moe_exports (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  export_type text not null check (export_type in ('enrollment_census','performance_summary')),
  ec_year     smallint not null,
  file_path   text,
  status      text not null default 'queued' check (status in ('queued','processing','done','failed')),
  created_by  uuid not null,
  created_at  timestamptz not null default now()
);

-- Timetable (referenced in v1 blueprint §6/§7, added here for completeness)
create table public.timetable_slots (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id),
  class_id   uuid not null references public.classes(id),
  subject_id uuid not null references public.subjects(id),
  teacher_id uuid not null references public.teachers(id),
  day_of_week smallint not null check (day_of_week between 1 and 7),
  starts_at  time not null,
  ends_at    time not null,
  room       text,
  check (ends_at > starts_at)
);
create index timetable_class on public.timetable_slots (tenant_id, class_id, day_of_week);
