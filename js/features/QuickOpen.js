/**
 * QuickOpen - Full-Text Search & Quick Navigation
 *
 * A VS Code-inspired quick-open palette (Cmd+P) that searches notes, tags,
 * and commands in one unified interface.
 *
 * Opens on:
 *   - Cmd+P / Ctrl+P keyboard shortcut
 *   - `find <query>` CLI command
 *   - `search <query>` CLI command (alias)
 *
 * Architecture:
 *   - Searches note titles, content, tags, and CommandRegistry commands
 *   - Uses MetadataCache for fast tag/backlink lookups
 *   - Debounced at 150ms to handle large note collections
 *   - Results grouped into Notes / Tags / Commands sections
 *   - Keyboard navigable with arrow keys + Enter
 */

import { State } from '../core/Store.js';
import { MetadataCache } from '../core/MetadataCache.js';
import { CommandRegistry } from '../core/CommandRegistry.js';

export const QuickOpen = {
    isOpen: false,
    selectedIndex: 0,
    results: [],
    currentQuery: '',
    debounceTimer: null,
    searchMode: false, // true = Cmd+Shift+F (content search), false = Cmd+P (quick navigate)
    sections: [], // ['notes', 'tags', 'commands'] - tracks section boundaries for keyboard nav

    /**
     * Initialize QuickOpen. Called once from boot.js
     */
    init: function () {
        this._injectDOM();
    },

    /**
     * Toggle QuickOpen open/close
     */
    toggle: function () {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    },

    /**
     * Open the QuickOpen palette
     * @param {boolean} searchMode - If true, opens in content-search mode (Cmd+Shift+F)
     *   with an empty search prompt instead of showing recent notes + commands.
     */
    open: function (searchMode) {
        if (this.isOpen) return;
        this.isOpen = true;
        this.searchMode = searchMode === true;
        this.selectedIndex = 0;
        this.results = [];
        this.currentQuery = '';

        var overlay = document.getElementById('quick-open-overlay');
        var palette = document.getElementById('quick-open-palette');
        var input = document.getElementById('quick-open-input');
        var results = document.getElementById('quick-open-results');
        var footer = document.getElementById('quick-open-footer');

        if (!overlay || !palette) return;

        overlay.classList.add('active');
        palette.classList.add('active');

        // Reset state
        if (results) results.innerHTML = '';
        if (footer) footer.textContent = 'Type to search...';
        if (input) {
            input.placeholder = this.searchMode
                ? 'Search notes by content...'
                : 'Search notes, tags, and commands...';
            input.value = '';
            input.focus();
        }

        // Show initial state based on mode
        if (this.searchMode) {
            // Content-search mode: show a search prompt instead of recent notes+commands
            this._showSearchPrompt();
        } else {
            // Quick-navigate mode: recent notes + all commands
            this._showInitialResults();
        }

        // Bind keyboard events
        this._bindEvents();
    },

    /**
     * Close the QuickOpen palette
     */
    close: function () {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.searchMode = false;

        var overlay = document.getElementById('quick-open-overlay');
        var palette = document.getElementById('quick-open-palette');

        if (overlay) overlay.classList.remove('active');
        if (palette) palette.classList.remove('active');

        this._unbindEvents();
        this.results = [];
        this.selectedIndex = 0;
        this.currentQuery = '';
        this.sections = [];
    },

    /**
     * Perform a search from the CLI command (e.g. `find query`)
     * Opens in search mode so clearing the input shows the search prompt.
     */
    searchFromCLI: function (query) {
        if (!query || !query.trim()) {
            this.open(true);
            return;
        }
        this.open(true);
        var input = document.getElementById('quick-open-input');
        if (input) {
            input.value = query;
            this._onInput();
        }
    },

    // ─── Private Methods ─────────────────────────────────────────

    /**
     * Inject QuickOpen DOM elements on first init
     */
    _injectDOM: function () {
        if (document.getElementById('quick-open-overlay')) return;

        // Overlay backdrop
        var overlay = document.createElement('div');
        overlay.id = 'quick-open-overlay';
        overlay.className = 'quick-open-overlay';
        overlay.onclick = this.close.bind(this);
        document.body.appendChild(overlay);

        // Main palette container
        var palette = document.createElement('div');
        palette.id = 'quick-open-palette';
        palette.className = 'quick-open-palette';

        // Header with search input
        var header = document.createElement('div');
        header.className = 'quick-open-header';

        var icon = document.createElement('span');
        icon.className = 'quick-open-icon';
        icon.textContent = '\u2318'; // Command symbol (⌘)
        header.appendChild(icon);

        var input = document.createElement('input');
        input.id = 'quick-open-input';
        input.type = 'text';
        input.placeholder = 'Search notes, tags, and commands...';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.addEventListener('input', this._onInput.bind(this));
        header.appendChild(input);

        palette.appendChild(header);

        // Results container
        var results = document.createElement('div');
        results.id = 'quick-open-results';
        results.className = 'quick-open-results';
        palette.appendChild(results);

        // Footer
        var footer = document.createElement('div');
        footer.id = 'quick-open-footer';
        footer.className = 'quick-open-footer';
        footer.innerHTML = '<span class="qo-footer-hint"><kbd>\u2191</kbd><kbd>\u2193</kbd> navigate  <kbd>\u23CE</kbd> open  <kbd>Esc</kbd> close</span><span class="qo-footer-count" id="qo-footer-count"></span>';
        palette.appendChild(footer);

        document.body.appendChild(palette);
    },

    /**
     * Show a search prompt in content-search mode (Cmd+Shift+F)
     * Guides the user to start typing rather than showing recent notes + commands.
     */
    _showSearchPrompt: function () {
        var container = document.getElementById('quick-open-results');
        var footer = document.getElementById('qo-footer-count');
        if (!container) return;

        container.innerHTML = '';
        this.results = [];
        this.sections = [];

        var prompt = document.createElement('div');
        prompt.className = 'qo-result-empty';
        prompt.innerHTML = '<span class="qo-search-prompt">' +
            '\uD83D\uDD0D  Type to search note titles, content, tags, and commands' +
            '</span>';
        container.appendChild(prompt);

        if (footer) footer.textContent = 'Press \u2191\u2193 to navigate, \u23CE to open';
    },

    /**
     * Show initial state - recent notes + all commands
     */
    _showInitialResults: function () {
        var results = [];

        // Recent notes (last 5 modified)
        var activeNotes = (State.NOTES || []).filter(function (n) {
            return !n.path || n.path.indexOf('/.trash') !== 0;
        });
        var recent = activeNotes.slice().sort(function (a, b) {
            return (b.modified || b.created || 0) - (a.modified || a.created || 0);
        }).slice(0, 5);

        recent.forEach(function (note) {
            var meta = MetadataCache.get(note.id);
            results.push({
                type: 'note',
                id: note.id,
                title: note.title || 'Untitled',
                path: note.path || '/',
                excerpt: null,
                score: 0,
                recent: true,
                modified: note.modified || note.created || null
            });
        });

        // All commands
        CommandRegistry.commands.forEach(function (cmd) {
            results.push({
                type: 'command',
                id: cmd.id,
                trigger: cmd.trigger,
                title: cmd.title,
                hint: cmd.hint,
                score: 0,
                recent: false
            });
        });

        this.results = results;
        this.selectedIndex = 0;
        this._render();
    },

    /**
     * Handle input changes (debounced)
     */
    _onInput: function () {
        var self = this;
        var input = document.getElementById('quick-open-input');
        if (!input) return;

        var query = input.value.trim();

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        if (!query) {
            this.currentQuery = '';
            if (this.searchMode) {
                // In search mode, show the search prompt instead of recent notes
                this._showSearchPrompt();
            } else {
                this._showInitialResults();
            }
            return;
        }

        this.debounceTimer = setTimeout(function () {
            self._executeSearch(query);
        }, 150);
    },

    /**
     * Execute the full search across notes, tags, and commands
     */
    _executeSearch: function (query) {
        this.currentQuery = query;
        var q = query.toLowerCase();
        var results = [];
        var seenIds = new Set();

        // ─── 1. Search Notes ─────────────────────────────────────
        var activeNotes = (State.NOTES || []).filter(function (n) {
            return !n.path || n.path.indexOf('/.trash') !== 0;
        });

        activeNotes.forEach(function (note) {
            if (seenIds.has(note.id)) return;
            var title = (note.title || '').toLowerCase();
            var content = (note.content || '');
            var blocksContent = '';
            if (note.blocks && note.blocks.length > 0) {
                blocksContent = note.blocks.map(function (b) { return b.content || ''; }).join('\n');
            }
            var fullContent = content || blocksContent;
            var fullContentLower = fullContent.toLowerCase();

            var score = 0;
            var excerpt = null;

            // Title starts with query (highest)
            if (title.indexOf(q) === 0) {
                score = 100;
            }
            // Title contains query
            else if (title.indexOf(q) > 0) {
                score = 80;
            }
            // Content contains query
            else if (fullContentLower.indexOf(q) >= 0) {
                score = 50;
                // Find the matching line for excerpt
                var lines = fullContent.split('\n');
                for (var i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().indexOf(q) >= 0) {
                        var line = lines[i].trim();
                        // Truncate to 80 chars with ellipsis
                        if (line.length > 80) {
                            var matchIdx = line.toLowerCase().indexOf(q);
                            var start = Math.max(0, matchIdx - 30);
                            line = (start > 0 ? '...' : '') +
                                line.substring(start, start + 80) +
                                (line.length > start + 80 ? '...' : '');
                        }
                        excerpt = line;
                        break;
                    }
                }
            }

            // Tag match (bonus)
            var meta = MetadataCache.get(note.id);
            if (meta && meta.tags) {
                for (var t = 0; t < meta.tags.length; t++) {
                    if (meta.tags[t].indexOf(q) >= 0) {
                        score = Math.max(score, 70);
                        break;
                    }
                }
            }

            if (score > 0) {
                seenIds.add(note.id);
            results.push({
                type: 'note',
                id: note.id,
                title: note.title || 'Untitled',
                path: note.path || '/',
                excerpt: excerpt,
                score: score,
                recent: false,
                modified: note.modified || note.created || null
            });
        }

            // ─── 1b. Search Canvas Nodes within this note ───────────
            if (note.canvasData && note.canvasData.nodes && note.canvasData.nodes.length > 0) {
                note.canvasData.nodes.forEach(function(canvasNode) {
                    var cnTitle = (canvasNode.title || '').toLowerCase();
                    var cnPreview = (canvasNode.preview || '').toLowerCase();
                    var cnCombined = cnTitle + ' ' + cnPreview;

                    if (cnCombined.indexOf(q) >= 0) {
                        var cnScore = 0;
                        var cnExcerpt = null;

                        if (cnTitle.indexOf(q) === 0) cnScore = 70;
                        else if (cnTitle.indexOf(q) > 0) cnScore = 55;
                        else {
                            cnScore = 40;
                            // Find matching line for preview excerpt
                            var lines = (canvasNode.preview || '').split('\n');
                            for (var li = 0; li < lines.length; li++) {
                                if (lines[li].toLowerCase().indexOf(q) >= 0) {
                                    var line = lines[li].trim();
                                    if (line.length > 80) {
                                        var matchIdx = line.toLowerCase().indexOf(q);
                                        var start = Math.max(0, matchIdx - 30);
                                        line = (start > 0 ? '...' : '') + line.substring(start, start + 80) + (line.length > start + 80 ? '...' : '');
                                    }
                                    cnExcerpt = line;
                                    break;
                                }
                            }
                        }

                        results.push({
                            type: 'canvas-node',
                            noteId: note.id,
                            nodeId: canvasNode.id,
                            title: canvasNode.title || 'Untitled',
                            path: note.title || 'Untitled',
                            excerpt: cnExcerpt || null,
                            score: cnScore,
                            recent: false
                        });
                    }
                });
            }
        });

        // ─── 2. Search Tags ──────────────────────────────────────
        var allTags = MetadataCache.getAllTags();
        if (allTags && typeof allTags === 'object') {
            Object.keys(allTags).forEach(function (tag) {
                if (tag.indexOf(q) >= 0) {
                    results.push({
                        type: 'tag',
                        name: '#' + tag,
                        count: allTags[tag],
                        score: 30
                    });
                }
            });
        }

        // ─── 3. Search Commands ──────────────────────────────────
        var cmdResults = CommandRegistry.search(query);
        cmdResults.forEach(function (cmd) {
            // Deduplicate by id
            var alreadyAdded = results.some(function (r) {
                return r.type === 'command' && r.id === cmd.id;
            });
            if (!alreadyAdded) {
                results.push({
                    type: 'command',
                    id: cmd.id,
                    trigger: cmd.trigger,
                    title: cmd.title,
                    hint: cmd.hint,
                    score: 20
                });
            }
        });

        // Sort by score descending, then by title alphabetically for notes
        results.sort(function (a, b) {
            if (b.score !== a.score) return b.score - a.score;
            if (a.type === 'note' && b.type === 'note') {
                return (a.title || '').localeCompare(b.title || '');
            }
            return 0;
        });

        // Limit to 25 results total
        this.results = results.slice(0, 25);
        this.selectedIndex = 0;
        this._render();
    },

    /**
     * Render search results into the DOM
     */
    _render: function () {
        var container = document.getElementById('quick-open-results');
        var footer = document.getElementById('qo-footer-count');
        if (!container) return;

        container.innerHTML = '';
        this.sections = [];

        var results = this.results;
        if (results.length === 0) {
            container.innerHTML =
                '<div class="qo-result-empty">' +
                'No results found for <strong>' +
                this._escapeHtml(this.currentQuery || '') +
                '</strong>' +
                '</div>';
            if (footer) footer.textContent = '0 results';
            return;
        }

        // Track section boundaries for keyboard navigation
        var notesCount = 0;
        var tagsCount = 0;
        var commandsCount = 0;
        var currentIndex = 0;

        // ─── Notes Section ───────────────────────────────────────
        var noteResults = results.filter(function (r) { return r.type === 'note'; });
        if (noteResults.length > 0) {
            this.sections.push({ type: 'notes', start: currentIndex, count: noteResults.length });
            currentIndex += noteResults.length;
            notesCount = noteResults.length;

            var noteHeader = document.createElement('div');
            noteHeader.className = 'qo-section-header';
            noteHeader.textContent = '\uD83D\uDCDD  NOTES (' + noteResults.length + ')';
            container.appendChild(noteHeader);

            var self = this;
            noteResults.forEach(function (result, idx) {
                var el = document.createElement('div');
                el.className = 'qo-result' + (self.selectedIndex === self._getAbsoluteIndex(idx, 'notes') ? ' selected' : '');
                el.setAttribute('data-result-index', self._getAbsoluteIndex(idx, 'notes'));

                // Icon
                var icon = document.createElement('span');
                icon.className = 'qo-result-icon';
                icon.textContent = result.recent ? '\u23F0' : '\uD83D\uDCC4'; // Hourglass or page
                el.appendChild(icon);

                // Body
                var body = document.createElement('div');
                body.className = 'qo-result-body';

                var title = document.createElement('div');
                title.className = 'qo-result-title';
                title.textContent = result.title;
                body.appendChild(title);

                var meta = document.createElement('div');
                meta.className = 'qo-result-meta';
                var metaText = result.path || '/';
                if (result.modified) {
                    metaText += ' \u00B7 ' + self._formatDate(result.modified);
                }
                meta.textContent = metaText;
                body.appendChild(meta);

                if (result.excerpt) {
                    var excerpt = document.createElement('div');
                    excerpt.className = 'qo-result-excerpt';
                    excerpt.textContent = result.excerpt;
                    body.appendChild(excerpt);
                }

                el.appendChild(body);

                // Click handler
                el.onclick = function () {
                    self._activateResult(self._getAbsoluteIndex(idx, 'notes'));
                };

                // Mouse hover
                el.onmouseenter = function () {
                    self.selectedIndex = self._getAbsoluteIndex(idx, 'notes');
                    self._updateSelection();
                };

                container.appendChild(el);
            });
        }

        // ─── Canvas Nodes Section ──────────────────────────────────
        var canvasResults = results.filter(function (r) { return r.type === 'canvas-node'; });
        if (canvasResults.length > 0) {
            this.sections.push({ type: 'canvas-nodes', start: currentIndex, count: canvasResults.length });
            currentIndex += canvasResults.length;

            var cnHeader = document.createElement('div');
            cnHeader.className = 'qo-section-header';
            cnHeader.textContent = '\u2B21  CANVAS (' + canvasResults.length + ')';
            container.appendChild(cnHeader);

            var self = this;
            canvasResults.forEach(function (result, idx) {
                var el = document.createElement('div');
                el.className = 'qo-result' + (self.selectedIndex === self._getAbsoluteIndex(idx, 'canvas-nodes') ? ' selected' : '');
                el.setAttribute('data-result-index', self._getAbsoluteIndex(idx, 'canvas-nodes'));

                var icon = document.createElement('span');
                icon.className = 'qo-result-icon';
                icon.textContent = '\u2B21';
                el.appendChild(icon);

                var body = document.createElement('div');
                body.className = 'qo-result-body';

                var title = document.createElement('div');
                title.className = 'qo-result-title';
                title.textContent = result.title;
                body.appendChild(title);

                var meta = document.createElement('div');
                meta.className = 'qo-result-meta';
                meta.textContent = 'in ' + result.path;
                body.appendChild(meta);

                if (result.excerpt) {
                    var excerpt = document.createElement('div');
                    excerpt.className = 'qo-result-excerpt';
                    excerpt.textContent = result.excerpt;
                    body.appendChild(excerpt);
                }

                el.appendChild(body);

                el.onclick = function () {
                    self._activateResult(self._getAbsoluteIndex(idx, 'canvas-nodes'));
                };
                el.onmouseenter = function () {
                    self.selectedIndex = self._getAbsoluteIndex(idx, 'canvas-nodes');
                    self._updateSelection();
                };

                container.appendChild(el);
            });
        }

        // ─── Tags Section ─────────────────────────────────────────
        var tagResults = results.filter(function (r) { return r.type === 'tag'; });
        if (tagResults.length > 0) {
            this.sections.push({ type: 'tags', start: currentIndex, count: tagResults.length });
            currentIndex += tagResults.length;
            tagsCount = tagResults.length;

            var tagHeader = document.createElement('div');
            tagHeader.className = 'qo-section-header';
            tagHeader.textContent = '\uD83C\uDFF7  TAGS (' + tagResults.length + ')';
            container.appendChild(tagHeader);

            var self = this;
            tagResults.forEach(function (result, idx) {
                var el = document.createElement('div');
                el.className = 'qo-result' + (self.selectedIndex === self._getAbsoluteIndex(idx, 'tags') ? ' selected' : '');
                el.setAttribute('data-result-index', self._getAbsoluteIndex(idx, 'tags'));

                var icon = document.createElement('span');
                icon.className = 'qo-result-icon';
                icon.textContent = '#';
                el.appendChild(icon);

                var body = document.createElement('div');
                body.className = 'qo-result-body';

                var title = document.createElement('div');
                title.className = 'qo-result-title';
                title.textContent = result.name;
                body.appendChild(title);

                var meta = document.createElement('div');
                meta.className = 'qo-result-meta';
                meta.textContent = result.count + ' note' + (result.count !== 1 ? 's' : '');
                body.appendChild(meta);

                el.appendChild(body);

                el.onclick = function () {
                    self._activateResult(self._getAbsoluteIndex(idx, 'tags'));
                };
                el.onmouseenter = function () {
                    self.selectedIndex = self._getAbsoluteIndex(idx, 'tags');
                    self._updateSelection();
                };

                container.appendChild(el);
            });
        }

        // ─── Commands Section ─────────────────────────────────────
        var cmdResults = results.filter(function (r) { return r.type === 'command'; });
        if (cmdResults.length > 0) {
            this.sections.push({ type: 'commands', start: currentIndex, count: cmdResults.length });
            currentIndex += cmdResults.length;
            commandsCount = cmdResults.length;

            var cmdHeader = document.createElement('div');
            cmdHeader.className = 'qo-section-header';
            cmdHeader.textContent = '\u2328  COMMANDS (' + cmdResults.length + ')';
            container.appendChild(cmdHeader);

            var self = this;
            cmdResults.forEach(function (result, idx) {
                var el = document.createElement('div');
                el.className = 'qo-result' + (self.selectedIndex === self._getAbsoluteIndex(idx, 'commands') ? ' selected' : '');
                el.setAttribute('data-result-index', self._getAbsoluteIndex(idx, 'commands'));

                var icon = document.createElement('span');
                icon.className = 'qo-result-icon';
                icon.textContent = '\u003E';
                el.appendChild(icon);

                var body = document.createElement('div');
                body.className = 'qo-result-body';

                var title = document.createElement('div');
                title.className = 'qo-result-title';
                title.textContent = result.trigger + (result.hint ? ' ' + result.hint : '');
                body.appendChild(title);

                var meta = document.createElement('div');
                meta.className = 'qo-result-meta';
                meta.textContent = result.title;
                body.appendChild(meta);

                el.appendChild(body);

                el.onclick = function () {
                    self._activateResult(self._getAbsoluteIndex(idx, 'commands'));
                };
                el.onmouseenter = function () {
                    self.selectedIndex = self._getAbsoluteIndex(idx, 'commands');
                    self._updateSelection();
                };

                container.appendChild(el);
            });
        }

        // Update footer with count
        if (footer) {
            footer.textContent = results.length + ' result' + (results.length !== 1 ? 's' : '');
        }
    },

    /**
     * Get the absolute index for a result in a section
     */
    _getAbsoluteIndex: function (relativeIdx, sectionType) {
        var offset = 0;
        for (var i = 0; i < this.sections.length; i++) {
            if (this.sections[i].type === sectionType) {
                return this.sections[i].start + relativeIdx;
            }
            offset += this.sections[i].count;
        }
        return relativeIdx;
    },

    /**
     * Update the visual selection state
     */
    _updateSelection: function () {
        var items = document.querySelectorAll('#quick-open-results .qo-result');
        items.forEach(function (el, idx) {
            var resultIdx = parseInt(el.getAttribute('data-result-index'), 10);
            el.classList.toggle('selected', resultIdx === this.selectedIndex);
            if (resultIdx === this.selectedIndex) {
                el.scrollIntoView({ block: 'nearest' });
            }
        }, this);
    },

    /**
     * Activate (execute) a result by its absolute index
     */
    _activateResult: function (index) {
        var result = this.results[index];
        if (!result) return;

        this.close();

        switch (result.type) {
            case 'note':
                if (window.Notes) {
                    window.Notes.open(result.id);
                }
                break;
            case 'tag':
                // Search for tag in the notes sidebar
                if (window.Notes && window.Notes.filterByTag) {
                    window.Notes.filterByTag(result.name.replace('#', ''));
                } else if (window.Notes) {
                    // Fallback: open notes sidebar
                    window.Notes.toggleSidebar();
                }
                break;
            case 'command':
                CommandRegistry.execute(result.id);
                break;
            case 'canvas-node':
                // Open the parent note and highlight/select the canvas node
                if (window.Notes) {
                    window.Notes.open(result.noteId);
                    setTimeout(function() {
                        if (window.CanvasManager && window.CanvasManager.load) {
                            window.CanvasManager.load(result.noteId);
                        }
                        var nodeEl = document.getElementById('canvas-node-' + result.nodeId);
                        if (nodeEl && window.CanvasManager) {
                            nodeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            window.CanvasManager.clearSelection();
                            window.CanvasManager.selectNode(result.nodeId, false);
                        }
                    }, 200);
                }
                break;
        }
    },

    /**
     * Bind keyboard event listeners
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
     * Handle keyboard navigation within the palette
     */
    _onKeyDown: function (e) {
        if (!this.isOpen) return;

        var resultsLen = this.results.length;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.selectedIndex = Math.min(this.selectedIndex + 1, resultsLen - 1);
                this._updateSelection();
                break;

            case 'ArrowUp':
                e.preventDefault();
                this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
                this._updateSelection();
                break;

            case 'Enter':
                e.preventDefault();
                if (this.results[this.selectedIndex]) {
                    this._activateResult(this.selectedIndex);
                }
                break;

            case 'Escape':
                e.preventDefault();
                this.close();
                break;

            case 'Tab':
                e.preventDefault();
                // Cycle between sections
                if (this.sections.length > 0) {
                    var currentSectionIdx = -1;
                    for (var i = 0; i < this.sections.length; i++) {
                        var s = this.sections[i];
                        if (this.selectedIndex >= s.start && this.selectedIndex < s.start + s.count) {
                            currentSectionIdx = i;
                            break;
                        }
                    }
                    var nextSectionIdx = (currentSectionIdx + 1) % this.sections.length;
                    var nextSection = this.sections[nextSectionIdx];
                    if (nextSection) {
                        this.selectedIndex = nextSection.start;
                        this._updateSelection();
                    }
                }
                break;
        }
    },

    /**
     * Escape HTML special characters (for safe rendering)
     * Uses string replacement instead of DOM API so it works in
     * both browser and Node.js (unit test) environments.
     */
    _escapeHtml: function (str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    /**
     * Format a timestamp for display in search results.
     * Shows 'Today', 'Yesterday', weekday for this week, or short date.
     */
    _formatDate: function (ts) {
        if (!ts) return '';
        var d = new Date(ts);
        if (isNaN(d.getTime())) return '';
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var dateDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        var diffDays = Math.round((today - dateDay) / 86400000);

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays > 1 && diffDays <= 6) {
            return d.toLocaleDateString('en-US', { weekday: 'short' });
        }
        // This year: show 'Jan 5' format
        if (d.getFullYear() === now.getFullYear()) {
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        // Other year: show 'Jan 5, 2024'
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },

    // ═══════════════════════════════════════════════════════════════
    //  FULL-PAGE SEARCH RESULTS VIEW
    // ═══════════════════════════════════════════════════════════════

    _resultsPageOpen: false,
    _resultsPageFilter: 'all', // 'all' | 'notes' | 'tags' | 'commands'
    _filteredResults: null,
    _resultsPageTimer: null,

    /**
     * Open the full-page search results overlay (Cmd+Shift+F)
     * @param {string} query - Optional initial query
     */
    openResultsPage: function (query) {
        if (this._resultsPageOpen) return;

        // Close the popup if open
        if (this.isOpen) this.close();

        this._injectResultsPageStyles();

        var overlay = document.getElementById('srp-overlay');
        if (!overlay) {
            overlay = this._injectResultsPageDOM();
        }

        overlay.classList.add('active');
        this._resultsPageOpen = true;
        this.selectedIndex = 0;
        this.results = [];
        this.currentQuery = '';
        this._resultsPageFilter = 'all';

        var input = document.getElementById('srp-input');
        if (input) {
            input.value = query || '';
            input.focus();
            if (query) {
                this._executeSearch(query);
                this._renderResultsPage();
            } else {
                this._showRecentSearches();
            }
        }

        // Bind keyboard
        this._bindResultsPageEvents();
    },

    /**
     * Inject results page DOM elements
     */
    _injectResultsPageDOM: function () {
        var existing = document.getElementById('srp-overlay');
        if (existing) return existing;

        var overlay = document.createElement('div');
        overlay.id = 'srp-overlay';
        overlay.className = 'srp-overlay';

        var header = document.createElement('div');
        header.className = 'srp-header';

        var titleRow = document.createElement('div');
        titleRow.className = 'srp-title-row';

        var icon = document.createElement('span');
        icon.className = 'srp-title-icon';
        icon.textContent = '\uD83D\uDD0D'; // magnifying glass
        titleRow.appendChild(icon);

        var input = document.createElement('input');
        input.id = 'srp-input';
        input.type = 'text';
        input.placeholder = 'Search notes, content, tags, and commands...';
        input.autocomplete = 'off';
        input.spellcheck = false;
        titleRow.appendChild(input);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'srp-close-btn';
        closeBtn.textContent = 'ESC';
        closeBtn.setAttribute('aria-label', 'Close search');
        var self = this;
        closeBtn.onclick = function () { self._closeResultsPage(); };
        titleRow.appendChild(closeBtn);

        header.appendChild(titleRow);

        // Filter bar
        var filterBar = document.createElement('div');
        filterBar.className = 'srp-filter-bar';

        var filters = ['all', 'notes', 'tags', 'commands'];
        filters.forEach(function (f) {
            var btn = document.createElement('button');
            btn.className = 'srp-filter-btn' + (f === 'all' ? ' active' : '');
            btn.setAttribute('data-filter', f);
            btn.textContent = f.charAt(0).toUpperCase() + f.slice(1);
            btn.onclick = function () {
                self._resultsPageFilter = f;
                self._renderResultsPage();
            };
            filterBar.appendChild(btn);
        });

        header.appendChild(filterBar);
        overlay.appendChild(header);

        // Results container
        var results = document.createElement('div');
        results.id = 'srp-results';
        results.className = 'srp-results';
        overlay.appendChild(results);

        // Footer
        var footer = document.createElement('div');
        footer.className = 'srp-footer';
        footer.innerHTML = '<span class="srp-footer-hint"><kbd>\u2191</kbd><kbd>\u2193</kbd> navigate  <kbd>\u21E7</kbd><kbd>\u2191</kbd><kbd>\u2193</kbd> jump sections  <kbd>\u23CE</kbd> open  <kbd>Esc</kbd> close</span><span class="srp-footer-count" id="srp-footer-count"></span>';
        overlay.appendChild(footer);

        // Click backdrop to close
        overlay.addEventListener('mousedown', function (e) {
            if (e.target === overlay) {
                self._closeResultsPage();
            }
        });

        document.body.appendChild(overlay);
        return overlay;
    },

    /**
     * Inject results page styles (one-time)
     */
    _injectResultsPageStyles: function () {
        if (document.getElementById('srp-styles')) return;
        var style = document.createElement('style');
        style.id = 'srp-styles';
        style.textContent = `
            .srp-overlay {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 27000;
                background: rgba(0, 0, 0, 0.85);
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                flex-direction: column;
                align-items: center;
                padding: 40px 20px;
            }
            .srp-overlay.active {
                display: flex;
            }
            .srp-header {
                width: 100%;
                max-width: 800px;
                background: rgba(10, 10, 10, 0.95);
                border: 1px solid var(--main-color, #00ff41);
                border-radius: 8px 8px 0 0;
                box-shadow: 0 0 30px rgba(var(--main-color-rgb, 0, 255, 65), 0.08);
            }
            .srp-title-row {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 16px 20px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            }
            .srp-title-icon {
                font-size: 1.2rem;
                opacity: 0.6;
            }
            .srp-title-row input {
                flex: 1;
                background: transparent;
                border: none;
                outline: none;
                color: var(--main-color, #00ff41);
                font-family: var(--font-main, monospace);
                font-size: 1.1rem;
                letter-spacing: 0.5px;
            }
            .srp-title-row input::placeholder {
                color: #555;
                font-style: italic;
            }
            .srp-close-btn {
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 4px;
                color: #888;
                cursor: pointer;
                font-size: 0.6rem;
                font-family: var(--font-main, monospace);
                padding: 4px 10px;
                letter-spacing: 1px;
                transition: all 0.1s ease;
            }
            .srp-close-btn:hover {
                background: rgba(255, 68, 68, 0.15);
                border-color: rgba(255, 68, 68, 0.3);
                color: #ff5555;
            }
            .srp-filter-bar {
                display: flex;
                gap: 4px;
                padding: 8px 20px;
                background: rgba(0, 0, 0, 0.3);
            }
            .srp-filter-btn {
                background: transparent;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 12px;
                color: #666;
                cursor: pointer;
                font-size: 0.65rem;
                font-family: var(--font-main, monospace);
                padding: 3px 12px;
                transition: all 0.12s ease;
                letter-spacing: 0.5px;
            }
            .srp-filter-btn:hover {
                color: #aaa;
                border-color: rgba(255, 255, 255, 0.2);
            }
            .srp-filter-btn.active {
                color: var(--main-color, #00ff41);
                border-color: rgba(var(--main-color-rgb, 0, 255, 65), 0.4);
                background: rgba(var(--main-color-rgb, 0, 255, 65), 0.1);
            }
            .srp-results {
                width: 100%;
                max-width: 800px;
                flex: 1;
                overflow-y: auto;
                background: rgba(10, 10, 10, 0.92);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-top: none;
                border-radius: 0 0 8px 8px;
                padding: 4px 0;
                scrollbar-width: thin;
                scrollbar-color: var(--main-color, #00ff41) transparent;
            }
            .srp-results::-webkit-scrollbar {
                width: 6px;
            }
            .srp-results::-webkit-scrollbar-thumb {
                background: var(--main-color, #00ff41);
                border-radius: 3px;
            }
            .srp-results::-webkit-scrollbar-track {
                background: transparent;
            }
            .srp-section-header {
                padding: 10px 20px 4px;
                font-size: 0.6rem;
                text-transform: uppercase;
                letter-spacing: 1.5px;
                color: var(--secondary-color, #888);
                opacity: 0.5;
                pointer-events: none;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid rgba(255, 255, 255, 0.03);
                margin: 0 4px 2px;
                padding-bottom: 6px;
            }
            .srp-section-count {
                font-size: 0.55rem;
                opacity: 0.6;
            }
            .srp-result {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 8px 20px;
                cursor: pointer;
                transition: background 0.08s ease;
                border-left: 3px solid transparent;
                margin: 0 4px;
                border-radius: 4px;
            }
            .srp-result:hover,
            .srp-result.selected {
                background: rgba(var(--main-color-rgb, 0, 255, 65), 0.08);
                border-left-color: var(--main-color, #00ff41);
            }
            .srp-result.selected {
                background: rgba(var(--main-color-rgb, 0, 255, 65), 0.15);
            }
            .srp-result-icon {
                flex-shrink: 0;
                width: 28px;
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 0.85rem;
                opacity: 0.5;
                border-radius: 4px;
                background: rgba(255, 255, 255, 0.04);
            }
            .srp-result.selected .srp-result-icon {
                opacity: 0.8;
            }
            .srp-result-body {
                flex: 1;
                min-width: 0;
            }
            .srp-result-title {
                font-size: 0.85rem;
                color: var(--main-color, #00ff41);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-weight: 500;
            }
            .srp-result-meta {
                font-size: 0.6rem;
                color: var(--secondary-color, #888);
                font-family: var(--font-secondary, monospace);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-top: 1px;
                opacity: 0.6;
            }
            .srp-result-excerpt {
                font-size: 0.65rem;
                color: var(--dim-color, #555);
                font-family: var(--font-secondary, monospace);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-style: italic;
                margin-top: 2px;
                opacity: 0.7;
            }
            .srp-result-excerpt strong {
                color: var(--main-color, #00ff41);
                font-weight: bold;
                font-style: normal;
            }
            .srp-empty {
                padding: 40px 20px;
                text-align: center;
                color: #555;
                font-size: 0.85rem;
            }
            .srp-empty strong {
                color: var(--secondary-color, #888);
            }
            .srp-footer {
                width: 100%;
                max-width: 800px;
                padding: 8px 20px;
                background: rgba(0, 0, 0, 0.4);
                border: 1px solid rgba(255, 255, 255, 0.04);
                border-top: none;
                border-radius: 0 0 8px 8px;
                font-size: 0.55rem;
                color: #444;
                display: flex;
                justify-content: space-between;
                font-family: var(--font-secondary, monospace);
            }
            .srp-footer-hint kbd {
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 3px;
                padding: 1px 4px;
                font-family: var(--font-main, monospace);
                font-size: 0.5rem;
                color: var(--secondary-color, #888);
                margin: 0 2px;
            }
            .srp-footer-count {
                color: var(--secondary-color, #888);
                opacity: 0.5;
            }
            .srp-prompt {
                padding: 48px 20px;
                text-align: center;
            }
            .srp-prompt-icon {
                font-size: 2rem;
                opacity: 0.15;
                margin-bottom: 12px;
            }
            .srp-prompt-text {
                color: #555;
                font-size: 0.85rem;
            }
            .srp-prompt-hint {
                color: #444;
                font-size: 0.65rem;
                margin-top: 6px;
            }

            /* ── Result entrance animation ── */
            @keyframes srpResultIn {
                from { opacity: 0; transform: translateY(-6px); }
                to   { opacity: 1; transform: translateY(0); }
            }
            .srp-result {
                animation: srpResultIn 0.2s ease both;
            }

            /* ── Recent searches ── */
            .srp-recent-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 20px 4px;
                font-size: 0.6rem;
                text-transform: uppercase;
                letter-spacing: 1.5px;
                color: var(--secondary-color, #888);
                opacity: 0.5;
                pointer-events: none;
            }
            .srp-recent-clear {
                background: none;
                border: none;
                color: #555;
                cursor: pointer;
                font-size: 0.55rem;
                font-family: inherit;
                pointer-events: auto;
                transition: color 0.1s ease;
            }
            .srp-recent-clear:hover {
                color: #ff5555;
            }
            .srp-recent-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 6px 20px;
                cursor: pointer;
                transition: background 0.08s ease;
                border-radius: 4px;
                margin: 0 4px;
            }
            .srp-recent-item:hover {
                background: rgba(var(--main-color-rgb, 0, 255, 65), 0.08);
            }
            .srp-recent-item-icon {
                font-size: 0.7rem;
                opacity: 0.35;
                flex-shrink: 0;
            }
            .srp-recent-item-text {
                font-size: 0.8rem;
                color: var(--secondary-color, #888);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .srp-recent-item:hover .srp-recent-item-text {
                color: var(--main-color, #00ff41);
            }
        `;
        document.head.appendChild(style);
    },

    /**
     * Save a query to recent searches (localStorage, max 10)
     */
    _saveRecentQuery: function (query) {
        if (!query || !query.trim()) return;
        try {
            var recent = JSON.parse(localStorage.getItem('vinland_recent_searches') || '[]');
            // Remove duplicate if exists
            var idx = recent.indexOf(query);
            if (idx >= 0) recent.splice(idx, 1);
            // Add to front
            recent.unshift(query);
            // Keep max 10
            if (recent.length > 10) recent = recent.slice(0, 10);
            localStorage.setItem('vinland_recent_searches', JSON.stringify(recent));
        } catch (e) { /* ignore storage errors */ }
    },

    /**
     * Show recent searches in the results page prompt area
     */
    _showRecentSearches: function () {
        var container = document.getElementById('srp-results');
        if (!container) return;
        container.innerHTML = '';

        var recent = [];
        try {
            recent = JSON.parse(localStorage.getItem('vinland_recent_searches') || '[]');
        } catch (e) { /* ignore */ }

        // Show search prompt
        var prompt = document.createElement('div');
        prompt.className = 'srp-prompt';
        prompt.innerHTML = '<div class="srp-prompt-icon">\uD83D\uDD0D</div>' +
            '<div class="srp-prompt-text">Type to search across all notes, tags, and commands</div>' +
            '<div class="srp-prompt-hint">Results appear as you type &mdash; press <kbd>\u2191</kbd><kbd>\u2193</kbd> to navigate, <kbd>\u23CE</kbd> to open</div>';
        container.appendChild(prompt);

        // Show recent searches if any
        if (recent.length > 0) {
            var header = document.createElement('div');
            header.className = 'srp-recent-header';
            var self = this;
            header.innerHTML = '<span>Previous searches</span>' +
                '<button class="srp-recent-clear" id="srp-recent-clear-btn">Clear</button>';
            container.appendChild(header);

            recent.forEach(function (q) {
                var item = document.createElement('div');
                item.className = 'srp-recent-item';

                var icon = document.createElement('span');
                icon.className = 'srp-recent-item-icon';
                icon.textContent = '\u23F3'; // clock
                item.appendChild(icon);

                var text = document.createElement('span');
                text.className = 'srp-recent-item-text';
                text.textContent = q;
                item.appendChild(text);

                item.onclick = function () {
                    var input = document.getElementById('srp-input');
                    if (input) {
                        input.value = q;
                        self._executeSearch(q);
                        self._renderResultsPage();
                    }
                };

                container.appendChild(item);
            });

            // Wire clear button
            var clearBtn = document.getElementById('srp-recent-clear-btn');
            if (clearBtn) {
                clearBtn.onclick = function (e) {
                    e.stopPropagation();
                    try {
                        localStorage.removeItem('vinland_recent_searches');
                    } catch (e) { /* ignore */ }
                    self._showRecentSearches();
                };
            }
        }

        var footer = document.getElementById('srp-footer-count');
        if (footer) footer.textContent = '';
    },

    /**
     * Render results into the full-page overlay with highlighting
     */
    _renderResultsPage: function () {
        var container = document.getElementById('srp-results');
        var footer = document.getElementById('srp-footer-count');
        if (!container) return;

        container.innerHTML = '';
        var filter = this._resultsPageFilter;
        var results = this.results;

        // Apply filter and store filtered results for index-safe activation
        if (filter !== 'all') {
            var filterType = filter === 'notes' ? 'note' : filter === 'tags' ? 'tag' : 'command';
            this._filteredResults = results.filter(function (r) { return r.type === filterType; });
            results = this._filteredResults;
        } else {
            this._filteredResults = this.results;
        }

        if (results.length === 0) {
            container.innerHTML = '<div class="srp-empty">No results found for <strong>' +
                this._escapeHtml(this.currentQuery || '') + '</strong></div>';
            if (footer) footer.textContent = '0 results';
            return;
        }

        var self = this;
        var globalIdx = 0;
        this.sections = [];

        var visibleTypes = ['notes', 'canvas-nodes', 'tags', 'commands'];
        visibleTypes.forEach(function (sectionType) {
            var typeResults = results.filter(function (r) {
                if (sectionType === 'notes') return r.type === 'note';
                if (sectionType === 'canvas-nodes') return r.type === 'canvas-node';
                if (sectionType === 'tags') return r.type === 'tag';
                if (sectionType === 'commands') return r.type === 'command';
                return false;
            });

            if (typeResults.length === 0) return;

            self.sections.push({ type: sectionType, start: globalIdx, count: typeResults.length });

            var header = document.createElement('div');
            header.className = 'srp-section-header';
            var headerLabels = {
                'notes': '\uD83D\uDCDD Notes',
                'canvas-nodes': '\u2B21 Canvas',
                'tags': '\uD83C\uDFF7 Tags',
                'commands': '\u2328 Commands'
            };
            header.innerHTML = '<span>' + (headerLabels[sectionType] || sectionType) + '</span>' +
                '<span class="srp-section-count">' + typeResults.length + '</span>';
            container.appendChild(header);

            typeResults.forEach(function (result) {
                var el = document.createElement('div');
                el.className = 'srp-result' + (self.selectedIndex === globalIdx ? ' selected' : '');
                el.setAttribute('data-result-index', globalIdx);
                // Staggered entrance animation
                el.style.animationDelay = (globalIdx * 20) + 'ms';

                // Icon
                var icon = document.createElement('span');
                icon.className = 'srp-result-icon';
                if (result.type === 'note') {
                    icon.textContent = result.recent ? '\u23F0' : '\uD83D\uDCC4';
                } else if (result.type === 'canvas-node') {
                    icon.textContent = '\u2B21';
                } else if (result.type === 'tag') {
                    icon.textContent = '#';
                } else {
                    icon.textContent = '>';
                }
                el.appendChild(icon);

                // Body
                var body = document.createElement('div');
                body.className = 'srp-result-body';

                var title = document.createElement('div');
                title.className = 'srp-result-title';
                title.textContent = result.title || result.name || 'Untitled';
                body.appendChild(title);

                var meta = document.createElement('div');
                meta.className = 'srp-result-meta';
                if (result.type === 'note') {
                    var metaText = result.path || '/';
                    if (result.modified) {
                        metaText += ' \u00B7 ' + self._formatDate(result.modified);
                    }
                    meta.textContent = metaText;
                } else if (result.type === 'canvas-node') {
                    meta.textContent = 'in ' + (result.path || 'Untitled');
                } else if (result.type === 'tag') {
                    meta.textContent = result.count + ' note' + (result.count !== 1 ? 's' : '');
                } else {
                    meta.textContent = result.trigger + ' \u2014 ' + result.title;
                }
                body.appendChild(meta);

                // Excerpt with highlighted query
                if (result.excerpt) {
                    var excerpt = document.createElement('div');
                    excerpt.className = 'srp-result-excerpt';
                    var escapedExcerpt = self._escapeHtml(result.excerpt);
                    if (self.currentQuery) {
                        var qEscaped = self._escapeHtml(self.currentQuery);
                        var regex = new RegExp('(' + qEscaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
                        escapedExcerpt = escapedExcerpt.replace(regex, '<strong>$1</strong>');
                    }
                    excerpt.innerHTML = escapedExcerpt;
                    body.appendChild(excerpt);
                }

                el.appendChild(body);

                // Store result ref for filter-safe activation
                el._srpResult = result;

                // Click handler
                el.onclick = function () {
                    self.selectedIndex = parseInt(el.getAttribute('data-result-index'), 10);
                    self._activateResultsPage(el);
                };
                el.onmouseenter = function () {
                    self.selectedIndex = parseInt(el.getAttribute('data-result-index'), 10);
                    self._updateResultsPageSelection();
                };

                container.appendChild(el);
                globalIdx++;
            });
        });

        // Update filter button states
        var filterBtns = document.querySelectorAll('.srp-filter-btn');
        filterBtns.forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
        });

        // Update footer
        if (footer) {
            footer.textContent = results.length + ' result' + (results.length !== 1 ? 's' : '');
        }

        // Save to recent searches
        if (this.currentQuery) {
            this._saveRecentQuery(this.currentQuery);
        }
    },

    /**
     * Update selection highlight in results page
     */
    _updateResultsPageSelection: function () {
        var items = document.querySelectorAll('#srp-results .srp-result');
        items.forEach(function (el) {
            var idx = parseInt(el.getAttribute('data-result-index'), 10);
            el.classList.toggle('selected', idx === this.selectedIndex);
            if (idx === this.selectedIndex) {
                el.scrollIntoView({ block: 'nearest' });
            }
        }, this);
    },

    /**
     * Activate the selected result in the results page
     */
    _activateResultsPage: function (el) {
        var result;
        if (el) {
            // Use the result stored on the element for filter-safe lookup
            result = el._srpResult;
        } else {
            // Keyboard Enter: use filtered results array
            result = this._filteredResults[this.selectedIndex];
        }
        if (!result) return;
        this._closeResultsPage();

        switch (result.type) {
            case 'note':
                if (window.Notes) window.Notes.open(result.id);
                break;
            case 'tag':
                if (window.Notes && window.Notes.filterByTag) {
                    window.Notes.filterByTag(result.name.replace('#', ''));
                } else if (window.Notes) {
                    window.Notes.toggleSidebar();
                }
                break;
            case 'command':
                CommandRegistry.execute(result.id);
                break;
            case 'canvas-node':
                if (window.Notes) {
                    window.Notes.open(result.noteId);
                    setTimeout(function () {
                        if (window.CanvasManager && window.CanvasManager.load) {
                            window.CanvasManager.load(result.noteId);
                        }
                        var nodeEl = document.getElementById('canvas-node-' + result.nodeId);
                        if (nodeEl && window.CanvasManager) {
                            nodeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            window.CanvasManager.clearSelection();
                            window.CanvasManager.selectNode(result.nodeId, false);
                        }
                    }, 200);
                }
                break;
        }
    },

    /**
     * Close the results page
     */
    _closeResultsPage: function () {
        if (!this._resultsPageOpen) return;
        this._resultsPageOpen = false;

        var overlay = document.getElementById('srp-overlay');
        if (overlay) overlay.classList.remove('active');

        this._unbindResultsPageEvents();
        this.results = [];
        this.sections = [];
        this.selectedIndex = 0;
    },

    /**
     * Bind keyboard events for results page
     */
    _bindResultsPageEvents: function () {
        var self = this;
        var input = document.getElementById('srp-input');
        if (input) {
            input.addEventListener('input', this._onResultsPageInput.bind(this));
        }

        this._resultsPageKeyHandler = function (e) {
            if (!self._resultsPageOpen) return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    self.selectedIndex = Math.min(self.selectedIndex + 1, self.results.length - 1);
                    self._updateResultsPageSelection();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    self.selectedIndex = Math.max(self.selectedIndex - 1, 0);
                    self._updateResultsPageSelection();
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (self._filteredResults && self._filteredResults[self.selectedIndex]) {
                        self._activateResultsPage();
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    self._closeResultsPage();
                    break;
            }
        };
        document.addEventListener('keydown', this._resultsPageKeyHandler);
    },

    /**
     * Handle input in results page search field (debounced)
     */
    _onResultsPageInput: function () {
        var self = this;
        var input = document.getElementById('srp-input');
        if (!input) return;

        var query = input.value.trim();

        if (self._resultsPageTimer) {
            clearTimeout(self._resultsPageTimer);
        }

        if (!query) {
            self.currentQuery = '';
            self._showRecentSearches();
            return;
        }

        self._resultsPageTimer = setTimeout(function () {
            self._executeSearch(query);
            self._renderResultsPage();
        }, 150);
    },

    /**
     * Unbind results page keyboard events
     */
    _unbindResultsPageEvents: function () {
        if (this._resultsPageKeyHandler) {
            document.removeEventListener('keydown', this._resultsPageKeyHandler);
            this._resultsPageKeyHandler = null;
        }
        if (this._resultsPageTimer) {
            clearTimeout(this._resultsPageTimer);
            this._resultsPageTimer = null;
        }
    }
};

// Expose globally for HTML handlers and CLI commands
window.QuickOpen = QuickOpen;
