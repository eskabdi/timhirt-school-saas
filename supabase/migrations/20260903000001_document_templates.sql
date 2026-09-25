-- ============================================================================
-- R5-C1 + C2: `document_templates` -- a Premium/Enterprise-only module that
-- lets a school put its own header/footer/signature/watermark on generated
-- documents.
--
-- THE SAFETY PROPERTY, stated first because everything else follows from it:
-- absence of a row means exactly today's fixed output for that document type.
-- Not "a default template" -- no row, no change. Abadir is already premium,
-- so it gains this module the moment this ships; that must not alter a single
-- PDF any of its real students have already been handed. A settings page
-- appears with nothing configured in it, and nothing renders differently
-- until the school itself acts.
--
-- WATERMARK OPACITY is clamped in a CHECK rather than trusted from the
-- client: a value of 1.0 would paint an opaque block over the document body,
-- which is a way to make a transcript unreadable, not a way to style it.
--
-- RLS: reads are tenant-scoped (any authenticated member of the tenant --
-- the generators run as the calling user and must be able to read the row
-- they are about to render). WRITES require school_admin AND
-- has_module(tenant_id, 'document_templates') -- BOTH, per C2. The module
-- half is what stops a Basic-tier school_admin from configuring templates
-- through a direct PostgREST call; Round 1's lesson was that a UI-only gate
-- is not a gate, so the module check lives in the policy itself.
-- ============================================================================

insert into public.modules (key, display_name, sort_order) values
  ('document_templates', 'Document Templates', 20)
on conflict (key) do nothing;

-- Premium and Enterprise only -- deliberately NOT standard.
insert into public.tier_modules (tier_key, module_key)
select key, 'document_templates' from public.subscription_tiers
where key in ('premium', 'enterprise')
on conflict do nothing;

create table public.document_templates (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  -- Free text rather than an enum: the set of document types is a frontend
  -- concern (C3's matrix) that will grow, and an enum would need a migration
  -- every time a generator is added. The CHECK pins the current set so a
  -- typo still fails loudly.
  document_type       text not null check (document_type in (
    'transcript', 'report_card', 'invoice', 'receipt',
    'payslip', 'leaving_certificate', 'seating_chart')),
  header_text         text check (header_text is null or char_length(header_text) <= 200),
  footer_text         text check (footer_text is null or char_length(footer_text) <= 300),
  show_signature_line boolean not null default false,
  signature_title     text check (signature_title is null or char_length(signature_title) <= 100),
  watermark_text      text check (watermark_text is null or char_length(watermark_text) <= 60),
  watermark_opacity   numeric not null default 0.15 check (watermark_opacity > 0 and watermark_opacity <= 0.5),
  updated_by          uuid references public.users(id),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, document_type)
);
create index document_templates_tenant on public.document_templates (tenant_id);

alter table public.document_templates enable row level security;
alter table public.document_templates force row level security;

create trigger document_templates_updated before update on public.document_templates
for each row execute function public.set_updated_at();

create trigger audit_document_templates after insert or update or delete on public.document_templates
for each row execute function public.audit_trigger();

-- Read: any authenticated member of the tenant. The generators (transcript,
-- report card, ...) run under the caller's own session and read this row
-- before rendering, and those callers include teachers and portal users, so
-- restricting reads to school_admin would break the very documents this
-- table configures.
create policy document_templates_select on public.document_templates for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
);

-- Write: school_admin AND the module. Both halves, per C2.
create policy document_templates_write on public.document_templates for all to authenticated
using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) = 'school_admin'
  and public.has_module(tenant_id, 'document_templates')
)
with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) = 'school_admin'
  and public.has_module(tenant_id, 'document_templates')
);
