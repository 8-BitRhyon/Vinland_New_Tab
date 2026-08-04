# Browser Support

Vinland is a Manifest V3 extension that runs on **every Chromium-based
browser and every Firefox-based (WebExtensions) browser** as a new-tab page.

| Browser | Engine | Status | Install |
|---|---|---|---|
| Chrome | Chromium | ✅ full | `chrome://extensions` → Load unpacked, or Chrome Web Store |
| Edge, Brave, Opera, Vivaldi, Arc | Chromium | ✅ full | Load unpacked (or CWS if published) |
| **Dia** | Chromium | ⚠️ experimental | Chrome Web Store only — CLI sideloading is disabled (see notes) |
| **Zen** | Firefox | ✅ full | `about:debugging#/runtime/this-firefox` → Load Temporary Add-on |
| Firefox | Gecko | ✅ full | Same as Zen; or a signed XPI from addons.mozilla.org |
| Waterfox, LibreWolf, Tor | Gecko | ✅ full (Tor: no DNR) | Same as Zen |

The extension logic is deliberately browser-agnostic: it talks to
`chrome.*` with **callbacks** and defensive `typeof chrome` guards
everywhere, which is exactly the shape Firefox's `chrome.*` compatibility
namespace accepts. There is no bundler, no `browser.*`-only code, and no
promise-style API usage that Firefox would choke on.

---

## Packaging

Two scripts produce the two artifacts:

```bash
bash scripts/package-release.sh   # dist/vinland-v<version>.zip          (Chromium)
bash scripts/package-firefox.sh   # dist-firefox/vinland-firefox-v<version>.zip (WebExtensions)
```

`manifest.json` (Chromium) is the single source of truth. `manifest.firefox.json`
holds only the Firefox delta, merged over `manifest.json` at package time:

- `browser_specific_settings.gecko` — stable extension id `vinland@rhyon.dev`,
  `strict_min_version: 127.0` (declarativeNetRequest support).
- `background.scripts` — Firefox event page. Chromium's `service_worker` +
  `type: module` are Chrome-only and are stripped.
- `drive_oauth` — the OAuth client id Firefox uses for Drive sync (Chromium
  reads the standard `oauth2` block instead).

CI runs the Firefox build on every push (the `firefox-build` job), so the
merge + manifest shape can never silently break. A second job,
`firefox-smoke`, then loads the packaged zip into a headless real Firefox via
web-ext and asserts the add-on installs and its background script boots with
zero JavaScript errors (see Verification).

---

## Loading

### Zen (and Firefox)

1. Build: `bash scripts/package-firefox.sh`
2. Open `about:debugging#/runtime/this-firefox`
3. **Load Temporary Add-on** → select `dist-firefox/vinland-firefox-v<version>.zip`
   (or the unzipped `dist-firefox/stage/` folder's `manifest.json`).

The add-on stays installed until you close the browser. For a permanent
install, either:

- **Sign it**: upload the zip to [addons.mozilla.org](https://addons.mozilla.org)
  (developer account required) and install the signed XPI. The extension id
  stays `vinland@rhyon.dev`.
- **Dev builds**: set `xpinstall.signatures.required` to `false` in
  `about:config` and install the unsigned zip from `about:addons`.

### Chrome / Edge / Brave / Opera / Vivaldi / Arc

`chrome://extensions` → **Developer mode** → **Load unpacked** → select the
repo folder (or the unzipped `dist/` artifact).

### Dia (experimental)

Dia (The Browser Company, now Atlassian; `company.thebrowser.dia`, v1.42.1
verified) is Chromium-based and **does** support extensions — but only from
the **Chrome Web Store**. There is no developer-mode sideload:

- `--load-extension` and `--remote-debugging-port` CLI flags are stripped,
  so neither `dist/` load-unpacked nor CLI automation can install Vinland.
- Dia ships its own extension manager at `dia://extensions`. Extensions do
  **not** auto-migrate from Chrome — each must be reinstalled manually
  inside Dia from the store.
- **New-tab override unverified.** Vinland's core hook is
  `chrome_url_overrides.newtab`, but Dia's new tab is a native workspace
  surface (morning brief, AI sidebar) rather than a traditional URL page —
  it may never route through the override. Until this is tested with a
  published store build, treat Vinland on Dia as **experimental**.
- If the override doesn't fire, Vinland currently has no in-product
  fallback (an action-icon fallback that opens `index.html` in a pinned tab
  is planned).

Prerequisite: publish Vinland to the Chrome Web Store. After that, install
it inside Dia via `dia://extensions` and check whether a new tab renders
Vinland — that is the only decisive test. Vinland's AI-free, terminal-first
design means no conflict with Dia's built-in AI sidebar.

---

## What differs per engine

| Feature | Chromium | Firefox / Zen |
|---|---|---|
| Background | MV3 service worker (`type: module`) | MV3 event page (`background.scripts`) |
| New-tab override | `chrome_url_overrides.newtab` | same key, supported |
| Storage | `chrome.storage.local` + `sync` | same (sync quota is more generous in Firefox) |
| Notifications / alarms / context menus / bookmarks / tabs | ✅ | ✅ (callback API; alarms needs the `alarms` permission in the manifest) |
| declarativeNetRequest | ✅ | ✅ Firefox 127+ (Zen is on 153) |
| Drive OAuth | `chrome.identity.getAuthToken` + `oauth2` manifest block | `chrome.identity.launchWebAuthFlow` + `drive_oauth` manifest key |
| Side effects of Drive | token cached + revocable | no token cache/revocation API — re-auth on expiry |

The **only** feature with engine-specific code paths is Google Drive backup
(`js/features/BackupManager.js`): Chromium uses `identity.getAuthToken`;
Firefox/Zen automatically falls back to `identity.launchWebAuthFlow` (an
OAuth2 implicit grant, token parsed from the redirect fragment).

---

## Configuration: Google Drive OAuth

Both engines need a real Google OAuth **Desktop/Web** client id. The repo
ships with a placeholder; replace it:

1. Google Cloud Console → Credentials → **OAuth client ID** (Web application).
2. **Authorized JavaScript origins:** your extension's origin(s) — not needed
   for `launchWebAuthFlow`, but harmless to add.
3. **Authorized redirect URIs:**
   - Chromium: `https://<chrome-extension-id>.chromiumapp.org/` (Chrome
     handles this automatically for `identity`; you don't add it manually).
   - Firefox/Zen: `https://<extension-id>.extensions.allizom.org/` — where
     `<extension-id>` is the value of `chrome.runtime.id`. For a temp-loaded
     add-on this is an auto-generated UUID that changes every load, so Drive
     auth only works against a **stable** id (install the signed XPI from AMO
     with id `vinland@rhyon.dev`, or set `xpinstall.signatures.required=false`
     with a manually fixed id).
4. Put the client id in:
   - `manifest.json` → `oauth2.client_id` (Chromium)
   - `manifest.firefox.json` → `drive_oauth.client_id` (Firefox/Zen)
5. Ensure the Google Drive API is enabled for the project, with scope
   `https://www.googleapis.com/auth/drive.file`.

**Known Firefox gap:** tokens obtained via `launchWebAuthFlow` can't be
silently refreshed or revoked (no `removeCachedAuthToken` in Firefox). When
one expires, Vinland shows "Auth expired — reconnect Drive"; reconnecting
opens the consent page again.

---

## Verification

- `npm test` — unit suites run in Node with no `chrome` global; the defensive
  guards make every API path a no-op there.
- `npx playwright test` — E2E runs in Chromium (Playwright's Firefox build
  can't load extensions), including the real-extension release-candidate
  smoke.
- The `firefox-build` CI job merges + validates the Firefox manifest and
  asserts its shape (gecko id, `background.scripts`, no Chrome-only keys).
- **`firefox-smoke` CI job** (runtime gate): `bash scripts/firefox-smoke-test.sh`
  unzips the packaged zip, loads it into a headless real Firefox via web-ext
  (Mozilla's own tool), and asserts (a) the add-on installs as a temporary
  add-on and (b) no `JavaScript error:` / `TypeError` lines appear on
  Firefox's stderr — which is where the background script's boot errors
  surface. This is the half of the gate that static shape checks can't
  cover; it caught a real bug on day one (`chrome.alarms` undefined in
  Firefox + a missing `alarms` manifest permission, which broke the pomodoro
  alarm on *both* engines). Requires `web-ext` (devDependency) and a real
  Firefox binary (`FIREFOX_BINARY`, or auto-detected).
- Optional maintainer check: `npx web-ext lint --source-dir dist-firefox/stage`
  (Mozilla's own validator) — not wired into CI to avoid a network
  dependency.
