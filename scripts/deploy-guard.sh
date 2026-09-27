#!/usr/bin/env bash
# Refuse a production deploy from a working tree that is not exactly a commit
# (R6 WP-01 review infra F2). `vercel deploy` uploads the working tree, but the
# bundle is stamped with `git rev-parse HEAD` (<meta name="app-commit">), so a
# dirty tree would ship code the stamp does not describe and the post-deploy
# "served commit == HEAD" check would give false assurance.
set -euo pipefail
dirty=$(git status --porcelain --untracked-files=normal)
if [ -n "$dirty" ]; then
  echo "deploy-guard: refusing to deploy, the working tree has uncommitted changes:" >&2
  echo "$dirty" | head -20 >&2
  echo "Commit or stash them first; the deployed bundle is stamped with HEAD." >&2
  exit 1
fi
echo "deploy-guard: clean tree at $(git rev-parse --short HEAD)"
