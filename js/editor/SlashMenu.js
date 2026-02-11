import { BlockEditor } from './BlockEditor.js';
import { PageManager } from './PageManager.js';

/* =========================================
   PHASE 4: SLASH COMMAND MENU
   Quick block insertion system
   ========================================= */
export const SlashMenu = {
    element: null,
    visible: false,
    targetBlockId: null,
    selectedIndex: 0,
    filterQuery: '', // V53: For autocomplete filtering

    allCommands: [
        { id: 'h1', label: 'Heading 1', icon: 'H1', shortcut: '/h1' },
        { id: 'h2', label: 'Heading 2', icon: 'H2', shortcut: '/h2' },
        { id: 'h3', label: 'Heading 3', icon: 'H3', shortcut: '/h3' },
        { id: 'bullet', label: 'Bulleted List', icon: '\u2022', shortcut: '/bullet' },
        { id: 'numbered', label: 'Numbered List', icon: '1.', shortcut: '/number' },
        { id: 'task', label: 'To-do List', icon: '[ ]', shortcut: '/todo' },
        { id: 'quote', label: 'Blockquote', icon: '"', shortcut: '/quote' },
        { id: 'code', label: 'Code Block', icon: '&lt;/&gt;', shortcut: '/code' },
        { id: 'kanban', label: 'Kanban Board', icon: '[=]', shortcut: '/board' },
        { id: 'table', label: 'Simple Table', icon: '#', shortcut: '/table' },
        { id: 'image', label: 'Image', icon: 'IMG', shortcut: '/image' },
        { id: 'divider', label: 'Divider', icon: '---', shortcut: '/div' },
        { id: 'align-left', label: 'Align Left', icon: '\u2190', shortcut: '/left' },
        { id: 'align-center', label: 'Align Center', icon: '\u2194', shortcut: '/center' },
        { id: 'align-right', label: 'Align Right', icon: '\u2192', shortcut: '/right' },
        // V70: Active Commands
        { id: 'cmd_time', label: 'Insert Time', icon: '🕒', shortcut: '/time' },
        { id: 'cmd_weather', label: 'Insert Weather', icon: '☁️', shortcut: '/weather' },
        { id: 'cmd_calc', label: 'Calculator', icon: '🧮', shortcut: '/calc' }
    ],
    
    get commands() {
        // V53: Return filtered commands based on filterQuery
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
        // Additional show logic like positioning (to be added)
        this.visible = true;
    },
    
    hide: function() {
        this.visible = false;
        if (this.element) this.element.style.display = 'none';
        this.filterQuery = '';
    },
    
    render: function() {
        // Placeholder for full render logic
        if (!this.element) return;
        this.element.style.display = 'block';
        // ...
    },
    
    handleKey: function(e) {
        // Placeholder for key handling
    }
};
