-- ============================================================================
-- R6 / WP-00 — Containment hotfix (G-09, RV-05, C-01, L-06)
--
-- Two live risks are contained here, before any other R6 change:
--
-- 1. cleanup_old_audit_logs() was executable by anon/authenticated (H-01).
--    It deletes audit_logs rows older than a year, and audit_logs is the only
--    source get_student_grade_history() uses for grade history (H-03). Any
--    call before the WP-08 ledger backfill would destroy that history for good.
--    EXECUTE is revoked from every API role, including service_role. Only the
--    function owner can still run it, and nobody should until WP-08 and WP-10
--    have landed. Any pg_cron job that calls it is unscheduled.
--
-- 2. Telebirr online-gateway decommission (fix plan WP-03.1). This version
--    takes manual bank-transfer payments only. The unsigned telebirr-notify
--    webhook (C-01) is removed rather than fixed, together with
--    telebirr-query-order, telebirr-generate-keypair and process-fee-payment
--    (whose Origin-derived redirect URL was L-06). The database side:
--      - pending gateway orders (any provider other than the manual
--        'cash'/'bank') are voided, so nothing can settle them later;
--      - the Telebirr platform_integrations row and its Vault secrets are
--        deleted, and the provider check no longer allows 'telebirr';
--      - telebirr_token_cache (cached fabric tokens) is dropped;
--      - settle_gateway_payment() is revoked from every API role, including
--        service_role. It is kept, not dropped: its allocation logic is still
--        exercised by pgTAP, and the fix plan's Appendix C redesign starts
--        from it.
--    NOT removed: 'telebirr' as a *manual* payment method
--    (registration_payment_method: a wallet transfer proven by a receipt URL,
--    alongside CBE / Awash). That path never settles anything by itself, and
--    WP-03's bank catalogue replaces it.
--
-- Re-runnable: every statement is guarded or naturally idempotent.
-- ============================================================================

-- ---------- 1. Contain the audit-log purge ---------------------------------
revoke execute on function public.cleanup_old_audit_logs() from public, anon, authenticated, service_role;

comment on function public.cleanup_old_audit_logs() is
  'DISABLED (R6 WP-00): EXECUTE revoked from every API role. Do not run or schedule until the WP-08 grade-history ledger backfill and the WP-10 append-only/archive retention are in place — audit_logs is currently the only source of student grade history.';

do $$
begin
  perform cron.unschedule(jobid) from cron.job where command ilike '%cleanup_old_audit_logs%';
exception
  when undefined_table or invalid_schema_name or undefined_function then
    null;  -- pg_cron not installed: nothing is scheduled
end $$;

-- ---------- 2. Telebirr gateway decommission -------------------------------
-- 2a + 2b. Void in-flight gateway orders (every non-manual provider, since
-- settle_gateway_payment() is provider-agnostic) and delete the Telebirr
-- integration row. Row counts are reported so the deploy log records exactly
-- what changed. Both changes are captured by audit_trigger (old_data), which
-- is the recovery source. The forward-fix plan is in audit/FIXES_VERIFIED_R6.md.
do $$
declare n integer;
begin
  update public.payments
     set status = 'failed'
   where provider not in ('cash', 'bank') and status = 'pending';
  get diagnostics n = row_count;
  raise notice 'R6 WP-00: voided % pending gateway payment(s)', n;

  delete from public.platform_integrations where provider = 'telebirr';
  get diagnostics n = row_count;
  raise notice 'R6 WP-00: deleted % Telebirr platform_integrations row(s)', n;
end $$;

alter table public.platform_integrations
  drop constraint if exists platform_integrations_provider_check;
alter table public.platform_integrations
  add constraint platform_integrations_provider_check
  check (provider in ('sms_smsala', 'sms_afromessage', 'sms_geezsms'));

do $$
begin
  delete from vault.secrets
   where name in ('telebirr_fabric_app_secret', 'telebirr_private_key_pem');
  raise notice 'R6 WP-00: Telebirr Vault secret deletion attempted; verify 0 remain';
exception
  when insufficient_privilege or undefined_table or invalid_schema_name then
    raise notice 'R6 WP-00: could not delete Telebirr Vault secrets automatically (%). Delete them by hand: telebirr_fabric_app_secret, telebirr_private_key_pem.', sqlerrm;
end $$;

-- 2c. Cached fabric tokens.
drop table if exists public.telebirr_token_cache;

-- 2d. Settlement RPC: no API role may reach it.
revoke all on function public.settle_gateway_payment(text, public.payment_provider, numeric)
  from public, anon, authenticated, service_role;

comment on function public.settle_gateway_payment(text, public.payment_provider, numeric) is
  'DECOMMISSIONED (R6 WP-00, closes C-01): the online gateway was removed; EXECUTE is revoked from every API role. Kept only as the starting point of the fix plan''s Appendix C redesign (signed notify + server-side queryOrder confirmation + dedupe). Manual bank-transfer payments (WP-03) never call it.';
