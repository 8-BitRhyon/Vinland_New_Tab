#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Vinland version bump helper
# ─────────────────────────────────────────────────────────────
# Updates the three version surfaces together so every release
# follows the same convention:
#
#   bash scripts/bump-version.sh 19.58
#
# 1. manifest.json -> "version": "19.58"           (authoritative, CWS)
# 2. package.json  -> "version": "19.58.0"         (3-part mirror)
# 3. CHANGELOG.md  -> [Unreleased] retitled to [V19.58] — <date>,
#                     fresh [Unreleased] section added on top
#
# JSON files are edited by exact string replacement (the version
# line only), so the diff stays minimal — no reformatting.
#
# Run from the repo root. Does NOT commit — review the diff and
# commit yourself; the release workflow (RELEASING.md §2.5) will
# auto-draft v<version> once CI is green.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

NEW="${1:-}"
if [ -z "$NEW" ]; then
  echo "usage: bash scripts/bump-version.sh <version>" >&2
  echo "  e.g.  bash scripts/bump-version.sh 19.58" >&2
  exit 1
fi
if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
  echo "error: version must be X.Y or X.Y.Z (got '$NEW')" >&2
  exit 1
fi

for f in manifest.json package.json CHANGELOG.md; do
  [ -f "$f" ] || { echo "error: $f not found — run from the repo root" >&2; exit 1; }
done

OLD=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
if [ "$NEW" = "$OLD" ]; then
  echo "error: version $NEW is already the current manifest version — nothing to bump" >&2
  exit 1
fi

# package.json mirrors the manifest version as 3-part semver.
if [[ "$NEW" == *.*.* ]]; then
  PKG_NEW="$NEW"
else
  PKG_NEW="$NEW.0"
fi

# 1) manifest.json — replace only the version line, byte-for-byte elsewhere.
python3 - "$OLD" "$NEW" manifest.json <<'PY'
import sys
old, new, path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    c = f.read()
needle = f'"version": "{old}"'
assert c.count(needle) == 1, f'expected exactly one "{needle}" in {path}, found {c.count(needle)}'
c = c.replace(needle, f'"version": "{new}"')
with open(path, 'w') as f:
    f.write(c)
PY

# 2) package.json — same targeted replace. The current package.json version is
#    read fresh (the manifest bump above didn't touch it), so the needle stays
#    exact regardless of how it drifted from the manifest.
python3 - "$PKG_NEW" package.json <<'PY'
import json, sys
new, path = sys.argv[1], sys.argv[2]
with open(path) as f:
    old = json.load(f)['version']
with open(path) as f:
    c = f.read()
needle = f'"version": "{old}"'
assert c.count(needle) == 1, f'expected exactly one "{needle}" in {path}, found {c.count(needle)}'
c = c.replace(needle, f'"version": "{new}"')
with open(path, 'w') as f:
    f.write(c)
PY

# 3) CHANGELOG.md — retitle [Unreleased] -> [V<new>] — <date>, add a fresh
#    [Unreleased] heading directly above it (matching the existing
#    "## [V19.57] — 2026-08-01" convention).
DATE=$(date +%Y-%m-%d)
python3 - "$NEW" "$DATE" <<'PY'
import sys
new, date = sys.argv[1], sys.argv[2]
with open('CHANGELOG.md') as f:
    lines = f.readlines()

idx = next((i for i, l in enumerate(lines) if l.strip() == '## [Unreleased]'), None)
if idx is None:
    sys.exit('error: CHANGELOG.md has no bare "## [Unreleased]" heading to release')

lines[idx] = f'## [V{new}] — {date}\n'
lines.insert(idx, '## [Unreleased]\n\n')

with open('CHANGELOG.md', 'w') as f:
    f.writelines(lines)
PY

echo "✔ bumped $OLD -> $NEW"
echo "  manifest.json : \"version\": \"$OLD\" -> \"$NEW\""
echo "  package.json  : \"version\" -> \"$PKG_NEW\""
echo "  CHANGELOG.md  : [Unreleased] -> [V$NEW] — $DATE (fresh [Unreleased] added)"
echo ""
echo "Next: fill in the new [Unreleased] section, then commit + push —"
echo "the release workflow will wait for CI, tag v$NEW, and draft the release."
