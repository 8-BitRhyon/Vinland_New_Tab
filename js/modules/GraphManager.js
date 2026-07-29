
import { State } from '../core/Store.js';
import { ModalManager } from '../ui/ModalManager.js';
import { Notes } from './NotesController.js';

export const GraphManager = {
    simulation: null,
    svg: null,
    g: null,
    width: 0,
    height: 0,
    containerId: 'graph-container',
    isLocalMode: false, // Local Focus Mode state
    filterQuery: '', // Search/filter query
    zoomBehavior: null, // D3 zoom behavior (stored for zoom-to-fit)
    svgSelection: null, // D3 SVG selection (parent of zoom)
    folderFilter: '', // Selected folder for graph scoping
    _clickTimer: null, // Timer for click/dblclick separation

    // .38: Persist graph node positions to localStorage
    saveLayout: function() {
        if (!this.simulation) return;
        var nodes = this.simulation.nodes();
        if (!nodes || nodes.length === 0) return;

        nodes.forEach(function(n) {
            if (n.x != null && n.y != null) {
                Notes.graphLayout[n.id] = { x: n.x, y: n.y };
            }
        });

        try {
            localStorage.setItem('VINLAND_GRAPH_LAYOUT', JSON.stringify(Notes.graphLayout));
        } catch (e) {
            console.warn('[Graph] Failed to persist layout', e);
        }
    },

    // ─── Layout Persistence Controls ─────────────────────────

    /**
     * Pin all current nodes at their current positions (set fx/fy).
     * Freezes the entire layout so it stays exactly as arranged.
     */
    pinAllNodes: function() {
        if (!this.simulation) return;
        var nodes = this.simulation.nodes();
        if (!nodes || nodes.length === 0) return;

        nodes.forEach(function(n) {
            if (n.x != null && n.y != null) {
                n.fx = n.x;
                n.fy = n.y;
                Notes.graphLayout[n.id] = { x: n.x, y: n.y };
            }
        });

        try {
            localStorage.setItem('VINLAND_GRAPH_LAYOUT', JSON.stringify(Notes.graphLayout));
        } catch (e) {
            console.warn('[Graph] Failed to persist layout', e);
        }

        // Restart simulation so pinned nodes stop drifting
        this.simulation.alphaTarget(0).restart();

        console.log('[Graph] All nodes pinned');
        if (window.showNotification) {
            window.showNotification('GRAPH: All nodes pinned');
        }
    },

    /**
     * Reset layout entirely: clear all saved positions and unpin all nodes.
     * Force simulation will auto-layout from scratch on next render.
     */
    resetLayout: function() {
        // Re-render first (saveLayout at top of render saves the old layout,
        // then we clear it below to prevent saveLayout from undoing the reset)
        this.render();

        // NOW clear saved positions — after render's saveLayout has run
        Notes.graphLayout = {};
        try {
            localStorage.removeItem('VINLAND_GRAPH_LAYOUT');
        } catch (e) {
            console.warn('[Graph] Failed to clear layout', e);
        }

        // Unpin all current nodes so the fresh simulation is free
        if (this.simulation) {
            var nodes = this.simulation.nodes();
            if (nodes) {
                nodes.forEach(function(n) {
                    n.fx = null;
                    n.fy = null;
                });
                // Restart simulation with energy so nodes auto-arrange
                this.simulation.alphaTarget(0.3).restart();
            }
        }

        console.log('[Graph] Layout reset');
        if (window.showNotification) {
            window.showNotification('GRAPH: Layout reset');
        }
    },

    /**
     * Unpin all nodes AND clear saved positions so nodes stay free
     * across renders (mode toggles, reopen, etc.)
     */
    unpinAllNodes: function() {
        if (!this.simulation) return;
        var nodes = this.simulation.nodes();
        if (!nodes || nodes.length === 0) return;

        // Clear fx/fy on all current nodes
        nodes.forEach(function(n) {
            n.fx = null;
            n.fy = null;
        });

        // Also clear saved positions so they don't re-pin on next render
        Notes.graphLayout = {};
        try {
            localStorage.removeItem('VINLAND_GRAPH_LAYOUT');
        } catch (e) {
            console.warn('[Graph] Failed to clear layout', e);
        }

        // Restart the simulation so nodes re-arrange
        this.simulation.alphaTarget(0.3).restart();

        console.log('[Graph] All nodes unpinned (layout freed)');
        if (window.showNotification) {
            window.showNotification('GRAPH: Layout freed');
        }
    },

    init: function() {
        // Initial setup if needed
    },

    _onSearchChange: function() {
        var input = document.getElementById('graph-search');
        if (!input) return;
        this.filterQuery = input.value;
        // Debounce re-render to avoid lag on large graphs
        if (this._searchTimer) clearTimeout(this._searchTimer);
        var self = this;
        this._searchTimer = setTimeout(function() {
            self._pendingZoomFit = true;
            self.render();
        }, 150);
    },

    _clearSearchTimer: function() {
        if (this._searchTimer) {
            clearTimeout(this._searchTimer);
            this._searchTimer = null;
        }
    },

    _updateMatchCount: function(count) {
        var el = document.getElementById('graph-match-count');
        if (!el) {
            // Create match count element next to the search input
            var input = document.getElementById('graph-search');
            if (input && input.parentNode) {
                el = document.createElement('span');
                el.id = 'graph-match-count';
                el.style.cssText = 'font-size:0.65rem;color:var(--main-color);opacity:0.6;white-space:nowrap;';
                input.parentNode.insertBefore(el, input.nextSibling);
            }
        }
        if (el) {
            if (this.filterQuery.trim()) {
                el.textContent = count === 0 ? ' 0 matches' : ' ' + count + ' match' + (count !== 1 ? 'es' : '');
                el.style.display = '';
            } else {
                el.style.display = 'none';
            }
        }
    },

    open: function() {
        ModalManager.open('graph-modal');

        // Wire search input
        var self = this;
        var searchInput = document.getElementById('graph-search');
        if (searchInput) {
            searchInput.value = this.filterQuery;
            // Remove old listener to avoid duplicates
            if (this._searchHandler) {
                searchInput.removeEventListener('input', this._searchHandler);
            }
            this._searchHandler = function() { self._onSearchChange(); };
            searchInput.addEventListener('input', this._searchHandler);

            // Focus search on Cmd+F / Ctrl+F inside graph modal
            if (this._searchKeyHandler) {
                searchInput.removeEventListener('keydown', this._searchKeyHandler);
            }
            this._searchKeyHandler = function(e) {
                if (e.key === 'Escape') {
                    searchInput.blur();
                }
            };
            searchInput.addEventListener('keydown', this._searchKeyHandler);
        }
        
        // Ensure the button text matches the current state (in case PageActions changed it)
        var toggleBtn = document.getElementById('graph-mode-toggle');
        if (toggleBtn) {
            toggleBtn.textContent = this.isLocalMode ? 'LOCAL' : 'GLOBAL';
            toggleBtn.classList.toggle('active', this.isLocalMode);
            toggleBtn.onclick = function() { self.toggleLocalMode(); };
        }
        
        // Wire layout control buttons
        var pinBtn = document.getElementById('graph-pin-btn');
        if (pinBtn) {
            pinBtn.onclick = function() { self.pinAllNodes(); };
        }
        var unpinBtn = document.getElementById('graph-unpin-btn');
        if (unpinBtn) {
            unpinBtn.onclick = function() { self.unpinAllNodes(); };
        }
        var resetBtn = document.getElementById('graph-reset-btn');
        if (resetBtn) {
            resetBtn.onclick = function() { self.resetLayout(); };
        }

        // Wire folder filter dropdown change
        var folderSelect = document.getElementById('graph-folder-filter');
        if (folderSelect) {
            // Remove old listener to avoid duplicates
            if (this._folderFilterHandler) {
                folderSelect.removeEventListener('change', this._folderFilterHandler);
            }
            this._folderFilterHandler = function() {
                self.folderFilter = folderSelect.value;
                self._pendingZoomFit = true;
                self.render();
            };
            folderSelect.addEventListener('change', this._folderFilterHandler);
            folderSelect.value = this.folderFilter;
        }

        // Build folder options from current notes
        this._buildFolderOptions();

        // Wire close button to call close() for cleanup
        var closeBtn = document.getElementById('graph-modal-close');
        if (closeBtn) {
            closeBtn.onclick = function() {
                self.close();
                ModalManager.close('graph-modal');
            };
        }

        // Render after modal animation
        setTimeout(() => {
            this._pendingZoomFit = true;
            this.render();
        }, 300);
    },

    close: function() {
        this._clearSearchTimer();
        // Clean up search listeners
        var searchInput = document.getElementById('graph-search');
        if (searchInput) {
            if (this._searchHandler) {
                searchInput.removeEventListener('input', this._searchHandler);
                this._searchHandler = null;
            }
            if (this._searchKeyHandler) {
                searchInput.removeEventListener('keydown', this._searchKeyHandler);
                this._searchKeyHandler = null;
            }
        }
        // Clean up folder filter listener
        var folderSelect = document.getElementById('graph-folder-filter');
        if (folderSelect && this._folderFilterHandler) {
            folderSelect.removeEventListener('change', this._folderFilterHandler);
            this._folderFilterHandler = null;
        }
    },

    _escapeHtml: function(text) {
        if (!text) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    // ─── Zoom-To-Fit ───────────────────────────────────────────

    /**
     * Smoothly animate the camera to fit all given nodes within the viewport.
     * Uses D3 zoom transform with a transition (lerp animation).
     */
    _zoomToFit: function(nodes, duration) {
        if (!nodes || nodes.length === 0) return;
        if (!this.svgSelection || !this.zoomBehavior) return;

        duration = duration || 600;

        // Calculate bounding box of all visible nodes
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        var hasValid = false;
        nodes.forEach(function(n) {
            if (n.x == null || n.y == null || !isFinite(n.x) || !isFinite(n.y)) return;
            if (n.x < minX) minX = n.x;
            if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.y > maxY) maxY = n.y;
            hasValid = true;
        });

        if (!hasValid) return;

        var padding = 80;
        var boundsWidth = (maxX - minX) + padding * 2;
        var boundsHeight = (maxY - minY) + padding * 2;

        if (boundsWidth <= 0 || boundsHeight <= 0) return;

        var scale = Math.min(this.width / boundsWidth, this.height / boundsHeight, 2);
        var centerX = (minX + maxX) / 2;
        var centerY = (minY + maxY) / 2;

        var translateX = this.width / 2 - centerX * scale;
        var translateY = this.height / 2 - centerY * scale;

        // Animate via D3 transition (smooth lerp)
        this.svgSelection.transition().duration(duration).call(
            this.zoomBehavior.transform,
            d3.zoomIdentity.translate(translateX, translateY).scale(scale)
        );
    },

    /**
     * Public method: fit the graph view to show all visible nodes.
     * Called from a "fit view" button.
     */
    fitView: function() {
        if (!this.simulation) return;
        var nodes = this.simulation.nodes();
        this._zoomToFit(nodes, 750);
    },

    /**
     * Schedule a zoom-to-fit after the force simulation has had time
     * to arrange nodes (called after render completes).
     */
    _scheduleZoomFit: function(nodes, delay) {
        var self = this;
        if (this._zoomFitTimer) clearTimeout(this._zoomFitTimer);
        this._zoomFitTimer = setTimeout(function() {
            self._zoomToFit(nodes, 500);
            self._zoomFitTimer = null;
        }, delay || 350);
    },

    /**
     * BFS to find all nodes connected to the given node (full chain).
     */
    _getConnectedNodeIds: function(nodeId) {
        var connected = new Set();
        if (!this.adjacencyList) return connected;
        connected.add(nodeId);
        var queue = [nodeId];
        while (queue.length > 0) {
            var currentId = queue.shift();
            var neighbors = this.adjacencyList.get(currentId) || [];
            neighbors.forEach(function(neighborId) {
                if (!connected.has(neighborId)) {
                    connected.add(neighborId);
                    queue.push(neighborId);
                }
            });
        }
        return connected;
    },

    /**
     * On single-click: zoom camera to fit the clicked node's connected subgraph.
     */
    _zoomToFitConnected: function(event, d) {
        var connectedIds = this._getConnectedNodeIds(d.id);
        if (connectedIds.size <= 0) return;

        // Gather node objects (from simulation) that are in the connected set
        var connectedNodes = [];
        var allNodes = this.simulation ? this.simulation.nodes() : [];
        allNodes.forEach(function(n) {
            if (connectedIds.has(n.id)) connectedNodes.push(n);
        });

        if (connectedNodes.length > 0) {
            this._zoomToFit(connectedNodes, 500);
        }
    },

    // ─── Folder Scoping ──────────────────────────────────────────

    /** Build the folder filter dropdown options from active notes */
    _buildFolderOptions: function() {
        var select = document.getElementById('graph-folder-filter');
        if (!select) return;

        // Collect unique first-level folders from active (non-trashed) notes
        var folders = new Set();
        State.NOTES.forEach(function(n) {
            if (n.path && n.path.indexOf('/.trash') !== 0 && n.title && n.title !== 'Untitled') {
                var folder = n.path.split('/')[1] || 'root';
                folders.add(folder);
            }
        });

        var sorted = Array.from(folders).sort();
        var currentValue = select.value;

        // Only rebuild if the options changed (avoid losing selection)
        var html = '<option value="">ALL FOLDERS</option>';
        sorted.forEach(function(f) {
            html += '<option value="' + f + '">' + f.toUpperCase() + '</option>';
        });
        select.innerHTML = html;
        select.value = currentValue || '';
    },

    // ─── Tooltip ────────────────────────────────────────────────

    /** Get preview text from a note (strip HTML, truncate) */
    _getNotePreview: function(noteId) {
        var note = State.NOTES.find(function(n) { return n.id === noteId; });
        if (!note) return '';
        var text = note.content || '';
        // Strip HTML tags
        text = text.replace(/<[^>]*>/g, '');
        // Truncate to ~150 chars at word boundary
        if (text.length > 150) {
            text = text.substring(0, 147).replace(/\s+\S*$/, '') + '...';
        }
        return text.trim();
    },

    _showTooltip: function(event, d) {
        var tooltip = document.getElementById('graph-tooltip');
        if (!tooltip) return;

        // Connection count
        var connectedIds = this._getConnectedNodeIds(d.id);
        var connCount = connectedIds.size - 1; // exclude self

        // Preview text
        var preview = (d.type === 'note') ? this._getNotePreview(d.id) : '';

        tooltip.innerHTML =
            '<div class="tt-title">' + this._escapeHtml(d.name || 'Untitled') + '</div>' +
            '<div>' +
                '<span class="tt-badge">' + this._escapeHtml(d.type || 'note') + '</span>' +
                '<span class="tt-meta">' + connCount + ' connection' + (connCount !== 1 ? 's' : '') + '</span>' +
            '</div>' +
            (preview ? '<div class="tt-preview">' + this._escapeHtml(preview) + '</div>' : '');

        tooltip.style.display = 'block';
        this._positionTooltip(event);
    },

    _positionTooltip: function(event) {
        var tooltip = document.getElementById('graph-tooltip');
        var container = document.getElementById(this.containerId);
        if (!tooltip || !container) return;

        var rect = container.getBoundingClientRect();
        var offsetX = event.clientX - rect.left;
        var offsetY = event.clientY - rect.top;

        // Default: right of cursor
        var left = offsetX + 16;
        var top = offsetY - 10;

        // Flip to left if too close to right edge
        var tooltipW = tooltip.offsetWidth || 240;
        if (left + tooltipW + 10 > rect.width) {
            left = offsetX - tooltipW - 16;
        }
        // Clamp top to prevent going off-screen
        var tooltipH = tooltip.offsetHeight || 100;
        if (top + tooltipH + 10 > rect.height) {
            top = rect.height - tooltipH - 10;
        }
        if (top < 5) top = 5;
        if (left < 5) left = 5;

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    },

    _hideTooltip: function() {
        var tooltip = document.getElementById('graph-tooltip');
        if (tooltip) {
            tooltip.style.display = 'none';
        }
    },

    // Toggle between Global and Local (1-degree neighbor) view
    toggleLocalMode: function() {
        this.isLocalMode = !this.isLocalMode;
        var btn = document.getElementById('graph-mode-toggle');
        if (btn) {
            btn.textContent = this.isLocalMode ? 'LOCAL' : 'GLOBAL';
            btn.classList.toggle('active', this.isLocalMode);
        }
        this._pendingZoomFit = true;
        this.render();
    },

    // Helper - calculate node radius from degree
    getNodeRadius: function(node) {
        var base = node.type === 'board' ? 8 : 5;
        return base + (Math.sqrt(node.degree || 0) * 3);
    },

    render: function() {
        console.log('[Graph] Render called');
        console.log('[Graph] Render called');
        var container = document.getElementById(this.containerId);
        if (!container) return;
        
        // .38: Save the current layout before clearing the container
        this.saveLayout();
        
        if (typeof d3 === 'undefined') {
            console.error('[Graph] D3 is undefined!');
            container.innerHTML = '<div style="color:red; padding:20px;">Error: D3 Library not loaded.<br>Please check internet connection or index.html</div>';
            return;
        }

        container.innerHTML = '';
        // Fallback dimensions if container is not layouted yet
        this.width = container.clientWidth || 1200;
        this.height = container.clientHeight || 800;
        console.log('[Graph] Dimensions:', this.width, 'x', this.height);

        // 1. Prepare Data
        // 🚨 FIX: Strip out trashed notes before rendering (evaluating path, not boolean)
        var activeNotes = State.NOTES.filter(n => !(n.path && n.path.indexOf('/.trash') === 0));
        var validNotes = activeNotes.filter(n => n.title && n.title !== 'Untitled');

        // Apply folder filter if set
        if (this.folderFilter) {
            validNotes = validNotes.filter(n => {
                var folder = (n.path || '/').split('/')[1] || 'root';
                return folder === this.folderFilter;
            });
        }
        
        // Map Notes to Nodes
        var allNodes = validNotes.map(n => ({
            id: n.id,
            name: n.title,
            type: 'note',
            group: n.path.split('/')[1] || 'root',
            val: 1
        }));

        // Add Boards if available
        if (typeof window.BOARDS !== 'undefined' && Array.isArray(window.BOARDS)) {
            window.BOARDS.forEach(b => {
                 allNodes.push({ id: b.id, name: b.title, type: 'board', group: 'BOARD', val: 2 });
            });
        }

        // Generate all links
        var allLinks = [];
        var wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

        validNotes.forEach(source => {
            var textToSearch = '';
            if (source.blocks && Array.isArray(source.blocks)) {
                textToSearch = source.blocks.map(b => (b.content || '').toLowerCase()).join('\n');
            } else {
                textToSearch = (source.content || '').toLowerCase();
            }

            var match;
            wikiLinkRegex.lastIndex = 0; 
            while ((match = wikiLinkRegex.exec(textToSearch)) !== null) {
                var targetTitle = match[1].trim(); 
                var target = validNotes.find(n => n.title && n.title.trim().toLowerCase() === targetTitle);
                
                if (target && target.id !== source.id) {
                    var sourceExists = allNodes.some(n => n.id === source.id);
                    var targetExists = allNodes.some(n => n.id === target.id);
                    
                    if (sourceExists && targetExists) {
                        var exists = allLinks.some(l => (l.source === source.id && l.target === target.id));
                        if (!exists) allLinks.push({ source: source.id, target: target.id });
                    }
                }
            }
            
            // Note-to-Board links
            if (source.blocks) {
                source.blocks.forEach(block => {
                    if (block.type === 'kanban_ref' && block.boardId) {
                        if (allNodes.some(n => n.id === block.boardId)) {
                             allLinks.push({ source: source.id, target: block.boardId });
                        }
                    }
                });
            }
        });

        // ─── V87: DEGREE CENTRALITY ─────────────────────────────
        var degrees = new Map();
        allNodes.forEach(n => degrees.set(n.id, 0));
        allLinks.forEach(l => {
            var s = l.source.id || l.source;
            var t = l.target.id || l.target;
            degrees.set(s, (degrees.get(s) || 0) + 1);
            degrees.set(t, (degrees.get(t) || 0) + 1);
        });
        allNodes.forEach(n => {
            n.degree = degrees.get(n.id) || 0;
        });

        // ─── V87: LOCAL FOCUS MODE ──────────────────────────────
        var nodes, links;
        if (this.isLocalMode && Notes && Notes.activeNoteId) {
            var focusId = Notes.activeNoteId;
            // 1-degree neighbors
            var neighborIds = new Set([focusId]);
            allLinks.forEach(l => {
                var s = l.source.id || l.source;
                var t = l.target.id || l.target;
                if (s === focusId) neighborIds.add(t);
                if (t === focusId) neighborIds.add(s);
            });
            nodes = allNodes.filter(n => neighborIds.has(n.id));
            links = allLinks.filter(l => {
                var s = l.source.id || l.source;
                var t = l.target.id || l.target;
                return neighborIds.has(s) && neighborIds.has(t);
            });
        } else {
            nodes = allNodes;
            links = allLinks;
        }

        // ─── SEARCH/FILTER ────────────────────────────────────────
        if (this.filterQuery.trim()) {
            var q = this.filterQuery.toLowerCase().trim();
            var filteredNodeIds = new Set();
            var filteredNodes = nodes.filter(function(n) {
                var match = n.name && n.name.toLowerCase().includes(q);
                if (match) filteredNodeIds.add(n.id);
                return match;
            });
            nodes = filteredNodes;
            links = links.filter(function(l) {
                var s = l.source.id || l.source;
                var t = l.target.id || l.target;
                return filteredNodeIds.has(s) && filteredNodeIds.has(t);
            });
        }

        // Show match count
        this._updateMatchCount(nodes.length);

        // ─── EMPTY STATE ──────────────────────────────────────────
        if (nodes.length === 0) {
            var container = document.getElementById(this.containerId);
            if (container) {
                container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--secondary-color,#555);font-size:0.85rem;font-family:var(--font-mono,monospace);opacity:0.6;">' +
                    (this.filterQuery.trim()
                        ? 'No nodes match &quot;' + this._escapeHtml(this.filterQuery) + '&quot;'
                        : 'No notes to display') +
                    '</div>';
            }
            if (this.simulation) {
                this.simulation.stop();
                this.simulation = null;
            }
            this.svg = null;
            return;
        }

        console.log('[Graph] Nodes:', nodes.length, '| Links:', links.length, '| Mode:', this.isLocalMode ? 'LOCAL' : 'GLOBAL', '| Filter:', this.filterQuery || '(none)');

        // ─── V19.38: APPLY SAVED POSITIONS ──────────────────────
        // Pin nodes that have a saved position (fx/fy) so the force
        // simulation does NOT re-arrange them on every open. Without the
        // pin, saved x/y are only used as an initial seed and the charge/
        // center/link forces immediately move nodes, so the layout "resets"
        // each open. Pinned nodes stay exactly where the user left them.
        if (Notes.graphLayout && Object.keys(Notes.graphLayout).length > 0) {
            nodes.forEach(function(n) {
                var saved = Notes.graphLayout[n.id];
                if (saved && saved.x != null && saved.y != null) {
                    n.x = saved.x;
                    n.y = saved.y;
                    n.fx = saved.x;
                    n.fy = saved.y;
                }
            });
        }

        // ─── V87: CLUSTER COLORING ──────────────────────────────
        var groups = [...new Set(nodes.map(n => n.group))].filter(g => g !== 'BOARD').sort();
        var graphColors = [
            'var(--graph-col-1)',
            'var(--graph-col-2)',
            'var(--graph-col-3)',
            'var(--graph-col-4)',
            'var(--graph-col-5)'
        ];
        var getColor = function(group) {
            if (group === 'BOARD') return 'var(--board-color, #00d4ff)';
            var idx = groups.indexOf(group) % 5;
            return graphColors[idx >= 0 ? idx : 0];
        };

        // ─── V87: DYNAMIC LEGEND ────────────────────────────────
        var legend = document.getElementById('graph-legend');
        if (legend) {
            var legendHtml = '';
            groups.forEach(function(g, i) {
                var displayName = g.toUpperCase();
                var colorIdx = i % 5;
                legendHtml += '<div style="display:flex; align-items:center; gap:5px;">' +
                    '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:' + graphColors[colorIdx] + '"></span>' +
                    displayName + '</div>';
            });
            // Always add BOARD if any boards exist
            if (nodes.some(n => n.type === 'board')) {
                legendHtml += '<div style="display:flex; align-items:center; gap:5px;">' +
                    '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--board-color, #00d4ff)"></span>' +
                    'BOARD</div>';
            }
            legend.innerHTML = legendHtml;
        }

        // ─── D3 SIMULATION ──────────────────────────────────────
        var self = this;

        // Store the filtered IDs for CSS class toggling
        this._filteredNodeIds = null;
        if (this.filterQuery.trim()) {
            this._filteredNodeIds = new Set(nodes.map(function(n) { return n.id; }));
        }

        // Store zoom behavior for zoom-to-fit animation
        var zoomBehavior = d3.zoom().on("zoom", function (event) {
            g.attr("transform", event.transform);
        });
        this.zoomBehavior = zoomBehavior;

        var svgSelection = d3.select('#' + this.containerId).append("svg")
            .attr("width", '100%')
            .attr("height", '100%')
            .attr('viewBox', [0, 0, this.width, this.height]);

        svgSelection.call(zoomBehavior);
        this.svgSelection = svgSelection;

        var g = svgSelection.append("g");
        this.svg = g;

        this.simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(links).id(d => d.id).distance(100))
            .force("charge", d3.forceManyBody().strength(-300)) // Stronger repulsion for larger nodes
            .force("center", d3.forceCenter(this.width / 2, this.height / 2))
            .force('collision', d3.forceCollide().radius(function(d) {
                return self.getNodeRadius(d) + 5; // Dynamic collision + padding
            }));

        var link = g.append("g")
            .attr("class", "links")
            .selectAll("line")
            .data(links)
            .join("line")
            .attr("stroke", "var(--secondary-color, #555)")
            .attr("stroke-width", "2px")
            .attr("stroke-opacity", 0.6);

        var node = g.append("g")
            .attr("class", "nodes")
            .selectAll("g")
            .data(nodes)
            .join("g")
            .classed('graph-node-active', function(d) {
                return Notes && d.id === Notes.activeNoteId;
            })
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));

        // Dynamic radius + cluster color
        node.append("circle")
            .attr("r", function(d) { return self.getNodeRadius(d); })
            .attr("fill", function(d) { return getColor(d.group); })
            .attr("class", function(d) { return (Notes && d.id === Notes.activeNoteId) ? 'active' : ''; })
            .attr("stroke", "#000")
            .attr("stroke-width", "1.5px");

        // Scale text size slightly for high-degree nodes
        node.append("text")
            .text(d => d.name)
            .attr('x', function(d) { return self.getNodeRadius(d) + 6; })
            .attr('y', 4)
            .style("font-size", function(d) {
                return (d.degree > 3) ? "12px" : "10px";
            })
            .style("fill", "#ccc")
            .style("pointer-events", "none");
            
        // 3. Build Adjacency List for fast traversal
        this.adjacencyList = new Map();
        nodes.forEach(n => this.adjacencyList.set(n.id, []));
        links.forEach(l => {
            const s = l.source.id || l.source;
            const t = l.target.id || l.target;
            
            if (this.adjacencyList.has(s)) this.adjacencyList.get(s).push(t);
            if (this.adjacencyList.has(t)) this.adjacencyList.get(t).push(s);
        });

        // When filter is active, dim all nodes slightly and brighten on hover
        if (this._filteredNodeIds) {
            node.attr('opacity', 0.6);
            node.on('mouseenter.filter', function() {
                d3.select(this).attr('opacity', 1);
            }).on('mouseleave.filter', function() {
                d3.select(this).attr('opacity', 0.6);
            });
        }

        // ─── Tooltip: show on mouseover, position on mousemove, hide on mouseout ───
        node.on('mouseover', function(event, d) {
            self._showTooltip(event, d);

            var connectedNodeIds = self._getConnectedNodeIds(d.id);

            // Highlight Nodes (Full Chain)
            node.classed('highlighted', n => connectedNodeIds.has(n.id));
            node.select('circle').classed('highlighted', n => connectedNodeIds.has(n.id));
            node.select('text').classed('highlighted', n => connectedNodeIds.has(n.id));

            // Highlight Links (Between any highlighted nodes)
            link.classed('highlighted', l => {
                const s = l.source.id || l.source;
                const t = l.target.id || l.target;
                return connectedNodeIds.has(s) && connectedNodeIds.has(t);
            });
            
            // Dim the Rest
            node.classed('dimmed', n => !connectedNodeIds.has(n.id));
            link.classed('dimmed', l => {
                const s = l.source.id || l.source;
                const t = l.target.id || l.target;
                return !(connectedNodeIds.has(s) && connectedNodeIds.has(t));
            });

        }).on('mousemove', function(event, d) {
            self._positionTooltip(event);

        }).on('mouseout', function () {
            self._hideTooltip();

            // Reset All
            node.classed('highlighted', false).classed('dimmed', false);
            node.select('circle').classed('highlighted', false);
            node.select('text').classed('highlighted', false);
            link.classed('highlighted', false).classed('dimmed', false);
        }).on('click', function(event, d) {
            // Click: zoom-to-fit connected subgraph; dblclick: open note
            // Use a timer to distinguish single-click from double-click
            if (self._clickTimer) {
                clearTimeout(self._clickTimer);
                self._clickTimer = null;
                return; // Let dblclick handler fire
            }
            self._clickTimer = setTimeout(function() {
                self._clickTimer = null;
                self._zoomToFitConnected(event, d);
            }, 250);
        }).on('dblclick', function(event, d) {
            // Double-click: navigate to note/board (existing behavior)
            if (self._clickTimer) {
                clearTimeout(self._clickTimer);
                self._clickTimer = null;
            }
            self.saveLayout();
            if (d.type === 'board') {
                 if (window.KanbanManager) {
                     window.KanbanManager.open(d.id);
                     ModalManager.closeTop(); 
                 }
            } else {
                if (window.Notes) {
                    window.Notes.open(d.id);
                    ModalManager.closeTop(); 
                }
            }
        });

        this.simulation.on("tick", () => {
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);

            node
                .attr("transform", d => `translate(${d.x},${d.y})`);
        });

        function dragstarted(event) {
            if (!event.active) self.simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }

        function dragged(event) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }

        function dragended(event) {
            if (!event.active) self.simulation.alphaTarget(0);
            // .38: Keep the node pinned at its dropped position (fx/fy) so
            // the layout persists instead of drifting once forces cool down.
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
            // .38: Save dragged node's position
            if (event.subject && event.subject.x != null && event.subject.y != null) {
                Notes.graphLayout[event.subject.id] = { x: event.subject.x, y: event.subject.y };
                self.saveLayout();
            }
        }

        // ─── Zoom-To-Fit after layout settles ─────────────────
        if (this._pendingZoomFit && nodes.length > 0) {
            this._scheduleZoomFit(nodes, 350);
            this._pendingZoomFit = false;
        }
    }
};
