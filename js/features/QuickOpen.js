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
                recent: true
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
                    recent: false
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
                meta.textContent = result.path || '/';
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
    }
};

// Expose globally for HTML handlers and CLI commands
window.QuickOpen = QuickOpen;
