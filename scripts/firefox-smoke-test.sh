#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Vinland Firefox runtime smoke test
# ─────────────────────────────────────────────────────────────
# Loads the *packaged* Firefox zip (dist-firefox/*.zip) into a
# headless real Firefox via Mozilla's web-ext, then asserts:
#   1. the add-on actually installs ("Installed ... as a temporary add-on")
#   2. the background script boots with ZERO JavaScript errors
#      (the SW's own console output + any moz-extension page errors
#       surface on Firefox's stderr, which web-ext pipes through)
#
# This is the runtime half of the Firefox/Zen gate — the static half
# (manifest merge + shape assertions) runs inside package-firefox.sh.
# It caught a real cross-browser bug on day one: `chrome.alarms` is
# undefined in Firefox (only promise-based browser.alarms exists) and
# the manifest was missing the "alarms" permission entirely.
#
# Usage:
#   FIREFOX_BINARY=/path/to/firefox bash scripts/firefox-smoke-test.sh
#   (FIREFOX_BINARY defaults to `firefox` on PATH / OS defaults)
#
# Exit codes: 0 = pass, 1 = install/load failure, 2 = usage error.
# ─────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")/.."

FIREFOX_BINARY="${FIREFOX_BINARY:-}"

# Resolve a Firefox binary if not provided.
if [ -z "$FIREFOX_BINARY" ]; then
  if command -v firefox >/dev/null 2>&1; then
    FIREFOX_BINARY=$(command -v firefox)
  elif [ -x "/Applications/Firefox.app/Contents/MacOS/firefox" ]; then
    FIREFOX_BINARY="/Applications/Firefox.app/Contents/MacOS/firefox"
  elif [ -x "/usr/bin/firefox" ]; then
    FIREFOX_BINARY="/usr/bin/firefox"
  else
    echo "ERROR: no Firefox binary found — set FIREFOX_BINARY (e.g. from mozilla-actions/setup-firefox)." >&2
    exit 2
  fi
fi
if [ ! -x "$FIREFOX_BINARY" ]; then
  echo "ERROR: FIREFOX_BINARY is not executable: $FIREFOX_BINARY" >&2
  exit 2
fi

ZIP=$(ls dist-firefox/*.zip 2>/dev/null | head -1 || true)
if [ -z "$ZIP" ]; then
  echo "ERROR: no dist-firefox/*.zip found — run scripts/package-firefox.sh first." >&2
  exit 2
fi
echo "SMOKE: testing packaged artifact: $ZIP"
echo "SMOKE: firefox binary: $FIREFOX_BINARY"

# Unpack the zip to a temp dir so we load the ACTUAL artifact (not the stage).
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/ext"
unzip -q "$ZIP" -d "$WORK/ext"
if [ ! -f "$WORK/ext/manifest.json" ]; then
  echo "ERROR: zip did not unpack a manifest.json" >&2
  exit 1
fi

# Launch web-ext in headless Firefox; web-ext pipes Firefox stderr
# (JavaScript errors) into the log. Backgrounded + polled so it works on
# both macOS (no `timeout`) and CI Linux.
LOG="$WORK/web-ext.log"
MOZ_HEADLESS=1 npx -y web-ext run \
  --source-dir="$WORK/ext" \
  --firefox="$FIREFOX_BINARY" \
  --no-reload \
  --start-url=about:newtab \
  --verbose >"$LOG" 2>&1 &
WEBEXT_PID=$!

# Error patterns surfaced on Firefox stderr (which web-ext pipes through):
#   JavaScript error: <url>, line N: <ErrorType>: <msg>   — thrown exceptions
#   console.error: <extension-id>: <msg>                  — explicit console.error
# Only EXTENSION-context errors are release blockers. Headless Firefox emits
# its own benign internal errors (e.g. BackupService.sys.mjs under
# resource:// — a known headless-only quirk with no connection to the add-on),
# so errors in resource:// / chrome:// files are filtered out. The extension's
# files live under moz-extension://, so that prefix is the gate.
ERROR_RE='JavaScript error: moz-extension:|console.error: [0-9a-f-]+@temporary-addon|console.error: vinland@rhyon.dev'

INSTALLED=0
ERRORS=0
DEADLINE=$((SECONDS + 60))
OBSERVE=20   # fixed post-install observation window (seconds)
INSTALL_TIME=0
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  # Extension installed?
  if [ "$INSTALLED" = "0" ] && grep -q "as a temporary add-on" "$LOG" 2>/dev/null; then
    INSTALLED=1
    INSTALL_TIME=$SECONDS
    echo "SMOKE: add-on installed OK (web-ext confirmed temporary install)"
  fi

  # Any error from the extension (SW or newtab page)?
  if grep -Eq "$ERROR_RE" "$LOG" 2>/dev/null; then
    ERRORS=1
    echo "SMOKE: FAIL — error detected in extension runtime:" >&2
    grep -E "$ERROR_RE" "$LOG" | head -10 >&2
    break
  fi

  # Give the SW a fixed post-install window to finish booting (not tied to
  # the deadline, so a slow cold start still gets a full observation window).
  if [ "$INSTALLED" = "1" ] && [ $((SECONDS - INSTALL_TIME)) -ge "$OBSERVE" ]; then
    echo "SMOKE: observation window elapsed, no extension errors"
    break
  fi

  sleep 2
done

# Clean up: kill web-ext, then any firefox it spawned.
kill "$WEBEXT_PID" 2>/dev/null
sleep 1
pkill -f "web-ext run" 2>/dev/null || true
pkill -f "firefox.*$WORK" 2>/dev/null || true
sleep 1

if [ "$INSTALLED" = "0" ]; then
  echo "SMOKE: FAIL — extension never installed within 60s. Last log lines:" >&2
  tail -20 "$LOG" >&2
  exit 1
fi
if [ "$ERRORS" = "1" ]; then
  echo "SMOKE: FAIL — runtime JavaScript errors (see above)." >&2
  exit 1
fi

echo "SMOKE: PASS — packaged Firefox zip installed and booted with zero JS errors"
exit 0
