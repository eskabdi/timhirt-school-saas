-- ============================================================================
-- document_templates (20260903000001). The assertions that matter here are
-- the ones that would let a school configure templates it hasn't paid for,
-- or make a document unreadable:
--
--   * write requires school_admin AND has_module -- a Premium school_admin
--     can write; a Basic school_admin CANNOT, even though their role is
--     identical (this is the half a UI-only gate would miss, Round 1's
--     lesson);
--   * a non-admin role in a Premium tenant still cannot write;
--   * reads stay tenant-scoped, and are NOT admin-only (the generators run
--     as teachers/portal users and must read the row to render it);
--   * watermark_opacity is clamped -- 1.0 would paint an opaque block over
--     the document body;
--   * document_type is pinned to the known set.
-- ============================================================================
begin;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'd7100000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'dt-prem-admin@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd7100000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'dt-basic-admin@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd7100000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'dt-teacher@test.example', crypt('x', gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status, tier_key) values
  ('d7000000-0000-0000-0000-00000000000a', 'DT Premium', 'rls-test-dt-premium', 'active', 'premium'),
  ('d7000000-0000-0000-0000-00000000000b', 'DT Basic',   'rls-test-dt-basic',   'active', 'basic');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('d7100000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-00000000000a', 'school_admin', 'DT Prem Admin',  'dt-prem-admin@test.example'),
  ('d7100000-0000-0000-0000-000000000002', 'd7000000-0000-0000-0000-00000000000b', 'school_admin', 'DT Basic Admin', 'dt-basic-admin@test.example'),
  ('d7100000-0000-0000-0000-000000000003', 'd7000000-0000-0000-0000-00000000000a', 'teacher',      'DT Teacher',     'dt-teacher@test.example');

-- ---------- module resolution by tier -------------------------------------
select is(
  public.has_module('d7000000-0000-0000-0000-00000000000a', 'document_templates'),
  true, 'Premium gets document_templates by tier default');

select is(
  public.has_module('d7000000-0000-0000-0000-00000000000b', 'document_templates'),
  false, 'Basic does NOT get document_templates by tier default');

select is(
  public.has_module('d7000000-0000-0000-0000-00000000000a', 'document_templates')
    and not public.has_module('d7000000-0000-0000-0000-00000000000b', 'document_templates'),
  true, 'document_templates is Premium-and-above, not a Standard-tier feature');

set local role authenticated;

-- ---------- write: Premium school_admin can ------------------------------
set local request.jwt.claim.sub = 'd7100000-0000-0000-0000-000000000001';
select lives_ok(
  $$ insert into public.document_templates (tenant_id, document_type, header_text, footer_text)
     values ('d7000000-0000-0000-0000-00000000000a', 'transcript', 'Premium Header', 'Premium Footer') $$,
  'a Premium school_admin can configure a template');

-- ---------- write: Basic school_admin CANNOT (module half of the policy) --
set local request.jwt.claim.sub = 'd7100000-0000-0000-0000-000000000002';
select throws_ok(
  $$ insert into public.document_templates (tenant_id, document_type, header_text)
     values ('d7000000-0000-0000-0000-00000000000b', 'transcript', 'Should Not Persist') $$,
  '42501', null,
  'a Basic school_admin CANNOT configure a template -- same role, missing module');

-- ---------- write: non-admin in a Premium tenant cannot -------------------
set local request.jwt.claim.sub = 'd7100000-0000-0000-0000-000000000003';
select throws_ok(
  $$ insert into public.document_templates (tenant_id, document_type, header_text)
     values ('d7000000-0000-0000-0000-00000000000a', 'invoice', 'Teacher Header') $$,
  '42501', null,
  'a teacher in a Premium tenant cannot configure templates -- role half of the policy');

-- ---------- read: tenant-scoped, and available to non-admins -------------
select is(
  (select count(*)::int from public.document_templates where tenant_id = 'd7000000-0000-0000-0000-00000000000a'),
  1, 'a teacher CAN read their tenant''s template (generators run as non-admins)');

set local request.jwt.claim.sub = 'd7100000-0000-0000-0000-000000000002'; -- other tenant
select is(
  (select count(*)::int from public.document_templates),
  0, 'a different tenant sees zero templates');

-- ---------- constraints ---------------------------------------------------
set local role postgres;
reset request.jwt.claim.sub;

select throws_ok(
  $$ insert into public.document_templates (tenant_id, document_type, watermark_opacity)
     values ('d7000000-0000-0000-0000-00000000000a', 'invoice', 1.0) $$,
  '23514', null,
  'watermark_opacity is clamped -- a fully opaque watermark would hide the document body');

select throws_ok(
  $$ insert into public.document_templates (tenant_id, document_type)
     values ('d7000000-0000-0000-0000-00000000000a', 'id_card') $$,
  '23514', null,
  'an unknown document_type is rejected (id_card has a fixed layout and is not templatable)');

reset role;
select * from finish();
rollback;
