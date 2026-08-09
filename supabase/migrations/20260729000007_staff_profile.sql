-- ============================================================================
-- Staff registration and staff profile.
--
-- `employees` carried employee_no, type, full_name, hire_date, three payroll
-- identifiers and a status. The registration stepper asks for a person: names
-- in two scripts, date of birth, gender, nationality, national ID, phone,
-- email, address, photo, qualifications, teaching subjects, department, office,
-- reporting line. None of it existed, and neither did anywhere to record an
-- emergency contact, a document, or a performance rating.
-- ============================================================================

-- ---------- employees: the person ------------------------------------------
alter table public.employees
  -- Name parts in both scripts. full_name stays: it is NOT NULL and read by
  -- payroll, payslip PDFs and half a dozen screens, so it is kept in sync from
  -- the parts on write rather than dropped and back-filled everywhere.
  add column if not exists first_name          text,
  add column if not exists first_name_am       text,
  add column if not exists father_name         text,
  add column if not exists father_name_am      text,
  add column if not exists last_name           text,
  add column if not exists last_name_am        text,
  add column if not exists gender              public.gender,
  add column if not exists date_of_birth       date,
  add column if not exists nationality         text,
  add column if not exists national_id         text,
  add column if not exists phone               text,
  add column if not exists personal_email      text,
  add column if not exists photo_path          text,
  -- Ethiopian administrative hierarchy, as the form collects it.
  add column if not exists region              text,
  add column if not exists zone                text,
  add column if not exists woreda              text,
  add column if not exists city                text,
  add column if not exists kebele              text,
  add column if not exists house_number        text,
  -- Step 2: academic background.
  add column if not exists highest_qualification text,
  add column if not exists major               text,
  add column if not exists institution_name    text,
  add column if not exists graduation_year_ec  smallint,
  add column if not exists languages           text[],
  -- Step 3: employment.
  add column if not exists job_title           text,
  add column if not exists department          text,
  add column if not exists office_location     text,
  add column if not exists campus              text,
  add column if not exists institutional_email text,
  add column if not exists work_phone          text,
  add column if not exists reporting_manager_id uuid references public.employees(id) on delete set null,
  add column if not exists probation_status    text,
  add column if not exists notice_period_days  smallint;

do $$ begin
  alter table public.employees
    add constraint employees_phone_check
      check (phone is null or phone ~ '^\+?[0-9]{7,15}$'),
    add constraint employees_work_phone_check
      check (work_phone is null or work_phone ~ '^\+?[0-9]{7,15}$'),
    add constraint employees_dob_check
      check (date_of_birth is null or date_of_birth < current_date),
    add constraint employees_grad_year_check
      check (graduation_year_ec is null or graduation_year_ec between 1950 and 2200),
    add constraint employees_probation_check
      check (probation_status is null
             or probation_status in ('not_applicable', 'in_progress', 'passed', 'extended', 'failed')),
    -- An employee cannot report to themselves. Deeper cycles are a data-entry
    -- problem the org chart surfaces; this catches the one-step case cheaply.
    add constraint employees_manager_not_self check (reporting_manager_id is distinct from id);
exception when duplicate_object then null; end $$;

-- Without this the columns above are invisible to `authenticated`.
--
-- 20260713000010 revoked SELECT on tin_number/pension_no/bank_account, and a
-- column-level REVOKE makes Postgres expand the table-wide GRANT SELECT into
-- one grant per column that existed at that moment. Everything added later
-- starts with no SELECT privilege, and the failure is not confined to the
-- field: any query naming it dies with "permission denied for table employees"
-- and takes the whole profile page with it. INSERT and UPDATE stay table-wide
-- because nothing was ever revoked column-wise for those, so the value can be
-- written and then not read back. 20260720000002 hit this for students.
grant select (
  first_name, first_name_am, father_name, father_name_am, last_name, last_name_am,
  gender, date_of_birth, nationality, national_id, phone, personal_email, photo_path,
  region, zone, woreda, city, kebele, house_number,
  highest_qualification, major, institution_name, graduation_year_ec, languages,
  job_title, department, office_location, campus, institutional_email, work_phone,
  reporting_manager_id, probation_status, notice_period_days
) on public.employees to authenticated;

create index if not exists employees_manager on public.employees (tenant_id, reporting_manager_id);

-- ---------- emergency contact ------------------------------------------------
-- Its own table rather than emergency_* columns on employees: this is a
-- different living person's contact details, so it gets its own policy, and a
-- staff member may eventually list more than one.
create table if not exists public.employee_emergency_contacts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  full_name    text not null check (length(full_name) between 1 and 120),
  full_name_am text,
  relationship text,
  phone        text check (phone is null or phone ~ '^\+?[0-9]{7,15}$'),
  email        text,
  region       text,
  zone         text,
  woreda       text,
  city         text,
  kebele       text,
  house_number text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (employee_id)
);

-- ---------- qualifications, subjects, documents ------------------------------
create table if not exists public.employee_qualifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  name        text not null check (length(name) between 1 and 160),
  issuer      text,
  issued_on   date,
  expires_on  date,
  created_at  timestamptz not null default now(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index if not exists employee_qualifications_emp
  on public.employee_qualifications (tenant_id, employee_id);

-- Teaching specializations. FK to subjects rather than free text so the profile
-- and the timetable are talking about the same thing.
create table if not exists public.employee_subjects (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  unique (employee_id, subject_id)
);

create table if not exists public.employee_documents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  -- The four groups the Documents tab files them under.
  category     text not null check (category in
                 ('identification', 'qualifications', 'contractual', 'health_legal')),
  doc_type     text not null check (length(doc_type) between 1 and 60),
  storage_path text not null,
  verified     boolean not null default false,
  verified_by  uuid,
  verified_at  timestamptz,
  expires_on   date,
  uploaded_at  timestamptz not null default now()
);
create index if not exists employee_documents_emp
  on public.employee_documents (tenant_id, employee_id, category);

create table if not exists public.staff_performance_reviews (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  ec_year     smallint not null check (ec_year between 1990 and 2200),
  rating      numeric(2,1) not null check (rating >= 0 and rating <= 5),
  reviewer_id uuid,
  notes       text check (notes is null or length(notes) <= 2000),
  created_at  timestamptz not null default now(),
  unique (employee_id, ec_year)
);

-- ---------- RLS ---------------------------------------------------------------
-- Every one of these hangs off an employee, so "who may see it" is the same
-- question employees_select already answers: HR roles across the tenant, or the
-- employee themselves. Written out per table rather than through a helper so
-- each policy is readable on its own.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'employee_emergency_contacts', 'employee_qualifications',
    'employee_subjects', 'employee_documents'
  ] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('alter table public.%I force row level security', tbl);

    execute format($p$
      drop policy if exists %1$s_select on public.%1$I;
      create policy %1$s_select on public.%1$I for select to authenticated using (
        tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
        and (
          (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer','accountant')
          or exists (select 1 from public.employees e
                     where e.id = employee_id and e.user_id = auth.uid())));
    $p$, tbl);

    execute format($p$
      drop policy if exists %1$s_write on public.%1$I;
      create policy %1$s_write on public.%1$I for all to authenticated
      using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'))
      with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
             and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'));
    $p$, tbl);
  end loop;
end $$;

alter table public.staff_performance_reviews enable row level security;
alter table public.staff_performance_reviews force row level security;

-- A rating is about a person and is read by them. They see their own and no
-- colleague's; accountant is deliberately absent — payroll has no business
-- reading appraisals.
drop policy if exists staff_reviews_select on public.staff_performance_reviews;
create policy staff_reviews_select on public.staff_performance_reviews
for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (
    (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer')
    or exists (select 1 from public.employees e
               where e.id = employee_id and e.user_id = auth.uid())));

drop policy if exists staff_reviews_write on public.staff_performance_reviews;
create policy staff_reviews_write on public.staff_performance_reviews
for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'));

-- ---------- triggers ----------------------------------------------------------
drop trigger if exists employee_emergency_contacts_updated on public.employee_emergency_contacts;
create trigger employee_emergency_contacts_updated before update on public.employee_emergency_contacts
for each row execute function public.set_updated_at();

drop trigger if exists audit_employee_documents on public.employee_documents;
create trigger audit_employee_documents after insert or update or delete on public.employee_documents
for each row execute function public.audit_trigger();

drop trigger if exists audit_staff_reviews on public.staff_performance_reviews;
create trigger audit_staff_reviews after insert or update or delete on public.staff_performance_reviews
for each row execute function public.audit_trigger();

-- ---------- storage -----------------------------------------------------------
-- Step 4 of registration uploads into the existing `documents` bucket, but its
-- write policy admits only school_admin and registrar — so the HR officer who
-- owns staff onboarding could fill in every field and then fail on the last
-- step. Reissue it with hr_officer included.
drop policy if exists "admin write documents" on storage.objects;
create policy "admin write documents" on storage.objects for insert to authenticated
with check (bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar','hr_officer'));

-- Replacing a mis-scanned document is part of the same job as uploading one.
drop policy if exists "admin update documents" on storage.objects;
create policy "admin update documents" on storage.objects for update to authenticated
using (bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar','hr_officer'));

drop policy if exists "admin delete documents" on storage.objects;
create policy "admin delete documents" on storage.objects for delete to authenticated
using (bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','hr_officer'));

-- ---------- auto-generated staff number ---------------------------------------
-- The Employment step shows "Staff ID (Auto-generated)" as a read-only field,
-- but employee_no is NOT NULL with a per-tenant unique constraint and nothing
-- minted it — the old add-employee modal made the registrar type one.
--
-- Same shape as set_student_number() (20260719000005): a per-tenant counter on
-- `tenants`, incremented with UPDATE ... RETURNING so the row lock stops two
-- simultaneous registrations minting the same number, in a SECURITY DEFINER
-- function because only super_admin may write `tenants`. Fires only when
-- employee_no is null, so seeds and imports that supply their own are untouched.
alter table public.tenants add column if not exists employee_seq int not null default 0;

create or replace function public.set_employee_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_seq int;
begin
  if new.employee_no is not null then
    return new;
  end if;
  update public.tenants
     set employee_seq = employee_seq + 1
   where id = new.tenant_id
  returning employee_seq into v_seq;

  new.employee_no := 'EMP-' || lpad(v_seq::text, 4, '0');
  return new;
end;
$$;
revoke all on function public.set_employee_number() from public, anon, authenticated;

drop trigger if exists employees_set_employee_no on public.employees;
create trigger employees_set_employee_no
before insert on public.employees
for each row execute function public.set_employee_number();

-- employee_no stays NOT NULL. Postgres evaluates column constraints on the row
-- a BEFORE trigger returns, not on the row the client sent, so the trigger
-- filling it in is enough — verified rather than assumed.

comment on column public.employees.reporting_manager_id is
  'Line manager, another employee in the same tenant. Nullable: the head of '
  'school reports to nobody in this table.';

comment on column public.employees.employee_no is
  'Staff ID, minted per tenant by set_employee_number() when the client omits '
  'it. Rows created before 20260729000007 keep their hand-typed numbers.';
