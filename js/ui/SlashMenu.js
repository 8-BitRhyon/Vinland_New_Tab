/**
 * SlashMenu - Command palette for BlockEditor
 * Extracted from vinland.js for modular architecture
 *
 * v2 — Categories, recently-used tracking, always-visible search
 */

export const SlashMenu = {
    element: null,
    visible: false,
    targetBlockId: null,
    selectedIndex: 0,
    filterQuery: '',

    // ── Category definitions ──────────────────────────────────
    categories: [
        { id: 'basic',   label: 'Basic Blocks' },
        { id: 'media',   label: 'Media & Advanced' },
        { id: 'insert',  label: 'Insert' },
        { id: 'align',   label: 'Alignment' },
    ],

    // ── Recent tracking (persisted in localStorage) ──────────
    _recent: [],
    RECENT_KEY: 'vinland_slash_recent',
    MAX_RECENT: 6,

    loadRecent: function () {
        try {
            var stored = localStorage.getItem(this.RECENT_KEY);
            this._recent = stored ? JSON.parse(stored) : [];
        } catch (_) { this._recent = []; }
    },

    saveRecent: function () {
        try { localStorage.setItem(this.RECENT_KEY, JSON.stringify(this._recent)); } catch (_) {}
    },

    _touchRecent: function (cmdId) {
        // Move to front, deduplicate, trim
        var idx = this._recent.indexOf(cmdId);
        if (idx !== -1) this._recent.splice(idx, 1);
        this._recent.unshift(cmdId);
        if (this._recent.length > this.MAX_RECENT) this._recent.pop();
        this.saveRecent();
    },

    // ── Command registry ──────────────────────────────────────
    allCommands: [
        // Basic Blocks
        { id: 'h1',        label: 'Heading 1',        icon: 'H1',   shortcut: '/h1',      category: 'basic' },
        { id: 'h2',        label: 'Heading 2',        icon: 'H2',   shortcut: '/h2',      category: 'basic' },
        { id: 'h3',        label: 'Heading 3',        icon: 'H3',   shortcut: '/h3',      category: 'basic' },
        { id: 'bullet',    label: 'Bulleted List',    icon: '•',    shortcut: '/bullet',  category: 'basic' },
        { id: 'numbered',  label: 'Numbered List',    icon: '1.',   shortcut: '/number',  category: 'basic' },
        { id: 'task',      label: 'To-do List',       icon: '[ ]',  shortcut: '/todo',    category: 'basic' },
        { id: 'quote',     label: 'Blockquote',       icon: '"',    shortcut: '/quote',   category: 'basic' },
        { id: 'divider',   label: 'Divider',          icon: '---',  shortcut: '/div',     category: 'basic' },

        // Media & Advanced
        { id: 'code',      label: 'Code Block',       icon: '</>',  shortcut: '/code',    category: 'media' },
        { id: 'image',     label: 'Image',            icon: 'IMG',  shortcut: '/image',   category: 'media' },
        { id: 'callout',   label: 'Callout',          icon: '!!',   shortcut: '/callout', category: 'media' },
        { id: 'kanban',    label: 'Kanban Board',     icon: '[=]',  shortcut: '/board',   category: 'media' },
        { id: 'table',     label: 'Simple Table',     icon: '#',    shortcut: '/table',   category: 'media' },
        { id: 'canvas',    label: 'Open Canvas',      icon: '[C]',  shortcut: '/canvas',  category: 'media' },
        { id: 'query',     label: 'Query (Dataview)', icon: '🔍',  shortcut: '/query',   category: 'media', action: function() {
            if (window.BlockEditor) window.BlockEditor.insertBlock('query', 'LIST FROM #tasks');
        }},
        { id: 'color',     label: 'Block Color',       icon: '🎨',  shortcut: '/color',   category: 'media' },

        // Insert
        { id: 'cmd_time',    label: 'Insert Time',       icon: '🕒', shortcut: '/time',    category: 'insert' },
        { id: 'cmd_weather', label: 'Insert Weather',    icon: '☁️', shortcut: '/weather', category: 'insert' },
        { id: 'cmd_calc',    label: 'Calculator',        icon: '🧮', shortcut: '/calc',    category: 'insert' },

        // Alignment
        { id: 'align-left',   label: 'Align Left',   icon: '←',  shortcut: '/left',   category: 'align' },
        { id: 'align-center', label: 'Align Center', icon: '↔',  shortcut: '/center', category: 'align' },
        { id: 'align-right',  label: 'Align Right',  icon: '→',  shortcut: '/right',  category: 'align' },
    ],

    // ── Filtered commands (public getter, flat array) ────────
    get commands() {
        var query = this.filterQuery.toLowerCase();
        if (!query) return this.allCommands;
        return this.allCommands.filter(function(cmd) {
            return cmd.id.includes(query)
                || cmd.label.toLowerCase().includes(query)
                || cmd.shortcut.includes('/' + query);
        });
    },

    // ── Build display list for rendering (includes recent + category headers) ──
    _buildDisplayList: function () {
        var items = this.commands;  // flat filtered array
        if (this.filterQuery) {
            // When filtering, show flat — no recent, no categories
            return { interactive: items, hasRecent: false };
        }

        var interactive = [];
        var hasRecent = false;

        // Prepend recently used if available
        if (this._recent.length > 0) {
            var recentCmds = [];
            this._recent.forEach(function(id) {
                var cmd = null;
                for (var i = 0; i < this.allCommands.length; i++) {
                    if (this.allCommands[i].id === id) { cmd = this.allCommands[i]; break; }
                }
                if (cmd) recentCmds.push(cmd);
            }.bind(this));
            if (recentCmds.length > 0) {
                hasRecent = true;
                // Deduplicate: remove recent items from the main list so they don't appear twice
                var recentIds = {};
                recentCmds.forEach(function(c) { recentIds[c.id] = true; });
                items = items.filter(function(c) { return !recentIds[c.id]; });
                interactive = interactive.concat(recentCmds);
            }
        }

        interactive = interactive.concat(items);
        return { interactive: interactive, hasRecent: hasRecent };
    },

    // ── Lifecycle ─────────────────────────────────────────────
    init: function () {
        this.loadRecent();

        this.element = document.createElement('div');
        this.element.id = 'slash-menu';
        this.element.className = 'slash-menu';

        // Search container — always visible
        var searchContainer = document.createElement('div');
        searchContainer.id = 'slash-search-container';
        searchContainer.className = 'slash-search-container';

        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.placeholder = 'Search commands…';
        this.searchInput.className = 'slash-search-input';

        searchContainer.appendChild(this.searchInput);
        this.element.appendChild(searchContainer);

        this.itemsContainer = document.createElement('div');
        this.itemsContainer.id = 'slash-items-container';
        this.itemsContainer.className = 'slash-items-container';
        this.element.appendChild(this.itemsContainer);

        document.body.appendChild(this.element);

        var self = this;
        this.searchInput.addEventListener('input', function(e) {
            self.filterQuery = e.target.value;
            self.selectedIndex = 0;
            self.render();
        });

        document.addEventListener('keydown', function (e) {
            if (self.visible) self.handleKey(e);
        });

        document.addEventListener('click', function (e) {
            if (self.visible && !self.element.contains(e.target)) self.hide();
        });
    },

    show: function (blockEl, mouseEvent, isInline) {
        if (isInline === undefined) isInline = true;
        this.targetBlockId = blockEl.getAttribute('data-block-id');
        this.activeElement = document.activeElement;
        this.isInline = isInline;
        this.filterQuery = '';
        this.selectedIndex = 0;

        this.searchInput.value = '';
        this.render();

        // Always focus the search input — no gating
        var self = this;
        setTimeout(function() { self.searchInput.focus(); }, 10);

        const selection = window.getSelection();
        var menuTop, menuLeft;

        if (mouseEvent && mouseEvent.clientX) {
            menuTop = mouseEvent.clientY + window.scrollY;
            menuLeft = mouseEvent.clientX + window.scrollX;
        } else if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            if (rect.height === 0) {
                var blockRect = blockEl.getBoundingClientRect();
                menuTop = blockRect.bottom + window.scrollY + 5;
                menuLeft = blockRect.left + window.scrollX;
            } else {
                menuTop = rect.bottom + window.scrollY + 5;
                menuLeft = rect.left + window.scrollX;
            }
        } else {
            var fallRect = blockEl.getBoundingClientRect();
            menuTop = fallRect.bottom + window.scrollY + 5;
            menuLeft = fallRect.left + window.scrollX;
        }

        this.element.style.top = menuTop + 'px';
        this.element.style.left = menuLeft + 'px';

        this.element.classList.add('active');
        this.visible = true;

        // Viewport boundary check
        var menuRect = this.element.getBoundingClientRect();
        var viewportHeight = window.innerHeight;
        if (menuRect.bottom > viewportHeight - 20) {
            var newTop = menuTop - menuRect.height - 30 - window.scrollY;
            if (newTop > 0) {
                this.element.style.top = (newTop + window.scrollY) + 'px';
            }
        }
    },

    hide: function () {
        this.element.classList.remove('active');
        this.visible = false;
        this.filterQuery = '';
        this.searchInput.value = '';
    },

    // ── Rendering ─────────────────────────────────────────────
    render: function () {
        var self = this;
        var display = this._buildDisplayList();
        var interactive = display.interactive;
        var flatIndex = -1;
        var lastCategory = null;
        var html = '';

        // Safety: ensure selectedIndex is in bounds
        if (this.selectedIndex >= interactive.length) {
            this.selectedIndex = Math.max(0, interactive.length - 1);
        }

        // ── Recently Used section ──
        if (display.hasRecent) {
            html += '<div class="slash-category-header">'
                  + '<span class="slash-cat-label">Recently Used</span>'
                  + '<span class="slash-cat-badge">' + Math.min(this._recent.length, this.MAX_RECENT) + '</span>'
                  + '</div>';
            // Render recent items (they're first in interactive)
            var recentCount = interactive.length - this.commands.length;
            for (var r = 0; r < recentCount; r++) {
                flatIndex++;
                html += this._renderItem(interactive[r], flatIndex === this.selectedIndex);
            }
        }

        // ── Category groups ──
        var categoryStart = flatIndex + 1; // track where commands start
        for (var i = (display.hasRecent ? recentCount : 0); i < interactive.length; i++) {
            var cmd = interactive[i];
            if (cmd.category !== lastCategory) {
                var cat = null;
                for (var ci = 0; ci < this.categories.length; ci++) {
                    if (this.categories[ci].id === cmd.category) { cat = this.categories[ci]; break; }
                }
                html += '<div class="slash-category-header">'
                      + '<span class="slash-cat-label">' + (cat ? cat.label : cmd.category) + '</span>'
                      + '</div>';
                lastCategory = cmd.category;
            }
            flatIndex++;
            html += this._renderItem(cmd, flatIndex === this.selectedIndex);
        }

        // ── Empty state ──
        if (interactive.length === 0) {
            html = '<div class="slash-empty">No commands match "<strong>' + this.filterQuery + '</strong>"</div>';
        }

        this.itemsContainer.innerHTML = html;

        // Bind clicks
        this.itemsContainer.querySelectorAll('.slash-item').forEach(function (el) {
            el.addEventListener('click', function () {
                self.execute(el.getAttribute('data-cmd'));
            });
        });

        // Scroll selected into view
        var selectedEl = this.itemsContainer.querySelector('.slash-item.selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        // Update match count badge on search
        var countBadge = this.element.querySelector('.slash-search-count');
        if (countBadge) countBadge.textContent = interactive.length;
    },

    _renderItem: function (cmd, selected) {
        var cls = 'slash-item' + (selected ? ' selected' : '');
        var icon = cmd.icon
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;');
        return '<div class="' + cls + '" data-cmd="' + cmd.id + '">'
            + '<span class="slash-icon">' + icon + '</span>'
            + '<span class="slash-label">' + cmd.label + '</span>'
            + '<span class="slash-shortcut">' + cmd.shortcut + '</span>'
            + '</div>';
    },

    // ── Keyboard navigation ──────────────────────────────────
    handleKey: function (e) {
        var display = this._buildDisplayList();
        var count = display.interactive.length;
        if (count === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.selectedIndex = (this.selectedIndex + 1) % count;
            this.render();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.selectedIndex = (this.selectedIndex - 1 + count) % count;
            this.render();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            var display = this._buildDisplayList();
            if (display.interactive[this.selectedIndex]) {
                this.execute(display.interactive[this.selectedIndex].id);
            }
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            this.hide();
        } else if (e.key === 'Backspace' && !this.filterQuery) {
            e.stopPropagation();
            this.hide();
        }
    },

    // ── Command execution ─────────────────────────────────────
    execute: function (cmdId) {
        // Track recent
        this._touchRecent(cmdId);

        this.hide();

        // Access global managers via window
        var BlockEditor = window.BlockEditor;
        var PageManager = window.PageManager;
        var NOTES = window.State ? window.State.NOTES : (window.NOTES || []);
        var page = NOTES.find(n => n.id === BlockEditor.activePageId);
        if (!page) return;

        var block = page.blocks.find(b => b.id === this.targetBlockId);
        if (!block) return;

        var textProp = 'content';
        var tablePos = null;
        var activeEl = this.activeElement;

        if (block.type === 'image') textProp = 'caption';
        if (activeEl && activeEl.classList.contains('table-cell')) {
            tablePos = {
                row: parseInt(activeEl.getAttribute('data-row'), 10),
                col: parseInt(activeEl.getAttribute('data-col'), 10)
            };
        }

        var currentText = '';
        if (tablePos && block.tableData) {
            if (tablePos.row === -1) currentText = block.tableData.headers[tablePos.col] || '';
            else currentText = block.tableData.rows[tablePos.row][tablePos.col] || '';
        } else {
            currentText = block[textProp] || '';
        }

        // Strip trigger sequence if inline
        if (this.isInline) {
             currentText = currentText.replace(/\/[\w-]*$/, '').trim();
        }

        // Color — shows color palette and exits
        if (cmdId === 'color') {
            this.filterQuery = '';
            this.hide();
            this._showColorPalette(block, page);
            return;
        }

        // Canvas — creates a new note and exits
        if (cmdId === 'canvas') {
            const title = 'Untitled Canvas';
            const newCanvas = {
                id: 'canvas_' + Date.now(),
                title: title,
                type: 'canvas',
                path: '/',
                canvasData: { nodes: [], edges: [] },
                created: Date.now(),
                modified: Date.now()
            };
            if (window.State && window.State.NOTES) window.State.NOTES.unshift(newCanvas);
            if (window.saveData) window.saveData();
            if (window.Notes) {
                window.Notes.open(newCanvas.id);
                window.Notes.renderSidebar();
            }
            this.filterQuery = '';
            return;
        }

        var isInsert = ['cmd_time', 'cmd_weather', 'cmd_calc', 'align-left', 'align-center', 'align-right'].includes(cmdId);

        if (isInsert) {
            if (cmdId === 'cmd_time') {
                currentText += (currentText ? ' ' : '') + new Date().toLocaleString();
            } else if (cmdId === 'cmd_weather') {
                var CONFIG = window.State ? window.State.CONFIG : (window.CONFIG || {});
                if (window.State && window.State.WEATHER_CACHE && window.State.WEATHER_CACHE.data && window.State.WEATHER_CACHE.data.current_condition) {
                    var curr = window.State.WEATHER_CACHE.data.current_condition[0];
                    var temp = CONFIG.use_celsius ? curr.temp_C + 'C' : curr.temp_F + 'F';
                    var desc = curr.weatherDesc[0].value;
                    currentText += (currentText ? ' ' : '') + '[' + (CONFIG.location || 'Unknown') + ': ' + temp + ', ' + desc + ']';
                } else {
                    currentText += (currentText ? ' ' : '') + "[Weather Data Unavailable]";
                }
            } else if (cmdId === 'cmd_calc') {
                block.type = 'code';
                block.language = 'calc';
                currentText = '// Type math (e.g. 50 * 2) and press Ctrl+Enter to solve';
            } else if (cmdId.startsWith('align-')) {
                block.align = cmdId.replace('align-', '');
            }

            // Save injected text back
            if (tablePos && block.tableData) {
                if (tablePos.row === -1) block.tableData.headers[tablePos.col] = currentText;
                else block.tableData.rows[tablePos.row][tablePos.col] = currentText;
            } else {
                block[textProp] = currentText;
            }
        } else {
            // Transform structure
            if (tablePos) {
                console.warn('[SlashMenu] Refusing to transform whole block type while inside a scoped Table Cell.');
                return;
            }

            block.type = cmdId;
            block.content = currentText;

            if (cmdId === 'task') {
                block.checked = false;
                block.createdAt = Date.now();
            }
            if (cmdId === 'code') block.language = 'javascript';
            if (cmdId === 'query') block.content = 'LIST FROM #';
            if (cmdId === 'callout') {
                if (window.CalloutModal) {
                    window.CalloutModal.open(block.id, currentText);
                    return;
                } else {
                    block.calloutType = 'info';
                    block.calloutTitle = 'Information';
                    block.content = '[!INFO] Information\n' + currentText;
                }
            }
            if (cmdId === 'kanban') {
                block.type = 'kanban_ref';
                if (window.ModalManager) {
                    window.ModalManager.openInput('CREATE BOARD', 'Enter Board Name...', function(name) {
                        if (window.KanbanManager) {
                            var board = window.KanbanManager.createBoard(name);
                            block.boardId = board.id;
                            BlockEditor.render(BlockEditor.activePageId);
                            PageManager.syncContent(BlockEditor.activePageId);
                            window.saveData();
                        }
                    });
                    return;
                } else {
                    block.boardId = null;
                }
            }
            if (cmdId === 'table') {
                block.type = 'table';
                block.tableData = {
                    headers: ['Header 1', 'Header 2', 'Header 3'],
                    rows: [['', '', ''], ['', '', '']],
                    columnAligns: ['left', 'left', 'left'],
                    hasHeaderRow: true
                };
                block.content = '';
            }
            if (cmdId === 'image') {
                block.type = 'p';
                block.content = 'PASTE_OR_DRAG_IMAGE_HERE';

                var input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = function(e) {
                    if (e.target.files.length > 0) {
                        var idx = page.blocks.findIndex(b => b.id === block.id);
                        if (idx !== -1) page.blocks.splice(idx, 1);
                        BlockEditor.processImageFile(e.target.files[0]);
                    }
                };
                input.click();
            }
        }

        this.filterQuery = '';

        BlockEditor.render(BlockEditor.activePageId);
        if (PageManager && PageManager.syncContent) PageManager.syncContent(BlockEditor.activePageId);

        // Return focus
        if (isInsert && activeEl) {
             setTimeout(function() {
                 activeEl.focus();
                 if (activeEl.childNodes.length > 0) {
                     var sel = window.getSelection();
                     var range = document.createRange();
                     range.selectNodeContents(activeEl);
                     range.collapse(false);
                     sel.removeAllRanges();
                     sel.addRange(range);
                 }
             }, 10);
        } else {
             BlockEditor.focusBlock(block.id);
        }
    },

    // ── Color palette popover ────────────────────────────────
    COLORS: [
        { label: 'Default',     value: '' },
        { label: 'Red',         value: '#e03e3e' },
        { label: 'Orange',      value: '#e0913e' },
        { label: 'Yellow',      value: '#dfe03e' },
        { label: 'Green',       value: '#3ee05a' },
        { label: 'Teal',        value: '#3ee0c0' },
        { label: 'Blue',        value: '#3e7ee0' },
        { label: 'Purple',      value: '#8e3ee0' },
        { label: 'Pink',        value: '#e03e8e' },
        { label: 'Gray',        value: '#8e8e96' },
    ],

    _showColorPalette: function(block, page) {
        var self = this;

        // Remove any existing palette
        var old = document.getElementById('color-palette-popover');
        if (old) old.remove();

        var palette = document.createElement('div');
        palette.id = 'color-palette-popover';
        palette.className = 'color-palette-popover';

        // Title
        var title = document.createElement('div');
        title.className = 'color-palette-title';
        title.textContent = 'Block Color';
        palette.appendChild(title);

        // Color swatches grid
        var grid = document.createElement('div');
        grid.className = 'color-palette-grid';

        this.COLORS.forEach(function(c) {
            var swatch = document.createElement('button');
            swatch.className = 'color-swatch';
            swatch.setAttribute('data-color', c.value);
            swatch.title = c.label;

            if (c.value) {
                swatch.style.backgroundColor = c.value;
            } else {
                swatch.classList.add('color-swatch-default');
                swatch.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16"><line x1="3" y1="3" x2="13" y2="13" stroke="#666" stroke-width="2"/><line x1="13" y1="3" x2="3" y2="13" stroke="#666" stroke-width="2"/></svg>';
            }

            // Highlight current color
            if (block.color === c.value) {
                swatch.classList.add('active');
            }

            swatch.addEventListener('click', function(e) {
                e.stopPropagation();
                var color = this.getAttribute('data-color');
                PageManager.updateBlock(page.id, block.id, { color: color || undefined });
                PageManager.syncContent(page.id);
                if (window.saveData) saveData();
                if (window.BlockEditor) window.BlockEditor.render(page.id);
                palette.remove();
            });

            grid.appendChild(swatch);
        });

        palette.appendChild(grid);

        // Position near the block
        var blockEl = document.querySelector('[data-block-id="' + block.id + '"]');
        if (blockEl) {
            var rect = blockEl.getBoundingClientRect();
            palette.style.top = (rect.bottom + window.scrollY + 4) + 'px';
            palette.style.left = (rect.left + window.scrollX) + 'px';
        } else {
            palette.style.top = '50%';
            palette.style.left = '50%';
        }

        document.body.appendChild(palette);

        // Click outside to close
        setTimeout(function() {
            document.addEventListener('click', function _closePalette(e) {
                if (!palette.contains(e.target)) {
                    palette.remove();
                    document.removeEventListener('click', _closePalette);
                }
            });
        }, 0);
    }
};
