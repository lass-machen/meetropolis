#!/bin/sh
# Usage: ./scripts/makeIconset.sh <source_png> <dest_icns>
# Requires: macOS with `sips` and `iconutil`

set -e

SRC=${1:-"../../apps/web/public/brand/logo.png"}
DST=${2:-"assets/icon.icns"}
ICONSET_DIR="assets/appicon.iconset"

if [ ! -f "$SRC" ]; then
  echo "Source PNG not found: $SRC" >&2
  exit 1
fi

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

resize(){ sips -z "$1" "$2" "$SRC" --out "$3" >/dev/null; }

# Apple-standard names
resize 16 16 "$ICONSET_DIR/icon_16x16.png"
resize 32 32 "$ICONSET_DIR/icon_16x16@2x.png"
resize 32 32 "$ICONSET_DIR/icon_32x32.png"
resize 64 64 "$ICONSET_DIR/icon_32x32@2x.png"
resize 128 128 "$ICONSET_DIR/icon_128x128.png"
resize 256 256 "$ICONSET_DIR/icon_128x128@2x.png"
resize 256 256 "$ICONSET_DIR/icon_256x256.png"
resize 512 512 "$ICONSET_DIR/icon_256x256@2x.png"
resize 512 512 "$ICONSET_DIR/icon_512x512.png"
resize 1024 1024 "$ICONSET_DIR/icon_512x512@2x.png"

iconutil -c icns "$ICONSET_DIR" -o "$DST"
echo "Created $DST"


