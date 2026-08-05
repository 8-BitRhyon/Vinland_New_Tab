#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Vinland release-notes generator
# ─────────────────────────────────────────────────────────────
# Composes the GitHub release body from the RELEASING.md template:
# header, auto commit list (since the previous v* tag), install
# instructions, and honest caveats.
#
#   bash scripts/make-release-notes.sh <old_version> <new_version>
#
# <old_version> may be empty for the first release. Prints to stdout.
# Used by the release workflow (.github/workflows/release.yml) and
# available manually — `bash scripts/make-release-notes.sh 19.57 19.58
# > /tmp/notes.md && gh release create v19.58 --notes-file /tmp/notes.md`.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

OLD="${1:-}"
NEW="${2:?usage: make-release-notes.sh <old_version> <new_version>}"

REPO=$(git remote get-url origin | sed -E 's#.*github.com[:/]##; s#\.git$##' || true)
# Guard: only trust the derived value if it looks like owner/repo (a non-
# github.com remote, or an empty one, falls back to the canonical repo).
if [[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  REPO="8-BitRhyon/Vinland_New_Tab"
fi

if [ -n "$OLD" ]; then
  RANGE="v$OLD..HEAD"
else
  RANGE="HEAD"
fi

# Commit list since the previous release (capped at 50 lines so the body
# stays scannable; older work belongs in CHANGELOG.md anyway).
COUNT=$(git rev-list --count "$RANGE" 2>/dev/null || true)
COMMITS=$(git log --oneline "$RANGE" 2>/dev/null | head -50) || true
if [ -z "$COMMITS" ]; then
  COMMITS="(no commits listed — fill in what changed manually)"
elif [ -n "$COUNT" ] && [ "$COUNT" -gt 50 ]; then
  COMMITS=$(printf '%s
…and %d more commits (%s)' "$COMMITS" $((COUNT - 50)) "$RANGE")
fi

cat <<NOTES
# Vinland v$NEW

**Terminal-style new-tab command center by Rhyon** — notes, canvas boards, tasks, search, templates, Google Drive sync, and 34 CLI commands in your new tab.

> Auto-drafted by the release workflow. Replace this line with a "What's new" section before publishing (see docs/RELEASING.md).

## Commits in this release

\`\`\`
$COMMITS
\`\`\`

## Install (easy)

1. Download \`vinland-v$NEW.zip\` below.
2. Unzip it anywhere (e.g. \`~/Downloads/vinland-v$NEW/\`).
3. Open **chrome://extensions**, toggle **Developer mode** (top-right).
4. Click **Load unpacked** and select the unzipped folder.
5. Open a new tab — Vinland boots.

**Firefox / Zen:** unzip, open \`about:debugging#/runtime/this-firefox\`, click **Load Temporary Add-on**, and select \`manifest.json\` from the unzipped folder.

## Notes & honest caveats

- **Google Drive sync** requires you to bring your own OAuth Client ID (see \`docs/google-drive-sync.md\`) — the store build ships without embedded credentials. Firefox/Zen use the \`launchWebAuthFlow\` path.
- Encryption is optional and opt-in; without a passphrase backups are plaintext JSON.
- Full history: [CHANGELOG.md](https://github.com/$REPO/blob/main/CHANGELOG.md)
NOTES
