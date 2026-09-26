#!/usr/bin/env bash
# Type-check every Edge Function entrypoint with Deno (R6 WP-01).
# Ratchet against supabase/security/deno_check_known.txt: a function not on the
# list must pass; a listed function that now passes must be removed from the
# list (so the baseline only shrinks). DENO_NO_PACKAGE_JSON and
# --node-modules-dir=none stop Deno from resolving npm: imports out of the
# root node_modules. Exit 0 = clean, 1 = regression or stale baseline.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KNOWN="$ROOT/supabase/security/deno_check_known.txt"
DENO="${DENO:-deno}"
export DENO_NO_PACKAGE_JSON=1

known=$(grep -vE '^\s*(#|$)' "$KNOWN" | sort -u)
fail=0 checked=0
for dir in "$ROOT"/supabase/functions/*/; do
  name=$(basename "$dir")
  [[ "$name" == _* ]] && continue
  [ -f "$dir/index.ts" ] || continue
  checked=$((checked + 1))
  if out=$($DENO check --node-modules-dir=none -q "$dir/index.ts" 2>&1); then
    if grep -qx "$name" <<<"$known"; then
      echo "STALE     $name now type-checks: delete it from supabase/security/deno_check_known.txt"
      fail=1
    fi
  else
    if grep -qx "$name" <<<"$known"; then
      echo "known     $name (baseline)"
    else
      echo "FAIL      $name"
      echo "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -E "TS[0-9]+|at file" | head -10 | sed 's/^/          /'
      fail=1
    fi
  fi
done
[ "$checked" -gt 0 ] || { echo "deno-check: no functions found"; exit 2; }
echo "deno-check: $checked functions, $(grep -c . <<<"$known") baselined, $([ $fail -eq 0 ] && echo ok || echo FAILED)"
exit $fail
