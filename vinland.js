const CONFIG_VERSION = 4;

const DEFAULT_CONFIG = {
    version: CONFIG_VERSION,
    user_name: "",
    theme_color: "#00FF41",
    secondary_color: "#888888",
    secondary_font: "'Space Mono', monospace",
    crt_effect: false,
    vignette_effect: false,
    noise_effect: false,
    typing_sounds: false,
    ui_sounds: false,
    show_bookmarks: true,
    search_engine: "google",
    location: "",
    use_celsius: false,
    weather_extended: false,
    filter_enabled: true,
    filter_grayscale: 100,
    filter_contrast: 120,
    filter_brightness: 60,
    filter_blur: 0,
    // Font settings
    clock_font_size: 7,
    clock_font: "Space Mono",
    weather_scale: 1.0,
    theme_preset: "",
    // Custom themes (V17)
    custom_themes: [],
    // Auto-theming (V17)
    auto_theme_enabled: false,
    day_theme: "minimal",
    night_theme: "matrix",
    day_start_hour: 6,
    night_start_hour: 18,
    // Integrations
    habit_id: "",
    life_id: "",
    trello_board: "",
    notion_page: "",
    github_user: "",
    // Backgrounds
    backgrounds: [],
    background_type: "media", // media, color
    background_color: "#000000",
    // Dock
    dock_links: [
        { name: "GEMINI", url: "https://gemini.google.com" },
        { name: "CAL", url: "https://calendar.google.com" },
        { name: "MAIL", url: "https://mail.google.com" },
        { name: "TASKS", url: "https://calendar.google.com/calendar/u/0/r/tasks" },
        { name: "KEEP", url: "https://keep.google.com" },
        { name: "DRIVE", url: "https://drive.google.com" }
    ],
    // Toggles
    auto_clear_interval: 'daily', // V18.5: never, daily, 2days, weekly, biweekly, monthly
    hide_completed_tasks: false, // V18.4: Auto-hide completed tasks
    enable_blur_overlay: true, // V18.8: Toggle for blur overlay
    last_clear_date: "", // stored as YYYY-MM-DD
    custom_commands: [
        { trigger: "gh", url: "https://github.com" },
        { trigger: "reddit", url: "https://reddit.com" }
    ],
    notes_tabs_enabled: true,
    first_run: true
};

function getDefaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

let CONFIG = getDefaultConfig();
let TASKS = [];
let NOTES = [];
let BOARDS = []; // V3.0: Kanban Boards collection
let COMMAND_HISTORY = [];
let FLAT_BOOKMARKS = [];
let ROOT_ID = '1';
let NAV_STACK = [];
let CURRENT_BOOKMARK_FOLDER = '1';
let SESSION_START = Date.now();
let POMODORO = { active: false, paused: false, endTime: null, remaining: 0, interval: null, originalDuration: 0 };
let HISTORY_INDEX = -1;
let SUGGESTION_INDEX = -1;
let CURRENT_SUGGESTIONS = [];
let audioContext = null;
let DYNAMIC_ICON_URL = 'icon.png';
let BG_RETRY_COUNT = 0;
const BG_MAX_RETRIES = 2;
let LAST_STREAK_CHECK_DATE = null; // V18.11: Track last date streak was validated
let WEATHER_CACHE = null; // V18.11: Memory-first weather cache

/* =========================================
   VINLAND OS CORE STATE (V15.3+)
   ========================================= */
var CONFIG_DIRTY = false; 
var NOTE_AUTOSAVE_TIMER = null;
var IS_PREVIEW_MODE = false;

/* =========================================
   CORE SYSTEM: MODAL MANAGER
   Handles stacking, clicking out, and ESC
   ========================================= */
const ModalManager = {
    stack: [], // Keeps track of what is open: ['note-editor-modal', 'kanban-modal']

    open: function(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        
        playModalSound(); // V62: UI Sound
        
        // 1. Show modal
        modal.classList.add('active');
        modal.style.display = 'flex'; // Consistent with Vinland flex layout
        
        // 2. Manage Z-Index stacking (V15.3+: Higher base to avoid CLI overlap)
        modal.style.zIndex = 21000 + this.stack.length; 
        
        // V27: One Modal Policy - Close conflicting "Main" modals
        // If opening a main modal (Settings/Manual/Graph), close others to prevent clutter.
        // Helper modals (Note Help/Confirm) are exempt and stack on top.
        const mainModals = ['config-modal', 'help-modal', 'graph-modal', 'history-modal'];
        if (mainModals.includes(modalId)) {
            mainModals.forEach(id => {
                if (id !== modalId) {
                    const other = document.getElementById(id);
                    if (other && other.classList.contains('active')) {
                        // Close without triggering full stack reset if possible, or just hide
                        other.classList.remove('active');
                        other.style.display = 'none';
                        // Remove from stack if present
                        this.stack = this.stack.filter(item => item !== id);
                    }
                }
            });
        }

        // 3. Add to stack
        if (!this.stack.includes(modalId)) {
            this.stack.push(modalId);
        }
        
        // 4. Show Overlay if this is the first modal
        var overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.classList.add('active');
    },

    closeTop: function(force) {
        if (this.stack.length === 0) {
            // Command Input Cleanup as fallback (V15.3)
            var input = document.getElementById('cmd-input');
            if (input && (input.value || document.activeElement === input)) {
                input.value = '';
                input.blur();
                var suggestionsBox = document.getElementById('suggestions');
                if (suggestionsBox) suggestionsBox.style.display = 'none';
            }
            return;
        }

        const modalId = this.stack[this.stack.length - 1];
        
        // V15.3: Priority Safety Gates
        if (!force) {
            if (modalId === 'config-modal') {
                if (typeof closeSettingsModal === 'function') {
                    closeSettingsModal(); 
                    return;
                }
            }
            if (modalId === 'note-editor-modal') {
                if (typeof closeNoteEditor === 'function') {
                    closeNoteEditor();
                    return;
                }
            }
            if (modalId === 'confirm-modal') {
                if (typeof closeConfirmModal === 'function') {
                    closeConfirmModal();
                    return;
                }
            }
            if (modalId === 'kanban-modal') {
                if (typeof KanbanManager !== 'undefined' && KanbanManager.close) {
                    KanbanManager.close();
                    return;
                }
            }
        }

        // Standard close logic
        this.stack.pop();
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
            // V61: Force-reset maximized state and restore icons on close
            if (modalId === 'note-editor-modal') {
                modal.classList.remove('maximized');
                var maxBtn = document.getElementById('note-maximize-btn');
                if (maxBtn) maxBtn.textContent = '[MAX]';
                if (typeof Notes !== 'undefined' && Notes.updateGlobalIconsVisibility) {
                    Notes.updateGlobalIconsVisibility(true);
                }
            }
        }

        if (this.stack.length === 0) {
            var overlay = document.getElementById('modal-overlay');
            if (overlay) overlay.classList.remove('active');
        }
    },

    closeAll: function() {
        while(this.stack.length > 0) this.closeTop();
    },

    // Global Init - Run this in init()
    init: function() {
        // Handle ESC Key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.stack.length > 0) {
                    e.preventDefault();
                    e.stopPropagation(); 
                    this.closeTop();
                }
            }
        });

        // Handle Click Outside (The Overlay)
        var overlay = document.getElementById('modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (this.stack.length > 0) {
                    this.closeTop();
                }
            });
        }
    }
};

/* =========================================
   V63.2: TAB MANAGER
   Handles multi-tab note editing
   ========================================= */
const TabManager = {
    tabs: [], // [{noteId, title}]
    activeIndex: -1,
    history: [], // For back/forward navigation
    historyIndex: -1,
    isUpdating: false, // V63.2 FIX: Recursion guard

    init: function() {
        // V63.4: Respect settings toggle (Targeting Correct Selector)
        var bar = document.getElementById('editor-tab-bar'); 
        if (!bar) bar = document.querySelector('.editor-tab-bar');

        if (CONFIG.notes_tabs_enabled === false) {
             if (bar) bar.style.display = 'none';
             this.tabs = [];
             this.activeIndex = -1;
             this.save(); // Clear session storage too
        } else {
             if (bar) bar.style.display = 'flex';
        }

        // V63.5: Load saved tabs from localStorage (persistent across sessions)
        var saved = localStorage.getItem('VINLAND_TABS');
        if (saved && CONFIG.notes_tabs_enabled !== false) {
            try {
                var data = JSON.parse(saved);
                this.tabs = data.tabs || [];
                this.activeIndex = data.activeIndex || -1;
            } catch(e) {}
        }
        if (CONFIG.notes_tabs_enabled !== false) {
            this.render();
        }
        this.bindEvents();
    },

    save: function() {
        localStorage.setItem('VINLAND_TABS', JSON.stringify({
            tabs: this.tabs,
            activeIndex: this.activeIndex
        }));
    },

    openTab: function(noteId, title) {
        // V63.4: Respect settings toggle immediately
        if (CONFIG.notes_tabs_enabled === false) return;
        
        // V63.2 FIX: Prevent recursion
        if (this.isUpdating) return;
        
        // Check if already open
        var existingIdx = this.tabs.findIndex(t => t.noteId === noteId);
        if (existingIdx !== -1) {
            this.activeIndex = existingIdx;
            this.save();
            this.render();
            return;
        }
        // Add new tab
        this.tabs.push({ noteId: noteId, title: title || 'Untitled' });
        this.activeIndex = this.tabs.length - 1;
        
        // Sync history
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(noteId);
        this.historyIndex = this.history.length - 1;
        
        this.save();
        this.render();
    },

    closeTab: function(index) {
        if (index < 0 || index >= this.tabs.length) return;
        this.tabs.splice(index, 1);
        
        if (this.tabs.length === 0) {
            this.activeIndex = -1;
            // V63.2: Auto-create new note when all tabs closed
            // V63.4: Guard against recursive creation during cleanup
            if (typeof Notes !== 'undefined' && !Notes.isCleaningUpAutoNote) {
                Notes.autoCreatedNoteId = null; // Reset first
                Notes.create();
                // V63.4: Mark this note as auto-created for cleanup
                Notes.autoCreatedNoteId = Notes.activeNoteId;
            }
        } else if (this.activeIndex >= this.tabs.length) {
            this.activeIndex = this.tabs.length - 1;
            this.isUpdating = true;
            if (typeof Notes !== 'undefined') Notes.open(this.tabs[this.activeIndex].noteId);
            this.isUpdating = false;
        } else if (index < this.activeIndex) {
            this.activeIndex--;
        } else if (index === this.activeIndex) {
            // Re-open current active after splice
            if (typeof Notes !== 'undefined') Notes.open(this.tabs[this.activeIndex].noteId);
        }
        
        this.save();
        this.render();
    },

    // V63.4: Helper to close by ID (for ghost tag cleanup)
    closeTabById: function(noteId) {
        var idx = this.tabs.findIndex(t => t.noteId === noteId);
        if (idx !== -1) this.closeTab(idx);
    },

    switchTo: function(index) {
        if (index < 0 || index >= this.tabs.length) return;
        if (this.activeIndex === index) return; // Already active
        
        this.activeIndex = index;
        var tab = this.tabs[index];
        
        // V63.2 FIX: Use guard to prevent Notes.open from calling openTab again
        this.isUpdating = true;
        if (typeof Notes !== 'undefined') Notes.open(tab.noteId);
        this.isUpdating = false;
        
        // Update history
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(tab.noteId);
        this.historyIndex = this.history.length - 1;
        
        this.save();
        this.render();
    },

    updateActiveTitle: function(newTitle) {
        if (this.activeIndex >= 0 && this.activeIndex < this.tabs.length) {
            this.tabs[this.activeIndex].title = newTitle;
            this.save();
            this.render();
        }
    },

    goBack: function() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            var noteId = this.history[this.historyIndex];
            var idx = this.tabs.findIndex(t => t.noteId === noteId);
            if (idx !== -1) {
                this.isUpdating = true;
                if (typeof Notes !== 'undefined') Notes.open(noteId);
                this.isUpdating = false;
                this.activeIndex = idx;
                this.save();
                this.render();
            }
        }
    },

    goForward: function() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            var noteId = this.history[this.historyIndex];
            var idx = this.tabs.findIndex(t => t.noteId === noteId);
            if (idx !== -1) {
                this.isUpdating = true;
                if (typeof Notes !== 'undefined') Notes.open(noteId);
                this.isUpdating = false;
                this.activeIndex = idx;
                this.save();
                this.render();
            }
        }
    },

    // V63.4: Arrow key adjacent tab switching
    switchAdjacent: function(direction) {
        if (this.tabs.length <= 1) return;
        var nextIdx = this.activeIndex + direction;
        if (nextIdx < 0) nextIdx = this.tabs.length - 1;
        if (nextIdx >= this.tabs.length) nextIdx = 0;
        this.switchTo(nextIdx);
    },

    render: function() {
        var container = document.getElementById('tabs-container');
        if (!container) return;
        
        container.innerHTML = '';
        var self = this;
        
        this.tabs.forEach(function(tab, idx) {
            var tabEl = document.createElement('div');
            tabEl.className = 'tab-item' + (idx === self.activeIndex ? ' active' : '');
            tabEl.innerHTML = '<span class="tab-title">' + safeText(tab.title) + '</span><span class="tab-close">&times;</span>';
            
            tabEl.querySelector('.tab-title').addEventListener('click', function() {
                self.switchTo(idx);
            });
            
            tabEl.querySelector('.tab-close').addEventListener('click', function(e) {
                e.stopPropagation();
                self.closeTab(idx);
            });
            
            container.appendChild(tabEl);
        });
    },

    bindEvents: function() {
        var self = this;
        var backBtn = document.getElementById('tab-nav-back');
        var fwdBtn = document.getElementById('tab-nav-forward');
        var newBtn = document.getElementById('tab-new-btn');
        // V65: Use switchAdjacent like arrow keys for simpler tab navigation
        if (backBtn) backBtn.addEventListener('click', function() { self.switchAdjacent(-1); });
        if (fwdBtn) fwdBtn.addEventListener('click', function() { self.switchAdjacent(1); });
        if (newBtn) newBtn.addEventListener('click', function() {
            // V63.2: Prevent infinite tabs - check if current note has a title
            if (typeof Notes !== 'undefined') {
                if (Notes.activeNoteId) {
                    var currentNote = NOTES.find(n => n.id === Notes.activeNoteId);
                    if (currentNote && (!currentNote.title || currentNote.title === 'Untitled' || currentNote.title.trim() === '')) {
                        showNotification('Please name your current note first');
                        document.getElementById('active-note-title').focus();
                        return;
                    }
                }
                Notes.create();
            }
        });
    }
};

/* =========================================
   V63.2: PAGE ACTIONS
   Handles note actions menu
   ========================================= */
const PageActions = {
    isOpen: false,

    init: function() {
        var self = this;
        var btn = document.getElementById('page-actions-btn');
        var menu = document.getElementById('page-actions-menu');
        var search = document.getElementById('page-actions-search');
        
        if (btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                self.toggle();
            });
        }
        
        // Close on outside click
        document.addEventListener('click', function(e) {
            if (self.isOpen && menu && !menu.contains(e.target)) {
                self.close();
            }
        });
        
        // Action handlers
        if (menu) {
            menu.addEventListener('click', function(e) {
                var item = e.target.closest('.page-action-item');
                if (item) {
                    var action = item.dataset.action;
                    self.execute(action);
                    self.close();
                }
            });
        }
        
        // Search filter
        if (search) {
            search.addEventListener('input', function() {
                self.filter(this.value);
            });
        }
    },

    toggle: function() {
        this.isOpen ? this.close() : this.open();
    },

    open: function() {
        var menu = document.getElementById('page-actions-menu');
        if (menu) {
            menu.classList.add('active');
            this.isOpen = true;
            var search = document.getElementById('page-actions-search');
            if (search) { search.value = ''; search.focus(); }
            this.filter('');
            
            // V63.2: Populate footer with word count and last edited
            if (typeof Notes !== 'undefined' && Notes.activeNoteId) {
                var note = NOTES.find(n => n.id === Notes.activeNoteId);
                if (note) {
                    var wordCountEl = document.getElementById('page-action-word-count');
                    var lastEditedEl = document.getElementById('page-action-last-edited');
                    
                    if (wordCountEl) {
                        var text = note.content || '';
                        var words = text.trim() ? text.trim().split(/\s+/).length : 0;
                        wordCountEl.textContent = words + ' words';
                    }
                    
                    if (lastEditedEl && note.modified) {
                        var d = new Date(note.modified);
                        lastEditedEl.textContent = 'Last edited: ' + d.toLocaleDateString();
                    }
                }
            }
        }
    },

    close: function() {
        var menu = document.getElementById('page-actions-menu');
        if (menu) {
            menu.classList.remove('active');
            this.isOpen = false;
        }
    },

    filter: function(query) {
        var items = document.querySelectorAll('.page-action-item');
        var q = query.toLowerCase();
        items.forEach(function(item) {
            var text = item.textContent.toLowerCase();
            item.style.display = text.includes(q) ? '' : 'none';
        });
    },

    execute: function(action) {
        switch(action) {
            case 'copy-link':
                this.copyLink();
                break;
            case 'duplicate':
                this.duplicateNote();
                break;
            case 'move-to':
                this.moveToFolder();
                break;
            case 'export-md':
                this.exportMarkdown();
                break;
            case 'import-md':
                this.importMarkdown();
                break;
            case 'move-to':
                this.focusPathInput();
                break;
            case 'word-count':
                this.showWordCount();
                break;
            case 'trash':
                this.moveToTrash();
                break;
        }
    },

    copyLink: function() {
        if (typeof Notes === 'undefined' || !Notes.activeNoteId) return;
        var note = NOTES.find(n => n.id === Notes.activeNoteId);
        if (note) {
            var link = '[[' + note.title + ']]';
            navigator.clipboard.writeText(link).then(function() {
                showNotification('Link copied: ' + link);
            });
        }
    },

    duplicateNote: function() {
        if (typeof Notes === 'undefined' || !Notes.activeNoteId) return;
        var note = NOTES.find(n => n.id === Notes.activeNoteId);
        if (note) {
            // V70: FIX DUPLICATE NOTE BUG
            // Deep copy blocks to prevent reference issues
            var newBlocks = [];
            if (note.blocks && note.blocks.length > 0) {
                newBlocks = JSON.parse(JSON.stringify(note.blocks));
                // Regenerate IDs for all blocks to maintain uniqueness
                newBlocks.forEach(function(block) {
                    block.id = 'blk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                });
            }

            var newNote = {
                id: Date.now().toString(),
                title: note.title + ' (Copy)',
                content: note.content,
                blocks: newBlocks, // Assign the processed blocks
                path: note.path,
                created: Date.now(),
                updated: Date.now()
            };
            
            // If blocks were empty but content existed (legacy), let the editor parse it naturally on load
            // But if we have blocks, we use them to preserve state (like base64 images)
            
            NOTES.push(newNote);
            saveData();
            Notes.renderSidebar();
            Notes.open(newNote.id);
            showNotification('Note duplicated');
        }
    },

    moveToFolder: function() {
        // Open folder picker modal or prompt
        var newPath = prompt('Enter new path (e.g. /Projects/Work):');
        if (newPath && typeof Notes !== 'undefined' && Notes.activeNoteId) {
            Notes.moveNote(Notes.activeNoteId, newPath);
            showNotification('Moved to ' + newPath);
        }
    },

    exportMarkdown: function() {
        if (typeof Notes === 'undefined' || !Notes.activeNoteId) return;
        var note = NOTES.find(n => n.id === Notes.activeNoteId);
        if (note) {
            var blob = new Blob([note.content || ''], { type: 'text/markdown' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = (note.title || 'note').replace(/[^a-z0-9]/gi, '_') + '.md';
            a.click();
            URL.revokeObjectURL(url);
            showNotification('Exported as Markdown');
        }
    },

    importMarkdown: function() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.md,.markdown,.txt';
        input.onchange = function(e) {
            var file = e.target.files[0];
            if (file) {
                var reader = new FileReader();
                reader.onload = function(ev) {
                    var content = ev.target.result;
                    var title = file.name.replace(/\.[^.]+$/, '');
                    
                    // V63.2: Split content into blocks by newlines
                    var blocks = [];
                    var lines = content.split('\n');
                    var now = Date.now();
                    
                    lines.forEach(function(line, idx) {
                        // Skip empty lines if desired, or keep as empty blocks
                        // Here we keep them to preserve spacing
                        blocks.push({
                            id: 'block_' + now + '_' + idx,
                            type: 'p',
                            content: line
                        });
                    });
                    
                    if (blocks.length === 0) {
                        blocks.push({ id: 'block_' + now, type: 'p', content: '' });
                    }

                    var newNote = {
                        id: 'note_' + now,
                        title: title,
                        content: content,
                        blocks: blocks,
                        path: '/',
                        created: now,
                        modified: now,
                        pinned: false
                    };
                    NOTES.push(newNote);
                    saveData();
                    
                    if (typeof Notes !== 'undefined') {
                        Notes.open(newNote.id);
                        Notes.renderSidebar();
                    }
                    showNotification('Imported: ' + title);
                };
                reader.readAsText(file);
            }
        };
        input.click();
    },

    showWordCount: function() {
        if (typeof Notes === 'undefined' || !Notes.activeNoteId) return;
        var note = NOTES.find(n => n.id === Notes.activeNoteId);
        if (note) {
            var text = note.content || '';
            var words = text.trim() ? text.trim().split(/\s+/).length : 0;
            var chars = text.length;
            showNotification('Words: ' + words + ' | Characters: ' + chars);
        }
    },

    moveToTrash: function() {
        if (typeof Notes === 'undefined' || !Notes.activeNoteId) return;
        showConfirmModal(
            'Delete Note',
            'This note will be deleted. Continue?',
            function() {
                var noteIdToDelete = Notes.activeNoteId;
                
                // Find and close the tab for this note
                if (typeof TabManager !== 'undefined') {
                    var tabIdx = TabManager.tabs.findIndex(t => t.noteId === noteIdToDelete);
                    if (tabIdx !== -1) {
                        TabManager.closeTab(tabIdx);
                    }
                }
                
                // Delete the note
                var idx = NOTES.findIndex(n => n.id === noteIdToDelete);
                if (idx !== -1) {
                    NOTES.splice(idx, 1);
                    saveData();
                    Notes.renderSidebar();
                }
                
                showNotification('Note deleted');
            }
        );
    },

    // V63.2: Focus path input for Move to action
    focusPathInput: function() {
        var pathInput = document.getElementById('note-current-path');
        if (pathInput) {
            pathInput.focus();
            pathInput.select();
        }
    }
};

/* =========================================
   PHASE 1: DATA MIGRATION
   Unix Path + Wiki Links Graph Structure
   ========================================= */

/**
 * Migrate notes to new schema with path + links
 * Safe: preserves all existing data, adds new fields
 */
function migrateNotesToPathSchema() {
    // V63.4: Migration log removed
    var migrated = 0;

    NOTES.forEach(function (note, idx) {
        // Add path if missing (default to root)
        if (!note.path) {
            note.path = '/';
            migrated++;
        }

        // Add links array if missing (extract from content)
        if (!note.links || !Array.isArray(note.links)) {
            note.links = extractWikiLinks(note.content || '');
            migrated++;
        }

        // Ensure path starts with /
        if (!note.path.startsWith('/')) {
            note.path = '/' + note.path;
        }

        // Sanitize path (remove trailing slash unless root)
        if (note.path !== '/' && note.path.endsWith('/')) {
            note.path = note.path.slice(0, -1);
        }
    });

    if (migrated > 0) {
        saveData();
        // V63.4: Migration log removed
    }
}

/**
 * PHASE 1.1: BLOCK SCHEMA MIGRATION (V3)
 * Safe: preserves raw content as fallback, adds blocks array
 */
function migrateNotesToBlockSchema() {
    // V63.4: Migration log removed
    var migrated = 0;

    NOTES.forEach(function (note) {
        if (note.blocks && Array.isArray(note.blocks) && note.blocks.length > 0) {
            return; // Already migrated
        }

        // Parse content into blocks
        note.blocks = parseContentToBlocks(note.content || '');
        migrated++;
    });

    if (migrated > 0) {
        saveData();
        console.log('✓ Migrated', migrated, 'notes to block schema');
    }
    
    // V44: Migrate task blocks to add createdAt if missing
    var tasksMigrated = 0;
    NOTES.forEach(function(note) {
        if (note.blocks) {
            note.blocks.forEach(function(block) {
                if (block.type === 'task' && !block.createdAt) {
                    block.createdAt = note.modified || note.created || Date.now();
                    tasksMigrated++;
                }
            });
        }
    });
    if (tasksMigrated > 0) {
        saveData();
        console.log('✓ Migrated', tasksMigrated, 'tasks with createdAt timestamps');
    }
}

/**
 * Parse markdown content into block array
 */
function parseContentToBlocks(content) {
    if (!content) return [];

    var lines = content.split('\n');
    var blocks = [];
    var order = 0;

    lines.forEach(function (line) {
        var block = { id: 'blk_' + Date.now() + '_' + order, order: order };
        var workingLine = line;

        // 1. Detect Indentation (Leading spaces)
        var indentMatch = workingLine.match(/^(\s+)/);
        if (indentMatch) {
            block.level = Math.floor(indentMatch[1].length / 2);
            workingLine = workingLine.substring(indentMatch[1].length);
        } else {
            block.level = 0;
        }

        // 2. Detect Alignment Marker (Suffix)
        var alignMatch = workingLine.match(/\s?%%align:(left|center|right)%%$/);
        if (alignMatch) {
            block.align = alignMatch[1];
            workingLine = workingLine.substring(0, workingLine.length - alignMatch[0].length);
        }

        // 3. Detect Block Types
        if (workingLine.startsWith('# ')) {
            block.type = 'h1';
            block.content = workingLine.substring(2);
        } else if (workingLine.startsWith('## ')) {
            block.type = 'h2';
            block.content = workingLine.substring(3);
        } else if (workingLine.startsWith('### ')) {
            block.type = 'h3';
            block.content = workingLine.substring(4);
        } else if (workingLine.match(/^- \[( |x)\] /)) {
            block.type = 'task';
            block.checked = workingLine.includes('[x]');
            block.content = workingLine.replace(/^- \[( |x)\] /, '');
        } else if (workingLine.startsWith('- ') || workingLine.startsWith('* ')) {
            block.type = 'bullet';
            block.content = workingLine.substring(2);
        } else if (workingLine.match(/^1\.\s/)) {
            block.type = 'numbered';
            block.content = workingLine.substring(3);
        } else if (workingLine.startsWith('> ')) {
            block.type = 'quote';
            block.content = workingLine.substring(2);
        } else if (workingLine.startsWith('```')) {
            block.type = 'code';
            block.language = workingLine.substring(3).trim() || 'plain';
            block.content = ''; // Simplified multiline handling
        } else if (workingLine.trim() === '---') {
            block.type = 'divider';
            block.content = '';
        } else {
            block.type = 'p';
            block.content = workingLine;
        }

        blocks.push(block);
        order++;
    });

    return blocks;
}

/**
 * Extract wiki links from note content
 * Finds all [[Link]] references and returns array of link targets
 */
function extractWikiLinks(content) {
    if (!content) return [];
    var regex = /\[\[([^\[\]]+)\]\]/g;
    var links = [];
    var match;

    while ((match = regex.exec(content)) !== null) {
        var raw = match[1];
        var linkTarget = raw.split('|')[0].trim(); // Handle [[Target|Label]]
        if (linkTarget) links.push(linkTarget);
    }

    return links;
}

/**
 * Sanitize folder path
 * Prevents directory traversal, validates format
 */
function sanitizePath(path) {
    if (!path) return '/';

    // Normalize slashes
    path = path.replace(/\\/g, '/');

    // Prevent directory traversal
    if (path.includes('..') || path.includes('~')) {
        console.warn('Invalid path detected, using root:', path);
        return '/';
    }

    // Ensure starts with /
    if (!path.startsWith('/')) {
        path = '/' + path;
    }

    // Remove trailing slash (except for root)
    if (path !== '/' && path.endsWith('/')) {
        path = path.slice(0, -1);
    }

    // Remove double slashes
    path = path.replace(/\/+/g, '/');

    return path;
}

/**
 * Get all folders from notes (derives from paths)
 * Returns sorted array of unique folder paths
 */
function getAllFolders() {
    var folders = new Set();
    folders.add('/'); // Always include root

    NOTES.forEach(function (note) {
        var path = note.path || '/';

        // Add every level of the hierarchy
        var parts = path.split('/').filter(function (p) { return p.length > 0; });
        var currentPath = '';

        parts.forEach(function (part) {
            currentPath += '/' + part;
            folders.add(currentPath);
        });
    });

    return Array.from(folders).sort();
}

/**
 * Get all notes in a specific folder
 * @param {string} path - Folder path (e.g., "/missions/aghoy")
 * @returns {array} Notes in that folder only (not subfolders)
 */
function getNotesInFolder(path) {
    path = sanitizePath(path);
    return NOTES.filter(function (note) {
        return note.path === path;
    });
}

/**
 * Get all notes in a folder AND subfolders (recursive)
 * @param {string} path - Folder path
 * @returns {array} All descendant notes
 */
function getNotesInFolderRecursive(path) {
    path = sanitizePath(path);
    var isRoot = (path === '/');

    return NOTES.filter(function (note) {
        var notePath = note.path || '/';
        if (isRoot) return true; // Root contains everything
        return notePath.startsWith(path + '/') || notePath === path;
    });
}

/**
 * Move a note to a new folder
 * Auto-creates folder if needed
 */
function moveNote(noteId, newPath) {
    newPath = sanitizePath(newPath);
    var note = NOTES.find(function (n) { return n.id === noteId; });

    if (!note) {
        console.error('Note not found:', noteId);
        return false;
    }

    var oldPath = note.path;
    note.path = newPath;
    note.modified = new Date().getTime();

    saveData();
    console.log('Moved note from', oldPath, 'to', newPath);
    Notes.renderSidebar(); // Refresh UI
    return true;
}

/**
 * Get breadcrumb array from path
 * e.g. "/missions/aghoy/forensics" -> ["missions", "aghoy", "forensics"]
 */
function getBreadcrumb(path) {
    path = sanitizePath(path);
    if (path === '/') return [];
    return path.split('/').filter(function (p) { return p.length > 0; });
}

/**
 * Get parent folder of a path
 * e.g. "/missions/aghoy/forensics" -> "/missions/aghoy"
 */
function getParentFolder(path) {
    path = sanitizePath(path);
    if (path === '/') return '/';

    var lastSlash = path.lastIndexOf('/');
    return lastSlash === 0 ? '/' : path.substring(0, lastSlash);
}

/**
 * Rename a folder (updates all notes in it)
 */
function renameFolder(oldPath, newName) {
    oldPath = sanitizePath(oldPath);
    newName = newName.trim().replace(/\//g, '');

    if (!newName) {
        console.error('Invalid folder name');
        return false;
    }

    var parent = getParentFolder(oldPath);
    var newPath = parent === '/' ? '/' + newName : parent + '/' + newName;

    var updated = 0;
    NOTES.forEach(function (note) {
        if (note.path === oldPath) {
            note.path = newPath;
            updated++;
        } else if (note.path.startsWith(oldPath + '/')) {
            // Update subfolders too
            note.path = note.path.replace(oldPath, newPath);
            updated++;
        }
    });

    if (updated > 0) {
        saveData();
        console.log('Renamed folder:', oldPath, '->', newPath, '(updated', updated, 'notes)');
    }

    return updated > 0;
}

/**
 * Delete a folder and all its notes
 */
function deleteFolder(path) {
    path = sanitizePath(path);
    if (path === '/') {
        console.error('Cannot delete root folder');
        return false;
    }

    var beforeCount = NOTES.length;
    NOTES = NOTES.filter(function (note) {
        // Keep notes NOT in this folder or its subfolders
        return !note.path.startsWith(path + '/') && note.path !== path;
    });

    var deleted = beforeCount - NOTES.length;
    if (deleted > 0) {
        saveData();
        console.log('Deleted folder:', path, '(removed', deleted, 'notes)');
    }

    return deleted > 0;
}

/**
 * Update wiki links for a note
 * Call this whenever note content changes
 */
function updateNoteLinks(noteId) {
    var note = NOTES.find(function (n) { return n.id === noteId; });
    if (!note) return;

    note.links = extractWikiLinks(note.content || '');
    saveData();
}

/**
 * Get all notes that link TO a specific note
 * (Backlinks - for graph view)
 */
function getBacklinks(noteId) {
    var note = NOTES.find(function (n) { return n.id === noteId; });
    if (!note) return [];

    var targetTitle = note.title || 'Untitled';
    return NOTES.filter(function (n) {
        return n.id !== noteId &&
            n.links &&
            n.links.some(function (link) {
                // Match by title (case-insensitive)
                return link.toLowerCase() === targetTitle.toLowerCase();
            });
    });
}

/**
 * Graph data generator for D3.js
 * Returns { nodes: [], links: [] } structure
 */
/**
 * PHASE 7.1: EXTENDED GRAPH DATA GENERATOR
 * Returns { nodes: [], links: [] } structure including pages and boards
 */
function generateGraphData(folderFilter) {
    var nodes = [];
    var links = [];
    var nodeMap = {};

    // 1. Process Notes
    NOTES.forEach(function (note) {
        if (folderFilter && !note.path.startsWith(folderFilter)) return;

        var node = {
            id: note.id,
            label: note.title || 'UNTITLED_ENTRY',
            type: 'note',
            path: note.path,
            value: 10,
            color: 'var(--main-color)'
        };
        nodes.push(node);
        nodeMap[(note.title || '').toLowerCase()] = note.id;
    });

    // 2. Process Boards
    BOARDS.forEach(function (board) {
        var node = {
            id: board.id,
            label: 'BOARD:' + board.title.toUpperCase(),
            type: 'board',
            value: 15,
            color: '#00ccff' // High-tech blue for boards
        };
        nodes.push(node);
        nodeMap['board:' + (board.title || '').toLowerCase()] = board.id;
    });

    // 3. Process Links
    NOTES.forEach(function (note) {
        if (folderFilter && !note.path.startsWith(folderFilter)) return;

        // Wiki-links
        if (note.links && Array.isArray(note.links)) {
            note.links.forEach(function (linkTarget) {
                var targetId = nodeMap[linkTarget.toLowerCase()];
                if (targetId && targetId !== note.id) {
                    links.push({ source: note.id, target: targetId });
                }
            });
        }

        // Block-based Kanban/Board links
        if (note.blocks && Array.isArray(note.blocks)) {
            note.blocks.forEach(function (block) {
                if (block.type === 'kanban_ref' && block.boardId) {
                    links.push({ source: note.id, target: block.boardId });
                }
            });
        }
    });

    return { nodes: nodes, links: links };
}

/* =========================================
   INDEXEDDB - STORAGE MATRIX
   ========================================= */
const DB_NAME = "OPERATOR_VAULT";
const STORE_NAME = "media_assets";

const DB = {
    open: function () {
        return new Promise(function (resolve, reject) {
            var request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = function (e) { resolve(e.target.result); };
            request.onerror = function (e) { reject(e); };
        });
    },
    save: function (key, blob) {
        return DB.open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, "readwrite");
                var store = tx.objectStore(STORE_NAME);
                store.put(blob, key);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function (e) { reject(e); };
            });
        });
    },
    get: function (key) {
        return DB.open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, "readonly");
                var store = tx.objectStore(STORE_NAME);
                var request = store.get(key);
                request.onsuccess = function () { resolve(request.result); };
                request.onerror = function (e) { reject(e); };
            });
        });
    }
};

/* =========================================
   THEME PRESETS (V17.0 - Complete Packages)
   ========================================= */
const THEME_PRESETS = {
    matrix: {
        name: "Matrix",
        theme_color: "#00FF41",
        secondary_color: "#006618",
        clock_font: "Space Mono",
        secondary_font: "'Space Mono', monospace",
        filter_grayscale: 100,
        filter_contrast: 120,
        filter_brightness: 60,
        filter_blur: 0
    },
    cyberpunk: {
        name: "Cyberpunk Neon",
        theme_color: "#FF00FF",
        secondary_color: "#00FFFF",
        clock_font: "VT323",
        secondary_font: "'VT323', monospace",
        filter_grayscale: 0,
        filter_contrast: 140,
        filter_brightness: 50,
        filter_blur: 0
    },
    ocean: {
        name: "Ocean Blue",
        theme_color: "#00FFFF",
        secondary_color: "#0077BE",
        clock_font: "Roboto Mono",
        secondary_font: "'Roboto Mono', monospace",
        filter_grayscale: 50,
        filter_contrast: 110,
        filter_brightness: 70,
        filter_blur: 0
    },
    sunset: {
        name: "Sunset",
        theme_color: "#FF6600",
        secondary_color: "#CC3300",
        clock_font: "Ubuntu Mono",
        secondary_font: "'Ubuntu Mono', monospace",
        filter_grayscale: 0,
        filter_contrast: 130,
        filter_brightness: 55,
        filter_blur: 0
    },
    minimal: {
        name: "Minimal Grayscale",
        theme_color: "#FFFFFF",
        secondary_color: "#888888",
        clock_font: "Inconsolata",
        secondary_font: "'Inconsolata', monospace",
        filter_grayscale: 100,
        filter_contrast: 100,
        filter_brightness: 40,
        filter_blur: 0
    },
    blood: {
        name: "Blood Moon",
        theme_color: "#D32F2F",
        secondary_color: "#8B0000",
        clock_font: "Fira Code",
        secondary_font: "'Fira Code', monospace",
        filter_grayscale: 20,
        filter_contrast: 130,
        filter_brightness: 50,
        filter_blur: 0
    },
    gold: {
        name: "Gold Rush",
        theme_color: "#FFD700",
        secondary_color: "#B8860B",
        clock_font: "JetBrains Mono",
        secondary_font: "'JetBrains Mono', monospace",
        filter_grayscale: 0,
        filter_contrast: 110,
        filter_brightness: 90,
        filter_blur: 0
    },
    forest: {
        name: "Forest",
        theme_color: "#228B22",
        secondary_color: "#90EE90",
        clock_font: "Source Code Pro",
        secondary_font: "'Source Code Pro', monospace",
        filter_grayscale: 30,
        filter_contrast: 115,
        filter_brightness: 65,
        filter_blur: 0
    },
    amber: {
        name: "Amber Terminal",
        theme_color: "#FFBF00",
        secondary_color: "#CC9900",
        clock_font: "VT323",
        secondary_font: "'VT323', monospace",
        filter_grayscale: 0,
        filter_contrast: 120,
        filter_brightness: 70,
        filter_blur: 0
    },
    ice: {
        name: "Ice",
        theme_color: "#87CEEB",
        secondary_color: "#B0E0E6",
        clock_font: "IBM Plex Mono",
        secondary_font: "'IBM Plex Mono', monospace",
        filter_grayscale: 40,
        filter_contrast: 105,
        filter_brightness: 80,
        filter_blur: 0
    },
    lavender: {
        name: "Lavender Dreams",
        theme_color: "#9370DB",
        secondary_color: "#E6E6FA",
        clock_font: "Roboto Mono",
        secondary_font: "'Roboto Mono', monospace",
        filter_grayscale: 10,
        filter_contrast: 100,
        filter_brightness: 75,
        filter_blur: 0
    },
    retrogreen: {
        name: "Retro CRT",
        theme_color: "#33FF33",
        secondary_color: "#00AA00",
        clock_font: "VT323",
        secondary_font: "'VT323', monospace",
        filter_grayscale: 0,
        filter_contrast: 150,
        filter_brightness: 45,
        filter_blur: 0,
        crt_effect: true
    }
};

const QUOTES = [
    "The best way to predict the future is to invent it.",
    "Simplicity is the ultimate sophistication.",
    "Code is like humor. When you have to explain it, it's bad.",
    "Fix the cause, not the symptom.",
    "Make it work, make it right, make it fast.",
    "Talk is cheap. Show me the code.",
    "Stay hungry, stay foolish.",
    "It's not a bug, it's a feature.",
    "Before software can be reusable it first has to be usable.",
    "Optimism is an occupational hazard of programming."
];

/* =========================================
   PHASE 2: TREE VIEW HELPERS
   ========================================= */

/**
 * Build logical folder structure from flat notes list
 * Returns object: { "folderName": { ...subfolders..., __files__: [notes] } }
 */
function buildDirectoryStructure(notes) {
    var root = { __files__: [], __path__: '/' };

    notes.forEach(function (note) {
        var path = note.path || '/';
        var parts = path.split('/').filter(function (p) { return p.length > 0; });

        var current = root;
        var currentPath = '';

        parts.forEach(function (part) {
            currentPath += '/' + part;
            if (!current[part]) {
                current[part] = { __files__: [], __path__: currentPath };
            }
            current = current[part];
        });

        current.__files__.push(note);
    });

    return root;
}

/**
 * Recursive Tree Filter
 * Returns new structure containing only matching items/ancestors
 */
function filterTreeStructure(structure, query) {
    var newStructure = { __files__: [], __path__: structure.__path__ };
    var hasMatch = false;

    // V3.9: Get folder name from path
    var pathParts = structure.__path__.split('/').filter(Boolean);
    var folderName = pathParts[pathParts.length - 1] || '';
    var folderNameMatch = folderName.toLowerCase().indexOf(query) !== -1;

    // 1. Filter Files in current folder
    newStructure.__files__ = structure.__files__.filter(function (note) {
        var matchTitle = (note.title && note.title.toLowerCase().indexOf(query) !== -1);
        var matchContent = (note.content && note.content.toLowerCase().indexOf(query) !== -1);
        var match = matchTitle || matchContent || folderNameMatch;
        if (match) hasMatch = true;
        return match;
    });

    // 2. Recursively Filter Subfolders
    var folders = Object.keys(structure).filter(function (k) { return k !== '__files__' && k !== '__path__'; });

    folders.forEach(function (folderName) {
        var subResult = filterTreeStructure(structure[folderName], query);
        // If subfolder has content (files or matching subfolders) OR if folder name itself matches query, keep it
        if (subResult._hasMatch || folderName.toLowerCase().indexOf(query) !== -1) {
            newStructure[folderName] = subResult.structure;
            hasMatch = true;
        }
    });

    return { structure: newStructure, _hasMatch: hasMatch };
}

/**
 * Render HTML for the File Tree
 * Recursive function to build sidebar DOM
 */
function renderFileTree(structure, basePath, forceExpand) {
    var container = document.createElement('div');
    container.className = 'tree-container';

    // 1. Render Folders (sorted alphabetical)
    var folders = Object.keys(structure).filter(function (k) { return k !== '__files__' && k !== '__path__'; }).sort();

    folders.forEach(function (folderName) {
        var folderData = structure[folderName];
        var fullPath = folderData.__path__;

        var folderEl = document.createElement('div');
        folderEl.className = 'tree-folder';

        // Header (ASCII ICONS)
        var header = document.createElement('div');
        header.className = 'tree-folder-header';
        header.setAttribute('draggable', 'true'); // V3.9: Make folders draggable

        // V3.9: Check persistent state
        // If forceExpand is true (searching), we expand IF there's a match in children or if it's a match itself
        var isExpanded = forceExpand || (Notes.expandedFolders.indexOf(fullPath) !== -1);

        var iconState = isExpanded ? '[-]' : '[+]';
        header.innerHTML = `
            <span class="folder-icon">${iconState}</span>
            <span class="folder-name">${folderName}</span>
            <span class="folder-delete-btn" title="Delete folder and contents">[X]</span>
        `;

        // Folder Delete Event
        var delBtn = header.querySelector('.folder-delete-btn');
        if (delBtn) {
            delBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (typeof Notes.deleteFolder === 'function') {
                    Notes.deleteFolder(fullPath);
                }
            });
        }

        // Drag events for FOLDER (Source)
        header.addEventListener('dragstart', function (e) {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/x-folder-path', fullPath);
            header.style.opacity = '0.5';
        });
        header.addEventListener('dragend', function (e) {
            header.style.opacity = '1';
        });

        // Drag & Drop (Target)
        header.addEventListener('dragover', function (e) {
            e.preventDefault();
            header.classList.add('drag-over');
        });
        header.addEventListener('dragleave', function (e) {
            header.classList.remove('drag-over');
        });
        header.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            header.classList.remove('drag-over');

            var noteId = e.dataTransfer.getData('text/plain');
            var srcFolderPath = e.dataTransfer.getData('application/x-folder-path');

            if (noteId && typeof Notes.moveNote === 'function') {
                Notes.moveNote(noteId, fullPath);
            } else if (srcFolderPath && typeof Notes.moveFolder === 'function') {
                Notes.moveFolder(srcFolderPath, fullPath);
            }
        });

        // Recursion
        var childrenContainer = renderFileTree(folderData, fullPath, forceExpand);
        childrenContainer.className = 'tree-children';

        // Toggle Logic
        childrenContainer.style.display = isExpanded ? 'block' : 'none';
        if (isExpanded) {
            header.classList.add('open');
        }

        header.addEventListener('click', function (e) {
            e.stopPropagation();
            var currentlyOpen = childrenContainer.style.display !== 'none';
            var nowOpen = !currentlyOpen;

            childrenContainer.style.display = nowOpen ? 'block' : 'none';
            header.classList.toggle('open', nowOpen);

            var iconEl = header.querySelector('.folder-icon');
            if (iconEl) iconEl.textContent = nowOpen ? '[-]' : '[+]';

            // V3.9: Update persistent state
            var idx = Notes.expandedFolders.indexOf(fullPath);
            if (nowOpen) {
                if (idx === -1) Notes.expandedFolders.push(fullPath);
            } else {
                if (idx !== -1) Notes.expandedFolders.splice(idx, 1);
            }
            Notes.saveExpandedState();
        });

        folderEl.appendChild(header);
        folderEl.appendChild(childrenContainer);
        container.appendChild(folderEl);
    });

    // 2. Render Files
    var files = structure.__files__.sort(function (a, b) {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (b.modified || 0) - (a.modified || 0);
    });

    files.forEach(function (note) {
        var noteEl = document.createElement('div');
        noteEl.className = 'sidebar-note-item';
        noteEl.setAttribute('draggable', 'true');

        if (note.id === Notes.activeNoteId) noteEl.classList.add('active');
        if (Notes.selectedNotes.indexOf(note.id) !== -1) noteEl.classList.add('selected');

        var title = note.title || 'Untitled Note';
        var date = new Date(note.modified).toLocaleDateString();

        // ASCII PIN (Safe)
        var pinDisplay = note.pinned ? '<span class="pin-icon" style="color:var(--main-color); margin-right:4px;">[PIN]</span>' : '';

        noteEl.innerHTML = `
            <div class="note-title">${pinDisplay}${title}</div>
            <div class="note-snippet">${date}</div>
        `;

        noteEl.addEventListener('click', function (e) {
            if (Notes.isSelectionMode) {
                Notes.toggleSelection(note.id);
            } else {
                Notes.open(note.id);
            }
        });

        noteEl.addEventListener('dragstart', function (e) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', note.id);
            noteEl.style.opacity = '0.5';
        });

        noteEl.addEventListener('dragend', function (e) {
            noteEl.style.opacity = '1';
        });

        container.appendChild(noteEl);
    });

    return container;
}

/* =========================================
   STORAGE
   ========================================= */
function loadConfig() {
    try {
        var stored = localStorage.getItem('OPERATOR_CONFIG_V3');
        if (stored) {
            var parsed = JSON.parse(stored);
            CONFIG = Object.assign({}, getDefaultConfig(), parsed);
            if (!Array.isArray(CONFIG.dock_links)) CONFIG.dock_links = getDefaultConfig().dock_links;
            if (!Array.isArray(CONFIG.custom_commands)) CONFIG.custom_commands = getDefaultConfig().custom_commands;
            if (!Array.isArray(CONFIG.backgrounds)) CONFIG.backgrounds = [];
        }
    } catch (e) {
        console.error('Config load error:', e);
        CONFIG = getDefaultConfig();
    }
}

function saveConfig() {
    try {
        CONFIG.version = CONFIG_VERSION;
        localStorage.setItem('OPERATOR_CONFIG_V3', JSON.stringify(CONFIG));
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.set({ OPERATOR_CONFIG_V3: CONFIG });
        }
    } catch (e) {
        console.error('Config save error:', e);
    }
}

// V15.2: Voltron Architecture - VinlandDB Wrapper
var VinlandDB = {
    collections: {
        TASKS: 'OPERATOR_TASKS_V2',
        NOTES: 'OPERATOR_NOTES_V2',
        BOARDS: 'OPERATOR_BOARDS_V1',
        HISTORY: 'OPERATOR_HISTORY_V2',
        SESSIONS: 'OPERATOR_SESSIONS'
    },

    save: function(collection, data) {
        try {
            var key = this.collections[collection];
            if (key) localStorage.setItem(key, JSON.stringify(data));
        } catch (e) { console.error('VinlandDB: Save failure', e); }
    },

    load: function(collection, defaultValue) {
        try {
            var key = this.collections[collection];
            var data = localStorage.getItem(key);
            return data ? JSON.parse(data) : (defaultValue || []);
        } catch (e) { 
            console.error('VinlandDB: Load failure', e);
            return defaultValue || [];
        }
    }
};

function loadData() {
    TASKS = VinlandDB.load('TASKS');
    NOTES = VinlandDB.load('NOTES');
    BOARDS = VinlandDB.load('BOARDS');
    COMMAND_HISTORY = VinlandDB.load('HISTORY');
    
    var sessions = parseInt(localStorage.getItem(VinlandDB.collections.SESSIONS) || '0') + 1;
    localStorage.setItem(VinlandDB.collections.SESSIONS, sessions.toString());
    var sessionEl = document.getElementById('session-count');
    if (sessionEl) sessionEl.textContent = sessions;
}

function saveData() {
    VinlandDB.save('TASKS', TASKS);
    VinlandDB.save('NOTES', NOTES);
    VinlandDB.save('BOARDS', BOARDS);
    VinlandDB.save('HISTORY', COMMAND_HISTORY);
}

/* =========================================
   UTILITIES
   ========================================= */
function safeText(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function validateURL(url) {
    if (!url) return null;
    url = url.trim();
    if (url.startsWith('sys:')) return url;
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('chrome://')) return url;
    return 'https://' + url;
}

/* =========================================
   THEME & APPEARANCE
   ========================================= */
function updateDynamicIcon(color) {
    if (!color) color = CONFIG.theme_color || '#00FF41';
    
    // SVG template matching the icon.png style (</> terminal symbol)
    // We use a clean pixel-perfect path for the symbol
    var svg = `
    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" fill="black"/>
        <path d="M10 8L2 16L10 24" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M22 8L30 16L22 24" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M18 6L14 26" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    
    DYNAMIC_ICON_URL = 'data:image/svg+xml;base64,' + btoa(svg.trim());
    
    // Update Favicon
    var link = document.querySelector("link[rel*='icon']");
    if (link) {
        link.href = DYNAMIC_ICON_URL;
    }
}

function applyTheme() {
    var color = CONFIG.theme_color || '#00FF41';
    document.documentElement.style.setProperty('--main-color', color);
    
    updateDynamicIcon(color);

    // V21: Dirty tracking moved to openConfig() for guaranteed DOM availability

    // V3.0: Settings save
    // V3.5: Set RGB values for rgba() usage
    var r = 0, g = 255, b = 65; // Default neon green
    if (color.startsWith('#')) {
        var hex = color.substring(1);
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        if (hex.length === 6) {
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
        }
    }
    document.documentElement.style.setProperty('--main-color-rgb', r + ', ' + g + ', ' + b);

    var crt = document.getElementById('crt-overlay');
    if (crt) {
        if (CONFIG.crt_effect) crt.classList.add('active');
        else crt.classList.remove('active');
    }

    // Vignette effect (V17)
    var vignette = document.getElementById('vignette-overlay');
    if (vignette) {
        if (CONFIG.vignette_effect) vignette.classList.add('active');
        else vignette.classList.remove('active');
    }

    // Noise effect (V17)
    var noise = document.getElementById('noise-overlay');
    if (noise) {
        if (CONFIG.noise_effect) noise.classList.add('active');
        else noise.classList.remove('active');
    }

    var clockEl = document.getElementById('clock');
    if (clockEl) {
        var fontFamily = CONFIG.clock_font || 'Space Mono';
        var fontSize = (CONFIG.clock_font_size || 7) + 'rem';
        clockEl.style.fontFamily = "'" + fontFamily + "', monospace";
        clockEl.style.fontSize = fontSize;
    }

    var weatherEl = document.getElementById('weather-widget');
    if (weatherEl) {
        var scale = CONFIG.weather_scale || 1.0;
        weatherEl.style.transform = 'scale(' + scale + ')';
        weatherEl.style.transformOrigin = 'top right';
    }

    applyVideoFilter();
}

/* =========================================
   TIME & GREETING
   ========================================= */
function updateTime() {
    var now = new Date();
    var time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    var date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    var clockEl = document.getElementById('clock');
    var dateEl = document.getElementById('date');
    if (clockEl) clockEl.textContent = time;
    if (dateEl) dateEl.textContent = date.toUpperCase();

    // V18.11: Check streak reset once per day (handles long-lived tabs)
    var todayStr = now.toDateString();
    if (LAST_STREAK_CHECK_DATE !== todayStr) {
        LAST_STREAK_CHECK_DATE = todayStr;
        checkStreakReset();
    }

    updateGreeting(now.getHours());
    updateUptime();
}

function updateGreeting(hour) {
    var greetingEl = document.getElementById('greeting');
    if (!greetingEl) return;

    var greeting;
    if (hour >= 5 && hour < 12) greeting = "GOOD MORNING";
    else if (hour >= 12 && hour < 17) greeting = "GOOD AFTERNOON";
    else if (hour >= 17 && hour < 21) greeting = "GOOD EVENING";
    else greeting = "WELCOME TO VINLAND";

    if (CONFIG.user_name && CONFIG.user_name.trim()) {
        greetingEl.innerHTML = greeting + ', <span class="name">' + safeText(CONFIG.user_name.toUpperCase()) + '</span>';
    } else {
        greetingEl.textContent = greeting;
    }
}

function updateUptime() {
    var elapsed = Math.floor((Date.now() - SESSION_START) / 1000);
    var hours = Math.floor(elapsed / 3600).toString().padStart(2, '0');
    var mins = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
    var secs = (elapsed % 60).toString().padStart(2, '0');
    var uptimeEl = document.getElementById('uptime');
    if (uptimeEl) uptimeEl.textContent = hours + ':' + mins + ':' + secs;
}

function updateTabTitle() {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.getCurrent) {
        try {
            chrome.tabs.getCurrent(function (tab) {
                if (tab) {
                    var id = (tab.index + 1).toString().padStart(2, '0');
                    document.title = 'TERMINAL : ' + id;
                }
            });
        } catch (e) {
            document.title = 'TERMINAL : 01';
        }
    } else {
        document.title = 'TERMINAL : 01';
    }
}

/* =========================================
   WEATHER (Fixed encoding)
   ========================================= */
function fetchWeather() {
    var widget = document.getElementById('weather-widget');
    if (!widget) return;

    if (!CONFIG.location || !CONFIG.location.trim()) {
        widget.classList.remove('active');
        return;
    }

    var CACHE_KEY = 'OPERATOR_WEATHER_CACHE';
    var CACHE_DURATION = 1800000; // 30 minutes in ms
    var now = Date.now();

    // V63.4: Show loading indicator with animation
    var conditionEl = document.getElementById('weather-condition');
    var locEl = document.getElementById('weather-location');
    if (conditionEl) {
        conditionEl.textContent = 'SYNCING_DATA...';
        conditionEl.classList.add('weather-loading');
    }
    if (locEl) locEl.classList.add('weather-loading');
    widget.classList.add('active');

    // V18.11: Memory-first cache check
    if (!WEATHER_CACHE) {
        try {
            WEATHER_CACHE = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        } catch (e) {
            WEATHER_CACHE = {};
        }
    }

    // Use cache if valid (less than 30 mins old and same location)
    if (WEATHER_CACHE.data && (now - WEATHER_CACHE.timestamp < CACHE_DURATION) && WEATHER_CACHE.location === CONFIG.location) {
        updateWeatherUI(WEATHER_CACHE.data);
        widget.classList.add('active');
        return;
    }

    widget.classList.add('active');
    var loc = encodeURIComponent(CONFIG.location.trim());

    fetch('https://wttr.in/' + loc + '?format=j1')
        .then(function (response) {
            if (!response.ok) throw new Error('Weather fetch failed');
            return response.json();
        })
        .then(function (data) {
            // Update memory cache first
            WEATHER_CACHE = {
                timestamp: Date.now(),
                location: CONFIG.location,
                data: data
            };
            // Then persist to localStorage
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify(WEATHER_CACHE));
            } catch (e) { }

            updateWeatherUI(data);
        })
        .catch(function (err) {
            console.error('Weather error:', err);
            // V63.4: Clear loading states and show error
            var conditionEl = document.getElementById('weather-condition');
            var locEl = document.getElementById('weather-location');
            if (conditionEl) {
                conditionEl.textContent = 'LOCATION_ERROR';
                conditionEl.classList.remove('weather-loading');
                conditionEl.classList.add('weather-error');
            }
            if (locEl) {
                locEl.classList.remove('weather-loading');
                locEl.textContent = 'VERIFY_COORDINATES';
            }
            document.getElementById('weather-temp').textContent = '--';
            document.getElementById('weather-unit').textContent = '';
        });
}

function updateWeatherUI(data) {
    if (!data || !data.current_condition || !data.current_condition[0]) {
        console.warn('Weather data missing current_condition');
        return;
    }
    var current = data.current_condition[0];
    var temp = CONFIG.use_celsius ? current.temp_C : current.temp_F;
    var unit = CONFIG.use_celsius ? 'C' : 'F';
    var condition = current.weatherDesc[0].value;
    var humidity = current.humidity;
    var windKph = current.windspeedKmph;
    var feelsC = current.FeelsLikeC;
    var feelsF = current.FeelsLikeF;
    var feels = CONFIG.use_celsius ? feelsC : feelsF;

    document.getElementById('weather-temp').textContent = temp;
    document.getElementById('weather-unit').textContent = String.fromCharCode(176) + unit;
    
    var conditionEl = document.getElementById('weather-condition');
    var locEl = document.getElementById('weather-location');
    
    if (conditionEl) {
        conditionEl.textContent = condition.toUpperCase();
        conditionEl.classList.remove('weather-loading', 'weather-error');
    }
    if (locEl) {
        locEl.textContent = CONFIG.location.toUpperCase();
        locEl.classList.remove('weather-loading');
    }
    document.getElementById('weather-humidity').textContent = humidity + '%';
    document.getElementById('weather-wind').textContent = windKph + ' km/h';
    document.getElementById('weather-feels').textContent = feels + String.fromCharCode(176);

    var extraEl = document.getElementById('weather-extra');
    if (extraEl) {
        if (CONFIG.weather_extended) extraEl.classList.add('active');
        else extraEl.classList.remove('active');
    }
}

/* =========================================
   BACKGROUND - with retry limits and image support
   ========================================= */
function initBackground() {
    var video = document.getElementById('bg-video');
    var bgImage = document.getElementById('bg-image');

    // Create background image element if it doesn't exist
    if (!bgImage) {
        bgImage = document.createElement('div');
        bgImage.id = 'bg-image';
        bgImage.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background-size:cover;background-position:center;z-index:0;opacity:0;transition:opacity 0.4s;';
        document.body.insertBefore(bgImage, document.body.firstChild);
    }

    // Check background type
    if (CONFIG.background_type === 'color') {
        if (video) video.style.display = 'none';
        bgImage.style.display = 'none';
        document.body.style.backgroundColor = CONFIG.background_color || '#000';
        return;
    }

    var bgList = CONFIG.backgrounds && CONFIG.backgrounds.length > 0 ? CONFIG.backgrounds : [];

    // No backgrounds configured - use default or solid color
    if (bgList.length === 0) {
        tryLoadVideo(video, 'background.mp4', bgImage);
        return;
    }

    var randomBg = bgList[Math.floor(Math.random() * bgList.length)].trim();

    // Check for Database Media
    if (randomBg.startsWith('db:')) {
        var key = randomBg.replace('db:', '');
        DB.get(key).then(function (blob) {
            if (blob) {
                var url = URL.createObjectURL(blob);
                // Check if image or video based on MIME type or extension
                // Blob might have type, if not fallback to extension from key
                var isImg = blob.type.startsWith('image/') || key.match(/\.(jpg|jpeg|png|gif|webp)$/i);

                if (isImg) {
                    if (video) video.style.display = 'none';
                    loadBackgroundImage(bgImage, url);
                } else {
                    bgImage.style.display = 'none';
                    tryLoadVideo(video, url, bgImage);
                }
            } else {
                console.log('Asset missing from Vault:', key);
                tryLoadVideo(video, 'background.mp4', bgImage);
            }
        }).catch(function (e) {
            console.error('DB Error', e);
            tryLoadVideo(video, 'background.mp4', bgImage);
        });
        return;
    }

    // Check file extension to determine type (Standard URL)
    var ext = randomBg.split('.').pop().toLowerCase().split('?')[0];
    var isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(ext);

    if (isImage) {
        // Use as background image (works for GIFs too)
        if (video) video.style.display = 'none';
        loadBackgroundImage(bgImage, randomBg);
    } else {
        // Try as video
        bgImage.style.display = 'none';
        tryLoadVideo(video, randomBg, bgImage);
    }
}

function loadBackgroundImage(bgImage, url) {
    var img = new Image();
    img.onload = function () {
        bgImage.style.backgroundImage = 'url(' + url + ')';
        bgImage.style.opacity = '1';
        bgImage.style.display = 'block';
        applyVideoFilter(); // Apply filters to image too
    };
    img.onerror = function () {
        console.log('Image load failed:', url);
        bgImage.style.display = 'none';
        document.body.style.backgroundColor = CONFIG.background_color || '#000';
    };
    img.src = url;
}

function tryLoadVideo(video, src, bgImage) {
    if (!video) return;

    BG_RETRY_COUNT = 0;
    video.style.opacity = '0';
    video.style.display = 'block';
    video.src = src;

    video.oncanplay = function () {
        video.play().catch(function (e) {
            console.log('Video autoplay blocked:', e);
        });
        video.style.opacity = '1';
        applyVideoFilter();
    };

    video.onerror = function () {
        BG_RETRY_COUNT++;

        if (BG_RETRY_COUNT > BG_MAX_RETRIES) {
            console.log('Max video retries reached. Using fallback.');
            video.style.display = 'none';
            // Try default background.mp4 once
            if (src !== 'background.mp4') {
                tryLoadVideo(video, 'background.mp4', bgImage);
            } else {
                // Final fallback: solid color
                document.body.style.backgroundColor = CONFIG.background_color || '#000';
            }
            return;
        }

        console.log('Video load error (attempt ' + BG_RETRY_COUNT + '/' + BG_MAX_RETRIES + ')');
    };
}

function applyVideoFilter() {
    var video = document.getElementById('bg-video');
    var bgImage = document.getElementById('bg-image');

    if (CONFIG.filter_enabled === false) {
        if (video) video.style.filter = 'none';
        if (bgImage) bgImage.style.filter = 'none';
        return;
    }

    var gs = CONFIG.filter_grayscale !== undefined ? CONFIG.filter_grayscale : 100;
    var ct = CONFIG.filter_contrast !== undefined ? CONFIG.filter_contrast : 120;
    var br = CONFIG.filter_brightness !== undefined ? CONFIG.filter_brightness : 60;
    var bl = CONFIG.filter_blur !== undefined ? CONFIG.filter_blur : 0;

    var filter = 'grayscale(' + gs + '%) contrast(' + (ct / 100) + ') brightness(' + (br / 100) + ')';
    if (bl > 0) filter += ' blur(' + bl + 'px)';

    if (video) video.style.filter = filter;
    if (bgImage) bgImage.style.filter = filter;
}

/* =========================================
   DOCK
   ========================================= */
function renderDock() {
    var dock = document.getElementById('dock');
    if (!dock) return;
    dock.innerHTML = '';

    if (!CONFIG.dock_links || !Array.isArray(CONFIG.dock_links)) return;

    CONFIG.dock_links.forEach(function (link) {
        var a = document.createElement('a');
        a.href = link.url;
        a.textContent = '[ ' + link.name.toUpperCase() + ' ]';
        dock.appendChild(a);
    });
}

/* =========================================
   TASKS
   ========================================= */
function renderMissions() {
    var list = document.getElementById('mission-list');
    var container = document.getElementById('mission-log');
    if (!list || !container) return;

    if (!TASKS || TASKS.length === 0) {
        container.classList.remove('active');
        return;
    }

    container.classList.add('active');
    list.innerHTML = '';

    // V18.4: Filter out completed tasks if setting enabled
    var tasksToRender = TASKS;
    if (CONFIG.hide_completed_tasks) {
        tasksToRender = TASKS.filter(function (t) { return !t.completed; });
    }

    // V18.4: If all filtered out and hide enabled, show message
    if (tasksToRender.length === 0 && TASKS.length > 0) {
        list.innerHTML = '<div class="note-time" style="opacity:0.5">[' + TASKS.length + ' completed - click or use Settings to show]</div>';
        list.style.cursor = 'pointer';
        list.onclick = function () {
            CONFIG.hide_completed_tasks = false;
            saveConfig();
            renderMissions();
        };
        return;
    } else {
        list.style.cursor = 'default';
        list.onclick = null;
    }

    // V18.0: Sort by priority (high first)
    var sortedTasks = tasksToRender.slice().sort(function (a, b) {
        var priorityOrder = { high: 0, medium: 1, normal: 2, low: 3 };
        var aPri = priorityOrder[a.priority] || 2;
        var bPri = priorityOrder[b.priority] || 2;
        return aPri - bPri;
    });

    var fragment = document.createDocumentFragment();
    sortedTasks.forEach(function (task, i) {
        var originalIndex = TASKS.indexOf(task);
        var div = document.createElement('div');
        div.className = 'mission-item ' + (task.completed ? 'completed' : '');
        if (task.priority && task.priority !== 'normal') {
            div.classList.add('priority-' + task.priority);
        }

        // V18.0: Priority indicator
        var priorityIndicator = document.createElement('span');
        priorityIndicator.className = 'priority-indicator';
        if (task.priority === 'high') {
            priorityIndicator.textContent = '!! ';
            priorityIndicator.style.color = 'var(--danger-color)';
        } else if (task.priority === 'medium') {
            priorityIndicator.textContent = '! ';
            priorityIndicator.style.color = 'var(--warning-color)';
        } else if (task.priority === 'low') {
            priorityIndicator.textContent = '~ ';
            priorityIndicator.style.color = 'var(--secondary-color)';
        } else {
            priorityIndicator.textContent = '| ';
            priorityIndicator.style.color = 'var(--main-color)';
        }
        div.appendChild(priorityIndicator);

        var checkbox = document.createElement('span');
        checkbox.className = 'task-checkbox';
        checkbox.textContent = '[' + (task.completed ? 'x' : '\u00A0') + '] ';
        checkbox.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleTaskComplete(originalIndex);
        });
        div.appendChild(checkbox);

        if (task.time) {
            var timeSpan = document.createElement('span');
            timeSpan.className = 'mission-time';
            timeSpan.textContent = '[' + safeText(task.time) + '] ';
            div.appendChild(timeSpan);
        }

        var textSpan = document.createElement('span');
        textSpan.className = 'mission-text';
        textSpan.textContent = task.text;
        div.appendChild(textSpan);

        // V18.0: Category badge
        if (task.category) {
            var catBadge = document.createElement('span');
            catBadge.className = 'category-badge';
            catBadge.textContent = '@' + task.category;
            div.appendChild(catBadge);
        }

        fragment.appendChild(div);
    });
    list.appendChild(fragment);

    updateProgressBar(); // V18.0
}

function addTask(rawText, timeOverride) {
    if (!rawText || !rawText.trim()) return;
    var text = rawText.trim();
    var timeStart = text.indexOf('[');
    var timeEnd = text.indexOf(']');
    var time = timeOverride || '';
    if (timeStart !== -1 && timeEnd !== -1 && timeStart < timeEnd) {
        time = text.substring(timeStart + 1, timeEnd);
        text = text.substring(0, timeStart) + text.substring(timeEnd + 1);
        text = text.trim();
    }

    var priority = 'normal';
    if (text.startsWith('!!')) {
        priority = 'high';
        text = text.substring(2).trim();
    } else if (text.startsWith('!')) {
        priority = 'medium';
        text = text.substring(1).trim();
    } else if (text.startsWith('~')) {
        priority = 'low';
        text = text.substring(1).trim();
    }

    // Category logic
    var category = null;
    var catMatch = text.match(/@(\w+)/);
    if (catMatch) {
        category = catMatch[1];
        text = text.replace(catMatch[0], '').trim();
    }

    TASKS.push({
        text: text,
        completed: false,
        time: time,
        priority: priority,
        category: category
    });

    saveData();
    renderMissions();
    updateProgressBar();
}

function toggleTaskComplete(index) {
    if (TASKS[index]) {
        TASKS[index].completed = !TASKS[index].completed;
        saveData();
        renderMissions();
        updateProgressBar(); // V18.4: Update progress bar when task completion changes
    }
}

function clearCompletedTasks() {
    TASKS = TASKS.filter(function (t) { return !t.completed; });
    saveData();
    renderMissions();
}

/* =========================================
   PROGRESS BAR & STREAK (V18.0)
   ========================================= */
function updateProgressBar() {
    var progressBar = document.getElementById('progress-bar');
    var progressText = document.getElementById('progress-text');
    if (!progressBar || !progressText) return;

    if (!TASKS || TASKS.length === 0) {
        progressBar.style.width = '0%';
        progressText.textContent = 'NO TASKS';
        return;
    }

    var completed = TASKS.filter(function (t) { return t.completed; }).length;
    var total = TASKS.length;
    var percent = Math.round((completed / total) * 100);

    progressBar.style.width = percent + '%';
    progressText.textContent = completed + '/' + total + ' (' + percent + '%)';

    // Update streak if all tasks completed
    if (completed === total && total > 0) {
        updateStreak();
    }
}

function updateStreak() {
    var today = new Date().toDateString();
    if (CONFIG.last_completion_date === today) return; // Already counted today

    CONFIG.streak_count = (CONFIG.streak_count || 0) + 1;
    CONFIG.last_completion_date = today;
    saveConfig();

    // V14.4: Reset button state
    var saveBtn = document.getElementById('config-save-btn');
    if (saveBtn) {
        saveBtn.innerText = 'SAVE';
        saveBtn.style.color = '';
    }

    var streakEl = document.getElementById('streak-count');
    if (streakEl) {
        streakEl.textContent = CONFIG.streak_count;
        streakEl.classList.add('streak-pulse');
        setTimeout(function () { streakEl.classList.remove('streak-pulse'); }, 1000);
    }

    showNotification('STREAK: ' + CONFIG.streak_count + ' DAYS! KEEP GOING!');
}

function checkStreakReset() {
    var today = new Date();
    var yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (CONFIG.last_completion_date && CONFIG.last_completion_date !== today.toDateString()) {
        var lastDate = new Date(CONFIG.last_completion_date);
        if (lastDate < yesterday) {
            // Streak broken - reset
            CONFIG.streak_count = 0;
            saveConfig();
        }
    }

    var streakEl = document.getElementById('streak-count');
    if (streakEl) streakEl.textContent = CONFIG.streak_count || 0;
}

/* =========================================
   NOTES APP V2.0 (Proprietary Features)
   ========================================= */
/* =========================================
   PHASE 2: PAGE & BLOCK MANAGER
   Core CRUD logic for block-based pages
   ========================================= */
var PageManager = {
    // Create a new page
    createPage: function (title, type) {
        type = type || 'markdown'; // 'markdown' | 'canvas'
        var page = {
            id: 'page_' + Date.now(),
            title: title || 'UNTITLED_ENTRY',
            content: '',
            blocks: [],
            path: '/',
            links: [],
            created: Date.now(),
            modified: Date.now(),
            viewMode: 'edit'
        };

        // Initialize with one empty paragraph block
        this.addBlock(page, 'p', '');

        NOTES.unshift(page);
        saveData();
        return page;
    },

    // Add a block to a page object
    addBlock: function (page, blockType, content, afterBlockId) {
        HistoryManager.push(page.id); // V70: Snapshot tracking
        if (!page) return null;

        var newBlock = {
            id: 'blk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            type: blockType,
            content: content || '',
            order: (page.blocks ? page.blocks.length : 0),
            level: 0, // V68: Indentation level (0-5)
            align: 'left' // V68: Text alignment
        };

        // Type-specific defaults
        if (blockType === 'task') {
            newBlock.checked = false;
            newBlock.createdAt = Date.now();
        }
        if (blockType === 'kanban_ref') newBlock.boardId = null;
        if (blockType === 'code') newBlock.language = 'javascript';

        if (!page.blocks) page.blocks = [];

        // Insert position
        if (afterBlockId) {
            var idx = page.blocks.findIndex(function (b) { return b.id === afterBlockId; });
            if (idx !== -1) {
                page.blocks.splice(idx + 1, 0, newBlock);
                this.reorderBlocks(page);
            } else {
                page.blocks.push(newBlock);
            }
        } else {
            page.blocks.push(newBlock);
        }

        page.modified = Date.now();
        return newBlock;
    },

    // Update a specific block
    updateBlock: function (pageId, blockId, updates) {
        HistoryManager.push(pageId); // V70: Snapshot tracking
        var page = NOTES.find(function (n) { return n.id === pageId; });
        if (!page) return false;

        var block = page.blocks.find(function (b) { return b.id === blockId; });
        if (!block) return false;

        // V15.1: Tracking completion timestamp
        if (block.type === 'task' && updates.checked === true && !block.completedAt) {
            updates.completedAt = Date.now();
        } else if (block.type === 'task' && updates.checked === false) {
            updates.completedAt = null;
        }

        Object.assign(block, updates);
        
        // V68: Clamp level
        if (block.level !== undefined) {
            block.level = Math.max(0, Math.min(5, block.level));
        }

        page.modified = Date.now();
        return true;
    },

    // Delete a block
    deleteBlock: function (pageId, blockId) {
        HistoryManager.push(pageId); // V70: Snapshot tracking
        var page = NOTES.find(function (n) { return n.id === pageId; });
        if (!page) return false;

        page.blocks = page.blocks.filter(function (b) { return b.id !== blockId; });
        this.reorderBlocks(page);
        page.modified = Date.now();
        return true;
    },

    // Reorder blocks (fix order indices)
    reorderBlocks: function (page) {
        if (!page || !page.blocks) return;
        page.blocks.forEach(function (b, i) { b.order = i; });
    },

    // Sync content string from blocks (for search/legacy compat)
    syncContent: function (pageId) {
        var page = NOTES.find(function (n) { return n.id === pageId; });
        if (!page || !page.blocks) return;

        page.content = page.blocks.map(function (b) {
            var content = '';
            var prefix = '  '.repeat(b.level || 0);
            var suffix = (b.align && b.align !== 'left') ? ' %%align:' + b.align + '%%' : '';

            switch (b.type) {
                case 'h1': content = '# ' + (b.content || ''); break;
                case 'h2': content = '## ' + (b.content || ''); break;
                case 'h3': content = '### ' + (b.content || ''); break;
                case 'task': content = (b.checked ? '- [x] ' : '- [ ] ') + (b.content || ''); break;
                case 'code': content = '```' + (b.language || 'plain') + '\n' + (b.content || '') + '\n```'; break;
                case 'divider': content = '---'; break;
                case 'image': content = '![' + (b.caption || '') + '](' + (b.url || b.content || '') + ')'; break;
                case 'table':
                    if (b.tableData) {
                        var td = b.tableData;
                        var md = '| ' + td.headers.map(function(h) { return h || ' '; }).join(' | ') + ' |\n';
                        md += '| ' + td.headers.map(function() { return '---'; }).join(' | ') + ' |\n';
                        td.rows.forEach(function(row) {
                            var cells = row.map(function(cell) { return cell || ' '; });
                            md += '| ' + cells.join(' | ') + ' |\n';
                        });
                        content = md.trim();
                    }
                    break;
                case 'kanban_ref':
                    if (b.boardId) {
                        var board = BOARDS.find(function(bd) { return bd.id === b.boardId; });
                        if (board) {
                            var totalCards = board.columns.reduce(function(sum, col) { return sum + col.cards.length; }, 0);
                            content = '%%KANBAN:' + board.id + ':' + b.id + ':' + board.title + ':' + board.columns.length + ':' + totalCards + '%%';
                        }
                    }
                    break;
                case 'bullet': content = '- ' + (b.content || ''); break;
                case 'numbered': content = '1. ' + (b.content || ''); break;
                case 'quote': content = '> ' + (b.content || ''); break;
                default: 
                    content = (b.content || '');
                    break;
            }
            return prefix + content + suffix;
        }).join('\n');

        // Also update wiki links
        page.links = typeof extractWikiLinks === 'function' ? extractWikiLinks(page.content) : [];
        // REMOVED: Auto-title logic that overwrote user titles

        page.modified = Date.now();
        saveData();

        // Update word count whenever we sync
        if (typeof Notes !== 'undefined') Notes.updateWordCount();
    }
};

/* =========================================
   PHASE 3: BLOCK EDITOR ENGINE
   ContentEditable hybrid editor implementation
   ========================================= */
// V64: Global double CMD+A handler (not attached to container)
// This runs BEFORE any other keydown handlers
document.addEventListener('keydown', function(e) {
    // Only process if CMD+A or CTRL+A
    if (!((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A'))) {
        return;
    }

    // Check if we're in the notes editor using ModalManager (canonical check)
    var isNotesActive = typeof ModalManager !== 'undefined' && 
                        ModalManager.stack.includes('note-editor-modal');
    if (!isNotesActive) {
        return; // Not in notes editor, let default behavior
    }

    // Check if focus is in block editor
    var blockEditor = document.getElementById('block-editor');
    if (!blockEditor || !blockEditor.contains(document.activeElement)) {
        return; // Not focused in editor, let default behavior
    }

    var now = Date.now();
    var lastA = window.BlockEditorLastCmdATime || 0;
    var timeSinceLastA = now - lastA;
    
    // Check if this is a double-press (within 400ms)
    if (timeSinceLastA < 400 && timeSinceLastA > 0) {
        // Double press: Select ALL blocks and copy to clipboard
        e.preventDefault();
        e.stopPropagation();
        
        // Collect all text from all blocks
        var allText = [];
        var blocks = blockEditor.querySelectorAll('.block-wrapper');
        blocks.forEach(function(block) {
            var blockType = block.getAttribute('data-block-type');
            var content = block.querySelector('.block-content');
            if (!content) return;
            
            var text = '';
            if (blockType === 'task') {
                var checkbox = content.querySelector('.task-checkbox-inline');
                var taskText = content.querySelector('.task-text');
                var prefix = checkbox && checkbox.checked ? '- [x] ' : '- [ ] ';
                text = prefix + (taskText ? taskText.textContent : '');
            } else if (blockType === 'code') {
                var codeInner = content.querySelector('.code-inner');
                text = '```\n' + (codeInner ? codeInner.textContent : '') + '\n```';
            } else if (blockType === 'image') {
                var caption = content.querySelector('.image-caption');
                text = caption ? '[Image: ' + caption.textContent + ']' : '[Image]';
            } else if (blockType === 'h1') {
                text = '# ' + content.textContent;
            } else if (blockType === 'h2') {
                text = '## ' + content.textContent;
            } else if (blockType === 'h3') {
                text = '### ' + content.textContent;
            } else if (blockType === 'quote') {
                text = '> ' + content.textContent;
            } else if (blockType === 'bullet') {
                text = '- ' + content.textContent;
            } else if (blockType === 'divider') {
                text = '---';
            } else {
                text = content.textContent || '';
            }
            
            if (text) allText.push(text);
        });
        
        var fullText = allText.join('\n');
        
        // Copy to clipboard
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(fullText).then(function() {
                if (typeof showNotification === 'function') {
                    showNotification('All content copied to clipboard');
                }
            }).catch(function(err) {
                console.error('Failed to copy:', err);
            });
        } else {
            // Fallback for older browsers
            var textarea = document.createElement('textarea');
            textarea.value = fullText;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            if (typeof showNotification === 'function') {
                showNotification('All content copied to clipboard');
            }
        }
        
        // Also visually select all for feedback
        var sel = window.getSelection();
        if (sel) sel.removeAllRanges();
        var range = document.createRange();
        range.selectNodeContents(blockEditor);
        if (sel) sel.addRange(range);
        
        // Reset timer for next potential double-press
        window.BlockEditorLastCmdATime = 0;
    } else {
        // Single press: Track time for potential double-press
        window.BlockEditorLastCmdATime = now;
        
        // Let the browser's default select behavior run
    }
}, true); // CAPTURE phase = runs before bubbling handlers

// V65: Global ESC handler for clearing block selection (capture phase)
// This runs BEFORE the modal close handler
document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    
    // Check if BlockEditor exists and has selected blocks
    if (typeof BlockEditor === 'undefined' || !BlockEditor.selectedBlockIds || 
        BlockEditor.selectedBlockIds.length === 0) {
        return;
    }
    
    // Check if we're in the notes editor
    var isNotesActive = typeof ModalManager !== 'undefined' && 
                        ModalManager.stack.includes('note-editor-modal');
    if (!isNotesActive) return;
    
    // Clear selection and stop event from reaching modal handler
    e.preventDefault();
    e.stopImmediatePropagation();
    BlockEditor.clearSelection();
}, true); // CAPTURE phase
// V70: History Manager for Undo/Redo
    const HistoryManager = {
        stack: [],
        redoStack: [],
        limit: 50,
        
        // Call this BEFORE PageManager makes a change
        push: function(pageId) {
            var page = NOTES.find(function(n) { return n.id === pageId; });
            if (!page) return;
            
            // Deep copy the blocks array
            var snapshot = JSON.parse(JSON.stringify(page.blocks));
            this.stack.push({ pageId: pageId, blocks: snapshot });
            
            if (this.stack.length > this.limit) this.stack.shift();
            this.redoStack = []; // Clear redo on new action
        },

        undo: function() {
            if (this.stack.length === 0) return;
            
            var state = this.stack.pop();
            var page = NOTES.find(function(n) { return n.id === state.pageId; });
            
            if (page) {
                // Save current state to redo stack
                this.redoStack.push({ pageId: page.id, blocks: JSON.parse(JSON.stringify(page.blocks)) });
                
                // Restore previous state
                page.blocks = state.blocks;
                page.modified = Date.now();
                
                saveData();
                if (typeof BlockEditor !== 'undefined') BlockEditor.render(page.id);
            }
        },

        redo: function() {
            if (this.redoStack.length === 0) return;
            
            var state = this.redoStack.pop();
            var page = NOTES.find(function(n) { return n.id === state.pageId; });
            
            if (page) {
                this.stack.push({ pageId: page.id, blocks: JSON.parse(JSON.stringify(page.blocks)) });
                page.blocks = state.blocks;
                page.modified = Date.now();
                
                saveData();
                if (typeof BlockEditor !== 'undefined') BlockEditor.render(page.id);
            }
        }
    };
var BlockEditor = {
    container: null,
    activePageId: null,
    focusedBlockId: null,
    saveTimeout: null,
    
    // V65: Multi-select state
    selectedBlockIds: [],
    isSelecting: false,
    selectionStartY: 0,
    lastSelectedId: null,

    // V71: Shared Preview Renderer
    getCalcPreviewHtml: function(text) {
        var parts = (text || '').split('//');
        var expr = parts[0].trim();
        var result = parts.length > 1 ? parts[1].replace('=', '').trim() : '';
        
        var html = '<div class="calc-preview" style="margin:0; border:none; background:transparent; padding:0;">';
        html += '<span class="calc-expression">' + expr + '</span>';
        if (result) {
            html += '<span class="calc-arrow" style="margin:0 8px;">&rarr;</span>';
            html += '<span class="calc-result">' + result + '</span>';
        }
        return html + '</div>';
    },

    // V70: CSP-Safe Math Evaluator
    safeMathEval: function(expr) {
        // 1. Tokenize
        var tokens = [];
        var numberBuffer = '';
        
        // Normalize Operators (x -> *, : -> /, etc)
        expr = expr.split('//')[0].trim();
        expr = expr.replace(/x/gi, '*').replace(/×/g, '*');
        expr = expr.replace(/÷/g, '/').replace(/:/g, '/');
        
        // Remove whitespace
        expr = expr.replace(/\s+/g, '');
        
        for (var i = 0; i < expr.length; i++) {
            var char = expr[i];
            
            if (/\d|\./.test(char)) {
                numberBuffer += char;
            } else {
                if (numberBuffer.length > 0) {
                    tokens.push(parseFloat(numberBuffer));
                    numberBuffer = '';
                }
                if ('+-*/^%()'.indexOf(char) !== -1) {
                    // Handle unary minus (start of string or after operator/paren)
                    if (char === '-' && (tokens.length === 0 || typeof tokens[tokens.length - 1] === 'string' && tokens[tokens.length - 1] !== ')')) {
                        // Treat as negating the next number, simplest way is to push 0 then - (e.g. 0 - 5)
                        // Or tokenizing specific 'neg' operator. Let's try simple 0- approach for now.
                        // tokens.push(0); 
                        // tokens.push('-');
                        // Actually, simpler: buffer the negative sign if it's number start
                        numberBuffer += '-'; 
                    } else {
                        tokens.push(char);
                    }
                }
            }
        }
        if (numberBuffer.length > 0) {
            tokens.push(parseFloat(numberBuffer));
        }

        // 2. Shunting Yard (Infix to RPN)
        var outputQueue = [];
        var operatorStack = [];
        var precedence = { '^': 4, '*': 3, '/': 3, '%': 3, '+': 2, '-': 2 };
        var associativity = { '^': 'Right', '*': 'Left', '/': 'Left', '%': 'Left', '+': 'Left', '-': 'Left' };

        // Helper to check if token is number
        var isNum = function(t) { return typeof t === 'number' && !isNaN(t); };

        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];
            if (isNum(token)) {
                outputQueue.push(token);
            } else if ('+-*/^%'.indexOf(token) !== -1) {
                while (operatorStack.length > 0) {
                    var top = operatorStack[operatorStack.length - 1];
                    if (top === '(') break;
                    if ((associativity[token] === 'Left' && precedence[token] <= precedence[top]) ||
                        (associativity[token] === 'Right' && precedence[token] < precedence[top])) {
                        outputQueue.push(operatorStack.pop());
                    } else {
                        break;
                    }
                }
                operatorStack.push(token);
            } else if (token === '(') {
                operatorStack.push(token);
            } else if (token === ')') {
                while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
                    outputQueue.push(operatorStack.pop());
                }
                if (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] === '(') {
                    operatorStack.pop(); // Pop '('
                } else {
                    return 'Error: Mismatched parentheses';
                }
            }
        }
        while (operatorStack.length > 0) {
            var op = operatorStack.pop();
            if (op === '(') return 'Error: Mismatched parentheses';
            outputQueue.push(op);
        }

        // 3. Evaluate RPN
        var evalStack = [];
        for (var i = 0; i < outputQueue.length; i++) {
            var token = outputQueue[i];
            if (isNum(token)) {
                evalStack.push(token);
            } else {
                if (evalStack.length < 2) return 'Error: Invalid expression';
                var b = evalStack.pop();
                var a = evalStack.pop();
                var res = 0;
                switch(token) {
                    case '+': res = a + b; break;
                    case '-': res = a - b; break;
                    case '*': res = a * b; break;
                    case '/': res = a / b; break;
                    case '%': res = a % b; break;
                    case '^': res = Math.pow(a, b); break;
                }
                evalStack.push(res);
            }
        }

        if (evalStack.length === 1) {
            return evalStack[0];
        } else {
            return 'Error: Invalid expression';
        }
    },

    highlightSyntax: function(code, lang) {
        if (!code) return '';
        // Escape HTML first to prevent XSS
        var html = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        
        // Simple JS/Generic Highlighting
        if (lang === 'javascript' || lang === 'js' || lang === 'json' || lang === 'calc') {
            // Keywords
            html = html.replace(/\b(var|let|const|function|return|if|else|for|while|class|this|async|await)\b/g, '<span style="color:#ff79c6;">$1</span>');
            // Boolean/Null
            html = html.replace(/\b(true|false|null|undefined)\b/g, '<span style="color:#bd93f9;">$1</span>');
            // Numbers
            html = html.replace(/\b(\d+)\b/g, '<span style="color:#8be9fd;">$1</span>');
            // Strings (Simple quote matching)
            html = html.replace(/(['"`])(.*?)\1/g, '<span style="color:#f1fa8c;">$1$2$1</span>');
            // Comments
            html = html.replace(/(\/\/.*)/g, '<span style="color:#6272a4;">$1</span>');
        }
        return html;
    },

    init: function (containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.container.addEventListener('keydown', this.handleKeydown.bind(this));
        this.container.addEventListener('input', this.handleInput.bind(this));
        this.container.addEventListener('click', this.handleClick.bind(this));
        this.container.addEventListener('paste', this.handlePaste.bind(this));
        this.container.addEventListener('drop', this.handleDrop.bind(this));
        
        // V63.5: Container-level dragover to prevent copy cursor
        this.container.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        // V65: Mouse drag selection handlers
        var self = this;
        this.container.addEventListener('mousedown', function(e) {
            // Only start drag select on left click
            if (e.button !== 0) return;
            
            var blockEl = e.target.closest('.block-wrapper');
            
            // Handle Shift+Click for range select
            if (e.shiftKey && blockEl) {
                e.preventDefault();
                var blockId = blockEl.getAttribute('data-block-id');
                // If no previous selection, select just this block
                if (!self.lastSelectedId) {
                    self.selectBlock(blockId, false);
                } else {
                    self.selectRange(blockId);
                }
                return;
            }
            
            // Handle CMD/Ctrl+Click for additive select
            if ((e.metaKey || e.ctrlKey) && blockEl) {
                e.preventDefault();
                var blockId = blockEl.getAttribute('data-block-id');
                self.selectBlock(blockId, true); // additive = true
                return;
            }
            
            // Click on block without modifiers - set as single selection if clicking on wrapper area
            if (blockEl && !e.target.closest('.block-content, .task-text, .code-inner, .image-caption, input')) {
                // Clicking on block wrapper (e.g., drag handle area)
                var blockId = blockEl.getAttribute('data-block-id');
                
                // V65: If this block is already part of multi-selection, keep the selection (for multi-drag)
                if (self.selectedBlockIds.length > 1 && self.selectedBlockIds.includes(blockId)) {
                    // Keep existing multi-selection for dragging
                    return;
                }
                
                // Select just this block
                self.selectBlock(blockId, false);
                self.lastSelectedId = blockId;
                return;
            }
            
            // V65: Click inside content area - DON'T clear selection, just let normal editing happen
            // The selection visuals will remain, and CMD+C/X will work on selected blocks
            // Selection is only cleared explicitly via ESC or clicking in empty space
            
            // Clicked in empty space - start drag selection
            if (!blockEl) {
                self.clearSelection();
                self.isSelecting = true;
                
                // Store container-relative coordinates
                var containerRect = self.container.getBoundingClientRect();
                self.selectionStartX = e.clientX - containerRect.left;
                self.selectionStartY = e.clientY - containerRect.top + self.container.scrollTop;
                
                // Create selection box at the starting position
                var box = document.createElement('div');
                box.className = 'block-selection-box';
                box.id = 'block-selection-box';
                box.style.left = self.selectionStartX + 'px';
                box.style.top = self.selectionStartY + 'px';
                box.style.width = '0px';
                box.style.height = '0px';
                self.container.appendChild(box);
            }
        });

        document.addEventListener('mousemove', function(e) {
            if (!self.isSelecting || !self.container) return;
            
            var box = document.getElementById('block-selection-box');
            if (!box) return;
            
            var containerRect = self.container.getBoundingClientRect();
            var currentX = e.clientX - containerRect.left;
            var currentY = e.clientY - containerRect.top + self.container.scrollTop;
            
            var left = Math.min(self.selectionStartX, currentX);
            var top = Math.min(self.selectionStartY, currentY);
            var width = Math.abs(currentX - self.selectionStartX);
            var height = Math.abs(currentY - self.selectionStartY);
            
            box.style.left = left + 'px';
            box.style.top = top + 'px';
            box.style.width = width + 'px';
            box.style.height = height + 'px';
            
            // Find blocks that intersect with the selection box
            var selectionRect = {
                left: left,
                top: top,
                right: left + width,
                bottom: top + height
            };
            
            self.selectedBlockIds = [];
            var blocks = self.container.querySelectorAll('.block-wrapper');
            blocks.forEach(function(block) {
                var blockRect = block.getBoundingClientRect();
                var blockTop = blockRect.top - containerRect.top + self.container.scrollTop;
                var blockBottom = blockRect.bottom - containerRect.top + self.container.scrollTop;
                
                // Check vertical intersection
                if (blockBottom > selectionRect.top && blockTop < selectionRect.bottom) {
                    self.selectedBlockIds.push(block.getAttribute('data-block-id'));
                }
            });
            self.updateSelectionVisuals();
        });

        document.addEventListener('mouseup', function(e) {
            if (!self.isSelecting) return;
            self.isSelecting = false;
            
            var box = document.getElementById('block-selection-box');
            if (box) box.remove();
            
            // If we selected blocks, set the first one as lastSelectedId (anchor for Shift+Click)
            if (self.selectedBlockIds.length > 0) {
                self.lastSelectedId = self.selectedBlockIds[0];
                
                // V65: Prevent cursor from jumping - blur any focused element
                if (document.activeElement && self.container.contains(document.activeElement)) {
                    document.activeElement.blur();
                }
            }
        });
    },

    processImageFile: function (file) {
        var self = this;
        var reader = new FileReader();
        reader.onload = function (e) {
            var dataUrl = e.target.result;
            var note = NOTES.find(function(n) { return n.id === self.activePageId; });
            if (note) {
                // Add after focused block if possible
                var newBlock = PageManager.addBlock(note, 'image', dataUrl, self.focusedBlockId);
                self.render(self.activePageId);
                PageManager.syncContent(self.activePageId);
                saveData();
                
                if (newBlock) {
                    self.focusedBlockId = newBlock.id;
                    // Images don't focus text, but we keep tracked
                }
            }
        };
        reader.readAsDataURL(file);
    },

    handleDrop: function (e) {
        // V63.6: Handle Image Drop
        var files = e.dataTransfer.files;
        if (files && files.length > 0) {
            var hasImage = false;
            for (var i = 0; i < files.length; i++) {
                if (files[i].type.indexOf('image') !== -1) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.processImageFile(files[i]);
                    hasImage = true;
                }
            }
            if (hasImage) return;
        }
    },

    render: function (pageId, skipFocus) {
        this.activePageId = pageId;
        var page = NOTES.find(function (n) { return n.id === pageId; });
        if (!page) return;

        // V15.2: Optimization - only re-render if structure changed or initial load
        this.container.innerHTML = '';

        if (!page.blocks || page.blocks.length === 0) {
            PageManager.addBlock(page, 'p', '');
        }

        var self = this;
        page.blocks.forEach(function (block) {
            var el = self.renderBlock(block);
            self.container.appendChild(el);
        });

        // Focus restoration (Voltron Pattern)
        if (this.focusedBlockId && !skipFocus) {
            this.focusBlock(this.focusedBlockId);
        }
    },

    focusBlock: function (blockId) {
        this.focusedBlockId = blockId;
        var el = this.container.querySelector('[data-block-id="' + blockId + '"] .block-content');
        if (!el) {
            // Task fallback
            el = this.container.querySelector('[data-block-id="' + blockId + '"] .task-text');
        }
        if (!el) {
            // Code fallback
            el = this.container.querySelector('[data-block-id="' + blockId + '"] .code-inner');
        }
        
        if (el) {
            el.focus();
            // Move cursor to end
            var range = document.createRange();
            var sel = window.getSelection();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    },

    // V65: Multi-select methods
    selectBlock: function(blockId, additive) {
        if (additive) {
            // CMD+Click: Toggle this block in selection
            var idx = this.selectedBlockIds.indexOf(blockId);
            if (idx === -1) {
                this.selectedBlockIds.push(blockId);
            } else {
                this.selectedBlockIds.splice(idx, 1);
            }
        } else {
            // Normal click: Clear and select just this one
            this.selectedBlockIds = [blockId];
        }
        this.lastSelectedId = blockId;
        this.updateSelectionVisuals();
    },

    selectRange: function(toId) {
        // Select all blocks between lastSelectedId and toId
        if (!this.lastSelectedId) {
            this.selectBlock(toId, false);
            return;
        }
        
        var page = NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
        if (!page || !page.blocks) return;
        
        var fromIdx = page.blocks.findIndex(function(b) { return b.id === BlockEditor.lastSelectedId; });
        var toIdx = page.blocks.findIndex(function(b) { return b.id === toId; });
        
        if (fromIdx === -1 || toIdx === -1) return;
        
        var start = Math.min(fromIdx, toIdx);
        var end = Math.max(fromIdx, toIdx);
        
        this.selectedBlockIds = [];
        for (var i = start; i <= end; i++) {
            this.selectedBlockIds.push(page.blocks[i].id);
        }
        this.updateSelectionVisuals();
    },

    clearSelection: function() {
        this.selectedBlockIds = [];
        this.lastSelectedId = null; // V65: Reset anchor so next click starts fresh
        this.updateSelectionVisuals();
    },

    updateSelectionVisuals: function() {
        // Remove all existing selection styling
        var allBlocks = this.container.querySelectorAll('.block-wrapper');
        allBlocks.forEach(function(block) {
            block.classList.remove('block-selected');
        });
        
        // Add selection styling to selected blocks
        var self = this;
        this.selectedBlockIds.forEach(function(id) {
            var block = self.container.querySelector('[data-block-id="' + id + '"]');
            if (block) block.classList.add('block-selected');
        });
    },

    getSelectedBlocks: function() {
        var page = NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
        if (!page || !page.blocks) return [];
        
        var selected = [];
        var self = this;
        this.selectedBlockIds.forEach(function(id) {
            var block = page.blocks.find(function(b) { return b.id === id; });
            if (block) selected.push(block);
        });
        return selected;
    },

    reorderBlock: function(draggedId, targetId) {
        var note = NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
        if (!note || !note.blocks) return;

        // V65: If dragging a selected block, move all selected blocks
        if (this.selectedBlockIds.length > 1 && this.selectedBlockIds.includes(draggedId)) {
            this.reorderSelectedBlocks(targetId);
            return;
        }

        var draggedIdx = note.blocks.findIndex(function(b) { return b.id === draggedId; });
        var targetIdx = note.blocks.findIndex(function(b) { return b.id === targetId; });

        if (draggedIdx === -1 || targetIdx === -1 || draggedIdx === targetIdx) return;

        // Remove dragged block
        var draggedBlock = note.blocks.splice(draggedIdx, 1)[0];

        // Recalculate target index after removal
        var newTargetIdx = note.blocks.findIndex(function(b) { return b.id === targetId; });
        
        // Insert before target
        note.blocks.splice(newTargetIdx, 0, draggedBlock);

        // Save and re-render
        saveData();
        this.render(this.activePageId, true); // Skip focus
    },

    // V65: Move all selected blocks to a new position
    reorderSelectedBlocks: function(targetId) {
        var note = NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
        if (!note || !note.blocks) return;

        var targetIdx = note.blocks.findIndex(function(b) { return b.id === targetId; });
        if (targetIdx === -1) return;

        // Get selected blocks in their current order
        var selectedBlocks = [];
        var remainingBlocks = [];
        
        note.blocks.forEach(function(block) {
            if (BlockEditor.selectedBlockIds.includes(block.id)) {
                selectedBlocks.push(block);
            } else {
                remainingBlocks.push(block);
            }
        });

        // Find new target position in remaining blocks
        var newTargetIdx = remainingBlocks.findIndex(function(b) { return b.id === targetId; });
        if (newTargetIdx === -1) {
            // Target was one of the selected blocks, insert at the end
            newTargetIdx = remainingBlocks.length;
        }

        // Insert selected blocks at the target position
        remainingBlocks.splice.apply(remainingBlocks, [newTargetIdx, 0].concat(selectedBlocks));
        note.blocks = remainingBlocks;

        // Save and re-render
        saveData();
        this.render(this.activePageId, true);
        
        // Restore selection visuals
        this.updateSelectionVisuals();
    },

    renderBlock: function (block) {
        var wrapper = document.createElement('div');
        wrapper.className = 'block-wrapper';
        wrapper.setAttribute('data-block-id', block.id);
        wrapper.setAttribute('data-block-type', block.type);
        wrapper.setAttribute('draggable', 'true');

        // V63.4: Drag handle (Design synced with index.html CSS)
        var dragHandle = document.createElement('span');
        dragHandle.className = 'block-drag-handle';
        dragHandle.setAttribute('title', 'Drag to reorder');
        // Apply level and alignment (V68)
        if (block.level) {
            wrapper.style.paddingLeft = (block.level * 24) + 'px';
        }
        if (block.align) {
            wrapper.style.textAlign = block.align;
            wrapper.setAttribute('data-align', block.align);
        } else {
            wrapper.setAttribute('data-align', 'left');
        }
        
        wrapper.appendChild(dragHandle);

        var content;
        var self = this;

        // V63.4: Drag-and-drop event handlers
        wrapper.addEventListener('dragstart', function(e) {
            e.dataTransfer.setData('text/plain', block.id);
            e.dataTransfer.effectAllowed = 'move';
            wrapper.classList.add('dragging');
            BlockEditor.draggedBlockId = block.id;
        });

        wrapper.addEventListener('dragend', function(e) {
            wrapper.classList.remove('dragging');
            BlockEditor.draggedBlockId = null;
            // Clear all drag-over states
            document.querySelectorAll('.block-wrapper.drag-over').forEach(function(el) {
                el.classList.remove('drag-over');
            });
        });

        wrapper.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (BlockEditor.draggedBlockId && BlockEditor.draggedBlockId !== block.id) {
                wrapper.classList.add('drag-over');
            }
        });

        wrapper.addEventListener('dragleave', function(e) {
            wrapper.classList.remove('drag-over');
        });

        wrapper.addEventListener('drop', function(e) {
            e.preventDefault();
            wrapper.classList.remove('drag-over');
            var draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId && draggedId !== block.id) {
                BlockEditor.reorderBlock(draggedId, block.id);
            }
        });

        switch (block.type) {
            case 'h1':
            case 'h2':
            case 'h3':
                content = document.createElement(block.type);
                content.contentEditable = 'true';
                content.textContent = block.content || '';
                content.className = 'block-content block-' + block.type;
                break;

            case 'task':
                content = document.createElement('div');
                content.className = 'block-content block-task';

                var checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = 'task-check-' + block.id; // V65: Fix A11y & Lint
                checkbox.name = 'task-check-' + block.id;
                checkbox.checked = block.checked;
                checkbox.className = 'task-checkbox-inline';
                    checkbox.addEventListener('change', function () {
                        var pageId = BlockEditor.activePageId;
                        var blockId = block.id;
                        
                        // Save current text content BEFORE toggling to prevent data loss or sync issues
                        var textEl = wrapper.querySelector('.task-text');
                        var updates = { checked: checkbox.checked };
                        if (textEl) updates.content = textEl.textContent;
                        
                        PageManager.updateBlock(pageId, blockId, updates);
                        PageManager.syncContent(pageId);
                        wrapper.classList.toggle('completed', checkbox.checked);
                        saveData();
                    });

                    var taskText = document.createElement('div');
                    taskText.className = 'task-text';
                    taskText.contentEditable = 'true';
                    taskText.textContent = block.content || '';
                    if (block.checked) wrapper.classList.add('completed');

                    content.appendChild(checkbox);
                    content.appendChild(taskText);
                break;

            case 'code':
                content = document.createElement('div');
                content.classList.add('block-code');
                content.contentEditable = false;
                var inner = document.createElement('div');
                inner.className = 'code-inner';
                inner.contentEditable = true;
                
                // V70: Syntax Highlighting Logic
                var rawCode = block.content || '';
                var lang = block.language || 'javascript';
                
                // V71: Auto-Clean Corrupted HTML Content (Migration Fix)
                if (block.type === 'code' && !rawCode.startsWith('```')) {
                    var cleaned = rawCode;
                    
                    // 1. Strip CSS/HTML artifact strings that might be present as plain text
                    // Matches patterns like: "color:#8be9fd;">  or  style="color:..."
                    if (/color:#[0-9a-fA-F]{3,8}/.test(cleaned) || /style="/.test(cleaned)) {
                        cleaned = cleaned.replace(/"?color:#[0-9a-fA-F]{3,8};?"?>?/gi, '');
                        cleaned = cleaned.replace(/style="[^"]*"/gi, '');
                        cleaned = cleaned.replace(/class="[^"]*"/gi, '');
                        cleaned = cleaned.replace(/&lt;[^&]*&gt;/g, ''); // Strip escaped tags
                    }

                    // 2. Strip residual HTML tags using DOM
                    if (/<[^>]*>/.test(cleaned)) {
                        var tempDiv = document.createElement('div');
                        tempDiv.innerHTML = cleaned;
                        cleaned = tempDiv.textContent || tempDiv.innerText || '';
                    }

                    if (cleaned !== rawCode && cleaned.trim().length > 0) {
                        console.log('Migrating corrupted block content:', block.id, rawCode, '->', cleaned);
                        rawCode = cleaned;
                        block.content = rawCode;
                        PageManager.updateBlock(BlockEditor.activePageId, block.id, { content: rawCode });
                    }
                }
                
                // V71: Custom Calculator Block Rendering (Editor Mode)
                if (lang === 'calc') {
                    // Optimized: Use shared renderer
                    inner.innerHTML = BlockEditor.getCalcPreviewHtml(rawCode);
                    inner.setAttribute('data-highlighted', 'true'); // Treat as processed
                    inner.setAttribute('contenteditable', 'true'); // Ensure it can receive focus
                    
                    // On Focus: Show raw text for editing
                    inner.addEventListener('focus', function() {
                        if (this.getAttribute('data-highlighted') === 'true') {
                            // V71 FIX: Fetch fresh block data to avoid closure staleness
                            var safePage = NOTES.find(p => p.id === BlockEditor.activePageId);
                            var safeBlock = safePage ? safePage.blocks.find(b => b.id === block.id) : block;
                            var showContent = safeBlock ? safeBlock.content : block.content;
                        
                            this.textContent = showContent || ''; 
                            this.removeAttribute('data-highlighted');
                        }
                    });

                    // On Blur: Show preview
                    inner.addEventListener('blur', function() {
                        // V71: Ensure we capture the *text* content, not HTML innerHTML
                        var newContent = this.textContent;
                        
                         if (newContent !== block.content) {
                            block.content = newContent;
                            // Only save if meaningful change - handled by handleInput usually
                        }
                        
                        this.innerHTML = BlockEditor.getCalcPreviewHtml(newContent);
                        this.setAttribute('data-highlighted', 'true');
                    });
                } else {
                    // Standard Code Block Rendering (Syntax Highlighting)
                    inner.innerHTML = BlockEditor.highlightSyntax(rawCode, lang);
                    inner.setAttribute('data-highlighted', 'true');
                    
                    // On Focus: Revert to raw text for editing
                    inner.addEventListener('focus', function() {
                        if (this.getAttribute('data-highlighted') === 'true') {
                            this.textContent = rawCode; // Revert to raw text (textContent is safer)
                            this.removeAttribute('data-highlighted');
                        }
                    });

                    // On Blur: Apply highlighting (Visual only)
                    inner.addEventListener('blur', function() {
                        rawCode = this.textContent; // Update raw code from current text
                        this.innerHTML = BlockEditor.highlightSyntax(rawCode, lang);
                        this.setAttribute('data-highlighted', 'true');
                        // No need to save here, handleInput does it.
                    });
                }
                
                var langLabel = document.createElement('span');
                langLabel.className = 'code-lang-label';
                langLabel.textContent = lang;

                content.appendChild(langLabel);
                content.appendChild(inner);
                break;

            case 'bullet':
            case 'numbered':
                content = document.createElement('div');
                content.classList.add('block-content', 'block-' + block.type);
                content.contentEditable = 'true';
                content.textContent = block.content || '';
                break;

            case 'quote':
                content = document.createElement('div');
                content.classList.add('block-content', 'block-quote');
                content.contentEditable = 'true';
                content.textContent = block.content || '';
                break;

            case 'image':
                content = document.createElement('div');
                content.classList.add('block-image');
                content.contentEditable = false;
                
                var innerWrapper = document.createElement('div');
                innerWrapper.className = 'image-inner-wrapper';
                
                var img = document.createElement('img');
                img.src = block.url || block.content;
                img.style.maxWidth = '100%';
                img.style.maxHeight = '500px';
                img.style.borderRadius = '4px';
                img.style.border = '1px solid #333';
                img.style.display = 'block';
                img.style.margin = '0 auto';
                
                innerWrapper.appendChild(img);
                
                var imgDeleteBtn = document.createElement('button');
                imgDeleteBtn.className = 'image-delete-btn';
                imgDeleteBtn.textContent = 'X';
                imgDeleteBtn.title = 'Delete Image';
                imgDeleteBtn.onclick = function() {
                    PageManager.deleteBlock(self.activePageId, block.id);
                    self.render(self.activePageId);
                };
                
                var caption = document.createElement('div');
                caption.className = 'image-caption';
                caption.contentEditable = 'true';
                caption.textContent = block.caption || '';
                
                content.appendChild(innerWrapper);
                content.appendChild(caption);
                content.appendChild(imgDeleteBtn);
                
                // V63.6: Strip newlines to keep caption single-line
                caption.addEventListener('input', function() {
                   var cleanText = this.textContent.replace(/[\r\n]+/g, ' ').trim();
                   PageManager.updateBlock(BlockEditor.activePageId, block.id, { caption: cleanText });
                });
                break;

            case 'kanban_ref':
                content = document.createElement('div');
                content.classList.add('kanban-hud-wrapper'); 
                content.contentEditable = false;
                var board = BOARDS.find(function(b) { return b.id === block.boardId; });
                
                if (board) {
                    // --- 1. TELEMETRY (Robust Math) ---
                    var totalCards = 0;
                    board.columns.forEach(c => totalCards += c.cards.length);
                    var doneCol = board.columns[board.columns.length - 1];
                    var doneCount = doneCol ? doneCol.cards.length : 0;
                    var percent = totalCards === 0 ? 0 : Math.round((doneCount / totalCards) * 100);

                    // --- 2. ACTIVE STREAM (Smart List) ---
                    // Get items from the first non-empty column (Backlog or Active)
                    var activeCol = board.columns.find(c => c.cards.length > 0 && c !== doneCol) || board.columns[0];
                    var activeCards = activeCol ? activeCol.cards.slice(0, 3) : [];

                    var listHtml = activeCards.map(card => {
                        // Smart Tag Parsing for Display (Robust encoding check)
                        var displayContent = (card.content || '').replace(/#(\w+)/g, '<span class="hud-tag">#$1</span>');
                        return `<li class="hud-item" data-card-id="${card.id}">
                            <span class="hud-item-text">${displayContent}</span>
                            <span class="hud-advance-btn" title="Advance">>></span>
                        </li>`;
                    }).join('');

                    content.innerHTML = `
                        <div class="hud-header-compact" title="Click to Open Board">
                            <div class="hud-title-row">
                                <span class="hud-icon">[=]</span>
                                <span class="hud-name">${board.title.toUpperCase()}</span>
                                <span class="hud-percent">${percent}%</span>
                                <button class="hud-delete-btn" title="Remove Block" style="opacity:0.3; cursor:pointer; margin-left:auto; background:none; color:white;">[x]</button>
                            </div>
                            <div class="hud-progress-track">
                                <div class="hud-progress-fill" style="width: ${percent}%"></div>
                            </div>
                        </div>
                        <ul class="hud-list" style="list-style:none; padding:0; margin:0;">${listHtml}</ul>
                        <div class="hud-injector-row">
                            <input type="text" class="hud-injector-input" placeholder="+ Add task (#tag supported)...">
                        </div>
                    `;

                    // --- 3. EVENT HANDLERS (The "Notion" Logic) ---
                    
                    // A. Open Board (Header Click)
                    var hudHeader = content.querySelector('.hud-header-compact');
                    hudHeader.onclick = function(e) { 
                        if (e.target.classList.contains('hud-delete-btn')) {
                            e.stopPropagation();
                            PageManager.deleteBlock(self.activePageId, block.id);
                            self.render(self.activePageId);
                        } else {
                            KanbanManager.open(block.boardId); 
                        }
                    };

                    // B. Deep Link & Advance (Delegate or Loop)
                    content.querySelectorAll('.hud-item').forEach(item => {
                        item.addEventListener('dblclick', function(e) {
                            e.stopPropagation();
                            var textEl = this.querySelector('.hud-item-text');
                            if (textEl) (Notes.openByTitle(textEl.innerText) || Notes.create(textEl.innerText)); 
                        });
                        
                        // Advance Logic
                        var advBtn = item.querySelector('.hud-advance-btn');
                        if (advBtn) {
                            advBtn.onclick = function(e) {
                                e.stopPropagation();
                                if (KanbanManager.advanceCard(item.dataset.cardId, board.id)) self.render(self.activePageId);
                            };
                        }
                    });

                    // C. Injector (Smart Enter)
                    var hudInput = content.querySelector('.hud-injector-input');
                    if (hudInput) {
                        hudInput.addEventListener('keydown', function(e) {
                            e.stopPropagation(); // STOP EDITOR NEW BLOCK
                            if (e.key === 'Enter' && this.value.trim()) {
                                if (board.columns.length > 0) {
                                    board.columns[0].cards.push({ id: 'card_'+Date.now(), content: this.value.trim(), created: Date.now() });
                                    board.modified = Date.now();
                                    saveData();
                                    self.render(self.activePageId);
                                }
                            }
                        });
                        hudInput.addEventListener('click', function(e) { e.stopPropagation(); });
                    }
                } else {
                    var setup = document.createElement('div');
                    setup.style.padding = '10px';
                    setup.style.textAlign = 'center';
                    setup.style.display = 'flex';
                    setup.style.gap = '10px';
                    setup.style.justifyContent = 'center';
                    setup.style.alignItems = 'center';
                    
                    var icon = document.createElement('span');
                    icon.textContent = '[=]';
                    icon.style.color = 'var(--main-color)';
                    
                    var createBtn = document.createElement('button');
                    createBtn.textContent = 'NEW BOARD';
                    createBtn.className = 'kanban-setup-btn'; // Reusing class or inline
                    createBtn.style.background = 'rgba(255,255,255,0.1)';
                    createBtn.style.border = '1px solid #444';
                    createBtn.style.color = '#ccc';
                    createBtn.style.padding = '4px 8px';
                    createBtn.style.cursor = 'pointer';
                    
                    createBtn.onclick = function(e) {
                        e.stopPropagation();
                        var newTitle = prompt("Enter Board Name:", "Project Alpha");
                        if (newTitle) {
                             var b = KanbanManager.createBoard(newTitle);
                             PageManager.updateBlock(self.activePageId, block.id, { boardId: b.id });
                             self.render(self.activePageId);
                        }
                    };
                    
                    var linkBtn = document.createElement('button');
                    linkBtn.textContent = 'LINK EXISTING';
                    linkBtn.style.background = 'rgba(255,255,255,0.1)';
                    linkBtn.style.border = '1px solid #444';
                    linkBtn.style.color = '#ccc';
                    linkBtn.style.padding = '4px 8px';
                    linkBtn.style.cursor = 'pointer';
                    
                    linkBtn.onclick = function(e) {
                        e.stopPropagation();
                        // Simple toggle to dropdown
                        this.style.display = 'none';
                        var select = document.createElement('select');
                        select.className = 'config-input';
                        
                        var def = document.createElement('option');
                        def.text = 'Select Board...';
                        select.add(def);
                        
                        BOARDS.forEach(b => {
                            var opt = document.createElement('option');
                            opt.value = b.id;
                            opt.text = b.title;
                            select.add(opt);
                        });
                        
                        select.onchange = function() {
                            if (select.value) {
                                PageManager.updateBlock(self.activePageId, block.id, { boardId: select.value });
                                self.render(self.activePageId);
                            }
                        };
                        setup.insertBefore(select, delBtn);
                    };

                    var delBtn = document.createElement('button');
                    delBtn.textContent = '[x]';
                    delBtn.title = 'Delete Block';
                    delBtn.style.background = 'transparent';
                    delBtn.style.border = 'none';
                    delBtn.style.color = '#666';
                    delBtn.style.cursor = 'pointer';
                    delBtn.onclick = function(e) {
                        e.stopPropagation();
                        PageManager.deleteBlock(self.activePageId, block.id);
                        self.render(self.activePageId);
                    };
                    
                    setup.appendChild(icon);
                    setup.appendChild(createBtn);
                    setup.appendChild(linkBtn);
                    setup.appendChild(delBtn);
                    content.appendChild(setup);
                }
                break;

            case 'table':
                content = document.createElement('div');
                content.classList.add('block-table');
                content.contentEditable = false; // Table block itself is not contentEditable
                
                // Initialize tableData if missing
                if (!block.tableData) {
                    block.tableData = {
                        headers: ['Header 1', 'Header 2', 'Header 3'],
                        rows: [['', '', ''], ['', '', '']],
                        columnAligns: ['left', 'left', 'left'],
                        hasHeaderRow: true
                    };
                }
                
                var tableData = block.tableData;
                var tableWrapper = document.createElement('div');
                tableWrapper.className = 'table-wrapper';
                
                // Create toolbar
                var toolbar = document.createElement('div');
                toolbar.className = 'table-toolbar';
                toolbar.innerHTML = 
                    '<button class="table-toolbar-btn" data-action="align-left" title="Align Left">[=</button>' +
                    '<button class="table-toolbar-btn" data-action="align-center" title="Align Center">=</button>' +
                    '<button class="table-toolbar-btn" data-action="align-right" title="Align Right">=]</button>' +
                    '<div class="table-toolbar-divider"></div>' +
                    '<button class="table-toolbar-btn" data-action="insert-row-above" title="Insert Row Above">+ Row Up</button>' +
                    '<button class="table-toolbar-btn" data-action="insert-row-below" title="Insert Row Below">+ Row Dn</button>' +
                    '<button class="table-toolbar-btn" data-action="insert-col-left" title="Insert Column Left">+ Col L</button>' +
                    '<button class="table-toolbar-btn" data-action="insert-col-right" title="Insert Column Right">+ Col R</button>' +
                    '<div class="table-toolbar-divider"></div>' +
                    '<button class="table-toolbar-btn" data-action="delete-row" title="Delete Row">- Row</button>' +
                    '<button class="table-toolbar-btn" data-action="delete-col" title="Delete Column">- Col</button>' +
                    '<div class="table-toolbar-divider"></div>' +
                    '<button class="table-toolbar-btn" data-action="sort-asc" title="Sort A-Z">A-Z</button>' +
                    '<button class="table-toolbar-btn" data-action="sort-desc" title="Sort Z-A">Z-A</button>' +
                    '<div class="table-toolbar-divider"></div>' +
                    '<button class="table-toolbar-btn" data-action="delete-table" title="Delete Table" style="color:#f44;">X</button>';
                
                // Create table element
                var table = document.createElement('table');
                table.className = 'table-grid';
                
                // Track focused cell for toolbar actions
                var focusedCell = { row: -1, col: -1 };
                
                // Render header row
                if (tableData.hasHeaderRow) {
                    var thead = document.createElement('thead');
                    var headerRow = document.createElement('tr');
                    
                    tableData.headers.forEach(function(headerText, colIdx) {
                        var th = document.createElement('th');
                        th.style.textAlign = tableData.columnAligns[colIdx] || 'left';
                        
                        var cell = document.createElement('div');
                        cell.className = 'table-cell table-header-cell';
                        cell.contentEditable = 'true';
                        cell.textContent = headerText;
                        cell.setAttribute('data-row', '-1');
                        cell.setAttribute('data-col', colIdx);
                        
                        cell.addEventListener('focus', function() {
                            focusedCell.row = -1;
                            focusedCell.col = colIdx;
                            toolbar.classList.add('visible');
                        });
                        
                        cell.addEventListener('blur', function() {
                            tableData.headers[colIdx] = this.textContent;
                            PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                            setTimeout(function() {
                                if (!content.contains(document.activeElement)) {
                                    toolbar.classList.remove('visible');
                                }
                            }, 100);
                        });
                        
                        cell.addEventListener('keydown', function(e) {
                            if (e.key === 'Tab') {
                                e.preventDefault();
                                var nextCol = e.shiftKey ? colIdx - 1 : colIdx + 1;
                                if (nextCol >= 0 && nextCol < tableData.headers.length) {
                                    var nextCell = table.querySelector('[data-row="-1"][data-col="' + nextCol + '"]');
                                    if (nextCell) nextCell.focus();
                                } else if (!e.shiftKey && tableData.rows.length > 0) {
                                    var firstDataCell = table.querySelector('[data-row="0"][data-col="0"]');
                                    if (firstDataCell) firstDataCell.focus();
                                }
                            }
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                var belowCell = table.querySelector('[data-row="0"][data-col="' + colIdx + '"]');
                                if (belowCell) belowCell.focus();
                            }
                        });
                        
                        th.appendChild(cell);
                        headerRow.appendChild(th);
                    });
                    
                    thead.appendChild(headerRow);
                    table.appendChild(thead);
                }
                
                // Render data rows
                var tbody = document.createElement('tbody');
                tableData.rows.forEach(function(rowData, rowIdx) {
                    var tr = document.createElement('tr');
                    tr.style.position = 'relative';
                    
                    rowData.forEach(function(cellText, colIdx) {
                        var td = document.createElement('td');
                        td.style.textAlign = tableData.columnAligns[colIdx] || 'left';
                        
                        var cell = document.createElement('div');
                        cell.className = 'table-cell';
                        cell.contentEditable = 'true';
                        cell.textContent = cellText;
                        cell.setAttribute('data-row', rowIdx);
                        cell.setAttribute('data-col', colIdx);
                        
                        cell.addEventListener('focus', function() {
                            focusedCell.row = rowIdx;
                            focusedCell.col = colIdx;
                            toolbar.classList.add('visible');
                        });
                        
                        cell.addEventListener('blur', function() {
                            tableData.rows[rowIdx][colIdx] = this.textContent;
                            PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                            setTimeout(function() {
                                if (!content.contains(document.activeElement)) {
                                    toolbar.classList.remove('visible');
                                }
                            }, 100);
                        });
                        
                        cell.addEventListener('keydown', function(e) {
                            if (e.key === 'Tab') {
                                e.preventDefault();
                                var nextCol = e.shiftKey ? colIdx - 1 : colIdx + 1;
                                var nextRow = rowIdx;
                                if (nextCol >= rowData.length) {
                                    nextCol = 0;
                                    nextRow = rowIdx + 1;
                                } else if (nextCol < 0) {
                                    nextCol = rowData.length - 1;
                                    nextRow = rowIdx - 1;
                                }
                                if (nextRow >= 0 && nextRow < tableData.rows.length) {
                                    var nextCell = table.querySelector('[data-row="' + nextRow + '"][data-col="' + nextCol + '"]');
                                    if (nextCell) nextCell.focus();
                                } else if (nextRow < 0 && tableData.hasHeaderRow) {
                                    var headerCell = table.querySelector('[data-row="-1"][data-col="' + nextCol + '"]');
                                    if (headerCell) headerCell.focus();
                                }
                            }
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                var belowRow = rowIdx + 1;
                                if (belowRow < tableData.rows.length) {
                                    var belowCell = table.querySelector('[data-row="' + belowRow + '"][data-col="' + colIdx + '"]');
                                    if (belowCell) belowCell.focus();
                                }
                            }
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                var belowCell = table.querySelector('[data-row="' + (rowIdx + 1) + '"][data-col="' + colIdx + '"]');
                                if (belowCell) belowCell.focus();
                            }
                            if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                var aboveRow = rowIdx - 1;
                                var aboveCell = aboveRow >= 0 
                                    ? table.querySelector('[data-row="' + aboveRow + '"][data-col="' + colIdx + '"]')
                                    : table.querySelector('[data-row="-1"][data-col="' + colIdx + '"]');
                                if (aboveCell) aboveCell.focus();
                            }
                        });
                        
                        td.appendChild(cell);
                        tr.appendChild(td);
                    });
                    
                    tbody.appendChild(tr);
                });
                table.appendChild(tbody);
                
                // Add Row button
                var addRowBtn = document.createElement('button');
                addRowBtn.className = 'table-add-row-btn';
                addRowBtn.textContent = '+ Add Row';
                addRowBtn.onclick = function() {
                    var newRow = tableData.headers.map(function() { return ''; });
                    tableData.rows.push(newRow);
                    PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                    self.render(self.activePageId);
                };
                
                // Add Column button
                var addColBtn = document.createElement('button');
                addColBtn.className = 'table-add-col-btn';
                addColBtn.textContent = '+';
                addColBtn.onclick = function() {
                    tableData.headers.push('New Column');
                    tableData.columnAligns.push('left');
                    tableData.rows.forEach(function(row) { row.push(''); });
                    PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                    self.render(self.activePageId);
                };
                
                // Toolbar actions
                toolbar.addEventListener('click', function(e) {
                    var action = e.target.getAttribute('data-action');
                    if (!action) return;
                    
                    var col = focusedCell.col;
                    var row = focusedCell.row;
                    
                    switch(action) {
                        case 'align-left':
                        case 'align-center':
                        case 'align-right':
                            if (col >= 0) {
                                tableData.columnAligns[col] = action.replace('align-', '');
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'insert-row-above':
                            if (row >= 0) {
                                var newRow = tableData.headers.map(function() { return ''; });
                                tableData.rows.splice(row, 0, newRow);
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'insert-row-below':
                            var insertAt = row >= 0 ? row + 1 : 0;
                            var newRow = tableData.headers.map(function() { return ''; });
                            tableData.rows.splice(insertAt, 0, newRow);
                            PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                            self.render(self.activePageId);
                            break;
                        case 'insert-col-left':
                            if (col >= 0) {
                                tableData.headers.splice(col, 0, 'New');
                                tableData.columnAligns.splice(col, 0, 'left');
                                tableData.rows.forEach(function(r) { r.splice(col, 0, ''); });
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'insert-col-right':
                            if (col >= 0) {
                                tableData.headers.splice(col + 1, 0, 'New');
                                tableData.columnAligns.splice(col + 1, 0, 'left');
                                tableData.rows.forEach(function(r) { r.splice(col + 1, 0, ''); });
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'delete-row':
                            if (row >= 0 && tableData.rows.length > 1) {
                                tableData.rows.splice(row, 1);
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'delete-col':
                            if (col >= 0 && tableData.headers.length > 1) {
                                tableData.headers.splice(col, 1);
                                tableData.columnAligns.splice(col, 1);
                                tableData.rows.forEach(function(r) { r.splice(col, 1); });
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'sort-asc':
                            if (col >= 0) {
                                tableData.rows.sort(function(a, b) {
                                    return (a[col] || '').localeCompare(b[col] || '');
                                });
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'sort-desc':
                            if (col >= 0) {
                                tableData.rows.sort(function(a, b) {
                                    return (b[col] || '').localeCompare(a[col] || '');
                                });
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'delete-table':
                            PageManager.deleteBlock(self.activePageId, block.id);
                            self.render(self.activePageId);
                            break;
                    }
                });
                
                tableWrapper.appendChild(table);
                content.appendChild(toolbar);
                content.appendChild(tableWrapper);
                content.appendChild(addRowBtn);
                content.appendChild(addColBtn);
                break;

            case 'divider':
                content = document.createElement('div');
                content.classList.add('block-divider-wrapper');
                content.contentEditable = false; // Divider block itself is not contentEditable
                
                var hr = document.createElement('hr');
                hr.className = 'block-divider';
                
                // V43: Add delete button for dividers
                var deleteBtn = document.createElement('button');
                deleteBtn.className = 'divider-delete-btn';
                deleteBtn.textContent = 'X';
                deleteBtn.title = 'Delete Divider';
                deleteBtn.onclick = function() {
                    PageManager.deleteBlock(self.activePageId, block.id);
                    self.render(self.activePageId);
                };
                
                content.appendChild(hr);
                content.appendChild(deleteBtn);
                break;

            default: // p
                content = document.createElement('div');
                content.contentEditable = 'true';
                content.textContent = block.content || '';
                content.classList.add('block-content', 'block-p');
        }

        wrapper.appendChild(dragHandle);
        wrapper.appendChild(content);
        return wrapper;
    },

    handleKeydown: function (e) {


        // CMD+A is handled in capture phase listener in init()
        
        // V65: ESC clears selection (must stop before modal manager catches it)
        if (e.key === 'Escape' && this.selectedBlockIds.length > 0) {
            e.preventDefault();
            e.stopImmediatePropagation(); // Prevent modal close handler
            this.clearSelection();
            return;
        }

        // V70: CALCULATOR EXECUTE (CMD+ENTER or CTRL+ENTER)
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            var blockWrapper = e.target.closest('.block-wrapper');
            if (blockWrapper && blockWrapper.getAttribute('data-block-type') === 'code') {
                var blockId = blockWrapper.getAttribute('data-block-id');
                var page = NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
                var block = page.blocks.find(function(b) { return b.id === blockId; });
                
                if (block && block.language === 'calc') {
                    // Stop new line
                    e.preventDefault();
                    e.stopPropagation(); // Stop global execution

                    // Get content
                    var currentText = e.target.textContent || block.content;
                    var expression = currentText.split('//')[0].trim();
                     
                    try {
                        // V70: CSP-safe evaluation
                        var result = BlockEditor.safeMathEval(expression);
                        var newContent = expression + ' // = ' + result;
                        
                        // Update Data Model
                        block.content = newContent;
                        PageManager.updateBlock(this.activePageId, blockId, { content: block.content });
                        
                        // V71 OPTIMIZATION: Direct DOM Update
                        // Instead of full render(), we update the specific element to allow immediate feedback
                        var inner = blockWrapper.querySelector('.code-inner');
                        if (inner) {
                            inner.innerHTML = BlockEditor.getCalcPreviewHtml(newContent);
                            inner.setAttribute('data-highlighted', 'true');
                            
                            // Remove focus to show the preview state
                            inner.blur(); 
                        }
                        
                    } catch (err) {
                        console.error('Calc Error:', err);
                        if (typeof showNotification === 'function') {
                            showNotification('Calc Error: ' + err.message);
                        }
                    }
                    return;
                }
            }
        }


        // V70: HISTORY (Undo/Redo)
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
            e.preventDefault();
            if (e.shiftKey) HistoryManager.redo();
            else HistoryManager.undo();
            return;
        }

        // V70: DUPLICATE BLOCK (CMD+D)
        if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
            e.preventDefault();
            var blockWrapper = e.target.closest('.block-wrapper');
            if (blockWrapper) {
                var blockId = blockWrapper.getAttribute('data-block-id');
                HistoryManager.push(this.activePageId); // Snapshot

                var page = NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
                var block = page.blocks.find(function(b) { return b.id === blockId; });

                if (block) {
                    // Deep clone the block
                    var newBlock = JSON.parse(JSON.stringify(block));
                    newBlock.id = 'blk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

                    // Insert after current
                    var idx = page.blocks.findIndex(function(b) { return b.id === blockId; });
                    page.blocks.splice(idx + 1, 0, newBlock);

                    this.render(this.activePageId);
                    this.focusBlock(newBlock.id);
                }
            }
            return;
        }

        // V70: MOVE BLOCK (ALT + ARROW UP/DOWN)
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            var blockWrapper = e.target.closest('.block-wrapper');
            if (blockWrapper) {
                var blockId = blockWrapper.getAttribute('data-block-id');
                HistoryManager.push(this.activePageId); // Snapshot

                var page = NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
                var idx = page.blocks.findIndex(function(b) { return b.id === blockId; });

                if (idx === -1) return;

                if (e.key === 'ArrowUp' && idx > 0) {
                    // Swap with previous
                    var temp = page.blocks[idx - 1];
                    page.blocks[idx - 1] = page.blocks[idx];
                    page.blocks[idx] = temp;
                    this.render(this.activePageId);
                    this.focusBlock(blockId); // Keep focus
                } else if (e.key === 'ArrowDown' && idx < page.blocks.length - 1) {
                    // Swap with next
                    var temp = page.blocks[idx + 1];
                    page.blocks[idx + 1] = page.blocks[idx];
                    page.blocks[idx] = temp;
                    this.render(this.activePageId);
                    this.focusBlock(blockId); // Keep focus
                }
            }
            return;
        }

        // V68: Tab / Shift+Tab for Indentation
        if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
            var blockWrapper = e.target.closest('.block-wrapper');
            if (blockWrapper) {
                e.preventDefault();
                var blockId = blockWrapper.getAttribute('data-block-id');
                var page = NOTES.find(n => n.id === this.activePageId);
                var block = page ? page.blocks.find(b => b.id === blockId) : null;
                if (block) {
                    var newLevel = (block.level || 0) + (e.shiftKey ? -1 : 1);
                    PageManager.updateBlock(this.activePageId, block.id, { level: newLevel });
                    this.render(this.activePageId);
                    saveData();
                }
                return;
            }
        }
        
        // V65: Check if user is actively editing inside content (has text cursor/selection)
        var isEditingContent = e.target.closest('.block-content, .task-text, .code-inner, .image-caption');
        var hasTextSelection = window.getSelection().toString().length > 0;
        
        // V65: Delete/Backspace with selection - delete all selected blocks
        // Only intercept if we have multi-select OR if focus is outside editable content
        if ((e.key === 'Backspace' || e.key === 'Delete') && this.selectedBlockIds.length >= 1) {
            if (!isEditingContent || this.selectedBlockIds.length > 1) {
                e.preventDefault();
                var page = NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
                if (!page) return;
                
                // Delete all selected blocks
                var idsToDelete = this.selectedBlockIds.slice();
                idsToDelete.forEach(function(id) {
                    PageManager.deleteBlock(BlockEditor.activePageId, id);
                });
                
                this.clearSelection();
                this.render(this.activePageId);
                saveData();
                return;
            }
        }
        
        // V65: CMD+C with selection - copy all selected blocks
        if ((e.metaKey || e.ctrlKey) && e.key === 'c' && this.selectedBlockIds.length >= 1) {
            // If user has text selected inside a block, let browser handle normal copy
            if (hasTextSelection) {
                return;
            }
            
            // Copy all selected blocks
            e.preventDefault();
            var blocks = this.getSelectedBlocks();
            var allText = blocks.map(function(block) {
                if (block.type === 'task') {
                    return (block.checked ? '- [x] ' : '- [ ] ') + (block.content || '');
                } else if (block.type === 'code') {
                    return '```\n' + (block.content || '') + '\n```';
                } else if (block.type === 'h1') {
                    return '# ' + (block.content || '');
                } else if (block.type === 'h2') {
                    return '## ' + (block.content || '');
                } else if (block.type === 'h3') {
                    return '### ' + (block.content || '');
                } else if (block.type === 'quote') {
                    return '> ' + (block.content || '');
                } else if (block.type === 'bullet') {
                    return '- ' + (block.content || '');
                } else if (block.type === 'divider') {
                    return '---';
                } else {
                    return block.content || '';
                }
            }).join('\n');
            
            navigator.clipboard.writeText(allText).then(function() {
                if (typeof showNotification === 'function') {
                    showNotification('Copied ' + blocks.length + ' block' + (blocks.length > 1 ? 's' : ''));
                }
            });
            return;
        }
        
        // V65: CMD+X with selection - cut all selected blocks
        if ((e.metaKey || e.ctrlKey) && e.key === 'x' && this.selectedBlockIds.length >= 1) {
            // If user has text selected inside a block, let browser handle normal cut
            if (hasTextSelection) {
                return;
            }
            
            // Cut all selected blocks
            e.preventDefault();
            var blocks = this.getSelectedBlocks();
            var allText = blocks.map(function(block) {
                if (block.type === 'task') {
                    return (block.checked ? '- [x] ' : '- [ ] ') + (block.content || '');
                } else if (block.type === 'code') {
                    return '```\n' + (block.content || '') + '\n```';
                } else if (block.type === 'h1') {
                    return '# ' + (block.content || '');
                } else if (block.type === 'h2') {
                    return '## ' + (block.content || '');
                } else if (block.type === 'h3') {
                    return '### ' + (block.content || '');
                } else if (block.type === 'quote') {
                    return '> ' + (block.content || '');
                } else if (block.type === 'bullet') {
                    return '- ' + (block.content || '');
                } else if (block.type === 'divider') {
                    return '---';
                } else {
                    return block.content || '';
                }
            }).join('\n');
            
            navigator.clipboard.writeText(allText).then(function() {
                // Delete after copy
                var idsToDelete = BlockEditor.selectedBlockIds.slice();
                idsToDelete.forEach(function(id) {
                    PageManager.deleteBlock(BlockEditor.activePageId, id);
                });
                BlockEditor.clearSelection();
                BlockEditor.render(BlockEditor.activePageId);
                saveData();
                if (typeof showNotification === 'function') {
                    showNotification('Cut ' + blocks.length + ' block' + (blocks.length > 1 ? 's' : ''));
                }
            });
            return;
        }
        
        var blockEl = e.target.closest('.block-wrapper');
        if (!blockEl) return;
        var blockId = blockEl.getAttribute('data-block-id');
        var blockType = blockEl.getAttribute('data-block-type');
        
        // V61: CMD+Arrow for universal block navigation (works in code blocks too)
        if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            var page = NOTES.find(n => n.id === this.activePageId);
            if (!page) return;
            var idx = page.blocks.findIndex(b => b.id === blockId);
            
            if (e.key === 'ArrowUp' && idx > 0) {
                this.focusBlock(page.blocks[idx - 1].id);
            } else if (e.key === 'ArrowDown') {
                if (idx < page.blocks.length - 1) {
                    this.focusBlock(page.blocks[idx + 1].id);
                } else {
                    // Create new block at end
                    var newBlock = PageManager.addBlock(page, 'p', '', blockId);
                    this.render(this.activePageId);
                    if (newBlock) this.focusBlock(newBlock.id);
                }
            }
            return;
        }

        // Enter = split block at cursor (Notion-like)
        if (e.key === 'Enter' && !e.shiftKey) {
            if (blockType === 'code') return;
            if (blockType === 'image') return; // V63.6: Don't split image blocks
            if (blockType === 'table') return; // V64: Table has its own Enter handling

            e.preventDefault();
            var page = NOTES.find(n => n.id === this.activePageId);
            if (!page) return;
            
            // Get cursor position and split text
            var sel = window.getSelection();
            var range = sel.getRangeAt(0);
            var contentEl = e.target;
            
            // Get text before and after cursor
            var beforeRange = document.createRange();
            beforeRange.selectNodeContents(contentEl);
            beforeRange.setEnd(range.startContainer, range.startOffset);
            var textBefore = beforeRange.toString();
            
            var afterRange = document.createRange();
            afterRange.selectNodeContents(contentEl);
            afterRange.setStart(range.endContainer, range.endOffset);
            var textAfter = afterRange.toString();
            
            // Update current block with text before cursor
            PageManager.updateBlock(this.activePageId, blockId, { content: textBefore });
            
            // Notion-style: Enter on empty list item backtracks to paragraph
            if (['bullet', 'numbered', 'task'].includes(blockType) && !textBefore.trim() && !textAfter.trim()) {
                PageManager.updateBlock(this.activePageId, blockId, { type: 'p', level: 0 });
                this.render(this.activePageId);
                return;
            }

            // Create new block with text after cursor
            var newType = ['bullet', 'numbered', 'task'].includes(blockType) ? blockType : 'p';
            var pageBlocks = page.blocks;
            var currentBlock = pageBlocks.find(b => b.id === blockId);
            var newBlock = PageManager.addBlock(page, newType, textAfter, blockId);
            if (currentBlock && currentBlock.level) {
                PageManager.updateBlock(this.activePageId, newBlock.id, { level: currentBlock.level });
            }
            
            this.focusedBlockId = newBlock.id;
            this.render(this.activePageId);
            
            // Position cursor at start of new block
            var self = this;
            setTimeout(function() {
                var newEl = self.container.querySelector('[data-block-id="' + newBlock.id + '"] .block-content');
                if (newEl) {
                    newEl.focus();
                    var r = document.createRange();
                    r.selectNodeContents(newEl);
                    r.collapse(true); // Collapse to start
                    var s = window.getSelection();
                    s.removeAllRanges();
                    s.addRange(r);
                }
            }, 0);
        }

        // Backspace at start = merge with previous block (Notion-like)
        if (e.key === 'Backspace') {
            if (blockType === 'image') return; // V63.6: Don't merge/delete image blocks via keyboard
            if (blockType === 'table') return; // V64: Table has its own cell handling
            var sel = window.getSelection();
            var atStart = false;
            
            if (sel.rangeCount > 0) {
                var range = sel.getRangeAt(0);
                var startRange = range.cloneRange();
                startRange.selectNodeContents(e.target);
                startRange.setEnd(range.startContainer, range.startOffset);
                atStart = startRange.toString().length === 0 && range.collapsed;
            }
            
            if (atStart) {
                var page = NOTES.find(n => n.id === this.activePageId);
                if (!page) return;
                
                var idx = page.blocks.findIndex(b => b.id === blockId);
                if (idx > 0) {
                    e.preventDefault();
                    var prevBlock = page.blocks[idx - 1];
                    var currentBlock = page.blocks[idx];
                    var currentText = e.target.textContent || '';
                    var prevText = prevBlock.content || '';
                    
                    // Merge: append current block's text to previous block
                    var cursorPosition = prevText.length;
                    PageManager.updateBlock(this.activePageId, prevBlock.id, { content: prevText + currentText });
                    PageManager.deleteBlock(this.activePageId, blockId);
                    
                    this.focusedBlockId = prevBlock.id;
                    this.render(this.activePageId);
                    
                    // Position cursor at the merge point
                    var self = this;
                    setTimeout(function() {
                        var prevEl = self.container.querySelector('[data-block-id="' + prevBlock.id + '"] .block-content');
                        if (!prevEl) prevEl = self.container.querySelector('[data-block-id="' + prevBlock.id + '"] .task-text');
                        if (prevEl) {
                            prevEl.focus();
                            // Move cursor to merge point
                            var textNode = prevEl.firstChild;
                            if (textNode && textNode.nodeType === 3) {
                                var r = document.createRange();
                                var pos = Math.min(cursorPosition, textNode.length);
                                r.setStart(textNode, pos);
                                r.collapse(true);
                                var s = window.getSelection();
                                s.removeAllRanges();
                                s.addRange(r);
                            }
                        }
                    }, 0);
                }
            }
        }

        // V59: Arrow keys navigation between blocks
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            var page = NOTES.find(n => n.id === this.activePageId);
            if (!page) return;
            
            var sel = window.getSelection();
            var atStart = false;
            var atEnd = false;
            
            if (sel.rangeCount > 0) {
                var range = sel.getRangeAt(0);
                // Check At Start
                var startRange = range.cloneRange();
                startRange.selectNodeContents(e.target);
                startRange.setEnd(range.startContainer, range.startOffset);
                atStart = startRange.toString().length === 0;
                
                // Check At End
                var endRange = range.cloneRange();
                endRange.selectNodeContents(e.target);
                endRange.setStart(range.endContainer, range.endOffset);
                atEnd = endRange.toString().length === 0;
            } else {
                atStart = atEnd = true;
            }
            
            var idx = page.blocks.findIndex(b => b.id === blockId);
            
            // ArrowUp at start of block -> focus previous block
            if (e.key === 'ArrowUp' && atStart) {
                e.preventDefault();
                var targetIdx = idx - 1;
                // V63.4: Skip Dividers, Images, Kanban blocks, and Tables
                while (targetIdx >= 0 && ['divider', 'image', 'kanban_ref', 'table'].includes(page.blocks[targetIdx].type)) {
                    targetIdx--;
                }
                
                if (targetIdx >= 0) {
                    this.focusBlock(page.blocks[targetIdx].id);
                }
            }
            // ArrowDown at end of block -> focus next block or create new
            else if (e.key === 'ArrowDown' && atEnd) {
                e.preventDefault();
                var targetIdx = idx + 1;
                // V63.4: Skip Dividers, Images, Kanban blocks, and Tables
                while (targetIdx < page.blocks.length && ['divider', 'image', 'kanban_ref', 'table'].includes(page.blocks[targetIdx].type)) {
                    targetIdx++;
                }

                if (targetIdx < page.blocks.length) {
                    this.focusBlock(page.blocks[targetIdx].id);
                } else {
                    // V60: At very last block - create new block
                    var newBlock = PageManager.addBlock(page, 'p', '', blockId);
                    this.render(this.activePageId);
                    if (newBlock) this.focusBlock(newBlock.id);
                }
            }
        }

        // Shortcuts (CMD+B, I, U, K, L)
        if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u', 'k', 'l'].includes(e.key.toLowerCase())) {
            e.preventDefault();
            // V56: CMD+L = WikiLink (deprecated CMD+Shift+L)
            if (e.key.toLowerCase() === 'l') {
                Notes.processEditorShortcut('l'); // Maps to WikiLink
            } else {
                Notes.processEditorShortcut(e.key.toLowerCase());
            }
        }

        // Slash = open command menu
        if (e.key === '/') {
            // V15.1: More responsive slash menu (allow even if text exists)
            var self = this;
            setTimeout(function () {
                SlashMenu.show(blockEl);
            }, 10);
        }
    },

    handleInput: function (e) {
        var blockEl = e.target.closest('.block-wrapper');
        if (!blockEl) return;

        var blockId = blockEl.getAttribute('data-block-id');
        var blockType = blockEl.getAttribute('data-block-type');
        
        // V63.6: Image blocks have their own caption handler, skip the general one
        // V64: Table blocks have their own cell handlers
        if (blockType === 'image' || blockType === 'table') return;
        
        var newContent = e.target.textContent || '';

        // V68: Alignment Marker Auto-strip (for manual typing or pasting)
        var alignMatch = newContent.match(/\s?%%align:(left|center|right)%%$/);
        if (alignMatch) {
            var align = alignMatch[1];
            newContent = newContent.replace(/\s?%%align:(left|center|right)%%$/, '').trim();
            PageManager.updateBlock(this.activePageId, blockId, { content: newContent, align: align });
            this.render(this.activePageId);
            this.focusBlock(blockId); // Ensure focus is restored
            return;
        }

        // V68: Input Rules (auto-convert)
        if (newContent.startsWith('- ') || newContent.startsWith('* ')) {
            PageManager.updateBlock(this.activePageId, blockId, { type: 'bullet', content: newContent.substring(2) });
            this.render(this.activePageId);
            return;
        } else if (newContent.match(/^1\.\s/)) {
            PageManager.updateBlock(this.activePageId, blockId, { type: 'numbered', content: newContent.substring(3) });
            this.render(this.activePageId);
            return;
        } else if (newContent.startsWith('> ')) {
            PageManager.updateBlock(this.activePageId, blockId, { type: 'quote', content: newContent.substring(2) });
            this.render(this.activePageId);
            return;
        }

        // V15.3+: UPDATE DATA IMMEDIATELY (Prevents loss on fast switch/reload)
        PageManager.updateBlock(this.activePageId, blockId, { content: newContent });
        
        // V53: Update SlashMenu filter if visible
        if (SlashMenu.visible) {
            var slashMatch = newContent.match(/\/(\w*)$/);
            if (slashMatch) {
                SlashMenu.filterQuery = slashMatch[1] || '';
                SlashMenu.selectedIndex = 0;
                SlashMenu.render();
            } else {
                SlashMenu.hide(); // No slash pattern, hide menu
            }
        }

        // Debounce the heavy sync and heavy save
        var self = this;
        clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(function () {
            PageManager.syncContent(self.activePageId);
            // Updating word count live
            if (typeof Notes !== 'undefined') {
                Notes.updateWordCount();
                Notes.updateTags();      // V57: Update editor header tags
                Notes.updateAllTags();   // V57: Update sidebar-all-tags instantly
            }
        }, 500);
    },

    handleClick: function (e) {
        // V65: Skip focus behavior if we have blocks selected (drag-select or CMD+Click)
        if (this.selectedBlockIds && this.selectedBlockIds.length > 0) {
            return;
        }
        
        // 1. Try to find the specific block clicked
        var blockEl = e.target.closest('.block-wrapper');
        
        if (blockEl) {
            this.focusedBlockId = blockEl.getAttribute('data-block-id');
        } else {
            // 2. Apple Notes Logic: Clicked "Void" -> Focus Last Block
            if (this.container.lastElementChild) {
                var lastBlock = this.container.lastElementChild;
                var lastId = lastBlock.getAttribute('data-block-id');
                this.focusBlock(lastId);
            } else {
                // 3. Empty Note? Create first block.
                if (typeof PageManager !== 'undefined' && this.activePageId) {
                    var page = NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
                    if (page) {
                        var newBlock = PageManager.addBlock(page, 'p', '');
                        this.render(this.activePageId);
                        if (newBlock) this.focusBlock(newBlock.id);
                    }
                }
            }
        }
    },

    handlePaste: function (e) {
        // V63.6: Handle Image Paste
        var items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                var file = items[i].getAsFile();
                this.processImageFile(file);
                e.preventDefault();
                return;
            }
        }

        e.preventDefault();
        var text = (e.originalEvent || e).clipboardData.getData('text/plain');
        
        if (text.includes('\n')) {
            var lines = text.split(/\r?\n/);
            var page = NOTES.find(n => n.id === this.activePageId);
            if (!page) return;
            
            var blockEl = e.target.closest('.block-wrapper');
            var startBlockId = blockEl ? blockEl.getAttribute('data-block-id') : null;
            var currentInsertAfter = startBlockId;

            lines.forEach(function(line, idx) {
                if (!line.trim() && idx > 0) return;
                
                var type = 'p';
                var content = line;
                var updates = {};

                if (line.startsWith('# ')) { type = 'h1'; content = line.substring(2); }
                else if (line.startsWith('## ')) { type = 'h2'; content = line.substring(3); }
                else if (line.startsWith('### ')) { type = 'h3'; content = line.substring(4); }
                else if (line.startsWith('- [ ] ')) { type = 'task'; content = line.substring(6); updates.checked = false; }
                else if (line.startsWith('- [x] ')) { type = 'task'; content = line.substring(6); updates.checked = true; }
                else if (line.startsWith('- ') || line.startsWith('* ')) { type = 'bullet'; content = line.substring(2); }
                else if (line.startsWith('> ')) { type = 'quote'; content = line.substring(2); }
                
                if (idx === 0 && startBlockId) {
                    PageManager.updateBlock(BlockEditor.activePageId, startBlockId, Object.assign({ type: type, content: content }, updates));
                } else {
                    var newBlock = PageManager.addBlock(page, type, content, currentInsertAfter);
                    if (Object.keys(updates).length) PageManager.updateBlock(BlockEditor.activePageId, newBlock.id, updates);
                    currentInsertAfter = newBlock.id;
                }
            });
            this.render(this.activePageId);
            saveData();
        } else {
            document.execCommand('insertText', false, text);
        }
    },

    focusBlock: function (blockId) {
        var el = this.container.querySelector('[data-block-id="' + blockId + '"] .block-content');
        if (!el) return;
        
        // If it's a task, focus the span
        if (el.classList.contains('block-task')) {
            el = el.querySelector('.task-text');
        } else if (el.classList.contains('block-code')) {
            el = el.querySelector('.code-inner');
        }

        if (el) {
            el.focus();
            // Move cursor to end
            var range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }
};

/* =========================================
   PHASE 4: SLASH COMMAND MENU
   Quick block insertion system
   ========================================= */
var SlashMenu = {
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

        // V15.3: Caret-Relative Positioning (Voltron Pattern)
        const selection = window.getSelection();
        var menuTop, menuLeft;
        
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            
            // Fallback to block rect if caret rect is zero (e.g. empty block)
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
        
        // V63.6: Viewport Boundary Check - flip menu above caret if overflowing
        var menuRect = this.element.getBoundingClientRect();
        var viewportHeight = window.innerHeight;
        
        if (menuRect.bottom > viewportHeight - 20) {
            // Menu overflows, position it above the caret instead
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
        var page = NOTES.find(n => n.id === BlockEditor.activePageId);
        if (!page) return;

        // Clear the '/command' pattern that triggered it
        var block = page.blocks.find(b => b.id === this.targetBlockId);
        if (block) {
            // V68: Also strip any manually typed alignment markers to keep the editor clean
            block.content = block.content.replace(/\s?%%align:(left|center|right)%%$/, '').trim();

            // Check for alignment commands
            if (cmdId === 'align-left' || cmdId === 'align-center' || cmdId === 'align-right') {
                block.align = cmdId.replace('align-', '');
                block.content = block.content.replace(/\/[\w-]*$/, '').trim(); // Remove command text
            }
            else if (cmdId === 'cmd_time') {
                // V70: Insert Time
                block.content = block.content.replace(/\/[\w]*$/, '').trim();
                var timeStr = new Date().toLocaleString();
                block.content += (block.content ? ' ' : '') + timeStr;
            }
            else if (cmdId === 'cmd_weather') {
                // V70: Insert Weather
                block.content = block.content.replace(/\/[\w]*$/, '').trim();
                // Pull from global cache
                if (typeof WEATHER_CACHE !== 'undefined' && WEATHER_CACHE.data && WEATHER_CACHE.data.current_condition) {
                    var curr = WEATHER_CACHE.data.current_condition[0]; // Assuming array structure from API
                    var temp = CONFIG.use_celsius ? curr.temp_C + 'C' : curr.temp_F + 'F';
                    var desc = curr.weatherDesc[0].value;
                    block.content += (block.content ? ' ' : '') + '[' + CONFIG.location + ': ' + temp + ', ' + desc + ']';
                } else {
                    block.content += " [Weather Data Unavailable]";
                }
            }
            else if (cmdId === 'cmd_calc') {
                // V70: Calculator Block
                block.content = '// Type math (e.g. 50 * 2) and press Ctrl+Enter to solve';
                block.type = 'code';
                block.language = 'calc'; // Custom language for calculator
            }
            else {
                // Normal Block Type Change
                block.type = cmdId;
                block.content = block.content.replace(/\/[\w-]*$/, '').trim();
            }
            
            // Special initialization for specific types
            if (cmdId === 'task') {
                block.checked = false;
                block.createdAt = Date.now();
            }
            if (cmdId === 'code') block.language = 'javascript';
            if (cmdId === 'kanban') {
                block.type = 'kanban_ref'; // V65: Set correct block type
                block.boardId = null; // V65: Don't create board immediately, let user choose
                // Immediately render to show the board preview
                setTimeout(function() {
                    BlockEditor.render(BlockEditor.activePageId);
                    // Notes.renderSidebar(); // No board created yet
                }, 50);
            }
            if (cmdId === 'tag') {
                block.type = 'p'; // Tags are inline, keep as paragraph
                block.content = '#'; // Start with #, user types tag name
            }
            if (cmdId === 'table') {
                block.type = 'table';  // V64: Dedicated table block type
                block.tableData = {
                    headers: ['Header 1', 'Header 2', 'Header 3'],
                    rows: [
                        ['', '', ''],
                        ['', '', '']
                    ],
                    columnAligns: ['left', 'left', 'left'],
                    hasHeaderRow: true
                };
                block.content = ''; // Clear any leftover content
            }
            if (cmdId === 'image') {
                block.type = 'p'; // Image block placeholder
                block.content = 'PASTE_OR_DRAG_IMAGE_HERE';
                
                // Trigger file picker
                var input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = function(e) {
                    if (e.target.files.length > 0) {
                        // Remove the placeholder block since it will be replaced by processImageFile
                        var idx = page.blocks.findIndex(b => b.id === block.id);
                        if (idx !== -1) page.blocks.splice(idx, 1);
                        BlockEditor.processImageFile(e.target.files[0]);
                    }
                };
                input.click();
            }
        }
        
        this.filterQuery = ''; // V53: Reset filter

        BlockEditor.render(BlockEditor.activePageId);
        BlockEditor.focusBlock(this.targetBlockId);
        PageManager.syncContent(BlockEditor.activePageId);
    }
};

/* =========================================
   PHASE 5: KANBAN BOARD SYSTEM
   Visual task management & embedding
   ========================================= */
var KanbanManager = {
    activeBoard: null,
    editingCardId: null,
    editingColId: null,
    selectColIdx: -1, // V65: Default to -1 (No selection visual) until key interaction
    selectCardIdx: -1,
    isGrabbing: false, // V66: Vim-Ban Grab Mode
    grabSourceColIdx: -1,
    grabSourceCardIdx: -1,
    boundHandleKey: null, // V66: Prevent event leaks

    createBoard: function (title) {
        var board = {
            id: 'board_' + Date.now(),
            title: title || 'UNINITIALIZED_BOARD',
            created: Date.now(),
            modified: Date.now(),
            columns: [
                { id: 'col_' + Date.now() + '_1', title: 'PENDING', cards: [] },
                { id: 'col_' + Date.now() + '_2', title: 'ACTIVE', cards: [] },
                { id: 'col_' + Date.now() + '_3', title: 'RESOLVED', cards: [] }
            ]
        };
        BOARDS.push(board);
        saveData();
        this.syncPage(); // V67: Real-time HUD Sync
        return board;
    },

    open: function (boardId) {
        this.activeBoard = BOARDS.find(function (b) { return b.id === boardId; });
        if (!this.activeBoard) return;

        this.selectColIdx = -1; // V65: Mouse-first default
        this.selectCardIdx = -1;

        var modal = document.getElementById('kanban-modal');
        var title = document.getElementById('kanban-modal-title');

        if (modal && title) {
            title.textContent = 'BOARD : ' + this.activeBoard.title.toUpperCase();
            ModalManager.open('kanban-modal');
            
            // V66: Clean Event Binding
            if (this.boundHandleKey) document.removeEventListener('keydown', this.boundHandleKey);
            this.boundHandleKey = this.handleKey.bind(this);
            document.addEventListener('keydown', this.boundHandleKey);
        }
        this.render();
    },

    // V66: Top-Level Keyboard Handler (Prevents Memory Leaks)
    handleKey: function(e) {
        if (!this.activeBoard || this.editingCardId || this.editingColId) return;
        
        var modal = document.getElementById('kanban-modal');
        // Only process if modal is active
        if (!modal || !modal.classList.contains('active')) return;

        var key = e.key.toLowerCase();
        var cols = this.activeBoard.columns;
        var self = this;

        // V65: Auto-select first column on first significant keypress
        if (this.selectColIdx === -1) {
            if (['h', 'j', 'k', 'l', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'enter', 'n'].includes(key)) {
                e.preventDefault();
                this.selectColIdx = 0;
                this.selectCardIdx = 0; // Select first card by default if exists
                if (cols[0].cards.length === 0) this.selectCardIdx = -1;
                this.render();
                return;
            }
        }

        // V66: Vim-Ban Logic
        if (key === ' ' || key === 'spacebar') {
            // GRAB / DROP TOGGLE
            e.preventDefault();
            if (this.selectCardIdx !== -1) {
                if (!this.isGrabbing) {
                    // START GRAB
                    this.isGrabbing = true;
                    this.grabSourceColIdx = this.selectColIdx;
                    this.grabSourceCardIdx = this.selectCardIdx;
                } else {
                    // DROP (Finalize Move)
                    this.isGrabbing = false;
                    
                    // Perform the Move if changed
                    if (this.grabSourceColIdx !== this.selectColIdx || this.grabSourceCardIdx !== this.selectCardIdx) {
                        var srcCol = cols[this.grabSourceColIdx];
                        var srcCard = srcCol ? srcCol.cards[this.grabSourceCardIdx] : null;
                        var destCol = cols[this.selectColIdx];
                        
                        // Logic:
                        // 1. Remove from Source
                        // 2. Insert at Destination Index
                        
                        if (srcCard) {
                            // Remove
                            srcCol.cards.splice(this.grabSourceCardIdx, 1);
                            
                            // Adjust dest index if same column and moved down
                            var insertIdx = this.selectCardIdx;
                            
                            // Safety clamp
                            if (insertIdx < 0) insertIdx = 0;
                            if (insertIdx > destCol.cards.length) insertIdx = destCol.cards.length;
                            
                            // Insert
                            destCol.cards.splice(insertIdx, 0, srcCard);
                            
                            this.activeBoard.modified = Date.now();
                            saveData();
                            this.syncPage(); // V67: Real-time HUD Sync
                        }
                    }
                    this.grabSourceColIdx = -1;
                    this.grabSourceCardIdx = -1;
                }
                this.render();
            }
        } else if (key === 'escape') {
             // CANCEL GRAB
             if (this.isGrabbing) {
                 e.preventDefault();
                 this.isGrabbing = false;
                 this.selectColIdx = this.grabSourceColIdx;
                 this.selectCardIdx = this.grabSourceCardIdx;
                 this.grabSourceColIdx = -1;
                 this.grabSourceCardIdx = -1;
                 this.render();
             }
        
        } else if (key === 'n') {
            // CREATE NEW
            if (!this.isGrabbing) {
                e.preventDefault();
                this.addCard(cols[this.selectColIdx].id, 'New Task');
                // Focus the new card (last one)
                this.selectCardIdx = cols[this.selectColIdx].cards.length - 1;
                this.render();
                
                // Trigger edit immediately
                var cardId = cols[this.selectColIdx].cards[this.selectCardIdx].id;
                setTimeout(function() { self.startEditCard(cardId, cols[self.selectColIdx].id); }, 50);
            }

        } else if (key === 'd' || key === 'backspace') {
            // DELETE
            e.preventDefault();
            if (this.selectCardIdx !== -1 && !this.isGrabbing) {
                var card = cols[this.selectColIdx].cards[this.selectCardIdx];
                this.deleteCard(cols[this.selectColIdx].id, card.id);
                this.selectCardIdx = Math.min(this.selectCardIdx, cols[this.selectColIdx].cards.length - 1);
                this.render();
            }
        } else if (key === 'enter') {
            // EDIT
            if (this.selectCardIdx !== -1 && !this.isGrabbing) {
                 e.preventDefault();
                var card = cols[this.selectColIdx].cards[this.selectCardIdx];
                this.startEditCard(card.id, cols[this.selectColIdx].id);
            }
        } else if (['h', 'j', 'k', 'l', 'arrowleft', 'arrowdown', 'arrowup', 'arrowright'].includes(key)) {
            // NAVIGATION (Standard for both modes - Ghost mode just moves cursor)
            e.preventDefault();
            
            if (key === 'l' || key === 'arrowright') {
                this.selectColIdx = Math.min(this.selectColIdx + 1, cols.length - 1);
                var len = cols[this.selectColIdx].cards.length;
                this.selectCardIdx = Math.min(this.selectCardIdx, Math.max(0, len - 1));
                if (len === 0) this.selectCardIdx = 0; 

            } else if (key === 'h' || key === 'arrowleft') {
                this.selectColIdx = Math.max(this.selectColIdx - 1, 0);
                var len = cols[this.selectColIdx].cards.length;
                this.selectCardIdx = Math.min(this.selectCardIdx, Math.max(0, len - 1));
                 if (len === 0) this.selectCardIdx = 0;

            } else if (key === 'j' || key === 'arrowdown') {
                 var cardCount = cols[this.selectColIdx].cards.length;
                 if (cardCount > 0 || this.isGrabbing) {
                     this.selectCardIdx = Math.min(this.selectCardIdx + 1, cardCount - (this.isGrabbing ? 0 : 1));
                     if (cardCount === 0 && this.isGrabbing && this.selectCardIdx > 0) this.selectCardIdx = 0;
                 }
            } else if (key === 'k' || key === 'arrowup') {
                this.selectCardIdx = Math.max(this.selectCardIdx - 1, 0);
            }
            this.render();
        }
    },

    close: function () {
        // V65: Close properly without recursive closeTop call
        var modal = document.getElementById('kanban-modal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
        }
        
        // V66: Cleanup listener
        if (this.boundHandleKey) {
            document.removeEventListener('keydown', this.boundHandleKey);
            this.boundHandleKey = null;
        }

        // Remove from stack
        ModalManager.stack = ModalManager.stack.filter(function(id) { return id !== 'kanban-modal'; });
        // Hide overlay if no more modals
        if (ModalManager.stack.length === 0) {
            var overlay = document.getElementById('modal-overlay');
            if (overlay) overlay.classList.remove('active');
        }
        this.activeBoard = null;
        this.editingCardId = null;
        this.editingColId = null;
        this.selectColIdx = -1;
        this.selectCardIdx = -1;
        this.isGrabbing = false;
        this.grabSourceColIdx = -1;
        this.grabSourceCardIdx = -1;
    },

    render: function () {
        var container = document.getElementById('kanban-container');
        if (!container || !this.activeBoard) return;

        container.innerHTML = '';
        var self = this;

        // Render each column
        this.activeBoard.columns.forEach(function (col, colIdx) {
            var colEl = document.createElement('div');
            colEl.className = 'kanban-column' + (self.selectColIdx === colIdx ? ' selected-col' : '');
            colEl.setAttribute('data-col-id', col.id);

            // V65: Column header with actions
            var header = document.createElement('div');
            header.className = 'kanban-column-header';
            
            var headerTitle = document.createElement('span');
            headerTitle.className = 'kanban-col-title';
            headerTitle.textContent = col.title;
            headerTitle.title = 'Click to rename';
            headerTitle.onclick = function(e) {
                e.stopPropagation();
                self.startEditColumnTitle(col.id, headerTitle);
            };
            
            var headerCount = document.createElement('span');
            headerCount.className = 'col-count';
            headerCount.textContent = '(' + col.cards.length + ')';
            
            // V65: Column delete button
            var colDeleteBtn = document.createElement('button');
            colDeleteBtn.className = 'kanban-col-delete';
            colDeleteBtn.textContent = 'X';
            colDeleteBtn.title = 'Delete column';
            colDeleteBtn.onclick = function(e) {
                e.stopPropagation();
                self.deleteColumn(col.id);
            };
            
            header.appendChild(headerTitle);
            header.appendChild(headerCount);
            header.appendChild(colDeleteBtn);

            var cardList = document.createElement('div');
            cardList.className = 'kanban-card-list';
            cardList.id = 'list-' + col.id;

            // Render cards
            var ghostRendered = false;
            col.cards.forEach(function (card, cardIdx) {
                // V66: Ghost Injection (Insert BEFORE current index)
                if (self.isGrabbing && self.selectColIdx === colIdx && self.selectCardIdx === cardIdx) {
                    var ghostEl = document.createElement('div');
                    ghostEl.className = 'kanban-card ghost';
                    // Try to get content
                    var srcCol = self.activeBoard.columns[self.grabSourceColIdx];
                    var srcCard = srcCol ? srcCol.cards[self.grabSourceCardIdx] : null;
                    ghostEl.innerHTML = srcCard ? self.renderCardMarkdown(srcCard.content) : '...';
                    cardList.appendChild(ghostEl);
                    ghostRendered = true;
                    
                    // Scroll ghost into view
                    setTimeout(function() { ghostEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 10);
                }

                var isSelected = (!self.isGrabbing && self.selectColIdx === colIdx && self.selectCardIdx === cardIdx);
                var isSource = (self.isGrabbing && self.grabSourceColIdx === colIdx && self.grabSourceCardIdx === cardIdx);
                
                var cardEl = self.createCardElement(card, col.id, isSelected, false);
                if (isSource) cardEl.classList.add('original-dimmed');
                
                cardList.appendChild(cardEl);
                
                if (isSelected) {
                    setTimeout(function() {
                        cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }, 10);
                }
            });

            // V66: Ghost Injection (Append at end)
            if (self.isGrabbing && self.selectColIdx === colIdx && !ghostRendered) {
                 var ghostEl = document.createElement('div');
                 ghostEl.className = 'kanban-card ghost';
                 var srcCol = self.activeBoard.columns[self.grabSourceColIdx];
                 var srcCard = srcCol ? srcCol.cards[self.grabSourceCardIdx] : null;
                 ghostEl.innerHTML = srcCard ? self.renderCardMarkdown(srcCard.content) : '...';
                 cardList.appendChild(ghostEl);
                 
                 setTimeout(function() { ghostEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 10);
            }

            // V65: Inline input area (hidden by default)
            var inputArea = document.createElement('div');
            inputArea.className = 'kanban-input-area';
            inputArea.id = 'input-area-' + col.id;
            inputArea.style.display = 'none';
            
            var inputField = document.createElement('input');
            inputField.type = 'text';
            inputField.name = 'kanban-new-card-input';
            inputField.placeholder = 'Enter card content...';
            inputField.className = 'kanban-input-field';
            
            var inputActions = document.createElement('div');
            inputActions.className = 'kanban-input-actions';
            
            var saveBtn = document.createElement('button');
            saveBtn.className = 'kanban-input-save';
            saveBtn.textContent = 'ADD';
            saveBtn.onclick = function() {
                if (inputField.value.trim()) {
                    self.addCard(col.id, inputField.value.trim());
                    inputField.value = '';
                    inputArea.style.display = 'none';
                }
            };
            
            var cancelBtn = document.createElement('button');
            cancelBtn.className = 'kanban-input-cancel';
            cancelBtn.textContent = 'CANCEL';
            cancelBtn.onclick = function() {
                inputField.value = '';
                inputArea.style.display = 'none';
            };
            
            inputField.onkeydown = function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    saveBtn.click();
                } else if (e.key === 'Escape') {
                    cancelBtn.click();
                }
            };
            
            inputActions.appendChild(saveBtn);
            inputActions.appendChild(cancelBtn);
            inputArea.appendChild(inputField);
            inputArea.appendChild(inputActions);

            // V65: Add Card Button (shows inline input)
            var addBtn = document.createElement('button');
            addBtn.className = 'kanban-add-card';
            addBtn.textContent = '+ ADD_LOG_ENTRY';
            addBtn.onclick = function () {
                inputArea.style.display = 'block';
                inputField.focus();
            };

            // Drop Handling
            // Drop Handling - V65: Optimized with requestAnimationFrame
            var rafId = null;
            colEl.addEventListener('dragover', function (e) {
                e.preventDefault();
                colEl.classList.add('drag-over');
                
                if (rafId) return; // Skip if a frame is already pending
                rafId = requestAnimationFrame(function() {
                    self.showPlaceholder(cardList, e.clientY);
                    rafId = null;
                });
            });

            colEl.addEventListener('dragleave', function () {
                colEl.classList.remove('drag-over');
            });

            colEl.addEventListener('drop', function (e) {
                e.preventDefault();
                colEl.classList.remove('drag-over');
                if (self.draggedCard) {
                    self.moveCard(self.draggedCard.id, self.sourceColId, col.id);
                    self.draggedCard = null;
                }
            });

            colEl.appendChild(header);
            colEl.appendChild(cardList);
            colEl.appendChild(inputArea);
            colEl.appendChild(addBtn);
            container.appendChild(colEl);
        });

        // V65: Add Column button
        var addColBtn = document.createElement('div');
        addColBtn.className = 'kanban-add-column';
        addColBtn.innerHTML = '<span>+ ADD_COLUMN</span>';
        addColBtn.onclick = function() {
            self.addColumn('NEW_COLUMN');
        };
        container.appendChild(addColBtn);
    },

    // V65: Create card element with delete button and edit support
    createCardElement: function(card, colId, isSelected, isGrabbing) {
        var self = this;
        var cardEl = document.createElement('div');
        // V66: Apply Vim-Ban classes
        cardEl.className = 'kanban-card' + (isSelected ? ' focused' : '') + (isGrabbing ? ' grabbing' : '');
        cardEl.draggable = true;
        cardEl.setAttribute('data-card-id', card.id);
        
        // V65: Card content with markdown rendering
        var cardContent = document.createElement('div');
        cardContent.className = 'kanban-card-content';
        // Use simple markdown rendering for cards
        cardContent.innerHTML = this.renderCardMarkdown(card.content);
        
        // V65: Delete button
        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'kanban-card-delete';
        deleteBtn.textContent = 'X';
        deleteBtn.title = 'Delete card';
        deleteBtn.onclick = function(e) {
            e.stopPropagation();
            self.deleteCard(card.id, colId);
        };
        
        // V65: Click to edit
        cardContent.onclick = function(e) {
            if (e.target.tagName === 'A') return; // Allow link clicks
            self.startEditCard(card.id, colId, cardContent, card.content);
        };

        // V67: Double-click to portal (Notion Style)
        cardEl.ondblclick = function(e) {
            e.stopPropagation();
            if (card.content && typeof Notes !== 'undefined') {
                (Notes.openByTitle(card.content) || Notes.create(card.content));
            }
        };
        
        // Drag handlers
        cardEl.addEventListener('dragstart', function (e) {
            self.draggedCard = card;
            self.sourceColId = colId;
            cardEl.classList.add('dragging');
            e.dataTransfer.setData('text/plain', card.id);
        });

        cardEl.addEventListener('dragend', function () {
            cardEl.classList.remove('dragging');
            self.cleanupPlaceholders();
        });
        
        cardEl.appendChild(cardContent);
        cardEl.appendChild(deleteBtn);
        return cardEl;
    },

    // V65: Simple markdown for cards (bold, italic, links, tags)
    renderCardMarkdown: function(content) {
        if (!content) return '';
        var html = content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Italic
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        // Tags with colors
        html = html.replace(/#(urgent|critical)/gi, '<span class="kanban-tag urgent">#$1</span>');
        html = html.replace(/#(dev|code)/gi, '<span class="kanban-tag dev">#$1</span>');
        html = html.replace(/#(design|ui)/gi, '<span class="kanban-tag design">#$1</span>');
        html = html.replace(/#(\w+)/g, '<span class="kanban-tag">#$1</span>');
        // Line breaks
        html = html.replace(/\n/g, '<br>');
        return html;
    },

    // V65: Start editing a card inline
    startEditCard: function(cardId, colId, contentEl, currentContent) {
        if (this.editingCardId) return; // Already editing
        
        // V66: Robust lookup for keyboard actions
        if (!currentContent || !contentEl) {
            var col = this.activeBoard.columns.find(function(c) { return c.id === colId; });
            if (!col) return;
            var card = col.cards.find(function(c) { return c.id === cardId; });
            if (!card) return;
            
            if (!currentContent) currentContent = card.content;
            if (!contentEl) {
                var cardEl = document.querySelector('[data-card-id="' + cardId + '"]');
                if (cardEl) contentEl = cardEl.querySelector('.kanban-card-content');
            }
        }
        
        if (!contentEl) { 
            console.error('Edit Error: content element not found for ' + cardId); 
            return; 
        }
        
        this.editingCardId = cardId;
        this.editingColId = colId;
        var self = this;
        
        var textarea = document.createElement('textarea');
        textarea.name = 'kanban-card-edit-area';
        textarea.className = 'kanban-card-edit';
        textarea.value = currentContent;
        textarea.rows = 3;
        
        contentEl.innerHTML = '';
        contentEl.appendChild(textarea);
        textarea.focus();
        textarea.select();
        
        var saveEdit = function() {
            var newContent = textarea.value.trim();
            if (newContent && newContent !== currentContent) {
                self.updateCard(cardId, colId, newContent);
            } else {
                self.render(); // Re-render to restore
            }
            self.editingCardId = null;
            self.editingColId = null;
        };
        
        textarea.onblur = saveEdit;
        textarea.onkeydown = function(e) {
            e.stopPropagation(); // V66: Prevent bubbling to global handler (loop fix)
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                textarea.blur();
            } else if (e.key === 'Escape') {
                self.editingCardId = null;
                self.editingColId = null;
                self.render();
            }
        };
    },

    handlePreviewInject: function(e, boardId) {
        if (e.key === 'Enter') {
            e.stopPropagation();
            e.preventDefault();
            
            var input = e.target;
            var content = input.value.trim();
            if (!content) return;
            
            var board = BOARDS.find(function(b) { return b.id === boardId; });
            if (board && board.columns.length > 0) {
                board.columns[0].cards.push({
                    id: 'card_' + Date.now(),
                    content: content,
                    created: Date.now()
                });
                board.modified = Date.now();
                saveData();
                
                // Visual feedback
                input.value = '';
                input.placeholder = 'Saved! Add another...';
                setTimeout(function() { input.placeholder = '+ Add to Backlog...'; }, 1000);
                
                // Force a re-render of the active page to update the preview
                this.syncPage();
            }
        }
    },

    // V65: Advance card to next column (Protocol Logic)
    advanceCard: function(cardId) {
        if (!this.activeBoard) return false;
        
        var self = this;
        var sourceCol = null;
        var cardIndex = -1;
        var sourceColIndex = -1;

        // Find card
        this.activeBoard.columns.forEach(function(col, idx) {
            var cIdx = col.cards.findIndex(function(c) { return c.id === cardId; });
            if (cIdx !== -1) {
                sourceCol = col;
                cardIndex = cIdx;
                sourceColIndex = idx;
            }
        });

        if (sourceCol && sourceColIndex < this.activeBoard.columns.length - 1) {
            // Move to next column
            var card = sourceCol.cards.splice(cardIndex, 1)[0];
            var targetCol = this.activeBoard.columns[sourceColIndex + 1];
            targetCol.cards.unshift(card); // Add to top of next column
            
            // Update timestamps
            card.modified = Date.now();
            this.activeBoard.modified = Date.now();
            
            saveData();
            
            // If modal is open, re-render
            if (document.getElementById('kanban-modal').classList.contains('active')) {
                this.render();
            }
            
            return true; // Use this to trigger block re-render
        }
        return false;
    },

    // V65: Start editing column title
    startEditColumnTitle: function(colId, titleEl) {
        var self = this;
        var col = this.activeBoard.columns.find(function(c) { return c.id === colId; });
        if (!col) return;
        
        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'kanban-col-edit-' + colId; // V65: Fix A11y
        input.name = 'kanban-col-edit-' + colId;
        input.className = 'kanban-col-title-edit';
        input.value = col.title;
        
        titleEl.innerHTML = '';
        titleEl.appendChild(input);
        input.focus();
        input.select();
        
        var saveEdit = function() {
            var newTitle = input.value.trim();
            if (newTitle && newTitle !== col.title) {
                self.renameColumn(colId, newTitle);
            } else {
                self.render();
            }
        };
        
        input.onblur = saveEdit;
        input.onkeydown = function(e) {
            if (e.key === 'Enter') {
                input.blur();
            } else if (e.key === 'Escape') {
                self.render();
            }
        };
    },

    showPlaceholder: function (list, y) {
        this.cleanupPlaceholders();
        var placeholder = document.createElement('div');
        placeholder.className = 'kanban-placeholder';
        
        var cards = Array.from(list.querySelectorAll('.kanban-card:not(.dragging)'));
        var nextCard = cards.find(c => {
            var rect = c.getBoundingClientRect();
            return y < rect.top + rect.height / 2;
        });

        if (nextCard) list.insertBefore(placeholder, nextCard);
        else list.appendChild(placeholder);
    },

    cleanupPlaceholders: function () {
        document.querySelectorAll('.kanban-placeholder').forEach(p => p.remove());
    },

    // V67: Notify other systems of changes to ensure HUD sync
    syncPage: function() {
        if (typeof Notes !== 'undefined' && Notes.activeNoteId) {
             var note = NOTES.find(function(n) { return n.id === Notes.activeNoteId; });
             if (!note) return;
             
             if (Notes.isPreviewMode) {
                 var preview = document.getElementById('note-preview');
                 if (preview) {
                     // Sync content first to get the latest board state tokens if needed
                     if (typeof PageManager !== 'undefined') PageManager.syncContent(note.id);
                     preview.innerHTML = Notes.renderMarkdown(note.content || '');
                 }
             } else {
                 if (typeof BlockEditor !== 'undefined') {
                     BlockEditor.render(note.id, true); // true = skip focus
                 }
             }
        }
    },

    // V65: Add card
    addCard: function (colId, content) {
        if (!this.activeBoard) return;
        var col = this.activeBoard.columns.find(function (c) { return c.id === colId; });
        if (!col) return;

        col.cards.push({
            id: 'card_' + Date.now(),
            content: content,
            created: Date.now()
        });

        this.activeBoard.modified = Date.now();
        saveData();
        this.syncPage(); // Real-time HUD Sync
        this.render();
    },

    // V65: Update card content
    updateCard: function(cardId, colId, newContent) {
        if (!this.activeBoard) return;
        var col = this.activeBoard.columns.find(function(c) { return c.id === colId; });
        if (!col) return;
        
        var card = col.cards.find(function(c) { return c.id === cardId; });
        if (!card) return;
        
        card.content = newContent;
        card.modified = Date.now();
        this.activeBoard.modified = Date.now();
        saveData();
        this.syncPage(); // Real-time HUD Sync
        this.render();
    },

    // V67: Advance card to next column (HUD helper)
    advanceCard: function(cardId, boardId) {
        var board = boardId ? BOARDS.find(function(b) { return b.id === boardId; }) : this.activeBoard;
        if (!board) return;
        
        var fromCol = null;
        var toCol = null;
        
        for (var i = 0; i < board.columns.length; i++) {
            var col = board.columns[i];
            var cardIdx = col.cards.findIndex(function(c) { return c.id === cardId; });
            if (cardIdx !== -1) {
                fromCol = col;
                toCol = board.columns[i + 1];
                break;
            }
        }
        
        if (fromCol && toCol) {
            // Use moveCard logic locally if it's the right board
            var cardIdx = fromCol.cards.findIndex(function(c) { return c.id === cardId; });
            var card = fromCol.cards.splice(cardIdx, 1)[0];
            toCol.cards.push(card);
            board.modified = Date.now();
            saveData();
            this.syncPage(); // Real-time HUD Sync
            if (board === this.activeBoard) this.render();
            return true;
        }
        return false;
    },

    // V65: Delete card
    deleteCard: function(cardId, colId) {
        if (!this.activeBoard) return;
        var col = this.activeBoard.columns.find(function(c) { return c.id === colId; });
        if (!col) return;
        
        var cardIdx = col.cards.findIndex(function(c) { return c.id === cardId; });
        if (cardIdx === -1) return;
        
        col.cards.splice(cardIdx, 1);
        this.activeBoard.modified = Date.now();
        saveData();
        this.syncPage(); // Real-time HUD Sync
        this.render();
    },

    moveCard: function (cardId, fromColId, toColId, skipRender) {
        if (!this.activeBoard) return;
        var fromCol = this.activeBoard.columns.find(function (c) { return c.id === fromColId; });
        var toCol = this.activeBoard.columns.find(function (c) { return c.id === toColId; });
        if (!fromCol || !toCol) return;

        var cardIdx = fromCol.cards.findIndex(function (c) { return c.id === cardId; });
        if (cardIdx === -1) return;

        var card = fromCol.cards.splice(cardIdx, 1)[0];
        toCol.cards.push(card);

        this.activeBoard.modified = Date.now();
        saveData();
        this.syncPage(); // Real-time HUD Sync
        if (!skipRender) this.render();
    },

    // V65: Add new column
    addColumn: function(title) {
        if (!this.activeBoard) return;
        
        this.activeBoard.columns.push({
            id: 'col_' + Date.now(),
            title: title || 'NEW_COLUMN',
            cards: []
        });
        
        this.activeBoard.modified = Date.now();
        saveData();
        this.syncPage(); // Real-time HUD Sync
        this.render();
    },

    // V65: Rename column
    renameColumn: function(colId, newTitle) {
        if (!this.activeBoard) return;
        var col = this.activeBoard.columns.find(function(c) { return c.id === colId; });
        if (!col) return;
        
        col.title = newTitle;
        this.activeBoard.modified = Date.now();
        saveData();
        this.syncPage(); // Real-time HUD Sync
        this.render();
    },

    // V65: Delete column
    deleteColumn: function(colId) {
        if (!this.activeBoard) return;
        var self = this;
        var col = this.activeBoard.columns.find(function(c) { return c.id === colId; });
        if (!col) return;
        
        var doDelete = function() {
            var colIdx = self.activeBoard.columns.findIndex(function(c) { return c.id === colId; });
            if (colIdx === -1) return;
            
            self.activeBoard.columns.splice(colIdx, 1);
            self.activeBoard.modified = Date.now();
            saveData();
            self.syncPage(); // Real-time HUD Sync
            self.render();
        };
        
        // Confirm if column has cards
        if (col.cards.length > 0) {
            showConfirmModal(
                'DELETE_COLUMN',
                'Delete column "' + col.title + '"?<br><span style="color:#666">Contains ' + col.cards.length + ' cards that will be lost.</span>',
                doDelete,
                null,
                'DELETE'
            );
        } else {
            doDelete();
        }
    }

};


/* =========================================
   PHASE 6: SMART TASK AGGREGATOR
   Cross-note task synthesis
   ========================================= */
var TaskAggregator = {
    active: false,

    getAllTasks: function () {
        var tasks = [];
        NOTES.forEach(function (note) {
            if (!note.blocks) return;
            note.blocks.forEach(function (block) {
                if (block.type === 'task') {
                    tasks.push({
                        blockId: block.id,
                        pageId: note.id,
                        pageTitle: note.title,
                        content: block.content,
                        checked: block.checked,
                        created: note.created
                    });
                }
            });
        });

        // Sort: unchecked first, then by created date
        return tasks.sort(function (a, b) {
            if (a.checked !== b.checked) return a.checked ? 1 : -1;
            return b.created - a.created;
        });
    },

    toggle: function () {
        this.active = !this.active;
        var btn = document.getElementById('master-tasks-btn');
        if (btn) btn.classList.toggle('active', this.active);

        if (this.active) {
            this.render();
        } else {
            if (Notes.activeNoteId) Notes.open(Notes.activeNoteId);
        }
    },

    render: function () {
        var container = document.getElementById('block-editor');
        if (!container) return;

        container.innerHTML = '<div class="aggregator-header">Task Manager</div>';
        
        var tasks = this.getAllTasks();
        if (tasks.length === 0) {
            container.innerHTML += '<div class="no-tasks">NO_ACTIVE_THREADS_FOUND_IN_WORKSPACE.</div>';
            return;
        }

        var self = this;
        var currentSection = '';
        var sectionEl = null;

        tasks.forEach(function (task) {
            if (task.pageTitle !== currentSection) {
                currentSection = task.pageTitle;
                var header = document.createElement('div');
                header.className = 'task-agg-section-header';
                header.textContent = currentSection.toUpperCase();
                header.onclick = function() { self.active = false; Notes.open(task.pageId); };
                container.appendChild(header);
            }

            var item = document.createElement('div');
            item.className = 'task-agg-item' + (task.checked ? ' completed' : '');
            
            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = task.checked;
            checkbox.className = 'task-checkbox-inline';
            checkbox.onchange = function() {
                PageManager.updateBlock(task.pageId, task.blockId, { checked: checkbox.checked, completedAt: checkbox.checked ? Date.now() : null }); // V10.3: Add completedAt timestamp
                PageManager.syncContent(task.pageId);
                item.classList.toggle('completed', checkbox.checked);
            };

            var labelWrapper = document.createElement('div');
            labelWrapper.style.flex = '1';

            var label = document.createElement('div');
            label.textContent = task.content || '(Empty Task)';
            label.className = 'task-text';
            if (!task.content) label.style.color = 'var(--dim-color)';
            
            var meta = document.createElement('div');
            meta.className = 'task-card-meta';
            meta.style.color = 'var(--secondary-color)';
            meta.style.fontSize = '0.65rem';
            
            var createdStr = task.createdAt ? new Date(task.createdAt).toLocaleDateString() : 'UNKNOWN';
            var metaText = 'Created: ' + createdStr;
            if (task.checked && task.completedAt) {
                metaText += ' | Completed: ' + new Date(task.completedAt).toLocaleDateString();
            }
            meta.textContent = metaText;

            labelWrapper.appendChild(label);
            labelWrapper.appendChild(meta);

            item.appendChild(checkbox);
            item.appendChild(labelWrapper);
            container.appendChild(item);
        });

        // Disable contenteditable for this view
        container.contentEditable = 'false';
    }
};

var Notes = {
    activeNoteId: null,
    saveTimeout: null,
    selectedNotes: [], // V3.5: Multi-select for batch delete
    isSelectionMode: false,
    expandedFolders: [], // V3.9: Track open folders
    graphLayout: {}, // V13.0: Store node positions {id: {x, y}}
    
    // V67: Deep Link Support
    openByTitle: function(title) {
        if (!title) return false;
        var note = NOTES.find(function(n) { return (n.title || 'Untitled').toLowerCase() === title.toLowerCase(); });
        if (note) {
            this.open(note.id);
            return true;
        }
        return false;
    },

    init: function () {
        // Load persistent folder state
        try {
            var stored = localStorage.getItem('OPERATOR_EXPANDED_FOLDERS');
            if (stored) this.expandedFolders = JSON.parse(stored);

            var layout = localStorage.getItem('VINLAND_GRAPH_LAYOUT');
            if (layout) this.graphLayout = JSON.parse(layout);
        } catch (e) {
            this.expandedFolders = [];
            this.graphLayout = {};
        }

        // V15.0: Run Schema Migrations
        if (typeof migrateNotesToPathSchema === 'function') migrateNotesToPathSchema();
        if (typeof migrateNotesToBlockSchema === 'function') migrateNotesToBlockSchema();

        // Initialize Block-Based Architecture
        if (typeof BlockEditor !== 'undefined') BlockEditor.init('block-editor');
        if (typeof SlashMenu !== 'undefined') SlashMenu.init();

        this.bindEvents();
    },

    bindEvents: function () {
        // Sidebar Search
        var search = document.getElementById('notes-search');
        if (search) {
            search.addEventListener('input', function (e) {
                Notes.renderSidebar(e.target.value);
            });
        }

        // New Folder Button
        var addFolder = document.getElementById('add-folder-btn-sidebar');
        if (addFolder) {
            addFolder.addEventListener('click', function () {
                var modal = document.getElementById('folder-create-modal');
                if (modal && modal.classList.contains('active')) {
                    Notes.hideFolderModal();
                } else {
                    Notes.showFolderModal();
                }
            });
        }

        // Folder Modal Events
        var folderModalConfirm = document.getElementById('folder-modal-confirm');
        if (folderModalConfirm) {
            folderModalConfirm.addEventListener('click', function () {
                Notes.createNewFolder();
            });
        }

        var folderModalCancel = document.getElementById('folder-modal-cancel');
        if (folderModalCancel) {
            folderModalCancel.addEventListener('click', function () {
                Notes.hideFolderModal();
            });
        }

        var folderModalClose = document.getElementById('folder-modal-close');
        if (folderModalClose) {
            folderModalClose.addEventListener('click', function () {
                Notes.hideFolderModal();
            });
        }

        // V63.4: ESC key closes folder modal FIRST (priority over other modals)
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                var folderModal = document.getElementById('folder-create-modal');
                if (folderModal && folderModal.classList.contains('active')) {
                    e.stopPropagation();
                    e.preventDefault();
                    Notes.hideFolderModal();
                    return; // V63.4: Stop here - don't close parent modal
                }
            }
        }, true); // Use capture phase to run BEFORE other ESC handlers

        // V63.4: Click-out on overlay closes folder modal FIRST
        var modalOverlay = document.getElementById('modal-overlay');
        if (modalOverlay) {
            modalOverlay.addEventListener('click', function(e) {
                if (e.target === modalOverlay) {
                    var folderModal = document.getElementById('folder-create-modal');
                    if (folderModal && folderModal.classList.contains('active')) {
                        e.stopPropagation();
                        e.preventDefault();
                        Notes.hideFolderModal();
                        return; // V63.4: Stop here - don't close parent modal
                    }
                }
            }, true); // Use capture phase
        }

        // PHASE 9: Graph View Events
        var openGraphBtn = document.getElementById('open-graph-btn');
        if (openGraphBtn) {
            openGraphBtn.addEventListener('click', function () {
                // V59: Toggle graph modal instead of just opening
                var graphModal = document.getElementById('graph-modal');
                if (graphModal && graphModal.classList.contains('active')) {
                    Notes.closeGraph();
                } else {
                    Notes.openGraph();
                }
            });
        }

        var graphModalClose = document.getElementById('graph-modal-close');
        if (graphModalClose) {
            graphModalClose.addEventListener('click', function () {
                Notes.closeGraph();
            });
        }

        var graphSearch = document.getElementById('graph-search');
        if (graphSearch) {
            graphSearch.addEventListener('input', function () {
                Notes.renderGraph(); // Re-render for fitering
            });
        }

        // Tags Section Toggle
        var tagsToggle = document.getElementById('tags-header-toggle');
        if (tagsToggle) {
            tagsToggle.addEventListener('click', function () {
                var section = document.getElementById('sidebar-tags-section');
                if (section) section.classList.toggle('collapsed');
            });
        }

        // Sidebar Add Button
        var addBtn = document.getElementById('add-note-btn-sidebar');
        if (addBtn) {
            addBtn.addEventListener('click', function () {
                // V63.2: Prevent infinite tabs logic
                if (typeof Notes !== 'undefined' && Notes.activeNoteId) {
                    var currentNote = NOTES.find(n => n.id === Notes.activeNoteId);
                    if (currentNote && (!currentNote.title || currentNote.title === 'Untitled' || currentNote.title.trim() === '')) {
                        showNotification('Please name your current note first');
                        document.getElementById('active-note-title').focus();
                        return;
                    }
                }
                
                // V60: Create note in current folder
                var currentNote = NOTES.find(n => n.id === Notes.activeNoteId);
                var currentPath = currentNote ? currentNote.path : '/';
                Notes.create(null, currentPath);
            });
        }

        // V15.1: New Board Button
        var addBoardBtn = document.getElementById('add-board-btn-sidebar');
        if (addBoardBtn) {
            addBoardBtn.addEventListener('click', function () {
                var board = KanbanManager.createBoard('New Board');
                KanbanManager.open(board.id);
                Notes.renderSidebar();
            });
        }

        // V15.1: Kanban Close
        var kanbanClose = document.getElementById('kanban-modal-close-btn');
        if (kanbanClose) {
            kanbanClose.addEventListener('click', function () {
                KanbanManager.close();
            });
        }
        var quickNotesHeader = document.getElementById('quick-notes-panel-header');
        if (quickNotesHeader) {
            quickNotesHeader.addEventListener('click', function () {
                // V15.0: Use modern Notes.open to ensure sidebar and content are populated
                if (Notes.activeNoteId) {
                    Notes.open(Notes.activeNoteId);
                } else {
                    Notes.open(); // Fallback to most recent or create
                }
            });
        }

        // V3.5: Daily Note Button
        var dailyBtn = document.getElementById('daily-note-btn');
        if (dailyBtn) {
            dailyBtn.addEventListener('click', function () {
                Notes.openDailyNote();
            });
        }

        var taskListBtn = document.getElementById('master-tasks-btn');
        if (taskListBtn) {
            taskListBtn.addEventListener('click', function () {
                if (typeof TaskAggregator !== 'undefined') TaskAggregator.toggle();
            });
        }

        // V3.5: Multi-select Buttons
        var selectBtn = document.getElementById('selection-mode-btn');
        if (selectBtn) {
            selectBtn.addEventListener('click', function () {
                Notes.toggleSelectionMode();
            });
        }

        // Reset Preview Toggle visibility (hidden in ALL TASKS)
        var toggleBtn = document.getElementById('preview-toggle');
        if (toggleBtn) toggleBtn.style.display = 'inline-block';

        // V30: Force Block Editor
        // V3.9: Note Editor Maximize & Help
        var noteMaxBtn = document.getElementById('note-maximize-btn');
        if (noteMaxBtn) {
            noteMaxBtn.addEventListener('click', function () {
                Notes.toggleMaximize();
            });
        }

        var noteHelpBtn = document.getElementById('note-help-btn');
        if (noteHelpBtn) {
            noteHelpBtn.addEventListener('click', function () {
                Notes.showHelp();
            });
        }

        var noteHelpClose = document.getElementById('note-help-close');
        if (noteHelpClose) {
            noteHelpClose.addEventListener('click', function () {
                Notes.hideHelp();
            });
        }

        // Note: Individual listeners consolidated below in the Editor Inputs section

        // V3.5: Task Checkbox Logic (Delegation)
        var notePreview = document.getElementById('note-preview');
        if (notePreview) {
            notePreview.addEventListener('change', function (e) {
                if (e.target.classList.contains('task-checkbox')) {
                    var index = parseInt(e.target.getAttribute('data-task-index'), 10);
                    var activeNote = NOTES.find(function (n) { return n.id === Notes.activeNoteId; });

                    if (activeNote) {
                        // V63.5: If using block editor, update the block directly
                        if (activeNote.blocks && activeNote.blocks.length > 0) {
                            var taskBlocks = activeNote.blocks.filter(function(b) { return b.type === 'task'; });
                            if (taskBlocks[index]) {
                                // Toggle the block state
                                taskBlocks[index].checked = !taskBlocks[index].checked;
                                activeNote.modified = Date.now();
                                
                                // Sync content and save
                                PageManager.syncContent(activeNote.id);
                                
                                // V63.5: Visual feedback is already handled by checkbox DOM state change
                                // The checkbox's visual :checked state updates automatically on click
                                // No need to re-render the entire preview
                            }
                        } else if (activeNote.content) {
                            // Legacy: Line-based replacement for raw content
                            var lines = activeNote.content.split('\n');
                            var taskCounter = 0;

                            for (var i = 0; i < lines.length; i++) {
                                var match = lines[i].match(/^(\s*)- \[( |x)\]/);
                                if (match) {
                                    if (taskCounter === index) {
                                        var indent = match[1];
                                        var state = match[2];
                                        var newState = (state === ' ') ? 'x' : ' ';
                                        lines[i] = lines[i].replace(/^(\s*)- \[( |x)\]/, indent + '- [' + newState + ']');
                                        break;
                                    }
                                    taskCounter++;
                                }
                            }

                            activeNote.content = lines.join('\n');
                            saveData();
                        }
                    }
                }
            });
        }

        // V3.5: Daily Note Shortcut (Cmd+J)
        document.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'j' && isNotesOpen) {
                e.preventDefault();
                Notes.openDailyNote();
            }
        });

        var deleteSelBtn = document.getElementById('delete-selected-btn');
        if (deleteSelBtn) {
            deleteSelBtn.addEventListener('click', function () {
                Notes.deleteSelected();
            });
        }

        // Wiki-Link Click Handling
        var preview = document.getElementById('note-preview');
        if (preview) {
            preview.addEventListener('click', function (e) {
                if (e.target.classList.contains('internal-link')) {
                    var title = e.target.getAttribute('data-link');
                    Notes.openByTitle(title);
                }
                
                // V65: Kanban Preview Click Handling
                var kanbanPreview = e.target.closest('.kanban-preview-embed');
                if (kanbanPreview) {
                    var boardId = kanbanPreview.getAttribute('data-board-id');
                    if (boardId) KanbanManager.open(boardId);
                }
            });
        }

        // V3.5: Preview Toggle
        var previewBtn = document.getElementById('preview-toggle');
        if (previewBtn) {
            previewBtn.addEventListener('click', function () {
                Notes.togglePreview();
            });
        }
        
        // V59: Sidebar Toggle Button
        var sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
        if (sidebarToggleBtn) {
            sidebarToggleBtn.addEventListener('click', function () {
                var sidebar = document.querySelector('.notes-sidebar');
                if (sidebar) sidebar.classList.toggle('collapsed');
            });
        }

        // V3.5: Pin Button
        var pinBtn = document.getElementById('pin-note-btn');
        if (pinBtn) {
            pinBtn.addEventListener('click', function () {
                Notes.togglePin();
            });
        }

        // V3.5: Keyboard Shortcuts
        document.addEventListener('keydown', function (e) {
            var modal = document.getElementById('note-editor-modal');
            var isNotesOpen = modal && modal.classList.contains('active');

            // Ctrl/Cmd + N = New note (only when notes modal is open)
            if ((e.ctrlKey || e.metaKey) && e.key === 'n' && isNotesOpen) {
                e.preventDefault();
                // V63.2: Prevent infinite tabs logic
                if (typeof Notes !== 'undefined' && Notes.activeNoteId) {
                    var currentNote = NOTES.find(n => n.id === Notes.activeNoteId);
                    if (currentNote && (!currentNote.title || currentNote.title === 'Untitled' || currentNote.title.trim() === '')) {
                        showNotification('Please name your current note first');
                        document.getElementById('active-note-title').focus();
                        return;
                    }
                }
                Notes.create();
            }

            // Ctrl/Cmd + S = Force save (only when notes modal is open)
            if ((e.ctrlKey || e.metaKey) && e.key === 's' && isNotesOpen) {
                e.preventDefault();
                Notes.save();
                showNotification('Note saved');
            }

            // V57: Ctrl/Cmd + E = Toggle Editor/Preview (only when notes modal is open)
            if ((e.ctrlKey || e.metaKey) && e.key === 'e' && isNotesOpen) {
                e.preventDefault();
                Notes.togglePreview();
            }
            
            // V57: Ctrl/Cmd + \\ = Toggle Sidebar (only when notes modal is open)
            if ((e.ctrlKey || e.metaKey) && e.key === '\\' && isNotesOpen) {
                e.preventDefault();
                var sidebar = document.querySelector('.notes-sidebar');
                if (sidebar) sidebar.classList.toggle('collapsed');
            }


            // V63.4: Legacy shortcuts removed to favor initKeyboardShortcuts central logic

            // V65: Kanban ESC is handled by ModalManager.init() - removed duplicate handler

            if (e.key === 'Escape' && isNotesOpen) {
                var searchInput = document.getElementById('notes-search');
                if (document.activeElement === searchInput) {
                    e.preventDefault();
                    e.stopPropagation();
                    searchInput.value = '';
                    Notes.activeTagFilter = null;
                    Notes.renderSidebar();
                    searchInput.blur();
                    return;
                }
            }
        });

        // Editor Inputs (Auto-Save + Tags)
        var titleInput = document.getElementById('active-note-title');
        var contentInput = document.getElementById('active-note-content');

        [titleInput, contentInput].forEach(function (el) {
            if (el) {
                el.addEventListener('input', function () {
                    // Standard Autosave - Logic Removed to Stop Duplication
                    Notes.autoSave();
                    Notes.updateTags();
                    
                    // V63.2: Sync title changes to TabManager
                    if (el.id === 'active-note-title' && typeof TabManager !== 'undefined') {
                        TabManager.updateActiveTitle(el.value || 'Untitled');
                    }
                });

                // V3.5: Editor Keyboard Shortcuts (Consolidated & Re-Routed)
                if (el.id === 'active-note-content') {
                    el.addEventListener('keydown', function (e) {
                        var key = e.key.toLowerCase();
                        var meta = e.ctrlKey || e.metaKey;

                        if (meta) {
                            // 1. Checkbox Toggle (CMD + L)
                            if (key === 'l' && !e.shiftKey) {
                                e.preventDefault();
                                e.stopImmediatePropagation();
                                var cursor = this.selectionStart;
                                var text = this.value;
                                var lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
                                var lineEnd = text.indexOf('\n', cursor);
                                if (lineEnd === -1) lineEnd = text.length;

                                var currentLine = text.substring(lineStart, lineEnd);
                                var newLine = '';
                                var taskMatch = currentLine.match(/^(\s*)- \[( |x)\] (.*)/);

                                if (taskMatch) {
                                    var indent = taskMatch[1];
                                    var state = taskMatch[2];
                                    var rest = taskMatch[3];
                                    newLine = (state === ' ') ? indent + '- [x] ' + rest : indent + rest;
                                } else {
                                    newLine = '- [ ] ' + currentLine;
                                }

                                this.value = text.substring(0, lineStart) + newLine + text.substring(lineEnd);
                                this.selectionStart = this.selectionEnd = lineStart + newLine.length;
                                Notes.autoSave();
                                return;
                            }

                            // 2. Styling Shortcuts (CMD + B, I, U, K, SHIFT+L)
                            // b=bold, i=italic, u=underline, k=link, l=wikilink (shifted)
                            if (['b', 'i', 'u', 'k'].includes(key) || (key === 'l' && e.shiftKey)) {
                                e.preventDefault();
                                e.stopImmediatePropagation();
                                Notes.processEditorShortcut(key);
                                return;
                            }
                        }
                    }, true); // CAPTURE PHASE - Intercept before browser defaults
                }
            }
        });

        // Delete Button
        var delBtn = document.getElementById('delete-note-btn');
        if (delBtn) {
            delBtn.addEventListener('click', function () {
                showConfirmModal(
                    'DELETE NOTE',
                    'This note will be permanently deleted. Continue?',
                    function () { Notes.delete(); }
                );
            });
        }
        
        // V59: Path input change handler - updates note folder
        var pathInput = document.getElementById('note-current-path');
        if (pathInput) {
            pathInput.addEventListener('change', function () {
                var newPath = pathInput.value.trim();
                // Ensure path starts with /
                if (!newPath.startsWith('/')) newPath = '/' + newPath;
                // Normalize path (remove trailing slash, handle /root -> /)
                if (newPath === '/root') newPath = '/';
                newPath = newPath.replace(/\/+$/, '') || '/';
                
                var note = NOTES.find(n => n.id === Notes.activeNoteId);
                if (note && note.path !== newPath) {
                    note.path = newPath;
                    Notes.save();
                    Notes.renderSidebar(); // Update sidebar to reflect new location
                    showNotification('Moved to ' + (newPath === '/' ? '/root' : newPath));
                }
            });
        }

        // V3.5: Multi-Tab Synchronization
        window.addEventListener('storage', function (e) {
            if (e.key === 'OPERATOR_NOTES_V2') {
                try {
                    var newNotes = JSON.parse(e.newValue);
                    if (newNotes && Array.isArray(newNotes)) {
                        NOTES = newNotes;

                        // 1. Refresh Sidebar to show new titles/notes
                        Notes.renderSidebar();

                        // 2. If active note is open, check if it was modified externally
                        if (Notes.activeNoteId) {
                            var activeNote = NOTES.find(n => n.id === Notes.activeNoteId);
                            if (activeNote) {
                                var contentEl = document.getElementById('active-note-content');
                                if (!contentEl) return; // V63.4: Guard against missing element in block-mode
                                var oldContent = contentEl.value;

                                // Sync View Mode (Preview/Edit)
                                var remoteMode = activeNote.viewMode || 'edit';
                                var currentMode = Notes.isPreviewMode ? 'preview' : 'edit';

                                if (remoteMode !== currentMode) {
                                    Notes.isPreviewMode = (remoteMode === 'preview');
                                    // Update UI for mode change
                                    var preview = document.getElementById('note-preview');
                                    var textarea = document.getElementById('active-note-content');
                                    var toggleBtn = document.getElementById('preview-toggle');

                                    if (Notes.isPreviewMode) {
                                        if (preview) preview.classList.add('active');
                                        if (textarea) textarea.style.display = 'none';
                                        if (toggleBtn) { toggleBtn.textContent = 'EDIT'; toggleBtn.classList.add('active'); }
                                        shouldUpdatePreview = true;
                                    } else {
                                        if (preview) preview.classList.remove('active');
                                        if (textarea) textarea.style.display = '';
                                        if (toggleBtn) { toggleBtn.textContent = 'PREVIEW'; toggleBtn.classList.remove('active'); }
                                    }
                                }

                                // Update Title independently
                                var titleEl = document.getElementById('active-note-title');
                                if (titleEl) {
                                    var oldTitle = titleEl.value;
                                    if (activeNote.title !== oldTitle) {
                                        titleEl.value = activeNote.title || '';
                                    }
                                }

                                // Update Content independently
                                if (activeNote.content !== oldContent || activeNote.blocks) {
                                    if (contentEl) contentEl.value = activeNote.content || activeNote.text || '';
                                    shouldUpdatePreview = true;

                                    // V63.4: Sync block editor from other tabs
                                    if (typeof BlockEditor !== 'undefined' && activeNote.blocks) {
                                        BlockEditor.render(Notes.activeNoteId, true); // true = skip focus
                                    }

                                    // Update timestamp
                                    var d = new Date(activeNote.modified || Date.now());
                                    var ts = document.getElementById('note-timestamp');
                                    if (ts) ts.textContent = 'LAST EDITED: ' + d.toLocaleString();

                                    // Update word count and tags
                                    Notes.updateWordCount();
                                    Notes.updateTags();
                                }

                                // Sync Pin Status
                                var pinBtn = document.getElementById('pin-note-btn');
                                if (pinBtn) {
                                    if (activeNote.pinned) {
                                        pinBtn.classList.add('active');
                                        pinBtn.textContent = 'UNPIN';
                                    } else {
                                        pinBtn.classList.remove('active');
                                        pinBtn.textContent = 'PIN';
                                    }
                                }

                                // Refresh preview if needed
                                if (Notes.isPreviewMode && shouldUpdatePreview) {
                                    var preview = document.getElementById('note-preview');
                                    if (preview) preview.innerHTML = Notes.renderMarkdown(activeNote.content);
                                }

                            } else {
                                // Note was deleted in another tab
                                Notes.activeNoteId = null;
                                if (NOTES.length > 0) {
                                    // V3.5: Switch to most recent valid note
                                    var sorted = NOTES.slice().sort(function (a, b) {
                                        if (a.pinned && !b.pinned) return -1;
                                        if (!a.pinned && b.pinned) return 1;
                                        return (b.modified || 0) - (a.modified || 0);
                                    });
                                    Notes.open(sorted[0].id);
                                } else {
                                    // No notes left, clear editor
                                    if (document.getElementById('active-note-title')) document.getElementById('active-note-title').value = '';
                                    if (document.getElementById('active-note-content')) document.getElementById('active-note-content').value = '';
                                    if (document.getElementById('note-timestamp')) document.getElementById('note-timestamp').textContent = '';
                                    if (document.getElementById('note-preview')) document.getElementById('note-preview').innerHTML = '';
                                    
                                    var editor = document.getElementById('block-editor');
                                    if (editor) editor.innerHTML = '';
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.error('Sync Error:', err);
                }
            } else if (e.key === 'OPERATOR_EXPANDED_FOLDERS') {
                try {
                    var expanded = JSON.parse(e.newValue);
                    if (Array.isArray(expanded)) {
                        Notes.expandedFolders = expanded;
                        Notes.renderSidebar();
                    }
                } catch (err) { }
            }
        });

        // V65: Global Preview Interactions
        // Use delegation to handle interactive elements within generated HTML
        var previewContainer = document.getElementById('note-preview');
        if (previewContainer) {
            previewContainer.addEventListener('click', function(e) {
                // Kanban Interactions
                if (e.target.classList.contains('kanban-hud-item')) {
                    var cardId = e.target.getAttribute('data-card-id');
                    var boardId = e.target.getAttribute('data-board-id');
                    
                    if (cardId && boardId) {
                        e.stopPropagation();
                        e.preventDefault();
                        
                        if (e.altKey) {
                            // Alt+Click = Open Board
                            KanbanManager.open(boardId);
                        } else {
                            // Click = Advance Card
                            // Visual feedback
                            e.target.style.textDecoration = 'line-through';
                            e.target.style.opacity = '0.5';
                            
                            setTimeout(function() {
                                var advanced = KanbanManager.advanceCard(cardId);
                                if (advanced) {
                                    // Refresh preview since content changed
                                    if (Notes.activeNoteId) {
                                        Notes.open(Notes.activeNoteId); // Re-opens to refresh content/preview
                                    }
                                } else {
                                    e.target.style.textDecoration = 'none';
                                    e.target.style.opacity = '1';
                                }
                            }, 200);
                        }
                    }
                }
            });
        }
    },

    // V47: Open Virtual "ALL TASKS" Note
    openAllTasks: function() {
        if (this.activeNoteId) this.save(true); // Save current note first
        this.activeNoteId = null; // No active note preventing auto-save overwrite
        this.activePageId = null;
        
        // Clear editor state
        var editor = document.getElementById('block-editor');
        var preview = document.getElementById('note-preview');
        var toggleBtn = document.getElementById('preview-toggle');
        
        if (preview) {
            preview.classList.remove('active');
            preview.innerHTML = '';
        }
        if (editor) {
            editor.style.display = 'block';
            editor.innerHTML = ''; // Clear for Task Manager
        }
        if (toggleBtn) {
            toggleBtn.textContent = 'PREVIEW';
            toggleBtn.style.display = 'none'; // Hide preview toggle for virtual note
        }
        
        // Render Task Manager
        if (typeof TaskAggregator !== 'undefined') {
            TaskAggregator.render();
        } else {
            if (editor) editor.innerHTML = '<div style="padding:20px;color:#f44">Task Aggregator module not loaded.</div>';
        }
        
        // Update Sidebar UI
        var sidebarItems = document.querySelectorAll('.note-item, .file-tree-item');
        sidebarItems.forEach(i => i.classList.remove('active'));
    },

    open: function (noteId, skipFocus) {
        // V47: Ensure Preview Toggle is visible
        var toggleBtn = document.getElementById('preview-toggle');
        if (toggleBtn) toggleBtn.style.display = 'inline-block';
        
        // V63.4: PRIORITY CHECK - Clean up auto-created note if user opens different note
        if (this.autoCreatedNoteId && this.autoCreatedNoteId !== noteId) {
            var autoNote = NOTES.find(function (n) { return n.id === Notes.autoCreatedNoteId; });
            if (autoNote) {
                // Check if the auto-created note is still empty (user didn't type anything)
                var titleEmpty = !autoNote.title || autoNote.title.trim() === '';
                var contentEmpty = !autoNote.content || autoNote.content.trim() === '';
                var blocksEmpty = !autoNote.blocks || autoNote.blocks.length === 0 || 
                    (autoNote.blocks.length === 1 && (!autoNote.blocks[0].content || autoNote.blocks[0].content.trim() === ''));
                
                if (titleEmpty && contentEmpty && blocksEmpty) {
                    var autoNoteId = this.autoCreatedNoteId;
                    NOTES = NOTES.filter(function (n) { return n.id !== autoNoteId; });
                    saveData();
                    // V63.4: Set flag to prevent recursive note creation
                    this.isCleaningUpAutoNote = true;
                    if (typeof TabManager !== 'undefined') {
                        TabManager.closeTabById(autoNoteId);
                    }
                    this.isCleaningUpAutoNote = false;
                    this.renderSidebar();
                }
            }
            this.autoCreatedNoteId = null; // Clear flag regardless
        }
        
        // Auto-Delete Empty Notes Logic WITH TAB CLEANUP
        if (this.activeNoteId && this.activeNoteId !== noteId) {
            var current = NOTES.find(function (n) { return n.id === Notes.activeNoteId; });
            if (current) {
                // V63.4: Enhanced empty check - also verify block content
                var hasNoTitle = !current.title || current.title.trim() === '' || 
                    current.title === 'Untitled Note' || current.title === 'Untitled';
                var hasNoContent = !current.content || current.content.trim() === '';
                var hasNoBlocks = !current.blocks || current.blocks.length === 0;
                var hasOnlyEmptyBlock = current.blocks && current.blocks.length === 1 && 
                    (!current.blocks[0].content || current.blocks[0].content.trim() === '');
                
                var isEmpty = hasNoTitle && hasNoContent && (hasNoBlocks || hasOnlyEmptyBlock);

                if (isEmpty) {
                    var deletedId = Notes.activeNoteId;
                    NOTES = NOTES.filter(function (n) { return n.id !== Notes.activeNoteId; });
                    saveData();
                    if (this.saveTimeout) { clearTimeout(this.saveTimeout); this.saveTimeout = null; }
                    
                    // CRITICAL: Force cleanup of tab for THIS specific note
                    if (typeof TabManager !== 'undefined') {
                        TabManager.closeTabById(deletedId);
                    }
                    
                    this.renderSidebar();
                } else {
                    if (this.saveTimeout) { clearTimeout(this.saveTimeout); this.saveTimeout = null; this.save(); }
                }
            }
        }

        // Find note
        var note = NOTES.find(function (n) { return n.id === noteId; });
        if (!note && NOTES.length > 0) note = NOTES[0];
        if (!note) { this.create(); return; }

        this.activeNoteId = note.id;
        
        // V63.4: Only open tab if setting enabled
        if (CONFIG.notes_tabs_enabled !== false && typeof TabManager !== 'undefined') {
            TabManager.openTab(note.id, note.title || 'Untitled');
        }

        // V2 Migration: Ensure blocks exist
        if (!note.blocks || note.blocks.length === 0) {
            if (typeof PageManager !== 'undefined') {
                note.blocks = typeof parseContentToBlocks === 'function' ? parseContentToBlocks(note.content) : [];
                if (note.blocks.length === 0) PageManager.addBlock(note, 'p', '');
            }
        }

        // Populate Title
        var titleInput = document.getElementById('active-note-title');
        if (titleInput) titleInput.value = note.title || '';
        
        // --- CRITICAL FIX: UI SWITCHING ---
        var textarea = document.getElementById('active-note-content');
        var blockEditor = document.getElementById('block-editor');
        var preview = document.getElementById('note-preview');
        var toggleBtn = document.getElementById('preview-toggle');

        this.isPreviewMode = (note.viewMode === 'preview');

        if (this.isPreviewMode) {
            if (textarea) textarea.style.display = 'none';
            if (blockEditor) blockEditor.style.display = 'none';
            if (preview) {
                // Ensure content is synced before preview
                if (typeof PageManager !== 'undefined') PageManager.syncContent(note.id);
                preview.innerHTML = this.renderMarkdown(note.content || '');
                preview.classList.add('active');
                preview.style.display = 'block'; // V63.4: Explicitly show
            }
            if (toggleBtn) { toggleBtn.textContent = 'EDIT'; toggleBtn.classList.add('active'); }
        } else {
            if (preview) {
                preview.classList.remove('active');
                preview.style.display = 'none'; // V63.4: Explicitly hide
            }
            
            // BLOCK MODE ACTIVE: Hide legacy textarea, Show Block Editor
            if (textarea) textarea.style.display = 'none'; 
            if (blockEditor) {
                blockEditor.style.display = 'block';
                // V34: Do NOT set contentEditable on container - only blocks should be editable
            }
            
            if (toggleBtn) { toggleBtn.textContent = 'PREVIEW'; toggleBtn.classList.remove('active'); }
            
            // Render Blocks
            if (typeof BlockEditor !== 'undefined') {
                BlockEditor.render(note.id, skipFocus);
            }
        }

        // V63.2: Path input - use .value for input element
        var pathDisplay = document.getElementById('note-current-path');
        if (pathDisplay) {
            var displayPath = note.path === '/' ? '/root' : note.path;
            pathDisplay.value = displayPath;
        }

        var timestamp = document.getElementById('note-timestamp');
        if (timestamp) {
            var d = new Date(note.modified || Date.now());
            timestamp.textContent = 'LAST EDITED: ' + d.toLocaleString();
        }

        this.renderSidebar();
        this.updateWordCount();
        this.updateTags();

        // Pin Button State
        var pinBtn = document.getElementById('pin-note-btn');
        if (pinBtn) {
            if (note.pinned) {
                pinBtn.classList.add('active');
                pinBtn.textContent = 'UNPIN';
            } else {
                pinBtn.classList.remove('active');
                pinBtn.textContent = 'PIN';
            }
        }

        ModalManager.open('note-editor-modal');
    },

    create: function (initialTitle, initialPath) {
        var newNote = {
            id: 'note_' + Date.now(),
            title: initialTitle || '',
            content: '',
            path: sanitizePath(initialPath || '/'),  // NEW
            links: [],  // NEW
            created: new Date().getTime(),
            modified: new Date().getTime()
        };
        NOTES.unshift(newNote); // Add to top
        saveData();
        this.open(newNote.id);

        // Focus title
        setTimeout(function () {
            var el = document.getElementById('active-note-title');
            if (el) el.focus();
        }, 100);

        renderNotes(); // Update quick panel
    },

    processBatchDelete: function () {
        try {
            // Kill pending saves
            if (this.saveTimeout) {
                clearTimeout(this.saveTimeout);
                this.saveTimeout = null;
            }

            var targets = this.selectedNotes.slice();
            if (targets.length === 0) return;

            // ============================================
            // STEP 1: SNAPSHOT THE VISUAL ORDER
            // ============================================
            var visualOrder = NOTES.slice().sort(function (a, b) {
                if (a.pinned && !b.pinned) return -1;
                if (!a.pinned && b.pinned) return 1;
                return (b.modified || 0) - (a.modified || 0);
            });

            // ============================================
            // STEP 2: LOCATE THE ANCHOR (Current Active Note)
            // ============================================
            var anchorIndex = -1;
            var isAnchorBeingDeleted = false;

            if (this.activeNoteId) {
                anchorIndex = visualOrder.findIndex(function (n) { return n.id === Notes.activeNoteId; });
                isAnchorBeingDeleted = targets.indexOf(this.activeNoteId) !== -1;
            }

            // ============================================
            // STEP 3: DETERMINE THE TARGET (Adjacent Safe Note)
            // ============================================
            var targetNoteId = null;

            if (isAnchorBeingDeleted && anchorIndex >= 0) {
                // CASE A: Active note IS being deleted -> Find neighbor
                // RULE 1 (DOWN): Look below the anchor
                for (var i = anchorIndex + 1; i < visualOrder.length; i++) {
                    var candidate = visualOrder[i];
                    if (targets.indexOf(candidate.id) === -1) {
                        targetNoteId = candidate.id;
                        break;
                    }
                }

                // RULE 2 (UP): If nothing below, look above the anchor
                if (!targetNoteId) {
                    for (var i = anchorIndex - 1; i >= 0; i--) {
                        var candidate = visualOrder[i];
                        if (targets.indexOf(candidate.id) === -1) {
                            targetNoteId = candidate.id;
                            break;
                        }
                    }
                }
            } else if (!isAnchorBeingDeleted && this.activeNoteId) {
                // CASE B: Active note is SAFE -> Stay on it
                targetNoteId = this.activeNoteId;
            }

            // ============================================
            // EXECUTE: Delete from NOTES array
            // ============================================
            NOTES = NOTES.filter(function (n) { return targets.indexOf(n.id) === -1; });

            // ============================================
            // Reset selection state
            // ============================================
            this.selectedNotes = [];
            this.isSelectionMode = false;
            this.activeNoteId = null;

            // Clear editor
            var tEl = document.getElementById('active-note-title');
            var cEl = document.getElementById('active-note-content');
            if (tEl) tEl.value = '';
            if (cEl) cEl.value = '';

            // Save to localStorage
            saveData();

            // Update UI buttons
            var delBtn = document.getElementById('delete-selected-btn');
            var selBtn = document.getElementById('selection-mode-btn');
            if (delBtn) {
                delBtn.textContent = 'DELETE (0)';
                delBtn.style.display = 'none';
            }
            if (selBtn) {
                selBtn.textContent = 'SELECT';
                selBtn.classList.remove('active');
            }

            // Refresh sidebar
            this.renderSidebar();

            // ============================================
            // STEP 4: SWITCH TO TARGET NOTE
            // ============================================
            if (targetNoteId) {
                this.open(targetNoteId);
            } else if (NOTES.length > 0) {
                this.open(NOTES[0].id);
            } else {
                this.create('');
            }
        } catch (e) {
            console.error('Batch Delete Error:', e);
        }
    },

    deleteSelected: function () {
        if (!this.selectedNotes.length) return;

        var self = this;
        var count = this.selectedNotes.length;

        // Use dedicated modal to ensure ensuring binding
        if (typeof showDeleteConfirmModal === 'function') {
            showDeleteConfirmModal(count);
        } else {
            console.error('showDeleteConfirmModal missing, falling back');
            // Fallback (or just fail loud)
            alert('Error: Delete logic missing. Reload page.');
        }
    },

    delete: function () {
        if (!this.activeNoteId) return;

        // V3.5: Race Condition Protection
        if (this.saveTimeout) clearTimeout(this.saveTimeout);

        var idx = NOTES.findIndex(function (n) { return n.id === Notes.activeNoteId; });
        if (idx > -1) {
            // V3.5: Clean up multi-select state if this note was selected
            var selIdx = this.selectedNotes.indexOf(this.activeNoteId);
            if (selIdx !== -1) {
                this.selectedNotes.splice(selIdx, 1);
                // Update delete button text if visible
                var deleteBtn = document.getElementById('delete-selected-btn');
                if (deleteBtn) {
                    deleteBtn.textContent = 'DELETE (' + this.selectedNotes.length + ')';
                }
            }
            // V61: Capture path before deleting
            var deletedPath = NOTES[idx] ? (NOTES[idx].path || '/') : '/';
            
            NOTES.splice(idx, 1);
            saveData();
            this.activeNoteId = null;

            // V63.4: Open next note
            if (NOTES.length > 0) {
                // If Tabs are enabled, priority 1 is switching to another open tab
                var tabSwitched = false;
                if (CONFIG.notes_tabs_enabled !== false && typeof TabManager !== 'undefined' && TabManager.tabs.length > 0) {
                    // Find if there's any other tab
                    if (TabManager.currentIndex < TabManager.tabs.length) {
                        this.open(TabManager.tabs[TabManager.currentIndex].noteId);
                        tabSwitched = true;
                    } else if (TabManager.tabs.length > 0) {
                        TabManager.currentIndex = TabManager.tabs.length - 1;
                        this.open(TabManager.tabs[TabManager.currentIndex].noteId);
                        tabSwitched = true;
                    }
                }

                if (!tabSwitched) {
                    // Fallback: V61 Open next note preferring same folder, then parent folder
                    var sameFolder = NOTES.filter(n => n.path === deletedPath);
                    if (sameFolder.length > 0) {
                        sameFolder.sort((a, b) => (b.modified || 0) - (a.modified || 0));
                        this.open(sameFolder[0].id);
                    } else {
                        var parentPath = deletedPath.substring(0, deletedPath.lastIndexOf('/')) || '/';
                        var parentFolder = NOTES.filter(n => n.path === parentPath);
                        if (parentFolder.length > 0) {
                            parentFolder.sort((a, b) => (b.modified || 0) - (a.modified || 0));
                            this.open(parentFolder[0].id);
                        } else {
                            var sortedRemaining = NOTES.slice().sort(function (a, b) {
                                if (a.pinned && !b.pinned) return -1;
                                if (!a.pinned && b.pinned) return 1;
                                return (b.modified || 0) - (a.modified || 0);
                            });
                            this.open(sortedRemaining[0].id);
                        }
                    }
                }
            }
            else {
                // Clear inputs
                document.getElementById('active-note-title').value = '';
                document.getElementById('active-note-content').value = '';
                this.renderSidebar();
            }
        }
        renderNotes(); // Update quick panel
    },

    autoSave: function () {
        var status = document.getElementById('save-status');
        if (status) {
            status.textContent = 'SAVING...';
            status.classList.add('saving');
        }

        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(function () {
            Notes.save();
        }, 500); // Debounce
    },

    save: function () {
        if (!this.activeNoteId) return;
        var note = NOTES.find(function (n) { return n.id === Notes.activeNoteId; });
        if (!note) return;

        var titleInput = document.getElementById('active-note-title');
        var oldTitle = note.title;

        note.title = titleInput.value || 'Untitled';
        note.modified = new Date().getTime();

        // --- CRITICAL FIX: SOURCE OF TRUTH ---
        // Do NOT read from textarea. Sync from Blocks to Content String.
        if (typeof PageManager !== 'undefined') {
            PageManager.syncContent(this.activeNoteId);
        }

        if (oldTitle !== note.title) {
            try {
                saveData();
                this.renderSidebar();
                renderNotes();
            } catch (e) { console.error('Save Error (Title Sync):', e); }
        }
        
        try {
            saveData(); 
            this.updateAllTags();
        } catch (e) { console.error('Save Error (Content Sync):', e); }

        var status = document.getElementById('save-status');
        if (status) {
            status.textContent = 'SAVED';
            status.classList.remove('saving');
            status.classList.add('saved');
            setTimeout(function () { status.classList.remove('saved'); }, 2000);
        }

        // Link Tracking & Stats
        if (typeof updateNoteLinks === 'function') updateNoteLinks(this.activeNoteId);
        Notes.updateWordCount();
        
        var timestamp = document.getElementById('note-timestamp');
        if (timestamp) timestamp.textContent = 'LAST EDITED: ' + new Date().toLocaleString();
    },

    // V33: Alias for compatibility
    closeEditor: function () {
        closeNoteEditor();
    },

    // V3.5: Open Daily Note
    openDailyNote: function () {
        var today = new Date();
        var yyyy = today.getFullYear();
        var mm = String(today.getMonth() + 1).padStart(2, '0');
        var dd = String(today.getDate()).padStart(2, '0');
        var dateStr = yyyy + '-' + mm + '-' + dd;

        // Find existing note with this title
        var existing = NOTES.find(function (n) { return n.title === dateStr; });
        if (existing) {
            this.open(existing.id);
        } else {
            // V60: Create in current folder
            var currentNote = NOTES.find(n => n.id === this.activeNoteId);
            var currentPath = currentNote ? currentNote.path : '/';
            this.create(dateStr, currentPath);
        }
    },

    renderSidebar: function (query) {
        var sidebarList = document.getElementById('notes-list-sidebar');
        if (!sidebarList) return;

        sidebarList.innerHTML = '';

        // V63.4: ALL TASKS entry removed - Task Manager deprecated
        // Future: Will link to Task Modal instead

        // V3.9: Tree View Implementation
        var searchInput = document.getElementById('notes-search');
        var filterTerm = (query || (searchInput ? searchInput.value : '')).toLowerCase();

        var structure = buildDirectoryStructure(NOTES);

        if (filterTerm) {
            // FILTERED TREE VIEW
            if (typeof filterTreeStructure === 'function') {
                var result = filterTreeStructure(structure, filterTerm);

                if (!result._hasMatch) {
                    sidebarList.innerHTML = '<div style="padding: 20px; color: #666; font-size: 0.8rem; text-align: center;">QUERY_RESULT // NULL_SET</div>';
                } else {
                    // Render tree with expansion forced for matches
                    var tree = renderFileTree(result.structure, '', true);
                    sidebarList.appendChild(tree);
                }
            }
        } else {
            // STANDARD TREE VIEW
            var tree = renderFileTree(structure, '', false);
            sidebarList.appendChild(tree);
        }

        // V3.9: Add "Move to Root" Drop Target at bottom
        var rootDrop = document.createElement('div');
        rootDrop.innerHTML = '[ PURGE_GROUPING_DATA ]';
        rootDrop.style = 'margin: 20px 10px; padding: 15px; border: 1px dashed var(--dim-color); color: var(--dim-color); font-size: 0.65rem; text-align: center; border-radius: 4px;';

        rootDrop.addEventListener('dragover', function (e) {
            e.preventDefault();
            rootDrop.style.borderColor = 'var(--main-color)';
            rootDrop.style.color = 'var(--main-color)';
        });
        rootDrop.addEventListener('dragleave', function () {
            rootDrop.style.color = 'var(--dim-color)';
            rootDrop.style.border = '1px dashed var(--dim-color)';
        });
        rootDrop.addEventListener('drop', function (e) {
            e.preventDefault();
            var noteId = e.dataTransfer.getData('text/plain');
            var srcFolderPath = e.dataTransfer.getData('application/x-folder-path');

            if (noteId) {
                Notes.moveNote(noteId, '/');
            } else if (srcFolderPath) {
                Notes.moveFolder(srcFolderPath, '/');
            }
        });
        sidebarList.appendChild(rootDrop);

        // V15.0: BOARDS SECTION - V65 Enhanced
        if (BOARDS && BOARDS.length > 0) {
            var boardSection = document.createElement('div');
            boardSection.className = 'tree-boards-section';
            
            var boardHeader = document.createElement('div');
            boardHeader.className = 'tree-folder-header tree-boards-header';
            boardHeader.innerHTML = '<span class="tree-folder-icon">></span>' +
                '<span class="tree-folder-title tree-boards-title">DATA_BOARDS</span>' +
                '<span class="tree-folder-count">' + BOARDS.length + '</span>';
            
            var boardList = document.createElement('div');
            boardList.className = 'tree-boards-list';
            boardList.style.display = 'block';
            
            boardHeader.onclick = function() {
                var icon = boardHeader.querySelector('.tree-folder-icon');
                if (boardList.style.display === 'none') {
                    boardList.style.display = 'block';
                    icon.textContent = '>';
                } else {
                    boardList.style.display = 'none';
                    icon.textContent = '>';
                }
            };
            
            BOARDS.forEach(function (board) {
                var boardItem = document.createElement('div');
                boardItem.className = 'tree-board-item';
                
                var boardLabel = document.createElement('span');
                boardLabel.className = 'tree-board-label';
                boardLabel.textContent = board.title.toUpperCase();
                boardLabel.onclick = function() { KanbanManager.open(board.id); };
                
                // V65: Delete board button with dedicated modal
                var boardDelete = document.createElement('button');
                boardDelete.className = 'tree-board-delete';
                boardDelete.textContent = 'X';
                boardDelete.title = 'Delete board';
                boardDelete.onclick = function(e) {
                    e.stopPropagation();
                    var totalCards = board.columns.reduce(function(sum, col) { return sum + col.cards.length; }, 0);
                    showConfirmModal(
                        'DELETE_BOARD',
                        'Permanently delete "' + board.title + '"?<br><span style="color:#666">Contains ' + board.columns.length + ' columns and ' + totalCards + ' cards.</span>',
                        function() {
                            var idx = BOARDS.findIndex(function(b) { return b.id === board.id; });
                            if (idx !== -1) {
                                BOARDS.splice(idx, 1);
                                saveData();
                                if (typeof KanbanManager !== 'undefined') KanbanManager.syncPage(); // V67
                                Notes.renderSidebar();
                            }
                        },
                        null,
                        'DELETE'
                    );
                };
                
                boardItem.appendChild(boardLabel);
                boardItem.appendChild(boardDelete);
                boardList.appendChild(boardItem);
            });
            
            boardSection.appendChild(boardHeader);
            boardSection.appendChild(boardList);
            sidebarList.appendChild(boardSection);
        }


        // V3.5: Update sidebar tags list
        this.updateAllTags();
    },

    // V3.9: Folder Operations & Persistent State
    showFolderModal: function () {
        var modal = document.getElementById('folder-create-modal');
        var input = document.getElementById('folder-name-input');
        var overlay = document.getElementById('modal-overlay');
        if (modal && input && overlay) {
            input.value = '';
            modal.style.display = ''; // V14.2: Reset display to allow active class to show it
            modal.classList.add('active'); // V3.9: Use active class
            overlay.classList.add('active');
            input.focus();
        }
    },

    hideFolderModal: function () {
        var modal = document.getElementById('folder-create-modal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none'; // Fallback for old themes
        }

        // V3.9: SMART CLEANUP
        // Only hide overlay if no other modals are active
        var otherModals = document.querySelectorAll('.modal.active');
        if (otherModals.length === 0) {
            var overlay = document.getElementById('modal-overlay');
            if (overlay) overlay.classList.remove('active');
        }
    },

    // PHASE 9: KNOWLEDGE GRAPH
    // V61: Clean unified Graph modal controls
    openGraph: function () {
        var self = this;
        ModalManager.open('graph-modal');
        // V61: Longer delay + safety fallback to ensure layout is ready
        setTimeout(function () {
            self.renderGraph();
        }, 300);
    },

    closeGraph: function () {
        ModalManager.closeTop(true);
    },

    showHelp: function () {
        // V27: Migrated to ModalManager for proper stacking
        const modalId = 'note-help-modal';
        const modal = document.getElementById(modalId);
        
        if (modal && modal.classList.contains('active')) {
            this.hideHelp();
        } else {
            ModalManager.open(modalId);
        }
    },

    hideHelp: function () {
        ModalManager.closeTop(true); // Close top modal (which should be help)
    },

    // V15.0: Selection Helpers for Hybrid Editor
    getSelectionOffsets: function (el) {
        if (el.tagName === 'TEXTAREA') {
            return { start: el.selectionStart, end: el.selectionEnd, value: el.value };
        }
        var sel = window.getSelection();
        if (sel.rangeCount > 0) {
            var range = sel.getRangeAt(0);
            var preRange = range.cloneRange();
            preRange.selectNodeContents(el);
            preRange.setEnd(range.startContainer, range.startOffset);
            var start = preRange.toString().length;
            return {
                start: start,
                end: start + range.toString().length,
                value: el.textContent
            };
        }
        return { start: 0, end: 0, value: el.value || '' };
    },

    toggleMaximize: function () {
        var modal = document.getElementById('note-editor-modal');
        var btn = document.getElementById('note-maximize-btn');
        if (modal && btn) {
            var isMax = modal.classList.toggle('maximized');
            btn.textContent = isMax ? '[MIN]' : '[MAX]';
            
            // V63.4: Auto-collapse sidebar when maximizing (but allow manual toggle via SIDEBAR button)
            var sidebar = document.querySelector('.notes-sidebar');
            if (sidebar) {
                sidebar.style.display = ''; // V63.4: Clear any hardcoded display overrides
                if (isMax) sidebar.classList.add('collapsed');
                else sidebar.classList.remove('collapsed');
            }
            
            // Re-sync preview mode layout
            this.updatePreviewModeLayout();
            
            // V15.3: Hide global icons when maximized
            this.updateGlobalIconsVisibility(!isMax);
        }
    },

    // V63.4: Helper to sync layout based on preview mode
    updatePreviewModeLayout: function() {
        var isMax = document.getElementById('note-editor-modal').classList.contains('maximized');
        var editor = document.getElementById('block-editor');
        var preview = document.getElementById('note-preview');

        if (this.isPreviewMode) {
            if (editor) editor.style.display = 'none';
            if (preview) {
                preview.style.display = 'block';
                preview.classList.add('active');
            }
        } else {
            if (editor) editor.style.display = 'block';
            if (preview) {
                preview.style.display = 'none';
                preview.classList.remove('active');
            }
        }
    },

    // V61: Centralized control for global UI icons visibility
    updateGlobalIconsVisibility: function (visible) {
        var configBtn = document.getElementById('config-btn');
        var helpBtn = document.getElementById('help-btn');
        if (configBtn) configBtn.style.display = visible ? 'block' : 'none';
        if (helpBtn) helpBtn.style.display = visible ? 'flex' : 'none';
    },

    setSelectionOffsets: function (el, start, end) {
        if (el.tagName === 'TEXTAREA') {
            el.focus();
            el.selectionStart = start;
            el.selectionEnd = end;
            return;
        }
        el.focus();
        var sel = window.getSelection();
        var range = document.createRange();
        var charCount = 0;
        var startNode = null, startOffset = 0;
        var endNode = null, endOffset = 0;

        function traverse(node) {
            if (node.nodeType === 3) { // Text node
                var nextCharCount = charCount + node.length;
                if (!startNode && start >= charCount && start <= nextCharCount) {
                    startNode = node;
                    startOffset = start - charCount;
                }
                if (!endNode && end >= charCount && end <= nextCharCount) {
                    endNode = node;
                    endOffset = end - charCount;
                }
                charCount = nextCharCount;
            } else {
                for (var i = 0; i < node.childNodes.length; i++) {
                    traverse(node.childNodes[i]);
                }
            }
        }
        traverse(el);
        if (startNode && endNode) {
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    },

    detectLinkAtCursor: function (targetEl) {
        var state = this.getSelectionOffsets(targetEl);
        var text = state.value;
        var startPos = state.start;
        var endPos = state.end;

        // Search range: current line + the selection itself
        var lineStart = text.lastIndexOf('\n', startPos - 1) + 1;
        var lineEnd = text.indexOf('\n', endPos);
        if (lineEnd === -1) lineEnd = text.length;
        var line = text.substring(lineStart, lineEnd);

        // Match relative to lineStart
        var relativeStart = startPos - lineStart;
        var relativeEnd = endPos - lineStart;

        // 1. External Link: [Label](URL)
        // V14.1: Improved regex to handle URLs with parentheses (e.g. Google Sheets or filenames like (2).mp4)
        var extRegex = /\[([^\[\]]+)\]\(([^)\s]+(?:\([^)\s]*\))?[^)\s]*)\)/g;
        var match;
        while ((match = extRegex.exec(line)) !== null) {
            var mStart = match.index;
            var mEnd = mStart + match[0].length;
            // Intersection check: cursor is inside OR selection overlaps match
            if ((relativeStart >= mStart && relativeStart <= mEnd) ||
                (relativeStart <= mStart && relativeEnd >= mEnd) ||
                (relativeStart >= mStart && relativeStart < mEnd)) {
                return {
                    type: 'k',
                    start: lineStart + mStart,
                    end: lineStart + mEnd,
                    label: match[1],
                    url: match[2],
                    full: match[0]
                };
            }
        }

        // 2. WikiLink: [[Title]] or [[Title|Label]]
        var wikiRegex = /\[\[([^\[\]|]+)(?:\|([^\[\]|]+))?\]\]/g;
        while ((match = wikiRegex.exec(line)) !== null) {
            var mStart = match.index;
            var mEnd = mStart + match[0].length;
            if ((relativeStart >= mStart && relativeStart <= mEnd) ||
                (relativeStart <= mStart && relativeEnd >= mEnd) ||
                (relativeStart >= mStart && relativeStart < mEnd)) {
                return {
                    type: 'l',
                    start: lineStart + mStart,
                    end: lineStart + mEnd,
                    title: match[1],
                    label: match[2] || match[1], // If no pipe, label IS the title
                    full: match[0]
                };
            }
        }
        return null;
    },

    showLinkPopover: function (type, selection, callback, existingLink) {
        var popover = document.getElementById('link-popover');
        var input = document.getElementById('link-popover-input');
        var label = document.getElementById('link-popover-label');
        var submit = document.getElementById('link-popover-submit');
        var removeBtn = document.getElementById('link-popover-remove');
        // V38: Use active element or block-editor instead of legacy textarea
        var textarea = document.getElementById('active-note-content') || document.activeElement;
        if (!popover || !input || !removeBtn) return;

        function truncate(s, len) {
            if (!s) return "";
            // V40: Coerce to string to handle Selection objects
            var str = String(s);
            var clean = str.replace(/[*_~`<>]/g, '').replace(/[\n\r]/g, ' ');
            return clean.length > len ? clean.substring(0, len - 3) + "..." : clean;
        }

        // V3.9: Broad Draggable Logic (Whole Popover except inputs)
        var isDragging = false, offset = { x: 0, y: 0 };
        popover.onmousedown = function (e) {
            if (e.target === input || e.target === submit) return;
            isDragging = true;
            offset.x = e.clientX - popover.offsetLeft;
            offset.y = e.clientY - popover.offsetTop;
            e.preventDefault();
        };

        var onMouseMove = function (e) {
            if (!isDragging) return;
            popover.style.left = (e.clientX - offset.x) + 'px';
            popover.style.top = (e.clientY - offset.y) + 'px';
        };
        var onMouseUp = function () { isDragging = false; };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);

        // V39: Caret-Relative Positioning (works with contentEditable)
        var selection = window.getSelection();
        var rect;
        if (selection.rangeCount > 0) {
            var range = selection.getRangeAt(0);
            rect = range.getBoundingClientRect();
        }
        
        // Fallback if no selection or zero-size rect
        if (!rect || rect.height === 0) {
            var editor = document.getElementById('block-editor');
            rect = editor ? editor.getBoundingClientRect() : { top: 200, left: 200, bottom: 300 };
        }
        
        var top = rect.bottom + window.scrollY + 10;
        var left = rect.left + window.scrollX;
        
        // Keep on screen
        top = Math.min(top, window.innerHeight - 150);
        left = Math.max(10, Math.min(left, window.innerWidth - 340));

        popover.style.top = top + 'px';
        popover.style.left = left + 'px';
        popover.classList.add('active');

        // Reset state
        input.value = '';
        removeBtn.style.display = 'none';

        if (existingLink) {
            // V57: For WikiLinks, existingLink.title is the target note, existingLink.label is display text
            if (type === 'k') {
                label.textContent = 'Edit URL for "' + truncate(existingLink.label, 25) + '":';
                input.value = existingLink.url || '';
            } else {
                // WikiLink: [[Title|Label]] - show target note title for editing
                label.textContent = 'Edit Target Note for "' + truncate(existingLink.label || existingLink.title, 25) + '":';
                input.value = existingLink.title || '';
            }
            removeBtn.style.display = 'block';

            var self = this;
            removeBtn.onclick = function () {
                var replacement = existingLink.label || existingLink.title;
                // V56: Use textContent for contentEditable, value for textarea
                var isContentEditable = textarea.getAttribute && textarea.getAttribute('contenteditable') === 'true';
                if (isContentEditable) {
                    var currentText = textarea.textContent || '';
                    textarea.textContent = currentText.substring(0, existingLink.start) + replacement + currentText.substring(existingLink.end);
                    // Sync to block data
                    var blockEl = textarea.closest('.block-wrapper');
                    if (blockEl) {
                        var blockId = blockEl.getAttribute('data-block-id');
                        PageManager.updateBlock(BlockEditor.activePageId, blockId, { content: textarea.textContent });
                    }
                } else if (textarea.value !== undefined) {
                    textarea.value = textarea.value.substring(0, existingLink.start) + replacement + textarea.value.substring(existingLink.end);
                    textarea.selectionStart = existingLink.start;
                    textarea.selectionEnd = existingLink.start + replacement.length;
                }
                cleanup();
                self.autoSave();
            };
        } else {
            if (type === 'k') {
                label.textContent = selection ? 'URL for "' + truncate(selection, 25) + '":' : 'Enter Link URL (Required):';
                input.placeholder = 'https://example.com';
            } else if (type === 'label') {
                label.textContent = 'Label for "' + truncate(selection, 25) + '":';
                input.placeholder = 'Optional label...';
            } else {
                if (selection) {
                    label.textContent = 'Label for [[' + truncate(selection, 20) + ']]:';
                    input.placeholder = 'Optional display label...';
                } else {
                    label.textContent = 'WikiLink Note Title:';
                    input.placeholder = 'Search note title...';
                }
            }
        }

        input.focus();

        var cleanup = function () {
            submit.onclick = null;
            input.onkeydown = null;
            popover.onmousedown = null;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            popover.classList.remove('active');
            // V56: Safely focus target element
            if (textarea && typeof textarea.focus === 'function') textarea.focus();
        };

        var onEnter = function () {
            var val = input.value.trim();
            // V3.9: Enforce URL requiredness for type 'k'
            if (type === 'k' && !val) {
                cleanup();
                return;
            }

            if (val || selection || type === 'label') {
                if (type === 'k' && val && !val.match(/^https?:\/\//) && !val.match(/^\//) && !val.match(/^#/)) {
                    val = 'https://' + val;
                }
                callback(val);
            }
            cleanup();
        };

        submit.onclick = function (e) { e.preventDefault(); onEnter(); };
        input.onkeydown = function (e) {
            var key = e.key.toLowerCase();
            var meta = e.ctrlKey || e.metaKey;

            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                onEnter();
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                cleanup();
                return;
            }
            // V3.9: Shortcut-based Cancel (Inside Input)
            if (meta && ((key === 'k') || (key === 'l' && e.shiftKey))) {
                e.preventDefault();
                e.stopPropagation();
                cleanup();
                return;
            }
        };
    },

    processEditorShortcut: function (key) {
        var textarea = document.getElementById('active-note-content');
        var blockContent = document.activeElement;
        
        // If we are in the block editor, use the active block as our "target"
        var isBlockMode = blockContent && blockContent.getAttribute('contenteditable') === 'true';
        if (!textarea && !isBlockMode) return;
        
        var targetEl = isBlockMode ? blockContent : textarea;

        // V3.9: Shortcut-based Cancel
        var popover = document.getElementById('link-popover');
        if (popover && popover.classList.contains('active')) {
            popover.classList.remove('active');
            targetEl.focus();
            return;
        }

        var state = this.getSelectionOffsets(targetEl);
        var start = state.start;
        var end = state.end;
        var text = state.value;
        var rawSelection = text.substring(start, end);

        // --- Phase 12.6: Checkbox Projection ---
        var checkboxMatch = rawSelection.match(/^- \[[ xX]\] /);
        var opStart = start;
        var opEnd = end;
        if (checkboxMatch) opStart = start + checkboxMatch[0].length;
        var opSelection = text.substring(opStart, opEnd);

        // --- Marker Definitions ---
        var wrapper = '', endWrapper = '';
        var isPattern = false;
        var patternSuffix = null;

        switch (key) {
            case 'b': wrapper = '**'; endWrapper = '**'; break;
            case 'i': wrapper = '*'; endWrapper = '*'; break;
            case 'u': wrapper = '<u>'; endWrapper = '</u>'; break;
            case 'k':
                wrapper = '[';
                isPattern = true;
                patternSuffix = /\]\((.*?)\)/;
                break;
            case 'l':
            case 'wikilink':
                wrapper = '[[';
                isPattern = true;
                patternSuffix = /\]\]/;
                break;
        }

        // --- Phase 13.0: High-Fidelity Styling Engine ---
        function findGreedyMatchDeep(fullText, s, e, w, ew, isPat, patSuffix) {
            var lineStart = fullText.lastIndexOf('\n', s - 1) + 1;
            var lineEnd = fullText.indexOf('\n', e);
            if (lineEnd === -1) lineEnd = fullText.length;
            var beforeText = fullText.substring(lineStart, s);
            var afterText = fullText.substring(e, lineEnd);
            var currentSelection = fullText.substring(s, e);

            function isValid(marker, text, idx) {
                if (!marker.includes('*')) return true;
                var count = 0, i = idx;
                var maxIter = 10; // V13.2: Hard iteration cap
                while (i < text.length && text[i] === '*' && maxIter-- > 0) { count++; i++; }
                var j = idx - 1;
                maxIter = 10;
                while (j >= 0 && text[j] === '*' && maxIter-- > 0) { count++; j--; }
                if (marker === '*') return count === 1 || count === 3;
                if (marker === '**') return count === 2 || count === 3;
                return true;
            }

            // 1. Outside Check with safety limits (V13.2)
            if (!w || !ew) return null;
            var wIdx = beforeText.lastIndexOf(w);
            var searchAttempts = 0;
            var MAX_SEARCH_ATTEMPTS = 50; // V13.2: Prevent infinite backtracking

            while (wIdx !== -1 && searchAttempts++ < MAX_SEARCH_ATTEMPTS) {
                if (isValid(w, beforeText, wIdx)) break;
                if (w.includes('*')) {
                    // Skip backwards through contiguous stars
                    var skipStart = wIdx;
                    while (wIdx > 0 && beforeText[wIdx - 1] === '*') wIdx--;
                    if (wIdx === skipStart) wIdx--; // Ensure progress
                } else {
                    wIdx--; // Ensure progress for non-star markers
                }
                wIdx = beforeText.lastIndexOf(w, wIdx);
            }

            if (searchAttempts >= MAX_SEARCH_ATTEMPTS) {
                console.warn('[V13.2] Search timeout (backward) - aborting match');
                return null;
            }

            if (wIdx !== -1) {
                if (isPat) {
                    var suffixMatch = afterText.match(patSuffix);
                    if (suffixMatch && suffixMatch.index !== -1) {
                        return { type: 'outside', start: lineStart + wIdx, end: e + suffixMatch.index, ewLen: suffixMatch[0].length };
                    }
                } else {
                    var ewIdx = afterText.indexOf(ew);
                    searchAttempts = 0;
                    while (ewIdx !== -1 && searchAttempts++ < MAX_SEARCH_ATTEMPTS) {
                        if (isValid(ew, afterText, ewIdx)) break;
                        if (ew.includes('*')) {
                            var skipStart = ewIdx;
                            while (ewIdx < afterText.length - 1 && afterText[ewIdx + 1] === '*') ewIdx++;
                            if (ewIdx === skipStart) ewIdx++; // Ensure progress
                        } else {
                            ewIdx++; // Ensure progress
                        }
                        ewIdx = afterText.indexOf(ew, ewIdx);
                    }
                    if (searchAttempts >= MAX_SEARCH_ATTEMPTS) {
                        console.warn('[V13.2] Search timeout (forward) - aborting match');
                        return null;
                    }
                    if (ewIdx !== -1) {
                        var mid = beforeText.substring(wIdx + w.length) + currentSelection + afterText.substring(0, ewIdx);
                        if (mid.indexOf(w) === -1 && mid.indexOf(ew) === -1) {
                            return { type: 'outside', start: lineStart + wIdx, end: e + ewIdx, ewLen: ew.length };
                        }
                    }
                }
            }

            // 2. Starts/Ends Check (Explicit selection)
            if (currentSelection.length >= w.length + (isPat ? 2 : ew.length) && currentSelection.startsWith(w)) {
                if (isPat) {
                    var inSuffixMatch = currentSelection.substring(w.length).match(patSuffix);
                    if (inSuffixMatch && currentSelection.endsWith(inSuffixMatch[0])) {
                        return { type: 'starts_ends', start: s, end: e - inSuffixMatch[0].length, ewLen: inSuffixMatch[0].length };
                    }
                } else if (currentSelection.endsWith(ew)) {
                    if (isValid(w, currentSelection, 0) && isValid(ew, currentSelection, currentSelection.length - ew.length)) {
                        return { type: 'starts_ends', start: s, end: e - ew.length, ewLen: ew.length };
                    }
                }
            }

            // 3. Deep Inside Check (Sloppy selection)
            var trimmedS = currentSelection.trim();
            var trimOffset = currentSelection.indexOf(trimmedS);
            if (trimmedS.startsWith(w)) {
                var innerWIdx = currentSelection.indexOf(w, trimOffset);
                if (innerWIdx !== -1 && isValid(w, currentSelection, innerWIdx)) {
                    if (isPat) {
                        var inSelectionSuffix = currentSelection.substring(innerWIdx + w.length).match(patSuffix);
                        if (inSelectionSuffix) {
                            return { type: 'deep_inside', start: s + innerWIdx, end: s + innerWIdx + w.length + inSelectionSuffix.index, ewLen: inSelectionSuffix[0].length };
                        }
                    } else {
                        var innerEWIdx = currentSelection.lastIndexOf(ew);
                        if (innerEWIdx !== -1 && innerEWIdx > innerWIdx && isValid(ew, currentSelection, innerEWIdx)) {
                            return { type: 'deep_inside', start: s + innerWIdx, end: s + innerEWIdx, ewLen: ew.length };
                        }
                    }
                }
            }
            return null;
        }

        var self = this;

        // --- Phase 13.3: Apple-Style Link Inspector ---
        var existingLink = this.detectLinkAtCursor(targetEl);
        if (existingLink && (key === 'k' || key === 'l')) {
            this.showLinkPopover(existingLink.type, '', function (newVal) {
                var newFull = '';
                if (existingLink.type === 'k') {
                    newFull = '[' + existingLink.label + '](' + newVal + ')';
                } else {
                    var labelPart = existingLink.label !== existingLink.title ? '|' + existingLink.label : '';
                    newFull = '[[' + newVal + labelPart + ']]';
                }
                
                var newTotal = text.substring(0, existingLink.start) + newFull + text.substring(existingLink.end);
                if (targetEl.tagName === 'TEXTAREA') targetEl.value = newTotal;
                else {
                    targetEl.textContent = newTotal;
                    // V15.1 sync to blocks immediately
                    var blockId = targetEl.closest('.block-wrapper').getAttribute('data-block-id');
                    PageManager.updateBlock(BlockEditor.activePageId, blockId, { content: newTotal });
                }
                
                self.setSelectionOffsets(targetEl, existingLink.start, existingLink.start + newFull.length);
                self.autoSave();
            }, existingLink);
            return;
        }

        var match = findGreedyMatchDeep(text, opStart, opEnd, wrapper, endWrapper, isPattern, patternSuffix);
        if (match) {
            // Note: Links (k/l) are now handled by the Inspector above. 
            // Greedy match is only for symmetric styles (b, i, u).
            if (key === 'k' || key === 'l') return;

            var toggleTargetText = text.substring(match.start, match.end + match.ewLen);
            var inner = toggleTargetText.substring(wrapper.length, toggleTargetText.length - match.ewLen);
            
            var newVal = text.substring(0, match.start) + inner + text.substring(match.end + match.ewLen);
            if (targetEl.tagName === 'TEXTAREA') targetEl.value = newVal;
            else {
                targetEl.textContent = newVal;
                // V15.1: Sync to blocks
                var blockId = targetEl.closest('.block-wrapper').getAttribute('data-block-id');
                PageManager.updateBlock(BlockEditor.activePageId, blockId, { content: newVal });
            }
            
            // Solidify selection (V3.9)
            this.setSelectionOffsets(targetEl, match.start, match.start + inner.length);
            this.autoSave();
            return;
        }

        var self = this;
        if (key === 'k') {
            if (opSelection.match(/^https?:\/\//) || opSelection.match(/^www\./)) {
                this.showLinkPopover('label', opSelection, function (label) {
                    var linkCode = '[' + label + '](' + opSelection + ')';
                    var newTotal = text.substring(0, opStart) + linkCode + text.substring(opEnd);
                    if (targetEl.tagName === 'TEXTAREA') targetEl.value = newTotal;
                    else {
                        targetEl.textContent = newTotal;
                        // V56: Sync to block data
                        var blockEl = targetEl.closest('.block-wrapper');
                        if (blockEl) {
                            var blockId = blockEl.getAttribute('data-block-id');
                            PageManager.updateBlock(BlockEditor.activePageId, blockId, { content: newTotal });
                        }
                    }
                    
                    self.setSelectionOffsets(targetEl, opStart + 1, opStart + 1 + label.length);
                    self.autoSave();
                });
            } else {
                this.showLinkPopover('k', opSelection, function (url) {
                    var label = opSelection || url;
                    var linkCode = '[' + label + '](' + url + ')';
                    var newTotal = text.substring(0, opStart) + linkCode + text.substring(opEnd);
                    if (targetEl.tagName === 'TEXTAREA') targetEl.value = newTotal;
                    else {
                        targetEl.textContent = newTotal;
                        // V56: Sync to block data
                        var blockEl = targetEl.closest('.block-wrapper');
                        if (blockEl) {
                            var blockId = blockEl.getAttribute('data-block-id');
                            PageManager.updateBlock(BlockEditor.activePageId, blockId, { content: newTotal });
                        }
                    }

                    self.setSelectionOffsets(targetEl, opStart + 1, opStart + 1 + label.length);
                    self.autoSave();
                });
            }
        } else if (key === 'l') {
            this.showLinkPopover('l', opSelection, function (label) {
                var title = opSelection;
                var suffix = label ? '|' + label : '';
                if (!opSelection) { title = label; suffix = ''; }
                var wikiCode = '[[' + title + suffix + ']]';
                var newTotal = text.substring(0, opStart) + wikiCode + text.substring(opEnd);
                if (targetEl.tagName === 'TEXTAREA') targetEl.value = newTotal;
                else {
                    targetEl.textContent = newTotal;
                    // V56: Sync to block data
                    var blockEl = targetEl.closest('.block-wrapper');
                    if (blockEl) {
                        var blockId = blockEl.getAttribute('data-block-id');
                        PageManager.updateBlock(BlockEditor.activePageId, blockId, { content: newTotal });
                    }
                }

                self.setSelectionOffsets(targetEl, opStart + 2, opStart + 2 + title.length + suffix.length);
                self.autoSave();
            });
        } else {
            var newTotal = text.substring(0, opStart) + wrapper + opSelection + endWrapper + text.substring(opEnd);
            if (targetEl.tagName === 'TEXTAREA') targetEl.value = newTotal;
            else {
                targetEl.textContent = newTotal;
                // V15.1: Sync to blocks
                var blockId = targetEl.closest('.block-wrapper').getAttribute('data-block-id');
                PageManager.updateBlock(BlockEditor.activePageId, blockId, { content: newTotal });
            }

            this.setSelectionOffsets(targetEl, opStart + wrapper.length, opStart + wrapper.length + opSelection.length);
            this.autoSave();
        }
    },

    renderGraph: function () {
        var container = document.getElementById('graph-container');
        if (!container || typeof d3 === 'undefined') return;

        container.innerHTML = '';
        // V61: Fallback dimensions if container is not layouted yet
        var width = container.clientWidth || 1200;
        var height = container.clientHeight || 800;

        // 1. Prepare Data
        var searchInput = document.getElementById('graph-search');
        var filterTerm = (searchInput ? searchInput.value : '').toLowerCase();

        var filteredNotes = NOTES;
        if (filterTerm) {
            filteredNotes = NOTES.filter(n =>
                (n.title && n.title.toLowerCase().includes(filterTerm)) ||
                (n.content && n.content.toLowerCase().includes(filterTerm)) ||
                (n.path && n.path.toLowerCase().includes(filterTerm))
            );
        }

        var nodes = filteredNotes.map(n => {
            var nodeObj = { id: n.id, name: n.title || 'Untitled', type: 'note', path: n.path || '/' };
            if (Notes.graphLayout[n.id]) {
                nodeObj.fx = Notes.graphLayout[n.id].x;
                nodeObj.fy = Notes.graphLayout[n.id].y;
            }
            return nodeObj;
        });

        // V15.2: Add Boards to nodes
        BOARDS.forEach(b => {
             var boardNode = { id: b.id, name: b.title, type: 'board', path: 'BOARD_HUB' };
             if (Notes.graphLayout[b.id]) {
                 boardNode.fx = Notes.graphLayout[b.id].x;
                 boardNode.fy = Notes.graphLayout[b.id].y;
             }
             nodes.push(boardNode);
        });

        var links = [];
        var wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

        filteredNotes.forEach(n => {
            var textToSearch = '';
            if (n.blocks && Array.isArray(n.blocks)) {
                textToSearch = n.blocks.map(b => (b.content || '').toLowerCase()).join('\n');
            } else {
                textToSearch = (n.content || '').toLowerCase();
            }

            var match;
            wikiLinkRegex.lastIndex = 0; // Reset regex
            while ((match = wikiLinkRegex.exec(textToSearch)) !== null) {
                var linkTargetTitle = match[1].trim(); // Already lowercased from textToSearch
                
                // Find target note by title (case-insensitive)
                var targetNote = NOTES.find(other => 
                    other.title && other.title.trim().toLowerCase() === linkTargetTitle
                );
                
                if (targetNote && targetNote.id !== n.id) {
                    // Check if BOTH are in the graph (in nodes array)
                    var sourceInGraph = nodes.some(node => node.id === n.id);
                    var targetInGraph = nodes.some(node => node.id === targetNote.id);
                    
                    if (sourceInGraph && targetInGraph) {
                        var exists = links.some(l => 
                            (l.source === n.id && l.target === targetNote.id) ||
                            (l.source.id === n.id && l.target.id === targetNote.id)
                        );
                        if (!exists) {
                            links.push({ source: n.id, target: targetNote.id });
                        }
                    }
                }
            }
            
            // Note-to-Board links
            if (n.blocks) {
                n.blocks.forEach(block => {
                    if (block.type === 'kanban_ref' && block.boardId) {
                        if (nodes.some(node => node.id === block.boardId)) {
                             links.push({ source: n.id, target: block.boardId });
                        }
                    }
                });
            }
        });

        // 2. SVG Setup
        var svg = d3.select('#graph-container')
            .append('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('viewBox', [0, 0, width, height]);

        var g = svg.append('g');

        // Zoom Behavior
        svg.call(d3.zoom().on('zoom', (event) => {
            g.attr('transform', event.transform);
        }));

        // 3. Force Simulation
        var simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id(d => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(50));

        // 4. Render Links
        var link = g.append('g')
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('class', 'graph-link')
            .style('stroke', 'var(--secondary-color, #ff00ff)')
            .style('stroke-width', '2.5px') // V61: Even thicker for visibility
            .style('stroke-opacity', '0.7');

        // 5. Render Nodes
        var node = g.append('g')
            .selectAll('g')
            .data(nodes)
            .join('g')
            .attr('class', 'graph-node-group')
            .call(d3.drag()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended));

        node.append('circle')
            .attr('r', d => d.type === 'board' ? 8 : 6)
            .attr('class', d => 'graph-node' + (d.id === Notes.activeNoteId ? ' active' : ''))
            .attr('fill', d => d.type === 'board' ? 'var(--board-color)' : 'var(--main-color)');

        node.append('text')
            .attr('dx', 12)
            .attr('dy', 4)
            .attr('class', 'graph-label')
            .text(d => d.name);

        // Events
        node.on('mouseover', function (event, d) {
            d3.select(this).select('circle').classed('highlighted', true);
            d3.select(this).select('text').classed('highlighted', true);

            link.classed('highlighted', l => l.source.id === d.id || l.target.id === d.id)
                .classed('dimmed', l => l.source.id !== d.id && l.target.id !== d.id);

            node.classed('dimmed', n => {
                if (n.id === d.id) return false;
                var isNeighbor = links.some(l => (l.source.id === d.id && l.target.id === n.id) || (l.target.id === d.id && l.source.id === n.id));
                return !isNeighbor;
            });
        }).on('mouseout', function () {
            d3.select(this).select('circle').classed('highlighted', false);
            d3.select(this).select('text').classed('highlighted', false);
            link.classed('highlighted', false).classed('dimmed', false);
            node.classed('dimmed', false);
        }).on('click', function (event, d) {
            if (d.type === 'board') {
                KanbanManager.open(d.id);
            } else {
                Notes.open(d.id);
            }
            Notes.closeGraph();
        });

        simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            node
                .attr('transform', d => `translate(${d.x},${d.y})`);
        });

        function dragstarted(event) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }

        function dragged(event) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }

        function dragended(event) {
            if (!event.active) simulation.alphaTarget(0);
            // event.subject.fx = null; // Don't release! (Persistence)
            // event.subject.fy = null;

            // Save position (V13.0)
            Notes.graphLayout[event.subject.id] = { x: event.subject.fx, y: event.subject.fy };
            localStorage.setItem('VINLAND_GRAPH_LAYOUT', JSON.stringify(Notes.graphLayout));
        }
    },

    createNewFolder: function () {
        var input = document.getElementById('folder-name-input');
        var folderName = input ? input.value.trim() : '';
        if (!folderName) return;

        // Create a placeholder note to "manifest" the folder
        var fullPath = '/' + folderName.replace(/^\/+|\/+$/g, '');
        this.create("Folder Manifest", fullPath);

        this.hideFolderModal();
        this.renderSidebar();
    },

    saveExpandedState: function () {
        localStorage.setItem('OPERATOR_EXPANDED_FOLDERS', JSON.stringify(this.expandedFolders));
    },

    playDropSound: function () {
        // High-pitched "dock" sound
        try {
            var ctx = getAudioContext();
            if (ctx.state === 'suspended') ctx.resume();

            var osc = ctx.createOscillator();
            var gain = ctx.createGain();

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.1);
            osc.type = 'sine';

            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

            osc.start();
            osc.stop(ctx.currentTime + 0.1);
        } catch (e) { }
    },

    moveNote: function (noteId, newPath) {
        var note = NOTES.find(function (n) { return n.id === noteId; });
        if (!note) return;

        note.path = newPath;
        saveData();

        // V3.9: Sound Feedback
        if (CONFIG.typing_sounds) this.playDropSound();

        this.renderSidebar();

        if (this.activeNoteId === noteId) {
            var pathEl = document.getElementById('note-current-path');
            if (pathEl) pathEl.textContent = newPath;
        }
    },

    moveFolder: function (oldPath, newParentPath) {
        if (!oldPath || oldPath === '/') return;

        // Get folder name from oldPath
        var pathParts = oldPath.split('/').filter(Boolean);
        var folderName = pathParts[pathParts.length - 1];

        // Construct new path
        var newPath = (newParentPath === '/' ? '' : newParentPath) + '/' + folderName;

        // Prevent moving folder into itself
        if (newPath.startsWith(oldPath)) {
            console.warn("Cannot move folder into itself");
            return;
        }

        var changed = false;
        NOTES.forEach(function (note) {
            if (note.path === oldPath || note.path.startsWith(oldPath + '/')) {
                // Update path prefix
                note.path = newPath + note.path.substring(oldPath.length);
                changed = true;
            }
        });

        if (changed) {
            saveData();
            if (CONFIG.typing_sounds) this.playDropSound();
            this.renderSidebar();
        }
    },

    deleteFolder: function (path) {
        if (!path || path === '/') return;

        var self = this;
        if (typeof showConfirmModal === 'function') {
            showConfirmModal(
                'DELETE FOLDER',
                'All notes within "' + path + '" will be permanently deleted. Continue?',
                function () {
                    var initialCount = NOTES.length;
                    NOTES = NOTES.filter(function (n) {
                        return !(n.path === path || n.path.startsWith(path + '/'));
                    });

                    if (NOTES.length !== initialCount) {
                        saveData();
                        if (CONFIG.typing_sounds) self.playDropSound();

                        // If active note was in deleted folder, close it or move away
                        if (self.activeNoteId) {
                            var activeExists = NOTES.find(function (n) { return n.id === self.activeNoteId; });
                            if (!activeExists) {
                                self.activeNoteId = null;
                                if (NOTES.length > 0) {
                                    self.open(NOTES[0].id);
                                } else {
                                    // Clear editor
                                    document.getElementById('active-note-title').value = '';
                                    document.getElementById('active-note-content').value = '';
                                    document.getElementById('note-timestamp').textContent = '';
                                }
                            }
                        }
                        self.renderSidebar();
                    }
                }
            );
        }
    },

    updateWordCount: function () {
        var counter = document.getElementById('word-count');
        if (!counter || !this.activeNoteId) return;

        var note = NOTES.find(n => n.id === this.activeNoteId);
        if (!note) return;

        // V15.0: Calculate words from synced content
        var text = (note.content || '').trim();
        var words = text ? text.split(/\s+/).length : 0;
        counter.textContent = words + (words === 1 ? ' word' : ' words');
    },

    // V3.5: Markdown Preview
    isPreviewMode: false,

    togglePreview: function () {
        var editor = document.getElementById('block-editor'); // Target the DIV
        var preview = document.getElementById('note-preview');
        var toggleBtn = document.getElementById('preview-toggle');
        // Ensure legacy textarea stays hidden
        var legacy = document.getElementById('active-note-content'); 
        if (legacy) legacy.style.display = 'none';

        if (!editor || !preview || !toggleBtn) return;

        var note = NOTES.find(function(n) { return n.id === Notes.activeNoteId; });
        if (!note) return;

        this.isPreviewMode = !this.isPreviewMode;
        note.viewMode = this.isPreviewMode ? 'preview' : 'edit';
        saveData();

        if (this.isPreviewMode) {
            // Sync blocks to text before rendering
            if (typeof PageManager !== 'undefined') PageManager.syncContent(this.activeNoteId);
            
            preview.innerHTML = this.renderMarkdown(note.content || '');
            preview.classList.add('active');
            preview.style.display = 'block';
            editor.style.display = 'none';
            toggleBtn.textContent = 'EDIT';
            toggleBtn.classList.add('active');
        } else {
            preview.classList.remove('active');
            preview.style.display = 'none';
            editor.style.display = 'block'; // Show Block Editor
            toggleBtn.textContent = 'PREVIEW';
            toggleBtn.classList.remove('active');
            // Re-render editor to ensure state is fresh
            if (typeof BlockEditor !== 'undefined') BlockEditor.render(this.activeNoteId);
        }
    },

    renderMarkdown: function (text) {
        var html = text || '';

        if (!html) html = '<p style="color:#555;">No content to preview</p>';
        else {
            // V45: Extract code fences FIRST (before HTML escape)
            var codeBlocks = [];
            html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(match, lang, code) {
                var idx = codeBlocks.length;
                
                // V71: Custom Calculator Preview
                if (lang === 'calc') {
                    var parts = code.split('//');
                    var expr = parts[0].trim();
                    var result = parts.length > 1 ? parts[1].replace('=', '').trim() : '';
                    
                    var calcHtml = '<div class="calc-preview">';
                    calcHtml += '<span class="calc-expression">' + expr + '</span>';
                    if (result) {
                        calcHtml += '<span class="calc-arrow">&rarr;</span>';
                        calcHtml += '<span class="calc-result">' + result + '</span>';
                    }
                    calcHtml += '</div>';
                    
                    codeBlocks.push(calcHtml);
                    return '%%CODE_BLOCK_' + idx + '%%';
                }

                var escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                codeBlocks.push('<pre class="block-code"><code class="code-inner language-' + (lang || 'plain') + '">' + escapedCode + '</code><span class="code-lang-label">' + (lang || 'plain').toUpperCase() + '</span></pre>');
                return '%%CODE_BLOCK_' + idx + '%%';
            });
            
            // V63.6: Extract image blocks BEFORE HTML escape to preserve base64 URLs
            var imageBlocks = [];
            html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(match, alt, url) {
                var idx = imageBlocks.length;
                imageBlocks.push('<div class="preview-image-container"><img src="' + url + '" alt="' + alt + '" class="preview-img"><div class="preview-image-caption">' + alt + '</div></div>');
                return '%%IMAGE_BLOCK_' + idx + '%%';
            });
            
            // V65: Extract Kanban blocks BEFORE HTML escape
            var kanbanBlocks = [];
            html = html.replace(/%%KANBAN:([^:]+):([^:]+):([^:]+):(\d+):(\d+)%%/g, function(match, id, blockId, title, cols, cards) {
                var idx = kanbanBlocks.length;
                
                // V66: Stealth HUD in Preview Mode (Synced with Editor)
                var board = (typeof BOARDS !== 'undefined') ? BOARDS.find(function(b) { return b.id === id; }) : null;
                var hudHtml = '';
                
                if (board) {
                    // Robust Progress Calculation
                    var totalCards = 0;
                    board.columns.forEach(c => totalCards += c.cards.length);
                    var doneCol = board.columns[board.columns.length - 1];
                    var doneCount = doneCol ? doneCol.cards.length : 0;
                    var percent = totalCards === 0 ? 0 : Math.round((doneCount / totalCards) * 100);

                    // V67: Generate Active Stream (Synced with Editor)
                    var activeCol = board.columns.find(c => c.cards.length > 0 && c !== doneCol) || board.columns[0];
                    var activeCards = activeCol ? activeCol.cards.slice(0, 3) : [];
                    var listHtml = activeCards.map(card => {
                        var displayContent = (card.content || '').replace(/#(\w+)/g, '<span class="hud-tag">#$1</span>');
                        return `<li class="hud-item" data-card-id="${card.id}">
                            <span class="hud-item-text">${displayContent}</span>
                            <span class="hud-advance-btn" title="Advance">>></span>
                        </li>`;
                    }).join('');

                    hudHtml = `
                    <div class="kanban-hud-wrapper" style="margin: 10px 0; cursor: default;" data-board-id="${board.id}" data-block-id="${blockId}">
                        <div class="hud-header-compact" title="Click to Open Board">
                            <div class="hud-title-row">
                                <span class="hud-icon">[=]</span>
                                <span class="hud-name">${board.title.toUpperCase()}</span>
                                <span class="hud-percent">${percent}%</span>
                                <span class="hud-delete-btn" title="Remove Block" style="opacity:0.3; cursor:pointer; margin-left:auto;">[x]</span>
                            </div>
                            <div class="hud-progress-track">
                                <div class="hud-progress-fill" style="width: ${percent}%"></div>
                            </div>
                        </div>
                        <ul class="hud-list" style="list-style:none; padding:0; margin:0;">${listHtml}</ul>
                        <div class="hud-injector-row">
                            <input type="text" 
                                   class="hud-injector-input" 
                                   placeholder="+ Add task (#tag supported)...">
                        </div>
                    </div>`;
                } else {
                    hudHtml = '<div class="kanban-preview-embed"><span style="color:#666">[MISSING BOARD]</span></div>';
                }

                kanbanBlocks.push(hudHtml);
                return '%%KANBAN_BLOCK_' + idx + '%%';
            });

                
            
            // V68: Alignment Marker Extraction (Process early to strip but apply late)
            var alignments = [];
            var lines = html.split('\n');
            html = lines.map(function(line, idx) {
                var alignMatch = line.match(/\s?%%align:(left|center|right)%%$/);
                if (alignMatch) {
                    alignments[idx] = alignMatch[1];
                    // V69 FIX: Don't use trim() because it removes leading indentation!
                    // Only remove the marker and trailing whitespace.
                    return line.replace(/\s?%%align:(left|center|right)%%$/, '').replace(/\s+$/, '');
                }
                return line;
            }).join('\n');

            // Escape HTML for remaining content
            html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');


            // Blockquotes (V67)
            html = html.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');

            // Bullet Lists (V67: skip tasks)
            html = html.replace(/^(\s*)- (?!\[)(.*)$/gm, function(match, indent, content) {
                var level = (indent.length / 2);
                return '<div class="preview-bullet" style="margin-left:' + (level * 20) + 'px"><span class="preview-bullet-icon">&bull;</span>' + content + '</div>';
            });

            // Numbered Lists (V67)
            html = html.replace(/^(\s*)(\d+)\. (.*)$/gm, function(match, indent, num, content) {
                var level = (indent.length / 2);
                return '<div class="preview-bullet" style="margin-left:' + (level * 20) + 'px"><span class="preview-bullet-icon">' + num + '.</span>' + content + '</div>';
            });

            // V69: Refactored Task Lists (Block-based with Indentation support)
            var taskIndex = 0;
            // Updated regex to capture content at the end: (.*)$
            html = html.replace(/^(\s*)- \[( |x)\] (.*)$/gm, function (match, indent, state, content) {
                var isChecked = (state === 'x');
                var level = (indent.length / 2);
    
                return '<div class="block-task-preview" style="margin-left:' + (level * 20) + 'px">' + 
                       '<input type="checkbox" class="task-checkbox" ' + (isChecked ? 'checked' : '') + ' data-task-index="' + (taskIndex++) + '" disabled>' + // Disabled in preview
                       '<span>' + content + '</span>' + 
                       '</div>';
            });

            // Dividers
            html = html.replace(/^---$/gm, '<hr class="block-divider">');

            // Headers
            html = html.replace(/^### (.*)$/gm, function(match, content) {
                return content.trim() ? '<h3>' + content + '</h3>' : '';
            });
            html = html.replace(/^## (.*)$/gm, function(match, content) {
                return content.trim() ? '<h2>' + content + '</h2>' : '';
            });
            html = html.replace(/^# (.*)$/gm, function(match, content) {
                return content.trim() ? '<h1>' + content + '</h1>' : '';
            });

            // V68: Re-apply Alignments to individual lines/blocks
            var renderedLines = html.split('\n');
            html = renderedLines.map(function(line, idx) {
                if (alignments[idx] && alignments[idx] !== 'left') {
                    // Start of V69 Fix: Inject class for Flexbox items (Bullets/Tasks)
                    if (line.includes('class="preview-bullet"') || line.includes('class="block-task-preview"')) {
                        // Inject alignment class directly into the element
                        return line.replace('class="', 'class="align-' + alignments[idx] + ' ');
                    }
                    // End of V69 Fix
                    return '<div style="text-align:' + alignments[idx] + '">' + line + '</div>';
                }
                return line;
            }).join('\n');

            // Bold and Italic
            html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

            // Inline code
            html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

            // Underline (Handle both raw <u> and escaped &lt;u&gt;)
            html = html.replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, '<u>$1</u>');
            html = html.replace(/<u>(.+?)<\/u>/g, '<u>$1</u>');

            // NOTE: Images are now extracted before escape and re-inserted at the end

            // Standard Markdown Links: [text](url)
            html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" class="external-link">$1</a>');

            // Wiki Links: [[Note Title|Display Label]] or [[Note Title]]
            html = html.replace(/\[\[(.*?)(?:\|(.*?))?\]\]/g, function (match, title, label) {
                var display = label || title;
                return '<span class="internal-link" data-link="' + title + '" title="Click to open note">' + display + '</span>';
            });


            // Markdown Tables (V63.6) - Fixed V65: Complete rewrite for empty row handling
            // Use line-by-line parsing instead of complex regex
            var lines = html.split('\n');
            var inTable = false;
            var tableLines = [];
            var outputLines = [];
            
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                var isTableLine = line.trim().startsWith('|') && line.trim().endsWith('|');
                
                if (isTableLine) {
                    if (!inTable) {
                        // Check if this is header followed by divider
                        var nextLine = lines[i + 1] || '';
                        if (nextLine.includes('---') && nextLine.includes('|')) {
                            inTable = true;
                            tableLines = [line];
                        } else {
                            outputLines.push(line);
                        }
                    } else {
                        tableLines.push(line);
                    }
                } else {
                    if (inTable && tableLines.length > 0) {
                        // End of table - process collected lines
                        outputLines.push(processTableLines(tableLines));
                        tableLines = [];
                        inTable = false;
                    }
                    outputLines.push(line);
                }
            }
            // Handle table at end of content
            if (inTable && tableLines.length > 0) {
                outputLines.push(processTableLines(tableLines));
            }
            
            function processTableLines(tLines) {
                if (tLines.length < 2) return tLines.join('\n');
                
                var headerLine = tLines[0];
                // Skip divider line (index 1)
                var dataLines = tLines.slice(2);
                
                // Parse header cells
                var headerCells = headerLine.split('|').slice(1, -1);
                var hCols = headerCells.map(function(c) {
                    return '<th>' + (c.trim() || '&nbsp;') + '</th>';
                }).join('');
                
                // Parse data rows - include ALL rows even if empty
                var rRows = dataLines.map(function(row) {
                    var cells = row.split('|').slice(1, -1);
                    var cols = cells.map(function(c) {
                        return '<td>' + (c.trim() || '&nbsp;') + '</td>';
                    }).join('');
                    return '<tr>' + cols + '</tr>';
                }).join('');
                
                return '<table class="markdown-table"><thead><tr>' + hCols + '</tr></thead><tbody>' + rRows + '</tbody></table>';
            }
            
            html = outputLines.join('\n');

            // Line breaks
            html = html.replace(/\n/g, '<br>');
            
            // V63: Remove <br> immediately after block-level elements to prevent extra spacing
            html = html.replace(/(<\/h[1-6]>)<br>/gi, '$1');
            html = html.replace(/(<hr[^>]*>)<br>/gi, '$1');
            html = html.replace(/(<\/pre>)<br>/gi, '$1');
            html = html.replace(/(<\/blockquote>)<br>/gi, '$1');
            html = html.replace(/(<\/div>)<br>/gi, '$1');
            
            // V45: Re-insert code blocks
            codeBlocks.forEach(function(block, idx) {
                html = html.replace('%%CODE_BLOCK_' + idx + '%%', block);
            });
            
            // V63.6: Re-insert image blocks
            imageBlocks.forEach(function(block, idx) {
                html = html.replace('%%IMAGE_BLOCK_' + idx + '%%', block);
            });
            
            // V65: Re-insert Kanban blocks
            kanbanBlocks.forEach(function(block, idx) {
                html = html.replace('%%KANBAN_BLOCK_' + idx + '%%', block);
            });
        }

        // V3.5: Backlinks (Linked References)
        if (this.activeNoteId) {
            var currentNote = NOTES.find(n => n.id === this.activeNoteId);
            if (currentNote && currentNote.title) {
                var linkedNotes = NOTES.filter(function (n) {
                    // V3.9: Support both [[Title]] and [[Title|Label]]
                    var escapedTitle = currentNote.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    var pattern = new RegExp('\\[\\[\\s*' + escapedTitle + '\\s*(\\|.*?)?\\]\\]', 'i');
                    return n.id !== currentNote.id && n.content && pattern.test(n.content);
                });

                if (linkedNotes.length > 0) {
                    html += '<div class="backlinks-section">';
                    html += '<div class="backlinks-title">Linked References</div>';
                    linkedNotes.forEach(function (n) {
                        html += '<div class="backlink-item internal-link" data-link="' + n.title + '">';
                        html += n.title;
                        html += '</div>';
                    });
                    html += '</div>';
                }
            }
        }

        return html;
    },

    // V3.5: Tags
    extractTags: function (content) {
        if (!content) return [];
        var matches = content.match(/#[\w]+/g);
        return matches ? [...new Set(matches)] : [];
    },

    updateTags: function () {
        // V63.4: Tags UI Migration - Highlight in Sidebar instead of Footer
        var activeNote = NOTES.find(function (n) { return n.id === Notes.activeNoteId; });
        if (!activeNote) return;

        // 1. Get tags from blocks (if block mode) or content scan
        var tags = [];
        if (activeNote.blocks && activeNote.blocks.length > 0) {
            activeNote.blocks.forEach(function (b) {
                if (b.type === 'tag' || (b.type === 'paragraph' && b.content.startsWith('#'))) {
                    var match = b.content.match(/#(\w+)/);
                    if (match) tags.push(match[1]);
                }
            });
        }
        // Deduplicate
        tags = [...new Set(tags)];

        // 2. Highlight in Sidebar Tags List (Case-insensitive)
        var sidebarTags = document.querySelectorAll('#sidebar-all-tags .tag');
        sidebarTags.forEach(function(el) {
            el.classList.remove('active-tag');
            var tagName = el.textContent.trim().toLowerCase().replace('#', '');
            var isMatch = tags.some(t => t.toLowerCase() === tagName);
            if (isMatch) {
                el.classList.add('active-tag');
            }
        });

        // 3. (Legacy) Footer Bar - Hide it
        var footerBar = document.querySelector('.editor-tags-bar');
        if (footerBar) footerBar.style.display = 'none'; 
    },

    // V3.5: Tag Filtering
    activeTagFilter: null,

    // V63.2: Clear editor when no tabs are open
    clearEditor: function() {
        var titleInput = document.getElementById('active-note-title');
        var blockEditor = document.getElementById('block-editor');
        var preview = document.getElementById('note-preview');
        var pathDisplay = document.getElementById('note-current-path');
        var wordCount = document.getElementById('word-count');
        var timestamp = document.getElementById('note-timestamp');
        
        this.activeNoteId = null;
        if (titleInput) titleInput.value = '';
        if (blockEditor) blockEditor.innerHTML = '';
        if (preview) { preview.innerHTML = ''; preview.classList.remove('active'); }
        if (pathDisplay) pathDisplay.value = '/root';
        if (wordCount) wordCount.textContent = '0 words';
        if (timestamp) timestamp.textContent = '--';
    },

    filterByTag: function (tag) {
        var searchInput = document.getElementById('notes-search');
        if (this.activeTagFilter === tag) {
            // Clear filter
            this.activeTagFilter = null;
            if (searchInput) searchInput.value = '';
        } else {
            this.activeTagFilter = tag;
            if (searchInput) searchInput.value = tag;
        }
        this.renderSidebar(this.activeTagFilter);
    },

    // V3.5: Wiki Links Navigation
    openByTitle: function (title) {
        if (!title) return;
        var found = NOTES.find(function (n) {
            return (n.title || 'Untitled Note').toLowerCase() === title.toLowerCase();
        });

        if (found) {
            // V63.4: Check if already open in a tab - switch instead of duplicate
            if (typeof TabManager !== 'undefined' && CONFIG.notes_tabs_enabled !== false) {
                var existingIdx = TabManager.tabs.findIndex(function(t) { return t.noteId === found.id; });
                if (existingIdx !== -1) {
                    TabManager.switchTo(existingIdx);
                    return;
                }
            }
            this.open(found.id);
            // Switch out of preview if desired? No, stay in preview for browsing
        } else {
            // Offer to create
            showConfirmModal(
                'NOTE NOT FOUND',
                'Note "' + title + '" does not exist. Create it?',
                function () {
                    Notes.create(title);
                }
            );
        }
    },

    // V3.5: Pinned Notes
    togglePin: function () {
        var note = NOTES.find(function (n) { return n.id === Notes.activeNoteId; });
        if (!note) return;

        note.pinned = !note.pinned;
        saveData();
        this.renderSidebar();

        // Update UI
        var pinBtn = document.getElementById('pin-note-btn');
        if (pinBtn) {
            if (note.pinned) {
                pinBtn.classList.add('active');
                pinBtn.textContent = 'UNPIN';
            } else {
                pinBtn.classList.remove('active');
                pinBtn.textContent = 'PIN';
            }
        }

        showNotification(note.pinned ? 'Note pinned' : 'Note unpinned');
    },

    // V3.5: Update All Tags in Sidebar
    updateAllTags: function () {
        var container = document.getElementById('sidebar-all-tags');
        if (!container) return;

        // Collect all unique tags from all notes
        var allTags = {};
        NOTES.forEach(function (note) {
            var tags = Notes.extractTags(note.content || '');
            tags.forEach(function (tag) {
                allTags[tag] = (allTags[tag] || 0) + 1;
            });
        });

        var tagList = Object.keys(allTags).sort();
        container.innerHTML = '';

        if (tagList.length === 0) {
            container.innerHTML = '<span style="color:#555;font-size:0.6rem;">No tags yet</span>';
            return;
        }

        var self = this;
        var activeNote = NOTES.find(function(n) { return n.id === Notes.activeNoteId; });
        var activeNoteTags = activeNote ? Notes.extractTags(activeNote.content || '') : [];

        tagList.forEach(function (tag) {
            var span = document.createElement('span');
            span.className = 'tag';
            if (activeNoteTags.includes(tag)) {
                span.classList.add('active');
            }
            span.textContent = tag;
            span.onclick = function () {
                self.filterByTag(tag);
            };
            container.appendChild(span);
        });
    },

    // V3.5: Multi-select for batch delete
    toggleSelectionMode: function () {
        this.isSelectionMode = !this.isSelectionMode;
        this.selectedNotes = []; // Clear selection

        var btn = document.getElementById('selection-mode-btn');
        var deleteBtn = document.getElementById('delete-selected-btn');

        if (this.isSelectionMode) {
            if (btn) {
                btn.textContent = 'CANCEL';
                btn.classList.add('active');
            }
            if (deleteBtn) {
                deleteBtn.style.display = 'inline-block';
                deleteBtn.textContent = 'DELETE (0)';
            }
        } else {
            if (btn) {
                btn.textContent = 'SELECT';
                btn.classList.remove('active');
            }
            if (deleteBtn) {
                deleteBtn.style.display = 'none';
                deleteBtn.textContent = 'DELETE (0)';
            }
        }

        this.renderSidebar();
    },

    toggleSelection: function (noteId) {
        var idx = this.selectedNotes.indexOf(noteId);
        if (idx === -1) {
            this.selectedNotes.push(noteId);
        } else {
            this.selectedNotes.splice(idx, 1);
        }
        this.renderSidebar();

        var deleteBtn = document.getElementById('delete-selected-btn');
        if (deleteBtn) {
            deleteBtn.textContent = 'DELETE (' + this.selectedNotes.length + ')';
        }
    },


};

/* =========================================
   QUICK NOTES PANEL (Legacy Support)
   ========================================= */
function renderNotes() {
    var list = document.getElementById('notes-list');
    var container = document.getElementById('notes-panel');
    if (!list || !container) return;

    if (!NOTES || NOTES.length === 0) {
        container.classList.remove('active');
        return;
    }

    container.classList.add('active');
    list.innerHTML = '';

    // V18.13: Sort by modified date first, then created
    var notesToShow = NOTES.map(function (n, i) { return { note: n, id: i + 1, index: i }; })
        .sort(function (a, b) {
            var aTime = a.note.modified || a.note.created;
            var bTime = b.note.modified || b.note.created;
            return bTime - aTime;
        })
        .slice(0, 10);
    var fragment = document.createDocumentFragment();
    notesToShow.forEach(function (item) {
        var div = document.createElement('div');
        div.className = 'note-item';
        div.style.cursor = 'pointer';

        // V18.13: Use modified date if available
        var displayTime = item.note.modified || item.note.created;
        var noteDate = new Date(displayTime);
        var today = new Date();
        var isToday = noteDate.toDateString() === today.toDateString();

        // V18.3: Show date if not today, V18.13: Show "Edited" prefix if modified
        var prefix = item.note.modified ? 'Edited ' : '';
        var dateStr = isToday ? '' : noteDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ';
        var time = noteDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        // V19.34: Apple Note Style
        var contentDisplay = item.note.content || item.note.text || '';

        // Header (Title + Time)
        var titleText = item.note.title || (contentDisplay ? contentDisplay.split('\n')[0].substring(0, 20) : 'Untitled');

        var headerHtml = '<div class="note-item-header">' +
            '<span class="note-item-title-quick">' + safeText(titleText) + '</span>' +
            '<span class="note-item-meta">' + dateStr + time + '</span>' +
            '</div>';

        // Teaser (Truncated Content)
        var teaserHtml = '<div class="note-item-teaser">' + safeText(contentDisplay) + '</div>';

        div.innerHTML = headerHtml + teaserHtml;

        // V18.3: Click to edit
        div.setAttribute('data-note-index', item.index);
        div.addEventListener('click', function () {
            // V15.0: Use Notes.open exclusively to ensure modern editor consistency
            if (item.note.id) {
                Notes.open(item.note.id);
            } else {
                Notes.open(); // Fallback
            }
        });

        fragment.appendChild(div);
    });
    list.appendChild(fragment);
}

// DELETED: Legacy openNoteEditor (Phase 15.0)

// V18.8: Fix for Notes Disappearing Bug
function closeNoteEditor() {
    if (typeof PageManager !== 'undefined' && typeof Notes !== 'undefined' && Notes.activeNoteId) {
        PageManager.syncContent(Notes.activeNoteId);
    }
    ModalManager.closeTop(true);
}

// DELETED: Legacy save/delete/navigation helpers (Phase 15.0)

function addNote(text) {
    if (!text || !text.trim()) return;

    // V19.34: V2 Note Structure
    var content = text.trim();
    var title = content.split('\n')[0].substring(0, 30);

    NOTES.unshift({
        id: 'note_' + Date.now(),
        title: title || 'Quick Note',
        content: content,
        created: Date.now(),
        modified: Date.now()
    });

    saveData();
    renderNotes();
    showNotification('NOTE ADDED');
}

function clearNotes() {
    // V18.11: Confirmation for clearing all notes
    showConfirmModal(
        'CLEAR ALL NOTES',
        'Are you sure you want to delete ALL notes? This action cannot be undone.',
        function () {
            NOTES = [];
            saveData();
            renderNotes();
            showNotification('ALL NOTES CLEARED');
        }
    );
}

// V18.11: Open note editor for creating a new note
function openNewNoteEditor() {
    // V3.0: Use Notes for new note creation
    if (typeof Notes !== 'undefined') {
        // V63.2: Prevent infinite tabs
        if (Notes.activeNoteId) {
            var currentNote = NOTES.find(n => n.id === Notes.activeNoteId);
            if (currentNote && (!currentNote.title || currentNote.title === 'Untitled' || currentNote.title.trim() === '')) {
                showNotification('Please name your current note first');
                // Ensure modal is open before focusing
                ModalManager.open('note-editor-modal');
                setTimeout(function() {
                     var el = document.getElementById('active-note-title');
                     if (el) el.focus();
                }, 100);
                return;
            }
        }
        Notes.create();
    }
}

function toggleNotesPanel() {
    var panel = document.getElementById('notes-panel');
    if (panel) panel.classList.toggle('active');
}

/* =========================================
   POMODORO (with seconds support)
   ========================================= */
function parseTime(input) {
    input = input.toString().trim().toLowerCase();

    // Handle "Xs" format (seconds)
    if (input.endsWith('s')) {
        var secs = parseInt(input.slice(0, -1));
        return isNaN(secs) ? 0 : secs * 1000;
    }

    // Handle "M:SS" format
    if (input.includes(':')) {
        var parts = input.split(':');
        var mins = parseInt(parts[0]) || 0;
        var secsPart = parseInt(parts[1]) || 0;
        return (mins * 60 + secsPart) * 1000;
    }

    // Handle plain number (minutes)
    var numMins = parseInt(input);
    return isNaN(numMins) ? 0 : numMins * 60 * 1000;
}

function startPomodoro(timeInput) {
    if (POMODORO.interval) clearInterval(POMODORO.interval);

    var duration = parseTime(timeInput);
    if (duration <= 0) duration = 25 * 60 * 1000;

    POMODORO.active = true;
    POMODORO.paused = false;
    POMODORO.endTime = Date.now() + duration;
    POMODORO.remaining = duration;
    POMODORO.originalDuration = duration;

    // V18.1: Persist to chrome.storage for cross-tab sync
    savePomodoroState();

    var container = document.getElementById('pomodoro-container');
    var pauseBtn = document.getElementById('pomodoro-pause');
    if (container) container.classList.add('active');
    if (pauseBtn) pauseBtn.textContent = 'PAUSE';

    updatePomodoroDisplay();
    POMODORO.interval = setInterval(updatePomodoroDisplay, 100);
}

// V18.1: Save Pomodoro state to chrome.storage for cross-tab sync
function savePomodoroState() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
            pomodoro: {
                active: POMODORO.active,
                paused: POMODORO.paused,
                endTime: POMODORO.endTime,
                remaining: POMODORO.remaining,
                originalDuration: POMODORO.originalDuration
            }
        });
    }
}

// V18.1: Load Pomodoro state from chrome.storage
// V18.1: Load Pomodoro state from chrome.storage
function loadPomodoroState() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['pomodoro', 'pomodoroCompleted', 'pomodoroAcknowledged'], function (result) {
            // V18.2: Check if there's an unacknowledged completion
            var modal = document.getElementById('pomodoro-complete-modal');
            if (modal) {
                if (result.pomodoroCompleted && !result.pomodoroAcknowledged) {
                    modal.style.display = 'block';
                } else {
                    modal.style.display = 'none';
                }
            }

            if (result.pomodoro && result.pomodoro.active) {
                var pomo = result.pomodoro;
                POMODORO.active = pomo.active;
                POMODORO.paused = pomo.paused;
                POMODORO.endTime = pomo.endTime;
                POMODORO.remaining = pomo.remaining;
                POMODORO.originalDuration = pomo.originalDuration;

                // Check if timer is still valid
                if (!POMODORO.paused && POMODORO.endTime <= Date.now()) {
                    // Timer already expired
                    stopPomodoro();
                    return;
                }

                // Resume the timer
                var container = document.getElementById('pomodoro-container');
                var pauseBtn = document.getElementById('pomodoro-pause');
                if (container) container.classList.add('active');
                if (pauseBtn) pauseBtn.textContent = POMODORO.paused ? 'RESUME' : 'PAUSE';

                updatePomodoroDisplay();
                if (POMODORO.interval) clearInterval(POMODORO.interval);
                POMODORO.interval = setInterval(updatePomodoroDisplay, 100);
            } else {
                if (POMODORO.active) stopPomodoro();
            }
        });
    }
}

// V18.2: Listen for storage changes to sync tabs in real-time
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, namespace) {
        if (namespace === 'local') {
            if (changes.pomodoro || changes.pomodoroCompleted || changes.pomodoroAcknowledged) {
                loadPomodoroState();
            }
        }
    });
}

// V18.2: Sync state immediately when tab becomes visible
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
        loadPomodoroState();
    }
});


function updatePomodoroDisplay() {
    if (!POMODORO.active) return;

    var remaining;
    if (POMODORO.paused) {
        remaining = POMODORO.remaining;
    } else {
        remaining = POMODORO.endTime - Date.now();
    }

    if (remaining <= 0) {
        showPomodoroComplete();
        stopPomodoro();
        return;
    }

    var totalSecs = Math.ceil(remaining / 1000);
    var mins = Math.floor(totalSecs / 60);
    var secs = totalSecs % 60;
    var timeEl = document.getElementById('pomodoro-time');
    if (timeEl) {
        timeEl.textContent = mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
    }
}

function togglePomodoroPause() {
    if (!POMODORO.active) return;
    var pauseBtn = document.getElementById('pomodoro-pause');

    if (POMODORO.paused) {
        POMODORO.paused = false;
        POMODORO.endTime = Date.now() + POMODORO.remaining;
        if (pauseBtn) pauseBtn.textContent = 'PAUSE';
    } else {
        POMODORO.paused = true;
        POMODORO.remaining = POMODORO.endTime - Date.now();
        if (pauseBtn) pauseBtn.textContent = 'RESUME';
    }
    savePomodoroState(); // V18.1: Sync across tabs
}

function stopPomodoro() {
    POMODORO.active = false;
    POMODORO.paused = false;
    if (POMODORO.interval) {
        clearInterval(POMODORO.interval);
        POMODORO.interval = null;
    }
    var container = document.getElementById('pomodoro-container');
    if (container) container.classList.remove('active');
    savePomodoroState(); // V18.1: Sync across tabs
}

// V61: High-fidelity HUD notification for Pomodoro
function showPomodoroHUD() {
    var hud = document.getElementById('pomo-hud');
    var hudTime = document.getElementById('hud-time');
    if (!hud) return;

    if (hudTime) {
        var now = new Date();
        // 24h format for terminal feel
        hudTime.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    }

    hud.classList.add('active');

    // Auto-dismiss after 12 seconds
    setTimeout(function() {
        hud.classList.remove('active');
    }, 12000);
}

function showPomodoroComplete() {
    play8BitSound();

    // V18.2: Mark as needing acknowledgment in storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ pomodoroCompleted: true, pomodoroAcknowledged: false });
    }

    var modal = document.getElementById('pomodoro-complete-modal');
    var durationEl = document.getElementById('pomo-complete-duration');
    var timeEl = document.getElementById('pomo-complete-time');

    if (durationEl) {
        var totalSecs = Math.floor(POMODORO.originalDuration / 1000);
        var mins = Math.floor(totalSecs / 60);
        var secs = totalSecs % 60;
        durationEl.textContent = mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
    }

    if (timeEl) {
        var now = new Date();
        timeEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    if (modal) modal.style.display = 'block';

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('FOCUS COMPLETE', {
            body: 'Operator: Session finished. Time for a break!',
            icon: DYNAMIC_ICON_URL
        });
    }

    // V61: Trigger specialized Vinland HUD
    showPomodoroHUD();
}

// V18.2: Acknowledge Pomodoro completion (syncs across tabs)
function acknowledgePomodoroComplete() {
    var modal = document.getElementById('pomodoro-complete-modal');
    if (modal) modal.style.display = 'none';

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ pomodoroCompleted: false, pomodoroAcknowledged: true });
    }
}

/* =========================================
   AUDIO - Better sounds
   ========================================= */
function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

function playTypingSound() {
    if (!CONFIG.typing_sounds) return;
    try {
        var ctx = getAudioContext();

        // CRITICAL FIX: Resume AudioContext if suspended by Chrome autoplay policy
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        var osc = ctx.createOscillator();
        var gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        // Softer, more pleasant click sound
        // Mechanical keyboard style "thock"
        osc.frequency.value = 400 + Math.random() * 50;
        osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.04);
        osc.type = 'triangle';

        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.04);
    } catch (e) {
        console.error('Audio error:', e);
    }
}



function play8BitSound() {
    try {
        var ctx = getAudioContext();
        var now = ctx.currentTime;

        // 8-bit victory melody
        var notes = [523, 659, 784, 1047, 784, 1047];
        var durations = [0.1, 0.1, 0.1, 0.2, 0.1, 0.3];
        var t = now;

        notes.forEach(function (freq, i) {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.frequency.value = freq;
            osc.type = 'square';

            gain.gain.setValueAtTime(0.08, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + durations[i] * 0.9);

            osc.start(t);
            osc.stop(t + durations[i]);

            t += durations[i];
        });
    } catch (e) { }
}

// V62: UI SOUND EFFECTS
function playClickSound() {
    if (!CONFIG.ui_sounds) return;
    try {
        var ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();

        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.05);
        osc.type = 'sine';

        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

        osc.start();
        osc.stop(ctx.currentTime + 0.05);
    } catch (e) { }
}

function playModalSound() {
    if (!CONFIG.ui_sounds) return;
    try {
        var ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();

        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.08);
        osc.type = 'triangle';

        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

        osc.start();
        osc.stop(ctx.currentTime + 0.08);
    } catch (e) { }
}

function playNotificationSound() {
    if (!CONFIG.ui_sounds) return;
    try {
        var ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();

        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.1);
        osc.type = 'sine';

        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    } catch (e) { }
}

/* =========================================
   COMMAND HISTORY
   ========================================= */
function addToHistory(cmd) {
    if (!cmd || !cmd.trim()) return;
    if (COMMAND_HISTORY.length > 0 && COMMAND_HISTORY[COMMAND_HISTORY.length - 1] === cmd) return;
    COMMAND_HISTORY.push(cmd);
    if (COMMAND_HISTORY.length > 50) COMMAND_HISTORY = COMMAND_HISTORY.slice(-50);
    saveData();
}

function showHistory() {
    var modal = document.getElementById('history-modal');
    var list = document.getElementById('history-list');
    if (!modal || !list) return;

    list.innerHTML = '';
    if (COMMAND_HISTORY.length === 0) {
        list.innerHTML = '<div style="color:#555; padding:10px;">No history yet.</div>';
    } else {
        COMMAND_HISTORY.slice(-20).reverse().forEach(function (cmd) {
            var div = document.createElement('div');
            div.style.cssText = 'padding:10px; border-bottom:1px solid #222; color:#888; font-size:0.85rem; cursor:pointer;';
            div.textContent = cmd;
            div.onclick = function () {
                var input = document.getElementById('cmd-input');
                if (input) input.value = cmd;
                modal.style.display = 'none';
                if (input) input.focus();
            };
            list.appendChild(div);
        });
    }
    modal.style.display = 'block';
}

/* =========================================
   BOOKMARKS
   ========================================= */
function indexBookmarks() {
    var container = document.getElementById('bookmarks-container');
    if (!container) return;

    if (typeof chrome === 'undefined' || !chrome.bookmarks || CONFIG.show_bookmarks === false) {
        container.classList.remove('active');
        return;
    }

    container.classList.add('active');
    renderBottomBar(ROOT_ID);

    try {
        chrome.bookmarks.getTree(function (tree) {
            FLAT_BOOKMARKS = [];
            function traverse(node) {
                if (node.title) {
                    FLAT_BOOKMARKS.push({
                        title: node.title,
                        url: node.url || null,
                        id: node.id,
                        type: node.url ? 'bookmark' : 'folder'
                    });
                }
                if (node.children) node.children.forEach(traverse);
            }
            if (tree[0] && tree[0].children) tree[0].children.forEach(traverse);
        });
    } catch (e) { }
}

function renderBottomBar(folderId) {
    CURRENT_BOOKMARK_FOLDER = folderId;
    var container = document.getElementById('bookmarks-container');
    if (!container || typeof chrome === 'undefined' || !chrome.bookmarks) return;

    container.innerHTML = '';

    try {
        chrome.bookmarks.getChildren(folderId, function (children) {
            // Always render back button first to prevent getting trapped
            if (NAV_STACK.length > 0) {
                var backBtn = document.createElement('div');
                backBtn.className = 'nav-back';
                backBtn.textContent = '[ < BACK ]';
                backBtn.onclick = function () { renderBottomBar(NAV_STACK.pop()); };
                container.appendChild(backBtn);
            } else {
                var label = document.createElement('span');
                label.className = 'nav-back';
                label.style.color = 'var(--main-color)';
                label.textContent = 'ROOT //';
                container.appendChild(label);
            }

            // Handle empty folders
            if (!children || children.length === 0) {
                var emptyMsg = document.createElement('span');
                emptyMsg.style.color = 'var(--dim-color)';
                emptyMsg.style.fontStyle = 'italic';
                emptyMsg.textContent = '[ EMPTY FOLDER ]';
                container.appendChild(emptyMsg);
                return;
            }

            children.forEach(function (node) {
                var el;
                var text = node.title.length > 20 ? node.title.substring(0, 18) + '..' : node.title;

                if (node.url) {
                    el = document.createElement('a');
                    el.className = 'bm-node';
                    el.textContent = text;
                    el.href = node.url;
                } else {
                    el = document.createElement('div');
                    el.className = 'bm-node bm-folder';
                    el.textContent = '[ ' + text + ' ]';
                    el.onclick = (function (nodeId, currentFolderId) {
                        return function () {
                            NAV_STACK.push(currentFolderId);
                            renderBottomBar(nodeId);
                        };
                    })(node.id, folderId);
                }
                container.appendChild(el);
            });
        });
    } catch (e) { }
}

/* =========================================
   SETTINGS MODAL
   ========================================= */
function toggleConfig() {
    var modal = document.getElementById('config-modal');
    var helpModal = document.getElementById('help-modal');
    // V19.22: Check for .active class instead of display: block (modal uses display: flex)
    if (modal.classList.contains('active')) {
        closeSettingsModal(); // Use centralized closing logic
    } else {
        if (helpModal) helpModal.style.display = 'none';
        openConfig();
    }
}

function toggleHelp() {
    var modal = document.getElementById('help-modal');
    if (!modal) return;

    if (modal.classList.contains('active')) {
        ModalManager.closeTop(true);
    } else {
        ModalManager.open('help-modal');
    }
}

var isConfigLoading = false; // V19.4: Prevent dirty flag during init

function openConfig() {
    isConfigLoading = true; // V19.4: Start loading
    var el;

    el = document.getElementById('cfg-name'); if (el) el.value = CONFIG.user_name || '';
    el = document.getElementById('cfg-color'); if (el) el.value = CONFIG.theme_color || '#00FF41';
    el = document.getElementById('cfg-crt'); if (el) el.checked = CONFIG.crt_effect === true;
    el = document.getElementById('cfg-vignette'); if (el) el.checked = CONFIG.vignette_effect === true;
    el = document.getElementById('cfg-noise'); if (el) el.checked = CONFIG.noise_effect === true;
    el = document.getElementById('cfg-sounds'); if (el) el.checked = CONFIG.typing_sounds === true;
    el = document.getElementById('cfg-ui-sounds'); if (el) el.checked = CONFIG.ui_sounds === true;
    el = document.getElementById('cfg-notes-tabs-enabled'); if (el) el.checked = CONFIG.notes_tabs_enabled !== false;
    el = document.getElementById('cfg-show-seconds'); if (el) el.checked = CONFIG.show_seconds;
    el = document.getElementById('cfg-auto-clear-interval'); if (el) el.value = CONFIG.auto_clear_interval || 'daily';
    el = document.getElementById('cfg-hide-completed'); if (el) el.checked = CONFIG.hide_completed_tasks;
    el = document.getElementById('cfg-blur-overlay'); if (el) el.checked = CONFIG.enable_blur_overlay !== false;
    el = document.getElementById('cfg-show-bm'); if (el) el.checked = CONFIG.show_bookmarks !== false;

    // Render theme presets (V17)
    renderThemePresets();

    el = document.getElementById('cfg-engine'); if (el) el.value = CONFIG.search_engine || 'google';
    el = document.getElementById('cfg-location'); if (el) el.value = CONFIG.location || '';
    el = document.getElementById('cfg-celsius'); if (el) el.checked = CONFIG.use_celsius === true;
    el = document.getElementById('cfg-weather-extended'); if (el) el.checked = CONFIG.weather_extended === true;
    el = document.getElementById('cfg-weather-scale'); if (el) { el.value = CONFIG.weather_scale || 1.0; updateSliderValue('cfg-weather-scale'); }

    // Integrations
    el = document.getElementById('cfg-habit'); if (el) el.value = CONFIG.habit_id || '';
    el = document.getElementById('cfg-life'); if (el) el.value = CONFIG.life_id || '';
    el = document.getElementById('cfg-trello'); if (el) el.value = CONFIG.trello_board || '';
    el = document.getElementById('cfg-notion'); if (el) el.value = CONFIG.notion_page || '';
    el = document.getElementById('cfg-github'); if (el) el.value = CONFIG.github_user || '';

    // Appearance
    el = document.getElementById('cfg-clock-size'); if (el) { el.value = CONFIG.clock_font_size || 7; updateSliderValue('cfg-clock-size'); }
    // Secondary Style
    el = document.getElementById('cfg-secondary-color'); if (el) el.value = CONFIG.secondary_color || '#888888';
    el = document.getElementById('cfg-font-secondary'); if (el) el.value = CONFIG.secondary_font || 'Space Mono';

    // Fonts
    // Fonts
    el = document.getElementById('cfg-font'); if (el) el.value = CONFIG.clock_font || 'Space Mono';
    el = document.getElementById('cfg-theme-preset'); if (el) el.value = CONFIG.theme_preset || '';

    // Backgrounds
    el = document.getElementById('cfg-backgrounds'); if (el) el.value = (CONFIG.backgrounds || []).join('\n');
    el = document.getElementById('cfg-bg-type'); if (el) el.value = CONFIG.background_type || 'media';
    el = document.getElementById('cfg-bg-color'); if (el) el.value = CONFIG.background_color || '#000000';

    // Filter settings
    // Filter settings
    el = document.getElementById('cfg-filter-enabled'); if (el) el.checked = CONFIG.filter_enabled !== false;
    el = document.getElementById('cfg-grayscale'); if (el) { el.value = CONFIG.filter_grayscale !== undefined ? CONFIG.filter_grayscale : 100; updateSliderValue('cfg-grayscale'); }
    el = document.getElementById('cfg-contrast'); if (el) { el.value = CONFIG.filter_contrast !== undefined ? CONFIG.filter_contrast : 120; updateSliderValue('cfg-contrast'); }
    el = document.getElementById('cfg-brightness'); if (el) { el.value = CONFIG.filter_brightness !== undefined ? CONFIG.filter_brightness : 60; updateSliderValue('cfg-brightness'); }
    el = document.getElementById('cfg-blur'); if (el) { el.value = CONFIG.filter_blur !== undefined ? CONFIG.filter_blur : 0; updateSliderValue('cfg-blur'); }

    renderDockEditor();
    renderCustomCommandsUI();
    ModalManager.open('config-modal');

    // V19.32: Initialize tab system - start on Interface (merged with Quick Access)
    switchSettingsTab('interface');

    // V18.13: Populate JSON dump
    var jsonDump = document.getElementById('cfg-json-dump');
    if (jsonDump) jsonDump.value = JSON.stringify(CONFIG, null, 2);

    // V21: Bind dirty tracking listener NOW that modal is in DOM and visible
    var configModal = document.getElementById('config-modal');
    if (configModal && !configModal.dataset.dirtyTrackingBound) {
        var markDirty = function () {
            if (!isConfigLoading) {
                CONFIG_DIRTY = true;
                console.log('[VINLAND] CONFIG_DIRTY = true'); // Debug
                var saveBtn = document.getElementById('header-save-btn');
                if (saveBtn) {
                    saveBtn.innerText = 'SAVE*';
                    saveBtn.style.boxShadow = '0 0 10px var(--main-color)';
                }
            }
        };
        configModal.addEventListener('input', markDirty);
        configModal.addEventListener('change', markDirty);
        configModal.dataset.dirtyTrackingBound = 'true';

    }

    // V14.4: Finished loading, enable dirty tracking
    setTimeout(function () {
        isConfigLoading = false;
        CONFIG_DIRTY = false;
        resetSaveButtonState();

    }, 150); // V21: Increased from 50ms for complex renders
}

// V18.13: Switch between settings tabs
function switchSettingsTab(tabId) {
    // Update nav items
    document.querySelectorAll('.config-nav-item').forEach(function (item) {
        item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
    });
    // Update tab content
    document.querySelectorAll('.config-tab').forEach(function (tab) {
        tab.classList.toggle('active', tab.id === 'tab-' + tabId);
    });
}

// V18.13: Filter settings by search query
function filterSettings(query) {
    var q = query.toLowerCase().trim();
    // V19.32: Merged quick-access terms into interface
    var tabs = {
        'interface': ['color', 'theme', 'blur', 'hide', 'completed', 'font', 'clock', 'size', 'secondary', 'sounds', 'crt', 'scanlines', 'vignette', 'noise', 'grain', 'grayscale', 'contrast', 'brightness', 'filter', 'background', 'media', 'wallpaper', 'video', 'appearance'],
        'notes': ['tabs', 'editor', 'notes', 'sidebar', 'navigation', 'link', 'style'],
        'system': ['name', 'operator', 'search', 'engine', 'bookmarks', 'weather', 'location', 'celsius', 'seconds'],
        'modules': ['task', 'auto-clear', 'dock', 'links', 'command', 'trigger', 'habit', 'trello', 'notion', 'github', 'gemini', 'integrations'],
        'maintenance': ['export', 'import', 'backup', 'reset', 'clear', 'factory', 'json', 'config', 'raw', 'data', 'advanced']
    };

    var navItems = document.querySelectorAll('.config-nav-item');
    var firstMatch = null;

    navItems.forEach(function (item) {
        var tabId = item.getAttribute('data-tab');
        var keywords = tabs[tabId] || [];
        var matches = !q || keywords.some(function (k) { return k.includes(q); });
        item.classList.toggle('hidden', !matches);
        if (matches && !firstMatch) firstMatch = tabId;
    });

    // Auto-switch to first matching tab if searching
    if (q && firstMatch) {
        switchSettingsTab(firstMatch);
    }
}

function updateSliderValue(id) {
    var slider = document.getElementById(id);
    var valEl = document.getElementById(id + '-val');
    if (slider && valEl) {
        var val = slider.value;
        if (id === 'cfg-blur') valEl.textContent = val + 'px';
        else if (id === 'cfg-clock-size') valEl.textContent = val + 'rem';
        else if (id === 'cfg-weather-scale') valEl.textContent = (val * 100).toFixed(0) + '%';
        else valEl.textContent = val + '%';
    }
}

function renderDockEditor() {
    var list = document.getElementById('dock-list');
    if (!list) return;
    list.innerHTML = '';

    if (!CONFIG.dock_links || !Array.isArray(CONFIG.dock_links)) return;

    CONFIG.dock_links.forEach(function (link, idx) {
        var item = document.createElement('div');
        item.className = 'dock-item';
        item.innerHTML = '<span class="drag-handle">=</span>' +
            '<input type="text" value="' + safeText(link.name) + '" data-field="name" data-idx="' + idx + '" name="dock_name_' + idx + '">' +
            '<input type="text" value="' + safeText(link.url) + '" data-field="url" data-idx="' + idx + '" name="dock_url_' + idx + '">' +
            '<span class="remove-btn" data-idx="' + idx + '">X</span>';
        list.appendChild(item);
    });

    list.querySelectorAll('input').forEach(function (input) {
        input.onchange = function (e) {
            var idx = parseInt(e.target.getAttribute('data-idx'));
            var field = e.target.getAttribute('data-field');
            if (CONFIG.dock_links[idx]) CONFIG.dock_links[idx][field] = e.target.value;
        };
    });

    list.querySelectorAll('.remove-btn').forEach(function (btn) {
        btn.onclick = function (e) {
            var idx = parseInt(e.target.getAttribute('data-idx'));
            CONFIG.dock_links.splice(idx, 1);
            renderDockEditor();
        };
    });
}

function addDockLink() {
    var nameEl = document.getElementById('new-dock-name');
    var urlEl = document.getElementById('new-dock-url');
    var name = nameEl ? nameEl.value.trim() : '';
    var url = urlEl ? validateURL(urlEl.value.trim()) : '';

    if (name && url) {
        if (!CONFIG.dock_links) CONFIG.dock_links = [];
        CONFIG.dock_links.push({ name: name, url: url });
        if (nameEl) nameEl.value = '';
        if (urlEl) urlEl.value = '';
        renderDockEditor();
    }
}

function renderCustomCommandsUI() {
    var list = document.getElementById('custom-cmd-list');
    if (!list) return;
    list.innerHTML = '';

    if (!CONFIG.custom_commands || !Array.isArray(CONFIG.custom_commands)) return;

    CONFIG.custom_commands.forEach(function (cmd, index) {
        var row = document.createElement('div');
        row.className = 'cmd-row';
        row.innerHTML = '<input type="text" value="' + safeText(cmd.trigger) + '" disabled name="cmd_trigger_' + index + '">' +
            '<input type="text" value="' + safeText(cmd.url) + '" disabled name="cmd_url_' + index + '">' +
            '<span class="remove-cmd" data-idx="' + index + '">X</span>';
        list.appendChild(row);
    });

    list.querySelectorAll('.remove-cmd').forEach(function (btn) {
        btn.onclick = function (e) {
            var idx = parseInt(e.target.getAttribute('data-idx'));
            CONFIG.custom_commands.splice(idx, 1);
            renderCustomCommandsUI();
        };
    });
}

// NEW: FILE UPLOADER LOGIC
function triggerUpload() { document.getElementById('bg-file-input').click(); }

function handleFileUpload(e) {
    var files = e.target.files;
    var status = document.getElementById('upload-status');
    var textarea = document.getElementById('cfg-backgrounds');

    if (!files.length) return;

    status.textContent = "INGESTING...";
    status.style.color = "var(--main-color)";

    var processed = 0;
    Array.from(files).forEach(function (file) {
        DB.save(file.name, file).then(function () {
            // Add reference to list if not present
            var dbRef = 'db:' + file.name;
            if (textarea.value.indexOf(dbRef) === -1) {
                textarea.value += (textarea.value ? '\n' : '') + dbRef;
            }
            processed++;
            if (processed === files.length) {
                status.textContent = "UPLOAD COMPLETE";
                setTimeout(function () { status.textContent = ""; }, 3000);
            }
        }).catch(function (err) {
            console.error(err);
            status.textContent = "ERROR";
            status.style.color = "var(--danger-color)";
        });
    });
}

function showNotification(msg) {
    playNotificationSound(); // V62: UI Sound
    
    var existing = document.getElementById('notif-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'notif-toast';
    toast.textContent = msg;
    toast.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); background:var(--bg-overlay); border:1px solid var(--main-color); color:var(--main-color); padding:15px 30px; font-family:"Space Mono", monospace; font-size:14px; z-index:30000; box-shadow:0 0 20px rgba(0,0,0,0.5); opacity:0; transition:opacity 0.3s; pointer-events:none; backdrop-filter:blur(5px);';

    document.body.appendChild(toast);

    // Fade in
    requestAnimationFrame(function () {
        toast.style.opacity = '1';
    });

    // Remove after 3s
    setTimeout(function () {
        toast.style.opacity = '0';
        setTimeout(function () {
            if (toast.parentElement) toast.parentElement.removeChild(toast);
        }, 300);
    }, 3000);
}

function applyPreset() {
    var presetName = document.getElementById('cfg-theme-preset').value;
    var allThemes = Object.assign({}, THEME_PRESETS);

    // Include custom themes
    if (CONFIG.custom_themes) {
        CONFIG.custom_themes.forEach(function (ct) {
            allThemes[ct.id] = ct;
        });
    }

    if (!presetName || !allThemes[presetName]) return;

    var p = allThemes[presetName];

    // Apply main color to form AND CONFIG
    document.getElementById('cfg-color').value = p.theme_color;
    CONFIG.theme_color = p.theme_color; // V19.23: Update CONFIG

    // Apply secondary color (V17)
    if (p.secondary_color && document.getElementById('cfg-secondary-color')) {
        document.getElementById('cfg-secondary-color').value = p.secondary_color;
        CONFIG.secondary_color = p.secondary_color; // V19.23: Update CONFIG
    }

    // Apply fonts (V17)
    if (p.clock_font && document.getElementById('cfg-font')) {
        document.getElementById('cfg-font').value = p.clock_font;
        CONFIG.clock_font = p.clock_font; // V19.23: Update CONFIG
    }
    if (p.secondary_font && document.getElementById('cfg-font-secondary')) {
        document.getElementById('cfg-font-secondary').value = p.secondary_font;
        CONFIG.secondary_font = p.secondary_font; // V19.23: Update CONFIG
    }

    // Set filters - form AND CONFIG
    if (document.getElementById('cfg-grayscale')) {
        document.getElementById('cfg-grayscale').value = p.filter_grayscale || 0;
        CONFIG.filter_grayscale = p.filter_grayscale || 0; // V19.23
    }
    if (document.getElementById('cfg-contrast')) {
        document.getElementById('cfg-contrast').value = p.filter_contrast || 100;
        CONFIG.filter_contrast = p.filter_contrast || 100; // V19.23
    }
    if (document.getElementById('cfg-brightness')) {
        document.getElementById('cfg-brightness').value = p.filter_brightness || 100;
        CONFIG.filter_brightness = p.filter_brightness || 100; // V19.23
    }

    // Apply CRT effect if specified
    if (p.crt_effect !== undefined && document.getElementById('cfg-crt')) {
        document.getElementById('cfg-crt').checked = p.crt_effect;
        CONFIG.crt_effect = p.crt_effect; // V19.23: Update CONFIG
    }

    // Update sliders UI
    updateSliderValue('cfg-grayscale');
    updateSliderValue('cfg-contrast');
    updateSliderValue('cfg-brightness');

    // Save selection
    CONFIG.theme_preset = presetName;

    // V19.31: Clarify that preset is selected, not applied until SAVE
    showNotification("THEME SELECTED // " + (p.name || presetName.toUpperCase()) + " // SAVE TO APPLY");
}

/* =========================================
   THEME UTILITIES (V17.0)
   ========================================= */
function saveCustomTheme() {
    openThemeModal('save', 'SAVE_THEME //', 'THEME NAME:', '', function (value) {
        if (!value || !value.trim()) return;

        var themeId = 'custom_' + Date.now();
        var customTheme = {
            id: themeId,
            name: value.trim(),
            theme_color: CONFIG.theme_color,
            secondary_color: CONFIG.secondary_color || "#888888",
            clock_font: CONFIG.clock_font || "Space Mono",
            secondary_font: CONFIG.secondary_font || "'Space Mono', monospace",
            filter_grayscale: CONFIG.filter_grayscale,
            filter_contrast: CONFIG.filter_contrast,
            filter_brightness: CONFIG.filter_brightness,
            filter_blur: CONFIG.filter_blur,
            crt_effect: CONFIG.crt_effect,
            vignette_effect: CONFIG.vignette_effect,
            noise_effect: CONFIG.noise_effect
        };

        if (!CONFIG.custom_themes) CONFIG.custom_themes = [];
        CONFIG.custom_themes.push(customTheme);
        saveConfig();
        renderThemePresets();
        showNotification("CUSTOM THEME SAVED // " + value.toUpperCase());
    });
}

// V19.28: Update existing custom theme in place
// Reads directly from form fields so user can update without pressing SAVE first
function updateCustomTheme() {
    var select = document.getElementById('cfg-theme-preset');
    if (!select) return;

    var themeId = select.value;
    if (!themeId || !themeId.startsWith('custom_')) {
        showNotification("ERROR // Select a custom theme first");
        return;
    }

    if (!CONFIG.custom_themes) return;

    // Find the theme
    var theme = CONFIG.custom_themes.find(function (t) { return t.id === themeId; });
    if (!theme) {
        showNotification("ERROR // Theme not found");
        return;
    }

    // Read directly from form fields (not CONFIG)
    var el;
    el = document.getElementById('cfg-color');
    theme.theme_color = el ? el.value.trim() || "#00FF41" : theme.theme_color;

    el = document.getElementById('cfg-secondary-color');
    theme.secondary_color = el ? el.value.trim() || "#888888" : theme.secondary_color;

    el = document.getElementById('cfg-font');
    theme.clock_font = el ? el.value : theme.clock_font;

    el = document.getElementById('cfg-font-secondary');
    theme.secondary_font = el ? el.value : theme.secondary_font;

    el = document.getElementById('cfg-grayscale');
    theme.filter_grayscale = el ? parseInt(el.value) || 0 : theme.filter_grayscale;

    el = document.getElementById('cfg-contrast');
    theme.filter_contrast = el ? parseInt(el.value) || 100 : theme.filter_contrast;

    el = document.getElementById('cfg-brightness');
    theme.filter_brightness = el ? parseInt(el.value) || 100 : theme.filter_brightness;

    el = document.getElementById('cfg-blur');
    theme.filter_blur = el ? parseInt(el.value) || 0 : theme.filter_blur;

    el = document.getElementById('cfg-crt');
    theme.crt_effect = el ? el.checked : theme.crt_effect;

    el = document.getElementById('cfg-vignette');
    theme.vignette_effect = el ? el.checked : theme.vignette_effect;

    el = document.getElementById('cfg-noise');
    theme.noise_effect = el ? el.checked : theme.noise_effect;

    saveConfig();
    showNotification("THEME UPDATED // " + theme.name.toUpperCase());
}

function deleteCustomTheme(themeId) {
    if (!CONFIG.custom_themes) return;
    CONFIG.custom_themes = CONFIG.custom_themes.filter(function (t) { return t.id !== themeId; });
    saveConfig();
    renderThemePresets();
    showNotification("THEME DELETED");
}

function exportTheme() {
    var themeData = {
        name: CONFIG.user_name ? CONFIG.user_name + "'s Theme" : "Exported Theme",
        theme_color: CONFIG.theme_color,
        secondary_color: CONFIG.secondary_color,
        clock_font: CONFIG.clock_font,
        secondary_font: CONFIG.secondary_font,
        filter_grayscale: CONFIG.filter_grayscale,
        filter_contrast: CONFIG.filter_contrast,
        filter_brightness: CONFIG.filter_brightness,
        filter_blur: CONFIG.filter_blur,
        crt_effect: CONFIG.crt_effect,
        vignette_effect: CONFIG.vignette_effect,
        noise_effect: CONFIG.noise_effect
    };

    var jsonStr = JSON.stringify(themeData, null, 2);
    openThemeModal('export', 'EXPORT_THEME //', 'COPY THE JSON BELOW:', jsonStr, function () {
        navigator.clipboard.writeText(jsonStr).then(function () {
            showNotification("THEME COPIED TO CLIPBOARD");
            closeThemeModal();
        }).catch(function () {
            showNotification("COPY FAILED - SELECT AND COPY MANUALLY");
        });
    });
}

function importTheme() {
    openThemeModal('import', 'IMPORT_THEME //', 'PASTE THEME JSON:', '', function (value) {
        if (!value) return;

        try {
            var themeData = JSON.parse(value);
            if (!themeData.theme_color) {
                showNotification("INVALID THEME FORMAT");
                return;
            }

            // Apply imported values
            CONFIG.theme_color = themeData.theme_color;
            if (themeData.secondary_color) CONFIG.secondary_color = themeData.secondary_color;
            if (themeData.clock_font) CONFIG.clock_font = themeData.clock_font;
            if (themeData.secondary_font) CONFIG.secondary_font = themeData.secondary_font;
            if (themeData.filter_grayscale !== undefined) CONFIG.filter_grayscale = themeData.filter_grayscale;
            if (themeData.filter_contrast !== undefined) CONFIG.filter_contrast = themeData.filter_contrast;
            if (themeData.filter_brightness !== undefined) CONFIG.filter_brightness = themeData.filter_brightness;
            if (themeData.crt_effect !== undefined) CONFIG.crt_effect = themeData.crt_effect;
            if (themeData.vignette_effect !== undefined) CONFIG.vignette_effect = themeData.vignette_effect;
            if (themeData.noise_effect !== undefined) CONFIG.noise_effect = themeData.noise_effect;

            saveConfig();
            applyTheme();
            closeThemeModal();
            openConfig(); // Refresh config UI
            showNotification("THEME IMPORTED // " + (themeData.name || "CUSTOM"));
        } catch (e) {
            showNotification("IMPORT FAILED // INVALID JSON");
        }
    });
}

var themeModalCallback = null;
var themeModalMode = 'save';

function openThemeModal(mode, title, label, value, callback) {
    themeModalMode = mode;
    themeModalCallback = callback;

    var modal = document.getElementById('theme-modal');
    var titleEl = document.getElementById('theme-modal-title');
    var labelEl = document.getElementById('theme-modal-label');
    var inputEl = document.getElementById('theme-modal-input');
    var textareaEl = document.getElementById('theme-modal-textarea');
    var confirmBtn = document.getElementById('theme-modal-confirm');

    titleEl.textContent = title;
    labelEl.textContent = label;

    // Show/hide appropriate input based on mode
    if (mode === 'save') {
        inputEl.style.display = 'block';
        textareaEl.style.display = 'none';
        inputEl.value = value || '';
        confirmBtn.textContent = 'SAVE';
    } else if (mode === 'export') {
        inputEl.style.display = 'none';
        textareaEl.style.display = 'block';
        textareaEl.value = value || '';
        textareaEl.readOnly = true;
        confirmBtn.textContent = 'COPY TO CLIPBOARD';
    } else if (mode === 'import') {
        inputEl.style.display = 'none';
        textareaEl.style.display = 'block';
        textareaEl.value = value || '';
        textareaEl.readOnly = false;
        confirmBtn.textContent = 'IMPORT';
    } else if (mode === 'edit-note') {
        // V18.4: Note editing mode - textarea only
        inputEl.style.display = 'none';
        textareaEl.style.display = 'block';
        textareaEl.value = value || '';
        textareaEl.readOnly = false;
        textareaEl.placeholder = 'Enter note content...';
        confirmBtn.textContent = 'SAVE NOTE';
    }

    modal.classList.add('active');

    // Focus appropriate input
    setTimeout(function () {
        if (mode === 'save') inputEl.focus();
        else textareaEl.focus();
    }, 100);
}

function closeThemeModal() {
    var modal = document.getElementById('theme-modal');
    modal.classList.remove('active');
    themeModalCallback = null;
}

function handleThemeModalConfirm() {
    if (!themeModalCallback) return;

    var inputEl = document.getElementById('theme-modal-input');
    var textareaEl = document.getElementById('theme-modal-textarea');

    var value = themeModalMode === 'save' ? inputEl.value : textareaEl.value;
    themeModalCallback(value);

    if (themeModalMode === 'save' || themeModalMode === 'import' || themeModalMode === 'edit-note') {
        closeThemeModal();
    }
}

function checkAutoTheme() {
    if (!CONFIG.auto_theme_enabled) return;

    var hour = new Date().getHours();
    var dayStart = CONFIG.day_start_hour || 6;
    var nightStart = CONFIG.night_start_hour || 18;

    var isDay = hour >= dayStart && hour < nightStart;
    var targetTheme = isDay ? CONFIG.day_theme : CONFIG.night_theme;

    if (targetTheme && THEME_PRESETS[targetTheme]) {
        var p = THEME_PRESETS[targetTheme];
        CONFIG.theme_color = p.theme_color;
        CONFIG.secondary_color = p.secondary_color || CONFIG.secondary_color;
        CONFIG.clock_font = p.clock_font || CONFIG.clock_font;
        CONFIG.secondary_font = p.secondary_font || CONFIG.secondary_font;
        CONFIG.filter_grayscale = p.filter_grayscale;
        CONFIG.filter_contrast = p.filter_contrast;
        CONFIG.filter_brightness = p.filter_brightness;
        if (p.crt_effect !== undefined) CONFIG.crt_effect = p.crt_effect;
        applyTheme();
    }
}

function renderThemePresets() {
    var select = document.getElementById('cfg-theme-preset');
    if (!select) return;

    select.innerHTML = '<option value="">-- Select Theme --</option>';

    // Add built-in presets
    Object.keys(THEME_PRESETS).forEach(function (key) {
        var opt = document.createElement('option');
        opt.value = key;
        opt.textContent = THEME_PRESETS[key].name || key.toUpperCase();
        select.appendChild(opt);
    });

    // Add custom themes
    if (CONFIG.custom_themes && CONFIG.custom_themes.length > 0) {
        var optGroup = document.createElement('optgroup');
        optGroup.label = '-- CUSTOM THEMES --';
        CONFIG.custom_themes.forEach(function (ct) {
            var opt = document.createElement('option');
            opt.value = ct.id;
            opt.textContent = '[*] ' + ct.name;
            optGroup.appendChild(opt);
        });
        select.appendChild(optGroup);
    }

    // Set current value
    if (CONFIG.theme_preset) select.value = CONFIG.theme_preset;

    // Update delete button visibility
    updateDeleteThemeButton();
}

// V19.30: Handle header UPDATE and DELETE button visibility
function updateThemeButtons() {
    var deleteBtn = document.getElementById('btn-delete-theme');
    var headerUpdateBtn = document.getElementById('header-update-btn');
    var select = document.getElementById('cfg-theme-preset');
    if (!select) return;

    var selectedValue = select.value;
    var isCustom = selectedValue && selectedValue.startsWith('custom_');

    if (deleteBtn) deleteBtn.style.display = isCustom ? 'block' : 'none';
    if (headerUpdateBtn) headerUpdateBtn.style.display = isCustom ? 'inline-block' : 'none';
}

// Backward compatibility alias
function updateDeleteThemeButton() {
    updateThemeButtons();
}

function addCustomCommand() {
    var triggerEl = document.getElementById('new-cmd-trigger');
    var urlEl = document.getElementById('new-cmd-url');
    var trigger = triggerEl ? triggerEl.value.trim().toLowerCase() : '';
    var url = urlEl ? validateURL(urlEl.value.trim()) : '';

    if (trigger && url) {
        if (!CONFIG.custom_commands) CONFIG.custom_commands = [];
        CONFIG.custom_commands.push({ trigger: trigger, url: url });
        if (triggerEl) triggerEl.value = '';
        if (urlEl) urlEl.value = '';
        renderCustomCommandsUI();
    }
}

// V19.5: Deep Refresh for Visual Settings
function applyVisualSettings() {
    var root = document.documentElement;
    root.style.setProperty('--main-color', CONFIG.theme_color || '#00FF41');
    root.style.setProperty('--secondary-color', CONFIG.secondary_color || '#888888');
    root.style.setProperty('--main-font', CONFIG.clock_font || 'Space Mono');
    root.style.setProperty('--font-secondary', CONFIG.secondary_font || 'Space Mono');

    // V19.33: Removed hardcoded cyberpunk override so custom colors work
    // if (CONFIG.theme_preset === 'cyberpunk') ... removed
}

// V19.3: Dirty State Tracking
// V19.3: Dirty State Tracking - DELETED (Moved to top)

function closeSettingsModal(force) {
    console.log('[VINLAND] closeSettingsModal called. force:', force, ', CONFIG_DIRTY:', CONFIG_DIRTY);
    if (!force && CONFIG_DIRTY) {
        console.log('[VINLAND] Triggering UNSAVED CHANGES modal...');
        showConfirmModal(
            "SYSTEM_ALERT //",
            "You have unsaved changes in your configuration.<br><br>Do you want to save them before closing?",
            function () { 
                // DISCARD logic
                CONFIG_DIRTY = false; 
                loadConfig(); // Reload from storage
                applyVisualSettings(); 
                applyTheme(); 
                ModalManager.closeTop(true); 
            },
            function () { 
                // SAVE & CLOSE logic
                saveConfigFromUI(); 
                CONFIG_DIRTY = false; 
                resetSaveButtonState();
                ModalManager.closeTop(true); 
            }, 
            "DISCARD_CHANGES",
            "SAVE_SYSTEM_CONFIG"
        );
        return;
    }

    // V15.3+: If closing without save, ensure visuals match the last saved config
    if (CONFIG_DIRTY) {
        loadConfig();
        applyVisualSettings();
        applyTheme();
    }
    CONFIG_DIRTY = false;
    resetSaveButtonState();
    ModalManager.closeTop(true);
}

function saveConfigFromUI() {
    CONFIG_DIRTY = false; // Reset dirty state on save
    var saveBtn = document.getElementById('config-save-btn');
    var el;

    // Quick Access
    el = document.getElementById('cfg-color'); if (el) CONFIG.theme_color = el.value.trim() || '#00FF41';
    el = document.getElementById('cfg-theme-preset'); if (el) CONFIG.theme_preset = el.value;
    el = document.getElementById('cfg-hide-completed'); if (el) CONFIG.hide_completed_tasks = el.checked;
    el = document.getElementById('cfg-blur-overlay'); if (el) CONFIG.enable_blur_overlay = el.checked;

    // System
    el = document.getElementById('cfg-name'); if (el) CONFIG.user_name = el.value.trim();
    el = document.getElementById('cfg-engine'); if (el) CONFIG.search_engine = el.value;
    el = document.getElementById('cfg-show-bm'); if (el) CONFIG.show_bookmarks = el.checked;
    el = document.getElementById('cfg-show-seconds'); if (el) CONFIG.show_seconds = el.checked;
    el = document.getElementById('cfg-location'); if (el) CONFIG.location = el.value.trim();
    el = document.getElementById('cfg-celsius'); if (el) CONFIG.use_celsius = el.checked;
    el = document.getElementById('cfg-weather-extended'); if (el) CONFIG.weather_extended = el.checked;
    el = document.getElementById('cfg-weather-scale'); if (el) CONFIG.weather_scale = parseFloat(el.value);

    // Interface
    el = document.getElementById('cfg-font'); if (el) CONFIG.clock_font = el.value;
    el = document.getElementById('cfg-clock-size'); if (el) CONFIG.clock_font_size = parseInt(el.value);
    el = document.getElementById('cfg-secondary-color'); if (el) CONFIG.secondary_color = el.value;
    el = document.getElementById('cfg-font-secondary'); if (el) CONFIG.secondary_font = el.value;
    el = document.getElementById('cfg-sounds'); if (el) CONFIG.typing_sounds = el.checked;
    el = document.getElementById('cfg-ui-sounds'); if (el) CONFIG.ui_sounds = el.checked;

    // Video Filters
    el = document.getElementById('cfg-filter-enabled'); if (el) CONFIG.filter_enabled = el.checked;
    el = document.getElementById('cfg-crt'); if (el) CONFIG.crt_effect = el.checked;
    el = document.getElementById('cfg-vignette'); if (el) CONFIG.vignette_effect = el.checked;
    el = document.getElementById('cfg-noise'); if (el) CONFIG.noise_effect = el.checked;
    el = document.getElementById('cfg-grayscale'); if (el) CONFIG.filter_grayscale = parseInt(el.value);
    el = document.getElementById('cfg-contrast'); if (el) CONFIG.filter_contrast = parseInt(el.value);
    el = document.getElementById('cfg-brightness'); if (el) CONFIG.filter_brightness = parseInt(el.value);
    el = document.getElementById('cfg-blur'); if (el) CONFIG.filter_blur = parseInt(el.value);

    // Backgrounds
    el = document.getElementById('cfg-bg-type'); if (el) CONFIG.background_type = el.value;
    el = document.getElementById('cfg-bg-color'); if (el) CONFIG.background_color = el.value.trim() || '#000000';
    el = document.getElementById('cfg-backgrounds');
    if (el) {
        var rawBgs = el.value;
        CONFIG.backgrounds = rawBgs.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
    }

    // Modules
    el = document.getElementById('cfg-auto-clear-interval'); if (el) CONFIG.auto_clear_interval = el.value;
    el = document.getElementById('cfg-habit'); if (el) CONFIG.habit_id = el.value.trim();
    el = document.getElementById('cfg-life'); if (el) CONFIG.life_id = el.value.trim();
    el = document.getElementById('cfg-trello'); if (el) CONFIG.trello_board = el.value.trim();
    el = document.getElementById('cfg-notion'); if (el) CONFIG.notion_page = el.value.trim();
    el = document.getElementById('cfg-github'); if (el) CONFIG.github_user = el.value.trim();

    // Notes
    el = document.getElementById('cfg-notes-tabs-enabled'); if (el) CONFIG.notes_tabs_enabled = el.checked;

    saveConfig();
    // V19.5: Deep Refresh & Universal Instant Save
    applyVisualSettings();
    updateTime();
    renderMissions();
    // V63.4: Clear weather cache to force refresh with new location
    WEATHER_CACHE = null;
    if (typeof fetchWeather === 'function') fetchWeather();
    if (typeof renderDock === 'function') renderDock();
    if (typeof initIntegrations === 'function') initIntegrations();
    if (typeof applyTheme === 'function') applyTheme();
    if (typeof updateWeather === 'function') updateWeather();

    // V19.3: Reset dirty state and provide visual feedback
    CONFIG_DIRTY = false;
    resetSaveButtonState();
    // V63.4: Force TabManager to update if toggle changed
    if (typeof TabManager !== 'undefined') TabManager.init();

    showNotification('CONFIG_SAVED');
}

// V15.3: Standardized save button feedback
function resetSaveButtonState() {
    var headerSaveBtn = document.getElementById('header-save-btn');
    if (headerSaveBtn) {
        headerSaveBtn.innerText = 'SAVE';
        headerSaveBtn.style.color = '';
        headerSaveBtn.style.boxShadow = '';
    }
}



// Rate limiting for localStorage writes
var LAST_SAVE_TIME = 0;
var SAVE_RATE_LIMIT = 500; // ms

function rateLimitedSave(fn) {
    var now = Date.now();
    if (now - LAST_SAVE_TIME < SAVE_RATE_LIMIT) {
        return; // Skip save if too soon
    }
    LAST_SAVE_TIME = now;
    fn();
}

// Input sanitization for URLs (block javascript: protocol)
function sanitizeURL(url) {
    if (!url) return '';
    url = url.trim();
    if (url.toLowerCase().startsWith('javascript:')) {
        console.warn('Blocked dangerous URL:', url);
        return '';
    }
    return url;
}

// Custom confirmation modal
var pendingConfirmCallback = null;

// Helper to close modal and overlay
function closeConfirmModal() {
    ModalManager.closeTop(true);
}

function showConfirmModal(title, message, onConfirm, onSaveAndClose, actionLabel, saveLabel) {
    var modal = document.getElementById('confirm-modal');
    var titleEl = document.getElementById('confirm-title');
    var messageEl = document.getElementById('confirm-message');
    var okBtn = document.getElementById('confirm-ok');
    var saveBtn = document.getElementById('confirm-save-close');

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.innerHTML = message;

    // Default label is EXECUTE unless specified
    if (okBtn) okBtn.textContent = actionLabel || 'EXECUTE';
    if (saveBtn) saveBtn.textContent = saveLabel || 'SAVE & CLOSE';

    // Handle "SAVE & CLOSE" button visibility and binding
    if (saveBtn) {
        if (typeof onSaveAndClose === 'function') {
            saveBtn.style.display = 'inline-block';
            saveBtn.onclick = function () {
                if (typeof onSaveAndClose === 'function') {
                    try { onSaveAndClose(); } catch (e) { console.error('Save Callback Error:', e); }
                }
                closeConfirmModal();
            };
        } else {
            saveBtn.style.display = 'none';
        }
    }

    // DIRECT BINDING: Overwrite the previous click handler
    if (okBtn) {
        okBtn.onclick = function () {
            if (typeof onConfirm === 'function') {
                try { onConfirm(); } catch (e) { console.error('Confirm Callback Error:', e); }
            }
            closeConfirmModal();
        };
    }

    if (modal) {
        ModalManager.open('confirm-modal');
        // V23: Force Super Top Z-Index to ensure visibility over other modals
        modal.style.zIndex = '30000'; 
    }
}

// V3.9: Dedicated Modal for Deletion (Bypassing Scope/Callback issues)
function showDeleteConfirmModal(count) {
    var modal = document.getElementById('confirm-modal');
    var titleEl = document.getElementById('confirm-title');
    var messageEl = document.getElementById('confirm-message');
    var okBtn = document.getElementById('confirm-ok');

    if (titleEl) titleEl.textContent = 'DELETE SELECTED';
    if (messageEl) messageEl.innerHTML = 'Delete ' + count + ' notes? This cannot be undone.';

    // HARDWIRED BINDING - No Callbacks
    if (okBtn) {
        okBtn.onclick = null;
        okBtn.onclick = function () {
            console.log('DEBUG: Dedicated Delete EXECUTE Clicked');

            // Explicitly call the function
            if (Notes && typeof Notes.processBatchDelete === 'function') {
                Notes.processBatchDelete();
            } else {
                console.error('DEBUG: Notes.processBatchDelete missing!');
            }

            closeConfirmModal();
        };
    }

    if (modal) {
        modal.style.display = 'block';
        requestAnimationFrame(function () {
            modal.classList.add('active');
            var overlay = document.getElementById('modal-overlay');
            if (overlay) overlay.classList.add('active');
        });
    }
}

function setupConfirmModal() {
    var cancelBtn = document.getElementById('confirm-cancel');

    // Only bind Cancel statically
    if (cancelBtn) {
        cancelBtn.onclick = function () {
            closeConfirmModal();
        };
    }
}

function resetConfig() {
    showConfirmModal(
        'FACTORY RESET',
        'All settings, tasks, notes, and history will be permanently erased.<br>This action cannot be undone.',
        function () {
            localStorage.clear();
            if (typeof chrome !== 'undefined' && chrome.storage) {
                if (chrome.storage.sync) chrome.storage.sync.clear();
                if (chrome.storage.local) chrome.storage.local.clear();
            }
            location.reload();
        }
    );
}

function clearAllData() {
    showConfirmModal(
        'CLEAR ALL DATA',
        'This will clear all tasks, notes, and command history.<br>Your settings will remain intact.',
        function () {
            TASKS = []; NOTES = []; COMMAND_HISTORY = [];
            saveData();
            renderMissions();
            renderNotes();
        }
    );
}

function exportConfig() {
    var exportData = { config: CONFIG, tasks: TASKS, notes: NOTES, history: COMMAND_HISTORY };
    var dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
    var dlNode = document.createElement('a');
    dlNode.setAttribute('href', dataStr);
    dlNode.setAttribute('download', 'operator_backup.json');
    document.body.appendChild(dlNode);
    dlNode.click();
    dlNode.remove();
}

function importConfigFile(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (evt) {
        try {
            var imported = JSON.parse(evt.target.result);
            if (imported.config) { CONFIG = Object.assign({}, getDefaultConfig(), imported.config); saveConfig(); }
            if (imported.tasks) TASKS = imported.tasks;
            if (imported.notes) NOTES = imported.notes;
            if (imported.history) COMMAND_HISTORY = imported.history;
            saveData();
            location.reload();
        } catch (err) {
            alert('CORRUPT DATA FILE');
        }
    };
    reader.readAsText(file);
}

/* =========================================
   COLLAPSIBLE SECTIONS
   ========================================= */
function initCollapsibleSections() {
    document.querySelectorAll('.section-header').forEach(function (header) {
        header.onclick = function () {
            var sectionName = header.getAttribute('data-section');
            var body = document.getElementById('section-' + sectionName);
            if (body) {
                header.classList.toggle('collapsed');
                body.classList.toggle('collapsed');
            }
        };
    });
}

/* =========================================
   INPUT HANDLING
   ========================================= */
function handleInput(e) {
    var val = e.target.value;
    var hint = document.getElementById('command-hint');
    var suggestionsBox = document.getElementById('suggestions');

    // Removed playTypingSound() - now handled by global listener
    HISTORY_INDEX = -1;

    var valLower = val.toLowerCase();

    if (valLower.startsWith('task')) {
        hint.innerHTML = '<span class="hint-syntax">task [!!|!|~] [@category] [text] [time] or task [text] at [time]</span>';
        hint.style.display = 'block';
    } else if (valLower.startsWith('focus')) {
        hint.innerHTML = '<span class="hint-syntax">focus [25 | 1:30 | 90s]</span>';
        hint.style.display = 'block';
    } else if (valLower.startsWith('note')) {
        hint.innerHTML = '<span class="hint-syntax">note [text]</span>';
        hint.style.display = 'block';
    } else if (valLower.startsWith('done')) {
        hint.innerHTML = '<span class="hint-syntax">done [#]</span>';
        hint.style.display = 'block';
    } else if (valLower.startsWith('clear')) {
        hint.innerHTML = '<span class="hint-syntax">clear [tasks | task # | task name | notes | note # | all]</span>';
        hint.style.display = 'block';
    } else if (valLower.startsWith('hide')) {
        hint.innerHTML = '<span class="hint-syntax">hide done</span>';
        hint.style.display = 'block';
    } else if (valLower.startsWith('show')) {
        hint.innerHTML = '<span class="hint-syntax">show done</span>';
        hint.style.display = 'block';
    } else if (valLower.startsWith('quote')) {
        hint.innerHTML = '<span class="hint-syntax">quote - Display random motivational quote</span>';
        hint.style.display = 'block';
    } else if (valLower.startsWith('history')) {
        hint.innerHTML = '<span class="hint-syntax">history - Show command history</span>';
        hint.style.display = 'block';
    } else if (valLower.startsWith('gcal') || valLower.startsWith('gtasks') || valLower.startsWith('gmail') || valLower.startsWith('gdrive')) {
        hint.innerHTML = '<span class="hint-syntax">gcal | gtasks | gmail | gdrive | gdocs</span>';
        hint.style.display = 'block';
    } else if (valLower.startsWith('calc')) {
        hint.innerHTML = '<span class="hint-syntax">calc [expression]</span>';
        hint.style.display = 'block';
    } else {
        hint.innerHTML = '';
        hint.style.display = 'none';
    }

    if (CONFIG.show_bookmarks && val.toLowerCase().startsWith('b ') && val.length > 2) {
        var query = val.slice(2).toLowerCase();
        var matches = FLAT_BOOKMARKS.filter(function (b) { return b.title.toLowerCase().includes(query); }).slice(0, 8);
        CURRENT_SUGGESTIONS = matches;
        renderSuggestions(matches);
    } else {
        suggestionsBox.style.display = 'none';
        CURRENT_SUGGESTIONS = [];
    }
}

function renderSuggestions(matches) {
    var box = document.getElementById('suggestions');
    if (!box) return;
    box.innerHTML = '';
    SUGGESTION_INDEX = -1;

    if (!matches || matches.length === 0) {
        box.style.display = 'none';
        return;
    }

    matches.forEach(function (match, idx) {
        var div = document.createElement('div');
        div.className = 'suggestion-item';
        div.setAttribute('data-index', idx);
        var typeText = match.type === 'folder' ? 'FOLDER' : 'BOOKMARK';
        div.innerHTML = '<span>' + safeText(match.title) + '</span><span class="type-badge">' + typeText + '</span>';
        div.onclick = function () { 
            if (match.type === 'folder') {
                NAV_STACK.push(CURRENT_BOOKMARK_FOLDER);
                renderBottomBar(match.id);
                document.getElementById('cmd-input').value = '';
                document.getElementById('suggestions').style.display = 'none';
            } else if (match.url) {
                window.location.href = match.url; 
            }
        };
        box.appendChild(div);
    });
    box.style.display = 'block';
}

function updateSuggestionHighlight() {
    var box = document.getElementById('suggestions');
    if (!box) return;
    var items = box.querySelectorAll('.suggestion-item');
    items.forEach(function (item, i) {
        if (i === SUGGESTION_INDEX) item.classList.add('active');
        else item.classList.remove('active');
    });
}

function handleKeydown(e) {
    var input = document.getElementById('cmd-input');
    var suggestionsBox = document.getElementById('suggestions');

    if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (CURRENT_SUGGESTIONS.length > 0 && suggestionsBox.style.display !== 'none') {
            SUGGESTION_INDEX = SUGGESTION_INDEX > 0 ? SUGGESTION_INDEX - 1 : CURRENT_SUGGESTIONS.length - 1;
            updateSuggestionHighlight();
        } else if (COMMAND_HISTORY.length > 0) {
            if (HISTORY_INDEX === -1) HISTORY_INDEX = COMMAND_HISTORY.length - 1;
            else if (HISTORY_INDEX > 0) HISTORY_INDEX--;
            input.value = COMMAND_HISTORY[HISTORY_INDEX] || '';
        }
        return;
    }

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (CURRENT_SUGGESTIONS.length > 0 && suggestionsBox.style.display !== 'none') {
            SUGGESTION_INDEX = SUGGESTION_INDEX < CURRENT_SUGGESTIONS.length - 1 ? SUGGESTION_INDEX + 1 : 0;
            updateSuggestionHighlight();
        } else if (HISTORY_INDEX !== -1) {
            if (HISTORY_INDEX < COMMAND_HISTORY.length - 1) {
                HISTORY_INDEX++;
                input.value = COMMAND_HISTORY[HISTORY_INDEX] || '';
            } else {
                HISTORY_INDEX = -1;
                input.value = '';
            }
        }
        return;
    }

    if (e.key === 'Enter') {
        if (SUGGESTION_INDEX >= 0 && CURRENT_SUGGESTIONS[SUGGESTION_INDEX]) {
            var selectedMatch = CURRENT_SUGGESTIONS[SUGGESTION_INDEX];
            if (selectedMatch.url) window.location.href = selectedMatch.url;
            return;
        }

        var raw = input.value.trim();
        if (!raw) return;

        addToHistory(raw);

        var funcMatch = raw.match(/^(\w+)\s*=\s*(\w+)\(\s*(.*?)\s*\)$/);
        if (funcMatch) {
            var baseCmd = funcMatch[1].toLowerCase();
            var action = funcMatch[2].toLowerCase();
            var args = funcMatch[3];
            if (baseCmd === 'task' && action === 'create') { addTask(args); input.value = ''; return; }
            if (baseCmd === 'mail' && action === 'create') { window.location.href = 'https://mail.google.com/mail/?view=cm&fs=1&su=' + encodeURIComponent(args); return; }
        }

        var firstSpace = raw.indexOf(' ');
        var cmd = firstSpace === -1 ? raw : raw.substring(0, firstSpace);
        var query = firstSpace === -1 ? '' : raw.substring(firstSpace + 1);
        var cmdLower = cmd.toLowerCase();

        if (cmdLower === 'help' || cmdLower === 'man') { ModalManager.open('help-modal'); input.value = ''; return; }
        if (cmdLower === 'history') { showHistory(); input.value = ''; return; }
        if (cmdLower === 'notes') { toggleNotesPanel(); input.value = ''; return; }
        if (cmdLower === 'focus') { startPomodoro(query); input.value = ''; return; }
        if (cmdLower === 'task') { if (query) addTask(query); else window.location.href = 'https://calendar.google.com/calendar/u/0/r/tasks'; input.value = ''; return; }
        if (cmdLower === 'note') { if (query) addNote(query); input.value = ''; return; }
        if (cmdLower === 'done') { var idx = parseInt(query) - 1; if (!isNaN(idx) && idx >= 0 && TASKS[idx]) toggleTaskComplete(idx); input.value = ''; return; }
        // V18.4: Hide/show completed tasks
        if (cmdLower === 'hide' && query.toLowerCase() === 'done') {
            CONFIG.hide_completed_tasks = true;
            saveConfig();
            renderMissions();
            showNotification('COMPLETED TASKS HIDDEN');
            input.value = '';
            return;
        }
        if (cmdLower === 'show' && query.toLowerCase() === 'done') {
            CONFIG.hide_completed_tasks = false;
            saveConfig();
            renderMissions();
            showNotification('COMPLETED TASKS VISIBLE');
            input.value = '';
            return;
        }
        if (cmdLower === 'clear') {
            var qLower = query.toLowerCase();
            if (qLower === 'notes' || qLower === 'note') {
                clearNotes();
            } else if (qLower.startsWith('note ') || qLower.startsWith('notes ')) {
                var noteNum = parseInt(query.split(' ')[1]) - 1;
                if (!isNaN(noteNum) && noteNum >= 0 && NOTES[noteNum]) {
                    NOTES.splice(noteNum, 1);
                    saveData();
                    renderNotes();
                    showNotification('NOTE ' + (noteNum + 1) + ' DELETED');
                }
            } else if (qLower.startsWith('task ')) {
                // V18.3: Clear task by number OR by name (supports duplicates)
                var taskArg = query.substring(5).trim(); // Remove 'task '
                var taskNum = parseInt(taskArg);

                if (!isNaN(taskNum) && taskNum > 0) {
                    // Clear by number
                    var idx = taskNum - 1;
                    if (idx >= 0 && TASKS[idx]) {
                        var deletedTask = TASKS[idx].text;
                        TASKS.splice(idx, 1);
                        saveData();
                        renderMissions();
                        updateProgressBar();
                        showNotification('TASK DELETED: ' + deletedTask.substring(0, 20));
                    } else {
                        showNotification('INVALID TASK NUMBER');
                    }
                } else {
                    // Clear by name (case-insensitive partial match)
                    var searchName = taskArg.toLowerCase();
                    var matchingIndices = [];
                    for (var i = 0; i < TASKS.length; i++) {
                        if (TASKS[i].text.toLowerCase().includes(searchName)) {
                            matchingIndices.push(i);
                        }
                    }
                    if (matchingIndices.length === 0) {
                        showNotification('NO MATCHING TASK FOUND');
                    } else if (matchingIndices.length === 1) {
                        var deletedTask = TASKS[matchingIndices[0]].text;
                        TASKS.splice(matchingIndices[0], 1);
                        saveData();
                        renderMissions();
                        updateProgressBar();
                        showNotification('TASK DELETED: ' + deletedTask.substring(0, 20));
                    } else {
                        // Multiple matches - delete all with confirmation style notification
                        var count = matchingIndices.length;
                        // Delete in reverse order to preserve indices
                        for (var j = matchingIndices.length - 1; j >= 0; j--) {
                            TASKS.splice(matchingIndices[j], 1);
                        }
                        saveData();
                        renderMissions();
                        updateProgressBar();
                        showNotification(count + ' MATCHING TASKS DELETED');
                    }
                }
            } else if (qLower === 'tasks' || qLower === 'task' || qLower === '') {
                TASKS = [];
                saveData();
                renderMissions();
                updateProgressBar(); // V18.3: Update progress bar after clearing
                showNotification('ALL TASKS CLEARED');
            } else if (qLower === 'history') {
                COMMAND_HISTORY = [];
                saveData();
            } else if (qLower === 'all') {
                clearAllData();
            }
            input.value = '';
            return;
        }
        if (cmdLower === 'weather') {
            if (query.toLowerCase().startsWith('set ')) {
                var newLoc = query.substring(4).trim();
                if (newLoc) {
                    CONFIG.location = newLoc;
                    WEATHER_CACHE = null; 
                    saveConfig();
                    fetchWeather();
                    showNotification('WEATHER LOCATION SET TO: ' + newLoc.toUpperCase());
                }
            } else {
                fetchWeather();
                showNotification('WEATHER REFRESHED');
            }
            input.value = '';
            return;
        }
        if (cmdLower === 'mail') { window.location.href = 'https://mail.google.com/mail/?view=cm&fs=1&su=' + encodeURIComponent(query); return; }
        if (cmdLower === 'sheet') {
            var queryLower = query.toLowerCase();
            if (queryLower === 'habit') {
                if (CONFIG.habit_id) window.location.href = 'https://docs.google.com/spreadsheets/d/' + CONFIG.habit_id;
                else showNotification('HABIT_SHEET_ID_NOT_SET // UPDATE CONFIG');
            } else if (queryLower === 'life') {
                if (CONFIG.life_id) window.location.href = 'https://docs.google.com/spreadsheets/d/' + CONFIG.life_id;
                else showNotification('LIFE_SHEET_ID_NOT_SET // UPDATE CONFIG');
            } else {
                window.location.href = 'https://docs.google.com/spreadsheets';
            }
            return;
        }
        if (cmdLower === 'trello') { if (CONFIG.trello_board) window.location.href = 'https://trello.com/b/' + CONFIG.trello_board; else window.location.href = 'https://trello.com'; return; }
        if (cmdLower === 'notion') { if (CONFIG.notion_page) window.location.href = 'https://notion.so/' + CONFIG.notion_page; else window.location.href = 'https://notion.so'; return; }
        if (cmdLower === 'github') { if (CONFIG.github_user) window.location.href = 'https://github.com/' + CONFIG.github_user; else window.location.href = 'https://github.com'; return; }

        // QUICK GOOGLE LINKS (V18.0)
        if (cmdLower === 'gcal' || cmdLower === 'calendar') { window.location.href = 'https://calendar.google.com'; return; }
        if (cmdLower === 'gtasks' || cmdLower === 'tasks') { window.location.href = 'https://tasks.google.com'; return; }
        if (cmdLower === 'gmail' || cmdLower === 'email') { window.location.href = 'https://mail.google.com'; return; }
        if (cmdLower === 'gdrive' || cmdLower === 'drive') { window.location.href = 'https://drive.google.com'; return; }
        if (cmdLower === 'gdocs' || cmdLower === 'docs') { window.location.href = 'https://docs.google.com'; return; }

        if (cmdLower === 'yt') { window.location.href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query); return; }

        // UTILITY COMMANDS (V14.0)
        if (cmdLower === 'roll' || cmdLower === 'dice') { showNotification("DICE ROLLED: " + (Math.floor(Math.random() * 6) + 1)); input.value = ''; return; }
        if (cmdLower === 'coin' || cmdLower === 'flip') { showNotification("COIN FLIP: " + (Math.random() > 0.5 ? "HEADS" : "TAILS")); input.value = ''; return; }
        if (cmdLower === 'quote') { showNotification(QUOTES[Math.floor(Math.random() * QUOTES.length)]); input.value = ''; return; }
        if (cmdLower === 'calc') {
            var result = safeCalculate(query);
            showNotification("RESULT: " + result);
            input.value = '';
            return;
        }

        if (cmdLower === 'b') {
            if (query && CURRENT_SUGGESTIONS.length > 0) {
                var selectedMatch = CURRENT_SUGGESTIONS[0];
                if (selectedMatch.type === 'folder') {
                    NAV_STACK.push(CURRENT_BOOKMARK_FOLDER);
                    renderBottomBar(selectedMatch.id);
                    input.value = '';
                    return;
                } else if (selectedMatch.url) {
                    window.location.href = selectedMatch.url;
                    return;
                }
            }
            // If no match, treat as search but without the 'b ' prefix
            if (query) {
                raw = query; // Bypass to default search
            } else {
                return;
            }
        }

        var custom = null;
        if (CONFIG.custom_commands && Array.isArray(CONFIG.custom_commands)) {
            custom = CONFIG.custom_commands.find(function (c) { return c.trigger === cmdLower; });
        }
        if (custom) {
            if (custom.url.startsWith('sys:')) {
                var sysAction = custom.url.split(':')[1];
                if (sysAction === 'note') addNote(query);
                else if (sysAction === 'task') addTask(query);
                input.value = '';
                return;
            }
            window.location.href = custom.url;
            return;
        }

        if (raw.startsWith('http://') || raw.startsWith('https://')) { window.location.href = raw; return; }

        var searchUrl;
        var engine = CONFIG.search_engine || 'google';
        switch (engine) {
            case 'ddg': searchUrl = 'https://duckduckgo.com/?q=' + encodeURIComponent(raw); break;
            case 'bing': searchUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(raw); break;
            case 'brave': searchUrl = 'https://search.brave.com/search?q=' + encodeURIComponent(raw); break;
            case 'perplexity': searchUrl = 'https://www.perplexity.ai/search?q=' + encodeURIComponent(raw); break;
            case 'chatgpt': searchUrl = 'https://chat.openai.com/?q=' + encodeURIComponent(raw); break;
            case 'youtube': searchUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(raw); break;
            default: searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(raw);
        }
        window.location.href = searchUrl;
    }
}

/* =========================================
   KEYBOARD SHORTCUTS (Fixed)
   ========================================= */
function initKeyboardShortcuts() {
    ModalManager.init(); // Initialize the centralized modal manager
    
    // V63.2: Initialize Tab Manager and Page Actions
    if (typeof TabManager !== 'undefined') TabManager.init();
    if (typeof PageActions !== 'undefined') PageActions.init();

    // V63.5: Capture-phase listener for CMD+Shift+X (close tab)
    document.addEventListener('keydown', function(e) {
        var isNotesActive = typeof ModalManager !== 'undefined' && ModalManager.stack.includes('note-editor-modal');
        if (!isNotesActive) return;
        
        // CMD+SHIFT+X: Close current tab
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'x' || e.key === 'X')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (typeof TabManager !== 'undefined' && TabManager.tabs.length > 0) {
                TabManager.closeTab(TabManager.activeIndex);
            }
            return;
        }
    }, true); // Capture phase
    
    // V63.5: Capture-phase listener for tab shortcuts (CMD+number)
    document.addEventListener('keydown', function(e) {
        var isNotesActive = typeof ModalManager !== 'undefined' && ModalManager.stack.includes('note-editor-modal');
        if (!isNotesActive) return;
        
        // CMD+1-9: Switch to tab by number (like Chrome/Notion)
        // V63.6: Only intercept if the tab exists and is NOT currently active
        // This allows double-pressing CMD+[num] to switch the browser tab itself
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && /^[1-9]$/.test(e.key)) {
            var tabIndex = parseInt(e.key, 10) - 1; // 0-indexed
            if (typeof TabManager !== 'undefined' && tabIndex < TabManager.tabs.length && TabManager.activeIndex !== tabIndex) {
                e.preventDefault();
                e.stopImmediatePropagation();
                TabManager.switchTo(tabIndex);
                return;
            }
        }
    }, true); // Capture phase

    document.addEventListener('keydown', function (e) {
        // Ctrl+K to focus CLI
        if (e.ctrlKey && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            var cmdInput = document.getElementById('cmd-input');
            if (cmdInput) cmdInput.focus();
            return;
        }

        // V63.2: Note Modal Shortcuts
        var isNotesActive = ModalManager.stack.includes('note-editor-modal');
        
        if (isNotesActive) {
            // CMD+D: Duplicate Note
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                if (typeof PageActions !== 'undefined') PageActions.duplicateNote();
                return;
            }
            
            // CMD+SHIFT+D: Delete Note (V63.4 Upgrade)
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                if (typeof PageActions !== 'undefined') PageActions.moveToTrash();
                return;
            }


            // CMD+P: Toggle Pin (Strictly)
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                if (typeof Notes !== 'undefined') Notes.togglePin();
                return;
            }
            
            // CMD+SHIFT+P: Move to (Focus Path) (V63.4 Upgrade)
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                if (typeof PageActions !== 'undefined') PageActions.focusPathInput();
                return;
            }
            
            // Arrow Navigation (only when not in input/textarea/contenteditable)
            var activeEl = document.activeElement;
            var isInput = activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true';
            
            if (!isInput && typeof TabManager !== 'undefined') {
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    TabManager.switchAdjacent(-1);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    TabManager.switchAdjacent(1);
                } else if (e.key === 'ArrowUp') {
                     // Find current active note in sidebar and move up
                     e.preventDefault();
                     navigateSidebar(-1);
                } else if (e.key === 'ArrowDown') {
                     // Find current active note in sidebar and move down
                     e.preventDefault();
                     navigateSidebar(1);
                }
            }
        }

        // Global '/' for CLI focus (with guards)
        var isKanbanActive = ModalManager.stack.includes('kanban-modal');
        
        if (e.key === '/' && !isNotesActive && !isKanbanActive && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.getAttribute('contenteditable') !== 'true') {
            e.preventDefault();
            var cmdInput2 = document.getElementById('cmd-input');
            if (cmdInput2) cmdInput2.focus();
            return;
        }
    }, true);
}

// V63.2: Helper for ArrowUp/Down navigation in Sidebar
function navigateSidebar(direction) {
    if (typeof Notes === 'undefined' || !Notes.activeNoteId) return;
    
    // Get visible note items
    var items = Array.from(document.querySelectorAll('.note-item'));
    if (items.length === 0) return;
    
    // Find current index
    // V63.4: Ensure we are traversing legitimate note items
    var currentIdx = items.findIndex(item => item.dataset.noteId === Notes.activeNoteId);
    
    var nextIdx;
    if (currentIdx === -1) {
        nextIdx = direction > 0 ? 0 : items.length - 1;
    } else {
        nextIdx = currentIdx + direction;
    }
    
    // Boundary checks
    if (nextIdx >= 0 && nextIdx < items.length) {
        var nextNoteId = items[nextIdx].dataset.noteId;
        Notes.open(nextNoteId, true); // V63.4: Pass skipFocus=true
        // Scroll sidebar to keep item in view
        items[nextIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

/* =========================================
   INITIALIZATION
   ========================================= */
function init() {
    loadConfig();
    loadData();
    applyTheme();

    // V63.4: Immediate feedback for Notes Tabs Toggle
    var tabsToggle = document.getElementById('cfg-notes-tabs-enabled');
    if (tabsToggle) {
        tabsToggle.onchange = function() {
            CONFIG.notes_tabs_enabled = tabsToggle.checked;
            if (typeof TabManager !== 'undefined') TabManager.init();
            // Still mark dirty for official save
            CONFIG_DIRTY = true;
            resetSaveButtonState();
        };
    }

    checkAutoTheme(); // V17 - Time-based theme switching
    checkStreakReset(); // V18 - Check if streak was broken
    updateProgressBar(); // V18 - Initialize progress bar
    loadPomodoroState(); // V18.1 - Restore pomodoro timer across tabs
    // V18.5: Check for interval-based auto-clear
    var today = new Date();
    var todayStr = today.toISOString().split('T')[0];

    if (CONFIG.auto_clear_interval && CONFIG.auto_clear_interval !== 'never') {
        var lastClear = CONFIG.last_clear_date ? new Date(CONFIG.last_clear_date) : null;
        var shouldClear = false;

        if (!lastClear) {
            // First run, set date but don't clear
            CONFIG.last_clear_date = todayStr;
            saveConfig();
        } else {
            var daysSinceLastClear = Math.floor((today - lastClear) / (1000 * 60 * 60 * 24));

            switch (CONFIG.auto_clear_interval) {
                case 'daily': shouldClear = daysSinceLastClear >= 1; break;
                case '2days': shouldClear = daysSinceLastClear >= 2; break;
                case 'weekly': shouldClear = daysSinceLastClear >= 7; break;
                case 'biweekly': shouldClear = daysSinceLastClear >= 14; break;
                case 'monthly': shouldClear = daysSinceLastClear >= 30; break;
            }

            if (shouldClear) {
                TASKS = [];
                saveData();
                CONFIG.last_clear_date = todayStr;
                saveConfig();
                showNotification('TASKS AUTO-CLEARED (' + CONFIG.auto_clear_interval.toUpperCase() + ')');
            }
        }
    }
    // V19.5: Initial Visual Application
    applyVisualSettings();

    // V19.34: Initialize Notes App V2
    if (typeof Notes !== 'undefined') {
        Notes.init();
        // V63.5: Removed auto-creation of Editor Manual - use Editor Guide modal instead
        // ensureEditorManual();
    }

    updateTime();
    setInterval(updateTime, 1000);
    updateTabTitle();
    renderMissions();
    renderNotes();
    renderDock();
    indexBookmarks();
    initBackground();
    fetchWeather();
    initCollapsibleSections();
    initKeyboardShortcuts();

    // Slider event listeners
    ['cfg-grayscale', 'cfg-contrast', 'cfg-brightness', 'cfg-blur'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.oninput = function () { updateSliderValue(id); };
    });

    // Clock size slider
    var clockSizeSlider = document.getElementById('cfg-clock-size');
    if (clockSizeSlider) {
        clockSizeSlider.oninput = function () {
            var valEl = document.getElementById('cfg-clock-size-val');
            if (valEl) valEl.textContent = clockSizeSlider.value + 'rem';
        };
    }

    // Setup confirmation modal
    setupConfirmModal();

    // V18.12: Click-outside-to-close for modals
    // DELETED: Logic moved to unified master listener in initKeyboardShortcuts/bindEvents

    // Setup theme modal (V17)
    var themeModalClose = document.getElementById('theme-modal-close');
    if (themeModalClose) themeModalClose.onclick = closeThemeModal;

    var themeModalCancel = document.getElementById('theme-modal-cancel');
    if (themeModalCancel) themeModalCancel.onclick = closeThemeModal;

    var themeModalConfirm = document.getElementById('theme-modal-confirm');
    if (themeModalConfirm) themeModalConfirm.onclick = handleThemeModalConfirm;

    // V18.5: Setup note editor modal closure
    var noteEditorClose = document.getElementById('note-editor-close');
    if (noteEditorClose) noteEditorClose.onclick = closeNoteEditor;

    // Weather toggle
    var weatherToggle = document.getElementById('weather-toggle');
    if (weatherToggle) {
        weatherToggle.onclick = function () {
            var extra = document.getElementById('weather-extra');
            if (extra) extra.classList.toggle('active');
        };
    }

    // NEW EVENT LISTENERS (V7.0)
    // Upload handlers
    var uploadBtn = document.getElementById('upload-bg-btn');
    if (uploadBtn) uploadBtn.onclick = triggerUpload;

    var fileInput = document.getElementById('bg-file-input');
    if (fileInput) fileInput.onchange = handleFileUpload;

    // Theme preset
    var presetSelect = document.getElementById('cfg-theme-preset');
    if (presetSelect) {
        presetSelect.onchange = function () {
            applyPreset();
            updateDeleteThemeButton();
        };
    }

    // Theme action buttons (V17 - CSP compliant)
    var btnSaveTheme = document.getElementById('btn-save-theme');
    if (btnSaveTheme) {
        btnSaveTheme.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            saveCustomTheme();
        });
    }

    // V19.30: Header Update Theme button
    var headerUpdateBtn = document.getElementById('header-update-btn');
    if (headerUpdateBtn) {
        headerUpdateBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            updateCustomTheme();
        });
    }

    var btnExportTheme = document.getElementById('btn-export-theme');
    if (btnExportTheme) {
        btnExportTheme.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            exportTheme();
        });
    }

    var btnImportTheme = document.getElementById('btn-import-theme');
    if (btnImportTheme) {
        btnImportTheme.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            importTheme();
        });
    }

    var btnDeleteTheme = document.getElementById('btn-delete-theme');
    if (btnDeleteTheme) btnDeleteTheme.onclick = function () {
        var select = document.getElementById('cfg-theme-preset');
        if (!select) return;
        var themeId = select.value;
        if (themeId && themeId.startsWith('custom_')) {
            deleteCustomTheme(themeId);
            select.value = '';
            updateDeleteThemeButton();
        }
    };

    if (CONFIG.clock_font) {
        document.documentElement.style.setProperty('--font-main', CONFIG.clock_font);
    }

    // Apply Secondary Styles
    var secColor = CONFIG.secondary_color || '#888888';
    document.documentElement.style.setProperty('--secondary-color', secColor);

    var secFont = CONFIG.secondary_font || 'Space Mono';
    document.documentElement.style.setProperty('--font-secondary', secFont);

    // Secondary Style Listeners
    var secColorInput = document.getElementById('cfg-secondary-color');
    // V14.8: Visual-only listeners (don't modify CONFIG directly to enable Discard rollback)
    if (secColorInput) secColorInput.oninput = function () {
        document.documentElement.style.setProperty('--secondary-color', this.value);
    };

    var secFontSelect = document.getElementById('cfg-font-secondary');
    if (secFontSelect) secFontSelect.onchange = function () {
        document.documentElement.style.setProperty('--font-secondary', this.value);
    };

    // Weather scale
    var weatherScaleSlider = document.getElementById('cfg-weather-scale');
    if (weatherScaleSlider) {
        weatherScaleSlider.oninput = function () {
            updateSliderValue('cfg-weather-scale');
            // Just update visuals, let saveConfigFromUI handle the persistence
        };
    }

    var clockSizeApp = document.getElementById('cfg-clock-size');
    if (clockSizeApp) {
        clockSizeApp.oninput = function () {
            updateSliderValue('cfg-clock-size');
        };
    }

    // Show welcome modal for first-time users
    if (CONFIG.first_run) {
        var welcomeModal = document.getElementById('welcome-modal');
        if (welcomeModal) welcomeModal.style.display = 'block';
    }

    // Notification permission
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // Event listeners
    var configBtn = document.getElementById('config-btn');
    if (configBtn) configBtn.onclick = toggleConfig;

    var helpBtn = document.getElementById('help-btn');
    if (helpBtn) helpBtn.onclick = toggleHelp;

    document.querySelectorAll('.close-modal').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation(); // Prevent event bubbling

            // Find the parent modal of this button
            var modal = btn.closest('.modal');
            if (modal) {
                // V14.6: Special Gatekeeper for Settings
                if (modal.id === 'config-modal') {
                    closeSettingsModal();
                    return;
                } else if (modal.id === 'note-editor-modal') {
                    Notes.closeEditor();
                } else if (modal.id === 'kanban-modal') {
                    KanbanManager.close();
                } else {
                    // V15.3+: Sync with ModalManager
                    if (ModalManager.stack[ModalManager.stack.length - 1] === modal.id) {
                        ModalManager.closeTop();
                    } else {
                        // Forcefully remove from stack if it was somehow obscured
                        ModalManager.stack = ModalManager.stack.filter(id => id !== modal.id);
                        modal.style.display = 'none';
                        modal.classList.remove('active');
                        if (ModalManager.stack.length === 0) {
                            var overlay = document.getElementById('modal-overlay');
                            if (overlay) overlay.classList.remove('active');
                        }
                    }
                }
            }
        };
    });
// V19.5: Header Save Button
var headerSaveBtn = document.getElementById('header-save-btn');
if (headerSaveBtn) headerSaveBtn.onclick = saveConfigFromUI;

// V19.5: Config Close X (Strict Gatekeeper)
var configCloseX = document.getElementById('config-close-x');
if (configCloseX) {
    configCloseX.onclick = function (e) {
        e.stopPropagation();
        closeSettingsModal();
    };
}

// V15.3+: REDUNDANT LISTENERS REMOVED.
// Modal closure logic is now centralized in ModalManager.init() (top of file).

// V15.3+: Bind Help Modal Close
var helpClose = document.getElementById('help-modal-close');
if (helpClose) helpClose.onmousedown = function(e) { e.preventDefault(); e.stopPropagation(); toggleHelp(); };

// Redundant handler removed - logic moved to initKeyboardShortcuts master listener

var resetBtn = document.getElementById('reset-config');
if (resetBtn) resetBtn.onclick = resetConfig;

var exportBtn = document.getElementById('export-config');
if (exportBtn) exportBtn.onclick = exportConfig;

var importBtn = document.getElementById('import-btn');
if (importBtn) importBtn.onclick = function () { document.getElementById('import-file').click(); };

var importFile = document.getElementById('import-file');
if (importFile) importFile.onchange = importConfigFile;

var clearDataBtn = document.getElementById('clear-data');
if (clearDataBtn) clearDataBtn.onclick = clearAllData;

var addDockBtn = document.getElementById('add-dock-btn');
if (addDockBtn) addDockBtn.onclick = addDockLink;

var addCmdBtn = document.getElementById('add-cmd-btn');
if (addCmdBtn) addCmdBtn.onclick = addCustomCommand;

// V18.13: BIOS Settings Tab Navigation
document.querySelectorAll('.config-nav-item').forEach(function (item) {
    item.onclick = function () {
        var tabId = item.getAttribute('data-tab');
        if (tabId) switchSettingsTab(tabId);
    };
});

// V18.13: Search filter
var configSearchInput = document.getElementById('config-search-input');
if (configSearchInput) {
    configSearchInput.oninput = function () {
        filterSettings(configSearchInput.value);
    };
}

// V18.13: Save & Close button
var saveCloseBtn = document.getElementById('config-save-close-btn');
if (saveCloseBtn) {
    saveCloseBtn.onclick = function () {
        saveConfigFromUI();
        closeSettingsModal(); // V19.3: Use centralized close logic (dirty flag is reset by save)
    };
}

// V18.13: Cancel button
var configCancelBtn = document.getElementById('config-cancel-btn');
if (configCancelBtn) {
    configCancelBtn.onclick = function () {
        closeSettingsModal(); // V19.3: Checks for dirty state
    };
}

// V18.13: Copy JSON to clipboard
var copyJsonBtn = document.getElementById('copy-config-json');
if (copyJsonBtn) {
    copyJsonBtn.onclick = function () {
        var jsonDump = document.getElementById('cfg-json-dump');
        if (jsonDump) {
            navigator.clipboard.writeText(jsonDump.value).then(function () {
                showNotification('CONFIG COPIED TO CLIPBOARD');
            });
        }
    };
}

var clearTasksBtn = document.getElementById('clear-tasks');
if (clearTasksBtn) clearTasksBtn.onclick = clearCompletedTasks;

var clearNotesBtn = document.getElementById('clear-notes');
if (clearNotesBtn) clearNotesBtn.onclick = function (e) {
    if (e) e.stopPropagation();
    clearNotes();
};

// V18.11: Add note button
var addNoteBtn = document.getElementById('add-note-btn');
if (addNoteBtn) addNoteBtn.onclick = function (e) {
    if (e) e.stopPropagation();
    openNewNoteEditor();
};

var pomoPauseBtn = document.getElementById('pomodoro-pause');
if (pomoPauseBtn) pomoPauseBtn.onclick = togglePomodoroPause;

var pomoStopBtn = document.getElementById('pomodoro-stop');
if (pomoStopBtn) pomoStopBtn.onclick = stopPomodoro;

var pomoDismissBtn = document.getElementById('pomo-dismiss-btn');
if (pomoDismissBtn) pomoDismissBtn.onclick = acknowledgePomodoroComplete;

var welcomeDismiss = document.getElementById('welcome-dismiss');
if (welcomeDismiss) welcomeDismiss.onclick = function () {
    CONFIG.first_run = false;
    saveConfig();
    document.getElementById('welcome-modal').style.display = 'none';
};

var input = document.getElementById('cmd-input');
if (input) {
    input.addEventListener('input', handleInput);
    input.addEventListener('keydown', handleKeydown);
    input.focus();
}

// V62: Global Input Listener for consistent typing sounds
document.addEventListener('input', function(e) {
    var t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) {
        playTypingSound();
    }
}, true);

// V18.11: Cross-tab synchronization
window.addEventListener('storage', function (e) {
    // Tasks or Notes changed in another tab
    if (e.key === 'OPERATOR_TASKS_V2' || e.key === 'OPERATOR_NOTES_V2') {
        loadData();
        renderMissions();
        renderNotes();
        updateProgressBar();
        
        // V63.5: Refresh open note if it was modified in another tab
        if (typeof Notes !== 'undefined' && Notes.activeNoteId) {
            var activeNote = NOTES.find(function(n) { return n.id === Notes.activeNoteId; });
            if (activeNote && typeof BlockEditor !== 'undefined') {
                BlockEditor.render(Notes.activeNoteId, true); // Skip focus to avoid disruption
            }
            Notes.renderSidebar();
        }
    }
    // Config changed in another tab
    else if (e.key === 'OPERATOR_CONFIG_V3') {
        loadConfig();
        applyTheme();
        renderDock();
    }
    // V63.5: Tabs changed in another tab
    else if (e.key === 'VINLAND_TABS') {
        if (typeof TabManager !== 'undefined' && CONFIG.notes_tabs_enabled !== false) {
            try {
                var data = JSON.parse(e.newValue);
                TabManager.tabs = data.tabs || [];
                
                // V63.5 FIX: Don't override this browser tab's activeIndex
                // Instead, find the current note's position in the new tabs array
                if (typeof Notes !== 'undefined' && Notes.activeNoteId) {
                    var currentNoteIndex = TabManager.tabs.findIndex(function(t) {
                        return t.noteId === Notes.activeNoteId;
                    });
                    if (currentNoteIndex !== -1) {
                        TabManager.activeIndex = currentNoteIndex;
                    }
                    // If current note not in tabs, keep the previous activeIndex or set to -1
                    else if (TabManager.activeIndex >= TabManager.tabs.length) {
                        TabManager.activeIndex = Math.max(0, TabManager.tabs.length - 1);
                    }
                }
                
                TabManager.render();
            } catch(err) {}
        }
    }
});

// V19.34: Sync Version from Manifest
try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        var manifest = chrome.runtime.getManifest();
        var verDisplay = document.getElementById('app-version-display');
        if (verDisplay && manifest.version) {
            verDisplay.textContent = 'OPERATOR NEW TAB v' + manifest.version + ' // 100% LOCAL EXECUTION';
        }
    }
} catch (e) {
    console.log('Version sync failed:', e);
}
}

/* =========================================
   SAFE CALCULATOR (CSP Compliant)
   ========================================= */
function safeCalculate(expression) {
    // Remove unsafe chars
    expression = expression.replace(/[^0-9+\-*/(). ]/g, '');
    var tokens = expression.match(/(\d+(\.\d+)?|[-+*/()])/g);
    if (!tokens) return 'INVALID';

    var pos = 0;
    var MAX_DEPTH = 50; // V18.11: Prevent stack overflow

    function parseExpression(depth) {
        if (depth > MAX_DEPTH) throw new Error('MAX_DEPTH');
        var lhs = parseTerm(depth);
        while (pos < tokens.length) {
            var op = tokens[pos];
            if (op === '+' || op === '-') {
                pos++;
                var rhs = parseTerm(depth);
                if (op === '+') lhs += rhs; else lhs -= rhs;
            } else break;
        }
        return lhs;
    }

    function parseTerm(depth) {
        if (depth > MAX_DEPTH) throw new Error('MAX_DEPTH');
        var lhs = parseFactor(depth);
        while (pos < tokens.length) {
            var op = tokens[pos];
            if (op === '*' || op === '/') {
                pos++;
                var rhs = parseFactor(depth);
                if (op === '*') lhs *= rhs; else lhs /= rhs;
            } else break;
        }
        return lhs;
    }

    function parseFactor(depth) {
        if (depth > MAX_DEPTH) throw new Error('MAX_DEPTH');
        if (pos >= tokens.length) return 0;
        var token = tokens[pos++];
        if (token === '(') {
            var result = parseExpression(depth + 1); // V18.11: Increment depth on nesting
            pos++; // skip )
            return result;
        }
        return parseFloat(token);
    }

    try {
        var result = parseExpression(0);
        return isNaN(result) ? 'ERROR' : Math.round(result * 100000) / 100000;
    } catch (e) { return 'ERROR'; }
}

document.addEventListener('DOMContentLoaded', init);

// V19.0: Fix sub-modal close conflicts by stopping propagation and ensuring specific handlers
document.addEventListener('DOMContentLoaded', function () {
    // Re-bind Theme Modal Close
    var themeModalClose = document.getElementById('theme-modal-close');
    if (themeModalClose) {
        themeModalClose.onclick = function (e) {
            e.stopPropagation();
            closeThemeModal();
        };
    }

    // Re-bind Theme Modal Cancel
    var themeModalCancel = document.getElementById('theme-modal-cancel');
    if (themeModalCancel) {
        themeModalCancel.onclick = function (e) {
            e.stopPropagation();
            closeThemeModal();
        };
    }

    // Re-bind Note Editor Close
    var noteEditorClose = document.getElementById('note-editor-close');
    if (noteEditorClose) {
        noteEditorClose.onclick = function (e) {
            e.stopPropagation();
            closeNoteEditor();
        };
    }
});

// V63.2: Ensure Editor Manual exists and is up to date
function ensureEditorManual() {
    var title = "Editor Manual";
    if (typeof Notes === 'undefined') return;
    
    var manual = NOTES.find(n => n.title === title);
    
    var content = 
`# Editor Manual

Welcome to the Vinland Notes Editor!

## Shortcuts
- **CMD+N**: New Note
- **CMD+S**: Save Note (Auto-saves)
- **CMD+D**: Duplicate Note
- **CMD+P**: Toggle Pin
- **CMD+SHIFT+P**: Move to Folder (Focus Path)
- **CMD+SHIFT+D**: Delete Note
- **CMD+L**: Checkbox item / Toggle Checkbox
- **CMD+B/I/U**: Bold/Italic/Underline
- **CMD+K**: Insert Link
- **CMD+E**: Toggle Editor/Preview
- **Arrows (Left/Right)**: Navigate Through Open Tabs
- **Arrows (Up/Down)**: Navigate Sidebar Notes (when not editing)

## Features
- **Tabs**: Open multiple notes. Close with '×' or middle click.
- **Paths**: Organize notes in folders (e.g., /work/project).
- **Page Actions**: Click '...' for more options.
- **Import/Export**: Drag & Drop or use menu. Supports block parsing.
`;

    if (!manual) {
        var now = Date.now();
        var newNote = {
            id: 'note_' + now,
            title: title,
            content: content,
            blocks: [], 
            path: '/docs',
            created: now,
            modified: now,
            pinned: true
        };
        // Split content into blocks
        var lines = content.split('\n');
        lines.forEach(function(line, idx) {
             // Keep empty lines as empty blocks
             newNote.blocks.push({
                 id: 'block_' + now + '_' + idx,
                 type: 'p',
                 content: line
             });
        });
        
        NOTES.push(newNote);
        saveData();
    } else {
        // Update content if requested
        if (manual.content !== content) {
             manual.content = content;
             manual.blocks = [];
             var lines = content.split('\n');
             var now = Date.now();
             lines.forEach(function(line, idx) {
                 manual.blocks.push({
                     id: 'block_' + now + '_' + idx,
                     type: 'p',
                     content: line
                 });
             });
             saveData();
        }
    }
}
// V66: CSP Compliance - Global Event Delegation for Preview HUD
document.addEventListener('DOMContentLoaded', function() {
    // Attach to document to handle dynamic elements (Event Bubbling)
    // Delegate CLICK (Open Board & Advance)
    document.addEventListener('click', function(e) {
        // 1. Open Board / Delete Block (Header Click)
        var header = e.target.closest('.hud-header-compact');
        if (header) {
            e.target.closest('#note-preview') && e.stopPropagation(); 
            var wrapper = header.closest('.kanban-hud-wrapper');
            if (wrapper) {
                if (e.target.classList.contains('hud-delete-btn')) {
                    // Delete Block Logic for Preview
                    var blockId = wrapper.dataset.blockId;
                    if (blockId && typeof PageManager !== 'undefined') {
                        PageManager.deleteBlock(Notes.activeNoteId, blockId);
                        KanbanManager.syncPage();
                    }
                } else if (wrapper.dataset.boardId) {
                    KanbanManager.open(wrapper.dataset.boardId);
                }
            }
            return;
        }
        
        // 2. Advance Logic (Arrow Click)
        var advBtn = e.target.closest('.hud-advance-btn');
        if (advBtn) {
            e.stopPropagation();
            var item = advBtn.closest('.hud-item');
            var wrapper = advBtn.closest('.kanban-hud-wrapper');
            if (item && wrapper) {
                var cardId = item.dataset.cardId;
                var boardId = wrapper.dataset.boardId;
                if (KanbanManager.advanceCard(cardId, boardId)) {
                    // Handled by advanceCard internal syncPage call
                }
            }
            return;
        }
        
        // Stop propagation for input clicks
        if (e.target.classList.contains('hud-injector-input')) {
            e.stopPropagation();
        }
    });

    // Delegate DBLCLICK (Deep Link: Card -> Opening Note)
    document.addEventListener('dblclick', function(e) {
        var item = e.target.closest('.hud-item');
        if (item) {
            e.stopPropagation();
            var textEl = item.querySelector('.hud-item-text');
            var text = textEl ? textEl.innerText : '';
            if (text && typeof Notes !== 'undefined') {
                (Notes.openByTitle(text) || Notes.create(text));
            }
        }
    });

    // Delegate KEYDOWN (Injector)
    document.addEventListener('keydown', function(e) {
        if (e.target.classList.contains('hud-injector-input')) {
            var wrapper = e.target.closest('.kanban-hud-wrapper');
            if (wrapper && wrapper.dataset.boardId) {
                KanbanManager.handlePreviewInject(e, wrapper.dataset.boardId);
            }
        }
    });
});
