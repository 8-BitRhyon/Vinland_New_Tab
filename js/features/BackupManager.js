import { State } from '../core/Store.js';
import { Config, saveConfig } from '../core/Config.js';
import { saveData } from '../core/Storage.js';

/* =========================================
   BACKUP MANAGER - Auto-backup + Drive Sync
   ========================================= */

const BACKUP_FOLDER_NAME = 'Vinland Backup';
const BACKUP_FILE_NAME = 'vinland-backup.json';

export const BackupManager = {
    intervalId: null,
    lastBackupTime: null,
    driveAccessToken: null,
    driveFileId: null,
    driveConnected: false,

    /* ── Lifecycle ─────────────────────────── */

    init: function() {
        // Restore Drive connection state from chrome.storage.local
        this.loadDriveState();
        // Start auto-backup timer if enabled
        this.scheduleAutoBackup();
    },

    /* ── Auto-backup Timer ─────────────────── */

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

    /* ── Build Backup Data ─────────────────── */

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

    /* ── Trigger Backup ────────────────────── */

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

    /* ── Download Backup ───────────────────── */

    downloadBackup: function() {
        var data = this.buildBackupData();
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);

        var filename = 'vinland-backup-' + new Date().toISOString().slice(0, 10) + '.json';

        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Show toast notification
        if (window.showNotification) {
            window.showNotification('BACKUP: ' + filename);
        }

        console.log('[Backup] Downloaded: ' + filename);
    },

    /* ── Google Drive Sync ─────────────────── */

    getDriveAuthScopes: function() {
        // drive.file scope: per-file access created by this app only
        return ['https://www.googleapis.com/auth/drive.file'];
    },

    connectDrive: function(callback) {
        var self = this;
        var scopes = this.getDriveAuthScopes().join(' ');

        if (typeof chrome === 'undefined' || !chrome.identity || !chrome.identity.getAuthToken) {
            if (window.showNotification) {
                window.showNotification('ERROR: chrome.identity not available (not in extension context)');
            }
            if (callback) callback(false);
            return;
        }

        // Fail fast with an actionable message when OAuth is not configured.
        // chrome.identity.getAuthToken requires an oauth2 block (with a real
        // client_id) in manifest.json — otherwise it fails with an opaque error.
        var manifest = (typeof chrome.runtime !== 'undefined' && chrome.runtime.getManifest) ? chrome.runtime.getManifest() : null;
        var oauthClientId = manifest && manifest.oauth2 && manifest.oauth2.client_id;
        if (!oauthClientId || /YOUR_OAUTH_CLIENT_ID|REPLACE_ME|CHANGE_ME/i.test(oauthClientId)) {
            console.error('[Backup] Drive auth unavailable: manifest.json has no oauth2.client_id');
            if (window.showNotification) {
                window.showNotification('ERROR: Add your OAuth client ID to manifest.json — see docs/google-drive-sync.md');
            }
            if (callback) callback(false);
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
                try {
                    var data = JSON.parse(content);
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

    /* ── Internal Drive API Methods ────────── */

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

    _createDriveFile: function(data, callback) {
        var self = this;

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
                    body: JSON.stringify(data)
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

        fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': 'Bearer ' + self.driveAccessToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
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

    /* ── Drive State Persistence ───────────── */

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
        if (!this.driveConnected || typeof chrome === 'undefined' || !chrome.identity || !chrome.identity.getAuthToken) {
            if (callback) callback(false);
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
