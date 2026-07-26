/* =========================================
   PROPERTIES PANEL
   Editable YAML frontmatter in the note editor
   ========================================= */

import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';

export const PropertiesPanel = {
    panelEl: null,
    expanded: true,
    activeNoteId: null,
    currentFrontmatter: {},  // Current in-memory frontmatter (before save)
    currentBody: '',         // Current body content (frontmatter stripped)

    // Property key display config
    PROPERTY_LABELS: {
        tags: 'Tags',
        aliases: 'Aliases',
        date: 'Date',
        created: 'Created',
        modified: 'Modified',
        status: 'Status',
        pinned: 'Pinned',
        template: 'Template',
        type: 'Type'
    },

    // Known property icons
    PROPERTY_ICONS: {
        tags: '#',
        aliases: '↔',
        date: '📅',
        created: '🆕',
        modified: '✏️',
        status: '●',
        pinned: '📌',
        template: '📋',
        type: '◇',
        priority: '⚠'
    },

    // Status presets for autocomplete
    STATUS_OPTIONS: ['active', 'draft', 'review', 'done', 'archived', 'backlog'],

    /**
     * Initialize global listeners (run once)
     */
    init: function() {
        if (this._initialized) return;
        this._initialized = true;

        // Listen for property changes via event delegation
        document.addEventListener('change', function(e) {
            if (e.target.closest('#note-properties-panel')) {
                var input = e.target;
                var row = input.closest('.prop-row');
                if (row) {
                    var key = row.getAttribute('data-prop-key');
                    if (key) {
                        PropertiesPanel._onPropertyChange(key, input);
                    }
                }
            }
        });

        // Listen for keydown to commit on Enter
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && e.target.closest('.prop-value-input')) {
                e.preventDefault();
                e.target.blur();
            }
        });

        console.log('[PropertiesPanel] Initialized');
    },

    /**
     * Render the properties panel for a note
     */
    render: function(noteId) {
        this.activeNoteId = noteId;
        if (!noteId) { this._hide(); return; }

        var note = State.NOTES.find(function(n) { return n.id === noteId; });
        if (!note || note.type === 'canvas') { this._hide(); return; }

        this._ensurePanel();

        // Parse frontmatter from note content
        this._parseFromContent(note);

        this._renderPanel();
        this._show();
    },

    /**
     * Called during save — inject frontmatter into note content
     */
    syncToNote: function(note) {
        if (!note || !this.activeNoteId || note.id !== this.activeNoteId) return;
        if (!this.panelEl || !this.panelEl.classList.contains('active')) return;

        // Read current values from DOM
        this._readValuesFromDOM();

        // Only write if there are properties or if body has changed with existing properties
        var fmKeys = Object.keys(this.currentFrontmatter);
        if (fmKeys.length === 0) return;

        // Construct YAML frontmatter string
        var fmLines = [];
        fmKeys.forEach(function(key) {
            var value = PropertiesPanel.currentFrontmatter[key];
            if (value === undefined || value === null || value === '') return;

            if (Array.isArray(value)) {
                if (value.length === 0) return;
                if (value.length === 1) {
                    fmLines.push(key + ': ' + value[0]);
                } else {
                    fmLines.push(key + ': [' + value.join(', ') + ']');
                }
            } else if (typeof value === 'boolean') {
                fmLines.push(key + ': ' + value);
            } else if (typeof value === 'number') {
                fmLines.push(key + ': ' + value);
            } else {
                var strValue = String(value);
                if (strValue.includes(':') || strValue.includes('#') || strValue.match(/^[0-9]/)) {
                    fmLines.push(key + ': "' + strValue + '"');
                } else {
                    fmLines.push(key + ': ' + strValue);
                }
            }
        });

        // Get body from CURRENT note.content (freshly synced from blocks by syncContent)
        // This avoids using stale this.currentBody from the last render() call
        var currentContent = note.content || '';
        var body = currentContent;
        // If content already has frontmatter, strip it to get only the body
        if (currentContent.startsWith('---')) {
            var endIdx = currentContent.indexOf('---', 3);
            if (endIdx > 0) {
                body = currentContent.substring(endIdx + 3);
            }
        }

        if (fmLines.length > 0) {
            note.content = '---\n' + fmLines.join('\n') + '\n---\n' + body.trimStart();
        } else if (body) {
            note.content = body;
        }

        // Update MetadataCache
        if (window.MetadataCache && window.MetadataCache.updateNote) {
            window.MetadataCache.updateNote(note.id);
        }
    },

    /**
     * Toggle the panel expanded/collapsed
     */
    toggle: function() {
        this.expanded = !this.expanded;
        if (this.panelEl) {
            this.panelEl.classList.toggle('collapsed', !this.expanded);
        }
    },

    // ─── Internal Methods ───────────────────────

    _ensurePanel: function() {
        if (this.panelEl && this.panelEl.parentNode) return;

        var panel = document.createElement('div');
        panel.id = 'note-properties-panel';
        panel.className = 'note-properties-panel collapsed';
        this.panelEl = panel;

        // Insert after title input, before block-editor
        var titleInput = document.getElementById('active-note-title');
        var blockEditor = document.getElementById('block-editor');
        if (titleInput && titleInput.parentNode) {
            titleInput.parentNode.insertBefore(panel, titleInput.nextSibling);
        } else if (blockEditor && blockEditor.parentNode) {
            blockEditor.parentNode.insertBefore(panel, blockEditor);
        } else {
            document.body.appendChild(panel);
        }

        // Toggle header
        var header = document.createElement('div');
        header.className = 'prop-header';
        header.innerHTML = '<span class="prop-header-icon">⚙</span><span class="prop-header-title">PROPERTIES</span><span class="prop-header-toggle">▸</span>';
        header.addEventListener('click', function() {
            PropertiesPanel.toggle();
        });
        panel.appendChild(header);

        // Properties container
        var body = document.createElement('div');
        body.className = 'prop-body';
        panel.appendChild(body);

        // Add property button area
        var footer = document.createElement('div');
        footer.className = 'prop-footer';
        panel.appendChild(footer);
    },

    _parseFromContent: function(note) {
        var fullContent = note.content || '';
        if (note.blocks && note.blocks.length > 0) {
            fullContent = note.blocks.map(function(b) { return b.content || ''; }).join('\n');
        }

        // Parse frontmatter using MetadataCache if available
        if (window.MetadataCache && window.MetadataCache.parseFrontmatter) {
            var result = window.MetadataCache.parseFrontmatter(fullContent);
            this.currentFrontmatter = JSON.parse(JSON.stringify(result.frontmatter));
            this.currentBody = result.body;
        } else {
            // Simple fallback parse
            var fmMatch = fullContent.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
            if (fmMatch) {
                var fmText = fmMatch[1];
                this.currentBody = fmMatch[2] || '';
                this.currentFrontmatter = {};
                fmText.split('\n').forEach(function(line) {
                    var match = line.match(/^\s*([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
                    if (match) {
                        var key = match[1].trim();
                        var value = match[2].trim();
                        // Handle arrays
                        if (value.startsWith('[') && value.endsWith(']')) {
                            value = value.slice(1, -1).split(',').map(function(v) { return v.trim(); });
                        }
                        // Handle booleans
                        if (value === 'true') value = true;
                        else if (value === 'false') value = false;
                        // Handle numbers
                        else if (!isNaN(value)) value = parseFloat(value);
                        PropertiesPanel.currentFrontmatter[key] = value;
                    }
                });
            } else {
                this.currentFrontmatter = {};
                this.currentBody = fullContent;
            }
        }
    },

    _readValuesFromDOM: function() {
        if (!this.panelEl) return;
        var rows = this.panelEl.querySelectorAll('.prop-row');
        var self = this;
        rows.forEach(function(row) {
            var key = row.getAttribute('data-prop-key');
            if (!key) return;
            var input = row.querySelector('.prop-value-input');
            if (!input) return;

            if (input.tagName === 'SELECT') {
                self.currentFrontmatter[key] = input.value || '';
            } else if (row.getAttribute('data-prop-type') === 'array') {
                // Tags/aliases - comma separated
                var val = input.value.trim();
                self.currentFrontmatter[key] = val ? val.split(',').map(function(v) { return v.trim(); }).filter(Boolean) : [];
            } else {
                var val = input.value.trim();
                // Preserve type
                if (val === 'true') self.currentFrontmatter[key] = true;
                else if (val === 'false') self.currentFrontmatter[key] = false;
                else if (val === '' && typeof self.currentFrontmatter[key] === 'boolean') {
                    self.currentFrontmatter[key] = false;
                } else self.currentFrontmatter[key] = val;
            }
        });
    },

    _renderPanel: function() {
        if (!this.panelEl) return;
        var body = this.panelEl.querySelector('.prop-body');
        var footer = this.panelEl.querySelector('.prop-footer');
        if (!body || !footer) return;

        var hasProperties = Object.keys(this.currentFrontmatter).length > 0;
        body.innerHTML = '';

        if (!hasProperties) {
            // Empty state - show "Add property" prompt
            var emptyEl = document.createElement('div');
            emptyEl.className = 'prop-empty';
            emptyEl.textContent = 'Add YAML frontmatter to this note to see properties here';
            body.appendChild(emptyEl);
            this._renderFooter(footer);
            this.panelEl.classList.toggle('has-props', false);
            return;
        }

        this.panelEl.classList.toggle('has-props', true);

        // Sort: known properties first in defined order, then custom
        var knownOrder = ['title', 'tags', 'aliases', 'date', 'status', 'created', 'modified', 'pinned', 'template', 'type'];
        var knownKeys = [];
        var customKeys = [];

        Object.keys(this.currentFrontmatter).forEach(function(key) {
            if (knownOrder.indexOf(key) !== -1) {
                knownKeys.push(key);
            } else {
                customKeys.push(key);
            }
        });

        // Sort known keys by their order in knownOrder
        knownKeys.sort(function(a, b) {
            return knownOrder.indexOf(a) - knownOrder.indexOf(b);
        });

        customKeys.sort();

        var allKeys = knownKeys.concat(customKeys);
        var self = this;

        allKeys.forEach(function(key) {
            body.appendChild(self._createPropertyRow(key, self.currentFrontmatter[key]));
        });

        this._renderFooter(footer);
    },

    _createPropertyRow: function(key, value) {
        var row = document.createElement('div');
        row.className = 'prop-row';
        row.setAttribute('data-prop-key', key);

        // Key label
        var label = document.createElement('span');
        label.className = 'prop-key';
        var icon = this.PROPERTY_ICONS[key] || '⋯';
        var displayLabel = this.PROPERTY_LABELS[key] || key;
        label.innerHTML = '<span class="prop-key-icon">' + icon + '</span><span class="prop-key-text">' + displayLabel + '</span>';
        row.appendChild(label);

        // Value input
        var isArray = Array.isArray(value);
        var isBool = typeof value === 'boolean';
        var input;

        if (isArray) {
            input = document.createElement('input');
            input.type = 'text';
            input.className = 'prop-value-input prop-value-array';
            input.value = value.join(', ');
            input.placeholder = value.length === 0 ? 'empty' : 'comma-separated';
            input.title = 'Comma-separated values';
            row.setAttribute('data-prop-type', 'array');
        } else if (isBool) {
            input = document.createElement('select');
            input.className = 'prop-value-input prop-value-boolean';
            var trueOpt = document.createElement('option');
            trueOpt.value = 'true';
            trueOpt.textContent = 'true';
            var falseOpt = document.createElement('option');
            falseOpt.value = 'false';
            falseOpt.textContent = 'false';
            if (value) trueOpt.selected = true;
            else falseOpt.selected = true;
            input.appendChild(trueOpt);
            input.appendChild(falseOpt);
        } else if (key === 'status') {
            // Status dropdown with presets
            input = document.createElement('select');
            input.className = 'prop-value-input prop-value-status';
            input.setAttribute('data-placeholder', 'Select status...');
            this.STATUS_OPTIONS.forEach(function(s) {
                var opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s;
                if (String(value) === s) opt.selected = true;
                input.appendChild(opt);
            });
        } else if (key === 'date') {
            input = document.createElement('input');
            input.type = 'date';
            input.className = 'prop-value-input prop-value-date';
            input.value = value || '';
        } else {
            input = document.createElement('input');
            input.type = 'text';
            input.className = 'prop-value-input';
            input.value = value !== undefined && value !== null ? String(value) : '';
            input.placeholder = 'Add ' + displayLabel + '...';
        }

        row.appendChild(input);

        // Tag autocomplete for tags field
        if (key === 'tags') {
            this._addTagAutocomplete(input);
        }

        // Delete button for custom properties
        if (knownOrder.indexOf(key) === -1) {
            var delBtn = document.createElement('span');
            delBtn.className = 'prop-delete-btn';
            delBtn.textContent = '×';
            delBtn.title = 'Remove property';
            delBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                PropertiesPanel._removeProperty(key);
            });
            row.appendChild(delBtn);
        }

        return row;
    },

    _addTagAutocomplete: function(input) {
        // Add a datalist for autocomplete from MetadataCache
        if (!window.MetadataCache || !window.MetadataCache.getAllTags) return;

        var allTags = window.MetadataCache.getAllTags();
        var tagList = Object.keys(allTags);

        if (tagList.length === 0) return;

        var datalistId = 'prop-tags-datalist';
        var existing = document.getElementById(datalistId);
        if (!existing) {
            var dl = document.createElement('datalist');
            dl.id = datalistId;
            document.body.appendChild(dl);
            existing = dl;
        }

        existing.innerHTML = '';
        tagList.forEach(function(tag) {
            var opt = document.createElement('option');
            opt.value = tag;
            existing.appendChild(opt);
        });

        input.setAttribute('list', datalistId);
    },

    _removeProperty: function(key) {
        delete this.currentFrontmatter[key];
        this._renderPanel();
        // Trigger save
        var note = State.NOTES.find(function(n) { return n.id === PropertiesPanel.activeNoteId; });
        if (note && window.Notes) {
            PropertiesPanel.syncToNote(note);
            saveData();
            if (window.MetadataCache) window.MetadataCache.updateNote(note.id);
        }
    },

    _onPropertyChange: function(key, input) {
        // Debounce: wait for blur to capture final value
        // Values are read in syncToNote on save
    },

    _renderFooter: function(footerEl) {
        footerEl.innerHTML = '';
        var addBtn = document.createElement('button');
        addBtn.className = 'prop-add-btn';
        addBtn.textContent = '+ Add Property';
        addBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            PropertiesPanel._showAddPropertyModal();
        });
        footerEl.appendChild(addBtn);
    },

    _showAddPropertyModal: function() {
        // Use a simple inline prompt-style UI
        var existing = document.getElementById('prop-add-modal');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'prop-add-modal';
        overlay.className = 'prop-add-modal';

        var box = document.createElement('div');
        box.className = 'prop-add-box';

        var closeBtn = document.createElement('span');
        closeBtn.className = 'prop-add-close';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', function() { overlay.remove(); });

        var title = document.createElement('div');
        title.className = 'prop-add-title';
        title.textContent = 'Add Property';

        var keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.className = 'prop-add-input';
        keyInput.placeholder = 'Property name (e.g., priority)';

        var valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.className = 'prop-add-input';
        valueInput.placeholder = 'Value (or leave blank for empty)';

        var confirmBtn = document.createElement('button');
        confirmBtn.className = 'prop-add-confirm';
        confirmBtn.textContent = 'Add';

        confirmBtn.addEventListener('click', function() {
            var k = keyInput.value.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
            var v = valueInput.value.trim();
            if (k) {
                PropertiesPanel.currentFrontmatter[k] = v || '';
                PropertiesPanel._renderPanel();
                overlay.remove();
                // Trigger save
                var note = State.NOTES.find(function(n) { return n.id === PropertiesPanel.activeNoteId; });
                if (note && window.Notes) {
                    PropertiesPanel.syncToNote(note);
                    saveData();
                    if (window.MetadataCache) window.MetadataCache.updateNote(note.id);
                }
            }
        });

        keyInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') valueInput.focus();
            if (e.key === 'Escape') overlay.remove();
        });
        valueInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') confirmBtn.click();
            if (e.key === 'Escape') overlay.remove();
        });

        box.appendChild(closeBtn);
        box.appendChild(title);
        box.appendChild(keyInput);
        box.appendChild(valueInput);
        box.appendChild(confirmBtn);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        setTimeout(function() { keyInput.focus(); }, 50);
    },

    _show: function() {
        if (this.panelEl) {
            this.panelEl.classList.add('active');
            if (this.expanded) {
                this.panelEl.classList.remove('collapsed');
            } else {
                this.panelEl.classList.add('collapsed');
            }
        }
    },

    _hide: function() {
        if (this.panelEl) {
            this.panelEl.classList.remove('active');
        }
        // Clean up tag autocomplete datalist
        var datalist = document.getElementById('prop-tags-datalist');
        if (datalist) datalist.remove();
    }
};

// Export to window
if (typeof window !== 'undefined') {
    window.PropertiesPanel = PropertiesPanel;
}
