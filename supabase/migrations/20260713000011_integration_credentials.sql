-- ============================================================================
-- 011 INTEGRATION CREDENTIALS — self-service Chapa/SMS-gateway credential
-- management for super_admin, replacing "credentials only settable via
-- `supabase secrets set`" as the sole path. Uses Supabase Vault (pgsodium-
-- backed encryption at rest) so secret material is:
--   (a) never readable through PostgREST by ANY authenticated role, including
--       super_admin — only service_role can decrypt via vault.decrypted_secrets;
--   (b) never re-displayed to the browser once saved — the UI only ever
--       shows "configured: yes/no" + last-updated metadata;
--   (c) writable ONLY through the manage-integration-credentials Edge
--       Function (service_role), never via a direct PostgREST insert/update
--       path — there is no RLS policy on secret material because there is no
--       client-reachable table holding it at all.
-- Edge Functions that need a credential check Vault first, then fall back to
-- Deno.env.get(...) — so an infra team that prefers `supabase secrets set`
-- continues to work unmodified; this is additive, not a replacement.
-- ============================================================================

create extension if not exists supabase_vault;

-- Non-secret metadata only — safe to expose to super_admin via normal RLS.
-- Never stores key material; `configured` flips true once every required
-- secret for that provider has been written to Vault at least once.
create table public.platform_integrations (
  provider     text primary key check (provider in (
                 'chapa', 'telebirr', 'stripe', 'sms_geezsms', 'sms_afromessage')),
  display_name text not null,
  configured   boolean not null default false,
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);
insert into public.platform_integrations (provider, display_name) values
  ('chapa', 'Chapa (ETB payments)'),
  ('telebirr', 'Telebirr (direct)'),
  ('stripe', 'Stripe (international)'),
  ('sms_geezsms', 'GeezSMS'),
  ('sms_afromessage', 'AfroMessage');

alter table public.platform_integrations enable row level security;
alter table public.platform_integrations force row level security;
create policy platform_integrations_select on public.platform_integrations
for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
);
-- No client-writable policy: writes happen only through the Edge Function
-- below (service_role), which also updates this metadata row atomically
-- with the Vault secret write.

-- Every credential write is audited (metadata only — never the secret value).
create trigger audit_platform_integrations after insert or update or delete
on public.platform_integrations for each row execute function public.audit_trigger();

-- Restrict Vault's decrypted view to service_role explicitly (belt-and-
-- suspenders — Vault does not grant this to authenticated/anon by default,
-- but an explicit revoke documents the intent and survives a future
-- extension-version change that might alter defaults).
revoke all on vault.decrypted_secrets from authenticated, anon;
revoke all on vault.secrets from authenticated, anon;
