import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';



const DB_NAME = 'OPERATOR_VERSIONS';
const STORE_NAME = 'versions';
const MAX_VERSIONS_PER_NOTE = 50; // Keep last 50 snapshots
const DIFF_CONTEXT_LINES = 3;     // Lines of context around changes

export const VersionHistoryManager = {
    _db: null,
    _dbPromise: null,
    _panelEl: null,
    _initialized: false,
    _activeNoteId: null,

    

    init: function() {
        if (this._initialized) return;
        this._initialized = true;
        console.log('[VersionHistory] Initialized');
        // H5: boot-time compaction — sweep orphaned/oversized version stores so
        // the history DB cannot grow unbounded (deleted notes leave keys behind
        // via deletion paths that bypass removeNote()). Fire-and-forget.
        this.prune().then(function(stats) {
            if (stats.removed > 0 || stats.trimmed > 0) {
                console.log('[VersionHistory] pruned:', JSON.stringify(stats));
            }
        }).catch(function(err) {
            console.warn('[VersionHistory] prune failed:', err);
        });
    },

    

    
    trimToMax: function(versions, max) {
        var cap = (typeof max === 'number' && max > 0) ? max : MAX_VERSIONS_PER_NOTE;
        if (!Array.isArray(versions)) return [];
        return versions.length > cap ? versions.slice(versions.length - cap) : versions;
    },

    
    prune: function() {
        var self = this;
        return this._getDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                var stats = { scanned: 0, removed: 0, trimmed: 0 };

                // Live note ids — anything not in this set is an orphan.
                var liveIds = new Set();
                (State.NOTES || []).forEach(function(n) {
                    if (n && n.id) liveIds.add(n.id);
                });

                var req = store.openCursor();
                req.onsuccess = function(e) {
                    var cursor = e.target.result;
                    if (!cursor) {
                        // Cursor exhausted — but do NOT resolve here: the queued
                        // delete/put requests may not have committed, and a tx
                        // abort would never be surfaced. Resolve in tx.oncomplete.
                        return;
                    }
                    stats.scanned++;
                    var noteId = cursor.key;
                    if (!liveIds.has(noteId)) {
                        store.delete(noteId);
                        stats.removed++;
                    } else {
                        var trimmed = self.trimToMax(cursor.value);
                        if (trimmed.length !== (cursor.value || []).length) {
                            store.put(trimmed, noteId);
                            stats.trimmed++;
                        }
                    }
                    cursor.continue();
                };
                req.onerror = function(e) {
                    reject(e);
                };
                tx.oncomplete = function() {
                    // Commit acknowledged — safe to report stats.
                    resolve(stats);
                };
                tx.onerror = function(e) {
                    reject(e);
                };
                tx.onabort = function(e) {
                    reject(e);
                };
            });
        });
    },

    

    _getDB: function() {
        if (this._dbPromise) return this._dbPromise;
        this._dbPromise = new Promise(function(resolve, reject) {
            var request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = function(e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = function(e) {
                VersionHistoryManager._db = e.target.result;
                resolve(e.target.result);
            };
            request.onerror = function(e) {
                console.error('[VersionHistory] DB error:', e);
                reject(e);
            };
        });
        return this._dbPromise;
    },

    _saveToDB: function(noteId, versions) {
        return this._getDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                store.put(versions, noteId);
                tx.oncomplete = function() { resolve(); };
                tx.onerror = function(e) { reject(e); };
            });
        });
    },

    _loadFromDB: function(noteId) {
        return this._getDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var store = tx.objectStore(STORE_NAME);
                var request = store.get(noteId);
                request.onsuccess = function() {
                    resolve(request.result || []);
                };
                request.onerror = function(e) { reject(e); };
            });
        });
    },

    _deleteFromDB: function(noteId) {
        return this._getDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                store.delete(noteId);
                tx.oncomplete = function() { resolve(); };
                tx.onerror = function(e) { reject(e); };
            });
        });
    },

    clearAll: function() {
        return this._getDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                store.clear();
                tx.oncomplete = function() { resolve(); };
                tx.onerror = function(e) { reject(e); };
            });
        });
    },

    

    
    captureSnapshot: function(noteId) {
        if (!noteId || typeof indexedDB === 'undefined') return;

        var note = State.NOTES.find(function(n) { return n.id === noteId; });
        if (!note || note.type === 'canvas') return; // Skip canvas notes

        // Build full content for the snapshot
        var content = this._getNoteContent(note);

        // Load existing versions
        var self = this;
        this._loadFromDB(noteId).then(function(versions) {
            // Check if content actually changed from last snapshot
            if (versions.length > 0) {
                var lastSnapshot = versions[versions.length - 1];
                if (lastSnapshot.content === content) {
                    return; // No change, skip
                }
            }

            // Create new snapshot
            var snapshot = {
                id: 'v_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
                timestamp: Date.now(),
                title: note.title || 'Untitled',
                content: content,
                blocks: note.blocks ? JSON.parse(JSON.stringify(note.blocks)) : null,
                message: self._generateMessage(versions, content)
            };

            versions.push(snapshot);

            // Trim to max versions (keep the newest MAX_VERSIONS_PER_NOTE)
            versions = self.trimToMax(versions);

            // Persist and update UI
            self._saveToDB(noteId, versions).then(function() {
                // Update version panel if this note is currently active
                if (self._activeNoteId === noteId) {
                    self.renderPanel(noteId);
                }
            }).catch(function(err) {
                console.warn('[VersionHistory] Failed to save snapshot:', err);
            });
        }).catch(function(err) {
            console.warn('[VersionHistory] Failed to load versions for capture:', err);
        });
    },

    
    _getNoteContent: function(note) {
        var content = note.content || '';
        if ((!content || !content.trim()) && note.blocks && note.blocks.length > 0) {
            content = note.blocks.map(function(b) { return b.content || ''; }).join('\n');
        }
        return content;
    },

    
    _generateMessage: function(versions, newContent) {
        if (versions.length === 0) {
            return 'Initial version';
        }

        var lastSnapshot = versions[versions.length - 1];
        var oldContent = lastSnapshot.content || '';
        var oldLines = oldContent.split('\n');
        var newLines = newContent.split('\n');

        // Count changes
        var added = 0, removed = 0;
        var minLen = Math.min(oldLines.length, newLines.length);
        for (var i = 0; i < minLen; i++) {
            if (oldLines[i] !== newLines[i]) {
                added++;
                removed++;
            }
        }
        if (newLines.length > oldLines.length) added += newLines.length - oldLines.length;
        if (oldLines.length > newLines.length) removed += oldLines.length - newLines.length;

        if (added === 0 && removed === 0) {
            return 'Content updated';
        }

        var parts = [];
        if (added > 0) parts.push('+' + added);
        if (removed > 0) parts.push('-' + removed);
        return parts.join('/') + ' lines changed';
    },

    

    
    getVersions: function(noteId) {
        if (!noteId) return Promise.resolve([]);
        var self = this;
        return this._loadFromDB(noteId).then(function(versions) {
            // Return newest-first (reverse chronological)
            return versions.slice().reverse();
        });
    },

    
    _getVersionsChronological: function(noteId) {
        if (!noteId) return Promise.resolve([]);
        return this._loadFromDB(noteId);
    },

    
    getVersion: function(noteId, versionId) {
        return this._loadFromDB(noteId).then(function(versions) {
            return versions.find(function(v) { return v.id === versionId; }) || null;
        });
    },

    

    
    rollback: function(noteId, versionId) {
        var self = this;
        return this._loadFromDB(noteId).then(function(versions) {
            var targetVersion = versions.find(function(v) { return v.id === versionId; });
            if (!targetVersion) {
                if (window.showNotification) {
                    window.showNotification('VERSION NOT FOUND', 'error');
                }
                return;
            }

            var note = State.NOTES.find(function(n) { return n.id === noteId; });
            if (!note) {
                if (window.showNotification) {
                    window.showNotification('NOTE NOT FOUND', 'error');
                }
                return;
            }

            // Capture current state as a new snapshot before rollback (undo safety)
            self.captureSnapshot(noteId);

            // Restore the note
            note.content = targetVersion.content;
            note.title = targetVersion.title;
            note.modified = Date.now();

            // Restore blocks if available
            if (targetVersion.blocks && targetVersion.blocks.length > 0) {
                note.blocks = JSON.parse(JSON.stringify(targetVersion.blocks));
            }

            // Persist (restore mutates note.blocks — mark dirty so a dirty-only
            // saveData() still writes this note back)
            if (window.markNoteDirty) window.markNoteDirty(noteId);
            saveData();

            // Re-render editor if this note is open
            if (window.Notes && window.Notes.activeNoteId === noteId) {
                // Re-open the note to refresh the editor
                window.Notes.open(noteId);
            }

            if (window.showNotification) {
                window.showNotification('ROLLED BACK // to version from ' + new Date(targetVersion.timestamp).toLocaleString());
            }
        });
    },

    

    
    computeDiff: function(oldText, newText) {
        if (!oldText && !newText) return [];
        if (!oldText) {
            return (newText || '').split('\n').map(function(line) {
                return { type: 'add', text: line };
            });
        }
        if (!newText) {
            return (oldText || '').split('\n').map(function(line) {
                return { type: 'remove', text: line };
            });
        }

        var oldLines = oldText.split('\n');
        var newLines = newText.split('\n');

        // Simple LCS-based diff (good enough for note-sized content)
        var diff = this._lcsDiff(oldLines, newLines);

        // Add context lines around changes
        return this._addContext(diff);
    },

    
    _lcsDiff: function(oldLines, newLines) {
        var result = [];
        var oldLen = oldLines.length;
        var newLen = newLines.length;

        // Build LCS table
        var lcs = [];
        for (var i = 0; i <= oldLen; i++) {
            lcs[i] = [];
            for (var j = 0; j <= newLen; j++) {
                if (i === 0 || j === 0) {
                    lcs[i][j] = 0;
                } else if (oldLines[i - 1] === newLines[j - 1]) {
                    lcs[i][j] = lcs[i - 1][j - 1] + 1;
                } else {
                    lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
                }
            }
        }

        // Backtrack to build diff
        var i = oldLen, j = newLen;
        var tempResult = [];

        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
                tempResult.unshift({ type: 'same', text: oldLines[i - 1] });
                i--;
                j--;
            } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
                tempResult.unshift({ type: 'add', text: newLines[j - 1] });
                j--;
            } else if (i > 0) {
                tempResult.unshift({ type: 'remove', text: oldLines[i - 1] });
                i--;
            }
        }

        return tempResult;
    },

    
    _addContext: function(diff) {
        var result = [];
        var contextLines = DIFF_CONTEXT_LINES;

        for (var i = 0; i < diff.length; i++) {
            if (diff[i].type !== 'same') {
                // Before: add context lines
                for (var c = 1; c <= contextLines; c++) {
                    var idx = i - c;
                    if (idx >= 0 && diff[idx].type === 'same' && diff[idx]._used !== true) {
                        diff[idx]._used = true;
                        result.push({ type: 'context', text: diff[idx].text });
                    }
                }

                result.push(diff[i]);

                // After: add context lines
                for (var c2 = 1; c2 <= contextLines; c2++) {
                    var idx2 = i + c2;
                    if (idx2 < diff.length && diff[idx2].type === 'same' && diff[idx2]._used !== true) {
                        diff[idx2]._used = true;
                        result.push({ type: 'context', text: diff[idx2].text });
                    }
                }
            }
        }

        // Clean up _used markers
        diff.forEach(function(d) { delete d._used; });

        // If no changes, show a few lines of context
        if (result.length === 0 && diff.length > 0) {
            var contextLines2 = diff.slice(0, 5);
            contextLines2.forEach(function(d) { result.push({ type: 'context', text: d.text }); });
        }

        return result;
    },

    

    
    renderPanel: function(noteId) {
        this._activeNoteId = noteId;
        var panel = this._ensurePanel();

        if (!noteId) {
            panel.classList.remove('active');
            panel.classList.add('empty');
            return;
        }

        var note = State.NOTES.find(function(n) { return n.id === noteId; });
        if (!note || note.type === 'canvas') {
            panel.classList.remove('active');
            panel.classList.add('empty');
            return;
        }

        var self = this;
        this.getVersions(noteId).then(function(versions) {
            if (!versions || versions.length === 0) {
                panel.classList.remove('active');
                panel.classList.add('empty');
                panel.innerHTML = self._emptyPanelHTML();
                return;
            }

            panel.classList.add('active');
            panel.classList.remove('empty');
            panel.innerHTML = self._renderVersionList(versions);
            self._bindVersionEvents(panel, noteId, versions);
        });
    },

    _ensurePanel: function() {
        var panel = document.getElementById('note-version-history');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'note-version-history';
            panel.className = 'note-version-history empty';

            // Insert after backlinks panel or block-editor
            var backlinks = document.getElementById('note-backlinks-panel');
            var blockEditor = document.getElementById('block-editor');
            var preview = document.getElementById('note-preview');
            var insertAfter = backlinks || preview || blockEditor;
            if (insertAfter && insertAfter.parentNode) {
                insertAfter.parentNode.insertBefore(panel, insertAfter.nextSibling);
            } else {
                document.body.appendChild(panel);
            }
        }
        this._panelEl = panel;
        return panel;
    },

    _emptyPanelHTML: function() {
        return '<div class="version-empty">' +
            '<span class="version-empty-icon">⏱</span>' +
            '<span class="version-empty-text">No version history yet. Save this note to create snapshots.</span>' +
            '</div>';
    },

    _renderVersionList: function(versions) {
        var html = '<div class="version-header">' +
            '<span>VERSION HISTORY</span>' +
            '<span class="version-count">' + versions.length + ' snapshot' + (versions.length !== 1 ? 's' : '') + '</span>' +
            '</div>';

        var self = this;
        versions.forEach(function(version) {
            var date = new Date(version.timestamp);
            var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            var timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            html += '<div class="version-item" data-version-id="' + version.id + '">' +
                '<div class="version-item-header">' +
                '<span class="version-timestamp">' + dateStr + ' ' + timeStr + '</span>' +
                '<span class="version-title-label">' + self._escapeHtml(version.title) + '</span>' +
                '</div>' +
                '<div class="version-message">' + self._escapeHtml(version.message) + '</div>' +
                '<div class="version-actions">' +
                '<button class="version-diff-btn">DIFF</button>' +
                '<button class="version-restore-btn">RESTORE</button>' +
                '</div>' +
                '</div>';
        });

        // Diff view container (hidden until a version is clicked for diff)
        html += '<div id="version-diff-view" class="version-diff-view" style="display:none"></div>';

        return html;
    },

    _bindVersionEvents: function(panel, noteId, versions) {
        var self = this;

        // Diff buttons: click to show diff between this version and previous
        panel.querySelectorAll('.version-diff-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var item = btn.closest('.version-item');
                if (!item) return;
                var versionId = item.getAttribute('data-version-id');

                // Find this version and the one before it (for diff)
                var chronoVersions = versions.slice().reverse(); // versions is newest-first
                var currentIdx = chronoVersions.findIndex(function(v) { return v.id === versionId; });

                var oldContent = '';
                var newContent = '';
                var versionLabel = '';

                if (currentIdx > 0) {
                    // Diff against previous version
                    var prevVersion = chronoVersions[currentIdx - 1];
                    oldContent = prevVersion.content || '';
                    versionLabel = 'Changes from ' + self._formatTimestamp(prevVersion.timestamp);
                }
                newContent = chronoVersions[currentIdx].content || '';
                if (!versionLabel) {
                    versionLabel = 'Initial version';
                }

                var diff = self.computeDiff(oldContent, newContent);
                self._showDiff(versionLabel, diff);
            });
        });

        // Restore buttons
        panel.querySelectorAll('.version-restore-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var item = btn.closest('.version-item');
                if (!item) return;
                var versionId = item.getAttribute('data-version-id');

                if (confirm('RESTORE THIS VERSION?\n\nThis will create a snapshot of the current state and restore the note to this version.')) {
                    self.rollback(noteId, versionId);
                }
            });
        });
    },

    _showDiff: function(label, diffLines) {
        var diffContainer = document.getElementById('version-diff-view');
        if (!diffContainer) return;

        diffContainer.style.display = 'block';

        var html = '<div class="diff-header">' +
            '<span class="diff-label">' + this._escapeHtml(label) + '</span>' +
            '<button class="diff-close-btn">×</button>' +
            '</div>' +
            '<div class="diff-content">';

        if (diffLines.length === 0) {
            html += '<div class="diff-empty">No changes</div>';
        } else {
            diffLines.forEach(function(line) {
                var cls = 'diff-line diff-line-' + line.type;
                var prefix = '';
                if (line.type === 'add') prefix = '+';
                else if (line.type === 'remove') prefix = '-';
                else if (line.type === 'context') prefix = ' ';

                html += '<div class="' + cls + '">' +
                    '<span class="diff-prefix">' + prefix + '</span>' +
                    '<span class="diff-text">' + VersionHistoryManager._escapeHtml(line.text) + '</span>' +
                    '</div>';
            });
        }

        html += '</div>';
        diffContainer.innerHTML = html;

        // Close button
        var closeBtn = diffContainer.querySelector('.diff-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                diffContainer.style.display = 'none';
            });
        }
    },

    

    
    openModal: function() {
        var noteId = this._activeNoteId;
        if (!noteId) {
            if (window.showNotification) {
                window.showNotification('NO_ACTIVE_NOTE // Open a note first');
            }
            return;
        }

        var modal = document.getElementById('version-history-modal');
        if (!modal) return;

        var self = this;
        this.getVersions(noteId).then(function(versions) {
            var content = modal.querySelector('.version-modal-content');
            if (!content) return;

            if (!versions || versions.length === 0) {
                content.innerHTML = '<div class="version-modal-empty">No version history for this note.</div>';
            } else {
                var html = '<div class="version-modal-list">';
                versions.forEach(function(version) {
                    var date = new Date(version.timestamp);
                    var dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                    var timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

                    html += '<div class="version-modal-item" data-version-id="' + version.id + '">' +
                        '<div class="version-modal-date">' + dateStr + ' at ' + timeStr + '</div>' +
                        '<div class="version-modal-message">' + self._escapeHtml(version.message) + '</div>' +
                        '<div class="version-modal-actions">' +
                        '<button class="version-modal-restore-btn">RESTORE</button>' +
                        '</div>' +
                        '</div>';
                });
                html += '</div>';
                content.innerHTML = html;

                // Bind restore buttons
                content.querySelectorAll('.version-modal-restore-btn').forEach(function(btn) {
                    btn.addEventListener('click', function(e) {
                        var item = btn.closest('.version-modal-item');
                        if (!item) return;
                        var versionId = item.getAttribute('data-version-id');
                        if (confirm('RESTORE THIS VERSION?')) {
                            self.rollback(noteId, versionId);
                            if (window.ModalManager) window.ModalManager.close('version-history-modal');
                        }
                    });
                });
            }

            if (window.ModalManager) {
                window.ModalManager.open('version-history-modal');
            }
        });
    },

    

    
    removeNote: function(noteId) {
        this._deleteFromDB(noteId).catch(function(err) {
            console.warn('[VersionHistory] Failed to delete versions:', err);
        });
        if (this._activeNoteId === noteId) {
            this._activeNoteId = null;
        }
    },

    

    _escapeHtml: function(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },

    _formatTimestamp: function(ts) {
        var date = new Date(ts);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
            ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
};
