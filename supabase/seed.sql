-- ============================================================================
-- STAGING SEED — INSA Phase 6 testing scope accounts.
-- ⚠️ This script asserts it is NOT running against production.
-- Passwords are placeholders rotated per audit engagement, delivered out-of-band.
-- ============================================================================
do $$
begin
  if current_setting('app.environment', true) = 'production' then
    raise exception 'Refusing to seed audit accounts in production';
  end if;
end $$;

insert into public.tenants (id, name, slug, status) values
  ('11111111-1111-1111-1111-111111111111', 'Tenant A Demo School', 'tenant-a', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'Tenant B Demo School', 'tenant-b', 'active')
on conflict do nothing;

-- Audit accounts (create matching auth.users via `supabase auth admin` or the
-- onboard-tenant function; profile rows below assume those auth ids):
--   audit-superadmin@staging.example  super_admin   —
--   audit-admin-a@staging.example     school_admin  Tenant A
--   audit-hr-a@staging.example        hr_officer    Tenant A
--   audit-accountant-a@staging.example accountant   Tenant A
--   audit-teacher-a@staging.example   teacher       Tenant A
--   audit-parent-a@staging.example    parent        Tenant A
--   audit-student-a@staging.example   student       Tenant A
--   audit-admin-b@staging.example     school_admin  Tenant B (cross-tenant isolation tests)
