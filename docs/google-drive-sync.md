# Google Drive Sync — OAuth Setup Guide

Vinland's Cloud Sync card in **Settings → SYNC** uses the Chrome `identity` API to
push/pull a backup JSON to Google Drive (`drive.file` scope — per-file access to
files this app creates). **It is not functional until you configure an OAuth
client ID in `manifest.json`.**

The `connectDrive()` handler now fails fast with an actionable toast when the
client ID is missing or still a placeholder (`YOUR_OAUTH_CLIENT_ID` /
`REPLACE_ME` / `CHANGE_ME`), so you'll know exactly why it's not working.

---

## One-time setup (≈ 10 minutes)

### 1. Create a Google Cloud project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or select an existing one).
3. **APIs & Services → Library** → search for **Google Drive API** → **Enable**.

### 2. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External** (required to test outside a Workspace org).
3. Fill the required app name + support email, **Save**.
4. Add the **`https://www.googleapis.com/auth/drive.file`** scope under
   *Scopes* (or just proceed; the extension requests it at runtime).
5. Publish the app (**Publish app** button) — for personal use you don't need
   Google verification.

### 3. Create an OAuth client ID

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Chrome Extension**.
3. Item ID: your extension's ID (shown at
   `chrome://extensions` → Vinland → **Details**). For an unpacked dev
   extension you can leave this blank or use any ID — Chrome only enforces it
   for published Web Store apps.

### 4. Paste the client ID into `manifest.json`

```json
"oauth2": {
  "client_id": "PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com",
  "scopes": [
    "https://www.googleapis.com/auth/drive.file"
  ]
}
```

> ⚠️ The repo ships with a placeholder
> `YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com`. If you commit a real
> client ID, keep it out of public repos — it's not a secret (client IDs are
> public), but the OAuth consent screen is tied to it.

### 5. Reload & connect

1. `chrome://extensions` → reload Vinland.
2. Open **Settings → SYNC → CONNECT DRIVE**.
3. Approve the consent prompt. The badge flips to **Connected** and
   **SYNC TO DRIVE** / **RESTORE FROM DRIVE** appear.

---

## How the connection state works

- `driveAccessToken` is **never persisted** — only the `connected` flag and
  `fileId` are stored in `chrome.storage.local`.
- On init, `loadDriveState()` re-validates the flag via
  `getAuthToken({ interactive: false })` (silent, no popup). If the cached
  token is gone, it marks the extension **disconnected** so the UI never lies
  ("Connected" but every sync fails).
- On a **401/403** from the Drive API, `_updateDriveFile()` refreshes the
  cached token once and retries a single time. If the retry still fails, it
  reports **"Auth rejected — reconnect Drive"** instead of silently creating
  duplicate backup files.

---

## Backup file layout

`buildBackupData()` (v2) exports:

| Key | Source | Persisted on restore |
|---|---|---|
| `config` | `State.CONFIG` | ✓ `saveConfig()` |
| `tasks` | `State.TASKS` | ✓ `saveData()` |
| `notes` | `State.NOTES` | ✓ `saveData()` |
| `boards` | `State.BOARDS` | ✓ `saveData()` |
| `canvases` | `State.CANVASES` | ✓ `saveData()` (IndexedDB) |
| `commands` | `State.COMMAND_HISTORY` | ✓ `saveData()` |

`importFromSync()` (used by **RESTORE FROM DRIVE**) restores all six keys,
including canvases — same shape as the local **EXPORT CONFIG** file.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Toast: *"Add your OAuth client ID to manifest.json"* | `oauth2.client_id` missing or still a placeholder. Follow steps 1–4. |
| *"Auth expired — reconnect Drive"* | Token revoked/expired and silent refresh failed. Open Settings → SYNC → DISCONNECT → CONNECT DRIVE. |
| Badge says Not connected after restart | Expected — the token isn't persisted. Click **CONNECT DRIVE** once per session (or it will prompt on first sync). |
| *"DRIVE NOT CONNECTED"* on sync | Token unavailable; same fix as above. |
| Duplicate `vinland-backup.json` files in Drive | Old bug (auth errors treated as "file deleted") — fixed in this build. Delete extras manually once. |

---

## Known gaps & limitations

These are honest, verified limitations of the current Drive integration.
They exist because Chromium's `chrome.identity` is single-purpose and the
MVP targets one Cloudflare-free, zero-infrastructure deploy. Each row links
to where the fix would land.

| Gap | Impact | Current behavior | Fix path |
|---|---|---|---|
| **Token not persisted** | Every browser restart you must **CONNECT DRIVE** again (silent re-auth is attempted but the cached token is gone) | `loadDriveState()` marks the extension disconnected when `getAuthToken({interactive:false})` finds nothing | Persist a refresh token (Firefox `launchWebAuthFlow` supports `offline_access`) or reuse Chrome's `getAuthToken` after an explicit interactive grant |
| **Chromium-only OAuth** | Drive sync is unavailable on Firefox/Zen and other MV3 WebExtensions — no `chrome.identity` there | `drive_oauth` manifest key + `launchWebAuthFlow` path exists only in the Firefox manifest; **not implemented in code** | Implement the `launchWebAuthFlow` code path in `BackupManager` (see `docs/browser-support.md` §Configuration) |
| **No token revocation UI** | "Disconnect" doesn't revoke the Google-side grant; the token lingers until it expires | `disconnectDrive()` clears local state only | Call `identity.removeCachedAuthToken` (Chromium) / revoke endpoint (Firefox) |
| **Single-file sync, no conflict handling** | Concurrent edits across devices last-write-wins; no merge or conflict markers | `_updateDriveFile()` PATCHes one `vinland-backup.json` | Multi-file sync or revision comparison before push |
| **No encryption at rest** | The backup JSON contains full note content and sits unencrypted in your Drive | Plain JSON upload under `drive.file` scope | Encrypt with a local passphrase before upload (field-level or blob-level) |
| **Push is one-way by default** | Auto-backup only pushes; pull (restore) is manual via **RESTORE FROM DRIVE** | `triggerBackup('drive')` uploads; restore requires the button | Optional scheduled pull with diff-aware merge |

**Auto-backup without Drive:** when Drive isn't connected, the interval
(`auto_backup_interval`) and the proactive reminder
(`backup_reminder_enabled`, default on, nudge every 7+ days) fall back to
downloading a local `vinland-backup.json` — so backups work for everyone,
with or without OAuth. See `BackupManager.maybePromptBackup()`.
