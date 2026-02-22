import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';
import { Notes } from '../modules/NotesController.js';
import { PageManager, parseContentToBlocks } from '../editor/PageManager.js';
import { TabManager } from './TabManager.js';
import { ModalManager } from './ModalManager.js';
import { GraphManager } from '../modules/GraphManager.js'; // <--- ADD THIS

// Helper to access globals that might be on window or imported
function getShowNotification() {
    return window.showNotification || function(msg) { console.log('Notify:', msg); };
}

function getShowConfirmModal() {
    return window.showConfirmModal || function(t, m, y) { if(confirm(t + '\n' + m)) y(); };
}

export const PageActions = {
    isOpen: false,
    highlightIndex: -1, // V87: Keyboard nav index

    init: function() {
        if (this._initialized) return;
        this._initialized = true;

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
        
        // Search filter + V87: Keyboard navigation
        if (search) {
            search.addEventListener('input', function() {
                self.filter(this.value);
                self.highlightIndex = -1;
                self.updateHighlight();
            });

            search.addEventListener('keydown', function(e) {
                var visible = self.getVisibleItems();
                if (visible.length === 0) return;

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    self.highlightIndex = Math.min(self.highlightIndex + 1, visible.length - 1);
                    self.updateHighlight();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    self.highlightIndex = Math.max(self.highlightIndex - 1, 0);
                    self.updateHighlight();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (self.highlightIndex >= 0 && self.highlightIndex < visible.length) {
                        var action = visible[self.highlightIndex].dataset.action;
                        self.execute(action);
                        self.close();
                    } else if (visible.length === 1) {
                        // If only one result, execute it
                        self.execute(visible[0].dataset.action);
                        self.close();
                    }
                } else if (e.key === 'Escape') {
                    self.close();
                }
            });
        }
    },

    // V87: Get currently visible (non-hidden) action items (excludes dividers)
    getVisibleItems: function() {
        var items = document.querySelectorAll('.page-action-item:not(.page-action-divider)');
        var visible = [];
        items.forEach(function(item) {
            if (item.style.display !== 'none') {
                visible.push(item);
            }
        });
        return visible;
    },

    // V87: Update keyboard highlight on menu items
    updateHighlight: function() {
        var items = document.querySelectorAll('.page-action-item');
        items.forEach(function(item) { item.classList.remove('highlighted'); });
        
        var visible = this.getVisibleItems();
        if (this.highlightIndex >= 0 && this.highlightIndex < visible.length) {
            visible[this.highlightIndex].classList.add('highlighted');
            visible[this.highlightIndex].scrollIntoView({ block: 'nearest' });
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
            this.highlightIndex = -1;
            var search = document.getElementById('page-actions-search');
            if (search) { search.value = ''; search.focus(); }
            this.filter('');
            
            // V87: Update dynamic pin label
            this.updatePinLabel();
            
            // V63.2: Populate footer with word count and last edited
            if (Notes.activeNoteId) {
                var note = State.NOTES.find(n => n.id === Notes.activeNoteId);
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
            this.highlightIndex = -1;
        }
    },

    filter: function(query) {
        var items = document.querySelectorAll('.page-action-item');
        var dividers = document.querySelectorAll('.page-action-divider');
        var q = query.toLowerCase();

        // Hide/show action items based on query
        items.forEach(function(item) {
            var text = item.textContent.toLowerCase();
            item.style.display = text.includes(q) ? '' : 'none';
        });

        // V87: Hide dividers when searching, show when query is empty
        dividers.forEach(function(div) {
            if (q) {
                div.style.display = 'none';
            } else {
                div.style.display = '';
            }
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
            case 'word-count':
                this.showWordCount();
                break;
            case 'trash':
                this.moveToTrash();
                break;
            // V87: New actions
            case 'pin-toggle':
                this.togglePin();
                break;
            case 'copy-content':
                this.copyContent();
                break;
            case 'convert-board':
                this.convertToBoard();
                break;
            case 'show-graph':
                this.showInGraph();
                break;
        }
    },

    copyLink: function() {
        if (!Notes.activeNoteId) return;
        var note = State.NOTES.find(n => n.id === Notes.activeNoteId);
        if (note) {
            var link = '[[' + note.title + ']]';
            navigator.clipboard.writeText(link).then(function() {
                getShowNotification()('Link copied: ' + link);
            });
        }
    },

    duplicateNote: function() {
        if (!Notes.activeNoteId) return;
        var note = State.NOTES.find(n => n.id === Notes.activeNoteId);
        if (note) {
            // V70: Deep copy blocks to prevent reference issues
            var newBlocks = [];
            if (note.blocks && note.blocks.length > 0) {
                newBlocks = JSON.parse(JSON.stringify(note.blocks));
                newBlocks.forEach(function(block) {
                    block.id = 'blk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                });
            }

            var newNote = {
                id: Date.now().toString(),
                title: note.title + ' (Copy)',
                content: note.content,
                blocks: newBlocks,
                path: note.path,
                created: Date.now(),
                modified: Date.now()
            };
            
            State.NOTES.push(newNote);
            saveData();
            Notes.renderSidebar();
            Notes.open(newNote.id);
            getShowNotification()('Note duplicated');
        }
    },

    // V87: Replaced native prompt() with ModalManager.openInput()
    moveToFolder: function() {
        if (!Notes.activeNoteId) return;

        ModalManager.openInput(
            'MOVE_NOTE //',
            'Enter new path (e.g. /Projects)',
            function(newPath) {
                if (newPath) {
                    Notes.moveNote(Notes.activeNoteId, newPath);
                }
            }
        );
    },

    // V87: Gentler filename sanitization — preserves spaces, dashes, underscores
    exportMarkdown: function() {
        if (!Notes.activeNoteId) return;
        var note = State.NOTES.find(n => n.id === Notes.activeNoteId);
        if (note) {
            var blob = new Blob([note.content || ''], { type: 'text/markdown' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = (note.title || 'note').replace(/[^a-z0-9 \-_]/gi, '').trim() + '.md';
            a.click();
            URL.revokeObjectURL(url);
            getShowNotification()('Exported as Markdown');
        }
    },

    // V87: Multi-file import support
    importMarkdown: function() {
        var input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '.md,.markdown,.txt';
        input.onchange = function(e) {
            var files = Array.from(e.target.files);
            if (files.length === 0) return;
            var importedCount = 0;
            var lastNoteId = null;

            files.forEach(function(file) {
                var reader = new FileReader();
                reader.onload = function(ev) {
                    var content = ev.target.result;
                    var title = file.name.replace(/\.[^.]+$/, '');
                    
                    var blocks = [];
                    var now = Date.now() + importedCount; // Offset to prevent ID collision
                    // V88: Use robust parser to detect headings/lists/dividers etc.
                    if (typeof parseContentToBlocks === 'function') {
                        blocks = parseContentToBlocks(content);
                    } else {
                        // Fallback manual parse
                        var lines = content.split('\n');
                        lines.forEach(function(line, idx) {
                            blocks.push({
                                id: 'block_' + (Date.now() + importedCount) + '_' + idx,
                                type: 'p',
                                content: line
                            });
                        });
                    }
                    
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
                    State.NOTES.push(newNote);
                    lastNoteId = newNote.id;
                    importedCount++;
                    
                    // When all files processed, save and render
                    if (importedCount === files.length) {
                        saveData();
                        Notes.renderSidebar();
                        if (lastNoteId) Notes.open(lastNoteId);
                        getShowNotification()('Imported ' + importedCount + ' note' + (importedCount > 1 ? 's' : ''));
                    }
                };
                reader.readAsText(file);
            });
        };
        input.click();
    },

    showWordCount: function() {
        if (!Notes.activeNoteId) return;
        var note = State.NOTES.find(n => n.id === Notes.activeNoteId);
        if (note) {
            var text = note.content || '';
            var words = text.trim() ? text.trim().split(/\s+/).length : 0;
            var chars = text.length;
            getShowNotification()('Words: ' + words + ' | Characters: ' + chars);
        }
    },

    // V87: Soft-delete — moves note to /.trash/ path instead of permanent splice
    moveToTrash: function() {
        if (!Notes.activeNoteId) return;
        getShowConfirmModal()(
            'TRASH_NOTE //',
            'Move this note to Trash? You can recover it from the /.trash/ folder.',
            function() {
                var noteIdToDelete = Notes.activeNoteId;
                var note = State.NOTES.find(function(n) { return n.id === noteIdToDelete; });
                
                if (note) {
                    // Move to trash path instead of permanently deleting
                    note.path = '/.trash';
                    note.modified = Date.now();
                    saveData();
                    
                    // Close tab for this note
                    var tabIdx = TabManager.tabs.findIndex(function(t) { return t.noteId === noteIdToDelete; });
                    if (tabIdx !== -1) {
                        TabManager.closeTab(tabIdx);
                    }
                    
                    Notes.renderSidebar();
                    getShowNotification()('Moved to Trash');
                }
            }
        );
    },

    // V88: Permanent Delete (Destructive)
    deleteNotePermanently: function(noteId) {
        var id = noteId || Notes.activeNoteId;
        if (!id) return;
        
        var note = State.NOTES.find(function(n) { return n.id === id; });
        if (!note) return;

        if (confirm('PERMANENTLY DELETE "' + (note.title || 'Untitled') + '"?\nThis cannot be undone.')) {
            var idx = State.NOTES.indexOf(note);
            if (idx !== -1) State.NOTES.splice(idx, 1);
            
            if (window.MetadataCache && window.MetadataCache.removeNote) {
                window.MetadataCache.removeNote(id);
            }
            
            saveData();
            
            // If deleting the active note, close editor
            if (Notes.activeNoteId === id) {
                Notes.activeNoteId = null;
                var closeBtn = document.getElementById('note-editor-close');
                if (closeBtn) closeBtn.click();
            }
            
            if (window.TabManager) window.TabManager.closeTabById(id);
            
            // Refresh views
            Notes.renderSidebar();
            if (window.Sidebar && window.Sidebar.renderTrashView) {
                // Check if we are currently looking at trash view
                // (This is a bit loose but works for now if user is in trash view)
                window.Sidebar.renderTrashView(); 
            }
            
            getShowNotification()('Note permanently deleted');
        }
    },

    // V87: Pin/Unpin toggle from menu
    togglePin: function() {
        if (!Notes.activeNoteId) return;
        var note = State.NOTES.find(n => n.id === Notes.activeNoteId);
        if (note) {
            note.pinned = !note.pinned;
            saveData();
            Notes.renderSidebar();
            
            // Update header pin button
            var pinBtn = document.getElementById('pin-note-btn');
            if (pinBtn) pinBtn.textContent = note.pinned ? 'UNPIN' : 'PIN';
            
            getShowNotification()(note.pinned ? 'Note pinned' : 'Note unpinned');
        }
    },

    // V87: Update pin label text dynamically when menu opens
    updatePinLabel: function() {
        var item = document.querySelector('[data-action="pin-toggle"] span');
        if (!item) return;
        if (!Notes.activeNoteId) return;
        var note = State.NOTES.find(n => n.id === Notes.activeNoteId);
        if (note) {
            item.textContent = note.pinned ? 'Unpin Note' : 'Pin Note';
        }
    },

    // V87: Copy raw markdown content to clipboard
    copyContent: function() {
        if (!Notes.activeNoteId) return;
        var note = State.NOTES.find(n => n.id === Notes.activeNoteId);
        if (note && note.content) {
            navigator.clipboard.writeText(note.content).then(function() {
                getShowNotification()('Content copied to clipboard');
            });
        } else {
            getShowNotification()('No content to copy');
        }
    },

    // V87: Convert current note's task blocks into a Kanban board
    convertToBoard: function() {
        if (!Notes.activeNoteId) return;
        if (typeof KanbanManager === 'undefined' && typeof window.KanbanManager === 'undefined') {
            getShowNotification()('Board system not available');
            return;
        }
        var KM = window.KanbanManager || KanbanManager;
        var note = State.NOTES.find(n => n.id === Notes.activeNoteId);
        if (!note) return;

        // Create a board with the note's name
        var board = KM.createBoard(note.title || 'Untitled Board');

        // Find task blocks and create cards for them
        if (note.blocks && note.blocks.length > 0) {
            var defaultColumn = board.columns && board.columns.length > 0 ? board.columns[0] : null;
            note.blocks.forEach(function(block) {
                if (block.type === 'todo' || block.type === 'task') {
                    if (defaultColumn) {
                        defaultColumn.cards = defaultColumn.cards || [];
                        defaultColumn.cards.push({
                            id: 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                            content: block.content || '',
                            created: Date.now()
                        });
                    }
                }
            });
        }

        KM.open(board.id);
        Notes.renderSidebar();
        getShowNotification()('Board created from "' + note.title + '"');
    },

    // V87: Open graph view focused on current note
    showInGraph: function() {
        if (!Notes.activeNoteId) return;
        
        // Ensure GraphManager exists
        if (typeof GraphManager === 'undefined') {
            getShowNotification()('Graph system not loaded');
            return;
        }

        // 1. Force the graph into Local Mode
        GraphManager.isLocalMode = true;
        
        // 2. Update the toggle button UI immediately (if it exists)
        var modeBtn = document.getElementById('graph-mode-toggle');
        if (modeBtn) {
            modeBtn.textContent = 'LOCAL';
            modeBtn.classList.add('active');
        }

        // 3. Open and Render the graph properly
        GraphManager.open();
        
        getShowNotification()('Graph focused on current note');
    },

    focusPathInput: function() {
        var pathInput = document.getElementById('note-current-path');
        if (pathInput) {
            pathInput.focus();
            pathInput.select();
        }
    }
};
