

import { State } from '../core/Store.js';
import { MetadataCache } from '../core/MetadataCache.js';
import { CommandRegistry } from '../core/CommandRegistry.js';

export const DataviewQuery = {
    isOpen: false,
    currentQuery: '',
    lastResults: null,

    // Auto-complete state
    _suggestions: [],
    _selectedSuggestionIndex: -1,
    _suggestionContext: null, // 'tag', 'folder', or null
    _suggestionStartPos: -1,

    init: function () {
        this._injectDOM();
    },

    open: function () {
        if (this.isOpen) return;
        this.isOpen = true;
        this.currentQuery = '';
        this.lastResults = null;
        this._hideSuggestions();

        var overlay = document.getElementById('dv-overlay');
        var modal = document.getElementById('dv-modal');
        var input = document.getElementById('dv-input');
        var results = document.getElementById('dv-results');
        var error = document.getElementById('dv-error');
        var footer = document.getElementById('dv-footer');

        if (!overlay || !modal) return;

        overlay.classList.add('active');
        modal.classList.add('active');

        if (results) results.innerHTML = '<div class="dv-empty">Enter a query above to search notes</div>';
        if (error) error.style.display = 'none';
        if (footer) footer.innerHTML = '<span class="dv-footer-hint"><kbd>ESC</kbd> close</span><span class="dv-footer-examples">LIST | TABLE prop | TASK | SORT BY | GROUP BY | LIMIT</span>';
        if (input) {
            input.value = '';
            input.focus();
        }

        this._bindEvents();
    },

    close: function () {
        if (!this.isOpen) return;
        this.isOpen = false;

        var overlay = document.getElementById('dv-overlay');
        var modal = document.getElementById('dv-modal');

        if (overlay) overlay.classList.remove('active');
        if (modal) modal.classList.remove('active');

        this._unbindEvents();
        this.lastResults = null;
        this._hideSuggestions();
    },

    
    openWithQuery: function (query) {
        this.open();
        if (query && query.trim()) {
            var input = document.getElementById('dv-input');
            if (input) {
                input.value = query;
                this._onQuery();
            }
        }
    },

    
    parseQuery: function (query) {
        if (!query || !query.trim()) return null;

        var trimmed = query.trim();
        var result = {
            type: 'list',
            fields: [],
            source: null,
            where: null,
            sortBy: null,
            groupBy: null,
            limit: null
        };

        // Normalize: uppercase the command keywords for parsing
        var normalized = trimmed;

        // --- Extract trailing clauses from the end inward ---

        // 1. LIMIT (always last)
        var limitMatch = normalized.match(/\s+LIMIT\s+(\d+)\s*$/i);
        if (limitMatch) {
            result.limit = parseInt(limitMatch[1], 10);
            normalized = normalized.slice(0, limitMatch.index);
        }

        // 2. SORT BY field [ASC|DESC]
        var sortMatch = normalized.match(/\s+SORT\s+BY\s+([a-zA-Z0-9_-]+)(?:\s+(ASC|DESC))?\s*$/i);
        if (sortMatch) {
            result.sortBy = {
                field: sortMatch[1],
                dir: (sortMatch[2] || 'ASC').toLowerCase()
            };
            normalized = normalized.slice(0, sortMatch.index);
        }

        // 3. GROUP BY field
        var groupMatch = normalized.match(/\s+GROUP\s+BY\s+([a-zA-Z0-9_-]+)\s*$/i);
        if (groupMatch) {
            result.groupBy = {
                field: groupMatch[1]
            };
            normalized = normalized.slice(0, groupMatch.index);
        }

        // --- Extract WHERE clause (remaining after stripping trailing clauses) ---
        var whereMatch = normalized.match(/\s+WHERE\s+(.+)/i);
        var whereClause = null;
        if (whereMatch) {
            normalized = normalized.slice(0, whereMatch.index);
            var whereParts = whereMatch[1].match(/([a-zA-Z0-9_-]+)\s*=\s*(.+)/);
            if (whereParts) {
                result.where = {
                    key: whereParts[1].trim(),
                    value: whereParts[2].trim().replace(/^["']|["']$/g, '')
                };
            }
        }

        // --- Detect command type ---
        var typeMatch = normalized.match(/^(LIST|TABLE|TASK)\s*/i);
        if (typeMatch) {
            result.type = typeMatch[1].toLowerCase();
            normalized = normalized.slice(typeMatch[0].length);
        }

        // --- Extract TABLE fields ---
        if (result.type === 'table') {
            var fieldsMatch = normalized.match(/^([a-zA-Z0-9_,\s]+?)\s+FROM\s+/i);
            if (fieldsMatch) {
                result.fields = fieldsMatch[1].split(',').map(function (f) { return f.trim(); }).filter(Boolean);
                normalized = normalized.slice(fieldsMatch[0].length - 5); // keep "FROM "
            }
        }

        // --- Extract FROM clause ---
        var fromMatch = normalized.match(/FROM\s+(.+)/i);
        if (fromMatch) {
            var sourceStr = fromMatch[1].trim();
            // Tag source: #tag
            var tagMatch = sourceStr.match(/^#([a-zA-Z0-9_-]+)/);
            if (tagMatch) {
                result.source = { type: 'tag', value: tagMatch[1] };
            }
            // Folder source: "folder/path"
            var folderMatch = sourceStr.match(/^"([^"]+)"/);
            if (!result.source && folderMatch) {
                result.source = { type: 'folder', value: folderMatch[1] };
            }
        }

        // --- Shorthand: if no FROM clause, detect shorthand ---
        if (!result.source) {
            // Just #tag
            var shTag = trimmed.match(/^#([a-zA-Z0-9_-]+)/);
            if (shTag) {
                result.source = { type: 'tag', value: shTag[1] };
            }
            // Just "folder"
            var shFolder = trimmed.match(/^"([^"]+)"/);
            if (!result.source && shFolder) {
                result.source = { type: 'folder', value: shFolder[1] };
            }
        }

        return result;
    },

    
    _getPropertyValue: function (note, field) {
        // Check frontmatter first
        var fullContent = note.content || '';
        if (note.blocks && note.blocks.length > 0) {
            fullContent = note.blocks.map(function (b) { return b.content || ''; }).join('\n');
        }
        var parsedFM = MetadataCache.parseFrontmatter(fullContent);
        if (parsedFM.frontmatter[field] !== undefined) {
            return parsedFM.frontmatter[field];
        }
        // Computed fields
        if (field === 'title') return note.title || '';
        if (field === 'path') return note.path || '/';
        if (field === 'modified') return note.modified || note.created || 0;
        if (field === 'created') return note.created || 0;
        return '';
    },

    
    executeQuery: function (parsed) {
        if (!parsed || !parsed.source) return [];

        var notes = [];

        // Get notes from source
        if (parsed.source.type === 'tag') {
            var metadatas = MetadataCache.getByTag(parsed.source.value) || [];
            // Map back to State.NOTES entries (which have full block data)
            var idSet = {};
            metadatas.forEach(function (m) { idSet[m.id] = true; });
            notes = (State.NOTES || []).filter(function (n) { return idSet[n.id]; });
        } else if (parsed.source.type === 'folder') {
            var folderPath = '/' + parsed.source.value.replace(/^\/+/, '');
            notes = (State.NOTES || []).filter(function (n) {
                return n.path && n.path.indexOf(folderPath) === 0;
            });
        }

        // Apply WHERE filter
        if (parsed.where) {
            notes = notes.filter(function (n) {
                var fullContent = n.content || '';
                if (n.blocks && n.blocks.length > 0) {
                    fullContent = n.blocks.map(function (b) { return b.content || ''; }).join('\n');
                }
                // Check frontmatter
                var parsedFM = MetadataCache.parseFrontmatter(fullContent);
                var propVal = parsedFM.frontmatter[parsed.where.key];
                if (propVal !== undefined && propVal !== null) {
                    return String(propVal).toLowerCase() === String(parsed.where.value).toLowerCase();
                }
                // Fallback: check content for key: value pattern
                return fullContent.toLowerCase().indexOf(parsed.where.key.toLowerCase() + ': ' + parsed.where.value.toLowerCase()) >= 0;
            });
        }

        // For TASK type, extract only notes that have tasks
        if (parsed.type === 'task') {
            notes = notes.filter(function (n) {
                if (n.blocks && n.blocks.length > 0) {
                    return n.blocks.some(function (b) { return b.type === 'task'; }) ||
                           (n.content || '').indexOf('- [') >= 0;
                }
                return (n.content || '').indexOf('- [') >= 0;
            });
        }

        // Apply SORT BY (overrides default modified desc sort)
        if (parsed.sortBy) {
            (function () {
                var self = DataviewQuery;
                notes.sort(function (a, b) {
                    var aVal = self._getPropertyValue(a, parsed.sortBy.field);
                    var bVal = self._getPropertyValue(b, parsed.sortBy.field);
                    var aStr = String(aVal).toLowerCase();
                    var bStr = String(bVal).toLowerCase();
                    if (aStr === bStr) return 0;
                    var cmp = aStr < bStr ? -1 : 1;
                    return parsed.sortBy.dir === 'desc' ? -cmp : cmp;
                });
            })();
        } else {
            // Default sort by modified date descending
            notes.sort(function (a, b) {
                return (b.modified || b.created || 0) - (a.modified || a.created || 0);
            });
        }

        // Apply LIMIT (0 means no results, null means no limit)
        if (parsed.limit !== null && parsed.limit !== undefined && parsed.limit >= 0) {
            notes = notes.slice(0, parsed.limit);
        }

        return notes;
    },

    
    renderResults: function (notes, parsed) {
        var container = document.getElementById('dv-results');
        var error = document.getElementById('dv-error');
        var footer = document.getElementById('dv-footer');
        if (!container) return;

        // Hide error
        if (error) error.style.display = 'none';

        if (!notes || notes.length === 0) {
            container.innerHTML = '<div class="dv-empty">No results found</div>';
            if (footer) {
                footer.innerHTML = '<span class="dv-footer-hint"><kbd>ESC</kbd> close</span><span class="dv-footer-count">0 results</span>';
            }
            return;
        }

        var html = '';
        var self = this;

        // Handle GROUP BY at the render level
        if (parsed.groupBy && parsed.groupBy.field) {
            // Group notes by the specified field
            var groups = {};
            var groupOrder = [];
            notes.forEach(function (note) {
                var val = String(self._getPropertyValue(note, parsed.groupBy.field)) || '(none)';
                if (!groups[val]) {
                    groups[val] = [];
                    groupOrder.push(val);
                }
                groups[val].push(note);
            });

            // Render each group with its type-specific view
            groupOrder.forEach(function (groupVal) {
                html += '<div class="dv-group-header">' +
                    self._escapeHtml(groupVal) +
                    ' <span class="dv-group-count">' + groups[groupVal].length + '</span></div>';

                switch (parsed.type) {
                    case 'table':
                        html += self._renderTableView(groups[groupVal], parsed);
                        break;
                    case 'task':
                        html += self._renderTaskView(groups[groupVal], parsed);
                        break;
                    default:
                        html += self._renderListView(groups[groupVal], parsed);
                        break;
                }
            });
        } else {
            // Normal rendering by type
            switch (parsed.type) {
                case 'table':
                    html += this._renderTableView(notes, parsed);
                    break;
                case 'task':
                    html += this._renderTaskView(notes, parsed);
                    break;
                case 'list':
                default:
                    html += this._renderListView(notes, parsed);
                    break;
            }
        }

        container.innerHTML = html;

        // Bind click handlers to open notes
        var clickableItems = container.querySelectorAll('.dv-result-item[data-note-id], .dv-task-item[data-note-id], .dv-task-group-title[data-note-id]');
        Array.from(clickableItems).forEach(function (el) {
            el.onclick = function () {
                var noteId = el.getAttribute('data-note-id');
                if (noteId && window.Notes) {
                    self.close();
                    window.Notes.open(noteId);
                }
            };
        });

        // Update footer count and show active clauses
        if (footer) {
            var countStr = notes.length + ' result' + (notes.length !== 1 ? 's' : '');
            var clauses = '';
            if (parsed.groupBy) clauses += ' GROUP BY ' + parsed.groupBy.field;
            if (parsed.sortBy) clauses += ' SORT BY ' + parsed.sortBy.field + ' ' + parsed.sortBy.dir.toUpperCase();
            if (parsed.limit) clauses += ' LIMIT ' + parsed.limit;
            footer.innerHTML = '<span class="dv-footer-hint"><kbd>ESC</kbd> close</span>' +
                (clauses ? '<span class="dv-footer-clauses">' + clauses + '</span>' : '') +
                '<span class="dv-footer-count">' + countStr + '</span>';
        }
    },

    
    _renderListView: function (notes, parsed) {
        var html = '<div class="dv-results-list">';
        var self = this;

        notes.forEach(function (note) {
            var title = note.title || 'Untitled';
            var path = note.path || '/';
            var timeStr = '';
            if (note.modified) {
                var d = new Date(note.modified);
                timeStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }

            // Get snippet
            var snippet = '';
            var content = note.content || '';
            if (note.blocks && note.blocks.length > 0) {
                content = note.blocks.map(function (b) { return b.content || ''; }).join(' ').trim();
            }
            if (content) {
                snippet = content.replace(/[#*_`~\[\]]/g, '').substring(0, 80);
                if (content.length > 80) snippet += '...';
            }

            // Get tags from MetadataCache
            var meta = MetadataCache.get(note.id);
            var tags = (meta && meta.tags) || [];

            html += '<div class="dv-result-item" data-note-id="' + note.id + '">' +
                '<div class="dv-item-title">' + self._escapeHtml(title) + '</div>' +
                (snippet ? '<div class="dv-item-snippet">' + self._escapeHtml(snippet) + '</div>' : '') +
                '<div class="dv-item-meta">' +
                    '<span class="dv-item-path">' + self._escapeHtml(path) + '</span>' +
                    (tags.length > 0 ? '<span class="dv-item-tags">' + tags.map(function (t) { return '#' + t; }).join(' ') + '</span>' : '') +
                    (timeStr ? '<span class="dv-item-time">' + timeStr + '</span>' : '') +
                '</div>' +
                '</div>';
        });

        html += '</div>';
        return html;
    },

    
    _renderTableView: function (notes, parsed) {
        var fields = parsed.fields;
        if (fields.length === 0) fields = ['created', 'modified', 'tags'];
        var self = this;

        var html = '<div class="dv-table-wrapper"><table class="dv-table">';

        html += '<thead><tr><th>NOTE</th>';
        fields.forEach(function (f) {
            html += '<th>' + self._escapeHtml(f.toUpperCase()) + '</th>';
        });
        html += '<th>PATH</th></tr></thead><tbody>';

        notes.forEach(function (note) {
            var title = note.title || 'Untitled';
            var path = note.path || '/';
            var meta = MetadataCache.get(note.id);

            html += '<tr class="dv-result-item" data-note-id="' + note.id + '">' +
                '<td class="dv-cell-title">' + self._escapeHtml(title) + '</td>';

            fields.forEach(function (field) {
                var val = '';
                if (meta && meta.frontmatter && meta.frontmatter[field] !== undefined) {
                    val = String(meta.frontmatter[field]);
                } else if (field === 'created' && note.created) {
                    val = new Date(note.created).toLocaleDateString();
                } else if (field === 'modified' && note.modified) {
                    val = new Date(note.modified).toLocaleDateString();
                } else if (field === 'tags' && meta && meta.tags) {
                    val = meta.tags.join(', ');
                } else if (field === 'wordCount' && meta) {
                    val = String(meta.wordCount || 0);
                } else if (field === 'blockCount' && meta) {
                    val = String(meta.blockCount || 0);
                }

                html += '<td class="dv-cell">' + self._escapeHtml(val) + '</td>';
            });

            html += '<td class="dv-cell-path">' + self._escapeHtml(path) + '</td></tr>';
        });

        html += '</tbody></table></div>';
        return html;
    },

    
    _renderTaskView: function (notes, parsed) {
        var html = '<div class="dv-task-list">';
        var self = this;

        notes.forEach(function (note) {
            var title = note.title || 'Untitled';
            var path = note.path || '/';

            // Get open (unchecked) tasks from this note
            var blocks = note.blocks || [];
            var tasks = blocks.filter(function (b) { return b.type === 'task'; });

            if (tasks.length === 0) {
                // Try parsing from content as fallback
                var content = note.content || '';
                var lines = content.split('\n');
                lines.forEach(function (line) {
                    var taskMatch = line.match(/^- \[([ x])\] (.+)/);
                    if (taskMatch) {
                        tasks.push({
                            type: 'task',
                            checked: taskMatch[1] === 'x',
                            content: taskMatch[2]
                        });
                    }
                });
            }

            if (tasks.length === 0) return;

            html += '<div class="dv-task-group">' +
                '<div class="dv-task-group-title" data-note-id="' + note.id + '">' +
                self._escapeHtml(title) +
                ' <span class="dv-task-group-path">' + self._escapeHtml(path) + '</span>' +
                '</div>';

            tasks.forEach(function (task) {
                var checked = task.checked;
                var taskText = task.content || '';
                html += '<div class="dv-task-item" data-note-id="' + note.id + '">' +
                    '<span class="dv-task-checkbox' + (checked ? ' dv-task-done' : '') + '">' +
                    (checked ? '[x]' : '[ ]') +
                    '</span>' +
                    '<span class="dv-task-text' + (checked ? ' dv-task-done' : '') + '">' +
                    self._escapeHtml(taskText) +
                    '</span>' +
                    '</div>';
            });

            html += '</div>';
        });

        html += '</div>';
        return html;
    },

    
    _onQuery: function () {
        var input = document.getElementById('dv-input');
        if (!input) return;

        var query = input.value.trim();
        if (!query) return;

        this.currentQuery = query;

        // Parse query
        var parsed = this.parseQuery(query);
        var errorEl = document.getElementById('dv-error');

        if (!parsed || !parsed.source) {
            if (errorEl) {
                errorEl.textContent = 'Could not parse query. Try: LIST FROM #tag, TABLE prop FROM "folder", TASK FROM #tag';
                errorEl.style.display = 'block';
            }
            return;
        }

        // Hide error
        if (errorEl) errorEl.style.display = 'none';

        // Execute
        var notes = this.executeQuery(parsed);

        // Store for refresh
        this.lastResults = { notes: notes, parsed: parsed };

        // Render
        this.renderResults(notes, parsed);
    },

    
    refresh: function () {
        if (this.lastResults) {
            this.renderResults(this.lastResults.notes, this.lastResults.parsed);
        }
    },

    // ─── DOM Injection ─────────────────────────────────────────

    _injectDOM: function () {
        if (document.getElementById('dv-overlay')) return;

        // Overlay
        var overlay = document.createElement('div');
        overlay.id = 'dv-overlay';
        overlay.className = 'dv-overlay';
        overlay.onclick = this.close.bind(this);
        document.body.appendChild(overlay);

        // Modal
        var modal = document.createElement('div');
        modal.id = 'dv-modal';
        modal.className = 'dv-modal';

        // Header
        var header = document.createElement('div');
        header.className = 'dv-header';

        var icon = document.createElement('span');
        icon.className = 'dv-icon';
        icon.textContent = '\uD83D\uDD0D'; // Magnifying glass
        header.appendChild(icon);

        var input = document.createElement('input');
        input.id = 'dv-input';
        input.type = 'text';
        input.placeholder = 'LIST FROM #tag  |  TABLE prop FROM "folder"  |  TASK FROM #tag WHERE status = Active';
        input.autocomplete = 'off';
        input.spellcheck = false;
        header.appendChild(input);

        var runBtn = document.createElement('button');
        runBtn.id = 'dv-run-btn';
        runBtn.className = 'dv-run-btn';
        runBtn.textContent = 'RUN';
        runBtn.onclick = this._onQuery.bind(this);
        header.appendChild(runBtn);

        modal.appendChild(header);

        // Error area
        var error = document.createElement('div');
        error.id = 'dv-error';
        error.className = 'dv-error';
        error.style.display = 'none';
        modal.appendChild(error);

        // Results area
        var results = document.createElement('div');
        results.id = 'dv-results';
        results.className = 'dv-results';
        modal.appendChild(results);

        // Footer
        var footer = document.createElement('div');
        footer.id = 'dv-footer';
        footer.className = 'dv-footer';
        modal.appendChild(footer);

        document.body.appendChild(modal);

        // Suggestions dropdown (positioned absolutely relative to viewport)
        var suggestions = document.createElement('div');
        suggestions.id = 'dv-suggestions';
        suggestions.className = 'dv-suggestions';
        document.body.appendChild(suggestions);
    },

    // ─── Auto-Complete ─────────────────────────────────────────

    
    _onInputChange: function () {
        var input = document.getElementById('dv-input');
        if (!input) return;

        var value = input.value;
        var pos = input.selectionStart || 0;

        // Look backwards from cursor to find the current word context
        var beforeCursor = value.substring(0, pos);

        // Check for #tag context
        var hashIndex = beforeCursor.lastIndexOf('#');
        var quoteIndex = beforeCursor.lastIndexOf('"');

        // Only trigger if # or " was found and isn't inside a completed word
        if (hashIndex >= 0 && hashIndex >= (beforeCursor.lastIndexOf(' ') + 1)) {
            // Check we're NOT inside a quoted string (even number of " means outside quotes)
            var beforeHash = beforeCursor.substring(0, hashIndex);
            var quoteCount = (beforeHash.match(/"/g) || []).length;
            if (quoteCount % 2 === 1) {
                // We're inside quotes, hide suggestions
                this._hideSuggestions();
                return;
            }

            var tagQuery = beforeCursor.substring(hashIndex + 1);
            // Only alphanumeric/dash/underscore for tag names
            if (/^[a-zA-Z0-9_-]*$/.test(tagQuery)) {
                this._showSuggestions('tag', '#' + tagQuery.toLowerCase(), hashIndex);
                return;
            }
        }

        // Check for "folder context
        if (quoteIndex >= 0 && quoteIndex >= (beforeCursor.lastIndexOf(' ') + 1)) {
            var folderQuery = beforeCursor.substring(quoteIndex + 1);
            // Allow folder chars: alphanumeric, dash, underscore, slash, space
            if (/^[a-zA-Z0-9_\-\/ ]*$/.test(folderQuery)) {
                this._showSuggestions('folder', '"' + folderQuery, quoteIndex);
                return;
            }
        }

        this._hideSuggestions();
    },

    
    _getFilteredSuggestions: function (type, query) {
        if (type === 'tag') {
            var prefix = query.replace(/^#/, '').toLowerCase();
            var allTags = MetadataCache.getAllTags() || {};
            var results = [];
            Object.keys(allTags).forEach(function (tag) {
                if (tag.indexOf(prefix) >= 0) {
                    results.push({
                        label: '#' + tag,
                        value: tag,
                        count: allTags[tag],
                        score: tag.indexOf(prefix) === 0 ? 1 : 0
                    });
                }
            });
            results.sort(function (a, b) {
                if (a.score !== b.score) return b.score - a.score;
                return a.value.localeCompare(b.value);
            });
            return results.slice(0, 12);
        }

        if (type === 'folder') {
            var folderPrefix = query.replace(/^"/, '').toLowerCase();
            var folders = {};
            (State.NOTES || []).forEach(function (note) {
                if (note.path && note.path !== '/') {
                    var parts = note.path.split('/').filter(Boolean);
                    // Collect each segment as a potential folder
                    for (var i = 0; i < parts.length; i++) {
                        var folderPath = '';
                        for (var j = 0; j <= i; j++) {
                            folderPath += (j > 0 ? '/' : '') + parts[j];
                        }
                        var lower = folderPath.toLowerCase();
                        if (lower.indexOf(folderPrefix) >= 0) {
                            folders[folderPath] = (folders[folderPath] || 0) + 1;
                        }
                    }
                }
            });
            var results = Object.keys(folders).map(function (f) {
                return { label: '"' + f + '"', value: f, count: folders[f] };
            });
            results.sort(function (a, b) { return a.value.localeCompare(b.value); });
            return results.slice(0, 12);
        }

        return [];
    },

    
    _showSuggestions: function (type, query, startPos) {
        // Prevent showing suggestions when results are already displayed
        // (not strictly necessary but avoids visual clutter)

        var suggestions = this._getFilteredSuggestions(type, query);

        if (suggestions.length === 0) {
            this._hideSuggestions();
            return;
        }

        this._suggestions = suggestions;
        this._selectedSuggestionIndex = 0;
        this._suggestionContext = type;
        this._suggestionStartPos = startPos;

        var dropdown = document.getElementById('dv-suggestions');
        if (!dropdown) return;

        var html = '';
        suggestions.forEach(function (s, i) {
            html += '<div class="dv-suggestion-item' + (i === 0 ? ' dv-suggestion-selected' : '') + '" data-index="' + i + '">' +
                '<span class="dv-suggestion-label">' + DataviewQuery._escapeHtml(s.label) + '</span>' +
                (s.count ? '<span class="dv-suggestion-count">' + s.count + '</span>' : '') +
                '</div>';
        });

        dropdown.innerHTML = html;
        dropdown.classList.add('active');

        // Position dropdown below the input
        var input = document.getElementById('dv-input');
        if (input) {
            var inputRect = input.getBoundingClientRect();
            dropdown.style.left = inputRect.left + 'px';
            dropdown.style.top = (inputRect.bottom + 2) + 'px';
            dropdown.style.width = Math.max(inputRect.width, 200) + 'px';
        }

        // Bind click handlers
        Array.from(dropdown.querySelectorAll('.dv-suggestion-item')).forEach(function (el) {
            el.addEventListener('mousedown', function (e) {
                e.preventDefault();
                var idx = parseInt(el.getAttribute('data-index'), 10);
                DataviewQuery._selectSuggestion(idx);
            });
        });
    },

    
    _hideSuggestions: function () {
        this._suggestions = [];
        this._selectedSuggestionIndex = -1;
        this._suggestionContext = null;
        this._suggestionStartPos = -1;

        var dropdown = document.getElementById('dv-suggestions');
        if (dropdown) {
            dropdown.classList.remove('active');
            dropdown.innerHTML = '';
        }
    },

    
    _selectSuggestion: function (index) {
        if (index < 0 || index >= this._suggestions.length) return;

        var suggestion = this._suggestions[index];
        var input = document.getElementById('dv-input');
        if (!input) return;

        var value = input.value;
        var pos = this._suggestionStartPos;

        // Build the replacement text
        if (this._suggestionContext === 'tag') {
            // Replace from # to cursor with #tag_name
            var replacement = '#' + suggestion.value;
            input.value = value.substring(0, pos) + replacement;
            // Add a space after the tag
            if (input.value.length > 0) {
                input.value += ' ';
            }
        } else if (this._suggestionContext === 'folder') {
            // Replace from " to cursor with "folder_name"
            var replacement = '"' + suggestion.value + '"';
            input.value = value.substring(0, pos) + replacement;
            // Add a space after the folder
            input.value += ' ';
        }

        // Move cursor to end of inserted text
        var newPos = input.value.length;
        input.setSelectionRange(newPos, newPos);
        input.focus();

        this._hideSuggestions();
    },

    // ─── Event Binding ─────────────────────────────────────────

    _bindEvents: function () {
        this._boundKeyHandler = this._onKeyDown.bind(this);
        document.addEventListener('keydown', this._boundKeyHandler);

        var input = document.getElementById('dv-input');
        if (input) {
            this._boundInputHandler = this._onInputKeyDown.bind(this);
            input.addEventListener('keydown', this._boundInputHandler);

            this._boundInputChangeHandler = this._onInputChange.bind(this);
            input.addEventListener('input', this._boundInputChangeHandler);

            // Hide suggestions on blur
            this._boundBlurHandler = function () {
                // Delay so click on suggestion can fire before hide
                setTimeout(function () {
                    if (DataviewQuery.isOpen) DataviewQuery._hideSuggestions();
                }, 150);
            };
            input.addEventListener('blur', this._boundBlurHandler);
        }
    },

    _unbindEvents: function () {
        if (this._boundKeyHandler) {
            document.removeEventListener('keydown', this._boundKeyHandler);
            this._boundKeyHandler = null;
        }
        if (this._boundInputHandler) {
            var input = document.getElementById('dv-input');
            if (input) {
                input.removeEventListener('keydown', this._boundInputHandler);
            }
            this._boundInputHandler = null;
        }
        if (this._boundInputChangeHandler) {
            var input = document.getElementById('dv-input');
            if (input) {
                input.removeEventListener('input', this._boundInputChangeHandler);
            }
            this._boundInputChangeHandler = null;
        }
        if (this._boundBlurHandler) {
            var input = document.getElementById('dv-input');
            if (input) {
                input.removeEventListener('blur', this._boundBlurHandler);
            }
            this._boundBlurHandler = null;
        }
    },

    _onKeyDown: function (e) {
        if (!this.isOpen) return;

        if (e.key === 'Escape') {
            if (this._suggestions.length > 0) {
                e.preventDefault();
                this._hideSuggestions();
                return;
            }
            e.preventDefault();
            this.close();
        }
    },

    _onInputKeyDown: function (e) {
        if (this._suggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._selectedSuggestionIndex = Math.min(this._selectedSuggestionIndex + 1, this._suggestions.length - 1);
                this._updateSelectedSuggestion();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._selectedSuggestionIndex = Math.max(this._selectedSuggestionIndex - 1, 0);
                this._updateSelectedSuggestion();
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                if (this._selectedSuggestionIndex >= 0) {
                    this._selectSuggestion(this._selectedSuggestionIndex);
                }
                return;
            }
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            this._onQuery();
        }
    },

    
    _updateSelectedSuggestion: function () {
        var dropdown = document.getElementById('dv-suggestions');
        if (!dropdown) return;

        var items = dropdown.querySelectorAll('.dv-suggestion-item');
        Array.from(items).forEach(function (el, i) {
            if (i === DataviewQuery._selectedSuggestionIndex) {
                el.classList.add('dv-suggestion-selected');
                el.scrollIntoView({ block: 'nearest' });
            } else {
                el.classList.remove('dv-suggestion-selected');
            }
        });
    },

    // ─── Utilities ────────────────────────────────────────────

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

// Expose globally
window.DataviewQuery = DataviewQuery;
