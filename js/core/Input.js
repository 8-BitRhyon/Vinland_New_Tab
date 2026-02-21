/**
 * Input.js - Global Keyboard Shortcuts
 * Extracted from vinland.js initKeyboardShortcuts
 */

// Helper for ArrowUp/Down navigation in Sidebar
function navigateSidebar(direction) {
    var Notes = window.Notes;
    if (typeof Notes === 'undefined' || !Notes.activeNoteId) return;
    
    var items = Array.from(document.querySelectorAll('.sidebar-note-item'));
    if (items.length === 0) return;
    
    var currentIdx = items.findIndex(item => item.dataset.noteId === Notes.activeNoteId);
    var nextIdx;
    if (currentIdx === -1) {
        nextIdx = direction > 0 ? 0 : items.length - 1;
    } else {
        nextIdx = currentIdx + direction;
    }
    
    if (nextIdx >= 0 && nextIdx < items.length) {
        var nextNoteId = items[nextIdx].dataset.noteId;
        Notes.open(nextNoteId, true);
        items[nextIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

export function initKeyboardShortcuts() {
    // Access managers via window (global singleton pattern)
    var ModalManager = window.ModalManager;
    var TabManager = window.TabManager;
    var PageActions = window.PageActions;
    var Notes = window.Notes;
    
    if (ModalManager && ModalManager.init) ModalManager.init();
    if (TabManager && TabManager.init) TabManager.init();
    // PageActions.init() removed — called in boot.js

    // Capture-phase: CMD+Shift+X (close tab)
    document.addEventListener('keydown', function(e) {
        var isNotesActive = ModalManager && ModalManager.stack && ModalManager.stack.includes('note-editor-modal');
        if (!isNotesActive) return;
        
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'x' || e.key === 'X')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (TabManager && TabManager.tabs && TabManager.tabs.length > 0) {
                TabManager.closeTab(TabManager.activeIndex);
            }
            return;
        }
    }, true);
    
    // Capture-phase: CMD+1-9 (switch tabs)
    document.addEventListener('keydown', function(e) {
        var isNotesActive = ModalManager && ModalManager.stack && ModalManager.stack.includes('note-editor-modal');
        if (!isNotesActive) return;
        
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && /^[1-9]$/.test(e.key)) {
            var tabIndex = parseInt(e.key, 10) - 1;
            if (TabManager && TabManager.tabs && tabIndex < TabManager.tabs.length && TabManager.activeIndex !== tabIndex) {
                e.preventDefault();
                e.stopImmediatePropagation();
                TabManager.switchTo(tabIndex);
                return;
            }
        }
    }, true);

    // Main shortcut handler
    document.addEventListener('keydown', function (e) {
        // Ctrl+K to focus CLI
        if (e.ctrlKey && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            var cmdInput = document.getElementById('cmd-input');
            if (cmdInput) cmdInput.focus();
            return;
        }

        var isNotesActive = ModalManager && ModalManager.stack && ModalManager.stack.includes('note-editor-modal');
        var isKanbanActive = ModalManager && ModalManager.stack && ModalManager.stack.includes('kanban-modal');
        
        if (isNotesActive) {
            // CMD+D: Duplicate Note
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                if (PageActions && PageActions.duplicateNote) PageActions.duplicateNote();
                return;
            }
            
            // CMD+SHIFT+D: Delete Note
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                if (PageActions && PageActions.moveToTrash) PageActions.moveToTrash();
                return;
            }

            // CMD+P: Toggle Pin
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                Notes = window.Notes;
                if (Notes && Notes.togglePin) Notes.togglePin();
                return;
            }
            
            // CMD+SHIFT+P: Focus Path Input
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                if (PageActions && PageActions.focusPathInput) PageActions.focusPathInput();
                return;
            }
            
            // CMD+S: Save (handled in NotesController, but adding fallback)
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                Notes = window.Notes;
                if (Notes && Notes.save) {
                    Notes.save();
                    if (typeof showNotification === 'function') showNotification('Note saved');
                }
                return;
            }
            
            // CMD+E: Toggle Preview
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
                e.preventDefault();
                Notes = window.Notes;
                if (Notes && Notes.togglePreview) Notes.togglePreview();
                return;
            }

            // CMD+J: Open Daily Note
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
                e.preventDefault();
                Notes = window.Notes;
                if (Notes) {
                    var today = new Date().toLocaleDateString();
                    var title = 'Daily Note: ' + today;
                    if(!Notes.openByTitle(title)) {
                        Notes.create(title, '/Daily');
                    }
                }
                return;
            }

            // CMD+\: Toggle Sidebar
            if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
                e.preventDefault();
                Notes = window.Notes;
                // Use Notes toggleSidebar if available, or manual DOM manipulation
                if (Notes && Notes.toggleSidebar) {
                    Notes.toggleSidebar();
                } else {
                    var sidebar = document.querySelector('.notes-sidebar');
                    if (sidebar) sidebar.classList.toggle('collapsed');
                }
                return;
            }
            
            // Arrow Navigation (only when not in input/contenteditable and not focused on a block)
            var activeEl = document.activeElement;
            var isInput = activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true';
            var isBlockEditor = activeEl.closest && activeEl.closest('.block-wrapper');
            
            if (!isInput && !isBlockEditor && TabManager) {
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    TabManager.switchAdjacent(-1);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    TabManager.switchAdjacent(1);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    navigateSidebar(-1);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    navigateSidebar(1);
                }
            }
        }

        // Global '/' for CLI focus (with guards)
        if (e.key === '/' && !isNotesActive && !isKanbanActive && 
            document.activeElement.tagName !== 'INPUT' && 
            document.activeElement.tagName !== 'TEXTAREA' && 
            document.activeElement.getAttribute('contenteditable') !== 'true') {
            e.preventDefault();
            var cmdInput2 = document.getElementById('cmd-input');
            if (cmdInput2) cmdInput2.focus();
            return;
        }
    }, true);
}
