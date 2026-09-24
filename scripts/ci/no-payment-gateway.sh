#!/usr/bin/env bash
# R6 WP-00 / fix plan WP-03.1 step 5: this version takes manual bank-transfer
# payments only. Fails if any online-gateway code path reappears in the app or
# the Edge Functions.
#
# Scope: gateway identifiers only. 'telebirr' as a *manual* payment method
# (a wallet transfer proven by a receipt URL) is still legitimate until WP-03's
# bank catalogue replaces registration_payment_method, so a bare "telebirr"
# match is deliberately NOT banned yet. WP-03 tightens this to every
# "telebirr" identifier.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

PATTERN='telebirr-notify|telebirr-query-order|telebirr-generate-keypair|process-fee-payment|_shared/telebirr|merch_order_id|settle_gateway_payment|checkout_url|fabric_app'

if hits=$(grep -rnE "$PATTERN" src supabase/functions); then
  echo "Online payment-gateway code found (removed in R6 WP-00, C-01):"
  echo "$hits"
  exit 1
fi
for d in telebirr-notify telebirr-query-order telebirr-generate-keypair process-fee-payment; do
  if [ -e "supabase/functions/$d" ]; then
    echo "Gateway function directory reappeared: supabase/functions/$d"
    exit 1
  fi
done
echo "no-payment-gateway: ok"
