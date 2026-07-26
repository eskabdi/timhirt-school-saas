#!/usr/bin/env bash
# Applies every migration to a plain Postgres, then runs the pgTAP suites.
#
# Used by the rls-tests CI job and runnable locally against any Postgres:
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres \
#     ./supabase/tests/run.sh
#
# Exits non-zero if a migration fails, a suite errors, or any assertion reports
# "not ok" — pgTAP keeps going after a failed assertion, so the output has to be
# scanned rather than trusted to the exit code alone.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q --no-psqlrc"

echo "==> Resetting schema"
$PSQL -c "drop schema if exists public cascade;
          drop schema if exists auth cascade;
          drop schema if exists storage cascade;
          drop schema if exists vault cascade;
          create schema public;" >/dev/null || exit 1

echo "==> Installing Supabase shim"
$PSQL -f "$ROOT/supabase/tests/shim.sql" >/dev/null || { echo "shim failed"; exit 1; }

echo "==> Applying migrations"
count=0
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  # supabase_vault is a managed extension; the shim provides the vault schema.
  sed 's/^create extension if not exists supabase_vault;/-- shimmed/' "$f" > /tmp/_mig.sql
  if ! out=$($PSQL -f /tmp/_mig.sql 2>&1); then
    echo "MIGRATION FAILED: $(basename "$f")"
    echo "$out" | grep -E "ERROR" | head -5
    exit 1
  fi
  count=$((count + 1))
done
echo "    $count migrations applied"

echo "==> Running pgTAP suites"
fail=0
for t in $(ls "$ROOT"/supabase/tests/rls/*.sql | sort); do
  name=$(basename "$t")
  # Each suite wraps itself in begin/rollback, so suites cannot leak into
  # each other and the order they run in does not matter.
  # -t -A: tuples only, unaligned. Without it psql pads every row, the TAP
  # lines arrive as " ok 1 - ..." and an anchored ^not ok grep silently matches
  # nothing — the suite would report green no matter what it found.
  output=$(psql -qtA --no-psqlrc -f "$t" 2>&1)
  status=$?
  planned=$(echo "$output" | sed -n 's/^1\.\.\([0-9]*\)$/\1/p' | head -1)
  passed=$(echo "$output" | grep -cE "^ok [0-9]+")
  failed=$(echo "$output" | grep -cE "^not ok [0-9]+")

  if [ $status -ne 0 ] || [ "$failed" -gt 0 ] || echo "$output" | grep -qE "^(psql:)?.*ERROR:"; then
    echo "--- FAIL: $name"
    echo "$output" | grep -E "^not ok|ERROR:|^#" | head -20
    fail=1
  elif [ -z "$planned" ] || [ "$passed" -ne "$planned" ]; then
    # A suite that runs but asserts nothing is not a passing suite.
    echo "--- FAIL: $name — planned ${planned:-none}, saw $passed passing assertions"
    fail=1
  else
    echo "    ok   $name ($passed/$planned assertions)"
  fi
done

[ $fail -eq 0 ] && echo "==> All suites passed" || echo "==> FAILURES"
exit $fail
