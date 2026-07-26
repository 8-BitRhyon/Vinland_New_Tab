/**
 * WikiLinkAutocomplete - [[Wiki Link]] autocomplete for BlockEditor
 *
 * Detects when the user types [[ in a contenteditable block and shows
 * a dropdown of matching note titles from MetadataCache.
 *
 * Following the same overlay pattern as SlashMenu.
 */

export const WikiLinkAutocomplete = {
    element: null,
    visible: false,
    targetBlockId: null,
    selectedIndex: 0,
    filterQuery: '',
    // Track the start position of the [[ selection so we can replace the text
    linkStartOffset: -1,
    textNode: null,

    /**
     * Get text content before the cursor in a contenteditable
     */
    _getTextBeforeCursor: function(contenteditableEl) {
        var sel = window.getSelection();
        if (!sel.rangeCount) return '';
        var range = sel.getRangeAt(0);
        var node = range.startContainer;
        var offset = range.startOffset;

        // If the cursor is in a text node, get the text up to the cursor
        if (node.nodeType === 3) {
            return node.textContent.substring(0, offset);
        }

        // Otherwise, just get the entire text content up to the cursor position
        // This happens when the cursor is at the start of an element with no text yet
        return '';
    },

    /**
     * Check if the text before cursor contains [[ and extract the query
     * Returns { active: bool, query: string, startOffset: number } or null
     */
    _detectWikilink: function(textBeforeCursor) {
        if (!textBeforeCursor) return null;

        // Find the last occurrence of [[ in the text before cursor
        var lastOpen = textBeforeCursor.lastIndexOf('[[');
        if (lastOpen === -1) return null;

        // Make sure this is actually [[ (double bracket), and not a single [
        if (lastOpen > 0 && textBeforeCursor[lastOpen - 1] === '[') {
            // This is part of [[[, look for the real start
            lastOpen = textBeforeCursor.lastIndexOf('[[', lastOpen - 1);
            if (lastOpen === -1) return null;
        }

        // Extract the query text between [[ and cursor
        var query = textBeforeCursor.substring(lastOpen + 2);

        // Don't show if there's a closing ]] before the cursor (already closed)
        if (query.indexOf(']]') !== -1) return null;

        // Don't show if there's a newline in the query
        if (query.indexOf('\n') !== -1) return null;

        return {
            active: true,
            query: query,
            startOffset: lastOpen
        };
    },

    /**
     * Search notes by title for autocomplete
     */
    _searchNotes: function(query) {
        var results = [];
        if (!window.MetadataCache) return results;

        var lowerQuery = query.toLowerCase().trim();

        if (!lowerQuery) {
            // Show first 10 notes when query is empty (just typed [[)
            var count = 0;
            window.MetadataCache.index.forEach(function(metadata, noteId) {
                if (count < 10 && metadata.title) {
                    results.push({
                        id: noteId,
                        title: metadata.title,
                        path: metadata.path || '/'
                    });
                    count++;
                }
            });
            return results;
        }

        // Search by title
        window.MetadataCache.index.forEach(function(metadata, noteId) {
            if (!metadata.title) return;
            var title = metadata.title;
            var lower = title.toLowerCase();

            if (lower.includes(lowerQuery)) {
                // Calculate score for ranking
                var score = 0;
                if (lower === lowerQuery) score = 100;
                else if (lower.startsWith(lowerQuery)) score = 80;
                else if (lower.includes(' ' + lowerQuery)) score = 60;
                else if (lower.includes(lowerQuery)) score = 40;

                results.push({
                    id: noteId,
                    title: title,
                    path: metadata.path || '/',
                    score: score
                });
            }
        });

        // Sort by score (highest first), then alphabetically
        results.sort(function(a, b) {
            if (b.score !== a.score) return b.score - a.score;
            return a.title.localeCompare(b.title);
        });

        // Limit to 15 results
        return results.slice(0, 15);
    },

    /**
     * Determine which block is being edited and if [[ was typed
     */
    checkInput: function(e) {
        if (this.visible) {
            // Already showing — update filter as user types
            var textBefore = this._getTextBeforeCursor(e.target);
            var detection = this._detectWikilink(textBefore);

            if (!detection || !detection.active) {
                this.hide();
                return;
            }

            this.filterQuery = detection.query;
            this.selectedIndex = 0;
            this.render();
            return;
        }

        // Not visible yet — check if [[ was just typed
        var textBefore = this._getTextBeforeCursor(e.target);
        var detection = this._detectWikilink(textBefore);

        if (!detection || !detection.active) return;

        // Only show if there's a [[ and we've typed at least 0 chars after it
        // (Show immediately when user types [[)
        this.filterQuery = detection.query;
        this.selectedIndex = 0;

        // Get the block element
        var blockEl = e.target.closest('.block-wrapper');
        if (!blockEl) return;

        this.show(blockEl, detection.query);
    },

    init: function() {
        this.element = document.createElement('div');
        this.element.id = 'wikilink-autocomplete';
        this.element.className = 'wikilink-autocomplete';
        this.element.style.cssText = 'display:none;';

        this.itemsContainer = document.createElement('div');
        this.itemsContainer.className = 'wikilink-items';
        this.element.appendChild(this.itemsContainer);

        document.body.appendChild(this.element);

        var self = this;

        // Close on click outside
        document.addEventListener('mousedown', function(e) {
            if (self.visible && !self.element.contains(e.target)) {
                self.hide();
            }
        });

        // Inject styles
        if (!document.getElementById('wikilink-autocomplete-styles')) {
            var style = document.createElement('style');
            style.id = 'wikilink-autocomplete-styles';
            style.textContent = `
                .wikilink-autocomplete {
                    position: fixed;
                    z-index: 30000;
                    background: rgba(0, 0, 0, 0.95);
                    border: 1px solid var(--main-color, #00ff41);
                    border-radius: 6px;
                    min-width: 200px;
                    max-width: 350px;
                    max-height: 280px;
                    overflow-y: auto;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5), 0 0 15px rgba(0, 255, 65, 0.15);
                    font-family: inherit;
                    font-size: 0.8rem;
                    animation: wlFadeIn 0.1s ease;
                }
                @keyframes wlFadeIn {
                    from { opacity: 0; transform: translateY(-4px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                .wikilink-item {
                    padding: 7px 12px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    transition: background 0.1s ease;
                    border-left: 2px solid transparent;
                }
                .wikilink-item:hover,
                .wikilink-item.selected {
                    background: rgba(0, 255, 65, 0.08);
                    border-left-color: var(--main-color, #00ff41);
                }
                .wikilink-item-title {
                    color: #eee;
                    font-size: 0.78rem;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    flex: 1;
                }
                .wikilink-item-path {
                    color: #555;
                    font-size: 0.6rem;
                    margin-left: 8px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 80px;
                }
                .wikilink-empty {
                    padding: 12px;
                    color: #666;
                    font-size: 0.7rem;
                    text-align: center;
                    font-style: italic;
                }
                .wikilink-header {
                    padding: 6px 12px;
                    color: rgba(255, 255, 255, 0.3);
                    font-size: 0.55rem;
                    letter-spacing: 1px;
                    text-transform: uppercase;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                }
                .wikilink-autocomplete::-webkit-scrollbar {
                    width: 4px;
                }
                .wikilink-autocomplete::-webkit-scrollbar-track {
                    background: transparent;
                }
                .wikilink-autocomplete::-webkit-scrollbar-thumb {
                    background: var(--main-color, #00ff41);
                    border-radius: 2px;
                }
            `;
            document.head.appendChild(style);
        }

        console.log('[WikiLinkAutocomplete] Initialized');
    },

    show: function(blockEl, query) {
        this.targetBlockId = blockEl.getAttribute('data-block-id');
        this.visible = true;
        this.selectedIndex = 0;
        this.filterQuery = query;

        // Register capture-phase Escape listener (fires before Input.js/modal capture handlers)
        var self = this;
        this._captureEscHandler = function(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                self.hide();
            }
        };
        document.addEventListener('keydown', this._captureEscHandler, { capture: true });

        this.render();

        // Position below the cursor
        var sel = window.getSelection();
        if (sel.rangeCount > 0) {
            var range = sel.getRangeAt(0);
            var rect = range.getBoundingClientRect();

            if (rect.height === 0 || rect.width === 0) {
                // Fallback: position near the block
                var blockRect = blockEl.getBoundingClientRect();
                this.element.style.top = (blockRect.bottom + window.scrollY + 5) + 'px';
                this.element.style.left = (blockRect.left + window.scrollX) + 'px';
            } else {
                this.element.style.top = (rect.bottom + window.scrollY + 4) + 'px';
                this.element.style.left = (rect.left + window.scrollX) + 'px';
            }
        } else {
            var blockRect = blockEl.getBoundingClientRect();
            this.element.style.top = (blockRect.bottom + window.scrollY + 5) + 'px';
            this.element.style.left = (blockRect.left + window.scrollX) + 'px';
        }

        this.element.style.display = 'block';

        // Viewport boundary check
        var menuRect = this.element.getBoundingClientRect();
        var viewportHeight = window.innerHeight;
        if (menuRect.bottom > viewportHeight - 10) {
            var newTop = parseFloat(this.element.style.top) - menuRect.height - 24;
            if (newTop > 0) {
                this.element.style.top = newTop + 'px';
            }
        }
    },

    hide: function() {
        this.element.style.display = 'none';
        this.visible = false;
        this.targetBlockId = null;
        this.filterQuery = '';
        this.selectedIndex = 0;

        // Remove capture-phase Escape listener
        if (this._captureEscHandler) {
            document.removeEventListener('keydown', this._captureEscHandler, { capture: true });
            this._captureEscHandler = null;
        }
    },

    render: function() {
        var self = this;
        var results = this._searchNotes(this.filterQuery);

        var html = '';

        if (results.length > 0) {
            html += '<div class="wikilink-item" style="cursor:default;border-left:none;padding:6px 12px;color:rgba(255,255,255,0.35);font-size:0.6rem;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.06);">Matching Notes</div>';
            results.forEach(function(note, i) {
                var selected = (i === self.selectedIndex) ? ' selected' : '';
                var pathDisplay = note.path && note.path !== '/' ? note.path : '';
                html += '<div class="wikilink-item' + selected + '" data-note-id="' + note.id + '">' +
                    '<span class="wikilink-item-title">' + self._escapeHtml(note.title) + '</span>' +
                    (pathDisplay ? '<span class="wikilink-item-path">' + self._escapeHtml(pathDisplay) + '</span>' : '') +
                    '</div>';
            });
        } else {
            html = '<div class="wikilink-empty">No notes match "' + this._escapeHtml(this.filterQuery) + '"</div>';
        }

        this.itemsContainer.innerHTML = html;

        // Bind click handlers
        this.itemsContainer.querySelectorAll('.wikilink-item[data-note-id]').forEach(function(el) {
            el.addEventListener('click', function() {
                var idx = Array.from(self.itemsContainer.querySelectorAll('.wikilink-item[data-note-id]')).indexOf(el);
                if (idx !== -1) {
                    self._selectSuggestion(idx);
                }
            });
        });

        // Scroll selected into view
        var selectedEl = this.itemsContainer.querySelector('.wikilink-item.selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
    },

    _escapeHtml: function(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    handleKey: function(e) {
        if (!this.visible) return false;

        var results = this._searchNotes(this.filterQuery);

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            this.selectedIndex = Math.min(this.selectedIndex + 1, Math.max(0, results.length - 1));
            this.render();
            return true;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            this.selectedIndex = Math.max(0, this.selectedIndex - 1);
            this.render();
            return true;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (results.length > 0) {
                this._selectSuggestion(this.selectedIndex);
            }
            return true;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
            return true;
        }

        return false;
    },

    /**
     * Insert the selected note title as a [[wiki link]] into the contenteditable
     */
    _selectSuggestion: function(index) {
        var results = this._searchNotes(this.filterQuery);
        if (index < 0 || index >= results.length) return;

        var selectedNote = results[index];
        var linkText = '[[' + selectedNote.title + ']]';

        // Save targetBlockId BEFORE calling hide() (hide() resets it to null)
        var savedBlockId = this.targetBlockId;
        this.hide();

        // Find the contenteditable element and insert the wiki link
        var blockEl = document.querySelector('[data-block-id="' + savedBlockId + '"]');
        if (!blockEl) return;

        var contentEl = blockEl.querySelector('[contenteditable="true"]');
        if (!contentEl) return;

        // Focus the element first
        contentEl.focus();

        var sel = window.getSelection();
        if (!sel.rangeCount) return;

        var range = sel.getRangeAt(0);
        var node = range.startContainer;
        var offset = range.startOffset;

        // Get the full text of the node
        if (node.nodeType === 3) {
            var fullText = node.textContent;
            // Find the last [[ before the cursor
            var textBefore = fullText.substring(0, offset);
            var lastOpen = textBefore.lastIndexOf('[[');

            if (lastOpen !== -1) {
                // Replace from [[ to cursor with [[Title]]
                var before = fullText.substring(0, lastOpen);
                var after = fullText.substring(offset);
                var newText = before + linkText + after;
                node.textContent = newText;

                // Set cursor position after the inserted link
                var newRange = document.createRange();
                var newOffset = lastOpen + linkText.length;
                newRange.setStart(node, Math.min(newOffset, node.textContent.length));
                newRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(newRange);
            }
        }

        // Trigger input event to sync with the block editor
        var inputEvent = new Event('input', { bubbles: true, cancelable: true });
        contentEl.dispatchEvent(inputEvent);

        console.log('[WikiLinkAutocomplete] Inserted link to:', selectedNote.title);
    }
};
