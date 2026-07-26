/**
 * CanvasSearch — Find-in-Canvas overlay for CanvasManager
 *
 * Cmd+F opens a search overlay that finds nodes by title/content/label,
 * highlights matches, and scrolls/zooms to the selected node.
 */
export const CanvasSearch = {
    visible: false,
    filterQuery: '',
    results: [],
    selectedIndex: -1,
    _escapeHandler: null,

    /**
     * Toggle the search overlay open/closed
     */
    toggle: function() {
        if (this.visible) {
            this.close();
        } else {
            this.open();
        }
    },

    /**
     * Open the search overlay
     */
    open: function() {
        if (this.visible) return;
        const note = window.State.NOTES.find(n => n.id === window.CanvasManager.activeNoteId);
        if (!note || !note.canvasData || !note.canvasData.nodes || note.canvasData.nodes.length === 0) return;

        this._injectStyles();

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'canvas-search-overlay';
        overlay.id = 'canvas-search-overlay';
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) this.close();
        });

        // Create panel
        const panel = document.createElement('div');
        panel.className = 'canvas-search-panel';
        panel.id = 'canvas-search-panel';

        // Header with search input
        const header = document.createElement('div');
        header.className = 'canvas-search-header';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'canvas-search-input';
        input.id = 'canvas-search-input';
        input.placeholder = 'Search nodes...';

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'canvas-search-close';
        closeBtn.textContent = '\u00d7';
        closeBtn.addEventListener('click', () => this.close());

        header.appendChild(input);
        header.appendChild(closeBtn);

        // Results container
        const resultsEl = document.createElement('div');
        resultsEl.className = 'canvas-search-results';
        resultsEl.id = 'canvas-search-results';

        // Footer with hint
        const footer = document.createElement('div');
        footer.className = 'canvas-search-footer';
        footer.innerHTML = '<kbd>\u2191</kbd><kbd>\u2193</kbd> navigate &middot; <kbd>\u23ce</kbd> select &middot; <kbd>ESC</kbd> close';

        panel.appendChild(header);
        panel.appendChild(resultsEl);
        panel.appendChild(footer);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        this.visible = true;
        this.overlay = overlay;
        this.panel = panel;
        this.resultsEl = resultsEl;
        this.input = input;
        this.filterQuery = '';
        this.selectedIndex = -1;

        // Search all nodes initially
        this._search('');

        // Focus input
        setTimeout(() => {
            if (self.visible && document.getElementById('canvas-search-input')) {
                input.focus();
                input.select();
            }
        }, 50);

        // Input handler
        const self = this;
        input.addEventListener('input', function() {
            self._search(this.value);
        });

        // Keyboard navigation
        input.addEventListener('keydown', function(e) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                self._navigate(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                self._navigate(-1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                self._selectCurrent();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                self.close();
            }
        });

        // Escape to close (capture phase)
        this._escapeHandler = function(e) {
            if (e.key === 'Escape' && self.visible) {
                e.preventDefault();
                e.stopPropagation();
                self.close();
            }
        };
        window.addEventListener('keydown', this._escapeHandler, { capture: true });
    },

    /**
     * Close the search overlay
     */
    close: function() {
        if (!this.visible) return;
        if (this._escapeHandler) {
            window.removeEventListener('keydown', this._escapeHandler, { capture: true });
            this._escapeHandler = null;
        }
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        this.panel = null;
        this.resultsEl = null;
        this.input = null;
        this.visible = false;
        this.filterQuery = '';
        this.results = [];
        this.selectedIndex = -1;
    },

    /**
     * Perform search across canvas nodes
     */
    _search: function(query) {
        this.filterQuery = query;
        const note = window.State.NOTES.find(n => n.id === window.CanvasManager.activeNoteId);
        if (!note || !note.canvasData || !note.canvasData.nodes) {
            this._renderResults([]);
            return;
        }

        if (!query.trim()) {
            // Empty query: show all nodes
            this._renderResults(note.canvasData.nodes);
            return;
        }

        const q = query.toLowerCase();
        const matched = [];

        note.canvasData.nodes.forEach(function(node) {
            var searchableText = '';
            if (node.title) searchableText += node.title + ' ';
            if (node.preview) searchableText += node.preview + ' ';
            if (node.label) searchableText += node.label + ' ';
            if (node.type === 'file' && node.linkedNoteId) {
                var linkedNote = window.State.NOTES.find(function(n) { return n.id === node.linkedNoteId; });
                if (linkedNote && linkedNote.title) searchableText += linkedNote.title + ' ';
            }

            if (searchableText.toLowerCase().includes(q)) {
                matched.push(node);
            }
        });

        this._renderResults(matched);
    },

    /**
     * Render search results list
     */
    _renderResults: function(results) {
        this.results = results;
        this.selectedIndex = results.length > 0 ? 0 : -1;

        if (!this.resultsEl) return;

        if (results.length === 0) {
            this.resultsEl.innerHTML = '<div class="canvas-search-empty">' +
                (this.filterQuery.trim() ? 'No nodes match "' + this.filterQuery + '"' : 'No nodes in canvas') +
                '</div>';
            return;
        }

        var self = this;
        var html = '';
        results.forEach(function(node, index) {
            var title = node.title || node.label || 'Untitled Node';
            var subtitle = '';
            if (node.type === 'file') {
                subtitle = 'File node';
            } else if (node.type === 'embed') {
                subtitle = 'Embed: ' + (node.title || node.url || '');
            } else if (node.type === 'group') {
                subtitle = 'Group: ' + (node.label || '');
            } else {
                subtitle = node.preview ? node.preview.substring(0, 60) : 'Text node';
                if (node.preview && node.preview.length > 60) subtitle += '\u2026';
            }

            var selectedClass = index === self.selectedIndex ? ' canvas-search-item-selected' : '';
            html += '<div class="canvas-search-item' + selectedClass + '" data-index="' + index + '">' +
                '<div class="canvas-search-item-title">' + self._escapeHtml(title) + '</div>' +
                '<div class="canvas-search-item-subtitle">' + self._escapeHtml(subtitle) + '</div>' +
                '</div>';
        });
        this.resultsEl.innerHTML = html;

        // Click to select
        var self2 = this;
        this.resultsEl.querySelectorAll('.canvas-search-item').forEach(function(item) {
            item.addEventListener('click', function() {
                var idx = parseInt(this.getAttribute('data-index'), 10);
                self2.selectedIndex = idx;
                self2._selectCurrent();
            });

            item.addEventListener('mouseenter', function() {
                var idx = parseInt(this.getAttribute('data-index'), 10);
                if (idx !== self2.selectedIndex) {
                    self2.selectedIndex = idx;
                    self2._updateSelection();
                }
            });
        });

        // Ensure selected item is visible
        this._scrollToSelected();
    },

    /**
     * Update visual selection highlight
     */
    _updateSelection: function() {
        if (!this.resultsEl) return;
        this.resultsEl.querySelectorAll('.canvas-search-item').forEach(function(item) {
            var idx = parseInt(item.getAttribute('data-index'), 10);
            item.classList.toggle('canvas-search-item-selected', idx === CanvasSearch.selectedIndex);
        });
    },

    _escapeHtml: function(text) {
        if (!text) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    /**
     * Navigate results (delta: +1 or -1)
     */
    _navigate: function(delta) {
        if (this.results.length === 0) return;
        this.selectedIndex = (this.selectedIndex + delta + this.results.length) % this.results.length;
        this._updateSelection();
        this._scrollToSelected();
    },

    /**
     * Scroll the selected result into view in the results list
     */
    _scrollToSelected: function() {
        if (!this.resultsEl || this.selectedIndex < 0) return;
        var selected = this.resultsEl.querySelector('.canvas-search-item-selected');
        if (selected) {
            selected.scrollIntoView({ block: 'nearest' });
        }
    },

    /**
     * Select the currently highlighted result: focus + scroll-to node
     */
    _selectCurrent: function() {
        if (this.selectedIndex < 0 || this.selectedIndex >= this.results.length) return;
        var node = this.results[this.selectedIndex];

        // Select the node on the canvas
        var cm = window.CanvasManager;
        if (cm) {
            cm.clearSelection();
            cm.selectNode(node.id, false);

            // Scroll to make the node visible
            this._scrollToNode(node);
        }

        this.close();
    },

    /**
     * Scroll/pan the canvas to bring a node into the center of view
     */
    _scrollToNode: function(node) {
        var cm = window.CanvasManager;
        if (!cm || !cm.container) return;

        var rect = cm.container.getBoundingClientRect();
        var nodeW = node.width || 200;
        var nodeH = node.height || 80;

        // Calculate center of node in world coordinates
        var nodeCenterX = node.x + nodeW / 2;
        var nodeCenterY = node.y + nodeH / 2;

        // Calculate transform to center the node on screen
        var newScale = cm.transform.scale;
        // If scale is very zoomed out, zoom in a bit for the selected node
        if (newScale < 0.5) newScale = 0.5;

        var newX = (rect.width / 2) - (nodeCenterX * newScale);
        var newY = (rect.height / 2) - (nodeCenterY * newScale);

        cm.transform.x = newX;
        cm.transform.y = newY;
        cm.transform.scale = newScale;
        cm.updateTransform();
        cm.updateUI();
        cm._saveViewport();

        // Flash the selected node for visual feedback
        var card = document.getElementById('canvas-node-' + node.id);
        if (card) {
            card.style.transition = 'box-shadow 0.3s ease, filter 0.3s ease';
            card.style.boxShadow = '0 0 30px var(--main-color, #00ff41), 0 0 60px rgba(0, 255, 65, 0.3)';
            card.style.filter = 'brightness(1.3)';
            setTimeout(function() {
                card.style.boxShadow = '';
                card.style.filter = '';
                setTimeout(function() {
                    card.style.transition = '';
                }, 300);
            }, 800);
        }
    },

    /**
     * Inject CSS styles for the search overlay
     */
    _injectStyles: function() {
        if (document.getElementById('canvas-search-styles')) return;

        var style = document.createElement('style');
        style.id = 'canvas-search-styles';
        style.textContent = `
            .canvas-search-overlay {
                position: fixed;
                inset: 0;
                z-index: 39999;
                background: rgba(0, 0, 0, 0.4);
                animation: canvasSearchOverlayIn 0.12s ease;
            }
            @keyframes canvasSearchOverlayIn {
                from { opacity: 0; }
                to   { opacity: 1; }
            }
            .canvas-search-panel {
                position: fixed;
                top: 80px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 40000;
                width: 420px;
                max-height: 480px;
                background: rgba(0, 0, 0, 0.95);
                border: 1px solid var(--main-color, #00ff41);
                border-radius: 8px;
                box-shadow: 0 0 40px rgba(0, 255, 65, 0.2), 0 4px 20px rgba(0, 0, 0, 0.6);
                font-family: inherit;
                font-size: 0.8rem;
                animation: canvasSearchPanelIn 0.15s ease;
                display: flex;
                flex-direction: column;
            }
            @keyframes canvasSearchPanelIn {
                from { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.97); }
                to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
            }
            .canvas-search-header {
                display: flex;
                align-items: center;
                padding: 10px 12px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                gap: 8px;
            }
            .canvas-search-input {
                flex: 1;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 4px;
                padding: 8px 10px;
                color: #eee;
                font-family: inherit;
                font-size: 0.8rem;
                outline: none;
                transition: border-color 0.15s ease;
            }
            .canvas-search-input:focus {
                border-color: var(--main-color, #00ff41);
            }
            .canvas-search-input::placeholder {
                color: #555;
            }
            .canvas-search-close {
                color: #666;
                cursor: pointer;
                font-size: 1.2rem;
                line-height: 1;
                transition: color 0.15s ease;
                background: none;
                border: none;
                padding: 0 4px;
            }
            .canvas-search-close:hover {
                color: #ff3333;
            }
            .canvas-search-results {
                flex: 1;
                overflow-y: auto;
                padding: 4px 0;
                max-height: 360px;
            }
            .canvas-search-results::-webkit-scrollbar {
                width: 4px;
            }
            .canvas-search-results::-webkit-scrollbar-track {
                background: transparent;
            }
            .canvas-search-results::-webkit-scrollbar-thumb {
                background: var(--main-color, #00ff41);
                border-radius: 2px;
            }
            .canvas-search-item {
                padding: 8px 12px;
                cursor: pointer;
                transition: background 0.1s ease;
                border-left: 2px solid transparent;
            }
            .canvas-search-item:hover {
                background: rgba(0, 255, 65, 0.06);
            }
            .canvas-search-item-selected {
                background: rgba(0, 255, 65, 0.12);
                border-left-color: var(--main-color, #00ff41);
            }
            .canvas-search-item-title {
                color: #eee;
                font-weight: 500;
                font-size: 0.78rem;
                margin-bottom: 2px;
            }
            .canvas-search-item-subtitle {
                color: #666;
                font-size: 0.68rem;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .canvas-search-empty {
                padding: 24px 12px;
                color: #555;
                font-size: 0.75rem;
                text-align: center;
            }
            .canvas-search-footer {
                padding: 8px 12px;
                border-top: 1px solid rgba(255, 255, 255, 0.06);
                color: #555;
                font-size: 0.6rem;
                text-align: center;
            }
            .canvas-search-footer kbd {
                display: inline-block;
                padding: 1px 4px;
                font-size: 0.58rem;
                font-family: inherit;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 3px;
                color: #aaa;
                line-height: 1.3;
                margin: 0 1px;
            }
        `;
        document.head.appendChild(style);
    }
};
