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

-- Real Supabase's service_role has BYPASSRLS -- that is the entire point of
-- the service-role key, and every Edge Function in this repo relies on it.
-- Without it here, `set local role service_role` in a pgTAP suite still gets
-- filtered by each table's RLS policies (which only grant `to authenticated`),
-- so a suite exercising a service_role-only RPC sees rows silently vanish
-- and misreports a real bug as a test failure.
alter role service_role bypassrls;

-- Supabase's default privileges on `public` (R6 WP-01, finding L-08). Real
-- projects grant the API roles USAGE on the schema and, through
-- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON
-- {TABLES,SEQUENCES,FUNCTIONS} TO anon, authenticated, service_role`
-- (supabase/cli initial_schemas, and production's own pg_default_acl, captured
-- in audit/evidence/), an explicit per-role grant on every object a migration
-- creates. `revoke … from public` does not remove those per-role grants. The
-- shim used to grant nothing on `public`, so anon could not even reach the
-- schema and every "anon cannot call X" probe passed vacuously: that is how
-- H-01 (46 anon-executable SECURITY DEFINER functions in production before
-- WP-00 revoked four; 42 remain, see supabase/security/definer_anon_known.sql) stayed
-- invisible to a green harness. This must run before any migration creates
-- objects, and as the role that owns them (postgres), exactly like production.
-- Global defaults are stored per role, not per schema, so they outlive the
-- schema reset in run.sh. Restore PostgreSQL's built-in default (EXECUTE for
-- PUBLIC on new functions, which Supabase keeps), so a local run cannot
-- inherit a default a previous run's migration experiment left behind.
alter default privileges for role postgres grant execute on functions to public;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;

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

-- Schema USAGE and auth.users access exactly as production has them
-- (audit/evidence/wp01-prod-calendar-and-schema-grants-*.txt): every API role
-- reaches auth and storage; only service_role reaches vault; no API role, not
-- even service_role, can SELECT auth.users (it belongs to supabase_auth_admin;
-- Edge Functions use the Auth admin API). The shim used to grant more
-- (reviews TI-4, TI-R2-5, DM-5).
grant usage on schema auth, storage to authenticated, anon, service_role;
grant usage on schema vault to service_role;

-- Supabase grants the API roles table-level DML on the storage tables and lets
-- RLS do the actual gating. Without these grants a policy test fails with
-- "permission denied for table objects" before any policy is consulted, which
-- would make a storage suite look like it caught something it never reached.
grant select, insert, update, delete on storage.objects to authenticated, anon, service_role;
grant select on storage.buckets to authenticated, anon, service_role;
