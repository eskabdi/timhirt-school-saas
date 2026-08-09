-- ============================================================================
-- 001 CORE — tenants, users, security-definer helpers, audit engine
-- INSA §4.2: tenant isolation via RLS; all queries parameterized (PostgREST);
-- passwords never stored here (Supabase Auth bcrypt in auth.users).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------- Enums (DB-level allow-lists — INSA input validation in depth) ----
create type public.user_role as enum
  ('super_admin','school_admin','teacher','student','parent',
   'hr_officer','accountant','registrar');
create type public.tenant_status as enum ('active','suspended','trial');
create type public.app_locale as enum ('en','am','om');

-- ---------- Tenants ---------------------------------------------------------
create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 2 and 120),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  status     public.tenant_status not null default 'trial',
  created_at timestamptz not null default now()
);

-- ---------- Users (profile mirror of auth.users) ----------------------------
create table public.users (
  id         uuid primary key,                       -- = auth.users.id
  tenant_id  uuid references public.tenants(id),     -- null only for super_admin
  role       public.user_role not null,
  full_name  text not null check (length(full_name) between 1 and 120),
  email      text not null unique,                   -- 🔒 PII
  phone      text check (phone ~ '^\+?[0-9]{7,15}$'),-- 🔒 PII
  locale     public.app_locale not null default 'en',
  created_at timestamptz not null default now(),
  constraint tenant_required_unless_super
    check (role = 'super_admin' or tenant_id is not null)
);
create index users_tenant_idx on public.users (tenant_id);

-- ---------- Security-definer helpers (single source of truth for RLS) -------
create or replace function public.get_tenant_id_for_user(user_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.users where id = user_id
$$;

create or replace function public.get_role_for_user(user_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select role::text from public.users where id = user_id
$$;

-- Locale-aware label resolution for jsonb i18n columns (§16.4)
create or replace function public.t_field(field jsonb, locale text)
returns text language sql immutable as $$
  select coalesce(field->>locale, field->>'en', field->>'am', field->>'om')
$$;

-- ---------- shared updated_at trigger ---------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- Audit engine (INSA logging: append-only, PII redacted) ----------
create table public.audit_logs (
  id         bigint generated always as identity primary key,
  tenant_id  uuid,
  actor_id   uuid,
  action     text not null,
  table_name text not null,
  row_id     uuid,
  old_data   jsonb,
  new_data   jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_tenant_time on public.audit_logs (tenant_id, created_at);

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare r_old jsonb; r_new jsonb;
begin
  -- Redact PII/secrets before persisting (INSA: no sensitive data in logs)
  r_old := to_jsonb(old) - 'medical_notes' - 'phone' - 'email'
           - 'tin_number' - 'pension_no' - 'bank_account';
  r_new := to_jsonb(new) - 'medical_notes' - 'phone' - 'email'
           - 'tin_number' - 'pension_no' - 'bank_account';
  insert into public.audit_logs(tenant_id, actor_id, action, table_name, row_id, old_data, new_data)
  values (coalesce((to_jsonb(new)->>'tenant_id')::uuid, (to_jsonb(old)->>'tenant_id')::uuid),
          auth.uid(), lower(tg_op), tg_table_name,
          coalesce((to_jsonb(new)->>'id')::uuid, (to_jsonb(old)->>'id')::uuid),
          r_old, r_new);
  return coalesce(new, old);
end $$;

-- audit_logs is append-only: RLS with read-only policies, no update/delete
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;
create policy audit_read on public.audit_logs for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
      and (select public.get_role_for_user(auth.uid())) = 'school_admin')
);

-- ---------- Tenant config (branding, locale, calendar, feature flags) -------
create table public.tenant_configs (
  tenant_id  uuid primary key references public.tenants(id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create trigger tenant_configs_updated before update on public.tenant_configs
for each row execute function public.set_updated_at();
