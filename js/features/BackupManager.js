import { State } from '../core/Store.js';
import { Config, saveConfig } from '../core/Config.js';
import { saveData } from '../core/Storage.js';



const BACKUP_FOLDER_NAME = 'Vinland Backup';
const BACKUP_FILE_NAME = 'vinland-backup.json';

// Encryption at rest.
// The passphrase is deliberately kept OUT of State.CONFIG — buildBackupData()
// exports `config: State.CONFIG`, so storing it there would ship the key
// alongside the ciphertext. It lives in chrome.storage.local with a
// localStorage fallback so unit tests (no chrome) can exercise it.
const PASSPHRASE_STORAGE_KEY = 'vinland_backup_passphrase';
const ENCRYPTION_ALGO = 'AES-GCM';
const ENCRYPTION_KDF = 'PBKDF2';
const ENCRYPTION_HASH = 'SHA-256';
const ENCRYPTION_ITERATIONS = 600000; // OWASP 2023 guidance for PBKDF2-SHA256
const ENCRYPTION_BITS = 256;
const ENVELOPE_MARKER = 'vinland-enc-v1';

export const BackupManager = {
    intervalId: null,
    lastBackupTime: null,
    driveAccessToken: null,
    driveFileId: null,
    driveConnected: false,

    

    init: function() {
        // Restore Drive connection state from chrome.storage.local
        this.loadDriveState();
        // Load the encryption passphrase (chrome.storage.local is async)
        this.loadPassphrase();
        // Start auto-backup timer if enabled
        this.scheduleAutoBackup();
        // Start scheduled pull if enabled
        this.scheduleAutoPull();
        // Nudge the user if the last backup is stale
        this.maybePromptBackup();
    },

    // Proactive backup reminder. Shown once per window at boot when the last
    // backup is missing or older than backup_reminder_days and the user has
    // not been prompted within that window. Suppressed during the first-run
    // tour and under automation. CANCEL defers; EXPORT NOW downloads a JSON
    // snapshot via the normal backup path.
    maybePromptBackup: function() {
        if (State.CONFIG.first_run) return;
        if (typeof navigator !== 'undefined' && navigator.webdriver) return;
        if (State.CONFIG.backup_reminder_enabled === false) return;

        var days = Math.max(1, State.CONFIG.backup_reminder_days || 7);
        var windowMs = days * 86400000;
        var now = Date.now();

        var overdue = !State.CONFIG.last_backup_time ||
            (now - State.CONFIG.last_backup_time > windowMs);
        if (!overdue) return;

        // Don't nag repeatedly within the same window.
        if (State.CONFIG.last_backup_prompt &&
            (now - State.CONFIG.last_backup_prompt < windowMs)) return;

        // Guard BEFORE persisting the prompt timestamp: if the modal system
        // isn't available, don't record a nudge we never showed (otherwise
        // reminders would be silently suppressed for the whole window).
        if (typeof showConfirmModal !== 'function') return;

        State.CONFIG.last_backup_prompt = now;
        saveConfig();

        var self = this;
        showConfirmModal(
            'BACKUP REMINDER',
            'It\'s been ' + days + '+ days since your last backup. Export a ' +
            'JSON snapshot of your notes, tasks, and boards?',
            function() { self.triggerBackup('auto'); }, // EXPORT NOW
            function() { /* CANCEL: defer; next nudge in N days */ },
            'EXPORT NOW',
            null
        );
    },

    

    scheduleAutoBackup: function() {
        this.stopAutoBackup();
        var interval = State.CONFIG.auto_backup_interval;
        if (!interval || interval <= 0) return;

        var ms = interval * 60 * 1000;
        console.log('[Backup] Auto-backup scheduled every ' + interval + ' min');

        this.intervalId = setInterval(function() {
            // Drive connected → push to Drive only (no Downloads-folder JSON
            // spam on every interval). Not connected → local download fallback.
            BackupManager.triggerBackup(BackupManager.driveConnected ? 'drive' : 'auto');
        }, ms);
    },

    stopAutoBackup: function() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    },

    

    buildBackupData: function() {
        return {
            exportVersion: 2,
            exportedAt: new Date().toISOString(),
            config: State.CONFIG,
            tasks: State.TASKS,
            notes: State.NOTES,
            boards: State.BOARDS,
            canvases: State.CANVASES,
            commands: State.COMMAND_HISTORY
        };
    },

    // ──────────────────────────────────────────────
    // Encryption at rest (optional passphrase)
    // ──────────────────────────────────────────────

    // Web Crypto is only available on secure contexts. Guard so the feature
    // degrades to plaintext (with a clear notice) in unsupported environments.
    _cryptoAvailable: function() {
        return typeof crypto !== 'undefined' && crypto.subtle &&
            typeof crypto.subtle.importKey === 'function';
    },

    // Persist the passphrase. NEVER in State.CONFIG (would ship with backups).
    setPassphrase: function(passphrase, callback) {
        if (!passphrase || typeof passphrase !== 'string' || passphrase.length < 4) {
            if (callback) callback(false);
            return;
        }
        var self = this;
        var persist = function() {
            self.passphrase = passphrase;
            State.CONFIG.backup_encryption_enabled = true;
            saveConfig();
            if (callback) callback(true);
        };
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            var obj = {};
            obj[PASSPHRASE_STORAGE_KEY] = passphrase;
            chrome.storage.local.set(obj, persist);
        } else {
            try { localStorage.setItem(PASSPHRASE_STORAGE_KEY, passphrase); } catch (e) {}
            persist();
        }
    },

    clearPassphrase: function(callback) {
        this.passphrase = null;
        State.CONFIG.backup_encryption_enabled = false;
        saveConfig();
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.remove(PASSPHRASE_STORAGE_KEY, function() {
                if (callback) callback(true);
            });
        } else {
            try { localStorage.removeItem(PASSPHRASE_STORAGE_KEY); } catch (e) {}
            if (callback) callback(true);
        }
    },

    // Resolve the passphrase synchronously if available (in-memory or local
    // storage) and report availability. Async chrome.storage is NOT awaited
    // here — encryption can't be applied until loadPassphrase has run.
    hasPassphrase: function() {
        if (this.passphrase) return true;
        try {
            return !!(typeof localStorage !== 'undefined' && localStorage.getItem(PASSPHRASE_STORAGE_KEY));
        } catch (e) { return false; }
    },

    // Async resolver for the passphrase (chrome.storage.local is async).
    loadPassphrase: function(callback) {
        var self = this;
        if (this.passphrase) { if (callback) callback(this.passphrase); return; }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get([PASSPHRASE_STORAGE_KEY], function(result) {
                self.passphrase = result[PASSPHRASE_STORAGE_KEY] || null;
                if (callback) callback(self.passphrase);
            });
        } else {
            var stored = null;
            try { stored = localStorage.getItem(PASSPHRASE_STORAGE_KEY); } catch (e) {}
            this.passphrase = stored || null;
            if (callback) callback(this.passphrase);
        }
    },

    // Wrap a plaintext string in the encryption envelope. Returns a Promise
    // of the envelope JSON string. Resolves to the original text unchanged if
    // encryption is disabled / no passphrase / Web Crypto unavailable.
    // NOTE: the sync hasPassphrase() fast-path is intentionally NOT a gate
    // here — on a fresh restart chrome.storage.local is still loading, and a
    // false negative would silently degrade an encrypted setup to plaintext.
    // Always resolve through loadPassphrase() and decide there.
    encryptBackup: function(plaintext, callback) {
        var self = this;
        if (!State.CONFIG.backup_encryption_enabled || !this._cryptoAvailable()) {
            if (callback) callback(null, plaintext); // not encrypted
            return;
        }
        this.loadPassphrase(function(passphrase) {
            if (!passphrase) {
                // Encryption is ON but no passphrase resolved (storage error,
                // cleared key, load race). NEVER silently downgrade — the user
                // believes this backup is protected. Warn loudly so the gap is
                // visible instead of shipping a plaintext blob they think is
                // encrypted.
                console.error('[Backup] ENCRYPTION MISMATCH: backup_encryption_enabled is true but no passphrase is set — backup went out PLAINTEXT. Set your passphrase in Settings → SYNC.');
                if (window.showNotification) {
                    window.showNotification('⚠ ENCRYPTION OFF: passphrase not found — backup saved unencrypted');
                }
                if (callback) callback(null, plaintext);
                return;
            }
            self._encryptAesGcm(plaintext, passphrase)
                .then(function(envelope) {
                    if (callback) callback(envelope, null);
                })
                .catch(function(err) {
                    console.error('[Backup] Encryption failed:', err);
                    if (window.showNotification) {
                        window.showNotification('⚠ ENCRYPTION FAILED — backup saved unencrypted');
                    }
                    if (callback) callback(null, plaintext); // fail open to plaintext
                });
        });
    },

    // Reverse of encryptBackup: given file content, return the plaintext JSON
    // string. Detects the envelope marker; passthrough for plaintext. On a
    // wrong/missing passphrase, calls back (null, null, errorCode).
    decryptBackup: function(content, callback) {
        var self = this;
        if (typeof content !== 'string') {
            if (callback) callback(null, null, 'invalid');
            return;
        }
        var trimmed = content.trim();
        // Fast path: content that can't be an envelope (doesn't parse to an
        // object starting with the marker) passes through as plaintext.
        if (trimmed.indexOf('{') !== 0) {
            if (callback) callback(trimmed, null, null);
            return;
        }
        var envelope;
        try { envelope = JSON.parse(trimmed); } catch (e) {
            // Not JSON at all — plaintext (a bare string, CSV, etc.).
            if (callback) callback(trimmed, null, null);
            return;
        }
        // Structural check on the PARSED object — never a substring search, so
        // a plaintext backup whose note body happens to contain the marker
        // string can't be misclassified as an envelope.
        if (!envelope || typeof envelope !== 'object' || envelope.marker !== ENVELOPE_MARKER ||
            typeof envelope.salt !== 'string' || typeof envelope.iv !== 'string' ||
            typeof envelope.ct !== 'string') {
            if (callback) callback(trimmed, null, null); // plaintext passthrough
            return;
        }
        this.loadPassphrase(function(passphrase) {
            if (!passphrase) {
                if (callback) callback(null, null, 'passphrase_required');
                return;
            }
            try {
                self._decryptAesGcm(envelope, passphrase)
                    .then(function(plain) {
                        if (callback) callback(plain, null, null);
                    })
                    .catch(function(err) {
                        console.error('[Backup] Decryption failed:', err);
                        // Auth tag mismatch → wrong passphrase or corrupted file.
                        if (callback) callback(null, null, 'passphrase_wrong');
                    });
            } catch (e) {
                // Malformed envelope (bad base64, etc.) — never let the caller
                // hang waiting for a callback that would never fire.
                console.error('[Backup] Decrypt invocation failed:', e);
                if (callback) callback(null, null, 'invalid');
            }
        });
    },

    _deriveKey: function(passphrase, saltBytes, iterations) {
        var enc = new TextEncoder();
        iterations = iterations || ENCRYPTION_ITERATIONS;
        return crypto.subtle.importKey(
            'raw', enc.encode(passphrase), { name: ENCRYPTION_KDF }, false,
            ['deriveKey']
        ).then(function(baseKey) {
            return crypto.subtle.deriveKey(
                {
                    name: ENCRYPTION_KDF,
                    salt: saltBytes,
                    iterations: iterations,
                    hash: ENCRYPTION_HASH
                },
                baseKey,
                { name: ENCRYPTION_ALGO, length: ENCRYPTION_BITS },
                false,
                ['encrypt', 'decrypt']
            );
        });
    },

    _b64encode: function(bytes) {
        var bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    },

    _b64decode: function(b64) {
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    },

    _encryptAesGcm: function(plaintext, passphrase, iterations) {
        var self = this;
        var enc = new TextEncoder();
        iterations = iterations || ENCRYPTION_ITERATIONS;
        var salt = crypto.getRandomValues(new Uint8Array(16));
        var iv = crypto.getRandomValues(new Uint8Array(12));
        return this._deriveKey(passphrase, salt, iterations).then(function(key) {
            return crypto.subtle.encrypt(
                { name: ENCRYPTION_ALGO, iv: iv }, key, enc.encode(plaintext)
            );
        }).then(function(ciphertext) {
            return JSON.stringify({
                marker: ENVELOPE_MARKER,
                algo: ENCRYPTION_ALGO,
                kdf: ENCRYPTION_KDF,
                hash: ENCRYPTION_HASH,
                // Record the ACTUAL iteration count used so decrypt always
                // re-derives with the same value — never the module constant.
                iterations: iterations,
                salt: self._b64encode(salt),
                iv: self._b64encode(iv),
                ct: self._b64encode(new Uint8Array(ciphertext))
            });
        });
    },

    _decryptAesGcm: function(envelope, passphrase) {
        var self = this;
        var dec = new TextDecoder();
        var salt = this._b64decode(envelope.salt);
        var iv = this._b64decode(envelope.iv);
        var ct = this._b64decode(envelope.ct);
        // Use the envelope's own iteration count so a future ENCRYPTION_ITERATIONS
        // bump never breaks decryption of backups created with the old value.
        var iterations = (envelope && envelope.iterations) || ENCRYPTION_ITERATIONS;
        return this._deriveKey(passphrase, salt, iterations).then(function(key) {
            return crypto.subtle.decrypt({ name: ENCRYPTION_ALGO, iv: iv }, key, ct);
        }).then(function(plain) {
            return dec.decode(plain);
        });
    },

    // ──────────────────────────────────────────────
    // Scheduled pull + diff-aware merge
    // ──────────────────────────────────────────────

    scheduleAutoPull: function() {
        this.stopAutoPull();
        var interval = State.CONFIG.auto_pull_interval;
        if (!interval || interval <= 0) return;
        var ms = interval * 60 * 1000;
        console.log('[Backup] Auto-pull scheduled every ' + interval + ' min');
        this.pullIntervalId = setInterval(function() {
            if (!BackupManager.driveConnected) return;
            BackupManager.autoPullFromDrive();
        }, ms);
    },

    stopAutoPull: function() {
        if (this.pullIntervalId) {
            clearInterval(this.pullIntervalId);
            this.pullIntervalId = null;
        }
    },

    // Pull remote backup and merge into local state. Diff-aware: newer
    // `modified` wins per entity; remote-only entities are added; local-only
    // are kept. Reports a count summary. Never overwrites config (that's a
    // full-restore decision, not a sync one).
    autoPullFromDrive: function(callback) {
        var self = this;
        if (!this.driveConnected || !this.driveAccessToken) {
            if (callback) callback(false, null);
            return;
        }
        this._getDriveFileContent(function(success, content, errorCode) {
            if (!success || !content) {
                if (callback) callback(false, null);
                return;
            }
            self.decryptBackup(content, function(plain, err, code) {
                if (!plain) {
                    if (code === 'passphrase_required' && window.showNotification) {
                        window.showNotification('SYNC: backup is encrypted — set your passphrase first');
                    } else if (code === 'passphrase_wrong' && window.showNotification) {
                        window.showNotification('SYNC: wrong passphrase — nothing merged');
                    }
                    if (callback) callback(false, null);
                    return;
                }
                var data;
                try { data = JSON.parse(plain); } catch (e) {
                    console.error('[Backup] Auto-pull: bad JSON:', e);
                    if (callback) callback(false, null);
                    return;
                }
                var summary = self._mergeRemoteData(data);
                if (summary.changed) {
                    if (window.saveData) window.saveData();
                }
                State.CONFIG.drive_last_pull = new Date().toISOString();
                saveConfig();
                if (window.showNotification && summary.changed) {
                    window.showNotification('SYNC: pulled ' + summary.notes + ' notes, ' +
                        summary.tasks + ' tasks, ' + summary.boards + ' boards from Drive');
                }
                if (callback) callback(true, summary);
            });
        });
    },

    // Keyed merge. notes/boards/canvases by `id`; tasks by `text` (this app's
    // tasks have no id). Newer `modified` wins; ties keep local.
    _mergeRemoteData: function(remote) {
        var summary = { notes: 0, tasks: 0, boards: 0, changed: false };

        if (remote.notes && Array.isArray(remote.notes)) {
            var notes = State.NOTES || [];
            summary.notes = this._mergeById(notes, remote.notes, 'id');
            if (summary.notes > 0) State.NOTES = notes;
        }
        if (remote.tasks && Array.isArray(remote.tasks)) {
            var tasks = State.TASKS || [];
            summary.tasks = this._mergeById(tasks, remote.tasks, 'text');
            if (summary.tasks > 0) State.TASKS = tasks;
        }
        if (remote.boards && Array.isArray(remote.boards)) {
            var boards = State.BOARDS || [];
            summary.boards = this._mergeById(boards, remote.boards, 'id');
            if (summary.boards > 0) State.BOARDS = boards;
        }
        if (remote.canvases && Array.isArray(remote.canvases) && State.CANVASES) {
            // Canvases changes count toward persistence too — a canvases-only
            // pull must still trigger saveData().
            summary.canvases = this._mergeById(State.CANVASES, remote.canvases, 'id');
        }
        summary.changed = summary.notes > 0 || summary.tasks > 0 ||
            summary.boards > 0 || (summary.canvases || 0) > 0;
        return summary;
    },

    // Merge remote array into local array keyed by keyName. Returns count of
    // entities changed (added or updated). Mutates local in place.
    _mergeById: function(local, remote, keyName) {
        var localIndex = {};
        for (var i = 0; i < local.length; i++) {
            var k = local[i] && local[i][keyName];
            if (k !== undefined && k !== null) localIndex[String(k)] = local[i];
        }
        var changed = 0;
        for (var j = 0; j < remote.length; j++) {
            var r = remote[j];
            if (!r) continue;
            var rk = r[keyName];
            if (rk === undefined || rk === null) {
                // No key — can't match; skip (protects against duplicates).
                continue;
            }
            var existing = localIndex[String(rk)];
            if (!existing) {
                local.push(r);
                localIndex[String(rk)] = r;
                changed++;
            } else if (this._newerWins(r, existing)) {
                var idx = local.indexOf(existing);
                local[idx] = r;
                localIndex[String(rk)] = r;
                changed++;
            }
        }
        return changed;
    },

    // Newer `modified` wins; if either lacks a timestamp, prefer local (keep
    // existing) to avoid clobbering on uncertain data.
    _newerWins: function(remote, local) {
        var rm = remote.modified || remote.updated_at;
        var lm = local.modified || local.updated_at;
        if (!rm || !lm) return false;
        var rms = typeof rm === 'string' ? new Date(rm).getTime() : rm;
        var lms = typeof lm === 'string' ? new Date(lm).getTime() : lm;
        return rms > lms;
    },

    

    triggerBackup: function(mode) {
        // mode: 'auto' (download) | 'drive' (upload to Drive) | 'both' (default)
        mode = mode || 'both';

        if (mode === 'auto' || mode === 'both') {
            this.downloadBackup();
        }

        if ((mode === 'drive' || mode === 'both') && this.driveConnected) {
            this.syncToDrive();
        }

        this.lastBackupTime = Date.now();
        State.CONFIG.last_backup_time = this.lastBackupTime;
        saveConfig();
    },

    

    downloadBackup: function() {
        var self = this;
        var data = this.buildBackupData();
        var plain = JSON.stringify(data, null, 2);
        this.encryptBackup(plain, function(envelope, notEncrypted) {
            var payload = envelope || plain;
            var encrypted = !!envelope;
            var blob = new Blob([payload], { type: 'application/json' });
            var url = URL.createObjectURL(blob);

            var filename = 'vinland-backup-' + new Date().toISOString().slice(0, 10) +
                (encrypted ? '.enc' : '') + '.json';

            var a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Show toast notification
            if (window.showNotification) {
                window.showNotification('BACKUP: ' + filename + (encrypted ? ' [ENCRYPTED]' : ''));
            }

            console.log('[Backup] Downloaded: ' + filename + (encrypted ? ' (encrypted)' : ''));
        });
    },

    

    getDriveAuthScopes: function() {
        // drive.file scope: per-file access created by this app only
        return ['https://www.googleapis.com/auth/drive.file'];
    },

    // Unified OAuth client id: Firefox builds read drive_oauth (the custom key
    // merged in by scripts/package-firefox.sh); Chromium builds read oauth2.
    _resolveDriveClientId: function() {
        var manifest = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest() : null;
        if (!manifest) return null;
        return (manifest.drive_oauth && manifest.drive_oauth.client_id) ||
               (manifest.oauth2 && manifest.oauth2.client_id) || null;
    },

    // Firefox/WebExtensions OAuth: chrome.identity.getAuthToken is Chrome-only.
    // Firefox exposes identity.launchWebAuthFlow — a plain OAuth2 implicit
    // grant; the access token returns in the redirect fragment.
    _launchWebAuthFlow: function(interactive, callback) {
        var self = this;
        if (typeof chrome === 'undefined' || !chrome.identity || !chrome.identity.launchWebAuthFlow || !chrome.runtime.id) {
            if (callback) callback(false);
            return;
        }
        var clientId = this._resolveDriveClientId();
        if (!clientId || /YOUR_OAUTH_CLIENT_ID|REPLACE_ME|CHANGE_ME/i.test(clientId)) {
            console.error('[Backup] Drive auth unavailable: no drive_oauth.client_id in manifest');
            if (interactive && window.showNotification) {
                window.showNotification('ERROR: Add your OAuth client ID to the manifest — see docs/browser-support.md');
            }
            if (callback) callback(false);
            return;
        }
        // Firefox requires the redirect to https://<extension-id>.extensions.allizom.org/
        // (runtime.id resolves to the internal UUID, even for about:debugging loads).
        var redirectUri = 'https://' + chrome.runtime.id + '.extensions.allizom.org/';
        var authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' +
            '?client_id=' + encodeURIComponent(clientId) +
            '&redirect_uri=' + encodeURIComponent(redirectUri) +
            '&response_type=token' +
            '&scope=' + encodeURIComponent(this.getDriveAuthScopes().join(' ')) +
            '&prompt=' + (interactive ? 'consent' : 'none');
        chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: interactive }, function(redirectUrl) {
            if (chrome.runtime.lastError || !redirectUrl) {
                console.error('[Backup] Drive auth error (WebAuth):', chrome.runtime.lastError && chrome.runtime.lastError.message);
                if (interactive && window.showNotification) {
                    window.showNotification('DRIVE AUTH FAILED: ' + (chrome.runtime.lastError && chrome.runtime.lastError.message));
                }
                if (callback) callback(false);
                return;
            }
            var m = redirectUrl.match(/[#&]access_token=([^&]+)/);
            if (!m) {
                console.error('[Backup] Drive auth error (WebAuth): no access_token in redirect');
                if (interactive && window.showNotification) {
                    window.showNotification('DRIVE AUTH FAILED: No access_token in redirect');
                }
                if (callback) callback(false);
                return;
            }
            self.driveAccessToken = decodeURIComponent(m[1]);
            self.driveConnected = true;
            self.saveDriveState();
            console.log('[Backup] Drive connected successfully (WebAuth flow)');
            if (interactive && window.showNotification) {
                window.showNotification('GOOGLE DRIVE CONNECTED');
            }
            if (callback) callback(true);
        });
    },

    connectDrive: function(callback) {
        var self = this;
        var scopes = this.getDriveAuthScopes().join(' ');

        // Firefox/Zen expose identity.launchWebAuthFlow instead of getAuthToken.
        var hasChromeTokenApi = typeof chrome !== 'undefined' && chrome.identity && chrome.identity.getAuthToken;
        var hasWebAuthFlow = typeof chrome !== 'undefined' && chrome.identity && chrome.identity.launchWebAuthFlow;
        if (!hasChromeTokenApi && !hasWebAuthFlow) {
            if (window.showNotification) {
                window.showNotification('ERROR: chrome.identity not available (not in extension context)');
            }
            if (callback) callback(false);
            return;
        }

        // Fail fast with an actionable message when OAuth is not configured.
        // Chromium needs an oauth2 block; Firefox builds use drive_oauth.
        var clientId = this._resolveDriveClientId();
        if (!clientId || /YOUR_OAUTH_CLIENT_ID|REPLACE_ME|CHANGE_ME/i.test(clientId)) {
            console.error('[Backup] Drive auth unavailable: no OAuth client id in manifest');
            if (window.showNotification) {
                window.showNotification('ERROR: Add your OAuth client ID to the manifest — see docs/browser-support.md');
            }
            if (callback) callback(false);
            return;
        }

        if (!hasChromeTokenApi) {
            // Firefox/WebExtensions path (identity.launchWebAuthFlow).
            this._launchWebAuthFlow(true, callback);
            return;
        }

        chrome.identity.getAuthToken({ interactive: true, scopes: scopes }, function(token) {
            if (chrome.runtime.lastError) {
                console.error('[Backup] Drive auth error:', chrome.runtime.lastError.message);
                if (window.showNotification) {
                    window.showNotification('DRIVE AUTH FAILED: ' + chrome.runtime.lastError.message);
                }
                if (callback) callback(false);
                return;
            }

            self.driveAccessToken = token;
            self.driveConnected = true;
            self.saveDriveState();

            console.log('[Backup] Drive connected successfully');
            if (window.showNotification) {
                window.showNotification('GOOGLE DRIVE CONNECTED');
            }

            if (callback) callback(true);
        });
    },

    disconnectDrive: function(callback) {
        var self = this;
        if (this.driveAccessToken) {
            if (typeof chrome !== 'undefined' && chrome.identity && chrome.identity.removeCachedAuthToken) {
                chrome.identity.removeCachedAuthToken({ token: this.driveAccessToken }, function() {
                    self.driveAccessToken = null;
                    self.driveConnected = false;
                    self.driveFileId = null;
                    self.saveDriveState();
                    if (window.showNotification) {
                        window.showNotification('GOOGLE DRIVE DISCONNECTED');
                    }
                    if (callback) callback(true);
                });
            } else {
                this.driveAccessToken = null;
                this.driveConnected = false;
                this.driveFileId = null;
                this.saveDriveState();
                if (callback) callback(true);
            }
        } else {
            this.driveConnected = false;
            this.driveFileId = null;
            this.saveDriveState();
            if (callback) callback(true);
        }
    },

    syncToDrive: function(callback) {
        var self = this;

        if (!this.driveConnected || !this.driveAccessToken) {
            if (window.showNotification) {
                window.showNotification('DRIVE NOT CONNECTED. Use "Connect" first.');
            }
            if (callback) callback(false);
            return;
        }

        var data = this.buildBackupData();
        var plain = JSON.stringify(data);

        // Encrypt at rest before anything touches the wire. The upload
        // functions accept the pre-serialized payload string as `data`.
        this.encryptBackup(plain, function(envelope) {
            var payload = envelope || plain;
            self._pushPayload(payload, callback);
        });
    },

    // Shared push logic — takes a final payload string (plain or encrypted
    // envelope) and drives the create-or-update flow against Drive.
    _pushPayload: function(payload, callback) {
        var self = this;
        var data = payload; // pre-serialized string (encrypted or plain)

        if (this.driveFileId) {
            // Update existing file
            this._updateDriveFile(data, function(success, fileId) {
                if (success) {
                    self.driveFileId = fileId;
                    self._onSyncComplete();
                    if (callback) callback(true);
                } else {
                    if (callback) callback(false);
                }
            });
        } else {
            // Search for existing backup file first
            this._findDriveBackupFile(function(existingId, errorCode) {
                if (existingId) {
                    self.driveFileId = existingId;
                    self._updateDriveFile(data, function(success, fileId) {
                        if (success) {
                            self.driveFileId = fileId;
                            self._onSyncComplete();
                            if (callback) callback(true);
                        } else {
                            if (callback) callback(false);
                        }
                    });
                } else if (errorCode === 'not_found') {
                    // No existing backup — create new file
                    self._createDriveFile(data, function(success, fileId) {
                        if (success) {
                            self.driveFileId = fileId;
                            self._onSyncComplete();
                            if (callback) callback(true);
                        } else {
                            if (callback) callback(false);
                        }
                    });
                } else {
                    // Auth/network failure during the search — do NOT create a
                    // duplicate. The old code treated any failure as "no file".
                    if (window.showNotification) {
                        window.showNotification(errorCode === 'auth'
                            ? 'DRIVE SYNC FAILED: Auth expired — reconnect Drive'
                            : 'DRIVE SYNC FAILED: Could not reach Drive');
                    }
                    if (callback) callback(false);
                }
            });
        }
    },

    syncFromDrive: function(callback) {
        var self = this;

        if (!this.driveConnected || !this.driveAccessToken) {
            if (window.showNotification) {
                window.showNotification('DRIVE NOT CONNECTED. Use "Connect" first.');
            }
            if (callback) callback(false);
            return;
        }

        this._getDriveFileContent(function(success, content, errorCode) {
            if (success && content) {
                // Decrypt at rest if the remote blob is an envelope.
                self.decryptBackup(content, function(plain, err, code) {
                    if (!plain) {
                        if (code === 'passphrase_required' && window.showNotification) {
                            window.showNotification('SYNC ERROR: backup is encrypted — set your passphrase first');
                        } else if (code === 'passphrase_wrong' && window.showNotification) {
                            window.showNotification('SYNC ERROR: wrong passphrase');
                        } else if (window.showNotification) {
                            window.showNotification('SYNC ERROR: Corrupted backup file');
                        }
                        if (callback) callback(false);
                        return;
                    }
                    try {
                        var data = JSON.parse(plain);
                        // Trigger import via the existing import machinery
                        if (window.SettingsUI && window.SettingsUI.importFromSync) {
                            window.SettingsUI.importFromSync(data);
                        }
                        self._onSyncComplete('pull');
                        if (callback) callback(true);
                    } catch (e) {
                        console.error('[Backup] Failed to parse Drive backup:', e);
                        if (window.showNotification) {
                            window.showNotification('SYNC ERROR: Corrupted backup file');
                        }
                        if (callback) callback(false);
                    }
                });
            } else {
                var msg = 'NO BACKUP FOUND ON DRIVE';
                if (errorCode === 'auth') {
                    msg = 'DRIVE SYNC FAILED: Auth expired — reconnect Drive';
                } else if (errorCode === 'error') {
                    msg = 'DRIVE SYNC FAILED: Could not reach Drive';
                }
                if (window.showNotification) window.showNotification(msg);
                if (callback) callback(false);
            }
        });
    },

    

    _getHeaders: function() {
        return {
            'Authorization': 'Bearer ' + this.driveAccessToken,
            'Content-Type': 'application/json'
        };
    },

    // Classify Drive API HTTP status into a user-facing error code.
    _driveErrorCode: function(status) {
        if (status === 401 || status === 403) return 'auth';
        if (status === 404) return 'not_found';
        return 'error';
    },

    _findDriveBackupFile: function(callback) {
        var query = encodeURIComponent("name='" + BACKUP_FILE_NAME + "' and trashed=false");
        var url = 'https://www.googleapis.com/drive/v3/files?q=' + query + '&fields=files(id,name)';

        var self = this;
        fetch(url, { headers: { 'Authorization': 'Bearer ' + this.driveAccessToken } })
            .then(function(res) {
                if (!res.ok) {
                    // Distinguish auth failures from 'no file exists' so the
                    // caller never misreports a dead token as 'no backup'.
                    callback(null, self._driveErrorCode(res.status));
                    return null; // stop the chain
                }
                return res.json();
            })
            .then(function(json) {
                if (json === null) return; // handled by the !res.ok branch above
                if (json.files && json.files.length > 0) {
                    callback(json.files[0].id);
                } else {
                    callback(null, 'not_found');
                }
            })
            .catch(function(err) {
                console.error('[Backup] Error finding Drive file:', err);
                callback(null, 'error');
            });
    },

    // Accepts either a backup-data object (legacy unit-test callers) or a
    // pre-serialized payload string (encrypted or plain, from syncToDrive).
    _serializeBody: function(data) {
        return typeof data === 'string' ? data : JSON.stringify(data);
    },

    _createDriveFile: function(data, callback) {
        var self = this;
        var body = this._serializeBody(data);

        this._ensureBackupFolder(function(folderId) {
            if (!folderId) {
                if (callback) callback(false, null);
                return;
            }

            // Two-step upload: 1) Create file metadata, 2) Upload content
            fetch('https://www.googleapis.com/drive/v3/files', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + self.driveAccessToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: BACKUP_FILE_NAME,
                    parents: [folderId],
                    mimeType: 'application/json'
                })
            })
            .then(function(res) { return res.json(); })
            .then(function(meta) {
                if (!meta.id) {
                    console.error('[Backup] Error creating Drive file metadata:', meta);
                    if (callback) callback(false, null);
                    return;
                }
                var fileId = meta.id;

                // Step 2: Upload content via PATCH
                fetch('https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media', {
                    method: 'PATCH',
                    headers: {
                        'Authorization': 'Bearer ' + self.driveAccessToken,
                        'Content-Type': 'application/json'
                    },
                    body: body
                })
                .then(function(res) { return res.json(); })
                .then(function(result) {
                    if (result.id) {
                        console.log('[Backup] Drive file created:', result.id);
                        if (callback) callback(true, result.id);
                    } else {
                        console.error('[Backup] Error uploading Drive file content:', result);
                        if (callback) callback(false, null);
                    }
                })
                .catch(function(err) {
                    console.error('[Backup] Error uploading Drive file:', err);
                    if (callback) callback(false, null);
                });
            })
            .catch(function(err) {
                console.error('[Backup] Error creating Drive file metadata:', err);
                if (callback) callback(false, null);
            });
        });
    },

    _updateDriveFile: function(data, callback, retried) {
        var self = this;
        var url = 'https://www.googleapis.com/upload/drive/v3/files/' + this.driveFileId + '?uploadType=media';
        var body = this._serializeBody(data);

        fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': 'Bearer ' + self.driveAccessToken,
                'Content-Type': 'application/json'
            },
            body: body
        })
        .then(function(res) {
            if (res.status === 404) {
                // File was deleted/trashed — reset id and re-create.
                self.driveFileId = null;
                self._createDriveFile(data, callback);
                return null; // stop the chain; _createDriveFile owns the callback
            }
            if (res.status === 401 || res.status === 403) {
                // Auth expired/revoked. Refresh the token once and retry.
                // Never treat this as "file deleted" — that caused duplicate
                // files to be created on every failed sync.
                if (retried) {
                    // Auth is genuinely dead — stop lying to the UI badge.
                    self.driveConnected = false;
                    self.driveAccessToken = null;
                    self.driveFileId = null;
                    self.saveDriveState();
                    if (window.showNotification) {
                        window.showNotification('DRIVE SYNC FAILED: Auth rejected — reconnect Drive');
                    }
                    if (callback) callback(false, null);
                    return null;
                }
                self.refreshDriveToken(function(ok) {
                    if (!ok) {
                        if (window.showNotification) {
                            window.showNotification('DRIVE SYNC FAILED: Auth expired — reconnect Drive');
                        }
                        if (callback) callback(false, null);
                        return;
                    }
                    self._updateDriveFile(data, callback, true);
                });
                return null; // retry path owns the callback
            }
            return res.json();
        })
        .then(function(json) {
            if (!json) return; // handled by 404/401 branches above
            if (json.id) {
                console.log('[Backup] Drive file updated:', json.id);
                if (callback) callback(true, json.id);
            } else {
                console.error('[Backup] Error updating Drive file:', json);
                if (callback) callback(false, null);
            }
        })
        .catch(function(err) {
            console.error('[Backup] Error updating Drive file:', err);
            if (callback) callback(false, null);
        });
    },

    _ensureBackupFolder: function(callback) {
        // Search for existing Vinland Backup folder
        var query = encodeURIComponent("name='" + BACKUP_FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
        var url = 'https://www.googleapis.com/drive/v3/files?q=' + query + '&fields=files(id,name)';

        var self = this;

        fetch(url, { headers: { 'Authorization': 'Bearer ' + this.driveAccessToken } })
            .then(function(res) { return res.json(); })
            .then(function(json) {
                if (json.files && json.files.length > 0) {
                    callback(json.files[0].id);
                } else {
                    // Create the folder
                    fetch('https://www.googleapis.com/drive/v3/files', {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Bearer ' + self.driveAccessToken,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            name: BACKUP_FOLDER_NAME,
                            mimeType: 'application/vnd.google-apps.folder'
                        })
                    })
                    .then(function(res) { return res.json(); })
                    .then(function(file) {
                        if (file.id) {
                            callback(file.id);
                        } else {
                            console.error('[Backup] Error creating folder:', file);
                            callback(null);
                        }
                    })
                    .catch(function(err) {
                        console.error('[Backup] Error creating folder:', err);
                        callback(null);
                    });
                }
            })
            .catch(function(err) {
                console.error('[Backup] Error finding folder:', err);
                callback(null);
            });
    },

    _getDriveFileContent: function(callback) {
        var self = this;

        if (this.driveFileId) {
            this._downloadFile(this.driveFileId, callback);
        } else {
            this._findDriveBackupFile(function(fileId, errorCode) {
                if (fileId) {
                    self.driveFileId = fileId;
                    self.saveDriveState();
                    self._downloadFile(fileId, callback);
                } else {
                    // Thread the honest error code through unchanged
                    // ('auth' | 'not_found' | 'error').
                    callback(false, null, errorCode || 'not_found');
                }
            });
        }
    },

    _downloadFile: function(fileId, callback) {
        var self = this;
        var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media';

        fetch(url, { headers: { 'Authorization': 'Bearer ' + this.driveAccessToken } })
            .then(function(res) {
                if (!res.ok) {
                    callback(false, null, self._driveErrorCode(res.status));
                    return null; // stop the chain
                }
                return res.text();
            })
            .then(function(content) {
                if (content !== null) callback(true, content);
            })
            .catch(function(err) {
                console.error('[Backup] Error downloading Drive file:', err);
                callback(false, null, 'error');
            });
    },

    _onSyncComplete: function(direction) {
        direction = direction || 'push';
        var now = new Date().toISOString();
        State.CONFIG.drive_last_sync = now;
        this.lastBackupTime = Date.now();
        State.CONFIG.last_backup_time = this.lastBackupTime;
        saveConfig();

        console.log('[Backup] Sync ' + direction + ' complete:', now);
    },

    

    saveDriveState: function() {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        chrome.storage.local.set({
            vinland_drive: {
                connected: this.driveConnected,
                fileId: this.driveFileId
            }
        });
    },

    loadDriveState: function() {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        var self = this;
        chrome.storage.local.get(['vinland_drive'], function(result) {
            if (result.vinland_drive) {
                self.driveConnected = result.vinland_drive.connected || false;
                self.driveFileId = result.vinland_drive.fileId || null;
            }
            // Re-validate a stored "connected" flag against a real cached token:
            // the OAuth access token is never persisted, so after a restart the
            // flag alone would leave the UI showing Connected while every sync
            // fails. Silently refresh (no popup); if the token is gone, mark
            // disconnected so the user is asked to reconnect.
            if (self.driveConnected) {
                self.refreshDriveToken();
            }
        });
    },

    // Silently refresh the cached OAuth token (no interactive popup).
    // Used on init to validate restored state and on 401/403 to recover.
    refreshDriveToken: function(callback) {
        var self = this;
        var hasChromeTokenApi = typeof chrome !== 'undefined' && chrome.identity && chrome.identity.getAuthToken;
        var hasWebAuthFlow = typeof chrome !== 'undefined' && chrome.identity && chrome.identity.launchWebAuthFlow;
        if (!this.driveConnected || (!hasChromeTokenApi && !hasWebAuthFlow)) {
            if (callback) callback(false);
            return;
        }
        if (!hasChromeTokenApi) {
            // Firefox/WebExtensions: re-run the implicit flow silently
            // (prompt=none fails fast when there is no valid session).
            this._launchWebAuthFlow(false, function(ok) {
                if (!ok) {
                    console.warn('[Backup] Drive token refresh failed (WebAuth)');
                    self.driveConnected = false;
                    self.driveAccessToken = null;
                    self.driveFileId = null;
                    self.saveDriveState();
                    if (callback) callback(false);
                    return;
                }
                console.log('[Backup] Drive token refreshed (WebAuth)');
                if (callback) callback(true);
            });
            return;
        }
        var scopes = this.getDriveAuthScopes().join(' ');
        chrome.identity.getAuthToken({ interactive: false, scopes: scopes }, function(token) {
            if (chrome.runtime.lastError || !token) {
                console.warn('[Backup] Drive token refresh failed:', chrome.runtime.lastError && chrome.runtime.lastError.message);
                self.driveConnected = false;
                self.driveAccessToken = null;
                self.driveFileId = null;
                self.saveDriveState();
                if (callback) callback(false);
                return;
            }
            self.driveAccessToken = token;
            console.log('[Backup] Drive token refreshed (cached)');
            if (callback) callback(true);
        });
    }
};
