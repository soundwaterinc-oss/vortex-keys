#!/usr/bin/env bash
# Copy the EL-SYSTEMA Live leaf wrapper scripts (canonical: ~/el-systema-live/shared) into every app's public/shared.
set -eu
cd "$(dirname "$0")/.."
SRC="${1:-$HOME/el-systema-live/shared}"
for app in vortex-keys orbit ensemble; do
  mkdir -p "apps/$app/public/shared"
  for f in el-systema-shapes.js el-systema-transport.js el-systema-control.js el-systema-assr.js; do
    [ -f "$SRC/$f" ] && cp "$SRC/$f" "apps/$app/public/shared/$f"
  done
done
echo "synced leaf scripts from $SRC"
