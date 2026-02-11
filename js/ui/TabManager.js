import { State } from '../core/Store.js';
import { safeText } from '../core/Utils.js';

// Placeholder for future NotesController import
// import { Notes } from "../modules/NotesController.js";

/* =========================================
   V63.2: TAB MANAGER
   Handles multi-tab note editing
   ========================================= */
export const TabManager = {
    tabs: [], // [{noteId, title}]
    activeIndex: -1,
    history: [], // For back/forward navigation
    historyIndex: -1,
    isUpdating: false, // V63.2 FIX: Recursion guard

    init: function() {
        // V63.4: Respect settings toggle (Targeting Correct Selector)
        var bar = document.getElementById('editor-tab-bar'); 
        if (!bar) bar = document.querySelector('.editor-tab-bar');

        if (State.CONFIG.notes_tabs_enabled === false) {
             if (bar) bar.style.display = 'none';
             this.tabs = [];
             this.activeIndex = -1;
             this.save(); // Clear session storage too
        } else {
             if (bar) bar.style.display = 'flex';
        }

        // V63.5: Load saved tabs from localStorage (persistent across sessions)
        var saved = localStorage.getItem('VINLAND_TABS');
        if (saved && State.CONFIG.notes_tabs_enabled !== false) {
            try {
                var data = JSON.parse(saved);
                this.tabs = data.tabs || [];
                this.activeIndex = data.activeIndex || -1;
            } catch(e) {}
        }
        if (State.CONFIG.notes_tabs_enabled !== false) {
            // V85: Race Condition Fix - If tabs empty but notes exist, open first note instead of auto-creating later
            if (this.tabs.length === 0 && typeof State !== 'undefined' && State.NOTES && State.NOTES.length > 0) {
                 var first = State.NOTES[0];
                 this.openTab(first.id, first.title);
            }
            
            // V85: Re-tether 'Ghost' Empty Note on Reload
            // If we have exactly 1 tab, and it is empty/untitled, mark it as auto-created so it gets deleted if closed/replaced.
            if (this.tabs.length === 1 && typeof Notes !== 'undefined') {
                 var noteId = this.tabs[0].noteId;
                 var note = State.NOTES.find(n => n.id === noteId);
                 if (note && (!note.content || !note.content.trim()) && (note.title === 'Untitled' || !note.title)) {
                     console.log('[TabManager] Re-tethering auto-created note:', noteId);
                     Notes.autoCreatedNoteId = noteId;
                 }
            }

            this.render();
        }
        this.bindEvents();
    },

    bindEvents: function() {
       // Extracted from original file structure - assuming standard binds 
       // In original file bindEvents wasn't explicitly shown in the view, 
       // but init() called it. Detailed implementation was likely lower down 
       // or assumed. I will implement the standard UI bindings here based on render() logic.
       
       var newBtn = document.getElementById('tab-new-btn');
       if (newBtn) {
           newBtn.onclick = () => {
               // Assuming Notes.create() exists globally for now
               if (typeof Notes !== 'undefined') Notes.create();
           };
       }

       var backBtn = document.getElementById('tab-nav-back');
       if (backBtn) {
           backBtn.onclick = () => this.goBack();
       }

       var fwdBtn = document.getElementById('tab-nav-forward');
       if (fwdBtn) {
           fwdBtn.onclick = () => this.goForward();
       }
    },

    save: function() {
        localStorage.setItem('VINLAND_TABS', JSON.stringify({
            tabs: this.tabs,
            activeIndex: this.activeIndex
        }));
    },

    openTab: function(noteId, title) {
        // V63.4: Respect settings toggle immediately
        if (State.CONFIG.notes_tabs_enabled === false) return;
        
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
            // V83: Re-implemented legacy logic (Always create new note).
             // Guard: Prevent loop if we are already cleaning up.
            if (typeof Notes !== 'undefined' && !Notes.isCleaningUpAutoNote) {
                 // Removed: Notes.autoCreatedNoteId = null; (Preserve ID for cleanup)
                 Notes.activeNoteId = null; 
                 Notes.create(); 
                 Notes.autoCreatedNoteId = Notes.activeNoteId;
                 if (typeof showNotification === 'function') {
                     showNotification('Created new note');
                 }
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
    }
};
