import { State } from '../core/Store.js';
import { safeText, getAudioContext } from '../core/Utils.js';
import { saveData } from '../core/Storage.js';
import { PageManager, parseContentToBlocks } from '../editor/PageManager.js';
import { BlockEditor } from '../editor/BlockEditor.js';
import { SlashMenu } from '../ui/SlashMenu.js';
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
    explicitFolders: [], // Persist empty folders
    graphLayout: {}, // Store node positions {id: {x, y}}
    
    // .5: Markdown Preview
    isPreviewMode: false,
    
    // Legacy flag for auto-created empty notes cleanup
    autoCreatedNoteId: null,
    isCleaningUpAutoNote: false,
    _historyPopState: false, // Guard: prevent pushState loop from popstate

    // ─── Browser History Navigation (pushState/popstate) ───

    // ─── Private Helpers ───

    _bindSidebarSearch: function() {
        var search = document.getElementById('notes-search');
        if (search) {
            search.addEventListener('input', (e) => {
                this.renderSidebar(e.target.value);
            });
        }

        var tagSearch = document.getElementById('tags-search-input');
        if (tagSearch) {
            var self = this;
            tagSearch.addEventListener('input', function(e) {
                self.updateAllTags(e.target.value.trim().toLowerCase());
            });
        }
    },

    // Clean up auto-created empty notes when switching to a different note
    _cleanupAutoNote: function(noteId) {
        if (!this.autoCreatedNoteId || this.autoCreatedNoteId === noteId) return;
        var autoNote = State.NOTES.find(function (n) { return n.id === Notes.autoCreatedNoteId; });
        if (!autoNote) {
            this.autoCreatedNoteId = null; // preserve original: always clear on condition
            return;
        }

        var isCanvas = autoNote.type === 'canvas';
        var titleEmpty = !autoNote.title || autoNote.title.trim() === '';
        var contentEmpty = !autoNote.content || autoNote.content.trim() === '';
        var blocksEmpty = !autoNote.blocks || autoNote.blocks.length === 0 || 
            (autoNote.blocks.length === 1 && (!autoNote.blocks[0].content || autoNote.blocks[0].content.trim() === ''));

        if (!isCanvas && titleEmpty && contentEmpty && blocksEmpty) {
            var autoNoteId = this.autoCreatedNoteId;
            State.NOTES = State.NOTES.filter(function (n) { return n.id !== autoNoteId; });
            saveData();
            this.isCleaningUpAutoNote = true;
            if (TabManager) TabManager.closeTabById(autoNoteId);
            this.isCleaningUpAutoNote = false;
            this.renderSidebar();
        }
        this.autoCreatedNoteId = null;
    },

    // Push note state into browser history so back/forward navigates between notes
    _pushHistoryState: function(noteId, replace) {
        if (this._historyPopState) return; // Don't re-push what popstate just restored
        var note = State.NOTES.find(function(n) { return n.id === noteId; });
        var title = note ? (note.title || 'Untitled') : 'Untitled';
        var url = '?note=' + encodeURIComponent(noteId);
        var state = { noteId: noteId, timestamp: Date.now() };
        if (replace) {
            history.replaceState(state, title, url);
        } else {
            history.pushState(state, title, url);
        }
    },

    // Handle browser back/forward — restore the note from history state
    _handlePopState: function(event) {
        var state = event.state;
        if (state && state.noteId) {
            this._historyPopState = true;
            this.open(state.noteId);
            this._historyPopState = false;
        }
    },

    // Check URL params on init for deep-linked note
    _checkUrlForNote: function() {
        var match = window.location.search.match(/[?&]note=([^&]+)/);
        if (match) {
            var noteId = decodeURIComponent(match[1]);
            var note = State.NOTES.find(function(n) { return n.id === noteId; });
            if (note) {
                this.open(noteId, true);
                return true;
            }
        }
        return false;
    },

    // Deep Link Support
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
        var sidebar = document.querySelector('.notes-sidebar');
        if (sidebar) {
            sidebar.classList.toggle('collapsed');
            var isCollapsed = sidebar.classList.contains('collapsed');
            console.log('[Notes] Sidebar collapsed:', isCollapsed);
            localStorage.setItem('VINLAND_SIDEBAR_COLLAPSED', isCollapsed ? '1' : '0');
            // Remove force-open when user manually toggles (responsive override)
            sidebar.classList.remove('sidebar-force-open');
        }
    },

    // Initialize sidebar: restore persisted state, default to open
    _initSidebar: function() {
        var sidebar = document.querySelector('.notes-sidebar');
        if (!sidebar) return;
        
        var saved = localStorage.getItem('VINLAND_SIDEBAR_COLLAPSED');
        if (saved === '1') {
            sidebar.classList.add('collapsed');
        } else {
            sidebar.classList.remove('collapsed');
        }

        // Restore persisted width
        var savedWidth = localStorage.getItem('VINLAND_SIDEBAR_WIDTH');
        if (savedWidth) {
            var w = parseInt(savedWidth, 10);
            if (w >= 180 && w <= 500) {
                sidebar.style.width = w + 'px';
                sidebar.style.minWidth = w + 'px';
            }
        }
        
        // Bind resize handle
        this._initSidebarResize();
    },

    // Sidebar drag resize
    _initSidebarResize: function() {
        var handle = document.getElementById('sidebar-resize-handle');
        var sidebar = document.querySelector('.notes-sidebar');
        if (!handle || !sidebar) return;

        var self = this;
        var startX, startWidth;

        function onMouseMove(e) {
            var newWidth = startWidth + (e.clientX - startX);
            // Clamp between 180px and 500px
            newWidth = Math.max(180, Math.min(500, newWidth));
            sidebar.style.width = newWidth + 'px';
            sidebar.style.minWidth = newWidth + 'px';
            handle.classList.add('resizing');
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            handle.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            // Persist width
            var w = parseInt(sidebar.style.width, 10);
            if (w > 0) localStorage.setItem('VINLAND_SIDEBAR_WIDTH', w);
        }

        handle.addEventListener('mousedown', function(e) {
            e.preventDefault();
            startX = e.clientX;
            startWidth = sidebar.offsetWidth;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
    },

    // Plain-text preview extractor for Quick Notes teaser
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

    // ─── Breadcrumb Navigation ───

    // Filter sidebar to show only notes in a specific folder
    _filterSidebarByPath: function(path) {
        // Focus the sidebar search with the folder name
        var searchEl = document.getElementById('notes-search');
        if (searchEl) {
            var folderName = path === '/' ? '' : path.split('/').pop();
            searchEl.value = folderName;
            this.renderSidebar(folderName);
        }
    },

    _renderBreadcrumb: function(note) {
        var container = document.getElementById('note-breadcrumb');
        if (!container) return;

        var parts = [];
        var path = note.path || '/';
        if (path === '/' || !path) {
            // Root: parts stays empty — standalone Root is rendered below
        } else {
            // Split path into segments: /Journal/Subfolder → ['Journal', 'Subfolder']
            var segments = path.split('/').filter(function(p) { return p.length > 0; });
            var accumulated = '';
            for (var i = 0; i < segments.length; i++) {
                accumulated += '/' + segments[i];
                parts.push({
                    label: segments[i],
                    path: accumulated
                });
            }
        }

        container.innerHTML = '';

        // Root is always first
        var rootSpan = document.createElement('span');
        rootSpan.className = 'breadcrumb-segment';
        rootSpan.textContent = 'Root';
        rootSpan.dataset.path = '/';
        rootSpan.addEventListener('click', function(e) {
            e.stopPropagation();
            if (typeof self._filterSidebarByPath === 'function') {
                self._filterSidebarByPath('/');
            } else {
                self.renderSidebar('');
            }
        });
        container.appendChild(rootSpan);

        var self = this;
        for (var i = 0; i < parts.length; i++) {
            // Separator
            var sep = document.createElement('span');
            sep.className = 'breadcrumb-sep';
            sep.textContent = '»';
            container.appendChild(sep);

            var span = document.createElement('span');
            span.className = 'breadcrumb-segment';
            span.textContent = parts[i].label;

            if (i === parts.length - 1) {
                // Last segment = current folder, not clickable
                span.classList.add('current');
            } else {
                span.dataset.path = parts[i].path;
                span.addEventListener('click', function(p) {
                    return function(e) {
                        e.stopPropagation();
                        if (typeof self._filterSidebarByPath === 'function') {
                            self._filterSidebarByPath(p);
                        } else {
                            self.renderSidebar('');
                        }
                    };
                }(parts[i].path));
            }

            container.appendChild(span);
        }
    },

    renderNotes: function() {
        console.log('[Notes] renderNotes called. Note count:', State.NOTES ? State.NOTES.length : 'NULL');
        var list = document.getElementById('notes-list');
        var container = document.getElementById('notes-panel');
        var hint = document.getElementById('notes-discovery-hint');
        if (!list || !container) return;

        // Auto-show/hide based on note count
        if (!State.NOTES || State.NOTES.length === 0) {
            container.classList.remove('active');
            // Show discovery hint for first-time users (if not dismissed)
            if (hint && localStorage.getItem('VINLAND_NOTES_HINT_DISMISSED') !== '1') {
                hint.classList.add('active');
            }
            return;
        }

        // Notes exist: show panel, hide hint
        container.classList.add('active');
        if (hint) hint.classList.remove('active');

        list.innerHTML = '';

        var activeNotes = State.NOTES.filter(function(n) {
            return !n.path || n.path.indexOf('/.trash') !== 0;
        });

        // .13: Sort by modified date first, then created
        var notesToShow = activeNotes.map(function (n, i) { return { note: n, id: i + 1, index: i }; })
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

            // .13: Use modified date if available
            var displayTime = item.note.modified || item.note.created;
            var noteDate = new Date(displayTime);
            var today = new Date();
            var isToday = noteDate.toDateString() === today.toDateString();

            // .3: Show date if not today, V18.13: Show "Edited" prefix if modified
            var prefix = item.note.modified ? 'Edited ' : '';
            var dateStr = isToday ? '' : noteDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ';
            var time = noteDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            // .34: Apple Note Style
            var contentDisplay = item.note.content || item.note.text || '';

            // Header (Title + Time)
            var titleText = item.note.title || (contentDisplay ? contentDisplay.split('\n')[0].substring(0, 20) : 'Untitled');

            var headerHtml = '<div class="note-item-header">' +
                '<span class="note-item-title-quick">' + safeText(titleText) + '</span>' +
                '<span class="note-item-meta">' + dateStr + time + '</span>' +
                '</div>';

            // Plain-text teaser preview
            var teaserHtml = '<div class="note-item-teaser">' + safeText(Notes.getPlainTextPreview(contentDisplay)) + '</div>';

            div.innerHTML = headerHtml + teaserHtml;

            // .3: Click to edit
            div.setAttribute('data-note-index', item.index);
            div.addEventListener('click', function () {
                // .0: Use Notes.open exclusively
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

            // Load explicit (empty-safe) folders
            var folders = localStorage.getItem('VINLAND_EXPLICIT_FOLDERS');
            if (folders) this.explicitFolders = JSON.parse(folders);

        } catch (e) {
            console.warn('[Notes] Error loading State:', e);
        }
        
        // Legacy Schema Migration
        if (PageManager.migrateNotesToPathSchema) PageManager.migrateNotesToPathSchema();
        if (PageManager.migrateNotesToBlockSchema) PageManager.migrateNotesToBlockSchema();
        if (PageManager.migrateLegacyTasks) PageManager.migrateLegacyTasks(); // 
        this.renderSidebar();
        this.updateAllTags();


        // Initialize components
        if (typeof BlockEditor !== 'undefined' && BlockEditor.init) BlockEditor.init('block-editor');
        if (typeof SlashMenu !== 'undefined' && SlashMenu.init) SlashMenu.init();

        this.bindEvents();
        this.bindPreviewListeners(); // Preview Interactivity
        
        // Restore sidebar state + resize handle
        this._initSidebar();

        // Browser history: handle back/forward navigation
        var self = this;
        window.addEventListener('popstate', function(e) { self._handlePopState(e); });
        
        // Check URL for deep-linked note (before quick panel render)
        var hasDeepLink = this._checkUrlForNote();
        
        // Restore sidebar state (persistence)
        try {
            // Auto-show Quick Panel based on note count (replaces manual toggle)
            this.renderNotes();
        } catch (e) {
            console.warn('[Notes] Failed to render quick panel', e);
        }

        // Restore Maximized State (User Request: Absolute Throughput)
        try {
            var isMaximized = localStorage.getItem('VINLAND_NOTES_MAXIMIZED') === 'true';
            var editorModal = document.getElementById('note-editor-modal');
            var maxBtn = document.getElementById('note-maximize-btn');
            
            if (isMaximized && editorModal) {
                editorModal.classList.add('maximized');
                // Icon toggled via CSS on #note-editor-modal.maximized
                if (this.updateGlobalIconsVisibility) this.updateGlobalIconsVisibility(false);
            }
        } catch (ignore) {}
    },

    bindEvents: function () {
        // Note: Extensive event binding logic logic extracted from vinland.js
        // Ideally this should be reduced and delegated, but preserving logic for now.
        
        this._bindSidebarSearch();
        
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

        // Editor shortcuts (Cmd+S, Cmd+E) handled globally in Input.js capture-phase
        var closeBtn = document.getElementById('note-editor-close');
        if (closeBtn) closeBtn.onclick = function() { window.closeNoteEditor(); };

        var sidebarToggle = document.getElementById('sidebar-toggle-btn');
        if (sidebarToggle) {
             sidebarToggle.onclick = function() {
                 var sidebar = document.querySelector('.notes-sidebar');
                 if(sidebar) {
                     sidebar.classList.toggle('collapsed');
                 }
             };
        }

        // Breadcrumb toggle button - switch between breadcrumb and editable path
        var bcToggle = document.getElementById('breadcrumb-toggle-btn');
        var bcContainer = document.getElementById('note-breadcrumb');
        var pathEdit = document.getElementById('note-path-edit');
        if (bcToggle && bcContainer && pathEdit) {
            bcToggle.addEventListener('click', function() {
                var isHidden = pathEdit.style.display === 'none';
                bcContainer.style.display = isHidden ? 'none' : 'inline-flex';
                pathEdit.style.display = isHidden ? 'inline-block' : 'none';
                bcToggle.textContent = isHidden ? '✎' : '✖';
                bcToggle.title = isHidden ? 'Done editing' : 'Edit path';
                if (isHidden) {
                    pathEdit.focus();
                    pathEdit.select();
                }
            });
        }

        // Path edit input change listener - persist path when user edits it
        var pathEditInput = document.getElementById('note-path-edit');
        if (pathEditInput) {
            pathEditInput.addEventListener('change', function() {
                if (!self.activeNoteId) return;
                var newPath = pathEditInput.value.trim();
                if (!newPath) newPath = '/';
                // Ensure leading slash
                if (!newPath.startsWith('/')) newPath = '/' + newPath;
                // Strip trailing slash (unless root)
                if (newPath.length > 1 && newPath.endsWith('/')) newPath = newPath.slice(0, -1);
                // /root is the display name for actual root path /
                if (newPath === '/root') newPath = '/';
                self.moveNote(self.activeNoteId, newPath);
            });
            // Also commit on Enter key
            pathEditInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    pathEditInput.blur(); // triggers change event
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
                    // Icon toggled via CSS on #note-editor-modal.maximized
                    if (self.updateGlobalIconsVisibility) self.updateGlobalIconsVisibility(!isMax);
                    
                    // Persist Maximized State
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
                // Use existing folder-create-modal from index.html
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
                            self.registerFolder(folderPath); // Persist empty folder
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
                 if(window.KanbanManager) {
                     if (window.ModalManager && window.ModalManager.openInput) {
                         window.ModalManager.openInput('NEW_BOARD //', 'board_name', function(name) {
                             var board = window.KanbanManager.createBoard(name);
                             window.KanbanManager.open(board.id);
                             self.renderSidebar();
                         });
                     } else {
                         // Fallback: use native prompt
                         var name = prompt('Board Name:');
                         if (name) {
                             var board = window.KanbanManager.createBoard(name);
                             window.KanbanManager.open(board.id);
                             self.renderSidebar();
                         }
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
        // Note: Cmd+S (save) and Cmd+E (toggle preview) handled globally in Input.js
        // to prevent duplicate save flooding (audit P0 fix).
        document.addEventListener('keydown', function(e) {
            var modal = document.getElementById('note-editor-modal');
            var isNotesOpen = modal && modal.classList.contains('active');
            if (!isNotesOpen) return;
            
            var meta = e.ctrlKey || e.metaKey;
            
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
        // Capture modal state BEFORE any ModalManager.open() calls below
        var _modalEl = document.getElementById('note-editor-modal');
        var _modalWasActive = _modalEl && _modalEl.classList.contains('active');
        
        var toggleBtn = document.getElementById('preview-toggle');
        if (toggleBtn) toggleBtn.style.display = 'inline-block';
        
        // Cleanup auto-created empty notes when switching
        this._cleanupAutoNote(noteId);
        
        if (this.activeNoteId && this.activeNoteId !== noteId) {
            var current = State.NOTES.find(function (n) { return n.id === Notes.activeNoteId; });
            if (current) {
                // Canvas notes use canvasData, not content/blocks - never garbage collect them
                if (current.type === 'canvas') {
                    // Just save any pending changes
                    if (this.saveTimeout) { clearTimeout(this.saveTimeout); this.saveTimeout = null; this.save(); }
                } else {
                // Empty check logic
                var hasNoTitle = !current.title || current.title.trim() === '';
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
                } // end non-canvas block
            }
        }

        var note = State.NOTES.find(function (n) { return n.id === noteId; });
        if (!note && State.NOTES.length > 0) note = State.NOTES[0];
        if (!note) { this.create(); return; }

        this.activeNoteId = note.id;
        
        if (State.CONFIG.notes_tabs_enabled !== false && TabManager) {
            TabManager.openTab(note.id, note.title || 'Untitled');
        }

        // Migration: Ensure blocks exist
        if (!note.blocks || note.blocks.length === 0) {
            note.blocks = parseContentToBlocks(note.content);
            if (note.blocks.length === 0) PageManager.addBlock(note, 'p', '');
        }

        var titleInput = document.getElementById('active-note-title');
        if (titleInput) titleInput.value = note.title || '';
        
        var textarea = document.getElementById('active-note-content');
        var blockEditorEl = document.getElementById('block-editor');
        var preview = document.getElementById('note-preview');
        // toggleBtn already declared at open() start — reuse existing reference
        var canvasContainer = document.getElementById('canvas-container'); // Canvas Integration
        
        // Phase 1: Canvas Routing Override
        if (note.type === 'canvas') {
            console.log('[Notes] Canvas routing - noteId:', note.id, '| container found:', !!canvasContainer);
            if (textarea) textarea.style.display = 'none';
            if (preview) {
                preview.classList.remove('active');
                preview.style.display = 'none';
            }
            if (blockEditorEl) blockEditorEl.style.display = 'none';
            if (toggleBtn) toggleBtn.style.display = 'none';
            
            if (canvasContainer) {
                canvasContainer.style.display = 'flex';
                console.log('[Notes] Canvas container shown. offsetHeight:', canvasContainer.offsetHeight, '| offsetWidth:', canvasContainer.offsetWidth);
                if (window.CanvasManager) window.CanvasManager.load(note.id);
            }
            if (window.ModalManager) window.ModalManager.open('note-editor-modal');
            
            // Push to browser history before returning (canvas notes need history too)
            if (!this._historyPopState) {
                this._pushHistoryState(note.id, !_modalWasActive);
            }
            return;
        }
        
        // Reset defaults for standard markdown/text notes
        if (canvasContainer) canvasContainer.style.display = 'none';
        if (toggleBtn) toggleBtn.style.display = 'inline-block';

        // .37: Open modal BEFORE rendering so a render error can't prevent the editor from showing.
        if (window.ModalManager) window.ModalManager.open('note-editor-modal');

        this.isPreviewMode = (note.viewMode === 'preview');

        if (this.isPreviewMode) {
            if (textarea) textarea.style.display = 'none';
            if (blockEditorEl) blockEditorEl.style.display = 'none';
            if (preview) {
                if (PageManager) PageManager.syncContent(note.id);
                try {
                    preview.innerHTML = Notes.renderMarkdown(note.content || '');
                } catch (e) {
                    console.error('[Notes] renderMarkdown failed:', e);
                    preview.innerHTML = '<div style="color:var(--danger-color,#ff3355);padding:20px;text-align:center;">⚠ Preview Error: ' + e.message + '</div>';
                }
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
            
            try {
                if (BlockEditor) BlockEditor.render(note.id, skipFocus);
            } catch (e) {
                console.error('[Notes] BlockEditor.render failed:', e);
                if (window.showNotification) window.showNotification('Editor render error: ' + e.message, 'error');
            }
        }

        var pathEdit = document.getElementById('note-path-edit');
        if (pathEdit) {
            pathEdit.value = note.path === '/' ? '/root' : note.path;
        }
        this._renderBreadcrumb(note);

        // TRASH BANNER & READ-ONLY MODE
        var isTrash = note.path && note.path.indexOf('/.trash') === 0;
        var bannerContainer = document.getElementById('trash-banner-container');
        
        // Ensure banner container exists (use cached _modalEl from open() start)
        if (!bannerContainer && _modalEl) {
            bannerContainer = document.createElement('div');
            bannerContainer.id = 'trash-banner-container';
            // Insert before block-editor
            var editorContainer = document.querySelector('.modal-body') || editorModal;
            var blockEditor = document.getElementById('block-editor');
            if (blockEditor) {
                blockEditor.parentNode.insertBefore(bannerContainer, blockEditor);
            } else {
                editorContainer.prepend(bannerContainer);
            }
        }

        if (isTrash) {
            bannerContainer.innerHTML = 
                '<div style="background: rgba(255,0,85,0.1); border: 1px solid var(--danger-color); padding: 10px; margin-bottom: 15px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">' +
                    '<span style="color: var(--danger-color); font-size: 0.85rem;">⚠️ This note is in the Trash.</span>' +
                    '<div>' +
                        '<button id="btn-restore-note" style="background:var(--main-color); color:#000; border:none; padding:4px 8px; cursor:pointer; margin-right:5px; font-weight:bold;">RESTORE</button>' +
                        '<button id="btn-delete-forever" style="background:var(--danger-color); color:#fff; border:none; padding:4px 8px; cursor:pointer; font-weight:bold;">DELETE FOREVER</button>' +
                    '</div>' +
                '</div>';
            bannerContainer.style.display = 'block';

            // Disable editor
            if (blockEditorEl) {
                blockEditorEl.style.pointerEvents = 'none';
                blockEditorEl.style.opacity = '0.6';
            }
            if (textarea) {
                textarea.style.pointerEvents = 'none';
                textarea.style.opacity = '0.6';
            }
            
            // Hide path edit too to prevent moving
            var pathEditEl = document.getElementById('note-path-edit');
            if (pathEditEl) pathEditEl.disabled = true;

            // Bind Actions
            setTimeout(function() {
                var restoreBtn = document.getElementById('btn-restore-note');
                if (restoreBtn) {
                    restoreBtn.onclick = function() {
                        note.path = note.originalPath || '/'; // Restore to original folder
                        delete note.originalPath;
                        saveData();
                        Notes.open(note.id); // Reload to reset state
                        Notes.renderSidebar(); // Refresh sidebar to remove from trash count
                        Notes.renderNotes(); // Refresh Quick Notes panel
                    };
                }
                var deleteBtn = document.getElementById('btn-delete-forever');
                if (deleteBtn) {
                    deleteBtn.onclick = function() {
                        // Use PageActions global if available
                        if (typeof PageActions !== 'undefined' && PageActions.deleteNotePermanently) {
                            PageActions.deleteNotePermanently(note.id);
                        } else if (window.PageActions && window.PageActions.deleteNotePermanently) {
                             window.PageActions.deleteNotePermanently(note.id);
                        } else {
                            // Fallback if PageActions not yet updated
                            if (confirm('Permanently delete?')) {
                                var idx = State.NOTES.indexOf(note);
                                if (idx !== -1) State.NOTES.splice(idx, 1);
                                if (window.MetadataCache) window.MetadataCache.removeNote(note.id);
                                saveData();
                                Notes.activeNoteId = null;
                                document.getElementById('note-editor-close').click(); 
                                Notes.renderSidebar();
                                if (window.Sidebar && window.Sidebar.renderTrashView) window.Sidebar.renderTrashView();
                            }
                        }
                    };
                }
            }, 0);

        } else {
            if (bannerContainer) bannerContainer.style.display = 'none';
            if (blockEditorEl) {
                blockEditorEl.style.pointerEvents = 'auto';
                blockEditorEl.style.opacity = '1';
            }
            if (textarea) {
                textarea.style.pointerEvents = 'auto';
                textarea.style.opacity = '1';
            }
            var pathEditEl = document.getElementById('note-path-edit');
            if (pathEditEl) pathEditEl.disabled = false;
        }

        var timestamp = document.getElementById('note-timestamp');
        if (timestamp) {
            var d = new Date(note.modified || Date.now());
            timestamp.textContent = 'LAST EDITED: ' + d.toLocaleString();
        }

        this.renderSidebar();
        this.updateWordCount();
        this.updateTags();

        // Render properties panel
        if (window.PropertiesPanel && window.PropertiesPanel.render) {
            window.PropertiesPanel.render(note.id);
        }

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

        // Modal opened at this.open() start (line ~843) — no redundant re-open needed

        // Render backlinks panel
        this.renderBacklinks();

        // Render version history panel (async, fire-and-forget)
        if (window.VersionHistoryManager && window.VersionHistoryManager.renderPanel) {
            window.VersionHistoryManager.renderPanel(note.id);
        }

        // Push to browser history (replaceState on first open, pushState on subsequent)
        // _modalWasActive is captured at the top of open() before the modal is opened
        if (!this._historyPopState) {
            this._pushHistoryState(note.id, !_modalWasActive);
        }
    },

    create: function (initialTitle, initialPath, templateName) {
        // Enforce Untitled Note Guard for ALL creation entry points
        // Catches both empty titles AND the default 'Untitled' title
        if (this.activeNoteId) {
            var currentNote = State.NOTES.find(function(n) { return n.id === Notes.activeNoteId; });
            if (currentNote && (!currentNote.title || currentNote.title.trim() === '')) {
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

        // Apply template content if specified
        if (templateName) {
            var template = this._findTemplate(templateName);
            if (template) {
                this._applyTemplateToNote(newNote, template);
            }
        }

        State.NOTES.unshift(newNote);
        saveData();
        this.open(newNote.id);

        setTimeout(function () {
            var el = document.getElementById('active-note-title');
            if (el) el.focus();
        }, 100);

        this.renderNotes();
    },

    // Find a template note by title or name
    _findTemplate: function(name) {
        if (!name) return null;
        var q = name.toLowerCase().trim();
        return State.NOTES.find(function(n) {
            if (n.type === 'canvas') return false;
            if (n.path && n.path.indexOf('/.trash') === 0) return false;
            var inTemplates = n.path && (n.path === '/Templates' || n.path.indexOf('/Templates/') === 0);
            var hasTemplateFlag = false;
            if (n.content && n.content.startsWith('---')) {
                var endIdx = n.content.indexOf('---', 3);
                if (endIdx > 0) {
                    hasTemplateFlag = /\btemplate:\s*true\b/.test(n.content.substring(0, endIdx + 3));
                }
            }
            if (!inTemplates && !hasTemplateFlag) return false;
            var title = (n.title || '').toLowerCase();
            return title === q || title.indexOf(q) !== -1;
        });
    },

    // Copy template content into a new note
    _applyTemplateToNote: function(newNote, template) {
        // Copy content from template
        newNote.content = template.content || '';

        // Copy blocks (deep clone)
        if (template.blocks && Array.isArray(template.blocks)) {
            newNote.blocks = JSON.parse(JSON.stringify(template.blocks));
        }

        // Strip YAML frontmatter from content if present
        if (newNote.content && newNote.content.startsWith('---')) {
            var endIdx = newNote.content.indexOf('---', 3);
            if (endIdx > 0) {
                newNote.content = newNote.content.substring(endIdx + 3).trim();
            }
        }

        console.log('[Notes] Applied template:', template.title);
    },

    // Create a new note from a template (called by TemplateBrowser)
    createFromTemplate: function(template) {
        if (!template) return;

        var prompt = 'Title for new note (from "' + (template.title || 'Untitled') + '"):';
        var title = '';

        // Use ModalManager.openInput if available, else prompt
        if (window.ModalManager && window.ModalManager.openInput) {
            window.ModalManager.openInput(prompt, 'new_note_title', function(inputTitle) {
                Notes.create(inputTitle || '', '/', template.title);
            });
        } else {
            title = prompt(prompt);
            if (title !== null) {
                this.create(title || '', '/', template.title);
            }
        }
    },

    delete: function () {
        if (!this.activeNoteId) return;
        if (this.saveTimeout) clearTimeout(this.saveTimeout);

        var idx = State.NOTES.findIndex(n => n.id === this.activeNoteId);
        if (idx > -1) {
            var deletedPath = State.NOTES[idx] ? (State.NOTES[idx].path || '/') : '/';
            var deletedId = this.activeNoteId;
            State.NOTES.splice(idx, 1);
            saveData();
            this.activeNoteId = null;

            // Phase 3: Remove from MetadataCache
            if (window.MetadataCache && window.MetadataCache.removeNote) {
                window.MetadataCache.removeNote(deletedId);
            }

            if (State.NOTES.length > 0) {
                var tabSwitched = false;
                if (TabManager && TabManager.tabs.length > 0) {
                    if (TabManager.activeIndex < TabManager.tabs.length) {
                        this.open(TabManager.tabs[TabManager.activeIndex].noteId);
                        tabSwitched = true;
                    } else if (TabManager.tabs.length > 0) {
                        this.open(TabManager.tabs[TabManager.tabs.length - 1].noteId);
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
        this.renderNotes();
        this.renderSidebar();
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

        // Sync properties panel frontmatter into note content (BEFORE saveData)
        if (window.PropertiesPanel && window.PropertiesPanel.syncToNote) {
            window.PropertiesPanel.syncToNote(note);
        }

        if (oldTitle !== note.title) {
            saveData();
            this.renderSidebar();
            this.renderNotes();
        }
        
        saveData();
        this.updateAllTags();

        // Phase 3: Update MetadataCache index (uses updated content from syncToNote)
        if (window.MetadataCache && window.MetadataCache.updateNote) {
            window.MetadataCache.updateNote(this.activeNoteId);
        }

        // Capture version snapshot (fire-and-forget, async IndexedDB write)
        if (window.VersionHistoryManager && window.VersionHistoryManager.captureSnapshot) {
            window.VersionHistoryManager.captureSnapshot(this.activeNoteId);
        }

        // Sync flashcard index after save (fire-and-forget)
        if (window.FlashcardManager && window.FlashcardManager.syncFromNotes) {
            window.FlashcardManager.syncFromNotes();
        }

        // Refresh backlinks panel after save (wiki links may have changed)
        this.renderBacklinks();

        var status = document.getElementById('save-status');
        if (status) {
            status.textContent = 'SAVED';
            status.classList.add('saved');
            setTimeout(() => status.classList.remove('saved'), 2000);
        }
        this.updateWordCount();
    },

    // Persist folder expand/collapse state (called by Sidebar.js)
    saveExpandedState: function() {
        localStorage.setItem('OPERATOR_EXPANDED_FOLDERS', JSON.stringify(this.expandedFolders));
    },

    // Register an explicit folder so it persists even when empty
    registerFolder: function(path) {
        if (!path || path === '/') return;
        if (this.explicitFolders.indexOf(path) === -1) {
            this.explicitFolders.push(path);
            localStorage.setItem('VINLAND_EXPLICIT_FOLDERS', JSON.stringify(this.explicitFolders));
        }
    },

    // Unregister an explicit folder
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

    // Move note to a new path
    moveNote: function(noteId, newPath) {
        var note = State.NOTES.find(function(n) { return n.id === noteId; });
        if (!note) return;

        note.path = newPath;
        note.modified = Date.now();
        saveData();

        this.renderSidebar();

        // Update path display if this is the active note
        if (this.activeNoteId === noteId) {
            var pathEl = document.getElementById('note-path-edit');
            if (pathEl) pathEl.value = newPath === '/' ? '/root' : newPath;
            this._renderBreadcrumb(note);
        }

        if (window.showNotification) {
            window.showNotification('Moved to ' + newPath);
        }
    },

    // Move an entire folder (and all notes under it) to a new parent path
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

    // Delete a folder and all notes within it
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
                // Always unregister from explicit folders
                self.unregisterFolder(path);

                if (noteCount > 0) {
                    var deletedNotes = State.NOTES.filter(function(n) {
                        return (n.path === path || n.path.startsWith(path + '/'));
                    });
                    deletedNotes.forEach(function(n) {
                        if (window.TabManager) window.TabManager.closeTabById(n.id);
                        if (window.MetadataCache) window.MetadataCache.removeNote(n.id);
                    });
                    
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

    // Render the backlinks panel showing all notes that link to this one
    renderBacklinks: function () {
        var panel = document.getElementById('note-backlinks-panel');
        if (!panel) {
            // Create panel if it doesn't exist yet
            panel = document.createElement('div');
            panel.id = 'note-backlinks-panel';
            panel.className = 'empty';
            // Insert after the visible editor element (preview takes priority if visible)
            var blockEditor = document.getElementById('block-editor');
            var notePreview = document.getElementById('note-preview');
            var previewVisible = notePreview && getComputedStyle(notePreview).display !== 'none';
            var insertAfter = previewVisible ? notePreview : blockEditor;
            if (insertAfter && insertAfter.parentNode) {
                insertAfter.parentNode.insertBefore(panel, insertAfter.nextSibling);
            }
        }

        if (!this.activeNoteId) {
            panel.classList.remove('active');
            panel.classList.add('empty');
            return;
        }

        var note = State.NOTES.find(function (n) { return n.id === Notes.activeNoteId; });
        if (!note || note.type === 'canvas') { // Canvas notes use their own backlinks system
            panel.classList.remove('active');
            panel.classList.add('empty');
            return;
        }

        // Use MetadataCache for fast backlinks lookup
        var backlinks = [];
        if (window.MetadataCache && window.MetadataCache.getBacklinks) {
            backlinks = window.MetadataCache.getBacklinks(note.id);
        }

        // Also check via title-based lookup for wiki links that reference this note by title
        var titleLinkingNotes = [];
        if (window.MetadataCache && window.MetadataCache.getLinkingNotes) {
            titleLinkingNotes = window.MetadataCache.getLinkingNotes(note.title || '');
        }

        // Merge and deduplicate
        var mergedMap = {};
        backlinks.concat(titleLinkingNotes).forEach(function (m) {
            if (m && m.id && !mergedMap[m.id]) {
                mergedMap[m.id] = m;
            }
        });

        var merged = Object.keys(mergedMap).map(function (id) { return mergedMap[id]; });

        if (merged.length === 0) {
            panel.classList.remove('active');
            panel.classList.add('empty');
            return;
        }

        panel.classList.add('active');
        panel.classList.remove('empty');

        var html = '<div class="note-backlinks-header">' +
            '<span>BACKLINKS</span>' +
            '<span class="note-backlinks-count">' + merged.length + ' reference' + (merged.length !== 1 ? 's' : '') + '</span>' +
            '</div>';

        var self = this;
        merged.forEach(function (bl) {
            // Get a content snippet from the linking note
            var snippet = '';
            var content = '';
            if (bl.content) {
                content = bl.content;
            } else if (bl.blocks && bl.blocks.length > 0) {
                content = bl.blocks.map(function (b) { return b.content || ''; }).join('\n');
            }
            if (content) {
                // Get the first non-empty line around the wiki link reference
                var escapedQuote = note.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                var titlePattern = new RegExp('\\[\\[\\s*' + escapedQuote + '\\s*(\\|.*?)?\\]\\]', 'i');
                var lines = content.split('\n');
                for (var i = 0; i < lines.length; i++) {
                    if (titlePattern.test(lines[i])) {
                        snippet = lines[i].trim();
                        if (snippet.length > 100) {
                            snippet = snippet.substring(0, 97) + '...';
                        }
                        break;
                    }
                }
                if (!snippet) {
                    snippet = content.replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim().substring(0, 100);
                }
            }

            html += '<div class="note-backlink-item" data-note-id="' + bl.id + '">' +
                '<span class="note-backlink-icon">' + '\u2191' + '</span>' +
                '<div class="note-backlink-body">' +
                '<div class="note-backlink-title">' + safeText(bl.title || 'Untitled') + '</div>' +
                (snippet ? '<div class="note-backlink-snippet">' + safeText(snippet) + '</div>' : '') +
                '</div>' +
                '</div>';
        });

        panel.innerHTML = html;

        // Bind click handlers (use Array.from for browser compat)
        Array.from(panel.querySelectorAll('.note-backlink-item')).forEach(function (el) {
            el.addEventListener('click', function () {
                var id = el.getAttribute('data-note-id');
                if (id && window.Notes) {
                    window.Notes.open(id);
                }
            });
        });
    },

    // Alias for safeText from Utils (keep backward compat with existing code)
    _escapeHtml: function (str) {
        return safeText(str);
    },

    // Rich Kanban Preview HTML Generator (Synced with BlockEditor.js)
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

    // Toggle Checkbox in Preview
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

                // Use BlockEditor.highlightSyntax if available for same look
                if (typeof BlockEditor !== 'undefined' && BlockEditor.highlightSyntax) {
                    var highlighted = BlockEditor.highlightSyntax(code, lang);
                    codeBlocks.push('<pre class="block-code"><code class="code-inner language-' + (lang || 'plain') + '">' + highlighted + '</code><span class="code-lang-label">' + (lang || 'plain').toUpperCase() + '</span></pre>');
                    return isTeaser ? '<span class="teaser-tag">[CODE: ' + (lang || 'TEXT') + ']</span> ' : '%%CODE_BLOCK_' + idx + '%%';
                }

                var escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                codeBlocks.push('<pre class="block-code"><code class="code-inner language-' + (lang || 'plain') + '">' + escapedCode + '</code><span class="code-lang-label">' + (lang || 'plain').toUpperCase() + '</span></pre>');
                return isTeaser ? '<span class="teaser-tag">[CODE]</span> ' : '%%CODE_BLOCK_' + idx + '%%';
            });
            
            // Extract image blocks BEFORE HTML escape to preserve base64 URLs and to ensure they parse before Callouts grab them
            var imageBlocks = [];
            html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(match, alt, url) {
                var idx = imageBlocks.length;
                
                // Apply markdown styling to alt text for WYSIWYG
                var styledAlt = alt;
                // 2. Bold (**text**)
                styledAlt = styledAlt.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
                
                // 3. Italic (*text*)
                styledAlt = styledAlt.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');
                
                // 4. Underline (<u>text</u>) -> Already escaped by step 1, so unescape them
                styledAlt = styledAlt.replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/gi, '<u>$1</u>')
                                   .replace(/<u>(.*?)<\/u>/gi, '<u>$1</u>');
                                   
                imageBlocks.push('<div class="preview-image-container"><img src="' + url + '" alt="' + alt.replace(/"/g, '&quot;') + '" class="preview-img"><div class="preview-image-caption">' + styledAlt + '</div></div>');
                return isTeaser ? '<span class="teaser-tag">[IMAGE]</span> ' : '%%IMAGE_BLOCK_' + idx + '%%';
            });
            
            // Extract transclusion blocks (![[Note Title]]) BEFORE HTML escape
            var transclusionBlocks = [];
            html = html.replace(/!\[\[([^\]]+)\]\]/g, function(match, noteTitle) {
                var idx = transclusionBlocks.length;
                var title = noteTitle.trim();
                var targetNote = State.NOTES.find(function(n) {
                    return (n.title || '').toLowerCase() === title.toLowerCase();
                });

                if (targetNote) {
                    var targetContent = targetNote.content || '';
                    if (!targetContent && targetNote.blocks) {
                        targetContent = targetNote.blocks.map(function(b) { return b.content || ''; }).join(' ');
                    }
                    var renderedContent = '';
                    if (targetContent) {
                        // Recursively render the target note's content through markdown
                        renderedContent = self.renderMarkdown(targetContent, true);
                    }
                    var transHtml = '<div class="preview-embed">' +
                        '<div class="preview-embed-header">' +
                            '<span class="preview-embed-icon">\uD83D\uDD17</span>' +
                            '<span class="preview-embed-title internal-link" data-link="' + title.replace(/"/g, '&quot;') + '">' + safeText(title) + '</span>' +
                        '</div>' +
                        '<div class="preview-embed-body">' +
                            (renderedContent || '<span class="preview-embed-empty">(empty note)</span>') +
                        '</div>' +
                    '</div>';
                    transclusionBlocks.push(transHtml);
                } else {
                    transclusionBlocks.push('<div class="preview-embed preview-embed-missing">' +
                        '<span class="preview-embed-icon">\u26A0</span>' +
                        '<span class="preview-embed-missing-title">Note not found: ' + safeText(title) + '</span>' +
                    '</div>');
                }

                return isTeaser ? '<span class="teaser-tag">[EMBED: ' + safeText(title) + ']</span> ' : '%%TRANSCLUSION_BLOCK_' + idx + '%%';
            });

            // Extract Kanban blocks BEFORE HTML escape
            var kanbanBlocks = [];
            // Use getKanbanPreviewHtml for updated telemetry
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

            // Extract Callout blocks AFTER Images, Code, and Kanbans so their %%% tokens are safely bundled inside the Callout
            var calloutBlocks = [];
            var calloutColors = {
                'INFO': { icon: 'ℹ️', color: '#00E5FF' },
                'WARNING': { icon: '⚠️', color: '#FFB800' },
                'DANGER': { icon: '🛑', color: '#FF0055' },
                'SUCCESS': { icon: '✅', color: '#00FF41' },
                'NOTE': { icon: '📝', color: '#9D00FF' },
                'TIP': { icon: '💡', color: '#FFD700' },
                'QUOTE': { icon: '💬', color: '#888888' }
            };
            
            // Parse Callout safely by strictly matching lines that start with `>`
            // Capture preceding space/newline to prevent fusing with adjacent blocks like Dividers
            html = html.replace(/(^|\n)> \[!(\w+)\]\s*([^\n]*)((?:\n>.*)*)/g, function(match, prefix, type, title, body) {
                var idx = calloutBlocks.length;
                var typeUpper = type.toUpperCase();
                var cfg = calloutColors[typeUpper] || calloutColors['NOTE'];
                var safeTitle = (title || typeUpper).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                
                // Keep the block tokens intact instead of escaping them
                var safeBody = (body || '').trim()
                    .replace(/^>\s*/gm, '') // Strip continuing blockquote prefixes
                    .replace(/&(?!(?:amp|lt|gt|quot|#\d+);)/g, '&amp;') 
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                    
                // Apply internal block formatting
                safeBody = safeBody.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                   .replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
                                   .replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/gi, '<u>$1</u>')
                                   .replace(/<u>(.*?)<\/u>/gi, '<u>$1</u>')
                                   .replace(/`([^`]+)`/g, '<code>$1</code>')
                                   .replace(/\n/g, '<br>');

                var calloutHtml = '<div style="border-left: 4px solid ' + cfg.color + '; ' +
                    'background-color: ' + cfg.color + '15; ' +
                    'padding: 15px; margin: 10px 0; border-radius: 4px;">' +
                    '<div style="display: flex; align-items: center; gap: 8px; ' +
                    'font-weight: bold; color: ' + cfg.color + '; margin-bottom: 8px;">' +
                        '<span>' + cfg.icon + '</span>' +
                        '<span>' + safeTitle + '</span>' +
                    '</div>' +
                    '<div style="color: #ccc; line-height: 1.6;">' + safeBody + '</div>' +
                '</div>';

                calloutBlocks.push(calloutHtml);
                return prefix + (isTeaser ? '<span class="teaser-tag">[' + typeUpper + ']</span> ' : '%%CALLOUT_BLOCK_' + idx + '%%');
            });
            
            // Alignment Marker Extraction
            var alignments = [];
            var aLines = html.split('\n');
            html = aLines.map(function(line, idx) {
                var alignMatch = line.match(/\s?%%align:(left|center|right)%%\s*$/);
                if (alignMatch) {
                    alignments[idx] = alignMatch[1];
                    return line.replace(/\s?%%align:(left|center|right)%%\s*$/, '');
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
            // Enabled Checkboxes
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
            html = html.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
            html = html.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

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
            
            // Re-insert transclusion blocks
            transclusionBlocks.forEach(function(block, idx) {
                html = html.replace('%%TRANSCLUSION_BLOCK_' + idx + '%%', block);
            });

            // Re-insert Kanban blocks
            kanbanBlocks.forEach(function(block, idx) {
                html = html.replace('%%KANBAN_BLOCK_' + idx + '%%', block);
            });
            
            // Re-insert Callout blocks
            calloutBlocks.forEach(function(block, idx) {
                html = html.replace('%%CALLOUT_BLOCK_' + idx + '%%', block);
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
        // Strip fenced code blocks and inline code before scanning for tags
        var cleaned = content.replace(/```[\w]*\n[\s\S]*?```/g, '');
        cleaned = cleaned.replace(/`[^`]+`/g, '');
        var matches = cleaned.match(/#[\w]+/g);
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
        // Clear tag search input when filtering by tag
        var tagSearchInput = document.getElementById('tags-search-input');
        if (tagSearchInput) tagSearchInput.value = '';
        this.updateAllTags();
    },
    
    updateAllTags: function(filterQuery) {
        var container = document.getElementById('sidebar-all-tags');
        if (!container) return;

        // Use MetadataCache.getAllTags() for fast, indexed tag data
        // Includes tags from #hashtag in content AND frontmatter tags
        var allTags = {};
        if (window.MetadataCache && window.MetadataCache.getAllTags) {
            allTags = window.MetadataCache.getAllTags();
        } else {
            // Fallback: manual extraction if MetadataCache unavailable
            var self = this;
            State.NOTES.forEach(function (note) {
                if (note.path && note.path.indexOf('/.trash') === 0) return;
                if (note.blocks && note.blocks.length > 0) {
                    note.blocks.forEach(function(b) {
                        var blockTags = self.extractTags(b.content || '');
                        blockTags.forEach(function (tag) {
                            var clean = tag.replace('#', '');
                            allTags[clean] = (allTags[clean] || 0) + 1;
                        });
                    });
                }
                var tags = self.extractTags(note.content || '');
                tags.forEach(function (tag) {
                    var clean = tag.replace('#', '');
                    allTags[clean] = (allTags[clean] || 0) + 1;
                });
            });
        }

        // Sort by count descending, then alphabetically
        var sorted = Object.keys(allTags).sort(function (a, b) {
            if (allTags[b] !== allTags[a]) return allTags[b] - allTags[a];
            return a.localeCompare(b);
        });

        // Apply tag name filter if provided
        if (filterQuery) {
            sorted = sorted.filter(function(tag) {
                return tag.indexOf(filterQuery) >= 0;
            });
        }

        container.innerHTML = '';

        if (sorted.length === 0) {
            container.innerHTML = '<span class="tag-empty">' +
                (filterQuery ? 'No tags matching &quot;' + this._escapeHtml(filterQuery) + '&quot;' : 'No tags yet') +
                '</span>';
            return;
        }

        var self = this;
        sorted.forEach(function (tag) {
            var wrapper = document.createElement('span');
            wrapper.className = 'tag-wrapper';

            var span = document.createElement('span');
            span.className = 'tag';
            if (self.activeTagFilter === tag) span.classList.add('active-tag');
            span.textContent = '#' + tag;
            span.style.cursor = 'pointer';
            span.title = allTags[tag] + ' note' + (allTags[tag] !== 1 ? 's' : '');
            
            span.onclick = function() {
                self.filterByTag(tag);
            };
            wrapper.appendChild(span);

            // Count badge
            var badge = document.createElement('span');
            badge.className = 'tag-badge';
            badge.textContent = allTags[tag];
            wrapper.appendChild(badge);
            
            container.appendChild(wrapper);
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
    },

    // Export all data (notes, tasks, boards, canvases, config, history) as downloadable JSON
    downloadNotes: function () {
        var exportData = {
            exportedAt: new Date().toISOString(),
            exportVersion: 1,
            config: State.CONFIG,
            notes: State.NOTES,
            tasks: State.TASKS,
            boards: State.BOARDS,
            canvases: State.CANVASES,
            history: State.COMMAND_HISTORY
        };
        var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'vinland_backup_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (window.showNotification) {
            window.showNotification('VAULT EXPORTED // vinland_backup_' + new Date().toISOString().slice(0, 10) + '.json');
        }
    }
};

/* =========================================
   STANDALONE FUNCTIONS
   ========================================= */

export function renderNotes() {
    if (typeof Notes !== 'undefined' && Notes.renderNotes) {
        Notes.renderNotes();
    }
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
    // Legacy: now redirects to opening the full notes editor sidebar
    if (window.Notes && window.Notes.toggleSidebar) {
        window.Notes.toggleSidebar();
    } else {
        var panel = document.getElementById('notes-panel');
        if (panel) panel.classList.toggle('active');
    }
}

export function closeNoteEditor() {
    if (PageManager && Notes.activeNoteId) {
        PageManager.syncContent(Notes.activeNoteId);
        // Update MetadataCache before closing so backlinks are fresh
        if (window.MetadataCache && window.MetadataCache.updateNote) {
            window.MetadataCache.updateNote(Notes.activeNoteId);
        }
    }
    ModalManager.closeTop(true);
}

export function openNewNoteEditor() {
    if (Notes.activeNoteId) {
        // Prevent infinite tabs/new notes if untitled
    }
    Notes.create();
}
