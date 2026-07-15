-- ============================================================================
-- 003 — Attendance (holiday-blocked), gradebook, fees & localized payments
-- ============================================================================

create type public.attendance_status as enum ('present','absent','late','excused');
create type public.invoice_status    as enum ('pending','partial','paid','overdue');
create type public.payment_provider  as enum ('stripe','chapa','telebirr','cash','bank');
create type public.payment_status    as enum ('succeeded','failed','refunded','pending');

create table public.attendance (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id),
  student_id      uuid not null references public.students(id),
  class_id        uuid not null references public.classes(id),
  attendance_date date not null,
  status          public.attendance_status not null,
  recorded_by     uuid not null,
  recorded_at     timestamptz not null default now(),
  unique (tenant_id, student_id, attendance_date, class_id)
);
create index attendance_tenant_date on public.attendance (tenant_id, attendance_date);

-- §17.6: block attendance on holidays/closures + stamp recorder server-side
create or replace function public.attendance_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.calendar_events ce
             where ce.tenant_id = new.tenant_id
               and ce.event_date = new.attendance_date
               and ce.event_type in ('holiday','national')) then
    raise exception 'attendance_blocked_holiday';
  end if;
  new.recorded_by := auth.uid();   -- never trusted from client
  return new;
end $$;
create trigger attendance_guard before insert or update on public.attendance
for each row execute function public.attendance_guard();

create table public.exams (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id),
  academic_term_id uuid not null references public.academic_terms(id),
  name_i18n        jsonb not null,
  max_score        numeric(6,2) not null check (max_score > 0),
  weight           numeric(5,2) not null default 1 check (weight > 0)
);

create table public.grades (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id),
  student_id uuid not null references public.students(id),
  exam_id    uuid not null references public.exams(id),
  subject_id uuid not null references public.subjects(id),
  score      numeric(6,2) not null check (score >= 0),   -- 🔒 upper bound by trigger
  remark     text check (length(remark) <= 300),
  entered_by uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, student_id, exam_id, subject_id)
);
create or replace function public.grade_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_max numeric;
begin
  select max_score into v_max from public.exams where id = new.exam_id;
  if new.score > v_max then raise exception 'score_exceeds_max'; end if;
  new.entered_by := auth.uid();
  return new;
end $$;
create trigger grade_guard before insert or update on public.grades
for each row execute function public.grade_guard();
create trigger audit_grades after insert or update or delete on public.grades
for each row execute function public.audit_trigger();

create table public.fee_structures (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  name_i18n     jsonb not null,
  amount        numeric(12,2) not null check (amount >= 0),  -- 🔒 ETB
  billing_cycle text not null check (billing_cycle in ('monthly','term','annual','once')),
  class_id      uuid references public.classes(id)
);

create table public.fee_invoices (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id),
  student_id       uuid not null references public.students(id) on delete restrict,
  fee_structure_id uuid not null references public.fee_structures(id),
  amount_due       numeric(12,2) not null check (amount_due >= 0),   -- 🔒
  amount_paid      numeric(12,2) not null default 0 check (amount_paid >= 0),
  due_date         date not null,
  status           public.invoice_status not null default 'pending',
  created_at       timestamptz not null default now()
);
create index invoices_tenant_status on public.fee_invoices (tenant_id, status);
create trigger audit_invoices after insert or update or delete on public.fee_invoices
for each row execute function public.audit_trigger();

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id),
  invoice_id   uuid not null references public.fee_invoices(id) on delete restrict,
  amount       numeric(12,2) not null check (amount > 0),   -- 🔒
  provider     public.payment_provider not null,
  provider_ref text,        -- 🔒 Chapa tx_ref / Stripe PI — never card data
  status       public.payment_status not null default 'pending',
  paid_at      timestamptz,
  created_at   timestamptz not null default now()
);
create trigger audit_payments after insert or update or delete on public.payments
for each row execute function public.audit_trigger();

-- Webhook replay protection (Chapa/Telebirr/Stripe events processed once)
create table public.webhook_events (
  id           text primary key,           -- provider event id / tx_ref
  provider     public.payment_provider not null,
  processed_at timestamptz not null default now()
);
