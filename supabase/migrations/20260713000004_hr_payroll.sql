-- ============================================================================
-- 004 HR & PAYROLL — Ethiopian statutory engine (§18)
-- Effective-dated tax brackets & pension rates: law changes = new rows, never
-- code changes. Payroll periods keyed to Ethiopian Calendar months (§17.5).
-- Segregation of duties enforced at the database level.
-- ============================================================================

create type public.employee_type   as enum ('teacher','admin_staff','support');
create type public.employee_status as enum ('active','on_leave','terminated');
create type public.contract_type   as enum ('permanent','contract','part_time');
create type public.component_kind  as enum ('allowance','deduction');
create type public.calc_type       as enum ('fixed','percent_of_basic');
create type public.leave_status    as enum ('pending','approved','rejected','cancelled');
create type public.staff_att_status as enum ('present','absent','leave','holiday','sick');
create type public.payroll_status  as enum ('draft','approved','paid','void');
create type public.payslip_line_kind as enum ('earning','deduction','employer_cost');

create table public.employees (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  user_id       uuid references public.users(id) on delete set null,
  employee_no   text not null check (employee_no ~ '^[A-Z0-9\-/]{2,20}$'),
  employee_type public.employee_type not null,
  full_name     text not null check (length(full_name) between 1 and 120),  -- 🔒
  hire_date     date not null,
  tin_number    text check (tin_number ~ '^[0-9]{10}$'),        -- 🔒 ERCA TIN
  pension_no    text,                                            -- 🔒
  bank_account  text check (bank_account ~ '^[0-9]{6,20}$'),     -- 🔒
  status        public.employee_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, employee_no)
);
create index employees_tenant on public.employees (tenant_id, status);
create trigger employees_updated before update on public.employees
for each row execute function public.set_updated_at();
create trigger audit_employees after insert or update or delete on public.employees
for each row execute function public.audit_trigger();

-- 🔒 §18.5 column grants: identifiers hidden from generic authenticated role;
-- an HR-scoped view re-exposes them under RLS.
revoke select (tin_number, pension_no, bank_account) on public.employees from authenticated;

alter table public.teachers
  add constraint teachers_employee_fk
  foreign key (employee_id) references public.employees(id);

create table public.employment_contracts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  employee_id   uuid not null references public.employees(id) on delete restrict,
  contract_type public.contract_type not null,
  basic_salary  numeric(12,2) not null check (basic_salary >= 0),  -- 🔒 ETB
  starts_on     date not null,
  ends_on       date,
  status        text not null default 'active' check (status in ('active','expired','terminated')),
  check (ends_on is null or ends_on > starts_on)
);
create index contracts_employee on public.employment_contracts (tenant_id, employee_id, status);
create trigger audit_contracts after insert or update or delete on public.employment_contracts
for each row execute function public.audit_trigger();

create table public.salary_components (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  name_i18n   jsonb not null,                    -- trilingual labels §16.4
  kind        public.component_kind not null,
  taxable     boolean not null default true,
  pensionable boolean not null default false,
  calc_type   public.calc_type not null default 'fixed'
);

create table public.employee_salary_components (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  component_id uuid not null references public.salary_components(id),
  amount       numeric(12,2) not null check (amount >= 0),  -- 🔒 fixed ETB or percent
  unique (tenant_id, employee_id, component_id)
);

-- ---------- Statutory tables: PLATFORM-GLOBAL, effective-dated --------------
-- Seed: Federal Income Tax Proclamation No. 979/2016, Article 11 ("Employment
-- Income Tax Rates"), AS AMENDED by Proclamation No. 1395/2017 E.C. (=1395/2025
-- G.C.), Article 7 of the amendment (which deletes and replaces Article 11).
-- 979/2016 remains the base law — the amendment replaces specific articles
-- (Article 11's monthly employment-tax table among them), not the whole
-- proclamation — so the correct citation is "979/2016 Art. 11, as amended by
-- 1395/2025," not "1395/2025" standing alone.
--
-- ✅ VERIFIED against the official gazette (fetched directly, not via a
-- secondary source): rates 0/15/20/25/30/35% and bracket boundaries
-- 2,000/4,000/7,000/10,000/14,000 ETB match Article 11's table exactly.
-- `deduction_amount` values are not published as a table in the gazette (the
-- law states marginal rates only) — they were independently re-derived here
-- from the confirmed rates via cumulative marginal-tax arithmetic and cross-
-- checked against the seeded figures below; all six matched exactly.
-- Source: Federal Negarit Gazette, Proclamation No. 1395/2017 E.C., Ministry
-- of Finance copy (income_tax_amendment_proc_no_1395-2017_compressed.pdf,
-- mofed.gov.et), retrieved 2026-07-15.
--
-- `effective_from`: the amendment's own "Effective Date" article sets THREE
-- different commencement dates for different provisions — Alternative
-- Minimum Tax as of 8 July 2025, Schedule "D"/Art. 97 withholding as of
-- 7 August 2025, and "all other provisions" (the bucket Article 11 falls
-- into) as of a third date. That third date was OCR-corrupted in the
-- fetched PDF; based on the surrounding clause structure it most likely
-- matches the 8 July 2025 date set for the Alternative Minimum Tax, so that
-- is the value seeded below. ⚠️ STILL RECOMMEND a final visual (non-OCR)
-- confirmation of that specific clause against the gazette PDF before
-- go-live — everything else about this schedule is fully verified, but this
-- one date was reconstructed from partially-corrupted text, not read clean.
--
-- If a prior, pre-amendment schedule is ever needed for historical payslip
-- reproducibility (§18.3's effective-dated design exists precisely for
-- this), insert it as a SEPARATE row set with an earlier `effective_from`
-- rather than editing these rows — `run-payroll` always resolves the latest
-- `effective_from <= run date`, so both schedules can coexist correctly.
create table public.tax_brackets (
  id               uuid primary key default gen_random_uuid(),
  effective_from   date not null,
  income_from      numeric(12,2) not null,
  income_to        numeric(12,2),                  -- null = open-ended
  rate_pct         numeric(5,2) not null check (rate_pct between 0 and 100),
  deduction_amount numeric(12,2) not null default 0
);
insert into public.tax_brackets (effective_from, income_from, income_to, rate_pct, deduction_amount) values
  ('2025-07-08',     0.00,  2000.00,  0,     0.00),
  ('2025-07-08',  2000.01,  4000.00, 15,   300.00),
  ('2025-07-08',  4000.01,  7000.00, 20,   500.00),
  ('2025-07-08',  7000.01, 10000.00, 25,   850.00),
  ('2025-07-08', 10000.01, 14000.00, 30,  1350.00),
  ('2025-07-08', 14000.01,      null, 35, 2050.00);

create table public.pension_rates (
  id             uuid primary key default gen_random_uuid(),
  effective_from date not null,
  employee_pct   numeric(5,2) not null,
  employer_pct   numeric(5,2) not null
);
-- Private Organization Employees Pension Proclamation 715/2011
insert into public.pension_rates (effective_from, employee_pct, employer_pct)
values ('2011-06-24', 7, 11);

-- ---------- Leave ------------------------------------------------------------
create table public.leave_types (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  name_i18n     jsonb not null,
  days_per_year numeric(5,2) not null check (days_per_year >= 0),
  carry_over    boolean not null default false,
  paid          boolean not null default true
);

create table public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  employee_id   uuid not null references public.employees(id),
  leave_type_id uuid not null references public.leave_types(id),
  starts_on     date not null,
  ends_on       date not null,
  status        public.leave_status not null default 'pending',
  decided_by    uuid,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create trigger audit_leave after insert or update or delete on public.leave_requests
for each row execute function public.audit_trigger();

create table public.leave_balances (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id),
  employee_id       uuid not null references public.employees(id),
  leave_type_id     uuid not null references public.leave_types(id),
  ec_year           smallint not null,              -- EC-year scoped (§17.5)
  entitled          numeric(5,2) not null default 0,
  taken             numeric(5,2) not null default 0,
  carried_from_prior numeric(5,2) not null default 0,
  unique (tenant_id, employee_id, leave_type_id, ec_year)
);

create table public.staff_attendance (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  employee_id uuid not null references public.employees(id),
  att_date    date not null,
  status      public.staff_att_status not null,
  recorded_by uuid not null,
  unique (tenant_id, employee_id, att_date)
);

-- On approval: stamp decider, write staff_attendance for the span, update balance
create or replace function public.leave_decision_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare d date; v_ec_year smallint; v_days numeric;
begin
  if new.status in ('approved','rejected') and old.status = 'pending' then
    new.decided_by := auth.uid();
    new.decided_at := now();
    if new.status = 'approved' then
      d := new.starts_on;
      while d <= new.ends_on loop
        insert into public.staff_attendance (tenant_id, employee_id, att_date, status, recorded_by)
        values (new.tenant_id, new.employee_id, d, 'leave', auth.uid())
        on conflict (tenant_id, employee_id, att_date) do update set status = 'leave';
        d := d + 1;
      end loop;
      v_days := (new.ends_on - new.starts_on) + 1;
      -- EC year approximation for balance bucket: Meskerem starts ~Sep 11
      v_ec_year := extract(year from new.starts_on)::int
                   - case when extract(month from new.starts_on) >= 9 then 7 else 8 end;
      update public.leave_balances
        set taken = taken + v_days
        where tenant_id = new.tenant_id and employee_id = new.employee_id
          and leave_type_id = new.leave_type_id and ec_year = v_ec_year;
    end if;
  end if;
  return new;
end $$;
create trigger leave_decision before update on public.leave_requests
for each row execute function public.leave_decision_trigger();

-- ---------- Payroll runs & payslips ------------------------------------------
create table public.payroll_runs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  ec_year     smallint not null check (ec_year between 1990 and 2200),
  ec_month    smallint not null check (ec_month between 1 and 13),   -- 13 = Pagume
  status      public.payroll_status not null default 'draft',
  prepared_by uuid not null,
  approved_by uuid,
  paid_at     timestamptz,
  notes       text check (length(notes) <= 500),
  created_at  timestamptz not null default now(),
  unique (tenant_id, ec_year, ec_month),
  -- §18.1 segregation of duties: preparer can never approve their own run
  constraint sod_preparer_not_approver check (approved_by is null or approved_by <> prepared_by)
);
create trigger audit_payroll_runs after insert or update or delete on public.payroll_runs
for each row execute function public.audit_trigger();

create table public.payslips (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id),
  run_id           uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id      uuid not null references public.employees(id),
  gross            numeric(12,2) not null,   -- 🔒
  taxable_income   numeric(12,2) not null,   -- 🔒
  income_tax       numeric(12,2) not null,   -- 🔒
  pension_employee numeric(12,2) not null,   -- 🔒
  pension_employer numeric(12,2) not null,   -- 🔒 employer cost, not net deduction
  other_deductions numeric(12,2) not null default 0,  -- 🔒
  net_pay          numeric(12,2) not null,   -- 🔒
  pdf_path         text,
  generated_at     timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index payslips_employee on public.payslips (tenant_id, employee_id);

create table public.payslip_lines (
  id         uuid primary key default gen_random_uuid(),
  payslip_id uuid not null references public.payslips(id) on delete cascade,
  label_i18n jsonb not null,
  kind       public.payslip_line_kind not null,
  amount     numeric(12,2) not null            -- 🔒
);
