import { State } from '../core/Store.js';
import { safeText } from '../core/Utils.js';
import { saveData } from '../core/Storage.js';
import { Notes } from '../modules/NotesController.js';

/* =========================================
   TEMPLATE BROWSER - Cmd+Shift+N
   =========================================
   Opens a modal showing all notes in the /Templates folder.
   Selecting a template creates a new note pre-populated
   with the template's blocks/content.
*/

export const TemplateBrowser = {
    isOpen: false,
    selectedIndex: 0,
    templates: [],

    init: function() {
        // No auto-init needed; DOM is created on first open
    },

    open: function() {
        if (this.isOpen) {
            this.close();
            return;
        }

        this.refreshTemplates();
        this._injectDOM();
        this._render();

        var overlay = document.getElementById('template-browser-overlay');
        var palette = document.getElementById('template-browser-palette');
        var input = document.getElementById('template-browser-input');

        if (overlay) overlay.classList.add('active');
        if (palette) palette.classList.add('active');
        this.isOpen = true;

        if (input) {
            setTimeout(function() { input.focus(); }, 50);
        }
    },

    close: function() {
        var overlay = document.getElementById('template-browser-overlay');
        var palette = document.getElementById('template-browser-palette');
        if (overlay) overlay.classList.remove('active');
        if (palette) palette.classList.remove('active');
        this.isOpen = false;
    },

    toggle: function() {
        if (this.isOpen) this.close();
        else this.open();
    },

    refreshTemplates: function() {
        // Templates are notes in /Templates folder or with template: true in metadata
        this.templates = (State.NOTES || []).filter(function(n) {
            // Exclude canvas and trashed notes
            if (n.type === 'canvas') return false;
            if (n.path && n.path.indexOf('/.trash') === 0) return false;

            // Check if note is in /Templates folder
            var inTemplatesFolder = n.path && (
                n.path === '/Templates' ||
                n.path.indexOf('/Templates/') === 0
            );

            // Check if note has template flag in content (YAML frontmatter)
            var hasTemplateFlag = false;
            var content = n.content || '';
            if (content.startsWith('---')) {
                var endIdx = content.indexOf('---', 3);
                if (endIdx > 0) {
                    var frontmatter = content.substring(0, endIdx + 3);
                    hasTemplateFlag = /\btemplate:\s*true\b/.test(frontmatter);
                }
            }

            return inTemplatesFolder || hasTemplateFlag;
        });

        // Sort by title
        this.templates.sort(function(a, b) {
            return (a.title || '').localeCompare(b.title || '');
        });

        this.selectedIndex = 0;
    },

    /* ── DOM Injection ─────────────────────── */

    _injectDOM: function() {
        if (document.getElementById('template-browser-overlay')) return;

        var overlay = document.createElement('div');
        overlay.id = 'template-browser-overlay';
        overlay.className = 'quick-open-overlay'; // Reuse QuickOpen overlay styles
        overlay.onclick = function(e) {
            if (e.target === overlay) window.TemplateBrowser.close();
        };

        var palette = document.createElement('div');
        palette.id = 'template-browser-palette';
        palette.className = 'quick-open-palette'; // Reuse QuickOpen palette styles

        palette.innerHTML =
            '<div class="quick-open-header">' +
                '<span class="quick-open-icon">T</span>' +
                '<input id="template-browser-input" class="quick-open-input-fix" type="text" placeholder="Search templates..." autocomplete="off" spellcheck="false">' +
            '</div>' +
            '<div id="template-browser-results" class="quick-open-results"></div>' +
            '<div class="quick-open-footer">' +
                '<span class="qo-footer-hint"><kbd>Enter</kbd> create from template &middot; <kbd>Esc</kbd> close</span>' +
                '<span id="template-browser-count" class="qo-footer-count">0 templates</span>' +
            '</div>';

        overlay.appendChild(palette);
        document.body.appendChild(overlay);

        // Bind events
        var self = this;
        var input = document.getElementById('template-browser-input');
        if (input) {
            input.addEventListener('input', function() {
                self._render();
            });
            input.addEventListener('keydown', function(e) {
                self._onKeyDown(e);
            });
        }
    },

    /* ── Render ────────────────────────────── */

    _render: function() {
        var results = document.getElementById('template-browser-results');
        var countEl = document.getElementById('template-browser-count');
        if (!results) return;

        var input = document.getElementById('template-browser-input');
        var query = input ? input.value.trim().toLowerCase() : '';

        var filtered = this.templates;
        if (query) {
            filtered = filtered.filter(function(t) {
                var title = (t.title || '').toLowerCase();
                var content = (t.content || '').toLowerCase();
                return title.indexOf(query) !== -1 || content.indexOf(query) !== -1;
            });
        }

        if (countEl) countEl.textContent = filtered.length + ' template' + (filtered.length !== 1 ? 's' : '');

        if (filtered.length === 0) {
            results.innerHTML = '<div class="qo-result-empty">' +
                '<strong>No templates found</strong><br>' +
                'Create notes in the <code>/Templates</code> folder<br>' +
                'or add <code>template: true</code> to note frontmatter.' +
                '</div>';
            return;
        }

        // Clamp selectedIndex
        if (this.selectedIndex >= filtered.length) {
            this.selectedIndex = filtered.length - 1;
        }

        var html = '';
        var self = this;
        filtered.forEach(function(t, i) {
            var isSelected = i === self.selectedIndex;
            var snippet = '';
            if (t.content) {
                snippet = t.content.replace(/\n/g, ' ').substring(0, 80);
                if (t.content.length > 80) snippet += '...';
            } else if (t.blocks && t.blocks.length > 0) {
                snippet = t.blocks.map(function(b) { return b.content || ''; }).join(' ').substring(0, 80);
                if (snippet.length >= 80) snippet += '...';
            }

            var pathLabel = t.path || '/';
            if (pathLabel === '/Templates') pathLabel = '/';

            html += '<div class="qo-result ' + (isSelected ? 'selected' : '') + '" data-template-idx="' + i + '">' +
                '<span class="qo-result-icon">&#x1F4CB;</span>' +
                '<div class="qo-result-body">' +
                '<div class="qo-result-title">' + safeText(t.title || 'Untitled') + '</div>' +
                '<div class="qo-result-meta">' + safeText(pathLabel) + (snippet ? ' &middot; ' + safeText(snippet) : '') + '</div>' +
                '</div>' +
                '</div>';
        });

        results.innerHTML = html;

        // Bind click handlers
        Array.from(results.querySelectorAll('.qo-result')).forEach(function(el) {
            el.addEventListener('click', function() {
                var idx = parseInt(el.getAttribute('data-template-idx'), 10);
                if (!isNaN(idx)) {
                    self._applyTemplate(idx);
                }
            });
            el.addEventListener('mouseenter', function() {
                var idx = parseInt(el.getAttribute('data-template-idx'), 10);
                if (!isNaN(idx) && idx !== self.selectedIndex) {
                    self.selectedIndex = idx;
                    self._updateSelection();
                }
            });
        });

        // Ensure selected item is visible
        var selectedEl = results.querySelector('.qo-result.selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
    },

    _updateSelection: function() {
        var results = document.getElementById('template-browser-results');
        if (!results) return;
        Array.from(results.querySelectorAll('.qo-result')).forEach(function(el, i) {
            var idx = parseInt(el.getAttribute('data-template-idx'), 10);
            el.classList.toggle('selected', idx === TemplateBrowser.selectedIndex);
        });
    },

    _onKeyDown: function(e) {
        var filtered = this._getFiltered();

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.selectedIndex = Math.min(this.selectedIndex + 1, filtered.length - 1);
            this._updateSelection();
            this._scrollToSelected();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
            this._updateSelection();
            this._scrollToSelected();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered.length > 0 && this.selectedIndex < filtered.length) {
                this._applyTemplate(this.selectedIndex);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
        }
    },

    _getFiltered: function() {
        var input = document.getElementById('template-browser-input');
        var query = input ? input.value.trim().toLowerCase() : '';
        if (!query) return this.templates;
        return this.templates.filter(function(t) {
            var title = (t.title || '').toLowerCase();
            var content = (t.content || '').toLowerCase();
            return title.indexOf(query) !== -1 || content.indexOf(query) !== -1;
        });
    },

    _scrollToSelected: function() {
        var results = document.getElementById('template-browser-results');
        if (!results) return;
        var selected = results.querySelector('.qo-result.selected');
        if (selected) {
            selected.scrollIntoView({ block: 'nearest' });
        }
    },

    /* ── Apply Template ────────────────────── */

    _applyTemplate: function(index) {
        var filtered = this._getFiltered();
        var template = filtered[index];
        if (!template) return;

        this.close();

        // Create a new note from the template
        if (window.Notes && window.Notes.createFromTemplate) {
            window.Notes.createFromTemplate(template);
        }
    }
};
