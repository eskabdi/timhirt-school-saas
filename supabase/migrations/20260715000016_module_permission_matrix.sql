-- ============================================================================
-- Module permission matrix — which of the 18 modules a tenant can use is
-- driven by its subscription tier, with an optional per-tenant override for
-- one-off exceptions (a trial extension, a custom deal) without having to
-- move the whole tenant to a different tier or edit the tier itself.
--
-- modules / subscription_tiers: reference catalogs, readable by anyone
-- authenticated (not sensitive — it's just the product's plan structure),
-- writable only by super_admin.
--
-- tier_modules: presence of a (tier_key, module_key) row means that module
-- is included in that tier. No boolean column — a tier either includes a
-- module or it doesn't; there's nothing a "false" row would mean that an
-- absent row doesn't already mean.
--
-- tenant_module_overrides: presence of a row means "ignore the tier default
-- for this module on this tenant, use `enabled` instead." Absence means "use
-- whatever the tenant's tier says." This one DOES need a boolean, since an
-- override can force a module on OR off relative to the tier default.
--
-- Enforcement in this pass is UI-only (route guards + nav), matching this
-- app's existing pattern of guards-are-UX/RLS-is-authoritative for ROLE
-- checks (§6.2) — extending that same guarantee to module-gating would mean
-- touching RLS across most tables in the schema (attendance, gradebook,
-- fees, library, transport, HR, hostel, inventory, discipline, clinic, ID
-- cards, events, admissions, assignments, communication, ...), which is a
-- large, separately-risked migration better done as its own follow-up once
-- this data model has proven out in practice.
-- ============================================================================

create table public.modules (
  key          text primary key,
  display_name text not null,
  sort_order   int not null
);

insert into public.modules (key, display_name, sort_order) values
  ('sis',           'Student Information System', 1),
  ('attendance',    'Attendance',                  2),
  ('timetable',     'Timetable',                   3),
  ('gradebook',     'Gradebook',                   4),
  ('fees',          'Fees',                        5),
  ('communication', 'Communication',               6),
  ('reporting',     'Reporting',                   7),
  ('library',       'Library',                     8),
  ('transport',     'Transport',                   9),
  ('hr_payroll',    'HR & Payroll',                10),
  ('admissions',    'Admissions',                  11),
  ('assignments',   'Assignments',                 12),
  ('hostel',        'Hostel',                      13),
  ('inventory',     'Inventory',                   14),
  ('discipline',    'Discipline',                  15),
  ('clinic',        'Clinic',                      16),
  ('id_cards',      'ID Cards / Certificates',     17),
  ('events',        'Events',                      18);

create table public.subscription_tiers (
  key          text primary key,
  display_name text not null,
  sort_order   int not null
);

insert into public.subscription_tiers (key, display_name, sort_order) values
  ('basic',    'Basic',    1),
  ('standard', 'Standard', 2),
  ('premium',  'Premium',  3);

create table public.tier_modules (
  tier_key   text not null references public.subscription_tiers(key) on delete cascade,
  module_key text not null references public.modules(key) on delete cascade,
  primary key (tier_key, module_key)
);

-- Starting defaults — adjust freely afterward via the matrix UI. Basic gets
-- the core academic loop; Standard adds fees/reporting/admissions/
-- assignments; Premium gets everything.
insert into public.tier_modules (tier_key, module_key)
select 'basic', key from public.modules
where key in ('sis', 'attendance', 'timetable', 'gradebook', 'communication');

insert into public.tier_modules (tier_key, module_key)
select 'standard', key from public.modules
where key in ('sis', 'attendance', 'timetable', 'gradebook', 'communication',
              'fees', 'reporting', 'admissions', 'assignments');

insert into public.tier_modules (tier_key, module_key)
select 'premium', key from public.modules;

alter table public.tenants
  add column tier_key text not null default 'basic' references public.subscription_tiers(key);

create table public.tenant_module_overrides (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  module_key text not null references public.modules(key) on delete cascade,
  enabled    boolean not null,
  primary key (tenant_id, module_key)
);

alter table public.modules enable row level security;
alter table public.modules force row level security;
create policy modules_select on public.modules for select to authenticated using (true);
create policy modules_write on public.modules for all to authenticated
using ((select public.get_role_for_user(auth.uid())) = 'super_admin')
with check ((select public.get_role_for_user(auth.uid())) = 'super_admin');

alter table public.subscription_tiers enable row level security;
alter table public.subscription_tiers force row level security;
create policy subscription_tiers_select on public.subscription_tiers for select to authenticated using (true);
create policy subscription_tiers_write on public.subscription_tiers for all to authenticated
using ((select public.get_role_for_user(auth.uid())) = 'super_admin')
with check ((select public.get_role_for_user(auth.uid())) = 'super_admin');

alter table public.tier_modules enable row level security;
alter table public.tier_modules force row level security;
create policy tier_modules_select on public.tier_modules for select to authenticated using (true);
create policy tier_modules_write on public.tier_modules for all to authenticated
using ((select public.get_role_for_user(auth.uid())) = 'super_admin')
with check ((select public.get_role_for_user(auth.uid())) = 'super_admin');

alter table public.tenant_module_overrides enable row level security;
alter table public.tenant_module_overrides force row level security;
create policy tenant_module_overrides_select on public.tenant_module_overrides for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
);
create policy tenant_module_overrides_write on public.tenant_module_overrides for all to authenticated
using ((select public.get_role_for_user(auth.uid())) = 'super_admin')
with check ((select public.get_role_for_user(auth.uid())) = 'super_admin');
