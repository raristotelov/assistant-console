#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Documents/Applications/Assistant Console"

APP="$(find "$ROOT/dist" -maxdepth 2 -type d -name "Assistant Console.app" | head -1)"
if [ -z "$APP" ]; then
  echo "no built app found under $ROOT/dist" >&2
  exit 1
fi

mkdir -p "$DEST"
rm -rf "$DEST/Assistant Console.app"
cp -R "$APP" "$DEST/Assistant Console.app"

echo "installed $DEST/Assistant Console.app"
