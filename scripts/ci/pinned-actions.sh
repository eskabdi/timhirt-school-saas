#!/usr/bin/env bash
# Every `uses:` in .github/workflows must reference a full 40-hex commit SHA
# (R6 WP-01). A tag or branch can be moved to different code after review;
# a SHA cannot. Local actions (`./...`) and docker:// references are exempt.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bad=$(grep -rnE '^\s*-?\s*uses:\s*' "$ROOT/.github/workflows" \
  | grep -vE 'uses:\s*\./|uses:\s*docker://' \
  | grep -vE 'uses:\s*[^@[:space:]]+@[0-9a-f]{40}(\s|$)' || true)
if [ -n "$bad" ]; then
  echo "Actions not pinned to a full commit SHA:"; echo "$bad"; exit 1
fi
echo "pinned-actions: ok ($(grep -rcE '^\s*-?\s*uses:' "$ROOT/.github/workflows" | awk -F: '{s+=$2} END{print s}') uses, all SHA-pinned)"
