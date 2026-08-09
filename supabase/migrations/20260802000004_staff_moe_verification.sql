-- The "MoE Verified" badge on the staff profile was always drawn, regardless
-- of whether anyone had actually checked the person's Ministry of Education
-- credentials. Give it a real boolean an admin sets deliberately, mirroring
-- employee_documents.verified/verified_by/verified_at (20260729000007).
alter table public.employees
  add column if not exists moe_verified boolean not null default false,
  add column if not exists moe_verified_by uuid,
  add column if not exists moe_verified_at timestamptz;

-- 20260713000010 revoked table-wide SELECT on employees and replaced it with
-- an explicit column list (§18.5's trap) -- a column added later is
-- unreadable by `authenticated` until granted here, same failure mode as
-- 20260729000007 and 20260720000002 before it.
grant select (moe_verified, moe_verified_by, moe_verified_at)
  on public.employees to authenticated;

-- employees_write (20260713000005) already restricts writes on this table to
-- school_admin/hr_officer, so no new RLS policy is needed for the toggle.
