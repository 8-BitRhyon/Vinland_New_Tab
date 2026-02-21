/**
 * SlashMenu - Command palette for BlockEditor
 * Extracted from vinland.js for modular architecture
 */

export const SlashMenu = {
    element: null,
    visible: false,
    targetBlockId: null,
    selectedIndex: 0,
    filterQuery: '',

    allCommands: [
        { id: 'h1', label: 'Heading 1', icon: 'H1', shortcut: '/h1' },
        { id: 'h2', label: 'Heading 2', icon: 'H2', shortcut: '/h2' },
        { id: 'h3', label: 'Heading 3', icon: 'H3', shortcut: '/h3' },
        { id: 'bullet', label: 'Bulleted List', icon: '•', shortcut: '/bullet' },
        { id: 'numbered', label: 'Numbered List', icon: '1.', shortcut: '/number' },
        { id: 'task', label: 'To-do List', icon: '[ ]', shortcut: '/todo' },
        { id: 'quote', label: 'Blockquote', icon: '"', shortcut: '/quote' },
        { id: 'code', label: 'Code Block', icon: '&lt;/&gt;', shortcut: '/code' },
        { id: 'kanban', label: 'Kanban Board', icon: '[=]', shortcut: '/board' },
        { id: 'table', label: 'Simple Table', icon: '#', shortcut: '/table' },
        { id: 'image', label: 'Image', icon: 'IMG', shortcut: '/image' },
        { id: 'divider', label: 'Divider', icon: '---', shortcut: '/div' },
        { id: 'align-left', label: 'Align Left', icon: '←', shortcut: '/left' },
        { id: 'align-center', label: 'Align Center', icon: '↔', shortcut: '/center' },
        { id: 'align-right', label: 'Align Right', icon: '→', shortcut: '/right' },
        { id: 'cmd_time', label: 'Insert Time', icon: '🕒', shortcut: '/time' },
        { id: 'cmd_weather', label: 'Insert Weather', icon: '☁️', shortcut: '/weather' },
        { id: 'cmd_calc', label: 'Calculator', icon: '🧮', shortcut: '/calc' },
        { id: 'canvas', label: 'Open Canvas', icon: '[C]', shortcut: '/canvas' },
        { id: 'query', label: 'Query Block', icon: '?=', shortcut: '/query' },
        { id: 'callout', label: 'Callout', icon: '!!', shortcut: '/callout' }
    ],
    
    get commands() {
        var query = this.filterQuery.toLowerCase();
        if (!query) return this.allCommands;
        return this.allCommands.filter(function(cmd) {
            return cmd.id.includes(query) || cmd.label.toLowerCase().includes(query) || cmd.shortcut.includes('/' + query);
        });
    },

    init: function () {
        this.element = document.createElement('div');
        this.element.id = 'slash-menu';
        this.element.className = 'slash-menu';

        var searchContainer = document.createElement('div');
        searchContainer.id = 'slash-search-container';
        searchContainer.style.cssText = 'display: none; padding: 8px 12px; border-bottom: 1px solid var(--border-color, #444); background: rgba(0,0,0,0.2); border-radius: 8px 8px 0 0;';
        
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.placeholder = 'Search commands...';
        this.searchInput.style.cssText = 'width: 100%; padding: 0; background: transparent; color: inherit; border: none; outline: none; font-size: 13px; font-family: inherit;';
        
        searchContainer.appendChild(this.searchInput);
        this.element.appendChild(searchContainer);
        
        this.itemsContainer = document.createElement('div');
        this.itemsContainer.id = 'slash-items-container';
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
        this.activeElement = document.activeElement; // Track where user was before menu opened
        this.isInline = isInline;
        this.filterQuery = '';
        this.selectedIndex = 0;
        
        this.searchInput.value = '';
        var searchContainer = document.getElementById('slash-search-container');
        if (searchContainer) {
            searchContainer.style.display = isInline ? 'none' : 'block';
        }

        this.render();

        const selection = window.getSelection();
        var menuTop, menuLeft;
        
        if (mouseEvent && mouseEvent.clientX) {
            // V106: Explicit exact pointer positioning for Context Menus
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
            // V106: Fallback for non-text blocks triggered without pointer (e.g. keyboard)
            var fallRect = blockEl.getBoundingClientRect();
            menuTop = fallRect.bottom + window.scrollY + 5;
            menuLeft = fallRect.left + window.scrollX;
        }

        this.element.style.top = menuTop + 'px';
        this.element.style.left = menuLeft + 'px';

        this.element.classList.add('active');
        this.visible = true;
        
        // Viewport Boundary Check
        var menuRect = this.element.getBoundingClientRect();
        var viewportHeight = window.innerHeight;
        
        if (menuRect.bottom > viewportHeight - 20) {
            var newTop = menuTop - menuRect.height - 30 - window.scrollY;
            if (newTop > 0) {
                this.element.style.top = (newTop + window.scrollY) + 'px';
            }
        }
        
        if (!isInline) {
            var selfInput = this.searchInput;
            setTimeout(function() { selfInput.focus(); }, 10);
        }
    },

    hide: function () {
        this.element.classList.remove('active');
        this.visible = false;
    },

    render: function () {
        var self = this;
        var html = this.commands.map(function (cmd, i) {
            var selected = (i === self.selectedIndex) ? ' selected' : '';
            return '<div class="slash-item' + selected + '" data-cmd="' + cmd.id + '">' +
                '<span class="slash-icon">' + cmd.icon + '</span>' +
                '<span class="slash-label">' + cmd.label + '</span>' +
                '<span class="slash-shortcut">' + cmd.shortcut + '</span>' +
                '</div>';
        }).join('');
        
        // UX Feedback: If no commands match, explicitly say so
        if (this.commands.length === 0) {
            html = '<div style="padding: 12px 15px; color: #888; font-size: 12px; text-align: center; font-style: italic;">No commands match "' + this.filterQuery + '"</div>';
        }

        this.itemsContainer.innerHTML = html;

        this.itemsContainer.querySelectorAll('.slash-item').forEach(function (el) {
            el.addEventListener('click', function () {
                self.execute(el.getAttribute('data-cmd'));
            });
        });

        // Scroll selected item into view
        var selectedEl = this.itemsContainer.querySelector('.slash-item.selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    },

    handleKey: function (e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.selectedIndex = (this.selectedIndex + 1) % this.commands.length;
            this.render();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.selectedIndex = (this.selectedIndex - 1 + this.commands.length) % this.commands.length;
            this.render();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.execute(this.commands[this.selectedIndex].id);
        } else if (e.key === 'Escape' || e.key === 'Backspace') {
            e.stopPropagation();
            this.hide();
        }
    },

    execute: function (cmdId) {
        this.hide();
        
        // Access global managers via window (per user rules)
        var BlockEditor = window.BlockEditor;
        var PageManager = window.PageManager;
        var NOTES = window.State ? window.State.NOTES : (window.NOTES || []);
        
        var page = NOTES.find(n => n.id === BlockEditor.activePageId);
        if (!page) return;

        var block = page.blocks.find(b => b.id === this.targetBlockId);
        if (!block) return;

        // Extract DOM Text State context to handle Tables and Images properly
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

        // Is this an insert command or a transform command?
        var isInsert = ['cmd_time', 'cmd_weather', 'cmd_calc', 'canvas', 'align-left', 'align-center', 'align-right'].includes(cmdId);

        if (isInsert) {
             if (cmdId === 'cmd_time') {
                 currentText += (currentText ? ' ' : '') + new Date().toLocaleString();
             }
             else if (cmdId === 'cmd_weather') {
                 var CONFIG = window.State ? window.State.CONFIG : (window.CONFIG || {});
                 if (window.State && window.State.WEATHER_CACHE && window.State.WEATHER_CACHE.data && window.State.WEATHER_CACHE.data.current_condition) {
                     var curr = window.State.WEATHER_CACHE.data.current_condition[0];
                     var temp = CONFIG.use_celsius ? curr.temp_C + 'C' : curr.temp_F + 'F';
                     var desc = curr.weatherDesc[0].value;
                     currentText += (currentText ? ' ' : '') + '[' + (CONFIG.location || 'Unknown') + ': ' + temp + ', ' + desc + ']';
                 } else {
                     currentText += (currentText ? ' ' : '') + "[Weather Data Unavailable]";
                 }
             }
             else if (cmdId === 'cmd_calc') {
                 block.type = 'code';
                 block.language = 'calc';
                 currentText = '// Type math (e.g. 50 * 2) and press Ctrl+Enter to solve';
             }
             else if (cmdId === 'canvas') {
                 if (window.CanvasManager) window.CanvasManager.open();
             }
             else if (cmdId.startsWith('align-')) {
                 block.align = cmdId.replace('align-', '');
             }
             
             // Save injected text back into the correct block schema property
             if (tablePos && block.tableData) {
                 if (tablePos.row === -1) block.tableData.headers[tablePos.col] = currentText;
                 else block.tableData.rows[tablePos.row][tablePos.col] = currentText;
             } else {
                 block[textProp] = currentText;
             }
             
        } else {
            // Transform Structure (Prevent destroying table structure if inside cell)
            if (tablePos) {
                console.warn('[SlashMenu] Refusing to transform whole block type while inside a scoped Table Cell.');
                return;
            }

            // Normal Block Type Change
            block.type = cmdId;
            block.content = currentText; // Collapse image caption back into text block if transformed out
            
            // Special initializations
            if (cmdId === 'task') {
                block.checked = false;
                block.createdAt = Date.now();
            }
            if (cmdId === 'code') block.language = 'javascript';
            if (cmdId === 'query') block.content = 'LIST FROM #';
            if (cmdId === 'callout') {
                if (window.CalloutModal) {
                    window.CalloutModal.open(block.id, currentText);
                    return; // Wait for modal callback to save and render
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
                        }
                    });
                    return; // Wait for modal
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
        
        // Return focus to active element if we just did a text injection
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
    }
};
