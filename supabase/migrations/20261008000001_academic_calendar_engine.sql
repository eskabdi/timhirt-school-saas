-- ============================================================================
-- Academic Calendar Engine, slice 1 (engine core): MoE → Region → School.
--
-- Plan: /docs/academic-calendar-engine.md (B1–B3). A school's calendar for an
-- EC year is resolved live from three layers: the Ministry of Education's
-- calendar, its regional bureau's, and the school's own. National and
-- regional dates of a lockable type (holidays, semester break, national
-- exams, opening and closing) are locked: a school cannot move or remove
-- them. Gregorian is canonical (§17.2); EC is computed.
--
-- Platform data (authorities, the event-type catalogue, holiday rules,
-- authority calendars and their entries) has no tenant_id: every signed-in
-- user reads what is published, nobody but service_role writes it here
-- (authoring RPCs come in slice 2). School data (school_calendars,
-- school_calendar_entries) is tenant-scoped, module-gated on `events`, and
-- written in this slice only by create_school_calendar.
--
-- Functions (all answer only for the caller's school; RLS scopes the
-- invoker ones, the one definer RPC derives the tenant from auth.uid()):
--   calendar_year_settings(ec_year)        layers, weekend, session span
--   effective_calendar_entries(ec_year)    the merged entries of the 3 layers
--   calendar_days(from, to)                each day classified
--   calendar_day_status(date)              one day
--   instructional_days(from, to)           the ድምር count
--   create_school_calendar(ec_year, origin) "Choose Calendar"
--
-- Seeds: the MoE, the 14 regional states and city administrations, the 18
-- event types, the fixed-date national holiday rules, and the MoE's published 2019 EC
-- calendar (the golden fixture; src/features/academic-calendar/moe2019.fixture.ts).
--
-- Deploy: one transaction. Forward fix: every object is new except
-- tenants.edu_authority_id (nullable, no default): drop the new functions and
-- tables and that column to remove the engine; nothing else reads them yet.
-- ============================================================================

set local lock_timeout = '5s';

-- ------------------------------------------------- EC date arithmetic (SQL) --
-- Ports of src/lib/ethiopian-date.ts (Beyene–Kudlek through the Julian Day
-- Number); `to_date(…, 'J')` / `to_char(…, 'J')` are Postgres's JDN codecs.
create function public.ec_to_gregorian(p_year integer, p_month integer, p_day integer)
returns date language sql immutable strict set search_path = public, pg_temp as $$
  select to_date((1723856 + 365 + 365 * (p_year - 1) + floor(p_year / 4.0)::integer
                  + 30 * p_month + p_day - 31)::text, 'J')
$$;

create function public.gregorian_to_ec(p_date date, out ec_year integer, out ec_month integer, out ec_day integer)
language sql immutable strict set search_path = public, pg_temp as $$
  with j as (select to_char(p_date, 'J')::integer - 1723856 as x),
       r as (select x, ((x % 1461) + 1461) % 1461 as r from j),
       n as (select x, r, (r % 365) + 365 * floor(r / 1460.0)::integer as n from r)
  select 4 * floor(x / 1461.0)::integer + floor(r / 365.0)::integer - floor(r / 1460.0)::integer,
         floor(n / 30.0)::integer + 1,
         (n % 30) + 1
  from n
$$;

create function public.ec_days_in_month(p_year integer, p_month integer)
returns integer language sql immutable strict set search_path = public, pg_temp as $$
  select case when p_month = 13 then case when p_year % 4 = 3 then 6 else 5 end else 30 end
$$;

revoke execute on function public.ec_to_gregorian(integer, integer, integer) from public, anon;
revoke execute on function public.gregorian_to_ec(date) from public, anon;
revoke execute on function public.ec_days_in_month(integer, integer) from public, anon;
grant execute on function public.ec_to_gregorian(integer, integer, integer) to authenticated;
grant execute on function public.gregorian_to_ec(date) to authenticated;
grant execute on function public.ec_days_in_month(integer, integer) to authenticated;

-- ------------------------------------------- optional Hijri holidays flag --
-- settings.calendar.hijri_holidays (the school's choice, default off): the
-- academic calendar marks Eid al-Fitr, Eid al-Adha and Mawlid as tentative
-- Hijri dates where the MoE has not published them. Display only: nothing is
-- stored or counted. The calendar normaliser (20260925000002) now also keeps
-- this key a strict boolean; every other key is unchanged.
create or replace function public.normalize_calendar_settings(p_settings jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_settings is null or jsonb_typeof(p_settings) <> 'object' or not (p_settings ? 'calendar')
      then p_settings
    else jsonb_set(p_settings, '{calendar}', (
      with c as (
        select case when jsonb_typeof(p_settings->'calendar') = 'object'
                    then p_settings->'calendar' else '{}'::jsonb end as cal
      )
      select (c.cal - 'geezNumerals' - 'secondaryVisible' - 'showHijri'
                    - 'numerals' - 'show_hijri' - 'secondary_visible' - 'hijri_holidays')
             || jsonb_build_object(
                  'secondary_visible',
                    case when jsonb_typeof(c.cal->'secondary_visible') = 'boolean' then c.cal->'secondary_visible'
                         when jsonb_typeof(c.cal->'secondaryVisible') = 'boolean' then c.cal->'secondaryVisible'
                         else 'true'::jsonb end,
                  'numerals',
                    case when c.cal->>'numerals' in ('latn', 'arab') and jsonb_typeof(c.cal->'numerals') = 'string'
                         then c.cal->'numerals' else '"latn"'::jsonb end,
                  'show_hijri',
                    case when jsonb_typeof(c.cal->'show_hijri') = 'boolean' then c.cal->'show_hijri'
                         when jsonb_typeof(c.cal->'showHijri') = 'boolean' then c.cal->'showHijri'
                         else 'false'::jsonb end,
                  'hijri_holidays',
                    case when jsonb_typeof(c.cal->'hijri_holidays') = 'boolean' then c.cal->'hijri_holidays'
                         else 'false'::jsonb end)
      from c))
  end
$$;

comment on function public.normalize_calendar_settings(jsonb) is
  'Canonical tenant_configs.settings.calendar (snake_case keys, numerals latn|arab, no Ge''ez; show_hijri and hijri_holidays strict booleans). 20260925000002, extended by 20261008000001.';

-- ------------------------------------------------------------ authorities --
create table public.edu_authorities (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('moe', 'region')),
  code       text not null unique check (code ~ '^[A-Z]{2,8}$'),
  name_i18n  jsonb not null check (jsonb_typeof(name_i18n) = 'object' and jsonb_typeof(name_i18n -> 'en') = 'string'),
  parent_id  uuid references public.edu_authorities (id),
  created_at timestamptz not null default now(),
  constraint edu_authorities_shape check ((kind = 'moe') = (parent_id is null))
);
create unique index edu_authorities_one_moe on public.edu_authorities (kind) where kind = 'moe';

-- A school follows its regional bureau's calendar; null = the MoE's directly.
-- Set by the platform (tenants_write is super_admin only).
alter table public.tenants add column edu_authority_id uuid references public.edu_authorities (id);

-- ------------------------------------------------- event-type catalogue --
create table public.calendar_day_types (
  code                      text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label_i18n                jsonb not null check (jsonb_typeof(label_i18n) = 'object' and jsonb_typeof(label_i18n -> 'en') = 'string'),
  color                     text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  category                  text not null check (category in ('teaching', 'rest', 'holiday', 'break', 'exam', 'admin',
                                                              'staff', 'event', 'milestone', 'closure')),
  counts_as_instructional   boolean not null,
  blocks_student_attendance boolean not null,
  blocks_staff_attendance   boolean not null,
  lockable                  boolean not null default false,  -- locked when an authority publishes it
  authority_only            boolean not null default false,  -- only the MoE or a region creates it
  derived                   boolean not null default false,  -- computed, never entered (instructional, weekend)
  legend_order              smallint not null
);

-- ---------------------------------------------------------- holiday rules --
create table public.holiday_rules (
  code           text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- Fixed-date national holidays only (owner decision 2026-10-09: no Bahire
  -- Hasab). Siklet, Fasika and the Eids move every year; they enter a
  -- calendar only as the dates the MoE publishes (a school may opt in to
  -- tentative Hijri suggestions, display only: settings.calendar.hijri_holidays).
  kind           text not null check (kind in ('ec_fixed', 'gregorian_fixed')),
  params         jsonb not null,
  day_type_code  text not null references public.calendar_day_types (code),
  name_i18n      jsonb not null check (jsonb_typeof(name_i18n) = 'object' and jsonb_typeof(name_i18n -> 'en') = 'string'),
  active_from_ec integer not null default 2000,
  active_to_ec   integer,
  -- coalesce(…, false): a CHECK passes on NULL, so a missing or non-numeric
  -- month/day must not slip through. Pagume has 5 days (6 in a leap year).
  constraint holiday_rules_params check (
    jsonb_typeof(params) = 'object'
    and jsonb_typeof(params -> 'month') = 'number' and jsonb_typeof(params -> 'day') = 'number'
    and coalesce(case kind
      when 'ec_fixed' then (params ->> 'month')::integer between 1 and 13
                           and (params ->> 'day')::integer between 1 and case when (params ->> 'month')::integer = 13 then 6 else 30 end
      when 'gregorian_fixed' then (params ->> 'month')::integer between 1 and 12
                           and (params ->> 'day')::integer between 1 and case when (params ->> 'month')::integer = 2 then 29
                                                                             when (params ->> 'month')::integer in (4, 6, 9, 11) then 30
                                                                             else 31 end
    end, false)),
  constraint holiday_rules_active check (active_to_ec is null or active_to_ec >= active_from_ec)
);

-- ---------------------------------------------------- authority calendars --
create table public.authority_calendars (
  id                uuid primary key default gen_random_uuid(),
  authority_id      uuid not null references public.edu_authorities (id),
  ec_year           integer not null check (ec_year between 2000 and 2100),
  weekend_days      smallint[] not null default '{6,7}'
                    check (array_ndims(weekend_days) = 1 and array_lower(weekend_days, 1) = 1
                           and cardinality(weekend_days) between 1 and 3 and weekend_days <@ '{1,2,3,4,5,6,7}'::smallint[]
                           and (cardinality(weekend_days) < 2 or weekend_days[1] <> weekend_days[2])
                           and (cardinality(weekend_days) < 3 or (weekend_days[3] <> weekend_days[1] and weekend_days[3] <> weekend_days[2]))),
  session_starts_on date not null,
  session_ends_on   date not null,
  status            text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  version           integer not null default 1 check (version >= 1),
  published_at      timestamptz,
  published_by      uuid references public.users (id),
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  unique (authority_id, ec_year),
  constraint authority_calendars_session check (session_ends_on > session_starts_on
                                                and session_ends_on - session_starts_on <= 420
                                                and extract(year from session_starts_on) between ec_year + 6 and ec_year + 7
                                                and extract(year from session_ends_on) between ec_year + 7 and ec_year + 8),
  constraint authority_calendars_published check (status = 'draft' or published_at is not null)
);

create table public.authority_calendar_entries (
  id                 uuid primary key default gen_random_uuid(),
  calendar_id        uuid not null references public.authority_calendars (id),
  day_type_code      text not null references public.calendar_day_types (code),
  starts_on          date not null,
  ends_on            date not null,
  name_i18n          jsonb not null check (jsonb_typeof(name_i18n) = 'object' and jsonb_typeof(name_i18n -> 'en') = 'string'),
  source             text not null default 'authored' check (source in ('authored', 'computed')),
  rule_code          text references public.holiday_rules (code),
  locked             boolean not null default false,
  -- A regional entry may replace (or, suppressed, remove) an unlocked MoE entry.
  overrides_entry_id uuid references public.authority_calendar_entries (id),
  suppressed         boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint authority_calendar_entries_range check (ends_on >= starts_on and ends_on - starts_on <= 366),
  constraint authority_calendar_entries_suppress check (not suppressed or overrides_entry_id is not null)
);
create index authority_calendar_entries_calendar on public.authority_calendar_entries (calendar_id, starts_on);

-- ------------------------------------------------------- school calendars --
create table public.school_calendars (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants (id),
  ec_year                 integer not null check (ec_year between 2000 and 2100),
  origin                  text not null check (origin in ('moe', 'previous_year', 'custom')),
  copied_from_calendar_id uuid references public.school_calendars (id),
  weekend_days            smallint[] check (weekend_days is null
                                            or (array_ndims(weekend_days) = 1 and array_lower(weekend_days, 1) = 1
                                                and cardinality(weekend_days) between 1 and 3 and weekend_days <@ '{1,2,3,4,5,6,7}'::smallint[]
                                                and (cardinality(weekend_days) < 2 or weekend_days[1] <> weekend_days[2])
                                                and (cardinality(weekend_days) < 3 or (weekend_days[3] <> weekend_days[1] and weekend_days[3] <> weekend_days[2])))),
  status                  text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  version                 integer not null default 1 check (version >= 1),
  published_at            timestamptz,
  published_by            uuid references public.users (id),
  closed_at               timestamptz,
  created_by              uuid references public.users (id),
  created_at              timestamptz not null default now(),
  unique (tenant_id, ec_year),
  unique (id, tenant_id),
  constraint school_calendars_published check (status = 'draft' or published_at is not null),
  constraint school_calendars_closed check (status <> 'closed' or closed_at is not null)
);

create table public.school_calendar_entries (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id),
  calendar_id        uuid not null,
  day_type_code      text not null references public.calendar_day_types (code),
  starts_on          date not null,
  ends_on            date not null,
  name_i18n          jsonb not null check (jsonb_typeof(name_i18n) = 'object' and jsonb_typeof(name_i18n -> 'en') = 'string'
                                           and length(name_i18n::text) <= 1000),
  -- Replaces (or, suppressed, removes) an unlocked MoE/regional entry.
  overrides_entry_id uuid references public.authority_calendar_entries (id),
  suppressed         boolean not null default false,
  created_by         uuid references public.users (id),
  created_at         timestamptz not null default now(),
  constraint school_calendar_entries_calendar_fkey foreign key (calendar_id, tenant_id)
    references public.school_calendars (id, tenant_id),
  constraint school_calendar_entries_range check (ends_on >= starts_on and ends_on - starts_on <= 366),
  constraint school_calendar_entries_suppress check (not suppressed or overrides_entry_id is not null)
);
create index school_calendar_entries_calendar on public.school_calendar_entries (calendar_id, starts_on);
create index school_calendar_entries_tenant on public.school_calendar_entries (tenant_id);
create index school_calendar_entries_override on public.school_calendar_entries (overrides_entry_id)
  where overrides_entry_id is not null;

-- ------------------------------------------------------------------- RLS --
alter table public.edu_authorities enable row level security;
alter table public.edu_authorities force row level security;
alter table public.calendar_day_types enable row level security;
alter table public.calendar_day_types force row level security;
alter table public.holiday_rules enable row level security;
alter table public.holiday_rules force row level security;
alter table public.authority_calendars enable row level security;
alter table public.authority_calendars force row level security;
alter table public.authority_calendar_entries enable row level security;
alter table public.authority_calendar_entries force row level security;
alter table public.school_calendars enable row level security;
alter table public.school_calendars force row level security;
alter table public.school_calendar_entries enable row level security;
alter table public.school_calendar_entries force row level security;

-- Reference data: public within the platform (no personal data).
create policy edu_authorities_select on public.edu_authorities for select to authenticated using (true);
create policy calendar_day_types_select on public.calendar_day_types for select to authenticated using (true);
create policy holiday_rules_select on public.holiday_rules for select to authenticated using (true);
-- An authority's draft is the platform's working copy; schools see it once published.
create policy authority_calendars_select on public.authority_calendars for select to authenticated using (
  status in ('published', 'closed') or (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
create policy authority_calendar_entries_select on public.authority_calendar_entries for select to authenticated using (
  exists (select 1 from public.authority_calendars c where c.id = authority_calendar_entries.calendar_id)
);
-- A school's draft is visible to whoever may edit it; the published calendar to the whole school.
create policy school_calendars_select on public.school_calendars for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (status <> 'draft' or public.has_resource_permission(auth.uid(), 'academic_calendar', 'update'))
);
create policy school_calendars_module_gate on public.school_calendars as restrictive for all to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'events')
);
create policy school_calendar_entries_select on public.school_calendar_entries for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and exists (select 1 from public.school_calendars c where c.id = school_calendar_entries.calendar_id)
);
create policy school_calendar_entries_module_gate on public.school_calendar_entries as restrictive for all to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or public.has_module(tenant_id, 'events')
);

-- No client writes in this slice: platform data is seeded or written by
-- service_role; school data only through create_school_calendar.
revoke all on public.edu_authorities, public.calendar_day_types, public.holiday_rules,
              public.authority_calendars, public.authority_calendar_entries,
              public.school_calendars, public.school_calendar_entries from anon;
revoke insert, update, delete, truncate on public.edu_authorities, public.calendar_day_types, public.holiday_rules,
              public.authority_calendars, public.authority_calendar_entries,
              public.school_calendars, public.school_calendar_entries from authenticated;

create trigger audit_authority_calendars after insert or update or delete on public.authority_calendars
  for each row execute function public.audit_trigger();
create trigger audit_authority_calendar_entries after insert or update or delete on public.authority_calendar_entries
  for each row execute function public.audit_trigger();
create trigger audit_school_calendars after insert or update or delete on public.school_calendars
  for each row execute function public.audit_trigger();
create trigger audit_school_calendar_entries after insert or update or delete on public.school_calendar_entries
  for each row execute function public.audit_trigger();

-- ------------------------------------------------------------ permissions --
insert into public.permissions (key, module, resource, action, description) values
  ('academic_calendar:read',    'calendar', 'academic_calendar', 'read',    'View the academic calendar'),
  ('academic_calendar:create',  'calendar', 'academic_calendar', 'create',  'Choose the school''s calendar for a year'),
  ('academic_calendar:update',  'calendar', 'academic_calendar', 'update',  'Edit the school''s calendar (draft)'),
  ('academic_calendar:publish', 'calendar', 'academic_calendar', 'publish', 'Approve publishing the school''s calendar')
on conflict (key) do nothing;
insert into public.resource_open_actions (resource, action) values ('academic_calendar', 'read')
on conflict do nothing;
insert into public.resource_default_role_grants (resource, action, role) values
  ('academic_calendar', 'create',  'school_admin'),
  ('academic_calendar', 'update',  'school_admin'),
  ('academic_calendar', 'publish', 'school_admin')
on conflict do nothing;

-- ------------------------------------------------------- guard triggers --
-- Authority entries: lockable types are locked when an authority enters
-- them; a closed calendar never changes; a regional override must target an
-- unlocked entry of the MoE calendar for the same year.
create function public.authority_calendar_entries_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_status text;
  v_year integer;
  v_target record;
begin
  select status, ec_year into v_status, v_year from public.authority_calendars
   where id = coalesce(new.calendar_id, old.calendar_id);
  if v_status = 'closed' then
    raise exception 'calendar_closed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.calendar_id is distinct from old.calendar_id then
    raise exception 'calendar_closed' using errcode = '42501';
  end if;
  select coalesce(lockable, false) or new.locked into new.locked
    from public.calendar_day_types where code = new.day_type_code and not derived;
  if not found then
    raise exception 'invalid_day_type' using errcode = '22023';
  end if;
  if new.overrides_entry_id is not null then
    select e.locked, c.ec_year, a.kind into v_target
      from public.authority_calendar_entries e
      join public.authority_calendars c on c.id = e.calendar_id
      join public.edu_authorities a on a.id = c.authority_id
     where e.id = new.overrides_entry_id;
    if not found or v_target.kind <> 'moe' or v_target.ec_year <> v_year then
      raise exception 'invalid_override' using errcode = '22023';
    end if;
    if v_target.locked then
      raise exception 'calendar_entry_locked' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.authority_calendar_entries_guard() from public, anon, authenticated;
create trigger authority_calendar_entries_guard before insert or update or delete on public.authority_calendar_entries
  for each row execute function public.authority_calendar_entries_guard();

-- A closed authority calendar is immutable.
create function public.authority_calendars_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'closed' then
    raise exception 'calendar_closed' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.authority_calendars_guard() from public, anon, authenticated;
create trigger authority_calendars_guard before update or delete on public.authority_calendars
  for each row execute function public.authority_calendars_guard();

-- ------------------------------------------------------- year settings --
-- The layers for a school and year, and what the nearest layer says about the
-- weekend and the session. Only published (or closed) authority calendars
-- count, explicitly, so a SECURITY DEFINER caller sees what a user does. With
-- no calendar at all the school's academic_years row gives the session.
-- Invoker: RLS limits tenants and school_calendars to the caller's school,
-- and p_tenant is refused (not_allowed) for an end user asking about another
-- school, so isolation does not rest on RLS alone. Trusted contexts (none,
-- service_role, postgres, supabase_admin) and the platform admin may name any
-- school.
create function public.calendar_year_settings(p_ec_year integer, p_tenant uuid default null)
returns table (
  tenant_id uuid, ec_year integer,
  school_calendar_id uuid, school_status text, school_origin text,
  region_calendar_id uuid, region_code text, moe_calendar_id uuid,
  weekend_days smallint[], session_starts_on date, session_ends_on date
)
rows 1
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_own uuid := public.get_tenant_id_for_user(auth.uid());
  v_tenant uuid := coalesce(p_tenant, v_own);
  v_authority uuid;
  v_moe uuid;
  v_school_id uuid; v_school_status text; v_school_origin text; v_school_weekend smallint[];
  v_region_id uuid; v_region_code text; v_region_weekend smallint[]; v_region_from date; v_region_to date;
  v_moe_id uuid; v_moe_weekend smallint[]; v_moe_from date; v_moe_to date;
  v_year_from date; v_year_to date;
begin
  if p_tenant is distinct from v_own and p_tenant is not null
     and coalesce(current_setting('role', true), 'none') not in ('none', 'service_role', 'postgres', 'supabase_admin')
     and public.get_role_for_user(auth.uid()) is distinct from 'super_admin' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select a.id into v_moe from public.edu_authorities a where a.kind = 'moe';
  if v_tenant is not null then
    select t.edu_authority_id into v_authority from public.tenants t where t.id = v_tenant;
    select s.id, s.status, s.origin, s.weekend_days
      into v_school_id, v_school_status, v_school_origin, v_school_weekend
      from public.school_calendars s where s.tenant_id = v_tenant and s.ec_year = p_ec_year;
  end if;
  if v_authority is not null and v_authority is distinct from v_moe then
    select c.id, a.code, c.weekend_days, c.session_starts_on, c.session_ends_on
      into v_region_id, v_region_code, v_region_weekend, v_region_from, v_region_to
      from public.authority_calendars c join public.edu_authorities a on a.id = c.authority_id
     where c.authority_id = v_authority and c.ec_year = p_ec_year and c.status in ('published', 'closed');
  end if;
  select c.id, c.weekend_days, c.session_starts_on, c.session_ends_on
    into v_moe_id, v_moe_weekend, v_moe_from, v_moe_to
    from public.authority_calendars c
   where c.authority_id = v_moe and c.ec_year = p_ec_year and c.status in ('published', 'closed');
  if v_tenant is not null and v_region_id is null and v_moe_id is null then
    select y.starts_on, y.ends_on into v_year_from, v_year_to
      from public.academic_years y where y.tenant_id = v_tenant and y.ec_year = p_ec_year;
  end if;
  return query select
    v_tenant, p_ec_year,
    v_school_id, v_school_status, v_school_origin,
    v_region_id, v_region_code, v_moe_id,
    coalesce(v_school_weekend, v_region_weekend, v_moe_weekend, '{6,7}'::smallint[]),
    coalesce(v_region_from, v_moe_from, v_year_from),
    coalesce(v_region_to, v_moe_to, v_year_to);
end $$;
revoke execute on function public.calendar_year_settings(integer, uuid) from public, anon;
grant execute on function public.calendar_year_settings(integer, uuid) to authenticated;

-- The merged entries of the three layers. An override (regional over MoE,
-- school over either) replaces its target; a suppression removes it; a
-- locked target is never replaced or removed, whatever the rows say.
create function public.effective_calendar_entries(p_ec_year integer, p_tenant uuid default null)
returns table (
  entry_id uuid, level text, source_code text, day_type_code text,
  starts_on date, ends_on date, name_i18n jsonb, locked boolean
)
rows 60
language sql stable set search_path = public, pg_temp set jit = off as $$
  with s as (select * from public.calendar_year_settings(p_ec_year, p_tenant)),
  auth as (
    select e.*, case when e.calendar_id = s.moe_calendar_id then 'moe' else 'region' end as level, a.code
      from s
      join public.authority_calendar_entries e on e.calendar_id in (s.moe_calendar_id, s.region_calendar_id)
      join public.authority_calendars c on c.id = e.calendar_id
      join public.edu_authorities a on a.id = c.authority_id
  ),
  school as (
    select e.* from s join public.school_calendar_entries e on e.calendar_id = s.school_calendar_id
  ),
  overridden as (
    select t.id from auth t
     where not t.locked
       and (exists (select 1 from auth r where r.overrides_entry_id = t.id and r.level = 'region' and t.level = 'moe')
            or exists (select 1 from school x where x.overrides_entry_id = t.id))
  )
  select t.id, t.level, t.code, t.day_type_code, t.starts_on, t.ends_on, t.name_i18n, t.locked
    from auth t
   where not t.suppressed and t.id not in (select id from overridden)
  union all
  select x.id, 'school', 'SCHOOL', x.day_type_code, x.starts_on, x.ends_on, x.name_i18n, false
    from school x
   where not x.suppressed
$$;
revoke execute on function public.effective_calendar_entries(integer, uuid) from public, anon;
grant execute on function public.effective_calendar_entries(integer, uuid) to authenticated;

-- Every day from p_from to p_to (at most 400, within 1900-2199) classified exactly as the grid
-- engine does (src/features/academic-calendar/grid.ts): the shown type is the
-- strongest covering entry (closure > holiday > break > admin > staff > exam
-- > milestone > event), else weekend, instructional or out of session. A day
-- counts as a school day when it is in session, not a weekend day, and every
-- covering entry counts as instructional. A day belongs to the session that
-- covers it (the MoE's session starts in the previous EC year's Nehase), and
-- only that year's entries apply to it, as in the grid; a day outside every
-- session belongs to its own EC year, and in_session is null when that year
-- has no session defined (no calendar, no academic year). Row
-- estimates and jit = off on these functions: with the default 1000-row
-- guess the planner JIT-compiles even a one-day lookup (~1.5 s against 10 ms).
create function public.calendar_days(p_from date, p_to date, p_tenant uuid default null)
returns table (
  day date, ec_year integer, day_type_code text, category text, in_session boolean, counts boolean,
  blocks_student_attendance boolean, blocks_staff_attendance boolean
)
rows 31
language plpgsql stable set search_path = public, pg_temp set jit = off as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400
     or p_from < date '1900-01-01' or p_to > date '2199-12-31' then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  return query
  with years as (
    select generate_series((public.gregorian_to_ec(p_from)).ec_year, (public.gregorian_to_ec(p_to)).ec_year + 1) as y
  ),
  st as (select y.y, s.* from years y cross join lateral public.calendar_year_settings(y.y, p_tenant) s),
  ents as (
    select y.y as yr, e.*, t.category, t.counts_as_instructional, t.blocks_student_attendance, t.blocks_staff_attendance,
           case t.category when 'closure' then 1 when 'holiday' then 2 when 'break' then 3 when 'admin' then 4
                           when 'staff' then 5 when 'exam' then 6 when 'milestone' then 7 else 8 end as rank
      from years y
      cross join lateral public.effective_calendar_entries(y.y, p_tenant) e
      join public.calendar_day_types t on t.code = e.day_type_code
  ),
  days as (
    select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  ),
  placed as (
    select dd.day,
           (select s.y from st s where dd.day between s.session_starts_on and s.session_ends_on order by s.y desc limit 1) as session_year,
           (public.gregorian_to_ec(dd.day)).ec_year as own_year
      from days dd
  )
  select p.day,
         coalesce(p.session_year, p.own_year),
         coalesce(top.day_type_code,
                  case when wk.is_weekend then 'weekend'
                       when p.session_year is not null then 'instructional'
                       else 'out_of_session' end),
         coalesce(top.category, case when wk.is_weekend then 'rest' when p.session_year is not null then 'teaching' end),
         case when p.session_year is not null then true when s.session_starts_on is not null then false end,
         p.session_year is not null and not wk.is_weekend and coalesce(agg.all_count, true),
         wk.is_weekend or coalesce(agg.any_student, false) or (p.session_year is null and s.session_starts_on is not null),
         wk.is_weekend or coalesce(agg.any_staff, false)
    from placed p
    join st s on s.y = coalesce(p.session_year, p.own_year)
    cross join lateral (select extract(isodow from p.day)::smallint = any (s.weekend_days) as is_weekend) wk
    left join lateral (
      select e.day_type_code, e.category from ents e
       where e.yr = s.y and p.day between e.starts_on and e.ends_on
       order by e.rank, e.starts_on, e.entry_id limit 1
    ) top on true
    left join lateral (
      select bool_and(e.counts_as_instructional) as all_count,
             bool_or(e.blocks_student_attendance) as any_student,
             bool_or(e.blocks_staff_attendance) as any_staff
        from ents e where e.yr = s.y and p.day between e.starts_on and e.ends_on
    ) agg on true
   order by p.day;
end $$;
revoke execute on function public.calendar_days(date, date, uuid) from public, anon;
grant execute on function public.calendar_days(date, date, uuid) to authenticated;

create function public.calendar_day_status(p_date date, p_tenant uuid default null)
returns table (
  day date, ec_year integer, day_type_code text, category text, in_session boolean, counts boolean,
  blocks_student_attendance boolean, blocks_staff_attendance boolean
)
rows 1
language sql stable set search_path = public, pg_temp set jit = off as $$
  select * from public.calendar_days(p_date, p_date, p_tenant)
$$;
revoke execute on function public.calendar_day_status(date, uuid) from public, anon;
grant execute on function public.calendar_day_status(date, uuid) to authenticated;

create function public.instructional_days(p_from date, p_to date, p_tenant uuid default null)
returns integer language sql stable set search_path = public, pg_temp set jit = off as $$
  select count(*)::integer from public.calendar_days(p_from, p_to, p_tenant) where counts
$$;
revoke execute on function public.instructional_days(date, date, uuid) from public, anon;
grant execute on function public.instructional_days(date, date, uuid) to authenticated;

-- School entries: a closed calendar never changes; tenant_id must be the
-- calendar's; an override targets an unlocked entry of this school's own
-- layers for that year; authority-only and derived types are not entered;
-- at most 500 entries; dates within the EC year and 60 days either side.
create function public.school_calendar_entries_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_cal record;
  v_target record;
  v_settings record;
  v_type record;
begin
  select c.status, c.tenant_id, c.ec_year into v_cal
    from public.school_calendars c where c.id = coalesce(new.calendar_id, old.calendar_id);
  if v_cal.status = 'closed' then
    raise exception 'calendar_closed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.calendar_id, new.tenant_id) is distinct from (old.calendar_id, old.tenant_id) then
    raise exception 'calendar_closed' using errcode = '42501';
  end if;
  if new.tenant_id is distinct from v_cal.tenant_id then
    raise exception 'invalid_calendar' using errcode = '22023';
  end if;
  select t.authority_only, t.derived into v_type from public.calendar_day_types t where t.code = new.day_type_code;
  if not found or v_type.derived or (v_type.authority_only and not new.suppressed) then
    raise exception 'invalid_day_type' using errcode = '22023';
  end if;
  if new.starts_on < public.ec_to_gregorian(v_cal.ec_year, 1, 1) - 60
     or new.ends_on > public.ec_to_gregorian(v_cal.ec_year, 13, public.ec_days_in_month(v_cal.ec_year, 13)) + 60 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  if new.overrides_entry_id is not null then
    select * into v_settings from public.calendar_year_settings(v_cal.ec_year, v_cal.tenant_id);
    select e.locked, e.calendar_id into v_target from public.authority_calendar_entries e where e.id = new.overrides_entry_id;
    -- NULL-safe: with no published layer for the year nothing is a valid target.
    if not found or not coalesce(v_target.calendar_id = any (array[v_settings.moe_calendar_id, v_settings.region_calendar_id]), false) then
      raise exception 'invalid_override' using errcode = '22023';
    end if;
    if v_target.locked then
      raise exception 'calendar_entry_locked' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.school_calendar_entries where calendar_id = new.calendar_id) >= 500 then
    raise exception 'too_many_entries' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function public.school_calendar_entries_guard() from public, anon, authenticated;
create trigger school_calendar_entries_guard before insert or update or delete on public.school_calendar_entries
  for each row execute function public.school_calendar_entries_guard();

create function public.school_calendars_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'closed' then
    raise exception 'calendar_closed' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.tenant_id, new.ec_year) is distinct from (old.tenant_id, old.ec_year) then
    raise exception 'calendar_closed' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.school_calendars_guard() from public, anon, authenticated;
create trigger school_calendars_guard before update or delete on public.school_calendars
  for each row execute function public.school_calendars_guard();

-- ------------------------------------------------------ Choose Calendar --
-- "Use MoE Calendar" (moe): a draft with no entries of its own; everything
-- comes live from the MoE/regional layers. "Use Previous School Calendar"
-- (previous_year): also copies last year's school-authored entries to the
-- same EC month and day (Pagume 6 clamped to 5); a copy that would land on a
-- locked date is dropped and reported. Holidays are never copied: they come
-- from this year's layers. "Create Custom Calendar" (custom): suppresses
-- every unlocked MoE/regional entry, so only locked national and regional
-- dates remain. A draft may be recreated with another origin; a published or
-- closed calendar may not. Own school only; academic_calendar:create; the
-- year must be the current EC year or one either side.
create function public.create_school_calendar(p_ec_year integer, p_origin text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.get_tenant_id_for_user(auth.uid());
  v_now_year integer := (public.gregorian_to_ec((now() at time zone 'Africa/Addis_Ababa')::date)).ec_year;
  v_cal public.school_calendars;
  v_prev uuid;
  v_dropped jsonb := '[]'::jsonb;
  v_copied integer := 0;
  e record;
  v_from record;
  v_to record;
  v_start date;
  v_end date;
begin
  if v_uid is null or v_tenant is null
     or not coalesce(public.has_resource_permission(v_uid, 'academic_calendar', 'create'), false)
     or not public.has_module(v_tenant, 'events') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_origin is null or p_origin not in ('moe', 'previous_year', 'custom') then
    raise exception 'invalid_origin' using errcode = '22023';
  end if;
  if p_ec_year is null or p_ec_year not between v_now_year - 1 and v_now_year + 1 then
    raise exception 'invalid_year' using errcode = '22023';
  end if;
  if p_origin = 'previous_year' then
    select id into v_prev from public.school_calendars
     where tenant_id = v_tenant and ec_year = p_ec_year - 1 and status in ('published', 'closed');
    if v_prev is null then
      raise exception 'no_previous_calendar' using errcode = '22023';
    end if;
  end if;

  select * into v_cal from public.school_calendars
   where tenant_id = v_tenant and ec_year = p_ec_year for update;
  if found then
    -- Recreating a draft discards its entries: only someone who can see and
    -- edit the draft (academic_calendar:update) may do that.
    if v_cal.status <> 'draft'
       or not coalesce(public.has_resource_permission(v_uid, 'academic_calendar', 'update'), false) then
      raise exception 'calendar_exists' using errcode = '23505';
    end if;
    delete from public.school_calendar_entries where calendar_id = v_cal.id;
    update public.school_calendars
       set origin = p_origin, copied_from_calendar_id = v_prev, created_by = v_uid
     where id = v_cal.id
    returning * into v_cal;
  else
    insert into public.school_calendars (tenant_id, ec_year, origin, copied_from_calendar_id, created_by)
    values (v_tenant, p_ec_year, p_origin, v_prev, v_uid)
    returning * into v_cal;
  end if;

  if p_origin = 'custom' then
    insert into public.school_calendar_entries
      (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n, overrides_entry_id, suppressed, created_by)
    select v_tenant, v_cal.id, x.day_type_code, x.starts_on, x.ends_on, x.name_i18n, x.entry_id, true, v_uid
      from public.effective_calendar_entries(p_ec_year, v_tenant) x
     where x.level in ('moe', 'region') and not x.locked;
  elsif p_origin = 'previous_year' then
    for e in
      select * from public.school_calendar_entries
       where calendar_id = v_prev and overrides_entry_id is null and not suppressed
       order by starts_on, id
    loop
      v_from := public.gregorian_to_ec(e.starts_on);
      v_to := public.gregorian_to_ec(e.ends_on);
      v_start := public.ec_to_gregorian(v_from.ec_year + 1, v_from.ec_month,
                   least(v_from.ec_day, public.ec_days_in_month(v_from.ec_year + 1, v_from.ec_month)));
      v_end := public.ec_to_gregorian(v_to.ec_year + 1, v_to.ec_month,
                 least(v_to.ec_day, public.ec_days_in_month(v_to.ec_year + 1, v_to.ec_month)));
      if exists (select 1 from public.effective_calendar_entries(p_ec_year, v_tenant) x
                  where x.locked and x.starts_on <= v_end and x.ends_on >= v_start) then
        v_dropped := v_dropped || jsonb_build_object('name', e.name_i18n, 'starts_on', v_start, 'ends_on', v_end,
                                                     'reason', 'locked_date');
      else
        insert into public.school_calendar_entries
          (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n, created_by)
        values (v_tenant, v_cal.id, e.day_type_code, v_start, v_end, e.name_i18n, v_uid);
        v_copied := v_copied + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('calendar_id', v_cal.id, 'status', v_cal.status, 'origin', v_cal.origin,
                            'copied', v_copied, 'dropped', v_dropped);
end $$;
revoke execute on function public.create_school_calendar(integer, text) from public, anon, authenticated;
grant execute on function public.create_school_calendar(integer, text) to authenticated;

-- ------------------------------------------------------------------ seeds --
insert into public.edu_authorities (kind, code, name_i18n) values
  ('moe', 'MOE', '{"en": "Ministry of Education", "am": "ትምህርት ሚኒስቴር", "om": "Ministeera Barnootaa"}');
insert into public.edu_authorities (kind, code, name_i18n, parent_id)
select 'region', r.code, r.name::jsonb, (select id from public.edu_authorities where code = 'MOE')
from (values
  ('AA',  '{"en": "Addis Ababa City Administration Education Bureau", "am": "የአዲስ አበባ ከተማ አስተዳደር ትምህርት ቢሮ", "om": "Biiroo Barnootaa Bulchiinsa Magaalaa Finfinnee"}'),
  ('DD',  '{"en": "Dire Dawa City Administration Education Bureau", "am": "የድሬ ዳዋ ከተማ አስተዳደር ትምህርት ቢሮ", "om": "Biiroo Barnootaa Bulchiinsa Magaalaa Dirree Dawaa"}'),
  ('OR',  '{"en": "Oromia Education Bureau", "am": "የኦሮሚያ ትምህርት ቢሮ", "om": "Biiroo Barnootaa Oromiyaa"}'),
  ('AM',  '{"en": "Amhara Education Bureau", "am": "የአማራ ትምህርት ቢሮ", "om": "Biiroo Barnootaa Amaaraa"}'),
  ('TG',  '{"en": "Tigray Education Bureau", "am": "የትግራይ ትምህርት ቢሮ", "om": "Biiroo Barnootaa Tigraay"}'),
  ('AF',  '{"en": "Afar Education Bureau", "am": "የአፋር ትምህርት ቢሮ", "om": "Biiroo Barnootaa Affaar"}'),
  ('SO',  '{"en": "Somali Education Bureau", "am": "የሶማሌ ትምህርት ቢሮ", "om": "Biiroo Barnootaa Somaalee"}'),
  ('BG',  '{"en": "Benishangul-Gumuz Education Bureau", "am": "የቤኒሻንጉል ጉሙዝ ትምህርት ቢሮ", "om": "Biiroo Barnootaa Beenishaangul Gumuz"}'),
  ('GA',  '{"en": "Gambela Education Bureau", "am": "የጋምቤላ ትምህርት ቢሮ", "om": "Biiroo Barnootaa Gaambeellaa"}'),
  ('HR',  '{"en": "Harari Education Bureau", "am": "የሐረሪ ትምህርት ቢሮ", "om": "Biiroo Barnootaa Hararii"}'),
  ('SD',  '{"en": "Sidama Education Bureau", "am": "የሲዳማ ትምህርት ቢሮ", "om": "Biiroo Barnootaa Sidaamaa"}'),
  ('SWE', '{"en": "South West Ethiopia Education Bureau", "am": "የደቡብ ምዕራብ ኢትዮጵያ ትምህርት ቢሮ", "om": "Biiroo Barnootaa Kibba Lixa Itoophiyaa"}'),
  ('CE',  '{"en": "Central Ethiopia Education Bureau", "am": "የማዕከላዊ ኢትዮጵያ ትምህርት ቢሮ", "om": "Biiroo Barnootaa Giddugala Itoophiyaa"}'),
  ('SE',  '{"en": "South Ethiopia Education Bureau", "am": "የደቡብ ኢትዮጵያ ትምህርት ቢሮ", "om": "Biiroo Barnootaa Kibba Itoophiyaa"}')
) as r(code, name);

-- The owner's 18 event types, in order (src/features/academic-calendar/dayTypes.ts).
insert into public.calendar_day_types
  (code, label_i18n, color, category, counts_as_instructional, blocks_student_attendance, blocks_staff_attendance,
   lockable, authority_only, derived, legend_order)
values
  ('instructional',         '{"en": "Instructional Day", "am": "የትምህርት ቀን", "om": "Guyyaa Barnootaa"}',              '#ffffff', 'teaching',  true,  false, false, false, false, true,  1),
  ('weekend',               '{"en": "Weekend", "am": "የሳምንት መጨረሻ", "om": "Dhuma Torbanii"}',                         '#f4b183', 'rest',      false, true,  true,  false, false, true,  2),
  ('national_holiday',      '{"en": "National Holiday", "am": "ብሔራዊ በዓል", "om": "Ayyaana Biyyaalessaa"}',               '#2e75b6', 'holiday',   false, true,  true,  true,  true,  false, 3),
  ('religious_holiday',     '{"en": "Religious Holiday", "am": "ሃይማኖታዊ በዓል", "om": "Ayyaana Amantii"}',                '#2e75b6', 'holiday',   false, true,  true,  true,  true,  false, 4),
  ('regional_holiday',      '{"en": "Regional Holiday", "am": "ክልላዊ በዓል", "om": "Ayyaana Naannoo"}',                    '#5b9bd5', 'holiday',   false, true,  true,  true,  true,  false, 5),
  ('school_holiday',        '{"en": "School Holiday", "am": "የትምህርት ቤት በዓል", "om": "Ayyaana Mana Barumsaa"}',          '#9dc3e6', 'holiday',   false, true,  true,  false, false, false, 6),
  ('mid_term_break',        '{"en": "Mid-Term Break", "am": "የመንፈቅ አጋማሽ እረፍት", "om": "Boqonnaa Walakkaa Seemisteraa"}', '#a9d18e', 'break',     false, true,  false, false, false, false, 7),
  ('semester_break',        '{"en": "Semester Break", "am": "የሴሚስተር እረፍት", "om": "Boqonnaa Seemisteraa"}',              '#70ad47', 'break',     false, true,  false, true,  true,  false, 8),
  ('examination',           '{"en": "Examination", "am": "ፈተና", "om": "Qormaata"}',                                    '#e88a8e', 'exam',      true,  false, false, true,  false, false, 9),
  ('registration',          '{"en": "Registration", "am": "ምዝገባ", "om": "Galmee"}',                                    '#ffd966', 'admin',     false, true,  false, false, false, false, 10),
  ('teacher_training',      '{"en": "Teacher Training", "am": "የመምህራን ስልጠና", "om": "Leenjii Barsiisotaa"}',            '#c9b3e6', 'staff',     false, true,  false, false, false, false, 11),
  ('staff_development',     '{"en": "Staff Development", "am": "የሠራተኞች አቅም ግንባታ", "om": "Guddina Dandeettii Hojjettootaa"}', '#b4a7d6', 'staff', false, true, false, false, false, false, 12),
  ('parent_meeting',        '{"en": "Parent Meeting", "am": "የወላጆች ስብሰባ", "om": "Walgahii Maatii"}',                   '#f8cbad', 'event',     true,  false, false, false, false, false, 13),
  ('result_publication',    '{"en": "Result Publication", "am": "የውጤት ይፋ መሆን", "om": "Ifa Ba''uu Bu''aa"}',             '#a9dcd5', 'milestone', true,  false, false, false, false, false, 14),
  ('academic_year_opening', '{"en": "Academic Year Opening", "am": "የትምህርት ዘመን መክፈቻ", "om": "Banama Waggaa Barnootaa"}',  '#fff2cc', 'milestone', true,  false, false, true,  true,  false, 15),
  ('academic_year_closing', '{"en": "Academic Year Closing", "am": "የትምህርት ዘመን መዝጊያ", "om": "Cufama Waggaa Barnootaa"}',  '#fff2cc', 'milestone', true,  false, false, true,  true,  false, 16),
  ('special_closure',       '{"en": "Special Closure", "am": "ልዩ መዘጋት", "om": "Cufama Addaa"}',                         '#7f7f7f', 'closure',   false, true,  true,  false, false, false, 17),
  ('other',                 '{"en": "Other", "am": "ሌላ", "om": "Kan Biraa"}',                                          '#e7e6e6', 'event',     true,  false, false, false, false, false, 18);

-- Fixed-date national holiday rules (src/lib/ethiopian-holidays.ts NATIONAL_HOLIDAY_RULES).
-- Ginbot 20 is not one: the MoE calendar counts it as a school day (owner,
-- 2026-10-09: follow the MoE).
insert into public.holiday_rules (code, kind, params, day_type_code, name_i18n) values
  ('enkutatash',    'ec_fixed',        '{"month": 1, "day": 1}',   'national_holiday',  '{"en": "Enkutatash (New Year)", "am": "እንቁጣጣሽ (ዘመን መለወጫ)", "om": "Ayyaana Waggaa Haaraa"}'),
  ('meskel',        'ec_fixed',        '{"month": 1, "day": 17}',  'religious_holiday', '{"en": "Meskel", "am": "መስቀል", "om": "Masqala"}'),
  ('genna',         'gregorian_fixed', '{"month": 1, "day": 7}',   'religious_holiday', '{"en": "Genna (Christmas)", "am": "ገና", "om": "Qillee (Dhalootaa)"}'),
  ('timket',        'ec_fixed',        '{"month": 5, "day": 11}',  'religious_holiday', '{"en": "Timket (Epiphany)", "am": "ጥምቀት", "om": "Cuuphaa"}'),
  ('adwa',          'ec_fixed',        '{"month": 6, "day": 23}',  'national_holiday',  '{"en": "Adwa Victory Day", "am": "የዓድዋ ድል በዓል", "om": "Ayyaana Injifannoo Adwaa"}'),
  ('labour_day',    'gregorian_fixed', '{"month": 5, "day": 1}',   'national_holiday',  '{"en": "International Labour Day", "am": "የዓለም የሠራተኞች ቀን", "om": "Guyyaa Hojjettootaa Addunyaa"}'),
  ('patriots_day',  'ec_fixed',        '{"month": 8, "day": 27}',  'national_holiday',  '{"en": "Patriots'' Victory Day", "am": "የአርበኞች ቀን", "om": "Guyyaa Injifannoo Gootota Biyyaa"}');

-- The MoE's published 2019 EC calendar ("Present Academic Year"), as the
-- sheet gives it: session from Nehase 25, 2018 (its lead-in row) to Sene 30,
-- 2019. Meskel and Labour Day fall on a weekend that year; Ginbot 20 (a
-- Friday) is a school day, as in every MoE calendar. Siklet and the
-- two Eids are the dates the MoE published (no computation).
insert into public.authority_calendars (authority_id, ec_year, session_starts_on, session_ends_on, status, published_at)
values ((select id from public.edu_authorities where code = 'MOE'), 2019,
        public.ec_to_gregorian(2018, 12, 25), public.ec_to_gregorian(2019, 10, 30), 'published', now());
insert into public.authority_calendar_entries (calendar_id, day_type_code, starts_on, ends_on, name_i18n, rule_code)
select (select c.id from public.authority_calendars c join public.edu_authorities a on a.id = c.authority_id
         where a.code = 'MOE' and c.ec_year = 2019),
       x.type, public.ec_to_gregorian(2019, x.m1, x.d1), public.ec_to_gregorian(2019, x.m2, x.d2), x.name::jsonb, x.rule
from (values
  ('national_holiday',      1, 1,  1, 1,  '{"en": "Enkutatash (New Year)", "am": "እንቁጣጣሽ (ዘመን መለወጫ)", "om": "Ayyaana Waggaa Haaraa"}', 'enkutatash'),
  ('academic_year_opening', 1, 4,  1, 4,  '{"en": "First day of the first semester", "am": "የመጀመሪያው መንፈቀ ዓመት የመጀመሪያ ቀን", "om": "Guyyaa jalqabaa seemisteera jalqabaa"}', null),
  ('religious_holiday',     1, 17, 1, 17, '{"en": "Meskel", "am": "መስቀል", "om": "Masqala"}', 'meskel'),
  ('religious_holiday',     4, 29, 4, 29, '{"en": "Genna (Christmas)", "am": "ገና", "om": "Qillee (Dhalootaa)"}', 'genna'),
  ('religious_holiday',     5, 11, 5, 11, '{"en": "Timket (Epiphany)", "am": "ጥምቀት", "om": "Cuuphaa"}', 'timket'),
  ('examination',           5, 17, 5, 23, '{"en": "First-semester final examination", "am": "የመጀመሪያ መንፈቀ ዓመት ማጠቃለያ ፈተና", "om": "Qormaata xumuraa seemisteera jalqabaa"}', null),
  ('semester_break',        5, 24, 5, 30, '{"en": "Semester break", "am": "የመንፈቀ ዓመት እረፍት", "om": "Boqonnaa seemisteraa"}', null),
  ('national_holiday',      6, 23, 6, 23, '{"en": "Adwa Victory Day", "am": "የዓድዋ ድል በዓል", "om": "Ayyaana Injifannoo Adwaa"}', 'adwa'),
  ('religious_holiday',     6, 30, 6, 30, '{"en": "Eid al-Fitr", "am": "ኢድ አል ፊጥር", "om": "Iid Al Fixir"}', null),
  ('religious_holiday',     8, 22, 8, 22, '{"en": "Siklet (Good Friday)", "am": "ስቅለት", "om": "Siqlata"}', null),
  ('national_holiday',      8, 23, 8, 23, '{"en": "International Labour Day", "am": "የዓለም የሠራተኞች ቀን", "om": "Guyyaa Hojjettootaa Addunyaa"}', 'labour_day'),
  ('national_holiday',      8, 27, 8, 27, '{"en": "Patriots'' Victory Day", "am": "የአርበኞች ቀን", "om": "Guyyaa Injifannoo Gootota Biyyaa"}', 'patriots_day'),
  ('religious_holiday',     9, 8,  9, 8,  '{"en": "Eid al-Adha", "am": "ኢድ አል አድሃ (አረፋ)", "om": "Iid Al Adhaa (Arafaa)"}', null),
  ('examination',          10, 21, 10, 25, '{"en": "Second-semester final examination", "am": "የሁለተኛ መንፈቀ ዓመት ማጠቃለያ ፈተና", "om": "Qormaata xumuraa seemisteera lammaffaa"}', null),
  ('school_holiday',       10, 30, 10, 30, '{"en": "Parents'' Day", "am": "የወላጆች ቀን በዓል", "om": "Guyyaa Maatii"}', null),
  ('academic_year_closing',10, 30, 10, 30, '{"en": "Last day of the academic year", "am": "የትምህርት ዘመኑ የመጨረሻ ቀን", "om": "Guyyaa dhumaa waggaa barnootaa"}', null)
) as x(type, m1, d1, m2, d2, name, rule);
