#!/bin/bash
# Deploy gate — refuses to ship a function tree that can't parse.
# Born from the 2026-08-05 outage: a mid-edit file with a syntax error
# (vanWeekly.js) was deployed from the shared working tree and took the
# whole backend down for 7+ hours. Run before EVERY catalyst deploy:
#   ./scripts/deploy-gate.sh && catalyst deploy --only functions:adasiq-api
set -e
cd "$(dirname "$0")/.."

FAIL=0
for f in functions/adasiq-api/*.js functions/adasiq-api/routes/*.js functions/adasiq-api/services/*.js; do
  if ! node --check "$f" 2>/dev/null; then
    echo "❌ SYNTAX ERROR: $f"
    node --check "$f" 2>&1 | head -5
    FAIL=1
  fi
done

# Native-binary check — sharp must be the linux-x64 build for Catalyst.
if [ ! -d functions/adasiq-api/node_modules/@img/sharp-linux-x64 ]; then
  echo "❌ sharp is NOT linux-x64 — run: npm ci --omit=dev --os=linux --cpu=x64 --libc=glibc --force (in functions/adasiq-api)"
  FAIL=1
fi

if [ "$FAIL" -eq 1 ]; then
  echo ""
  echo "🚫 DEPLOY BLOCKED — fix (or git stash) the files above first."
  exit 1
fi
echo "✅ Deploy gate passed — tree is shippable."
