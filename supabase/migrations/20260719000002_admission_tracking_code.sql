-- ============================================================================
-- Public application status tracking. An applicant gets a short tracking
-- code when they submit (Step 2 of the /apply stepper) and can come back
-- later, enter just that code, and see their application's current stage —
-- without an account and without exposing the rest of the record.
--
-- 10 chars from a 32-symbol unambiguous alphabet (no 0/O/1/I/L) generated in
-- submit-admission — ~50 bits of entropy, the same "constrain minimum
-- entropy in the DB, not just at generation time" pattern id_cards.verify_code
-- uses (20260713000010_security_hardening.sql), sized for something a parent
-- types on a phone rather than a QR-scanned code. Unique per tenant, not
-- globally: the status-check page is reached via /apply/:tenantSlug, so the
-- tenant is already known and doesn't need to be guessed alongside the code.
-- ============================================================================

alter table public.admission_applications
  add column tracking_code text check (tracking_code is null or length(tracking_code) = 10);

create unique index admission_applications_tracking_code_idx
  on public.admission_applications (tenant_id, tracking_code) where tracking_code is not null;
