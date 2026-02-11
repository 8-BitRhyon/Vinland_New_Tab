import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';
import { Notes } from '../modules/NotesController.js';
import { TabManager } from './TabManager.js';

// Helper to access globals that might be on window or imported
// Ideally showNotification and showConfirmModal should be imported from a standard UI module or Utils.
// For now, checking window or defining stub.

function getShowNotification() {
    return window.showNotification || function(msg) { console.log('Notify:', msg); };
}

function getShowConfirmModal() {
    return window.showConfirmModal || function(t, m, y) { if(confirm(t + '\n' + m)) y(); };
}

export const PageActions = {
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
            
            State.NOTES.push(newNote);
            saveData();
            Notes.renderSidebar();
            Notes.open(newNote.id);
            getShowNotification()('Note duplicated');
        }
    },

    moveToFolder: function() {
        // Open folder picker modal or prompt
        var newPath = prompt('Enter new path (e.g. /Projects/Work):');
        if (newPath && Notes.activeNoteId) {
            Notes.moveNote(Notes.activeNoteId, newPath);
            getShowNotification()('Moved to ' + newPath);
        }
    },

    exportMarkdown: function() {
        if (!Notes.activeNoteId) return;
        var note = State.NOTES.find(n => n.id === Notes.activeNoteId);
        if (note) {
            var blob = new Blob([note.content || ''], { type: 'text/markdown' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = (note.title || 'note').replace(/[^a-z0-9]/gi, '_') + '.md';
            a.click();
            URL.revokeObjectURL(url);
            getShowNotification()('Exported as Markdown');
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
                    State.NOTES.push(newNote);
                    saveData();
                    
                    Notes.open(newNote.id);
                    Notes.renderSidebar();
                    getShowNotification()('Imported: ' + title);
                };
                reader.readAsText(file);
            }
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

    moveToTrash: function() {
        if (!Notes.activeNoteId) return;
        getShowConfirmModal()(
            'Delete Note',
            'This note will be deleted. Continue?',
            function() {
                var noteIdToDelete = Notes.activeNoteId;
                
                // Find and close the tab for this note
                var tabIdx = TabManager.tabs.findIndex(t => t.noteId === noteIdToDelete);
                if (tabIdx !== -1) {
                    TabManager.closeTab(tabIdx);
                }
                
                // Delete the note
                var idx = State.NOTES.findIndex(n => n.id === noteIdToDelete);
                if (idx !== -1) {
                    State.NOTES.splice(idx, 1);
                    saveData();
                    Notes.renderSidebar();
                }
                
                getShowNotification()('Note deleted');
            }
        );
    },

    focusPathInput: function() {
        var pathInput = document.getElementById('note-current-path');
        if (pathInput) {
            pathInput.focus();
            pathInput.select();
        }
    }
};
