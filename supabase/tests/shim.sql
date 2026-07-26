-- ============================================================================
-- Minimal stand-ins for the Supabase-managed schemas, so the pgTAP suites can
-- run against a plain Postgres container.
--
-- `supabase start` boots the whole stack — Postgres, GoTrue, Storage, Realtime,
-- Kong, Studio — to run four SQL files. In CI that is slow and, as the rls-tests
-- job kept demonstrating, prone to hanging on image pulls. Everything the suites
-- actually touch is Postgres-side: the auth.users table, auth.uid(), the storage
-- object/bucket tables and the vault view. Those are reproduced here.
--
-- This is a TEST fixture, never a migration. It must not be applied to a real
-- project, where Supabase owns all of these objects.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pgtap;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists vault;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon;          end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role;  end if;
end $$;

-- Column set mirrors GoTrue's: the suites insert real-looking rows (aud,
-- encrypted_password, confirmation_token …), and a narrower table would fail
-- on the insert rather than on the policy being tested.
create table if not exists auth.users (
  instance_id                 uuid,
  id                          uuid primary key,
  aud                         varchar(255),
  role                        varchar(255),
  email                       varchar(255),
  encrypted_password          varchar(255),
  email_confirmed_at          timestamptz,
  invited_at                  timestamptz,
  confirmation_token          varchar(255),
  confirmation_sent_at        timestamptz,
  recovery_token              varchar(255),
  recovery_sent_at            timestamptz,
  email_change_token_new      varchar(255),
  email_change                varchar(255),
  email_change_sent_at        timestamptz,
  last_sign_in_at             timestamptz,
  raw_app_meta_data           jsonb,
  raw_user_meta_data          jsonb,
  is_super_admin              boolean,
  created_at                  timestamptz,
  updated_at                  timestamptz,
  phone                       text,
  phone_confirmed_at          timestamptz,
  banned_until                timestamptz,
  deleted_at                  timestamptz
);

-- RLS reads the caller's identity from these. The GUCs are what PostgREST sets
-- per request, so `set local request.jwt.claim.sub` in a test reproduces a
-- logged-in user faithfully.
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

create or replace function auth.role() returns text language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;

create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(), metadata jsonb
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[] language sql immutable as
$$ select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/') $$;

create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique, secret text, created_at timestamptz default now()
);

create or replace function vault.create_secret(secret text, name text default null, description text default null)
returns uuid language sql as
$$ insert into vault.secrets(name, secret) values (name, secret)
   on conflict (name) do update set secret = excluded.secret returning id $$;

create or replace view vault.decrypted_secrets as
  select id, name, secret, secret as decrypted_secret, created_at from vault.secrets;

grant usage on schema auth, storage, vault to authenticated, anon, service_role;
grant select on auth.users to authenticated, anon, service_role;

-- Supabase grants the API roles table-level DML on the storage tables and lets
-- RLS do the actual gating. Without these grants a policy test fails with
-- "permission denied for table objects" before any policy is consulted, which
-- would make a storage suite look like it caught something it never reached.
grant select, insert, update, delete on storage.objects to authenticated, anon, service_role;
grant select on storage.buckets to authenticated, anon, service_role;
