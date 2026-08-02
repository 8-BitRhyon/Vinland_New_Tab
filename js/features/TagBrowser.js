

import { State } from '../core/Store.js';
import { MetadataCache } from '../core/MetadataCache.js';

export const TagBrowser = {
    isOpen: false,
    selectedIndex: 0,
    results: [],
    currentQuery: '',
    allTags: [],

    
    init: function () {
        this._injectDOM();
    },

    
    open: function () {
        if (this.isOpen) return;
        this.isOpen = true;
        this.selectedIndex = 0;
        this.results = [];
        this.currentQuery = '';

        var overlay = document.getElementById('tag-browser-overlay');
        var palette = document.getElementById('tag-browser-palette');
        var input = document.getElementById('tag-browser-input');
        var results = document.getElementById('tag-browser-results');
        var preview = document.getElementById('tag-browser-preview');
        var footer = document.getElementById('tag-browser-footer-count');

        if (!overlay || !palette) return;

        overlay.classList.add('active');
        palette.classList.add('active');

        // Reset state
        if (results) results.innerHTML = '';
        if (preview) preview.innerHTML = '';
        if (footer) footer.textContent = '';
        if (input) {
            input.value = '';
            input.focus();
        }

        // Load all tags and render
        this._loadTags();
        this._render();

        // Bind keyboard events
        this._bindEvents();
    },

    
    close: function () {
        if (!this.isOpen) return;
        this.isOpen = false;

        var overlay = document.getElementById('tag-browser-overlay');
        var palette = document.getElementById('tag-browser-palette');

        if (overlay) overlay.classList.remove('active');
        if (palette) palette.classList.remove('active');

        this._unbindEvents();
        this.results = [];
        this.selectedIndex = 0;
        this.currentQuery = '';
        this.allTags = [];
    },

    
    openFromCLI: function (query) {
        this.open();
        if (query && query.trim()) {
            var input = document.getElementById('tag-browser-input');
            if (input) {
                input.value = query;
                this._onInput();
            }
        }
    },

    // ─── Private Methods ─────────────────────────────────────────

    
    _loadTags: function () {
        this.allTags = [];

        var tagCounts = {};
        if (MetadataCache && MetadataCache.getAllTags) {
            tagCounts = MetadataCache.getAllTags();
        }

        if (tagCounts && typeof tagCounts === 'object') {
            var self = this;
            Object.keys(tagCounts).forEach(function (tag) {
                self.allTags.push({
                    name: tag,
                    count: tagCounts[tag]
                });
            });
        }

        // Sort by count descending, then alphabetically
        this.allTags.sort(function (a, b) {
            if (b.count !== a.count) return b.count - a.count;
            return a.name.localeCompare(b.name);
        });
    },

    
    _injectDOM: function () {
        if (document.getElementById('tag-browser-overlay')) return;

        // Overlay backdrop
        var overlay = document.createElement('div');
        overlay.id = 'tag-browser-overlay';
        overlay.className = 'tag-browser-overlay';
        overlay.onclick = this.close.bind(this);
        document.body.appendChild(overlay);

        // Main palette container
        var palette = document.createElement('div');
        palette.id = 'tag-browser-palette';
        palette.className = 'tag-browser-palette';

        // Header with search input
        var header = document.createElement('div');
        header.className = 'tag-browser-header';

        var icon = document.createElement('span');
        icon.className = 'tag-browser-icon';
        icon.textContent = '\uD83C\uDFF7'; // Tag emoji
        header.appendChild(icon);

        var input = document.createElement('input');
        input.id = 'tag-browser-input';
        input.type = 'text';
        input.placeholder = 'Search tags...';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.addEventListener('input', this._onInput.bind(this));
        header.appendChild(input);

        palette.appendChild(header);

        // Body: split into results + preview columns
        var body = document.createElement('div');
        body.className = 'tag-browser-body';

        // Results column (left)
        var results = document.createElement('div');
        results.id = 'tag-browser-results';
        results.className = 'tag-browser-results';
        body.appendChild(results);

        // Preview column (right) - shows notes for selected tag
        var preview = document.createElement('div');
        preview.id = 'tag-browser-preview';
        preview.className = 'tag-browser-preview';
        body.appendChild(preview);

        palette.appendChild(body);

        // Footer
        var footer = document.createElement('div');
        footer.id = 'tag-browser-footer';
        footer.className = 'tag-browser-footer';
        footer.innerHTML =
            '<span class="tb-footer-hint">' +
                '<kbd>\u2191</kbd><kbd>\u2193</kbd> navigate  ' +
                '<kbd>\u23CE</kbd> filter by tag  ' +
                '<kbd>Esc</kbd> close' +
            '</span>' +
            '<span class="tb-footer-count" id="tag-browser-footer-count"></span>';
        palette.appendChild(footer);

        document.body.appendChild(palette);
    },

    
    _onInput: function () {
        var input = document.getElementById('tag-browser-input');
        if (!input) return;

        this.currentQuery = input.value.trim().toLowerCase();
        this.selectedIndex = 0;
        this._render();
    },

    
    _render: function () {
        var container = document.getElementById('tag-browser-results');
        var preview = document.getElementById('tag-browser-preview');
        var footer = document.getElementById('tag-browser-footer-count');
        if (!container) return;

        container.innerHTML = '';

        var query = this.currentQuery;
        var self = this;

        // Filter tags by query
        var filtered = this.allTags;
        if (query) {
            filtered = filtered.filter(function (t) {
                return t.name.indexOf(query) >= 0;
            });
        }

        this.results = filtered;

        if (filtered.length === 0) {
            container.innerHTML =
                '<div class="tb-result-empty">' +
                (query
                    ? 'No tags matching <strong>' + this._escapeHtml(query) + '</strong>'
                    : 'No tags yet. Use <strong>#hashtags</strong> in your notes.') +
                '</div>';
            if (preview) preview.innerHTML = '';
            if (footer) footer.textContent = '0 tags';
            return;
        }

        // Get currently active filter
        var activeFilter = null;
        if (window.Notes && window.Notes.activeTagFilter) {
            activeFilter = window.Notes.activeTagFilter;
        }

        filtered.forEach(function (tag, idx) {
            var el = document.createElement('div');
            el.className = 'tb-result' +
                (self.selectedIndex === idx ? ' selected' : '') +
                (tag.name === activeFilter ? ' tb-result-active' : '');

            // Icon / checkmark for active filter
            var icon = document.createElement('span');
            icon.className = 'tb-result-icon';
            if (tag.name === activeFilter) {
                icon.textContent = '\u2713'; // Checkmark
                el.title = 'Currently filtering by #' + tag.name + ' \u2014 click to clear';
            } else {
                icon.textContent = '#';
                el.title = 'Filter notes by #' + tag.name;
            }
            el.appendChild(icon);

            // Body
            var body = document.createElement('div');
            body.className = 'tb-result-body';

            var name = document.createElement('div');
            name.className = 'tb-result-name';
            name.textContent = tag.name;
            body.appendChild(name);

            var meta = document.createElement('div');
            meta.className = 'tb-result-meta';
            meta.textContent = tag.count + ' note' + (tag.count !== 1 ? 's' : '');
            body.appendChild(meta);

            el.appendChild(body);

            // Badge with count
            var badge = document.createElement('span');
            badge.className = 'tb-result-badge';
            badge.textContent = tag.count;
            el.appendChild(badge);

            // Click handler
            el.onclick = function () {
                self._activateTag(tag.name);
            };

            // Mouse hover — show note preview for this tag
            el.onmouseenter = function () {
                var prevIdx = self.selectedIndex;
                self.selectedIndex = idx;
                self._updateSelection();
                if (prevIdx !== idx) {
                    self._renderPreview(tag.name);
                }
            };

            container.appendChild(el);
        });

        // Show preview for the initially selected tag
        if (filtered.length > 0 && this.selectedIndex < filtered.length) {
            this._renderPreview(filtered[this.selectedIndex].name);
        }

        // Update footer
        if (footer) {
            var total = this.allTags.length;
            footer.textContent = filtered.length + ' of ' + total + ' tag' + (total !== 1 ? 's' : '');
        }
    },

    
    _renderPreview: function (tagName) {
        var preview = document.getElementById('tag-browser-preview');
        if (!preview) return;

        // Get notes with this tag from MetadataCache
        var taggedNotes = [];
        if (MetadataCache && MetadataCache.getByTag) {
            taggedNotes = MetadataCache.getByTag(tagName) || [];
        }

        if (taggedNotes.length === 0) {
            preview.innerHTML =
                '<div class="tb-preview-empty">No notes tagged <strong>#' +
                this._escapeHtml(tagName) + '</strong></div>';
            return;
        }

        // Build a once-off lookup map for faster content access
        var notesById = {};
        (State.NOTES || []).forEach(function (n) { notesById[n.id] = n; });

        var html = '<div class="tb-preview-header">NOTES TAGGED <span class="tb-preview-tag">#' +
            this._escapeHtml(tagName) + '</span></div>';
        html += '<div class="tb-preview-list">';

        var self = this;
        // Limit to showing at most 20 notes in the preview
        var maxPreview = Math.min(taggedNotes.length, 20);

        for (var i = 0; i < maxPreview; i++) {
            var meta = taggedNotes[i];
            if (!meta) continue;

            var title = meta.title || 'Untitled';
            var path = meta.path || '/';

            // Get a content snippet from the actual note (O(1) via lookup map)
            var snippet = '';
            var note = notesById[meta.id];
            if (note) {
                var content = '';
                if (note.blocks && note.blocks.length > 0) {
                    content = note.blocks.map(function (b) { return b.content || ''; }).join(' ').trim();
                } else if (note.content) {
                    content = note.content.replace(/[#*_`~\[\]]/g, '').replace(/\n/g, ' ').trim();
                }
                if (content) {
                    snippet = content.substring(0, 80) + (content.length > 80 ? '...' : '');
                }
            }

            // Format modified time
            var timeStr = '';
            if (meta.modified) {
                var d = new Date(meta.modified);
                timeStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }

            html += '<div class="tb-preview-note" data-note-id="' + meta.id + '">' +
                '<div class="tb-preview-note-title">' + self._escapeHtml(title) + '</div>' +
                (snippet ? '<div class="tb-preview-note-snippet">' + self._escapeHtml(snippet) + '</div>' : '') +
                '<div class="tb-preview-note-meta">' +
                    '<span class="tb-preview-note-path">' + self._escapeHtml(path) + '</span>' +
                    (timeStr ? '<span class="tb-preview-note-time">' + timeStr + '</span>' : '') +
                '</div>' +
                '</div>';
        }

        if (taggedNotes.length > 20) {
            html += '<div class="tb-preview-more">+' + (taggedNotes.length - 20) + ' more</div>';
        }

        html += '</div>';
        preview.innerHTML = html;

        // Bind click handlers to open notes directly
        Array.from(preview.querySelectorAll('.tb-preview-note')).forEach(function (el) {
            el.onclick = function (e) {
                e.stopPropagation();
                var noteId = el.getAttribute('data-note-id');
                if (noteId && window.Notes) {
                    self.close();
                    window.Notes.open(noteId);
                }
            };
        });
    },

    
    _updateSelection: function () {
        var items = document.querySelectorAll('#tag-browser-results .tb-result');
        items.forEach(function (el, idx) {
            el.classList.toggle('selected', idx === this.selectedIndex);
            if (idx === this.selectedIndex) {
                el.scrollIntoView({ block: 'nearest' });
            }
        }, this);
    },

    
    _activateTag: function (tagName) {
        if (window.Notes && window.Notes.filterByTag) {
            window.Notes.filterByTag(tagName);
        }

        // Close tag browser after filtering
        this.close();

        // If Notes sidebar is collapsed, open it
        var sidebar = document.querySelector('.notes-sidebar');
        if (sidebar && sidebar.classList.contains('collapsed')) {
            if (window.Notes && window.Notes.toggleSidebar) {
                window.Notes.toggleSidebar();
            }
        }
    },

    
    _bindEvents: function () {
        this._boundKeyHandler = this._onKeyDown.bind(this);
        document.addEventListener('keydown', this._boundKeyHandler);
    },

    
    _unbindEvents: function () {
        if (this._boundKeyHandler) {
            document.removeEventListener('keydown', this._boundKeyHandler);
            this._boundKeyHandler = null;
        }
    },

    
    _onKeyDown: function (e) {
        if (!this.isOpen) return;

        var resultsLen = this.results.length;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (this.selectedIndex < resultsLen - 1) {
                    this.selectedIndex++;
                    this._updateSelection();
                    if (this.results[this.selectedIndex]) {
                        this._renderPreview(this.results[this.selectedIndex].name);
                    }
                }
                break;

            case 'ArrowUp':
                e.preventDefault();
                if (this.selectedIndex > 0) {
                    this.selectedIndex--;
                    this._updateSelection();
                    if (this.results[this.selectedIndex]) {
                        this._renderPreview(this.results[this.selectedIndex].name);
                    }
                }
                break;

            case 'Enter':
                e.preventDefault();
                if (this.results[this.selectedIndex]) {
                    this._activateTag(this.results[this.selectedIndex].name);
                }
                break;

            case 'Escape':
                e.preventDefault();
                this.close();
                break;
        }
    },

    
    _escapeHtml: function (str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
};

// Expose globally for CLI commands and HTML handlers
window.TagBrowser = TagBrowser;
