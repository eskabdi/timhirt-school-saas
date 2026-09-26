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
# Python tooling in CI installs only from hash-locked requirement files: every
# `pip install` must carry --require-hashes and -r <file>, and every pin in
# that file must carry a --hash (review TV-3, R6 WP-01 semgrep lock).
pip_lines=$(grep -rnE "pip3? install" "$ROOT/.github/workflows" || true)
unlocked=$(printf '%s\n' "$pip_lines" | grep -v '^$' | grep -vE -- "--require-hashes.*-r [^ \"]+|-r [^ \"]+.*--require-hashes" || true)
if [ -n "$unlocked" ]; then
  echo "pip install without --require-hashes -r <locked file>:"; echo "$unlocked"; exit 1
fi
for req in $(printf '%s\n' "$pip_lines" | grep -oE -- "-r [^ \"]+" | awk '{print $2}' | sort -u); do
  f="$ROOT/$req"
  [ -f "$f" ] || { echo "missing requirements file: $req"; exit 1; }
  unhashed=$(python3 - "$f" <<'PY'
import re, sys
text = open(sys.argv[1]).read().replace("\\\n", " ")
for line in text.splitlines():
    line = line.split("#", 1)[0].strip()
    if re.match(r"^[A-Za-z0-9_.\-\[\]]+==", line) and "--hash=sha256:" not in line:
        print(line.split()[0])
PY
)
  if [ -n "$unhashed" ]; then echo "$req: pins without --hash: $unhashed"; exit 1; fi
done
echo "pinned-actions: ok ($(printf '%s\n' "$refs" | grep -c .) uses, all SHA-pinned; $(printf '%s\n' "$pip_lines" | grep -c .) pip install(s), hash-locked)"
