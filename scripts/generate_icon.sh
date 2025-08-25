#!/usr/bin/env bash
set -euo pipefail

SRC="icons/icon.svg"   # path to your SVG
OUT="icons"
SIZES=(16 32 48 128)   # add 256/512 if you like

mkdir -p "$OUT"

for s in "${SIZES[@]}"; do
  magick -background none "$SRC" \
         -resize ${s}x${s} \
         -gravity center -extent ${s}x${s} \
         -strip \
         "$OUT/icon${s}.png"
  echo "wrote $OUT/icon${s}.png"
done
