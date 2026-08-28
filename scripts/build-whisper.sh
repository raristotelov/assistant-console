#!/usr/bin/env bash
set -euo pipefail

WHISPER_TAG="b4938"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/tools/whisper"
WORK="$ROOT/tools/.whisper-build"

if [ -x "$OUT/whisper-cli" ]; then
  echo "whisper-cli already present: $OUT/whisper-cli"
  exit 0
fi

rm -rf "$WORK"
mkdir -p "$WORK" "$OUT"

git clone --depth 1 --branch "$WHISPER_TAG" \
  https://github.com/ggml-org/whisper.cpp "$WORK/src"

cmake -S "$WORK/src" -B "$WORK/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=OFF

cmake --build "$WORK/build" --config Release -j"$(sysctl -n hw.ncpu)"

cp "$WORK/build/bin/whisper-cli" "$OUT/whisper-cli"
rm -rf "$WORK"

echo "built $OUT/whisper-cli"
