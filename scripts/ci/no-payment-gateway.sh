#!/usr/bin/env bash
# R6 WP-00 / fix plan WP-03.1 step 5: this version takes manual bank-transfer
# payments only. Fails if any online-gateway code path reappears in the app,
# the Edge Functions or their config.
#
# Scope: gateway identifiers only. 'telebirr' as a *manual* payment method
# (a wallet transfer proven by a receipt URL) is still legitimate until WP-03's
# bank catalogue replaces registration_payment_method, so a bare "telebirr"
# match is deliberately NOT banned yet. WP-03 tightens this to every
# "telebirr" identifier. Re-grants of the settlement RPC in migrations are
# caught by pgTAP (supabase/tests/rls/r6_hotfix.sql), not here.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

fail=0
for dir in src supabase/functions; do
  if [ ! -d "$dir" ]; then
    echo "no-payment-gateway: expected directory missing: $dir"   # never pass by scanning nothing
    exit 2
  fi
done

# Case-insensitive, with optional separators, so kebab, snake and camelCase all match
# (process-fee-payment / processFeePayment, merch_order_id / merchOrderId, ...).
PATTERN='telebirr[-_]?(notify|query[-_]?order|generate[-_]?keypair)|process[-_]?fee[-_]?payment|_shared/telebirr|merch[-_]?order[-_]?id|settle[-_]?gateway[-_]?payment|checkout[-_]?url|fabric[-_]?app'

hits=$(grep -rniE "$PATTERN" src supabase/functions supabase/config.toml)
rc=$?
if [ $rc -gt 1 ]; then
  echo "no-payment-gateway: grep failed (exit $rc) — refusing to report ok"
  exit 2
fi
if [ $rc -eq 0 ]; then
  echo "Online payment-gateway code found (removed in R6 WP-00, C-01):"
  echo "$hits"
  fail=1
fi

# Any Edge Function directory that looks like a payment gateway.
while IFS= read -r d; do
  [ -z "$d" ] && continue
  echo "Gateway-like Edge Function directory: $d"
  fail=1
done < <(find supabase/functions -mindepth 1 -maxdepth 1 -type d \
           \( -iname '*telebirr*' -o -iname '*chapa*' -o -iname '*stripe*' -o -iname '*gateway*' -o -iname 'process-fee-payment' \))

[ $fail -eq 0 ] && echo "no-payment-gateway: ok"
exit $fail
