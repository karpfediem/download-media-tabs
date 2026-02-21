#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR"
NAME="download-media-tabs"

cd "$ROOT_DIR"

OUT_FILE="$OUT_DIR/${NAME}.zip"

# Remove existing output to avoid stale contents
rm -f "$OUT_FILE"

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is required to build the zip." >&2
  exit 1
fi

# Archive tracked files only (respects .gitignore by default)
git archive --format=zip --output="$OUT_FILE" HEAD

echo "Created: $OUT_FILE"
