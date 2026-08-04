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
| **No encryption at rest** | ~~The backup JSON contains full note content and sits unencrypted in your Drive~~ | **Resolved** — optional passphrase encrypts every backup blob (AES-256-GCM, PBKDF2) before it leaves the device (see **Encryption at rest** below) | — |
| **Push is one-way by default** | ~~Auto-backup only pushes; pull (restore) is manual~~ | **Resolved** — optional scheduled pull merges Drive's backup into local state (see **Scheduled pull** below) | — |

**Auto-backup without Drive:** when Drive isn't connected, the interval
(`auto_backup_interval`) and the proactive reminder
(`backup_reminder_enabled`, default on, nudge every 7+ days) fall back to
downloading a local `vinland-backup.json` — so backups work for everyone,
with or without OAuth. See `BackupManager.maybePromptBackup()`.

---

## Encryption at rest (optional passphrase)

**Settings → SYNC → ENCRYPTION AT REST.** When enabled, every backup blob —
local downloads **and** Drive uploads — is encrypted with **AES-256-GCM** using
a key derived from your passphrase via **PBKDF2-SHA256** (150,000 iterations,
random 16-byte salt + 12-byte IV per file). The result is a self-describing
envelope that begins with the marker `vinland-enc-v1`.

**How the passphrase is handled:**

- Stored only in `chrome.storage.local` (localStorage fallback in dev) —
  **never** in `State.CONFIG`, so it can never leak into a backup's `config`
  export or sync to another device via `chrome.storage.sync`.
- Encrypting is automatic once set: `downloadBackup()`, `syncToDrive()`,
  and the auto-backup interval all go through `encryptBackup()`.
- Decrypting is automatic too when the passphrase is present (`decryptBackup()`
  detects the envelope marker). Restoring on a second device requires setting
  the same passphrase there first — otherwise you get a clear
  `passphrase_required` / `passphrase_wrong` notice and nothing is overwritten.
- Clearing the passphrase disables encryption (`backup_encryption_enabled`),
  but already-encrypted Drive backups can no longer be read without the key.

> ⚠️ The passphrase is the key. There is no recovery mechanism — losing it
> means losing the encrypted backups. Keep a copy somewhere safe.

---

## Scheduled pull (diff-aware converge)

**Settings → SYNC → AUTO PULL FROM DRIVE** (same interval options as the
auto-backup). When Drive is connected, `BackupManager.autoPullFromDrive()`
downloads the remote backup, decrypts it if needed, and **diff-merges** it
into local state — so two devices editing the same vault converge instead of
clobbering each other.

**Merge rules (per entity):**

| Collection | Key | Conflict resolution |
|---|---|---|
| `notes` | `id` | Newer `modified` wins; remote-only added; local-only kept |
| `boards` | `id` | Newer `modified` wins (same as notes) |
| `canvases` | `id` | Newer `modified` wins |
| `tasks` | `text` | Newer `modified` wins; tasks without a key are skipped (avoids dupes) |

- Entities without a usable key (no `id` for notes, no `text` for tasks) are
  skipped rather than duplicated.
- `config` is **never** merged on a scheduled pull — that's a deliberate
  full-restore decision (`RESTORE FROM DRIVE`), not a background-sync one.
- A summary toast reports what was pulled (e.g. `SYNC: pulled 2 notes, 1
  task, 0 boards from Drive`). `drive_last_pull` is recorded for the status
  row in Settings.
- The pull respects the same failure discipline as push: a missing/wrong
  passphrase or an auth error aborts without touching local data.
