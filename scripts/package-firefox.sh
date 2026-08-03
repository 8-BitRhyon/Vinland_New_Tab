#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Vinland Firefox / Zen Packaging
# ─────────────────────────────────────────────────────────────
# Builds a WebExtensions zip (Firefox, Zen, Waterfox, LibreWolf…)
# into dist-firefox/.
#
#   ./scripts/package-firefox.sh
#
# Output: dist-firefox/vinland-firefox-v<version>.zip
#
# The Chrome manifest (manifest.json) is the single source of truth.
# manifest.firefox.json holds ONLY the Firefox delta, which is merged over
# it at package time:
#   - browser_specific_settings.gecko  (stable extension id + min version)
#   - background.scripts               (Firefox event page; no service_worker)
#   - drive_oauth                      (Firefox OAuth client id for Drive sync)
# Chrome-only keys are stripped: oauth2 (Chrome identity) and
# background.type (module service workers are Chrome-only).
#
# Load in Zen / Firefox:
#   about:debugging#/runtime/this-firefox → "Load Temporary Add-on" →
#   select dist-firefox/vinland-firefox-v<version>.zip (or the unzipped
#   dist-firefox/stage folder's manifest.json).
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
STAGE="dist-firefox/stage"
OUT_DIR="dist-firefox"
OUT_ZIP="$OUT_DIR/vinland-firefox-v$VERSION.zip"

rm -rf "$STAGE"
rm -f "$OUT_ZIP"
mkdir -p "$STAGE" "$OUT_DIR"

# 1. Stage the extension root with the same exclusions as the Chrome package
#    (dev/test tooling never ships). tar is used so CI (ubuntu) works too.
tar \
  --exclude='*.git*' \
  --exclude='.Git/*' \
  --exclude='node_modules/*' \
  --exclude='tests/*' \
  --exclude='docs/*' \
  --exclude='scripts/*' \
  --exclude='playwright-report/*' \
  --exclude='test-results/*' \
  --exclude='dist/*' \
  --exclude='dist-firefox/*' \
  --exclude='*.DS_Store' \
  --exclude='.github/*' \
  --exclude='.vscode/*' \
  --exclude='.crush/*' \
  --exclude='_metadata/*' \
  --exclude='.agents/*' \
  --exclude='.codelens/*' \
  --exclude='.venv-brand/*' \
  --exclude='.venv/*' \
  --exclude='skills-lock.json' \
  --exclude='__pycache__/*' \
  --exclude='playwright.config.mjs' \
  --exclude='package.json' \
  --exclude='package-lock.json' \
  --exclude='manifest.firefox.json' \
  -cf - . | (cd "$STAGE" && tar -xf -)

# 2. Merge the Firefox delta over the Chrome manifest and drop Chrome-only keys.
python3 - "$STAGE" <<'PY'
import json, sys
stage = sys.argv[1]
base = json.load(open('manifest.json'))
delta = json.load(open('manifest.firefox.json'))
merged = {**base, **delta}
merged.pop('oauth2', None)              # Chrome-only identity key
bg = dict(merged.get('background', {}))
bg.pop('type', None)                    # Chrome-only module SW flag
merged['background'] = bg
json.dump(merged, open(f'{stage}/manifest.json', 'w'), indent=2)
PY

# 3. Validate the merged manifest shape before zipping.
python3 - "$STAGE/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
assert m['manifest_version'] == 3, 'manifest_version must be 3'
gecko = m.get('browser_specific_settings', {}).get('gecko', {})
assert gecko.get('id') == 'vinland@rhyon.dev', 'gecko id must be vinland@rhyon.dev'
assert gecko.get('strict_min_version'), 'browser_specific_settings.gecko.strict_min_version required'
assert 'scripts' in m['background'], 'background.scripts required for Firefox'
assert 'service_worker' not in m['background'], 'service_worker is Chrome-only'
assert 'type' not in m['background'], 'background.type is Chrome-only'
assert 'oauth2' not in m, 'oauth2 is Chrome-only'
assert m['chrome_url_overrides']['newtab'] == 'index.html'
assert m.get('drive_oauth', {}).get('client_id'), 'drive_oauth.client_id required for Firefox Drive sync'
print(f"✓ Firefox manifest OK: {m['name']} v{m['version']} (gecko id: {gecko['id']})")
PY

# 4. Zip the stage.
( cd "$STAGE" && zip -rq "../$(basename "$OUT_ZIP")" . )

# 5. Size guard + composition report (mirrors the Chrome package).
SIZE=$(du -h "$OUT_ZIP" | cut -f1)
SIZE_KB=$(du -k "$OUT_ZIP" | cut -f1)
if [ "$SIZE_KB" -gt 81920 ]; then
  echo "ERROR: $OUT_ZIP is ${SIZE} (>80MB) — the Chrome Web Store cap also applies to AMO; prune assets." >&2
  exit 1
fi

echo "  Largest included paths:"
unzip -l "$OUT_ZIP" | awk 'NF >= 4 && $1 ~ /^[0-9]+$/ {printf "%d %s\n", $1, substr($0, index($0, $4))}' | sort -rn | head -10 | awk '{
    n = $1;
    if (n >= 1048576)      h = sprintf("%.1f MB", n / 1048576);
    else if (n >= 1024)    h = sprintf("%.1f KB", n / 1024);
    else                   h = n " B";
    name = substr($0, index($0, $2));
    printf "    %8s  %s\n", h, name;
}'

echo "✔ Packaged $OUT_ZIP ($SIZE)"
echo "  → Zen:  about:debugging#/runtime/this-firefox → Load Temporary Add-on → select the zip"
echo "  → Firefox: same page. For a permanent (signed) install, upload the zip to addons.mozilla.org."
echo "  → See docs/browser-support.md for Drive OAuth and per-browser setup."
