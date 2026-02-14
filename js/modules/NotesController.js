import { State } from '../core/Store.js';
import { safeText, getAudioContext } from '../core/Utils.js';
import { saveData } from '../core/Storage.js';
import { PageManager, parseContentToBlocks } from '../editor/PageManager.js';
import { BlockEditor } from '../editor/BlockEditor.js';
import { SlashMenu } from '../editor/SlashMenu.js';
import { ModalManager } from '../ui/ModalManager.js';
import { TabManager } from '../ui/TabManager.js';
import { renderSidebar } from '../ui/Sidebar.js';
import { sanitizePath } from '../editor/PageManager.js';
import { GraphManager } from './GraphManager.js';


/* =========================================
   NOTES CONTROLLER
   ========================================= */

export const Notes = {
    activeNoteId: null,
    saveTimeout: null,
    selectedNotes: [], // Multi-select for batch delete
    isSelectionMode: false,
    expandedFolders: [], // Track open folders
    explicitFolders: [], // V87: Persist empty folders
    graphLayout: {}, // Store node positions {id: {x, y}}
    
    // V3.5: Markdown Preview
    isPreviewMode: false,
    
    // Legacy flag for auto-created empty notes cleanup
    autoCreatedNoteId: null,
    isCleaningUpAutoNote: false,

    // V67: Deep Link Support
    openByTitle: function(title) {
        if (!title) return false;
        var note = State.NOTES.find(function(n) { return (n.title || 'Untitled').toLowerCase() === title.toLowerCase(); });
        if (note) {
            this.open(note.id);
            return true;
        }
        return false;
    },

    toggleSidebar: function() {
        console.log('[Notes] toggleSidebar called');
        // V84: Updated to target the ACTUAL sidebar (.notes-sidebar) instead of just the panel
        // This fixes CMD+\ behavior to match user expectation.
        var sidebar = document.querySelector('.notes-sidebar');
        if (sidebar) {
            sidebar.classList.toggle('collapsed');
            var isCollapsed = sidebar.classList.contains('collapsed');
            console.log('[Notes] Sidebar collapsed:', isCollapsed);
            localStorage.setItem('VINLAND_SIDEBAR_COLLAPSED', isCollapsed ? '1' : '0');
        }

        // Optional: Also toggle the panel if it's meant to be synced, 
        // but user specifically complained about "Only closes Quick Notes".
        // So we might want to LEAVE the panel alone (it lives inside sidebar usually).
        // If #notes-panel is the "Quick Notes" list, it should probably be visible if sidebar is open.
        // I will rely on CSS structure: if sidebar is collapsed, content is hidden.
        // So just toggling sidebar class is sufficient.
    },

    // V86: Plain-text preview extractor for Quick Notes teaser
    getPlainTextPreview: function(text) {
        if (!text) return '';
        var t = text;
        // Strip code fences
        t = t.replace(/```[\w]*\n[\s\S]*?```/g, '');
        // Strip images
        t = t.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
        // Strip kanban markers
        t = t.replace(/%%KANBAN:[^%]+%%/g, '');
        t = t.replace(/\[\[KANBAN:[^\]]+\]\]/g, '');
        // Strip dividers
        t = t.replace(/^---$/gm, '');
        // Strip headers (keep text)
        t = t.replace(/^#{1,6}\s+/gm, '');
        // Strip blockquotes (keep text)
        t = t.replace(/^>\s?/gm, '');
        // Strip task markers (keep text)
        t = t.replace(/^\s*- \[[ x]\]\s*/gm, '');
        // Strip bullet markers (keep text)
        t = t.replace(/^\s*[-*]\s+/gm, '');
        // Strip numbered list markers (keep text)
        t = t.replace(/^\s*\d+\.\s+/gm, '');
        // Strip links [text](url) → text
        t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        // Strip wiki links [[title|label]] → label, [[title]] → title
        t = t.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2');
        t = t.replace(/\[\[([^\]]+)\]\]/g, '$1');
        // Strip bold/italic markers
        t = t.replace(/\*\*(.+?)\*\*/g, '$1');
        t = t.replace(/\*(.+?)\*/g, '$1');
        // Strip underline tags
        t = t.replace(/<\/?u>/g, '');
        // Strip inline code backticks
        t = t.replace(/`([^`]+)`/g, '$1');
        // Strip alignment markers
        t = t.replace(/%%align:(left|center|right)%%/g, '');
        // Strip table rows (lines starting/ending with |)
        t = t.replace(/^\|.*\|$/gm, '');
        // Collapse whitespace
        t = t.replace(/\n{2,}/g, ' · ');
        t = t.replace(/\n/g, ' ');
        t = t.replace(/\s{2,}/g, ' ');
        return t.trim().substring(0, 150);
    },

    renderNotes: function() {
        console.log('[Notes] renderNotes called. Note count:', State.NOTES ? State.NOTES.length : 'NULL');
        var list = document.getElementById('notes-list');
        var container = document.getElementById('notes-panel');
        if (!list || !container) return;

        // Use State.NOTES
        if (!State.NOTES || State.NOTES.length === 0) {
            // Container behavior: keep active but empty, or hide? 
            // Original code hid it: container.classList.remove('active');
            // But if user clicked toggle, they expect to see something.
            // Let's just clear list
            list.innerHTML = '<div style="padding:20px; text-align:center; color:#555;">NO_DATA // EMPTY_SET</div>';
            return;
        }

        list.innerHTML = '';

        // V18.13: Sort by modified date first, then created
        var notesToShow = State.NOTES.map(function (n, i) { return { note: n, id: i + 1, index: i }; })
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

            // V86: Plain-text teaser preview
            var teaserHtml = '<div class="note-item-teaser">' + safeText(Notes.getPlainTextPreview(contentDisplay)) + '</div>';

            div.innerHTML = headerHtml + teaserHtml;

            // V18.3: Click to edit
            div.setAttribute('data-note-index', item.index);
            div.addEventListener('click', function () {
                // V15.0: Use Notes.open exclusively
                if (item.note.id) {
                    Notes.open(item.note.id);
                } else {
                    Notes.open(); // Fallback
                }
            });

            fragment.appendChild(div);
        });
        list.appendChild(fragment);
    },

    init: function () {
        // Load persistent folder state
        try {
            var stored = localStorage.getItem('OPERATOR_EXPANDED_FOLDERS');
            if (stored) this.expandedFolders = JSON.parse(stored);

            var layout = localStorage.getItem('VINLAND_GRAPH_LAYOUT');
            if (layout) this.graphLayout = JSON.parse(layout);

            // V87: Load explicit (empty-safe) folders
            var folders = localStorage.getItem('VINLAND_EXPLICIT_FOLDERS');
            if (folders) this.explicitFolders = JSON.parse(folders);

        } catch (e) {
            console.warn('[Notes] Error loading State:', e);
        }
        
        // V88: Legacy Schema Migration
        if (PageManager.migrateNotesToPathSchema) PageManager.migrateNotesToPathSchema();
        if (PageManager.migrateNotesToBlockSchema) PageManager.migrateNotesToBlockSchema();

        this.renderSidebar();



        // Initialize components
        if (typeof BlockEditor !== 'undefined' && BlockEditor.init) BlockEditor.init('block-editor');
        if (typeof SlashMenu !== 'undefined' && SlashMenu.init) SlashMenu.init();

        this.bindEvents();
        this.bindPreviewListeners(); // V72: Preview Interactivity
        
        // Restore sidebar state (persistence)
        try {
            var panelState = localStorage.getItem('VINLAND_NOTES_PANEL_OPEN');
            if (panelState === '1') {
                var panel = document.getElementById('notes-panel');
                if (panel) {
                    panel.classList.add('active');
                    this.renderNotes();
                }
            }
        } catch (e) {
            console.warn('[Notes] Failed to restore panel state', e);
        }

        // V85: Restore Maximized State (User Request: Absolute Throughput)
        try {
            var isMaximized = localStorage.getItem('VINLAND_NOTES_MAXIMIZED') === 'true';
            var editorModal = document.getElementById('note-editor-modal');
            var maxBtn = document.getElementById('note-maximize-btn');
            
            if (isMaximized && editorModal) {
                editorModal.classList.add('maximized');
                if (maxBtn) maxBtn.textContent = '[MIN]';
                // Update global icons if needed
                if (this.updateGlobalIconsVisibility) this.updateGlobalIconsVisibility(false);
            }
        } catch (ignore) {}
    },

    bindEvents: function () {
        // Note: Extensive event binding logic logic extracted from vinland.js
        // Ideally this should be reduced and delegated, but preserving logic for now.
        
        // Sidebar Search
        var search = document.getElementById('notes-search');
        if (search) {
            search.addEventListener('input', (e) => {
                this.renderSidebar(e.target.value);
            });
        }
        
        // ... (Many other event listeners are in the original code. 
        // For refactoring, we assume some are handled by UI components or we'd move them here.)
        // Due to the size, I will include the critical ones involved in controller logic.
        
        // Editor Inputs (Auto-Save + Tags)
        var titleInput = document.getElementById('active-note-title');
        var contentInput = document.getElementById('active-note-content');

        var self = this;
        [titleInput, contentInput].forEach(function (el) {
            if (el) {
                el.addEventListener('input', function () {
                    self.autoSave();
                    self.updateTags();
                    
                    if (el.id === 'active-note-title' && TabManager) {
                        TabManager.updateActiveTitle(el.value || 'Untitled');
                    }
                });
            }
        });

        // Global Shortcuts for Editor
        document.addEventListener('keydown', function(e) {
            // Only trigger if editor is open/modal is active
            var editorModal = document.getElementById('note-editor-modal');
            if (!editorModal || editorModal.style.display === 'none') return;

            // CMD+E: Toggle Preview
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
                e.preventDefault();
                self.togglePreview();
            }
            
            // CMD+S: Manual Save (though auto-save is on)
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                self.autoSave(); 
                // Visual feedback?
            }
        });
        var closeBtn = document.getElementById('note-editor-close');
        if (closeBtn) closeBtn.onclick = function() { closeNoteEditor(); };

        var sidebarToggle = document.getElementById('sidebar-toggle-btn');
        if (sidebarToggle) {
             sidebarToggle.onclick = function() {
                 var sidebar = document.querySelector('.notes-sidebar');
                 if(sidebar) {
                     sidebar.classList.toggle('collapsed');
                 }
             };
        }

        // V87: Path input change listener — persist path when user edits it
        var pathInput = document.getElementById('note-current-path');
        if (pathInput) {
            pathInput.addEventListener('change', function() {
                if (!self.activeNoteId) return;
                var newPath = pathInput.value.trim();
                if (!newPath) newPath = '/';
                // Ensure leading slash
                if (!newPath.startsWith('/')) newPath = '/' + newPath;
                // Strip trailing slash (unless root)
                if (newPath.length > 1 && newPath.endsWith('/')) newPath = newPath.slice(0, -1);
                // V87: /root is the display name for actual root path /
                if (newPath === '/root') newPath = '/';
                self.moveNote(self.activeNoteId, newPath);
            });
            // Also commit on Enter key
            pathInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    pathInput.blur(); // triggers change event
                }
            });
        }

        var maxBtn = document.getElementById('note-maximize-btn');
        if (maxBtn) {
            maxBtn.onclick = function() {
                var modal = document.getElementById('note-editor-modal');
                if (modal) {
                    modal.classList.toggle('maximized');
                    var isMax = modal.classList.contains('maximized');
                    maxBtn.textContent = isMax ? '[MIN]' : '[MAX]';
                    if (self.updateGlobalIconsVisibility) self.updateGlobalIconsVisibility(!isMax);
                    
                    // V85: Persist Maximized State
                    localStorage.setItem('VINLAND_NOTES_MAXIMIZED', isMax ? 'true' : 'false');
                }
            };
        }
        
        var helpBtn = document.getElementById('note-help-btn');
        if (helpBtn) {
             helpBtn.onclick = function() {
                 ModalManager.open('help-modal'); // Re-use main help or specific note help?
                 // Main help modal has a NOTES section
             };
        }

        var dailyBtn = document.getElementById('daily-note-btn');
        if(dailyBtn) {
            dailyBtn.onclick = function() {
                var today = new Date().toLocaleDateString(); // Simple Format
                var title = 'Daily Note: ' + today;
                if(!self.openByTitle(title)) {
                    self.create(title, '/Daily');
                }
            };
        }
        
        var addNoteBtn = document.getElementById('add-note-btn-sidebar');
        if(addNoteBtn) addNoteBtn.onclick = function() { self.create(); };
        
        var addFolderBtn = document.getElementById('add-folder-btn-sidebar');
        if(addFolderBtn) {
            addFolderBtn.onclick = function() {
                // V87: Use existing folder-create-modal from index.html
                var modal = document.getElementById('folder-create-modal');
                var input = document.getElementById('folder-name-input');
                var confirmBtn = document.getElementById('folder-modal-confirm');
                var cancelBtn = document.getElementById('folder-modal-cancel');
                var closeBtn = document.getElementById('folder-modal-close');
                
                if (modal && input && ModalManager) {
                    input.value = '';
                    ModalManager.open('folder-create-modal');
                    setTimeout(function() { input.focus(); }, 50);
                    
                    confirmBtn.onclick = function() {
                        var name = input.value.trim();
                        if (name) {
                            var folderPath = '/' + sanitizePath(name);
                            self.registerFolder(folderPath); // V87: Persist empty folder
                            self.create('README', folderPath);
                            ModalManager.close('folder-create-modal');
                        }
                    };
                    cancelBtn.onclick = function() {
                        ModalManager.close('folder-create-modal');
                    };
                    if (closeBtn) closeBtn.onclick = function() {
                        ModalManager.close('folder-create-modal');
                    };
                    input.onkeydown = function(e) {
                        if (e.key === 'Enter') confirmBtn.click();
                        if (e.key === 'Escape') cancelBtn.click();
                    };
                }
            };
        }
        
        var addBoardBtn = document.getElementById('add-board-btn-sidebar');
        if(addBoardBtn) {
             addBoardBtn.onclick = function() {
                 if(typeof KanbanManager !== 'undefined') {
                     // V87: Use custom input modal instead of native prompt()
                     if (typeof ModalManager !== 'undefined' && ModalManager.openInput) {
                         ModalManager.openInput('NEW_BOARD //', 'board_name', function(name) {
                             var board = KanbanManager.createBoard(name);
                             KanbanManager.open(board.id);
                             self.renderSidebar();
                         });
                     }
                 }
             };
        }
        
        // PREVIEW Toggle Button
        var previewBtn = document.getElementById('preview-toggle');
        if (previewBtn) {
            previewBtn.onclick = function() {
                self.togglePreview();
            };
        }
        
        // Quick Notes Panel Header -> Opens Editor
        var quickNotesHeader = document.getElementById('quick-notes-panel-header');
        if (quickNotesHeader) {
            quickNotesHeader.onclick = function() {
                if (self.activeNoteId) {
                    self.open(self.activeNoteId);
                } else {
                    self.open(); // Open most recent or create
                }
            };
        }
        
        // Keyboard Shortcuts (Global when note modal is open)
        document.addEventListener('keydown', function(e) {
            var modal = document.getElementById('note-editor-modal');
            var isNotesOpen = modal && modal.classList.contains('active');
            if (!isNotesOpen) return;
            
            var meta = e.ctrlKey || e.metaKey;
            
            // Cmd+S = Save
            if (meta && e.key === 's') {
                e.preventDefault();
                self.save();
                if (typeof showNotification === 'function') showNotification('Note saved');
            }
            
            // Cmd+E = Toggle Preview/Edit
            if (meta && e.key === 'e') {
                e.preventDefault();
                self.togglePreview();
            }
            
            // Cmd+N = New Note
            if (meta && e.key === 'n') {
                e.preventDefault();
                // Prevent infinite untitled notes
                if (self.activeNoteId) {
                    var currentNote = State.NOTES.find(function(n) { return n.id === self.activeNoteId; });
                    if (currentNote && (!currentNote.title || currentNote.title.trim() === '')) {
                        if (typeof showNotification === 'function') showNotification('Please name your current note first');
                        document.getElementById('active-note-title').focus();
                        return;
                    }
                }
                self.create();
            }
            
            // CMD+\ Listener Removed (Handled globally in Input.js)
            
            // Cmd+P = Toggle Pin
            if (meta && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                self.togglePin();
            }
        });
        
        // WikiLink Click Handling in Preview
        var preview = document.getElementById('note-preview');
        if (preview) {
            preview.addEventListener('click', function (e) {
                // Internal WikiLink click
                if (e.target.classList.contains('internal-link')) {
                    var title = e.target.getAttribute('data-link');
                    self.openByTitle(title);
                }
                
                // Kanban Preview HUD click
                var kanbanHud = e.target.closest('.kanban-hud-wrapper');
                if (kanbanHud) {
                    var boardId = kanbanHud.getAttribute('data-board-id');
                    if (boardId && typeof KanbanManager !== 'undefined') {
                        KanbanManager.open(boardId);
                    }
                }
                
                // Kanban Preview Embed click
                var kanbanEmbed = e.target.closest('.kanban-preview-embed');
                if (kanbanEmbed) {
                    var boardId = kanbanEmbed.getAttribute('data-board-id');
                    if (boardId && typeof KanbanManager !== 'undefined') {
                        KanbanManager.open(boardId);
                    }
                }
            });
        }
    },

    // Alias for external calls (imported from Sidebar.js)
    renderSidebar: renderSidebar,

    open: function (noteId, skipFocus) {
        console.log('[Notes] open() called with ID:', noteId);
        var toggleBtn = document.getElementById('preview-toggle');
        if (toggleBtn) toggleBtn.style.display = 'inline-block';
        
        // Cleanup Logic
        if (this.autoCreatedNoteId && this.autoCreatedNoteId !== noteId) {
            var autoNote = State.NOTES.find(function (n) { return n.id === Notes.autoCreatedNoteId; });
            if (autoNote) {
                var titleEmpty = !autoNote.title || autoNote.title.trim() === '';
                var contentEmpty = !autoNote.content || autoNote.content.trim() === '';
                var blocksEmpty = !autoNote.blocks || autoNote.blocks.length === 0 || 
                    (autoNote.blocks.length === 1 && (!autoNote.blocks[0].content || autoNote.blocks[0].content.trim() === ''));
                
                if (titleEmpty && contentEmpty && blocksEmpty) {
                    var autoNoteId = this.autoCreatedNoteId;
                    State.NOTES = State.NOTES.filter(function (n) { return n.id !== autoNoteId; });
                    saveData();
                    this.isCleaningUpAutoNote = true;
                    if (TabManager) TabManager.closeTabById(autoNoteId);
                    this.isCleaningUpAutoNote = false;
                    this.renderSidebar();
                }
            }
            this.autoCreatedNoteId = null;
        }
        
        if (this.activeNoteId && this.activeNoteId !== noteId) {
            var current = State.NOTES.find(function (n) { return n.id === Notes.activeNoteId; });
            if (current) {
                // Empty check logic
                var hasNoTitle = !current.title || current.title.trim() === '' || current.title === 'Untitled';
                var hasNoContent = !current.content || current.content.trim() === '';
                var hasNoBlocks = !current.blocks || current.blocks.length === 0;
                
                if (hasNoTitle && hasNoContent && hasNoBlocks) {
                    var deletedId = this.activeNoteId;
                    State.NOTES = State.NOTES.filter(function (n) { return n.id !== deletedId; });
                    saveData();
                    if (this.saveTimeout) { clearTimeout(this.saveTimeout); this.saveTimeout = null; }
                    if (TabManager) TabManager.closeTabById(deletedId);
                    this.renderSidebar();
                } else {
                    if (this.saveTimeout) { clearTimeout(this.saveTimeout); this.saveTimeout = null; this.save(); }
                }
            }
        }

        var note = State.NOTES.find(function (n) { return n.id === noteId; });
        if (!note && State.NOTES.length > 0) note = State.NOTES[0];
        if (!note) { this.create(); return; }

        this.activeNoteId = note.id;
        
        if (State.CONFIG.notes_tabs_enabled !== false && TabManager) {
            TabManager.openTab(note.id, note.title || 'Untitled');
        }

        // V2 Migration: Ensure blocks exist
        if (!note.blocks || note.blocks.length === 0) {
            note.blocks = parseContentToBlocks(note.content);
            if (note.blocks.length === 0) PageManager.addBlock(note, 'p', '');
        }

        var titleInput = document.getElementById('active-note-title');
        if (titleInput) titleInput.value = note.title || '';
        
        var textarea = document.getElementById('active-note-content');
        var blockEditorEl = document.getElementById('block-editor');
        var preview = document.getElementById('note-preview');

        this.isPreviewMode = (note.viewMode === 'preview');

        if (this.isPreviewMode) {
            if (textarea) textarea.style.display = 'none';
            if (blockEditorEl) blockEditorEl.style.display = 'none';
            if (preview) {
                if (PageManager) PageManager.syncContent(note.id);
                preview.innerHTML = Notes.renderMarkdown(note.content || '');
                preview.classList.add('active');
                preview.style.display = 'block';
            }
            if (toggleBtn) { toggleBtn.textContent = 'EDIT'; toggleBtn.classList.add('active'); }
        } else {
            if (preview) {
                preview.classList.remove('active');
                preview.style.display = 'none';
            }
            if (textarea) textarea.style.display = 'none'; 
            if (blockEditorEl) blockEditorEl.style.display = 'block';
            
            if (toggleBtn) { toggleBtn.textContent = 'PREVIEW'; toggleBtn.classList.remove('active'); }
            
            if (BlockEditor) BlockEditor.render(note.id, skipFocus);
        }

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
        // V87: Enforce Untitled Note Guard for ALL creation entry points
        // Catches both empty titles AND the default 'Untitled' title
        if (this.activeNoteId) {
            var currentNote = State.NOTES.find(function(n) { return n.id === Notes.activeNoteId; });
            if (currentNote && (!currentNote.title || currentNote.title.trim() === '' || currentNote.title.trim() === 'Untitled')) {
                // Allow creation if we passed a specific title (e.g. Daily Note, README)
                if (!initialTitle) {
                    if (typeof showNotification === 'function') showNotification('NAME_CURRENT_NOTE // before creating another');
                    var titleInput = document.getElementById('active-note-title');
                    if (titleInput) titleInput.focus();
                    return;
                }
            }
        }

        var newNote = {
            id: 'note_' + Date.now(),
            title: initialTitle || '',
            content: '',
            path: sanitizePath(initialPath || '/'),
            links: [],
            created: new Date().getTime(),
            modified: new Date().getTime()
        };
        State.NOTES.unshift(newNote);
        saveData();
        this.open(newNote.id);

        setTimeout(function () {
            var el = document.getElementById('active-note-title');
            if (el) el.focus();
        }, 100);

        renderNotes();
    },

    delete: function () {
        if (!this.activeNoteId) return;
        if (this.saveTimeout) clearTimeout(this.saveTimeout);

        var idx = State.NOTES.findIndex(n => n.id === this.activeNoteId);
        if (idx > -1) {
            var deletedPath = State.NOTES[idx] ? (State.NOTES[idx].path || '/') : '/';
            State.NOTES.splice(idx, 1);
            saveData();
            this.activeNoteId = null;

            if (State.NOTES.length > 0) {
                var tabSwitched = false;
                if (TabManager && TabManager.tabs.length > 0) {
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
                    // Fallback navigation
                    var sortedRemaining = State.NOTES.slice().sort((a,b) => (b.modified || 0) - (a.modified || 0));
                    this.open(sortedRemaining[0].id);
                }
            } else {
                this.clearEditor();
            }
        }
        renderNotes();
    },
    
    clearEditor: function() {
        var titleInput = document.getElementById('active-note-title');
        var blockEditor = document.getElementById('block-editor');
        if (titleInput) titleInput.value = '';
        if (blockEditor) blockEditor.innerHTML = '';
        this.activeNoteId = null;
    },

    save: function () {
        if (!this.activeNoteId) return;
        var note = State.NOTES.find(n => n.id === this.activeNoteId);
        if (!note) return;

        var titleInput = document.getElementById('active-note-title');
        var oldTitle = note.title;

        note.title = titleInput.value || 'Untitled';
        note.modified = new Date().getTime();

        if (PageManager) PageManager.syncContent(this.activeNoteId);

        if (oldTitle !== note.title) {
            saveData();
            this.renderSidebar();
            renderNotes();
        }
        
        saveData();
        this.updateAllTags();

        var status = document.getElementById('save-status');
        if (status) {
            status.textContent = 'SAVED';
            status.classList.add('saved');
            setTimeout(() => status.classList.remove('saved'), 2000);
        }
        this.updateWordCount();
    },

    // V87: Persist folder expand/collapse state (called by Sidebar.js)
    saveExpandedState: function() {
        localStorage.setItem('OPERATOR_EXPANDED_FOLDERS', JSON.stringify(this.expandedFolders));
    },

    // V87: Register an explicit folder so it persists even when empty
    registerFolder: function(path) {
        if (!path || path === '/') return;
        if (this.explicitFolders.indexOf(path) === -1) {
            this.explicitFolders.push(path);
            localStorage.setItem('VINLAND_EXPLICIT_FOLDERS', JSON.stringify(this.explicitFolders));
        }
    },

    // V87: Unregister an explicit folder
    unregisterFolder: function(path) {
        var idx = this.explicitFolders.indexOf(path);
        if (idx !== -1) {
            this.explicitFolders.splice(idx, 1);
            // Also remove any subfolders
            this.explicitFolders = this.explicitFolders.filter(function(f) {
                return !(f.startsWith(path + '/'));
            });
            localStorage.setItem('VINLAND_EXPLICIT_FOLDERS', JSON.stringify(this.explicitFolders));
        }
    },

    // V87: Move note to a new path
    moveNote: function(noteId, newPath) {
        var note = State.NOTES.find(function(n) { return n.id === noteId; });
        if (!note) return;

        note.path = newPath;
        note.modified = Date.now();
        saveData();

        this.renderSidebar();

        // Update path display if this is the active note
        if (this.activeNoteId === noteId) {
            var pathEl = document.getElementById('note-current-path');
            if (pathEl) pathEl.value = newPath === '/' ? '/root' : newPath;
        }

        if (window.showNotification) {
            window.showNotification('Moved to ' + newPath);
        }
    },

    // V87: Move an entire folder (and all notes under it) to a new parent path
    moveFolder: function(oldPath, newParentPath) {
        if (!oldPath || oldPath === '/') return;

        // Get folder name from oldPath
        var pathParts = oldPath.split('/').filter(Boolean);
        var folderName = pathParts[pathParts.length - 1];

        // Construct new path
        var newPath = (newParentPath === '/' ? '' : newParentPath) + '/' + folderName;

        // Prevent moving folder into itself
        if (newPath.startsWith(oldPath + '/') || newPath === oldPath) {
            if (window.showNotification) window.showNotification('CANNOT_MOVE // folder into itself');
            return;
        }

        var changed = false;
        State.NOTES.forEach(function(note) {
            if (note.path === oldPath || note.path.startsWith(oldPath + '/')) {
                note.path = newPath + note.path.substring(oldPath.length);
                changed = true;
            }
        });

        if (changed) {
            saveData();
            this.renderSidebar();
            if (window.showNotification) window.showNotification('Folder moved to ' + newParentPath);
        }
    },

    // V87: Delete a folder and all notes within it
    deleteFolder: function(path) {
        if (!path || path === '/') return;

        var self = this;
        var confirmFn = window.showConfirmModal || function(t, m, y) { if (confirm(t + '\n' + m)) y(); };

        // Count notes in folder
        var noteCount = State.NOTES.filter(function(n) {
            return n.path === path || n.path.startsWith(path + '/');
        }).length;

        confirmFn(
            'DELETE_FOLDER',
            'Permanently delete "' + path + '"?' + (noteCount > 0 ? ' (' + noteCount + ' note' + (noteCount !== 1 ? 's' : '') + ' will be removed)' : ''),
            function() {
                // V87: Always unregister from explicit folders
                self.unregisterFolder(path);

                if (noteCount > 0) {
                    State.NOTES = State.NOTES.filter(function(n) {
                        return !(n.path === path || n.path.startsWith(path + '/'));
                    });
                    if (typeof window.State !== 'undefined') window.State.NOTES = State.NOTES;
                    saveData();

                    // If active note was in deleted folder, reset
                    if (self.activeNoteId) {
                        var activeExists = State.NOTES.find(function(n) { return n.id === self.activeNoteId; });
                        if (!activeExists) {
                            self.activeNoteId = null;
                            if (State.NOTES.length > 0) {
                                self.open(State.NOTES[0].id);
                            }
                        }
                    }
                }
                self.renderSidebar();
                if (window.showNotification) window.showNotification('Folder deleted');
            }
        );
    },

    autoSave: function () {
        var status = document.getElementById('save-status');
        if (status) {
            status.textContent = 'SAVING...';
            status.classList.add('saving');
        }
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
            this.save();
        }, 500);
    },

    togglePreview: function () {
        var editor = document.getElementById('block-editor');
        var preview = document.getElementById('note-preview');
        var toggleBtn = document.getElementById('preview-toggle');
        var legacy = document.getElementById('active-note-content');
        if (legacy) legacy.style.display = 'none'; // Always hide legacy textarea
        
        if (!editor || !preview || !toggleBtn) return;
        
        var note = State.NOTES.find(n => n.id === this.activeNoteId);
        if (!note) return;

        this.isPreviewMode = !this.isPreviewMode;
        note.viewMode = this.isPreviewMode ? 'preview' : 'edit';
        saveData();

        if (this.isPreviewMode) {
            // Sync blocks to text before rendering
            if (typeof PageManager !== 'undefined' && PageManager.syncContent) PageManager.syncContent(this.activeNoteId);
            
            preview.innerHTML = Notes.renderMarkdown(note.content || '');
            preview.classList.add('active');
            preview.style.display = 'block';
            editor.style.display = 'none';
            toggleBtn.textContent = 'EDIT';
            toggleBtn.classList.add('active');
        } else {
            preview.classList.remove('active');
            preview.style.display = 'none';
            editor.style.display = 'block';
            toggleBtn.textContent = 'PREVIEW';
            toggleBtn.classList.remove('active');
            // Re-render editor to ensure state is fresh
            if (typeof BlockEditor !== 'undefined' && BlockEditor.render) BlockEditor.render(this.activeNoteId);
        }
    },

    togglePin: function () {
        var note = State.NOTES.find(n => n.id === this.activeNoteId);
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

        if (typeof showNotification === 'function') {
            showNotification(note.pinned ? 'Note pinned' : 'Note unpinned');
        }
    },

    // V72: Rich Kanban Preview HTML Generator (Synced with BlockEditor.js)
    getKanbanPreviewHtml: function(boardId) {
        var BOARDS = State.BOARDS || [];
        var board = BOARDS.find(function(b) { return b.id === boardId; });
        
        if (!board) {
            return '<div class="kanban-preview-embed"><span style="color:#666">[MISSING BOARD: ' + boardId + ']</span></div>';
        }

        // Telemetry
        var totalCards = 0;
        board.columns.forEach(function(c) { totalCards += c.cards.length; });
        var doneCol = board.columns[board.columns.length - 1];
        var doneCount = doneCol ? doneCol.cards.length : 0;
        var percent = totalCards === 0 ? 0 : Math.round((doneCount / totalCards) * 100);

        // Active Stream (Smart List)
        var activeCol = board.columns.find(function(c) { return c.cards.length > 0 && c !== doneCol; }) || board.columns[0];
        var activeCards = activeCol ? activeCol.cards.slice(0, 3) : [];

        var listHtml = activeCards.map(function(card) {
            var displayContent = (card.content || '').replace(/#(\w+)/g, '<span class="hud-tag">#$1</span>');
            return '<li class="hud-item">' +
                '<span class="hud-item-text">' + displayContent + '</span>' +
                '<span class="hud-advance-btn" style="opacity:0.5">&gt;&gt;</span>' +
            '</li>';
        }).join('');

        return '<div class="kanban-hud-wrapper" data-board-id="' + board.id + '" style="cursor:pointer;">' +
            '<div class="hud-header-compact" title="Click to Open Board">' +
                '<div class="hud-title-row">' +
                    '<span class="hud-icon">[=]</span>' +
                    '<span class="hud-name">' + board.title.toUpperCase() + '</span>' +
                    '<span class="hud-percent">' + percent + '%</span>' +
                '</div>' +
                '<div class="hud-progress-track">' +
                    '<div class="hud-progress-fill" style="width: ' + percent + '%"></div>' +
                '</div>' +
            '</div>' +
            '<ul class="hud-list" style="list-style:none; padding:0; margin:0;">' + listHtml + '</ul>' +
            '<div class="hud-injector-row" style="opacity:0.5; font-size:0.75rem; padding:4px;">+ Click to open board</div>' +
        '</div>';
    },

    // V72: Toggle Checkbox in Preview
    togglePreviewTask: function(taskIndex, isChecked) {
        var note = State.NOTES.find(n => n.id === this.activeNoteId);
        if (!note || !note.blocks) return;

        // Map linear task index to block
        // We need to re-scan blocks to find the Nth task
        var currentTaskIdx = 0;
        var targetBlock = null;

        for (var i = 0; i < note.blocks.length; i++) {
            if (note.blocks[i].type === 'task') {
                if (currentTaskIdx === taskIndex) {
                    targetBlock = note.blocks[i];
                    break;
                }
                currentTaskIdx++;
            }
        }

        if (targetBlock) {
            // Update Data
            targetBlock.checked = isChecked;
            if (isChecked && !targetBlock.completedAt) targetBlock.completedAt = Date.now();
            else if (!isChecked) targetBlock.completedAt = null;
            
            note.modified = Date.now();
            
            // Sync Text Content
            if (PageManager) PageManager.syncContent(note.id);
            
            saveData();
            console.log('[Notes] Preview task toggled:', targetBlock.id, isChecked);
        }
    },

    bindPreviewListeners: function() {
        var previewEl = document.getElementById('note-preview');
        if (!previewEl) return;

        var self = this;
        
        // Delegated Change (Checkbox)
        previewEl.addEventListener('change', function(e) {
            if (e.target.classList.contains('task-checkbox')) {
                var idx = parseInt(e.target.getAttribute('data-task-index'), 10);
                self.togglePreviewTask(idx, e.target.checked);
                
                // Visual update only
                var parent = e.target.closest('.block-task-preview');
                if (parent) {
                    if (e.target.checked) parent.style.opacity = '0.5';
                    else parent.style.opacity = '1';
                }
            }
        });

        // Delegated Click (Kanban)
        previewEl.addEventListener('click', function(e) {
            var hudWrapper = e.target.closest('.kanban-hud-wrapper');
            if (hudWrapper) {
                var boardId = hudWrapper.getAttribute('data-board-id');
                if (boardId && typeof KanbanManager !== 'undefined') {
                    KanbanManager.open(boardId);
                }
            }
        });
    },
    
    // Markdown Rendering Engine
    renderMarkdown: function (text, isTeaser) {
        var self = this;
        var html = text || '';

        if (!html) html = '<p style="color:#555;">No content to preview</p>';
        else {
            // Extract code fences FIRST (before HTML escape)
            var codeBlocks = [];
            html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(match, lang, code) {
                var idx = codeBlocks.length;
                
                // Calculator Preview
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
                    return isTeaser ? '<span class="teaser-tag">[CALC]</span> ' : '%%CODE_BLOCK_' + idx + '%%';
                }

                // V78: Use BlockEditor.highlightSyntax if available for same look
                if (typeof BlockEditor !== 'undefined' && BlockEditor.highlightSyntax) {
                    var highlighted = BlockEditor.highlightSyntax(code, lang);
                    codeBlocks.push('<pre class="block-code"><code class="code-inner language-' + (lang || 'plain') + '">' + highlighted + '</code><span class="code-lang-label">' + (lang || 'plain').toUpperCase() + '</span></pre>');
                    return isTeaser ? '<span class="teaser-tag">[CODE: ' + (lang || 'TEXT') + ']</span> ' : '%%CODE_BLOCK_' + idx + '%%';
                }

                var escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                codeBlocks.push('<pre class="block-code"><code class="code-inner language-' + (lang || 'plain') + '">' + escapedCode + '</code><span class="code-lang-label">' + (lang || 'plain').toUpperCase() + '</span></pre>');
                return isTeaser ? '<span class="teaser-tag">[CODE]</span> ' : '%%CODE_BLOCK_' + idx + '%%';
            });
            
            // Extract image blocks BEFORE HTML escape to preserve base64 URLs
            var imageBlocks = [];
            html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(match, alt, url) {
                var idx = imageBlocks.length;
                imageBlocks.push('<div class="preview-image-container"><img src="' + url + '" alt="' + alt + '" class="preview-img"><div class="preview-image-caption">' + alt + '</div></div>');
                return isTeaser ? '<span class="teaser-tag">[IMAGE]</span> ' : '%%IMAGE_BLOCK_' + idx + '%%';
            });
            
            // Extract Kanban blocks BEFORE HTML escape
            var kanbanBlocks = [];
            // V72: Use getKanbanPreviewHtml for updated telemetry
            html = html.replace(/%%KANBAN:([^:]+):([^:]+):([^:]+):(\d+):(\d+)%%/g, function(match, id, blockId, title, cols, cards) {
                var idx = kanbanBlocks.length;
                var hudHtml = self.getKanbanPreviewHtml(id);
                kanbanBlocks.push(hudHtml);
                return isTeaser ? '<span class="teaser-tag">[KANBAN: ' + title + ']</span> ' : '%%KANBAN_BLOCK_' + idx + '%%';
            });
            // Also handle fallback format [[KANBAN:id]]
            html = html.replace(/\[\[KANBAN:([^\]]+)\]\]/g, function(match, id) {
                var idx = kanbanBlocks.length;
                var hudHtml = self.getKanbanPreviewHtml(id);
                kanbanBlocks.push(hudHtml);
                return isTeaser ? '<span class="teaser-tag">[KANBAN]</span> ' : '%%KANBAN_BLOCK_' + idx + '%%';
            });
            
            // Alignment Marker Extraction
            var alignments = [];
            var aLines = html.split('\n');
            html = aLines.map(function(line, idx) {
                var alignMatch = line.match(/\s?%%align:(left|center|right)%%$/);
                if (alignMatch) {
                    alignments[idx] = alignMatch[1];
                    return line.replace(/\s?%%align:(left|center|right)%%$/, '').replace(/\s+$/, '');
                }
                return line;
            }).join('\n');

            // Escape HTML for remaining content
            html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            // Blockquotes
            html = html.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');

            // Bullet Lists (skip tasks)
            html = html.replace(/^(\s*)- (?!\[)(.*)$/gm, function(match, indent, content) {
                var level = (indent.length / 2);
                return '<div class="preview-bullet" style="margin-left:' + (level * 20) + 'px"><span class="preview-bullet-icon">&bull;</span>' + content + '</div>';
            });

            // Numbered Lists
            html = html.replace(/^(\s*)(\d+)\. (.*)$/gm, function(match, indent, num, content) {
                var level = (indent.length / 2);
                return '<div class="preview-bullet" style="margin-left:' + (level * 20) + 'px"><span class="preview-bullet-icon">' + num + '.</span>' + content + '</div>';
            });

            // Task Lists
            // V72: Enabled Checkboxes
            var taskIndex = 0;
            html = html.replace(/^(\s*)- \[( |x)\] (.*)$/gm, function (match, indent, state, content) {
                var isChecked = (state === 'x');
                var level = (indent.length / 2);
    
                return '<div class="block-task-preview" style="margin-left:' + (level * 20) + 'px; opacity:' + (isChecked ? '0.5' : '1') + '">' + 
                       '<input type="checkbox" class="task-checkbox-inline" ' + (isChecked ? 'checked' : '') + ' data-task-index="' + (taskIndex++) + '">' +
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

            // Re-apply Alignments
            var renderedLines = html.split('\n');
            html = renderedLines.map(function(line, idx) {
                if (alignments[idx] && alignments[idx] !== 'left') {
                    if (line.includes('class="preview-bullet"') || line.includes('class="block-task-preview"')) {
                        return line.replace('class="', 'class="align-' + alignments[idx] + ' ');
                    }
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

            // Standard Markdown Links: [text](url)
            html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" class="external-link">$1</a>');

            // Wiki Links: [[Note Title|Display Label]] or [[Note Title]]
            var self = this;
            html = html.replace(/\[\[(.*?)(?:\|(.*?))?\]\]/g, function (match, title, label) {
                var display = label || title;
                return '<span class="internal-link" data-link="' + title + '" title="Click to open note">' + display + '</span>';
            });

            // Markdown Tables
            var lines = html.split('\n');
            var inTable = false;
            var tableLines = [];
            var outputLines = [];
            
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                var isTableLine = line.trim().startsWith('|') && line.trim().endsWith('|');
                
                if (isTableLine) {
                    if (!inTable) {
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
                        if (isTeaser) outputLines.push('<span class="teaser-tag">[TABLE]</span>'); else outputLines.push(processTableLines(tableLines));
                        tableLines = [];
                        inTable = false;
                    }
                    outputLines.push(line);
                }
            }
            if (inTable && tableLines.length > 0) {
                if (isTeaser) outputLines.push('<span class="teaser-tag">[TABLE]</span>'); else outputLines.push(processTableLines(tableLines));
            }
            
            function processTableLines(tLines) {
                if (tLines.length < 2) return tLines.join('\n');
                
                var headerLine = tLines[0];
                var separatorLine = tLines[1];
                var dataLines = tLines.slice(2);
                
                // Parse Alignments
                var alignments = [];
                if (separatorLine) {
                    var parts = separatorLine.split('|').slice(1, -1);
                    alignments = parts.map(function(p) {
                        p = p.trim();
                        if (p.startsWith(':') && p.endsWith(':')) return 'center';
                        if (p.endsWith(':')) return 'right';
                        return 'left';
                    });
                }
                
                var headerCells = headerLine.split('|').slice(1, -1);
                var hCols = headerCells.map(function(c, i) {
                    var alignStyle = alignments[i] ? ' style="text-align:' + alignments[i] + '"' : '';
                    return '<th' + alignStyle + '>' + (c.trim() || '&nbsp;') + '</th>';
                }).join('');
                
                var rRows = dataLines.map(function(row) {
                    var cells = row.split('|').slice(1, -1);
                    var cols = cells.map(function(c, i) {
                        var alignStyle = alignments[i] ? ' style="text-align:' + alignments[i] + '"' : '';
                        return '<td' + alignStyle + '>' + (c.trim() || '&nbsp;') + '</td>';
                    }).join('');
                    return '<tr>' + cols + '</tr>';
                }).join('');
                
                return '<table class="markdown-table"><thead><tr>' + hCols + '</tr></thead><tbody>' + rRows + '</tbody></table>';
            }
            
            html = outputLines.join('\n');

            // Line breaks
            html = html.replace(/\n/g, '<br>');
            
            // Remove <br> after block-level elements
            html = html.replace(/(<\/h[1-6]>)<br>/gi, '$1');
            html = html.replace(/(<hr[^>]*>)<br>/gi, '$1');
            html = html.replace(/(<\/pre>)<br>/gi, '$1');
            html = html.replace(/(<\/blockquote>)<br>/gi, '$1');
            html = html.replace(/(<\/div>)<br>/gi, '$1');
            html = html.replace(/(<\/table>)<br>/gi, '$1');
            
            // Re-insert code blocks
            codeBlocks.forEach(function(block, idx) {
                html = html.replace('%%CODE_BLOCK_' + idx + '%%', block);
            });
            
            // Re-insert image blocks
            imageBlocks.forEach(function(block, idx) {
                html = html.replace('%%IMAGE_BLOCK_' + idx + '%%', block);
            });
            
            // Re-insert Kanban blocks
            kanbanBlocks.forEach(function(block, idx) {
                html = html.replace('%%KANBAN_BLOCK_' + idx + '%%', block);
            });
        }

        // Backlinks (Linked References)
        var NOTES = window.State ? window.State.NOTES : (window.NOTES || []);
        if (this.activeNoteId) {
            var currentNote = NOTES.find(function(n) { return n.id === self.activeNoteId; });
            if (currentNote && currentNote.title) {
                var linkedNotes = NOTES.filter(function (n) {
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

    updateWordCount: function() {
        var counter = document.getElementById('word-count');
        if (!counter || !this.activeNoteId) return;
        var note = State.NOTES.find(n => n.id === this.activeNoteId);
        if (!note) return;
        var text = (note.content || '').trim();
        var words = text ? text.split(/\s+/).length : 0;
        counter.textContent = words + (words === 1 ? ' word' : ' words');
    },

    updateTags: function() {
        var activeNote = State.NOTES.find(n => n.id === this.activeNoteId);
        if (!activeNote) return;

        // Get all tags from note content and blocks
        var tags = [];
        var self = this;
        
        // Scan blocks for tags
        if (activeNote.blocks && activeNote.blocks.length > 0) {
            activeNote.blocks.forEach(function (b) {
                var blockTags = self.extractTags(b.content || '');
                blockTags.forEach(function(t) { tags.push(t.replace('#', '')); });
            });
        }
        
        // Also scan legacy content field
        if (activeNote.content) {
            var contentTags = this.extractTags(activeNote.content);
            contentTags.forEach(function(t) { tags.push(t.replace('#', '')); });
        }
        
        // Deduplicate
        tags = [...new Set(tags)];

        // Highlight in Sidebar Tags List
        var sidebarTags = document.querySelectorAll('#sidebar-all-tags .tag');
        sidebarTags.forEach(function(el) {
            el.classList.remove('active-tag');
            var tagName = el.textContent.trim().toLowerCase().replace('#', '');
            var isMatch = tags.some(function(t) { return t.toLowerCase() === tagName; });
            if (isMatch) {
                el.classList.add('active-tag');
            }
        });

        // Hide legacy footer bar
        var footerBar = document.querySelector('.editor-tags-bar');
        if (footerBar) footerBar.style.display = 'none'; 
    },
    
    extractTags: function (content) {
        if (!content) return [];
        var matches = content.match(/#[\w]+/g);
        return matches ? [...new Set(matches)] : [];
    },
    
    activeTagFilter: null,
    
    filterByTag: function (tag) {
        var searchInput = document.getElementById('notes-search');
        if (this.activeTagFilter === tag) {
            this.activeTagFilter = null;
            if (searchInput) searchInput.value = '';
        } else {
            this.activeTagFilter = tag;
            if (searchInput) searchInput.value = tag;
        }
        this.renderSidebar(this.activeTagFilter);
    },
    
    updateAllTags: function() {
        var container = document.getElementById('sidebar-all-tags');
        if (!container) return;

        // Collect all unique tags from all notes (blocks + content)
        var allTags = {};
        var self = this;
        State.NOTES.forEach(function (note) {
            // Scan blocks
            if (note.blocks && note.blocks.length > 0) {
                note.blocks.forEach(function(b) {
                    var blockTags = self.extractTags(b.content || '');
                    blockTags.forEach(function (tag) {
                        allTags[tag] = (allTags[tag] || 0) + 1;
                    });
                });
            }
            // Also scan legacy content
            var tags = self.extractTags(note.content || '');
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

        var activeNote = State.NOTES.find(function(n) { return n.id === self.activeNoteId; });
        var activeNoteTags = activeNote ? self.extractTags(activeNote.content || '') : [];

        tagList.forEach(function (tag) {
            var span = document.createElement('span');
            span.className = 'tag';
            span.textContent = tag;
            span.style.cursor = 'pointer';
            span.title = allTags[tag] + ' notes';
            
            // Highlight if active in current note
            if (activeNoteTags.some(function(t) { return t.toLowerCase() === tag.toLowerCase(); })) {
                span.classList.add('active-tag');
            }
            
            span.onclick = function() {
                self.filterByTag(tag);
            };
            
            container.appendChild(span);
        });
    },
    
    toggleSelectionMode: function() {
        this.isSelectionMode = !this.isSelectionMode;
        this.selectedNotes = [];
        this.renderSidebar();
    },
    
    toggleSelection: function(noteId) {
        var idx = this.selectedNotes.indexOf(noteId);
        if (idx === -1) this.selectedNotes.push(noteId);
        else this.selectedNotes.splice(idx, 1);
        this.renderSidebar();
    },

    deleteSelected: function() {
        if (!this.selectedNotes.length) return;
        State.NOTES = State.NOTES.filter(n => !this.selectedNotes.includes(n.id));
        this.selectedNotes = [];
        this.isSelectionMode = false;
        saveData();
        this.renderSidebar();
    },

    // Knowledge Graph
    openGraph: function () {
        if (GraphManager) GraphManager.open();
    },

    closeGraph: function () {
        if (typeof ModalManager !== 'undefined') ModalManager.closeTop(true);
    }
};

/* =========================================
   STANDALONE FUNCTIONS
   ========================================= */

export function renderNotes() {
    var list = document.getElementById('notes-list');
    var container = document.getElementById('notes-panel');
    if (!list || !container) return;

    if (!State.NOTES || State.NOTES.length === 0) {
        container.classList.remove('active');
        return;
    }

    container.classList.add('active');
    list.innerHTML = '';

    var notesToShow = State.NOTES.map(function (n, i) { return { note: n, id: i + 1, index: i }; })
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

        var contentDisplay = item.note.content || item.note.text || '';
        var titleText = item.note.title || (contentDisplay ? contentDisplay.split('\n')[0].substring(0, 20) : 'Untitled');
        
        div.innerHTML = '<div class="note-item-header"><span class="note-item-title-quick">' + safeText(titleText) + '</span></div>' +
                        '<div class="note-item-teaser">' + safeText(Notes.getPlainTextPreview(contentDisplay)) + '</div>';

        div.addEventListener('click', function () {
            Notes.open(item.note.id);
        });

        fragment.appendChild(div);
    });
    list.appendChild(fragment);
}

export function addNote(text) {
    if (!text || !text.trim()) return;
    var content = text.trim();
    var title = content.split('\n')[0].substring(0, 30);

    State.NOTES.unshift({
        id: 'note_' + Date.now(),
        title: title || 'Quick Note',
        content: content,
        created: Date.now(),
        modified: Date.now()
    });

    saveData();
    renderNotes();
}

export function clearNotes() {
    if (confirm('Clear ALL notes?')) {
        State.NOTES = [];
        saveData();
        renderNotes();
    }
}

export function toggleNotesPanel() {
    var panel = document.getElementById('notes-panel');
    if (panel) panel.classList.toggle('active');
}

export function closeNoteEditor() {
    if (PageManager && Notes.activeNoteId) {
        PageManager.syncContent(Notes.activeNoteId);
    }
    ModalManager.closeTop(true);
}

export function openNewNoteEditor() {
    if (Notes.activeNoteId) {
        // Prevent infinite tabs/new notes if untitled
    }
    Notes.create();
}
