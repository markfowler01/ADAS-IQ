#!/bin/bash
# Keep the last 14 days of built asset files alongside every client deploy.
# Catalyst wipes the previous build on deploy; an open tab (cached
# index.html) still asks for the OLD chunk names and goes blank when its
# next lazy screen 404s (Mark 2026-09-11). Shipping old chunks too keeps
# every open session alive until it reloads on its own.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="$ROOT/client/.asset-archive"
DIST="$ROOT/client/dist/assets"
mkdir -p "$ARCH"
[ -d "$DIST" ] || { echo "no dist/assets — build first"; exit 1; }
# 1. archive this build's files (hashed names never collide)
cp -n "$DIST"/* "$ARCH"/ 2>/dev/null || true
# 2. prune archive entries older than 14 days
find "$ARCH" -type f -mtime +14 -delete
# 3. ship the archive with the build
cp -n "$ARCH"/* "$DIST"/ 2>/dev/null || true
echo "asset archive: $(ls "$ARCH" | wc -l | tr -d ' ') files kept, dist/assets now $(ls "$DIST" | wc -l | tr -d ' ') files"
