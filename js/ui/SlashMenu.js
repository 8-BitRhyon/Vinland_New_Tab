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
        { id: 'cmd_calc', label: 'Calculator', icon: '🧮', shortcut: '/calc' }
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
        document.body.appendChild(this.element);

        var self = this;
        document.addEventListener('keydown', function (e) {
            if (self.visible) self.handleKey(e);
        });
        
        document.addEventListener('click', function (e) {
            if (self.visible && !self.element.contains(e.target)) self.hide();
        });
    },

    show: function (blockEl) {
        this.targetBlockId = blockEl.getAttribute('data-block-id');
        this.selectedIndex = 0;
        this.render();

        const selection = window.getSelection();
        var menuTop, menuLeft;
        
        if (selection.rangeCount > 0) {
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
            
            this.element.style.top = menuTop + 'px';
            this.element.style.left = menuLeft + 'px';
        }

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
    },

    hide: function () {
        this.element.classList.remove('active');
        this.visible = false;
    },

    render: function () {
        var self = this;
        this.element.innerHTML = this.commands.map(function (cmd, i) {
            var selected = (i === self.selectedIndex) ? ' selected' : '';
            return '<div class="slash-item' + selected + '" data-cmd="' + cmd.id + '">' +
                '<span class="slash-icon">' + cmd.icon + '</span>' +
                '<span class="slash-label">' + cmd.label + '</span>' +
                '<span class="slash-shortcut">' + cmd.shortcut + '</span>' +
                '</div>';
        }).join('');

        this.element.querySelectorAll('.slash-item').forEach(function (el) {
            el.addEventListener('click', function () {
                self.execute(el.getAttribute('data-cmd'));
            });
        });
    },

    handleKey: function (e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.selectedIndex = (this.selectedIndex + 1) % this.commands.length;
            this.render();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.selectedIndex = (this.selectedIndex - 1 + this.commands.length) % this.commands.length;
            this.render();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            this.execute(this.commands[this.selectedIndex].id);
        } else if (e.key === 'Escape' || e.key === 'Backspace') {
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
        if (block) {
            // Strip alignment markers
            block.content = block.content.replace(/\s?%%align:(left|center|right)%%$/, '').trim();

            // Handle alignment commands
            if (cmdId === 'align-left' || cmdId === 'align-center' || cmdId === 'align-right') {
                block.align = cmdId.replace('align-', '');
                block.content = block.content.replace(/\/[\w-]*$/, '').trim();
            }
            else if (cmdId === 'cmd_time') {
                block.content = block.content.replace(/\/[\w]*$/, '').trim();
                var timeStr = new Date().toLocaleString();
                block.content += (block.content ? ' ' : '') + timeStr;
            }
            else if (cmdId === 'cmd_weather') {
                block.content = block.content.replace(/\/[\w]*$/, '').trim();
                var CONFIG = window.State ? window.State.CONFIG : (window.CONFIG || {});
                if (typeof window.WEATHER_CACHE !== 'undefined' && window.WEATHER_CACHE.data && window.WEATHER_CACHE.data.current_condition) {
                    var curr = window.WEATHER_CACHE.data.current_condition[0];
                    var temp = CONFIG.use_celsius ? curr.temp_C + 'C' : curr.temp_F + 'F';
                    var desc = curr.weatherDesc[0].value;
                    block.content += (block.content ? ' ' : '') + '[' + CONFIG.location + ': ' + temp + ', ' + desc + ']';
                } else {
                    block.content += " [Weather Data Unavailable]";
                }
            }
            else if (cmdId === 'cmd_calc') {
                block.content = '// Type math (e.g. 50 * 2) and press Ctrl+Enter to solve';
                block.type = 'code';
                block.language = 'calc';
            }
            else {
                // Normal Block Type Change
                block.type = cmdId;
                block.content = block.content.replace(/\/[\w-]*$/, '').trim();
            }
            
            // Special initialization
            if (cmdId === 'task') {
                block.checked = false;
                block.createdAt = Date.now();
            }
            if (cmdId === 'code') block.language = 'javascript';
            if (cmdId === 'kanban') {
                block.type = 'kanban_ref';
                // V77: Use Custom Input Modal
                if (window.ModalManager) {
                    window.ModalManager.openInput('CREATE BOARD', 'Enter Board Name...', function(name) {
                        if (window.KanbanManager) {
                            var board = window.KanbanManager.createBoard(name);
                            block.boardId = board.id;
                            BlockEditor.render(BlockEditor.activePageId);
                            PageManager.syncContent(BlockEditor.activePageId);
                        }
                    });
                } else {
                    // Fallback should ModalManager fail
                     block.boardId = null; 
                }
            }
            if (cmdId === 'tag') {
                block.type = 'p';
                block.content = '#';
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
        BlockEditor.focusBlock(this.targetBlockId);
        if (PageManager && PageManager.syncContent) PageManager.syncContent(BlockEditor.activePageId);
    }
};
