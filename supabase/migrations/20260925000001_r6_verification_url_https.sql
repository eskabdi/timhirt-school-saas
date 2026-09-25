-- ============================================================================
-- R6 WP-00 closeout (review FS-1): bank_payment_verifications.verification_url
-- must be https. Both writers (record-fee-payment, verify-admission-bank-url)
-- validated only z.string().url(), which accepts `javascript:` and `data:`;
-- the value is rendered as a link to staff, parents and super_admin, so a
-- stored non-https URL is a stored XSS. The Edge Functions now refuse it and
-- the UI renders only https as a link; this CHECK is the database backstop.
-- Production had 0 rows in this table on 2026-09-25 (read-only count).
-- Re-runnable: drop-if-exists, then add.
-- ============================================================================
alter table public.bank_payment_verifications
  drop constraint if exists bank_payment_verifications_url_https;
alter table public.bank_payment_verifications
  add constraint bank_payment_verifications_url_https
  check (verification_url ~* '^https://');
