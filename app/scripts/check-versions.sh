#!/bin/bash
# package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml の
# バージョン文字列が一致していることを確認する。
#
# 3ファイルにバージョンが分散しているため、どれか1つだけ更新し忘れると
# リリース物とpackage.jsonの表示バージョンがずれる。CIで毎回検知する。
#
# Usage: bash scripts/check-versions.sh
# Exit 0 if aligned, 1 otherwise.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PKG=$(node -p "require(process.argv[1]).version" "$APP_ROOT/package.json")
CONF=$(node -p "require(process.argv[1]).version" "$APP_ROOT/src-tauri/tauri.conf.json")
CARGO=$(awk -F'"' '/^version = /{print $2; exit}' "$APP_ROOT/src-tauri/Cargo.toml")

if [ "$PKG" = "$CONF" ] && [ "$CONF" = "$CARGO" ]; then
  echo "✓ version aligned: $PKG"
  exit 0
fi

echo "✗ version mismatch:" >&2
echo "    package.json:               $PKG" >&2
echo "    src-tauri/tauri.conf.json:  $CONF" >&2
echo "    src-tauri/Cargo.toml:       $CARGO" >&2
exit 1
