#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Vinland Release Packaging
# ─────────────────────────────────────────────────────────────
# Builds a Chrome-Web-Store-ready zip of the extension into dist/.
#
#   ./scripts/package-release.sh
#
# Output: dist/vinland-v<version>.zip
# The zip contains the extension root (index.html, manifest.json, assets/,
# js/, fonts/, sw.js, rules.json, ...) — everything a Load-unpacked install
# needs — excluding dev/test tooling.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
OUT_DIR="dist"
OUT_ZIP="$OUT_DIR/vinland-v$VERSION.zip"

mkdir -p "$OUT_DIR"
rm -f "$OUT_ZIP"

# Zip the extension root, excluding everything not shipped in the store.
zip -r "$OUT_ZIP" . \
  -x "*.git*" \
  -x "node_modules/*" \
  -x "tests/*" \
  -x "docs/*" \
  -x "scripts/*" \
  -x "playwright-report/*" \
  -x "test-results/*" \
  -x "dist/*" \
  -x "*.DS_Store" \
  -x ".github/*" \
  -x ".vscode/*" \
  -x ".crush/*" \
  -x "_metadata/*" \
  -x ".agents/*" \
  -x ".codelens/*" \
  -x "skills-lock.json" \
  -x "__pycache__/*" \
  -x "playwright.config.mjs" \
  -x "package.json" \
  -x "package-lock.json" \
  > /dev/null

SIZE=$(du -h "$OUT_ZIP" | cut -f1)
echo "✔ Packaged $OUT_ZIP ($SIZE)"
echo "  → Load unpacked: chrome://extensions → Developer mode → Load unpacked → select the unzipped folder"
