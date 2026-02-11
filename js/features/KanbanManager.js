import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';
import { ModalManager } from '../ui/ModalManager.js';
import { Notes } from '../modules/NotesController.js';
import { PageManager } from '../editor/PageManager.js';
import { BlockEditor } from '../editor/BlockEditor.js';

// Helper for global confirm modal
function getShowConfirmModal() {
    return window.showConfirmModal || function(t, m, y) { if(confirm(t + '\n' + m)) y(); };
}

export const KanbanManager = {
    activeBoard: null,
    editingCardId: null,
    editingColId: null,
    selectColIdx: -1, 
    selectCardIdx: -1,
    isGrabbing: false, 
    grabSourceColIdx: -1,
    grabSourceCardIdx: -1,
    boundHandleKey: null, 

    init: function() {
        console.log('[KanbanManager] Initialized');
        // Any global listeners can go here
    },

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
        State.BOARDS.push(board);
        saveData();
        this.syncPage(); 
        return board;
    },

    open: function (boardId) {
        this.activeBoard = State.BOARDS.find(function (b) { return b.id === boardId; });
        if (!this.activeBoard) return;

        this.selectColIdx = -1; 
        this.selectCardIdx = -1;

        var modal = document.getElementById('kanban-modal');
        var title = document.getElementById('kanban-modal-title');

        if (modal && title) {
            title.textContent = 'BOARD : ' + this.activeBoard.title.toUpperCase();
            ModalManager.open('kanban-modal');
            
            if (this.boundHandleKey) document.removeEventListener('keydown', this.boundHandleKey);
            this.boundHandleKey = this.handleKey.bind(this);
            document.addEventListener('keydown', this.boundHandleKey);
        }
        this.render();
    },

    handleKey: function(e) {
        if (!this.activeBoard || this.editingCardId || this.editingColId) return;
        
        var modal = document.getElementById('kanban-modal');
        if (!modal || !modal.classList.contains('active')) return;

        var key = e.key.toLowerCase();
        var cols = this.activeBoard.columns;
        var self = this;

        if (this.selectColIdx === -1) {
            if (['h', 'j', 'k', 'l', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'enter', 'n'].includes(key)) {
                e.preventDefault();
                this.selectColIdx = 0;
                this.selectCardIdx = 0; 
                if (cols[0].cards.length === 0) this.selectCardIdx = -1;
                this.render();
                return;
            }
        }

        if (key === ' ' || key === 'spacebar') {
            e.preventDefault();
            if (this.selectCardIdx !== -1) {
                if (!this.isGrabbing) {
                    this.isGrabbing = true;
                    this.grabSourceColIdx = this.selectColIdx;
                    this.grabSourceCardIdx = this.selectCardIdx;
                } else {
                    this.isGrabbing = false;
                    
                    if (this.grabSourceColIdx !== this.selectColIdx || this.grabSourceCardIdx !== this.selectCardIdx) {
                        var srcCol = cols[this.grabSourceColIdx];
                        var srcCard = srcCol ? srcCol.cards[this.grabSourceCardIdx] : null;
                        var destCol = cols[this.selectColIdx];
                        
                        if (srcCard) {
                            srcCol.cards.splice(this.grabSourceCardIdx, 1);
                            var insertIdx = this.selectCardIdx;
                            if (insertIdx < 0) insertIdx = 0;
                            if (insertIdx > destCol.cards.length) insertIdx = destCol.cards.length;
                            destCol.cards.splice(insertIdx, 0, srcCard);
                            
                            this.activeBoard.modified = Date.now();
                            saveData();
                            this.syncPage(); 
                        }
                    }
                    this.grabSourceColIdx = -1;
                    this.grabSourceCardIdx = -1;
                }
                this.render();
            }
        } else if (key === 'escape') {
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
            if (!this.isGrabbing) {
                e.preventDefault();
                this.addCard(cols[this.selectColIdx].id, 'New Task');
                this.selectCardIdx = cols[this.selectColIdx].cards.length - 1;
                this.render();
                
                var cardId = cols[this.selectColIdx].cards[this.selectCardIdx].id;
                setTimeout(function() { self.startEditCard(cardId, cols[self.selectColIdx].id); }, 50);
            }
        } else if (key === 'd' || key === 'backspace') {
            e.preventDefault();
            if (this.selectCardIdx !== -1 && !this.isGrabbing) {
                var card = cols[this.selectColIdx].cards[this.selectCardIdx];
                this.deleteCard(cols[this.selectColIdx].id, card.id);
                this.selectCardIdx = Math.min(this.selectCardIdx, cols[this.selectColIdx].cards.length - 1);
                this.render();
            }
        } else if (key === 'enter') {
            if (this.selectCardIdx !== -1 && !this.isGrabbing) {
                 e.preventDefault();
                var card = cols[this.selectColIdx].cards[this.selectCardIdx];
                this.startEditCard(card.id, cols[this.selectColIdx].id);
            }
        } else if (['h', 'j', 'k', 'l', 'arrowleft', 'arrowdown', 'arrowup', 'arrowright'].includes(key)) {
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
        var modal = document.getElementById('kanban-modal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
        }
        
        if (this.boundHandleKey) {
            document.removeEventListener('keydown', this.boundHandleKey);
            this.boundHandleKey = null;
        }

        ModalManager.stack = ModalManager.stack.filter(function(id) { return id !== 'kanban-modal'; });
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

        this.activeBoard.columns.forEach(function (col, colIdx) {
            var colEl = document.createElement('div');
            colEl.className = 'kanban-column' + (self.selectColIdx === colIdx ? ' selected-col' : '');
            colEl.setAttribute('data-col-id', col.id);

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

            var ghostRendered = false;
            col.cards.forEach(function (card, cardIdx) {
                if (self.isGrabbing && self.selectColIdx === colIdx && self.selectCardIdx === cardIdx) {
                    var ghostEl = document.createElement('div');
                    ghostEl.className = 'kanban-card ghost';
                    var srcCol = self.activeBoard.columns[self.grabSourceColIdx];
                    var srcCard = srcCol ? srcCol.cards[self.grabSourceCardIdx] : null;
                    ghostEl.innerHTML = srcCard ? self.renderCardMarkdown(srcCard.content) : '...';
                    cardList.appendChild(ghostEl);
                    ghostRendered = true;
                    
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

            if (self.isGrabbing && self.selectColIdx === colIdx && !ghostRendered) {
                 var ghostEl = document.createElement('div');
                 ghostEl.className = 'kanban-card ghost';
                 var srcCol = self.activeBoard.columns[self.grabSourceColIdx];
                 var srcCard = srcCol ? srcCol.cards[self.grabSourceCardIdx] : null;
                 ghostEl.innerHTML = srcCard ? self.renderCardMarkdown(srcCard.content) : '...';
                 cardList.appendChild(ghostEl);
                 
                 setTimeout(function() { ghostEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 10);
            }

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

            var addBtn = document.createElement('button');
            addBtn.className = 'kanban-add-card';
            addBtn.textContent = '+ ADD_LOG_ENTRY';
            addBtn.onclick = function () {
                inputArea.style.display = 'block';
                inputField.focus();
            };

            var rafId = null;
            colEl.addEventListener('dragover', function (e) {
                e.preventDefault();
                colEl.classList.add('drag-over');
                
                if (rafId) return; 
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

        var addColBtn = document.createElement('div');
        addColBtn.className = 'kanban-add-column';
        addColBtn.innerHTML = '<span>+ ADD_COLUMN</span>';
        addColBtn.onclick = function() {
            self.addColumn('NEW_COLUMN');
        };
        container.appendChild(addColBtn);
    },

    createCardElement: function(card, colId, isSelected, isGrabbing) {
        var self = this;
        var cardEl = document.createElement('div');
        cardEl.className = 'kanban-card' + (isSelected ? ' focused' : '') + (isGrabbing ? ' grabbing' : '');
        cardEl.draggable = true;
        cardEl.setAttribute('data-card-id', card.id);
        
        var cardContent = document.createElement('div');
        cardContent.className = 'kanban-card-content';
        cardContent.innerHTML = this.renderCardMarkdown(card.content);
        
        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'kanban-card-delete';
        deleteBtn.textContent = 'X';
        deleteBtn.title = 'Delete card';
        deleteBtn.onclick = function(e) {
            e.stopPropagation();
            self.deleteCard(card.id, colId);
        };
        
        cardContent.onclick = function(e) {
            if (e.target.tagName === 'A') return; 
            self.startEditCard(card.id, colId, cardContent, card.content);
        };

        cardEl.ondblclick = function(e) {
            e.stopPropagation();
            if (card.content && typeof Notes !== 'undefined') {
                (Notes.openByTitle(card.content) || Notes.create(card.content));
            }
        };
        
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

    renderCardMarkdown: function(content) {
        if (!content) return '';
        var html = content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/#(urgent|critical)/gi, '<span class="kanban-tag urgent">#$1</span>');
        html = html.replace(/#(dev|code)/gi, '<span class="kanban-tag dev">#$1</span>');
        html = html.replace(/#(design|ui)/gi, '<span class="kanban-tag design">#$1</span>');
        html = html.replace(/#(\w+)/g, '<span class="kanban-tag">#$1</span>');
        html = html.replace(/\n/g, '<br>');
        return html;
    },

    startEditCard: function(cardId, colId, contentEl, currentContent) {
        if (this.editingCardId) return; 
        
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
                self.render(); 
            }
            self.editingCardId = null;
            self.editingColId = null;
        };
        
        textarea.onblur = saveEdit;
        textarea.onkeydown = function(e) {
            e.stopPropagation(); 
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
            
            var board = State.BOARDS.find(function(b) { return b.id === boardId; });
            if (board && board.columns.length > 0) {
                board.columns[0].cards.push({
                    id: 'card_' + Date.now(),
                    content: content,
                    created: Date.now()
                });
                board.modified = Date.now();
                saveData();
                
                input.value = '';
                input.placeholder = 'Saved! Add another...';
                setTimeout(function() { input.placeholder = '+ Add to Backlog...'; }, 1000);
                
                this.syncPage();
            }
        }
    },

    advanceCard: function(cardId, boardId) {
        var board = boardId ? State.BOARDS.find(function(b) { return b.id === boardId; }) : this.activeBoard;
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
            var cardIdx = fromCol.cards.findIndex(function(c) { return c.id === cardId; });
            var card = fromCol.cards.splice(cardIdx, 1)[0];
            toCol.cards.push(card);
            board.modified = Date.now();
            saveData();
            this.syncPage(); 
            if (board === this.activeBoard) this.render();
            return true;
        }
        return false;
    },

    startEditColumnTitle: function(colId, titleEl) {
        var self = this;
        var col = this.activeBoard.columns.find(function(c) { return c.id === colId; });
        if (!col) return;
        
        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'kanban-col-edit-' + colId; 
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

    syncPage: function() {
        if (typeof Notes !== 'undefined' && Notes.activeNoteId) {
             var note = State.NOTES.find(function(n) { return n.id === Notes.activeNoteId; });
             if (!note) return;
             
             if (Notes.isPreviewMode) {
                 var preview = document.getElementById('note-preview');
                 if (preview) {
                     if (typeof PageManager !== 'undefined') PageManager.syncContent(note.id);
                     preview.innerHTML = Notes.renderMarkdown(note.content || '');
                 }
             } else {
                 if (typeof BlockEditor !== 'undefined') {
                     BlockEditor.render(note.id, true); 
                 }
             }
        }
    },

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
        this.syncPage(); 
        this.render();
    },

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
        this.syncPage(); 
        this.render();
    },

    deleteCard: function(cardId, colId) {
        if (!this.activeBoard) return;
        var col = this.activeBoard.columns.find(function(c) { return c.id === colId; });
        if (!col) return;
        
        var cardIdx = col.cards.findIndex(function(c) { return c.id === cardId; });
        if (cardIdx === -1) return;
        
        col.cards.splice(cardIdx, 1);
        this.activeBoard.modified = Date.now();
        saveData();
        this.syncPage(); 
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
        this.syncPage(); 
        if (!skipRender) this.render();
    },

    addColumn: function(title) {
        if (!this.activeBoard) return;
        
        this.activeBoard.columns.push({
            id: 'col_' + Date.now(),
            title: title || 'NEW_COLUMN',
            cards: []
        });
        
        this.activeBoard.modified = Date.now();
        saveData();
        this.syncPage(); 
        this.render();
    },

    renameColumn: function(colId, newTitle) {
        if (!this.activeBoard) return;
        var col = this.activeBoard.columns.find(function(c) { return c.id === colId; });
        if (!col) return;
        
        col.title = newTitle;
        this.activeBoard.modified = Date.now();
        saveData();
        this.syncPage(); 
        this.render();
    },

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
            self.syncPage(); 
            self.render();
        };
        
        if (col.cards.length > 0) {
            getShowConfirmModal()(
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
