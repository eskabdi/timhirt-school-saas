#!/usr/bin/env bash
# Every `uses:` in .github/workflows must reference a full 40-hex commit SHA
# (R6 WP-01). A tag or branch can be moved to different code after review;
# a SHA cannot. Local actions (`./...`) are exempt; a docker:// image must be
# pinned by @sha256 digest. Matches `uses:` anywhere on a line, so flow-style
# YAML (`- {uses: x@v4}`) is caught too (review SC-1).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
refs=$(grep -rnoE "uses:[[:space:]]*[\"']?[^\"'[:space:],}]+" "$ROOT/.github/workflows" || true)
bad=$(printf '%s\n' "$refs" | grep -v '^$' \
  | grep -vE "uses:[[:space:]]*[\"']?\./" \
  | grep -vE "uses:[[:space:]]*[\"']?docker://[^@]+@sha256:[0-9a-f]{64}$" \
  | grep -vE "uses:[[:space:]]*[\"']?[^@\"'[:space:]]+@[0-9a-f]{40}$" || true)
if [ -n "$bad" ]; then
  echo "Actions not pinned to a full commit SHA (or docker image digest):"; echo "$bad"; exit 1
fi
echo "pinned-actions: ok ($(printf '%s\n' "$refs" | grep -c .) uses, all SHA-pinned)"
