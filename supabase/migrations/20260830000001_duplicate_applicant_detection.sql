-- ============================================================================
-- R4-C2: duplicate-applicant detection. submit-admission had zero defense
-- against the same family submitting the same applicant twice (rate
-- limiting is per-IP, not per-identity) -- nothing surfaced it to staff
-- reviewing the queue, and nothing prevented two separate enrollments for
-- what's really one child.
--
-- Detection, not blocking: possible_duplicate_of is advisory. Matching on
-- (tenant, first name, last name, date of birth) case-insensitively can
-- still have false positives (siblings sharing a birthday is rare but not
-- impossible) and false negatives (a name typo), so this flags for a human
-- reviewer rather than silently rejecting a resubmission -- a genuine
-- family correcting a mistake, or reapplying after an earlier rejection,
-- must not be locked out at the public API.
-- ============================================================================
alter table public.admission_applications
  add column possible_duplicate_of uuid references public.admission_applications(id) on delete set null;
