import { State } from '../core/Store.js';
import { safeText } from '../core/Utils.js';
import { saveData } from '../core/Storage.js';

// Placeholder for future NotesController import
// import { Notes } from "../modules/NotesController.js";

/* =========================================
   PHASE 2: TREE VIEW HELPERS
   ========================================= */

/**
 * Build logical folder structure from flat notes list
 * Returns object: { "folderName": { ...subfolders..., __files__: [notes] } }
 */
export function buildDirectoryStructure(notes) {
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

    // V87: Inject explicit (empty) folders so they persist in the tree
    var Notes = window.Notes;
    if (Notes && Notes.explicitFolders) {
        Notes.explicitFolders.forEach(function(folderPath) {
            var parts = folderPath.split('/').filter(function(p) { return p.length > 0; });
            var current = root;
            var currentPath = '';

            parts.forEach(function(part) {
                currentPath += '/' + part;
                if (!current[part]) {
                    current[part] = { __files__: [], __path__: currentPath };
                }
                current = current[part];
            });
        });
    }

    return root;
}

/**
 * Recursive Tree Filter
 * Returns new structure containing only matching items/ancestors
 */
export function filterTreeStructure(structure, query) {
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
export function renderFileTree(structure, basePath, forceExpand) {
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
        var isExpanded = forceExpand || (typeof Notes !== 'undefined' && Notes.expandedFolders && Notes.expandedFolders.indexOf(fullPath) !== -1);

        var iconState = isExpanded ? '[-]' : '[+]';
        header.innerHTML = `
            <span class="folder-icon">${iconState}</span>
            <span class="folder-name">${safeText(folderName)}</span>
            <span class="folder-delete-btn" title="Delete folder and contents">[X]</span>
        `;

        // Folder Delete Event
        var delBtn = header.querySelector('.folder-delete-btn');
        if (delBtn) {
            delBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (typeof Notes !== 'undefined' && typeof Notes.deleteFolder === 'function') {
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

            if (noteId && typeof Notes !== 'undefined' && typeof Notes.moveNote === 'function') {
                Notes.moveNote(noteId, fullPath);
            } else if (srcFolderPath && typeof Notes !== 'undefined' && typeof Notes.moveFolder === 'function') {
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
            if (typeof Notes !== 'undefined') {
                var idx = Notes.expandedFolders.indexOf(fullPath);
                if (nowOpen) {
                    if (idx === -1) Notes.expandedFolders.push(fullPath);
                } else {
                    if (idx !== -1) Notes.expandedFolders.splice(idx, 1);
                }
                Notes.saveExpandedState();
            }
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

        if (typeof Notes !== 'undefined') {
            if (note.id === Notes.activeNoteId) noteEl.classList.add('active');
            if (Notes.selectedNotes && Notes.selectedNotes.indexOf(note.id) !== -1) noteEl.classList.add('selected');
        }

        var title = note.title || 'Untitled Note';
        var date = new Date(note.modified).toLocaleDateString();

        // ASCII PIN (Safe)
        var pinDisplay = note.pinned ? '<span class="pin-icon" style="color:var(--main-color); margin-right:4px;">[PIN]</span>' : '';

        noteEl.innerHTML = `
            <div class="note-title">${pinDisplay}${safeText(title)}</div>
            <div class="note-snippet">${date}</div>
        `;

        noteEl.addEventListener('click', function (e) {
            if (typeof Notes !== 'undefined') {
                if (Notes.isSelectionMode) {
                    Notes.toggleSelection(note.id);
                } else {
                    Notes.open(note.id);
                }
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

/**
 * Main Sidebar Renderer (Extracted from Notes.renderSidebar)
 */
export function renderSidebar(query) {
    var sidebarList = document.getElementById('notes-list-sidebar');
    if (!sidebarList) return;

    sidebarList.innerHTML = '';

    // V63.4: ALL TASKS entry removed - Task Manager deprecated
    // Future: Will link to Task Modal instead

    // V3.9: Tree View Implementation
    var searchInput = document.getElementById('notes-search');
    var filterTerm = (query || (searchInput ? searchInput.value : '')).toLowerCase();

    var structure = buildDirectoryStructure(State.NOTES);

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

        if (noteId && typeof Notes !== 'undefined') {
            Notes.moveNote(noteId, '/');
        } else if (srcFolderPath && typeof Notes !== 'undefined') {
            Notes.moveFolder(srcFolderPath, '/');
        }
    });
    sidebarList.appendChild(rootDrop);

    // V15.0: BOARDS SECTION - V65 Enhanced
    if (State.BOARDS && State.BOARDS.length > 0) {
        var boardSection = document.createElement('div');
        boardSection.className = 'tree-boards-section';
        
        var boardHeader = document.createElement('div');
        boardHeader.className = 'tree-folder-header tree-boards-header';
        boardHeader.innerHTML = '<span class="tree-folder-icon">></span>' +
            '<span class="tree-folder-title tree-boards-title">DATA_BOARDS</span>' +
            '<span class="tree-folder-count">' + State.BOARDS.length + '</span>';
        
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
        
        State.BOARDS.forEach(function (board) {
            var boardItem = document.createElement('div');
            boardItem.className = 'tree-board-item';
            
            var boardLabel = document.createElement('span');
            boardLabel.className = 'tree-board-label';
            boardLabel.textContent = board.title.toUpperCase();
            boardLabel.onclick = function() { 
                if (typeof KanbanManager !== 'undefined') KanbanManager.open(board.id); 
            };
            
            // V65: Delete board button with dedicated modal
            var boardDelete = document.createElement('button');
            boardDelete.className = 'tree-board-delete';
            boardDelete.textContent = 'X';
            boardDelete.title = 'Delete board';
            boardDelete.onclick = function(e) {
                e.stopPropagation();
                var totalCards = board.columns.reduce(function(sum, col) { return sum + col.cards.length; }, 0);
                if (typeof showConfirmModal === 'function') {
                    showConfirmModal(
                        'DELETE_BOARD',
                        'Permanently delete "' + board.title + '"?<br><span style="color:#666">Contains ' + board.columns.length + ' columns and ' + totalCards + ' cards.</span>',
                        function() {
                            var idx = State.BOARDS.findIndex(function(b) { return b.id === board.id; });
                            if (idx !== -1) {
                                State.BOARDS.splice(idx, 1);
                                saveData();
                                if (typeof KanbanManager !== 'undefined') KanbanManager.syncPage(); // V67
                                renderSidebar(); // Recursive call to self (exported function)
                            }
                        },
                        null,
                        'DELETE'
                    );
                }
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
    if (typeof Notes !== 'undefined' && Notes.updateAllTags) {
        Notes.updateAllTags();
    }
}
