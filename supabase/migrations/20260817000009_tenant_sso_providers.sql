-- SAML SSO, part 2: tenant<->IdP mapping table.
--
-- Actual SAML metadata/certificate storage lives in GoTrue itself (created
-- via the Supabase Management API from the manage-sso-provider Edge
-- Function) -- this table only tracks the tenant<->provider mapping and the
-- email domain used to route a login to the right IdP, mirroring
-- manage-integration-credentials' precedent of never keeping a second copy
-- of sensitive material.
--
-- domain is GLOBALLY unique (not per-tenant): GoTrue's own SSO domain
-- routing is project-global, so two tenants cannot register the same email
-- domain regardless of what this table's constraint says -- the constraint
-- just makes that fact visible at the DB layer instead of surfacing only as
-- a confusing GoTrue-side rejection.
create table public.tenant_sso_providers (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id),
  domain              text not null unique check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  gotrue_provider_id  uuid unique,
  metadata_url        text not null check (metadata_url ~ '^https://'),
  enabled             boolean not null default false,
  created_by          uuid references public.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id)
);

create trigger tenant_sso_providers_updated before update on public.tenant_sso_providers
for each row execute function public.set_updated_at();

alter table public.tenant_sso_providers enable row level security;
alter table public.tenant_sso_providers force row level security;

-- Which domain routes to which tenant is not sensitive (same reasoning as
-- roles_tenant_isolation's unrestricted-within-tenant read) -- any tenant
-- member can see their own tenant's SSO config.
create policy tenant_sso_providers_select on public.tenant_sso_providers for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
);

-- Both USING and WITH CHECK carry the school_admin check on this `for all`
-- policy -- role_permissions_admin_manage (20260817000007) had to be
-- retrofitted with this after a live cross-tenant self-escalation finding;
-- applied correctly here from the start rather than a bare tenant check.
create policy tenant_sso_providers_admin_manage on public.tenant_sso_providers for all to authenticated
using (
  (select public.get_role_for_user(auth.uid())) = 'school_admin'
  and tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
)
with check (
  (select public.get_role_for_user(auth.uid())) = 'school_admin'
  and tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
);
