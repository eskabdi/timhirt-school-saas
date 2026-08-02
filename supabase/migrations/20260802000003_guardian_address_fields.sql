-- ============================================================================
-- guardians has carried relationship/phone/email/full_name (20260725000001)
-- but the public admission form collects far more about a guardian --
-- occupation, region, subcity, woreda, kebele, house number, and an Amharic
-- name -- all of which admission_applications stores but the RPC has no
-- column on this table to copy them into, so every one of those fields is
-- discarded the moment an application becomes a student.
--
-- Named to match this table's own convention (full_name, not
-- guardian_full_name -- the table already says "guardian") rather than
-- admission_applications' guardian_-prefixed columns. woreda and kebele are
-- split rather than the combined guardian_woreda_kebele the application
-- form uses, at the caller's explicit request.
--
-- No grant statement needed: unlike students/employees, guardians has never
-- had its authenticated GRANT narrowed to a column list (confirmed against
-- information_schema.role_table_grants), so a new column is selectable
-- immediately.
-- ============================================================================
alter table public.guardians
  add column if not exists name_am text
    check (name_am is null or length(name_am) between 1 and 120),  -- 🔒 PII
  add column if not exists occupation text
    check (occupation is null or length(occupation) <= 120),
  add column if not exists region text
    check (region is null or length(region) <= 80),
  add column if not exists subcity text
    check (subcity is null or length(subcity) <= 80),
  add column if not exists woreda text
    check (woreda is null or length(woreda) <= 80),
  add column if not exists kebele text
    check (kebele is null or length(kebele) <= 80),
  add column if not exists house_number text
    check (house_number is null or length(house_number) <= 40);
