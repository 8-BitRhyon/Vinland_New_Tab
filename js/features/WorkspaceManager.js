/**
 * WorkspaceManager - Named Workspace Snapshots
 *
 * Captures and restores the entire Vinland layout as named snapshots:
 *   - Open tabs (TabManager)
 *   - Graph node positions
 *   - Sidebar collapsed state & expanded folders
 *   - Editor maximized state
 *   - Theme preset, primary/secondary colors
 *   - Active note ID
 *
 * CLI: `workspace save <name>`, `workspace load <name>`,
 *      `workspace delete <name>`, `workspace`
 *
 * Storage: `VINLAND_WORKSPACES` (localStorage) — { [name]: { ... snapshot } }
 */

import { State } from '../core/Store.js';

export const WorkspaceManager = {
    STORAGE_KEY: 'VINLAND_WORKSPACES',
    isOpen: false,
    workspaces: {},
    selectedIndex: 0,

    /**
     * Initialize the WorkspaceManager. Called once from boot.js
     */
    init: function () {
        this._loadWorkspaces();
        this._injectDOM();
    },

    // ─── Public API ──────────────────────────────────────────────

    /**
     * Save the current workspace state under the given name.
     * Returns { success: true } or { success: false, error: '...' }
     */
    save: function (name) {
        if (!name || !name.trim()) {
            return { success: false, error: 'Workspace name is required' };
        }
        name = name.trim();

        var snapshot = this._captureState();
        snapshot.name = name;
        snapshot.savedAt = Date.now();

        this.workspaces[name] = snapshot;
        this._persistWorkspaces();

        return { success: true };
    },

    /**
     * Load (restore) a workspace by name.
     * Saves the current state first as an auto-safety measure.
     */
    load: function (name) {
        if (!name) {
            return { success: false, error: 'Workspace name is required' };
        }
        var snapshot = this.workspaces[name];
        if (!snapshot) {
            return { success: false, error: 'Workspace "' + name + '" not found' };
        }

        // Auto-save current state before restoring
        try {
            if (window.Notes && window.Notes.save) {
                window.Notes.save();
            }
            if (typeof window.saveData === 'function') {
                window.saveData();
            }
        } catch (e) {
            console.warn('[WorkspaceManager] Auto-save before load:', e);
        }

        this._restoreState(snapshot);
        return { success: true };
    },

    /**
     * Delete a workspace by name
     */
    delete: function (name) {
        if (!name) return { success: false, error: 'Workspace name is required' };
        if (!this.workspaces[name]) {
            return { success: false, error: 'Workspace "' + name + '" not found' };
        }
        delete this.workspaces[name];
        this._persistWorkspaces();
        if (this.isOpen) this._render();
        return { success: true };
    },

    /**
     * List all workspace names with metadata
     */
    list: function () {
        var names = Object.keys(this.workspaces);
        return names.map(function (n) {
            var ws = this.workspaces[n];
            return {
                name: n,
                savedAt: ws.savedAt,
                tabCount: (ws.tabs || []).length,
                theme: ws.theme_preset || 'default'
            };
        }, this);
    },

    /**
     * Get snapshot data for a named workspace
     */
    get: function (name) {
        return this.workspaces[name] || null;
    },

    /**
     * Open the workspace browser modal
     */
    open: function () {
        if (this.isOpen) return;
        this.isOpen = true;
        this.selectedIndex = 0;

        var overlay = document.getElementById('workspace-overlay');
        var modal = document.getElementById('workspace-modal');
        if (!overlay || !modal) return;

        overlay.classList.add('active');
        modal.classList.add('active');

        this._render();
        this._bindEvents();
    },

    /**
     * Close the workspace browser modal
     */
    close: function () {
        if (!this.isOpen) return;
        this.isOpen = false;

        var overlay = document.getElementById('workspace-overlay');
        var modal = document.getElementById('workspace-modal');
        if (overlay) overlay.classList.remove('active');
        if (modal) modal.classList.remove('active');

        this._unbindEvents();
    },

    /**
     * Handle workspace CLI command
     * Format: `workspace save <name>` or `workspace load <name>`
     *         `workspace delete <name>` or `workspace` (opens browser)
     */
    handleCLI: function (args) {
        if (!args || !args.trim()) {
            this.open();
            return;
        }

        var parts = args.trim().split(/\s+/);
        var subcommand = parts[0].toLowerCase();
        var name = parts.slice(1).join(' ');

        switch (subcommand) {
            case 'save':
                if (!name) {
                    if (window.showNotification) {
                        window.showNotification('Usage: workspace save <name>', 'error');
                    }
                    return;
                }
                var result = this.save(name);
                if (result.success) {
                    if (window.showNotification) {
                        window.showNotification('Workspace "' + name + '" saved');
                    }
                } else {
                    if (window.showNotification) {
                        window.showNotification('Error: ' + result.error, 'error');
                    }
                }
                break;

            case 'load':
                if (!name) {
                    if (window.showNotification) {
                        window.showNotification('Usage: workspace load <name>', 'error');
                    }
                    return;
                }
                var result = this.load(name);
                if (result.success) {
                    if (window.showNotification) {
                        window.showNotification('Workspace "' + name + '" loaded');
                    }
                } else {
                    if (window.showNotification) {
                        window.showNotification('Error: ' + result.error, 'error');
                    }
                }
                break;

            case 'delete':
                if (!name) {
                    if (window.showNotification) {
                        window.showNotification('Usage: workspace delete <name>', 'error');
                    }
                    return;
                }
                var result = this.delete(name);
                if (result.success) {
                    if (window.showNotification) {
                        window.showNotification('Workspace "' + name + '" deleted');
                    }
                } else {
                    if (window.showNotification) {
                        window.showNotification('Error: ' + result.error, 'error');
                    }
                }
                break;

            case 'list':
                var list = this.list();
                if (list.length === 0) {
                    if (window.showNotification) {
                        window.showNotification('No workspaces saved');
                    }
                } else {
                    var msg = 'Workspaces: ' + list.map(function (w) {
                        return w.name + ' (' + w.tabCount + ' tabs)';
                    }).join(', ');
                    if (window.showNotification) {
                        window.showNotification(msg);
                    }
                }
                break;

            default:
                // Try loading a workspace by name directly
                if (this.workspaces[args.trim()]) {
                    var result = this.load(args.trim());
                    if (result.success && window.showNotification) {
                        window.showNotification('Workspace "' + args.trim() + '" loaded');
                    }
                } else {
                    this.open();
                }
                break;
        }
    },

    // ─── State Capture & Restore ────────────────────────────────

    /**
     * Capture the current application state into a snapshot object
     */
    _captureState: function () {
        var snapshot = {};

        // 1. Tabs
        if (window.TabManager) {
            snapshot.tabs = JSON.parse(JSON.stringify(window.TabManager.tabs || []));
            snapshot.activeTabIndex = window.TabManager.activeIndex;
        }

        // 2. Graph layout (node positions)
        if (window.Notes && window.Notes.graphLayout) {
            snapshot.graphLayout = JSON.parse(JSON.stringify(window.Notes.graphLayout));
        }

        // 3. Sidebar state
        var sidebar = document.querySelector('.notes-sidebar');
        snapshot.sidebarCollapsed = sidebar ? sidebar.classList.contains('collapsed') : false;

        // 4. Expanded folders
        if (window.Notes && window.Notes.expandedFolders) {
            snapshot.expandedFolders = JSON.parse(JSON.stringify(window.Notes.expandedFolders));
        }

        // 5. Editor maximized
        var editorModal = document.getElementById('note-editor-modal');
        snapshot.editorMaximized = editorModal ? editorModal.classList.contains('maximized') : false;

        // 6. Theme
        if (State && State.CONFIG) {
            snapshot.theme_preset = State.CONFIG.theme_preset || '';
            snapshot.theme_color = State.CONFIG.theme_color || '#00FF41';
            snapshot.secondary_color = State.CONFIG.secondary_color || '#888888';
            snapshot.bg_color = State.CONFIG.bg_color || '';
        }

        // 7. Active note
        if (window.Notes) {
            snapshot.activeNoteId = window.Notes.activeNoteId;
        }

        return snapshot;
    },

    /**
     * Restore application state from a snapshot
     */
    _restoreState: function (snapshot) {
        if (!snapshot) return;

        // 1. Close all modals first to avoid conflicts
        if (window.ModalManager) {
            window.ModalManager.closeAll();
        }

        // 2. Restore theme first (visual foundation)
        if (State && State.CONFIG) {
            if (snapshot.theme_preset) {
                State.CONFIG.theme_preset = snapshot.theme_preset;
            }
            if (snapshot.theme_color) {
                State.CONFIG.theme_color = snapshot.theme_color;
            }
            if (snapshot.secondary_color) {
                State.CONFIG.secondary_color = snapshot.secondary_color;
            }
            if (snapshot.bg_color) {
                State.CONFIG.bg_color = snapshot.bg_color;
            }
            if (window.Config && window.Config.applyTheme) {
                window.Config.applyTheme();
                window.Config.save(); // Persist theme across reloads
            }
        }

        // 3. Restore graph layout
        if (window.Notes && snapshot.graphLayout) {
            window.Notes.graphLayout = JSON.parse(JSON.stringify(snapshot.graphLayout));
            // Persist to localStorage immediately
            try {
                localStorage.setItem('VINLAND_GRAPH_LAYOUT', JSON.stringify(window.Notes.graphLayout));
            } catch (e) {
                console.warn('[WorkspaceManager] Failed to persist graph layout:', e);
            }
        }

        // 4. Restore sidebar collapsed state
        if (snapshot.sidebarCollapsed !== undefined) {
            var sidebar = document.querySelector('.notes-sidebar');
            if (sidebar) {
                sidebar.classList.toggle('collapsed', snapshot.sidebarCollapsed);
                localStorage.setItem('VINLAND_SIDEBAR_COLLAPSED', snapshot.sidebarCollapsed ? '1' : '0');
            }
        }

        // 5. Restore expanded folders
        if (window.Notes && snapshot.expandedFolders) {
            window.Notes.expandedFolders = JSON.parse(JSON.stringify(snapshot.expandedFolders));
            try {
                localStorage.setItem('OPERATOR_EXPANDED_FOLDERS', JSON.stringify(window.Notes.expandedFolders));
            } catch (e) {
                console.warn('[WorkspaceManager] Failed to persist expanded folders:', e);
            }
        }

        // 6. Restore maximized state
        if (snapshot.editorMaximized !== undefined) {
            var editorModal = document.getElementById('note-editor-modal');
            if (editorModal) {
                editorModal.classList.toggle('maximized', snapshot.editorMaximized);
                localStorage.setItem('VINLAND_NOTES_MAXIMIZED', snapshot.editorMaximized ? 'true' : 'false');
            }
            if (window.Notes && window.Notes.updateGlobalIconsVisibility) {
                window.Notes.updateGlobalIconsVisibility(!snapshot.editorMaximized);
            }
        }

        // 7. Restore tabs
        if (window.TabManager && snapshot.tabs) {
            // Clear existing tabs
            window.TabManager.tabs = [];
            window.TabManager.activeIndex = -1;

            // Rebuild tabs from snapshot
            snapshot.tabs.forEach(function (tab) {
                var note = State.NOTES.find(function (n) {
                    return n.id === tab.noteId;
                });
                if (note) {
                    window.TabManager.tabs.push({
                        noteId: tab.noteId,
                        title: note.title || tab.title || 'Untitled'
                    });
                }
            });

            window.TabManager.activeIndex = snapshot.activeTabIndex >= 0 &&
                snapshot.activeTabIndex < window.TabManager.tabs.length
                ? snapshot.activeTabIndex
                : (window.TabManager.tabs.length > 0 ? 0 : -1);

            window.TabManager.save();
            window.TabManager.render();
        }

        // 8. Open the active note
        if (window.Notes) {
            var activeId = snapshot.activeNoteId;
            if (activeId) {
                var noteExists = State.NOTES.some(function (n) { return n.id === activeId; });
                if (noteExists) {
                    window.Notes.open(activeId);
                } else if (window.TabManager && window.TabManager.tabs.length > 0) {
                    // Fall back to first tab
                    window.Notes.open(window.TabManager.tabs[0].noteId);
                }
            } else if (window.TabManager && window.TabManager.tabs.length > 0) {
                window.Notes.open(window.TabManager.tabs[0].noteId);
            }
        }

        // 9. Re-render sidebar
        if (window.Notes && window.Notes.renderSidebar) {
            window.Notes.renderSidebar();
        }
        if (window.Notes && window.Notes.renderNotes) {
            window.Notes.renderNotes();
        }

        // 10. Save the restored state
        if (typeof window.saveData === 'function') {
            window.saveData();
        }

        console.log('[WorkspaceManager] Restored workspace:', snapshot.name);
    },

    // ─── Persistence ─────────────────────────────────────────────

    /**
     * Load workspaces from localStorage
     */
    _loadWorkspaces: function () {
        try {
            var stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                this.workspaces = JSON.parse(stored);
            } else {
                this.workspaces = {};
            }
        } catch (e) {
            console.warn('[WorkspaceManager] Failed to load workspaces:', e);
            this.workspaces = {};
        }
    },

    /**
     * Persist workspaces to localStorage
     */
    _persistWorkspaces: function () {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.workspaces));
        } catch (e) {
            console.warn('[WorkspaceManager] Failed to persist workspaces:', e);
        }
    },

    // ─── DOM Injection ───────────────────────────────────────────

    /**
     * Inject workspace browser modal DOM elements on first init
     */
    _injectDOM: function () {
        if (document.getElementById('workspace-overlay')) return;

        // Overlay backdrop
        var overlay = document.createElement('div');
        overlay.id = 'workspace-overlay';
        overlay.className = 'workspace-overlay';
        overlay.onclick = this.close.bind(this);
        document.body.appendChild(overlay);

        // Main modal
        var modal = document.createElement('div');
        modal.id = 'workspace-modal';
        modal.className = 'workspace-modal';

        var html =
            // Header
            '<div class="workspace-header">' +
                '<span class="workspace-title">\uD83D\uDCC2  WORKSPACES</span>' +
                '<button class="workspace-close-btn" id="workspace-close-btn">&times;</button>' +
            '</div>' +
            // Save section
            '<div class="workspace-save-section">' +
                '<input type="text" id="workspace-save-input" class="workspace-save-input" ' +
                    'placeholder="Save current state as..." />' +
                '<button class="workspace-save-btn" id="workspace-save-btn">SAVE</button>' +
            '</div>' +
            // List
            '<div class="workspace-list" id="workspace-list">' +
                '<div class="workspace-empty">No workspaces saved yet.<br/>Use <kbd>workspace save &lt;name&gt;</kbd> to create one.</div>' +
            '</div>' +
            // Footer
            '<div class="workspace-footer">' +
                '<span class="workspace-footer-hint">' +
                    '<kbd>\u2191</kbd><kbd>\u2193</kbd> navigate  ' +
                    '<kbd>\u23CE</kbd> load  ' +
                    '<kbd>s</kbd> save  ' +
                    '<kbd>Del</kbd> delete  ' +
                    '<kbd>Esc</kbd> close' +
                '</span>' +
            '</div>';

        modal.innerHTML = html;
        document.body.appendChild(modal);

        // Bind static button handlers
        var self = this;
        document.getElementById('workspace-close-btn').onclick = function () {
            self.close();
        };
        document.getElementById('workspace-save-btn').onclick = function () {
            var input = document.getElementById('workspace-save-input');
            if (input && input.value.trim()) {
                self.save(input.value.trim());
                input.value = '';
                self._render();
            }
        };
        document.getElementById('workspace-save-input').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('workspace-save-btn').click();
            }
        });
    },

    /**
     * Render the workspace list in the modal
     */
    _render: function () {
        var listEl = document.getElementById('workspace-list');
        if (!listEl) return;

        var names = Object.keys(this.workspaces);
        if (names.length === 0) {
            listEl.innerHTML = '<div class="workspace-empty">No workspaces saved yet.<br/>Use <kbd>workspace save &lt;name&gt;</kbd> to create one.</div>';
            return;
        }

        listEl.innerHTML = '';

        var self = this;
        names.sort().forEach(function (name, idx) {
            var ws = self.workspaces[name];
            var item = document.createElement('div');
            item.className = 'workspace-item' + (idx === self.selectedIndex ? ' selected' : '');
            item.setAttribute('data-workspace-index', idx);

            // Name and metadata
            var nameEl = document.createElement('div');
            nameEl.className = 'workspace-item-name';
            nameEl.textContent = name;

            var metaEl = document.createElement('div');
            metaEl.className = 'workspace-item-meta';
            var tabCount = (ws.tabs || []).length;
            var themeLabel = ws.theme_preset || 'default';
            var dateStr = ws.savedAt ? new Date(ws.savedAt).toLocaleDateString() : 'unknown';
            metaEl.textContent = tabCount + ' tab' + (tabCount !== 1 ? 's' : '') +
                '  \u00B7  ' + themeLabel +
                '  \u00B7  ' + dateStr;

            // Action buttons
            var actionsEl = document.createElement('div');
            actionsEl.className = 'workspace-item-actions';

            var loadBtn = document.createElement('button');
            loadBtn.className = 'workspace-action-btn workspace-load-btn';
            loadBtn.textContent = 'LOAD';
            loadBtn.onclick = function (e) {
                e.stopPropagation();
                self.load(name);
                self.close();
            };

            var delBtn = document.createElement('button');
            delBtn.className = 'workspace-action-btn workspace-del-btn';
            delBtn.textContent = 'DEL';
            delBtn.onclick = function (e) {
                e.stopPropagation();
                self.delete(name);
            };

            actionsEl.appendChild(loadBtn);
            actionsEl.appendChild(delBtn);

            item.appendChild(nameEl);
            item.appendChild(metaEl);
            item.appendChild(actionsEl);

            // Click to load
            item.onclick = function () {
                self.selectedIndex = idx;
                self.load(name);
                self.close();
            };

            // Hover
            item.onmouseenter = function () {
                self.selectedIndex = idx;
                self._updateSelection();
            };

            listEl.appendChild(item);
        });

        this._updateSelection();
    },

    /**
     * Update visual selection in the workspace list
     */
    _updateSelection: function () {
        var items = document.querySelectorAll('#workspace-list .workspace-item');
        items.forEach(function (el, idx) {
            var itemIdx = parseInt(el.getAttribute('data-workspace-index'), 10);
            el.classList.toggle('selected', itemIdx === this.selectedIndex);
            if (itemIdx === this.selectedIndex) {
                el.scrollIntoView({ block: 'nearest' });
            }
        }, this);
    },

    // ─── Event Binding ───────────────────────────────────────────

    /**
     * Bind keyboard event listeners for the workspace modal
     */
    _bindEvents: function () {
        this._boundKeyHandler = this._onKeyDown.bind(this);
        document.addEventListener('keydown', this._boundKeyHandler);
    },

    /**
     * Unbind keyboard event listeners
     */
    _unbindEvents: function () {
        if (this._boundKeyHandler) {
            document.removeEventListener('keydown', this._boundKeyHandler);
            this._boundKeyHandler = null;
        }
    },

    /**
     * Handle keyboard navigation in the workspace modal
     */
    _onKeyDown: function (e) {
        if (!this.isOpen) return;

        var names = Object.keys(this.workspaces);
        var namesLen = names.length;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.selectedIndex = Math.min(this.selectedIndex + 1, namesLen - 1);
                this._render();
                break;

            case 'ArrowUp':
                e.preventDefault();
                this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
                this._render();
                break;

            case 'Enter':
                e.preventDefault();
                if (names[this.selectedIndex]) {
                    this.load(names[this.selectedIndex]);
                    this.close();
                }
                break;

            case 's':
                // Focus the save input
                if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    var input = document.getElementById('workspace-save-input');
                    if (input) input.focus();
                }
                break;

            case 'Delete':
            case 'Backspace':
                if (e.target.tagName === 'INPUT') break; // Don't delete while typing
                e.preventDefault();
                if (names[this.selectedIndex]) {
                    this.delete(names[this.selectedIndex]);
                }
                break;

            case 'Escape':
                e.preventDefault();
                this.close();
                break;
        }
    }
};

// Expose globally for CLI commands and HTML handlers
window.WorkspaceManager = WorkspaceManager;
