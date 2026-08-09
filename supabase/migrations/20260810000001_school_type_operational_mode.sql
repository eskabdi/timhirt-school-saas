-- ============================================================================
-- School type (Public/Private/Religious/Community) and operational mode
-- (Full-Day/Double Shift), set on the Branding page.
--
-- Both are fixed, platform-wide option lists, not something a tenant edits --
-- same shape as modules/subscription_tiers (20260715000016): a small
-- reference table with a text `key` primary key, seeded once, readable by
-- anyone authenticated, writable only by super_admin. The tenant's actual
-- selection is a nullable FK column on tenant_configs (1:1 with tenants,
-- already the home of every other Branding field) rather than nested inside
-- the free-form `settings` jsonb, so it's constrained and queryable like any
-- other typed column. tenant_configs' existing `configs_write` policy
-- already lets a school_admin write any column on their own tenant's row, so
-- no new RLS policy is needed for these two.
-- ============================================================================

create table public.school_types (
  key          text primary key,
  display_name text not null,
  sort_order   int not null
);

insert into public.school_types (key, display_name, sort_order) values
  ('public',    'Public',    1),
  ('private',   'Private',   2),
  ('religious', 'Religious', 3),
  ('community', 'Community', 4);

create table public.operational_modes (
  key          text primary key,
  display_name text not null,
  sort_order   int not null
);

insert into public.operational_modes (key, display_name, sort_order) values
  ('full_day',     'Full-Day',     1),
  ('double_shift', 'Double Shift', 2);

alter table public.school_types enable row level security;
alter table public.school_types force row level security;
create policy school_types_select on public.school_types for select to authenticated using (true);
create policy school_types_write on public.school_types for all to authenticated
using ((select public.get_role_for_user(auth.uid())) = 'super_admin')
with check ((select public.get_role_for_user(auth.uid())) = 'super_admin');

alter table public.operational_modes enable row level security;
alter table public.operational_modes force row level security;
create policy operational_modes_select on public.operational_modes for select to authenticated using (true);
create policy operational_modes_write on public.operational_modes for all to authenticated
using ((select public.get_role_for_user(auth.uid())) = 'super_admin')
with check ((select public.get_role_for_user(auth.uid())) = 'super_admin');

alter table public.tenant_configs
  add column school_type_key text references public.school_types(key),
  add column operational_mode_key text references public.operational_modes(key);
