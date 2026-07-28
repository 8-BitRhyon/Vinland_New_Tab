export const CanvasManager = {
    container: null,
    board: null,
    svgLayer: null,
    toolbar: null,
    hintOverlay: null,
    zoomLabel: null,
    transform: { x: 0, y: 0, scale: 1 },
    isPanning: false,
    dragStart: { x: 0, y: 0 },
    activeNoteId: null,
    draggedNodeId: null,
    isDrawingEdge: false,
    edgeStartNodeId: null,
    tempEdge: null,
    selectedNodeIds: new Set(),
    selectedNodeId: null,
    isSelectingMarquee: false,
    marqueeStart: { x: 0, y: 0 },
    marqueeEl: null,
    historyStack: [],
    redoStack: [],
    clipboard: null,
    lastMouseCoords: null,
    _backlinksPanel: null,
    _backlinksFileNodeId: null,

    // ─── HELPERS ───
    _getActiveNote: function() {
        return window.State.NOTES.find(function(n) { return n.id === this.activeNoteId; }.bind(this));
    },
    _saveData: function() {
        if (window.saveData) window.saveData();
    },
    _getWorldCenter: function() {
        const rect = this.container.getBoundingClientRect();
        return {
            x: (rect.width / 2 - this.transform.x) / this.transform.scale,
            y: (rect.height / 2 - this.transform.y) / this.transform.scale
        };
    },

    // === SELECTION HELPERS ===
    selectNode: function(nodeId, isMultiSelect) {
        if (!isMultiSelect) {
            this.clearSelection();
        }
        this.selectedNodeIds.add(nodeId);
        this.selectedNodeId = nodeId;
        const card = document.getElementById(`canvas-node-${nodeId}`);
        if (card) {
            card.classList.add('selected-node');
        }
        // Show backlinks panel for file nodes
        this._updateBacklinks();
    },

    deselectNode: function(nodeId) {
        this.selectedNodeIds.delete(nodeId);
        if (this.selectedNodeId === nodeId) {
            this.selectedNodeId = this.selectedNodeIds.size > 0 ? Array.from(this.selectedNodeIds)[0] : null;
        }
        const card = document.getElementById(`canvas-node-${nodeId}`);
        if (card) {
            card.classList.remove('selected-node');
        }
    },

    clearSelection: function() {
        this.selectedNodeIds.clear();
        this.selectedNodeId = null;
        document.querySelectorAll('.canvas-card.selected-node, .canvas-group.selected-node').forEach(el => {
            el.classList.remove('selected-node');
        });
        this._closeBacklinks();
    },

    // ─── CLIPBOARD & BULK OPERATIONS ───
    deleteSelectedNodes: function() {
        const note = this._getActiveNote();
        if (!note || !note.canvasData) return;

        if (this._saveHistoryState) this._saveHistoryState();

        const idsToDelete = new Set(this.selectedNodeIds);
        if (idsToDelete.size === 0) return;
        
        // Remove nodes from data model
        note.canvasData.nodes = note.canvasData.nodes.filter(n => !idsToDelete.has(n.id));

        // Remove edges connected to these nodes
        if (note.canvasData.edges) {
            note.canvasData.edges = note.canvasData.edges.filter(edge => !idsToDelete.has(edge.fromNode) && !idsToDelete.has(edge.toNode));
        }

        // Remove from DOM
        idsToDelete.forEach(id => {
            const el = document.getElementById(`canvas-node-${id}`);
            if (el) el.remove();
        });

        this.clearSelection();
        this._refreshEdges();
        this._saveData();
        this.updateUI();
        // Update backlinks badges
        var self = this;
        if (note && note.canvasData && note.canvasData.nodes) {
            note.canvasData.nodes.forEach(function(n) {
                if (n.type === 'file') {
                    self._updateBacklinksBadge(n.id);
                }
            });
        }
    },

    copySelectedNodes: function() {
        const note = this._getActiveNote();
        if (!note || !note.canvasData || this.selectedNodeIds.size === 0) return;

        const clonedNodes = [];
        const selectedIds = new Set(this.selectedNodeIds);

        note.canvasData.nodes.forEach(n => {
            if (selectedIds.has(n.id)) {
                clonedNodes.push(JSON.parse(JSON.stringify(n)));
            }
        });

        const clonedEdges = [];
        if (note.canvasData.edges) {
            note.canvasData.edges.forEach(e => {
                if (selectedIds.has(e.fromNode) && selectedIds.has(e.toNode)) {
                    clonedEdges.push(JSON.parse(JSON.stringify(e)));
                }
            });
        }

        this.clipboard = { nodes: clonedNodes, edges: clonedEdges };
        console.log('[CanvasManager] Copied nodes:', clonedNodes.length, '| edges:', clonedEdges.length);
    },

    pasteCopiedNodes: function() {
        if (!this.clipboard || !this.clipboard.nodes || this.clipboard.nodes.length === 0) return;
        const note = this._getActiveNote();
        if (!note || !note.canvasData) return;

        if (this._saveHistoryState) this._saveHistoryState();

        // Calculate center of clipboard nodes bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.clipboard.nodes.forEach(n => {
            const w = n.width || 200;
            const h = n.height || 80;
            if (n.x < minX) minX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.x + w > maxX) maxX = n.x + w;
            if (n.y + h > maxY) maxY = n.y + h;
        });

        const clipCenterX = minX + (maxX - minX) / 2;
        const clipCenterY = minY + (maxY - minY) / 2;

        // Get world coords of cursor
        const cursorWorld = this.getMouseWorldCoords();
        const dx = cursorWorld.x - clipCenterX;
        const dy = cursorWorld.y - clipCenterY;

        // Map old IDs to new ones
        const idMap = {};
        const newNodes = [];

        this.clipboard.nodes.forEach(n => {
            const oldId = n.id;
            const newId = 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            idMap[oldId] = newId;

            const cloned = JSON.parse(JSON.stringify(n));
            cloned.id = newId;
            cloned.x += dx;
            cloned.y += dy;

            // If it's a file node, link it properly
            if (cloned.type === 'file') {
                cloned.title = cloned.title || 'Untitled';
            }

            newNodes.push(cloned);
            if (!note.canvasData.nodes) note.canvasData.nodes = [];
            note.canvasData.nodes.push(cloned);
            this.addCard(cloned);
        });

        if (this.clipboard.edges) {
            this.clipboard.edges.forEach(e => {
                const newEdgeId = 'edge_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                const clonedEdge = JSON.parse(JSON.stringify(e));
                clonedEdge.id = newEdgeId;
                clonedEdge.fromNode = idMap[e.fromNode];
                clonedEdge.toNode = idMap[e.toNode];

                if (!note.canvasData.edges) note.canvasData.edges = [];
                note.canvasData.edges.push(clonedEdge);
            });
        }

        // Select the newly pasted nodes
        this.clearSelection();
        newNodes.forEach(n => {
            this.selectNode(n.id, true);
        });

        this._refreshEdges();
        this._saveData();
        this.updateUI();
        console.log('[CanvasManager] Pasted nodes:', newNodes.length);
    },

    duplicateSelectedNodes: function() {
        const note = this._getActiveNote();
        if (!note || !note.canvasData || this.selectedNodeIds.size === 0) return;

        if (this._saveHistoryState) this._saveHistoryState();

        const selectedIds = new Set(this.selectedNodeIds);
        const idMap = {};
        const newNodes = [];

        // Clone nodes and shift by offset
        note.canvasData.nodes.forEach(n => {
            if (selectedIds.has(n.id)) {
                const oldId = n.id;
                const newId = 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                idMap[oldId] = newId;

                const cloned = JSON.parse(JSON.stringify(n));
                cloned.id = newId;
                cloned.x += 24;
                cloned.y += 24;

                newNodes.push(cloned);
            }
        });

        // Add duplicated nodes to note and render
        newNodes.forEach(cloned => {
            note.canvasData.nodes.push(cloned);
            this.addCard(cloned);
        });

        // Duplicate internal connections
        if (note.canvasData.edges) {
            const newEdges = [];
            note.canvasData.edges.forEach(e => {
                if (selectedIds.has(e.fromNode) && selectedIds.has(e.toNode)) {
                    const newEdgeId = 'edge_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                    const clonedEdge = JSON.parse(JSON.stringify(e));
                    clonedEdge.id = newEdgeId;
                    clonedEdge.fromNode = idMap[e.fromNode];
                    clonedEdge.toNode = idMap[e.toNode];
                    newEdges.push(clonedEdge);
                }
            });
            newEdges.forEach(e => note.canvasData.edges.push(e));
        }

        // Focus selection on the new duplicated nodes
        this.clearSelection();
        newNodes.forEach(n => {
            this.selectNode(n.id, true);
        });

        this._refreshEdges();
        this._saveData();
        this.updateUI();
        console.log('[CanvasManager] Duplicated nodes:', newNodes.length);
    },

    // ─── UTILITY HELPERS ───
    getMouseWorldCoords: function() {
        if (!this.lastMouseCoords || !this.container) return { x: 0, y: 0 };
        const rect = this.container.getBoundingClientRect();
        const wx = (this.lastMouseCoords.x - rect.left - this.transform.x) / this.transform.scale;
        const wy = (this.lastMouseCoords.y - rect.top - this.transform.y) / this.transform.scale;
        return { x: wx, y: wy };
    },

    _saveHistoryState: function() {
        const note = this._getActiveNote();
        if (!note || !note.canvasData) return;

        const stateCopy = JSON.parse(JSON.stringify(note.canvasData));
        this.historyStack.push(stateCopy);
        if (this.historyStack.length > 50) {
            this.historyStack.shift();
        }
        this.redoStack = [];
        console.log('[CanvasManager] History saved. Size:', this.historyStack.length);
    },

    undo: function() {
        if (this.historyStack.length === 0) return;
        const note = this._getActiveNote();
        if (!note || !note.canvasData) return;

        const currentState = JSON.parse(JSON.stringify(note.canvasData));
        this.redoStack.push(currentState);

        const previousState = this.historyStack.pop();
        note.canvasData = previousState;

        this.load(this.activeNoteId);
        this._saveData();
        console.log('[CanvasManager] Undo complete.');
    },

    redo: function() {
        if (this.redoStack.length === 0) return;
        const note = this._getActiveNote();
        if (!note || !note.canvasData) return;

        const currentState = JSON.parse(JSON.stringify(note.canvasData));
        this.historyStack.push(currentState);

        const nextState = this.redoStack.pop();
        note.canvasData = nextState;

        this.load(this.activeNoteId);
        this._saveData();
        console.log('[CanvasManager] Redo complete.');
    },

    init: function() {
        this.container = document.getElementById('canvas-container');
        console.log('[CanvasManager] init() - container found:', !!this.container);
        if (!this.container) return;
        this.container.innerHTML = '';

        // === DOT GRID BACKGROUND ===
        this.container.style.background = 'radial-gradient(circle, rgba(var(--main-color-rgb, 0,255,65), 0.15) 1px, transparent 1px)';
        this.container.style.backgroundSize = '30px 30px';

        // === INFINITE BOARD ===
        this.board = document.createElement('div');
        this.board.className = 'canvas-board';
        this.board.style.cssText = 'position:absolute; width:10000px; height:10000px; transform-origin:0 0;';

        // === SVG EDGE LAYER ===
        this.svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svgLayer.id = 'canvas-svg-layer';
        this.svgLayer.setAttribute('viewBox', '-5000 -5000 20000 20000');
        this.svgLayer.style.cssText = 'position:absolute; top:-5000px; left:-5000px; width:20000px; height:20000px; pointer-events:none; overflow:visible;';

        // Arrowhead marker definitions
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = `
            <marker id="canvas-arrowhead" viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="8" markerHeight="8" orient="auto-start-reverse"
                    fill="var(--main-color, #00ff41)">
                <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
            <marker id="canvas-arrowhead-dim" viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="8" markerHeight="8" orient="auto-start-reverse"
                    fill="#555">
                <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
        `;
        this.svgLayer.appendChild(defs);

        this.board.appendChild(this.svgLayer);
        this.container.appendChild(this.board);

        // === FLOATING TOOLBAR ===
        this.toolbar = document.createElement('div');
        this.toolbar.className = 'canvas-toolbar';
        this.toolbar.innerHTML = `
            <button class="canvas-tb-btn" id="canvas-add-node" title="Add Text Node">+ NODE</button>
            <button class="canvas-tb-btn" id="canvas-add-file" title="Embed Existing Note">+ FILE</button>
            <button class="canvas-tb-btn" id="canvas-add-url" title="Embed URL/Video">+ URL</button>
            <button class="canvas-tb-btn" id="canvas-add-group" title="Create Spatial Group">+ GROUP</button>
            <span class="canvas-tb-divider">|</span>
            <button class="canvas-tb-btn" id="canvas-reset-view" title="Reset View">⌂ RESET</button>
            <span class="canvas-tb-divider">|</span>
            <span class="canvas-tb-info" id="canvas-node-count">0 nodes</span>
            <span class="canvas-tb-divider">|</span>
            <span class="canvas-tb-info" id="canvas-zoom-label">100%</span>
            <span class="canvas-tb-divider">|</span>
            <button class="canvas-tb-btn" id="canvas-shortcuts-btn" title="Keyboard Shortcuts (Shift+?)">?</button>
        `;
        this.container.appendChild(this.toolbar);

        // === EMPTY STATE HINT ===
        this.hintOverlay = document.createElement('div');
        this.hintOverlay.className = 'canvas-hint-overlay';
        this.hintOverlay.innerHTML = `
            <div class="canvas-hint-icon">⬡</div>
            <div class="canvas-hint-title">CANVAS // EMPTY</div>
            <div class="canvas-hint-subtitle">Double-click anywhere to create a node</div>
            <div class="canvas-hint-keys">
                <span><kbd>DBLCLICK</kbd> Add Node</span>
                <span><kbd>DRAG</kbd> Move Node</span>
                <span><kbd>⇧ SHIFT+DRAG</kbd> Connect Nodes</span>
                <span><kbd>⌘/CTRL+SCROLL</kbd> Zoom</span>
            </div>
        `;
        this.container.appendChild(this.hintOverlay);

        // Inject shortcuts panel styles
        if (!document.getElementById('canvas-shortcuts-styles')) {
            var scStyle = document.createElement('style');
            scStyle.id = 'canvas-shortcuts-styles';
            scStyle.textContent = `
                .canvas-shortcuts-panel {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    z-index: 40000;
                    background: rgba(0, 0, 0, 0.95);
                    border: 1px solid var(--main-color, #00ff41);
                    border-radius: 8px;
                    padding: 0;
                    min-width: 380px;
                    max-width: 480px;
                    max-height: 80vh;
                    overflow-y: auto;
                    box-shadow: 0 0 40px rgba(0, 255, 65, 0.2), 0 4px 20px rgba(0, 0, 0, 0.6);
                    font-family: inherit;
                    font-size: 0.8rem;
                    animation: shortcutFadeIn 0.2s ease;
                }
                @keyframes shortcutFadeIn {
                    from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); }
                    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                }
                .canvas-shortcuts-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 14px 16px 10px 16px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                }
                .canvas-shortcuts-title {
                    color: var(--main-color, #00ff41);
                    font-weight: bold;
                    font-size: 0.75rem;
                    letter-spacing: 2px;
                    text-transform: uppercase;
                }
                .canvas-shortcuts-close {
                    color: #666;
                    cursor: pointer;
                    font-size: 1.2rem;
                    line-height: 1;
                    transition: color 0.15s ease;
                    background: none;
                    border: none;
                    padding: 0 2px;
                }
                .canvas-shortcuts-close:hover {
                    color: #ff3333;
                }
                .canvas-shortcuts-section {
                    padding: 8px 0;
                }
                .canvas-shortcuts-section-title {
                    color: rgba(255, 255, 255, 0.35);
                    font-size: 0.6rem;
                    letter-spacing: 1.5px;
                    text-transform: uppercase;
                    padding: 6px 16px 4px 16px;
                }
                .canvas-shortcuts-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 5px 16px;
                    transition: background 0.1s ease;
                }
                .canvas-shortcuts-item:hover {
                    background: rgba(0, 255, 65, 0.06);
                }
                .canvas-shortcuts-key {
                    display: inline-flex;
                    align-items: center;
                    gap: 3px;
                }
                .canvas-shortcuts-key kbd {
                    display: inline-block;
                    padding: 2px 6px;
                    font-size: 0.65rem;
                    font-family: inherit;
                    background: rgba(255, 255, 255, 0.08);
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    border-radius: 3px;
                    color: #ddd;
                    line-height: 1.4;
                    min-width: 20px;
                    text-align: center;
                }
                .canvas-shortcuts-key kbd.mod {
                    color: var(--main-color, #00ff41);
                    border-color: rgba(0, 255, 65, 0.3);
                    background: rgba(0, 255, 65, 0.08);
                }
                .canvas-shortcuts-label {
                    color: #aaa;
                    font-size: 0.72rem;
                }
                .canvas-shortcuts-footer {
                    padding: 10px 16px 12px 16px;
                    border-top: 1px solid rgba(255, 255, 255, 0.06);
                    color: #555;
                    font-size: 0.6rem;
                    text-align: center;
                }
                .canvas-shortcuts-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 39999;
                    background: rgba(0, 0, 0, 0.5);
                    animation: overlayFadeIn 0.15s ease;
                }
                @keyframes overlayFadeIn {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                }
                .canvas-shortcuts-panel::-webkit-scrollbar {
                    width: 4px;
                }
                .canvas-shortcuts-panel::-webkit-scrollbar-track {
                    background: transparent;
                }
                .canvas-shortcuts-panel::-webkit-scrollbar-thumb {
                    background: var(--main-color, #00ff41);
                    border-radius: 2px;
                }
            `;
            document.head.appendChild(scStyle);
        }

        // Inject backlinks panel styles
        if (!document.getElementById('canvas-backlinks-styles')) {
            var blStyle = document.createElement('style');
            blStyle.id = 'canvas-backlinks-styles';
            blStyle.textContent = `
                .canvas-backlinks-panel {
                    position: fixed;
                    z-index: 35000;
                    background: rgba(0, 0, 0, 0.92);
                    border: 1px solid var(--main-color, #00ff41);
                    border-radius: 6px;
                    padding: 0;
                    min-width: 220px;
                    max-width: 320px;
                    max-height: 400px;
                    overflow-y: auto;
                    box-shadow: 0 4px 20px rgba(0, 255, 65, 0.25);
                    font-family: inherit;
                    font-size: 0.8rem;
                }
                .canvas-backlinks-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 10px 12px 6px 12px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                }
                .canvas-backlinks-title {
                    color: var(--main-color, #00ff41);
                    font-weight: bold;
                    font-size: 0.7rem;
                    letter-spacing: 1px;
                }
                .canvas-backlinks-close {
                    color: #888;
                    cursor: pointer;
                    font-size: 1.1rem;
                    line-height: 1;
                    transition: color 0.15s ease;
                }
                .canvas-backlinks-close:hover {
                    color: #ff3333;
                }
                .canvas-backlinks-count {
                    padding: 4px 12px 8px 12px;
                    color: #666;
                    font-size: 0.65rem;
                }
                .canvas-backlinks-list {
                    padding: 0 0 6px 0;
                }
                .canvas-backlinks-item {
                    padding: 8px 12px;
                    cursor: pointer;
                    transition: background 0.15s ease;
                    border-left: 2px solid transparent;
                }
                .canvas-backlinks-item:hover {
                    background: rgba(0, 255, 65, 0.08);
                    border-left-color: var(--main-color, #00ff41);
                }
                .canvas-backlinks-item-title {
                    color: #eee;
                    font-weight: 500;
                    margin-bottom: 2px;
                }
                .canvas-backlinks-item-snippet {
                    color: #666;
                    font-size: 0.7rem;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .canvas-backlinks-panel::-webkit-scrollbar {
                    width: 4px;
                }
                .canvas-backlinks-panel::-webkit-scrollbar-track {
                    background: transparent;
                }
                .canvas-backlinks-panel::-webkit-scrollbar-thumb {
                    background: var(--main-color, #00ff41);
                    border-radius: 2px;
                }
                .canvas-backlinks-badge {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 16px;
                    height: 16px;
                    padding: 0 4px;
                    border-radius: 8px;
                    background: var(--main-color, #00ff41);
                    color: #000;
                    font-size: 0.6rem;
                    font-weight: bold;
                    line-height: 1;
                    margin-left: 6px;
                    cursor: default;
                    vertical-align: middle;
                }
                .canvas-card-create-note {
                    font-size: 0.65rem;
                    padding: 2px 6px;
                    height: 20px;
                    background: rgba(255, 255, 255, 0.06);
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    color: #aaa;
                    border-radius: 3px;
                    cursor: pointer;
                    margin: 0 4px;
                    transition: all 0.15s ease;
                    flex-shrink: 0;
                }
                .canvas-card-create-note:hover {
                    background: rgba(0, 255, 65, 0.15);
                    border-color: var(--main-color, #00ff41);
                    color: var(--main-color, #00ff41);
                }
            `;
            document.head.appendChild(blStyle);
        }

        // Zoom label reference
        this.zoomLabel = this.toolbar.querySelector('#canvas-zoom-label');

        this.bindToolbar();
        this.bindEvents();
    },

    // ─── DATA LOADING ───
    load: function(noteId) {
        console.log('[CanvasManager] load() - noteId:', noteId, '| board:', !!this.board, '| container:', !!this.container);
        
        // Anti-Race Condition: Self-initialize if not ready
        if (!this.container || !this.board) {
            console.log('[CanvasManager] Auto-initializing to prevent race condition.');
            this.init();
        }
        
        this.activeNoteId = noteId;
        const note = this._getActiveNote();
        if (!note) { console.warn('[CanvasManager] Note not found!'); return; }

        // Ensure canvasData exists
        if (!note.canvasData) note.canvasData = { nodes: [], edges: [] };
        console.log('[CanvasManager] Loaded. Nodes:', note.canvasData.nodes.length, '| Container offsetHeight:', this.container ? this.container.offsetHeight : 'N/A');

        // Restore viewport from saved data
        if (note.canvasData.viewport) {
            this.transform = { ...note.canvasData.viewport };
        } else {
            this.transform = { x: 0, y: 0, scale: 1 };
        }
        this.updateTransform();

        // Clear existing nodes (both cards and groups)
        if (this.board) {
            this.board.querySelectorAll('.canvas-card, .canvas-group').forEach(n => n.remove());
            // Preserve SVG defs (arrowhead markers) by rebuilding them
            this.svgLayer.innerHTML = '';
            var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            defs.innerHTML = '<marker id="canvas-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" fill="var(--main-color, #00ff41)"><path d="M 0 0 L 10 5 L 0 10 z" /></marker><marker id="canvas-arrowhead-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" fill="#555"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>';
            this.svgLayer.appendChild(defs);
        }

        if (note.canvasData.nodes) {
            note.canvasData.nodes.forEach(nodeData => {
                this.addCard(nodeData);
            });
        }

        if (note.canvasData.edges) {
            note.canvasData.edges.forEach(edge => {
                this.renderEdge(edge);
            });
        }
        setTimeout(() => { this.updateUI(); }, 50);

        // Update backlinks badges for all file nodes
        setTimeout(() => {
            if (note && note.canvasData && note.canvasData.nodes) {
                note.canvasData.nodes.forEach(node => {
                    if (node.type === 'file') {
                        this._updateBacklinksBadge(node.id);
                    }
                });
            }
        }, 10);

        // Route existing wiki-links in text nodes to existing file nodes
        setTimeout(() => {
            if (note && note.canvasData && note.canvasData.nodes) {
                note.canvasData.nodes.forEach(node => {
                    if (node.type && (node.type === 'file' || node.type === 'embed' || node.type === 'group')) return;
                    this._routeWikiLinks(node.id, false);
                });
            }
        }, 150);

        // Feature 6: Minimap
        this._initMinimap();
        this._updateMinimap();
    },

    // ─── UI UPDATES ───
    updateUI: function() {
        const note = this._getActiveNote();
        const count = (note && note.canvasData && note.canvasData.nodes) ? note.canvasData.nodes.length : 0;

        // Node count
        const countEl = this.toolbar ? this.toolbar.querySelector('#canvas-node-count') : null;
        if (countEl) countEl.textContent = count + ' node' + (count !== 1 ? 's' : '');

        // Zoom label
        if (this.zoomLabel) this.zoomLabel.textContent = Math.round(this.transform.scale * 100) + '%';

        // Empty state hint
        if (this.hintOverlay) {
            this.hintOverlay.style.display = count === 0 ? 'flex' : 'none';
        }

        // Update Minimap
        this._updateMinimap();
    },

    bindToolbar: function() {
        if (!this.toolbar) return;

        // + NODE button
        this.toolbar.querySelector('#canvas-add-node').addEventListener('click', () => {
            this._saveHistoryState();
            // Add node at center of visible area
            const rect = this.container.getBoundingClientRect();
            const cx = (rect.width / 2 - this.transform.x) / this.transform.scale;
            const cy = (rect.height / 2 - this.transform.y) / this.transform.scale;

            const newNode = {
                id: 'node_' + Date.now(),
                title: '',
                preview: '',
                x: cx - 100,
                y: cy - 40,
                width: 200,
                height: 80
            };

            var note = this._getActiveNote();
            if (note && note.canvasData) {
                if (!note.canvasData.nodes) note.canvasData.nodes = [];
                note.canvasData.nodes.push(newNode);
                this.addCard(newNode);
                this._saveData();
                this.updateUI();
            }
        });

        // RESET VIEW button
        this.toolbar.querySelector('#canvas-reset-view').addEventListener('click', () => {
            this.transform = { x: 0, y: 0, scale: 1 };
            this.updateTransform();
            this.updateUI();
        });

        // + FILE button
        this.toolbar.querySelector('#canvas-add-file').addEventListener('click', (e) => {
            const rect = e.target.getBoundingClientRect();
            this._showNotePicker(rect.left, rect.bottom + 4);
        });

        // + URL button
        this.toolbar.querySelector('#canvas-add-url').addEventListener('click', (e) => {
            const rect = e.target.getBoundingClientRect();
            this._showUrlPicker(rect.left, rect.bottom + 4);
        });

        // + GROUP button
        this.toolbar.querySelector('#canvas-add-group').addEventListener('click', () => {
            this._addGroupNode();
        });

        // ? SHORTCUTS button
        this.toolbar.querySelector('#canvas-shortcuts-btn').addEventListener('click', () => {
            this._showShortcutsPanel();
        });
    },

    },

    // ─── PICKER OVERLAYS ───
    _showNotePicker: function(screenX, screenY) {
        this._closeNotePicker();

        const picker = document.createElement('div');
        picker.className = 'canvas-note-picker';
        picker.id = 'canvas-note-picker';
        picker.style.left = screenX + 'px';
        picker.style.top = screenY + 'px';
        picker.style.position = 'fixed';

        const search = document.createElement('input');
        search.type = 'text';
        search.placeholder = 'Search notes...';
        picker.appendChild(search);

        const list = document.createElement('div');
        picker.appendChild(list);

        var self = this;
        var allNotes = (window.State.NOTES || []).filter(function(n) { return n.type !== 'canvas' && n.id !== self.activeNoteId; });

        var renderList = function(filter) {
            list.innerHTML = '';
            var filtered = filter
                ? allNotes.filter(function(n) { return (n.title || '').toLowerCase().includes(filter.toLowerCase()); })
                : allNotes;

            filtered.slice(0, 15).forEach(function(n) {
                var item = document.createElement('div');
                item.className = 'canvas-note-picker-item';
                item.textContent = n.title || 'Untitled';
                item.addEventListener('click', function() {
                    self._addFileNode(n.id);
                    self._closeNotePicker();
                });
                list.appendChild(item);
            });

            if (filtered.length === 0) {
                var empty = document.createElement('div');
                empty.style.cssText = 'padding:8px;color:#555;font-size:0.75rem;text-align:center;';
                empty.textContent = 'No notes found';
                list.appendChild(empty);
            }
        };

        renderList('');
        search.addEventListener('input', function() { renderList(search.value); });

        document.body.appendChild(picker);
        search.focus();

        // Close on outside click
        setTimeout(function() {
            var closeHandler = function(e) {
                if (!picker.contains(e.target)) {
                    self._closeNotePicker();
                    document.removeEventListener('mousedown', closeHandler);
                }
            };
            document.addEventListener('mousedown', closeHandler);
        }, 50);
    },

    _closeNotePicker: function() {
        var existing = document.getElementById('canvas-note-picker');
        if (existing) existing.remove();
    },

    _showUrlPicker: function(screenX, screenY) {
        this._closeUrlPicker();

        var picker = document.createElement('div');
        picker.className = 'canvas-note-picker';
        picker.id = 'canvas-url-picker';
        picker.style.left = screenX + 'px';
        picker.style.top = screenY + 'px';
        picker.style.position = 'fixed';
        picker.style.width = '300px';

        var input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Paste YouTube or Website URL...';
        input.style.width = '100%';
        picker.appendChild(input);

        var self = this;
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                var url = input.value.trim();
                if (url) {
                    self._addEmbedNode(url);
                    self._closeUrlPicker();
                }
            } else if (e.key === 'Escape') {
                self._closeUrlPicker();
            }
        });

        document.body.appendChild(picker);
        input.focus();

        // Close on outside click
        setTimeout(function() {
            var closeHandler = function(e) {
                if (!picker.contains(e.target)) {
                    self._closeUrlPicker();
                    document.removeEventListener('mousedown', closeHandler);
                }
            };
            document.addEventListener('mousedown', closeHandler);
        }, 50);
    },

    _closeUrlPicker: function() {
        var existing = document.getElementById('canvas-url-picker');
        if (existing) existing.remove();
    },

    // ─── OVERLAY PANELS ───

    _showShortcutsPanel: function() {
        this._closeShortcutsPanel();

        const overlay = document.createElement('div');
        overlay.className = 'canvas-shortcuts-overlay';
        overlay.id = 'canvas-shortcuts-overlay';

        const panel = document.createElement('div');
        panel.className = 'canvas-shortcuts-panel';
        panel.id = 'canvas-shortcuts-panel';

        panel.innerHTML = `
            <div class="canvas-shortcuts-header">
                <span class="canvas-shortcuts-title">⌘ Canvas Shortcuts</span>
                <button class="canvas-shortcuts-close" id="canvas-shortcuts-close-btn" title="Close">&times;</button>
            </div>

            <div class="canvas-shortcuts-section">
                <div class="canvas-shortcuts-section-title">Nodes & Selection</div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Add text node (double-click)</span>
                    <span class="canvas-shortcuts-key"><kbd>DBLCLICK</kbd></span>
                </div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Delete selected node(s)</span>
                    <span class="canvas-shortcuts-key"><kbd>⌫</kbd> <kbd>DEL</kbd></span>
                </div>
            </div>

            <div class="canvas-shortcuts-section">
                <div class="canvas-shortcuts-section-title">Create Connections</div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Create connected child (right)</span>
                    <span class="canvas-shortcuts-key"><kbd class="mod">⇥</kbd></span>
                </div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Create sibling below</span>
                    <span class="canvas-shortcuts-key"><kbd class="mod">⏎</kbd></span>
                </div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Connect nodes</span>
                    <span class="canvas-shortcuts-key"><kbd>⇧</kbd> <kbd>DRAG</kbd></span>
                </div>
            </div>

            <div class="canvas-shortcuts-section">
                <div class="canvas-shortcuts-section-title">Clipboard & History</div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Copy selected node(s)</span>
                    <span class="canvas-shortcuts-key"><kbd class="mod">⌘</kbd><kbd>C</kbd></span>
                </div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Paste node(s)</span>
                    <span class="canvas-shortcuts-key"><kbd class="mod">⌘</kbd><kbd>V</kbd></span>
                </div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Duplicate selected node(s)</span>
                    <span class="canvas-shortcuts-key"><kbd class="mod">⌘</kbd><kbd>D</kbd></span>
                </div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Undo</span>
                    <span class="canvas-shortcuts-key"><kbd class="mod">⌘</kbd><kbd>Z</kbd></span>
                </div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Redo</span>
                    <span class="canvas-shortcuts-key"><kbd class="mod">⌘</kbd><kbd>⇧</kbd><kbd>Z</kbd> <kbd class="mod">⌘</kbd><kbd>Y</kbd></span>
                </div>
            </div>

            <div class="canvas-shortcuts-section">
                <div class="canvas-shortcuts-section-title">View & Navigation</div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Search nodes</span>
                    <span class="canvas-shortcuts-key"><kbd class="mod">⌘</kbd><kbd>F</kbd></span>
                </div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Zoom to fit</span>
                    <span class="canvas-shortcuts-key"><kbd>⇧</kbd><kbd>1</kbd></span>
                </div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Zoom in/out</span>
                    <span class="canvas-shortcuts-key"><kbd class="mod">⌘</kbd><kbd>SCROLL</kbd></span>
                </div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Pan canvas</span>
                    <span class="canvas-shortcuts-key"><kbd>SPACE</kbd> <kbd>DRAG</kbd></span>
                </div>
                <div class="canvas-shortcuts-item">
                    <span class="canvas-shortcuts-label">Open this panel</span>
                    <span class="canvas-shortcuts-key"><kbd>⇧</kbd><kbd>?</kbd></span>
                </div>
            </div>

            <div class="canvas-shortcuts-footer">
                Press <kbd style="color:#ddd;border:1px solid rgba(255,255,255,0.15);padding:1px 5px;border-radius:3px;font-size:0.6rem;">ESC</kbd> or click outside to close
            </div>
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(panel);

        // Close button
        document.getElementById('canvas-shortcuts-close-btn').addEventListener('click', () => this._closeShortcutsPanel());

        // Click overlay to close
        overlay.addEventListener('mousedown', () => this._closeShortcutsPanel());

        // Escape to close (capture phase: must fire before modal/editor capture handlers)
        this._shortcutsEscapeHandler = (e) => {
            if (e.key === 'Escape') {
                this._closeShortcutsPanel();
            }
        };
        window.addEventListener('keydown', this._shortcutsEscapeHandler, { capture: true });
    },

    _closeShortcutsPanel: function() {
        const overlay = document.getElementById('canvas-shortcuts-overlay');
        const panel = document.getElementById('canvas-shortcuts-panel');
        if (overlay) overlay.remove();
        if (panel) panel.remove();
        if (this._shortcutsEscapeHandler) {
            window.removeEventListener('keydown', this._shortcutsEscapeHandler, { capture: true });
            this._shortcutsEscapeHandler = null;
        }
    },

    // ─── NODE CREATION ───
    _addFileNode: function(linkedNoteId) {
        this._saveHistoryState();
        var linkedNote = window.State.NOTES.find(function(n) { return n.id === linkedNoteId; });
        if (!linkedNote) return;

        var center = this._getWorldCenter();

        var newNode = {
            id: 'node_' + Date.now(),
            type: 'file',
            linkedNoteId: linkedNoteId,
            title: linkedNote.title || 'Untitled',
            preview: '',
            x: center.x - 120,
            y: center.y - 60,
            width: 240,
            height: 160
        };

        var note = this._getActiveNote();
        if (note && note.canvasData) {
            if (!note.canvasData.nodes) note.canvasData.nodes = [];
            note.canvasData.nodes.push(newNode);
            this.addCard(newNode);
            this._saveData();
            this.updateUI();
        }
    },

    _addEmbedNode: function(url) {
        this._saveHistoryState();
        var center = this._getWorldCenter();

        // Auto-convert common URLs to embedded formats
        let embedUrl = url;
        let videoId = null;
        if (url.includes('youtube.com/watch?v=')) {
            videoId = new URL(url).searchParams.get('v');
        } else if (url.includes('youtu.be/')) {
            videoId = url.split('youtu.be/')[1].split('?')[0];
        } else if (url.includes('docs.google.com/') && url.includes('/preview')) {
            // Ensure Docs/Sheets loading as interactive editors instead of static previews
            embedUrl = url.replace('/preview', '/edit');
        }

        if (videoId) {
            // Revert back from nocookie. We spoof the Referer header via rules.json to bypass Error 153.
            // But we must also match that spoofed header in the 'origin' query parameter or else we get Error 152.
            const originStr = encodeURIComponent('https://www.youtube.com');
            embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0&showinfo=0&origin=${originStr}`;
        }

        var newNode = {
            id: 'node_' + Date.now(),
            type: 'embed',
            url: embedUrl,
            title: (function(url) { try { return new URL(url).hostname.replace('www.', ''); } catch(e) { return url; } })(embedUrl),
            x: center.x - 160,
            y: center.y - 100,
            width: 320,
            height: 240
        };

        var note = this._getActiveNote();
        if (note && note.canvasData) {
            if (!note.canvasData.nodes) note.canvasData.nodes = [];
            note.canvasData.nodes.push(newNode);
            this.addCard(newNode);
            this._saveData();
            this.updateUI();
        }
    },

    _addGroupNode: function() {
        this._saveHistoryState();
        var center = this._getWorldCenter();

        var newNode = {
            id: 'node_' + Date.now(),
            type: 'group',
            label: 'New Group',
            x: center.x - 200,
            y: center.y - 150,
            width: 400,
            height: 300,
            color: 'default'
        };

        var note = this._getActiveNote();
        if (note && note.canvasData) {
            if (!note.canvasData.nodes) note.canvasData.nodes = [];
            note.canvasData.nodes.unshift(newNode);
            this.load(this.activeNoteId);
            this._saveData();
            setTimeout(function() {
                var el = document.getElementById('canvas-node-' + newNode.id);
                if (el) {
                    var input = el.querySelector('.canvas-group-label');
                    if (input) {
                        input.focus();
                        input.select();
                    }
                }
            }, 60);
        }
    },

    // ─── EVENT BINDING ───
    bindEvents: function() {
        if (!this.container) return;

        // === KEYBOARD SHORTCUTS & PAN STATE ===
        var isSpacePressed = false;
        var self = this;
        window.addEventListener('keydown', function(e) {
            var isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
            var isCmdOrCtrl = e.metaKey || e.ctrlKey;
            
            // Cmd+F / Ctrl+F = Find in canvas
            if (isCmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 'f') {
                if (!isInput || e.target.closest('#canvas-container')) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.CanvasSearch) window.CanvasSearch.toggle();
                    return;
                }
            }

            // Shift + 1 = Zoom to Fit
            if (e.shiftKey && e.key === '!' && !isInput) {
                e.preventDefault();
                self.zoomToFit();
                return;
            }

            if (e.code === 'Space' && !isInput) {
                isSpacePressed = true;
                self.container.style.cursor = 'grab';
                e.preventDefault();
                return;
            }

            if (e.key === '?' && !isInput) {
                e.preventDefault();
                self._showShortcutsPanel();
                return;
            }

            if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
                if (self.selectedNodeIds.size > 0) {
                    e.preventDefault();
                    self.deleteSelectedNodes();
                }
            }

            if (isCmdOrCtrl && !isInput) {
                if (e.key === 'c' || e.key === 'C') {
                    e.preventDefault();
                    self.copySelectedNodes();
                } else if (e.key === 'v' || e.key === 'V') {
                    e.preventDefault();
                    self.pasteCopiedNodes();
                } else if (e.key === 'd' || e.key === 'D') {
                    e.preventDefault();
                    self.duplicateSelectedNodes();
                } else if (e.key === 'z' || e.key === 'Z') {
                    e.preventDefault();
                    if (e.shiftKey) self.redo();
                    else self.undo();
                } else if (e.key === 'y' || e.key === 'Y') {
                    e.preventDefault();
                    self.redo();
                }
            }

            // Keyboard Spawning (Tab / Enter)
            if (self.selectedNodeId && (e.key === 'Tab' || (!e.shiftKey && e.key === 'Enter'))) {
                if (isInput) {
                    var activeCard = e.target.closest('.canvas-card, .canvas-group');
                    if (!activeCard || activeCard.id !== 'canvas-node-' + self.selectedNodeId) return;
                }
                e.preventDefault();
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

                var note = self._getActiveNote();
                if (!note || !note.canvasData) return;

                var parentNode = note.canvasData.nodes.find(function(n) { return n.id === self.selectedNodeId; });
                if (!parentNode) return;

                self._saveHistoryState();
                var newNode = {
                    id: 'node_' + Date.now(),
                    title: '',
                    preview: '',
                    width: 200,
                    height: 80
                };

                if (e.key === 'Tab') {
                    newNode.x = parentNode.x + (parentNode.width || 200) + 60;
                    newNode.y = parentNode.y;
                } else {
                    newNode.x = parentNode.x;
                    newNode.y = parentNode.y + (parentNode.height || 80) + 60;
                }

                note.canvasData.nodes.push(newNode);

                if (e.key === 'Tab') {
                    if (!note.canvasData.edges) note.canvasData.edges = [];
                    note.canvasData.edges.push({
                        fromNode: parentNode.id,
                        toNode: newNode.id,
                        fromPort: 'right',
                        toPort: 'left',
                        label: ''
                    });
                }

                self.selectedNodeId = newNode.id;
                self.addCard(newNode);
                if (e.key === 'Tab') self._refreshEdges();
                self._saveData();

                document.querySelectorAll('.canvas-card.selected-node, .canvas-group.selected-node').forEach(function(el) { el.classList.remove('selected-node'); });
                var newCard = document.getElementById('canvas-node-' + newNode.id);
                if (newCard) {
                    newCard.classList.add('selected-node');
                    setTimeout(function() {
                        var bodyContent = newCard.querySelector('.canvas-card-body');
                        if (bodyContent) bodyContent.focus();
                    }, 50);
                }
            }
        });
        window.addEventListener('keyup', function(e) {
            if (e.code === 'Space') {
                isSpacePressed = false;
                self.container.style.cursor = '';
            }
        });

        // === PAN OR LASSO SELECT ===
        self.container.addEventListener('mousedown', function(e) {
            var isBgClick = !e.target.closest('.canvas-card') && !e.target.closest('.canvas-toolbar') && !e.target.closest('#canvas-note-picker') && !e.target.closest('#canvas-url-picker');
            if (!isBgClick) return;
            var isPanCmd = isSpacePressed || e.button === 1;
            if (isPanCmd) {
                e.preventDefault();
                self.isPanning = true;
                self.dragStart = { x: e.clientX - self.transform.x, y: e.clientY - self.transform.y };
                self.container.style.cursor = 'grabbing';
            } else if (e.button === 0) {
                self.clearSelection();
                self.isSelectingMarquee = true;
                self.marqueeStart = { x: e.clientX, y: e.clientY };
                self.marqueeEl = document.createElement('div');
                self.marqueeEl.className = 'canvas-selection-marquee';
                self.container.appendChild(self.marqueeEl);
            }
        });

        // === DOUBLE CLICK: Create node ===
        self.container.addEventListener('dblclick', function(e) {
            if (e.target.closest('.canvas-card') || e.target.closest('.canvas-toolbar')) return;
            self._saveHistoryState();
            var rect = self.container.getBoundingClientRect();
            var x = (e.clientX - rect.left - self.transform.x) / self.transform.scale;
            var y = (e.clientY - rect.top - self.transform.y) / self.transform.scale;

            var newNode = {
                id: 'node_' + Date.now(),
                title: '',
                preview: '',
                x: x - 100,
                y: y - 40,
                width: 200,
                height: 80
            };

            var note = self._getActiveNote();
            if (note && note.canvasData) {
                if (!note.canvasData.nodes) note.canvasData.nodes = [];
                note.canvasData.nodes.push(newNode);
                self.addCard(newNode);
                self._saveData();
                self.updateUI();
            }
        });

        // === GLOBAL MOUSE MOVE ===
        window.addEventListener('mousemove', function(e) {
            self.lastMouseCoords = { x: e.clientX, y: e.clientY };
            if (self.isPanning) {
                self.transform.x = e.clientX - self.dragStart.x;
                self.transform.y = e.clientY - self.dragStart.y;
                self.updateTransform();
                self._updateBacklinksPosition();
                return;
            }

            if (self.isSelectingMarquee && self.marqueeEl) {
                var currentX = e.clientX;
                var currentY = e.clientY;
                var x = Math.min(self.marqueeStart.x, currentX);
                var y = Math.min(self.marqueeStart.y, currentY);
                var w = Math.abs(self.marqueeStart.x - currentX);
                var h = Math.abs(self.marqueeStart.y - currentY);
                var rect = self.container.getBoundingClientRect();

                self.marqueeEl.style.left = (x - rect.left) + 'px';
                self.marqueeEl.style.top = (y - rect.top) + 'px';
                self.marqueeEl.style.width = w + 'px';
                self.marqueeEl.style.height = h + 'px';

                var worldX1 = (x - rect.left - self.transform.x) / self.transform.scale;
                var worldY1 = (y - rect.top - self.transform.y) / self.transform.scale;
                var worldX2 = worldX1 + w / self.transform.scale;
                var worldY2 = worldY1 + h / self.transform.scale;

                var note = self._getActiveNote();
                if (note && note.canvasData && note.canvasData.nodes) {
                    note.canvasData.nodes.forEach(function(node) {
                        var wNode = node.width || 200;
                        var hNode = node.height || 80;
                        var isIntersecting = !(node.x + wNode < worldX1 || node.x > worldX2 || node.y + hNode < worldY1 || node.y > worldY2);
                        var cardEl = document.getElementById('canvas-node-' + node.id);
                        if (cardEl) {
                            if (isIntersecting) {
                                cardEl.classList.add('selected-node');
                                self.selectedNodeIds.add(node.id);
                            } else {
                                cardEl.classList.remove('selected-node');
                                self.selectedNodeIds.delete(node.id);
                            }
                        }
                    });
                    self.selectedNodeId = self.selectedNodeIds.size > 0 ? Array.from(self.selectedNodeIds)[0] : null;
                }
                return;
            }

            if (self.draggedNodeId) {
                var note = self._getActiveNote();
                if (!note || !note.canvasData || !note.canvasData.edges) return;
                note.canvasData.edges.forEach(function(edge) {
                    if (edge.fromNode === self.draggedNodeId || edge.toNode === self.draggedNodeId) {
                        self.renderEdge(edge);
                    }
                });
            }
        });

        // === GLOBAL MOUSE UP ===
        window.addEventListener('mouseup', function() {
            if (self.isPanning) {
                self.isPanning = false;
                self.container.style.cursor = isSpacePressed ? 'grab' : '';
                self._saveViewport();
            }
            if (self.isSelectingMarquee) {
                self.isSelectingMarquee = false;
                if (self.marqueeEl) {
                    self.marqueeEl.remove();
                    self.marqueeEl = null;
                }
            }
            self.draggedNodeId = null;
        });

        // === ZOOM & PAN (Trackpad / Mouse Wheel) ===
        self.container.addEventListener('wheel', function(e) {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                var rect = self.container.getBoundingClientRect();
                var mouseX = e.clientX - rect.left;
                var mouseY = e.clientY - rect.top;
                var zoomFactor = Math.pow(0.995, e.deltaY);
                var newScale = Math.max(0.1, Math.min(5, self.transform.scale * zoomFactor));
                self.transform.x = mouseX - (mouseX - self.transform.x) * (newScale / self.transform.scale);
                self.transform.y = mouseY - (mouseY - self.transform.y) * (newScale / self.transform.scale);
                self.transform.scale = newScale;
            } else {
                self.transform.x -= e.deltaX;
                self.transform.y -= e.deltaY;
            }
            self.updateTransform();
            self.updateUI();
            self._updateBacklinksPosition();
            clearTimeout(self._wheelSaveTimeout);
            self._wheelSaveTimeout = setTimeout(function() { self._saveViewport(); }, 300);
        }, { passive: false });
    },

    // ─── VIEWPORT ───
    _saveViewport: function() {
        var note = this._getActiveNote();
        if (note && note.canvasData) {
            note.canvasData.viewport = { x: this.transform.x, y: this.transform.y, scale: this.transform.scale };
            this._saveData();
        }
    },

    zoomToFit: function() {
        var note = this._getActiveNote();
        if (!note || !note.canvasData || !note.canvasData.nodes || note.canvasData.nodes.length === 0) return;

        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        note.canvasData.nodes.forEach(function(n) {
            var w = n.width || 200;
            var h = n.height || 80;
            if (n.x < minX) minX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.x + w > maxX) maxX = n.x + w;
            if (n.y + h > maxY) maxY = n.y + h;
        });

        var padding = 60;
        var contentWidth = (maxX - minX) + (padding * 2);
        var contentHeight = (maxY - minY) + (padding * 2);
        var rect = this.container.getBoundingClientRect();
        var newScale = Math.min(rect.width / contentWidth, rect.height / contentHeight);
        newScale = Math.max(0.1, Math.min(2, newScale));

        var centerX = minX + (maxX - minX) / 2;
        var centerY = minY + (maxY - minY) / 2;

        this.transform.scale = newScale;
        this.transform.x = (rect.width / 2) - (centerX * newScale);
        this.transform.y = (rect.height / 2) - (centerY * newScale);

        this.updateTransform();
        this.updateUI();
        this._saveViewport();
    },

    // ─── MINIMAP ───

    _initMinimap: function() {
        if (!this.container) return;
        const existing = document.getElementById('canvas-minimap');
        if (existing) existing.remove();

        this.minimap = document.createElement('div');
        this.minimap.id = 'canvas-minimap';
        this.minimap.className = 'canvas-minimap';

        this.minimapViewport = document.createElement('div');
        this.minimapViewport.className = 'canvas-minimap-viewport';

        this.minimap.appendChild(this.minimapViewport);
        this.container.appendChild(this.minimap);

        // Click to jump
        this.minimap.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this._minimapClick(e);
            
            const onMouseMove = (moveEvent) => this._minimapClick(moveEvent);
            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    },

    _updateMinimap: function() {
        if (!this.minimap || !this.minimapViewport) return;
        var note = this._getActiveNote();
        if (!note || !note.canvasData || !note.canvasData.nodes || note.canvasData.nodes.length === 0) {
            this.minimap.style.display = 'none';
            return;
        }

        this.minimap.style.display = 'block';

        // 1. Calculate map bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        note.canvasData.nodes.forEach(n => {
            const w = n.width || 200;
            const h = n.height || 80;
            if (n.x < minX) minX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.x + w > maxX) maxX = n.x + w;
            if (n.y + h > maxY) maxY = n.y + h;
        });

        // Add 1000px padding around the mathematical bounds for breathing room
        const padding = 1000;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        const contentW = maxX - minX;
        const contentH = maxY - minY;

        // Minimap dimensions (fixed via CSS, but let's read it)
        const mapW = 150;
        const mapH = 100;

        // Scale factor: world coordinates to minimap pixels
        const scaleX = mapW / Math.max(1, contentW);
        const scaleY = mapH / Math.max(1, contentH);
        const mapScale = Math.min(scaleX, scaleY);

        // Store bounds for click translation
        this._mapBounds = { minX, minY, scale: mapScale, offsetW: (mapW - (contentW*mapScale))/2, offsetH: (mapH - (contentH*mapScale))/2 };

        // 2. Draw nodes
        // Clear old nodes
        this.minimap.querySelectorAll('.canvas-minimap-node').forEach(n => n.remove());

        note.canvasData.nodes.forEach(n => {
            const el = document.createElement('div');
            el.className = 'canvas-minimap-node';
            if (n.type === 'group') el.classList.add('is-group');
            
            // Apply custom color if exists (dimmed for minimap)
            if (n.color && n.color !== 'default') {
               const colorMap = { red:'#ff3366', yellow:'#ffcc00', green:'#00ff41', blue:'#00e5ff', purple:'#b82bf2' };
               if (colorMap[n.color]) {
                   el.style.backgroundColor = n.type === 'group' ? colorMap[n.color] + '44' : colorMap[n.color];
                   if (n.type === 'group') el.style.border = `1px solid ${colorMap[n.color]}`;
               }
            }

            const x = (n.x - minX) * mapScale + this._mapBounds.offsetW;
            const y = (n.y - minY) * mapScale + this._mapBounds.offsetH;
            const w = (n.width || 200) * mapScale;
            const h = (n.height || 80) * mapScale;

            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
            el.style.width = Math.max(2, w) + 'px';
            el.style.height = Math.max(2, h) + 'px';
            
        // Insert before the viewport so the viewport is always on top
            this.minimap.insertBefore(el, this.minimapViewport);
        });

        // 3. Draw Viewport Rect
        this._syncMinimapViewport();
    },

    _syncMinimapViewport: function() {
        if (!this.minimapViewport || !this._mapBounds || !this.container) return;

        const containerRect = this.container.getBoundingClientRect();
        
        // World coordinates of top-left and bottom-right of screen
        const vX1 = -this.transform.x / this.transform.scale;
        const vY1 = -this.transform.y / this.transform.scale;
        const vW = containerRect.width / this.transform.scale;
        const vH = containerRect.height / this.transform.scale;

        // Map to minimap coordinates
        const mX = (vX1 - this._mapBounds.minX) * this._mapBounds.scale + this._mapBounds.offsetW;
        const mY = (vY1 - this._mapBounds.minY) * this._mapBounds.scale + this._mapBounds.offsetH;
        const mW = vW * this._mapBounds.scale;
        const mH = vH * this._mapBounds.scale;

        this.minimapViewport.style.left = `${mX}px`;
        this.minimapViewport.style.top = `${mY}px`;
        this.minimapViewport.style.width = `${mW}px`;
        this.minimapViewport.style.height = `${mH}px`;
    },

    _minimapClick: function(e) {
        if (!this._mapBounds || !this.container) return;
        const rect = this.minimap.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();

        // Local click inside minimap box
        let clickX = e.clientX - rect.left;
        let clickY = e.clientY - rect.top;

        // Clamp to minimap bounds
        clickX = Math.max(0, Math.min(rect.width, clickX));
        clickY = Math.max(0, Math.min(rect.height, clickY));

        // Convert back to world coords
        const worldX = ((clickX - this._mapBounds.offsetW) / this._mapBounds.scale) + this._mapBounds.minX;
        const worldY = ((clickY - this._mapBounds.offsetH) / this._mapBounds.scale) + this._mapBounds.minY;

        // We want the clicked world point to be in the center of the screen
        const vW = containerRect.width / this.transform.scale;
        const vH = containerRect.height / this.transform.scale;

        this.transform.x = - (worldX - vW/2) * this.transform.scale;
        this.transform.y = - (worldY - vH/2) * this.transform.scale;

        this.updateTransform();
        this.updateUI();
        this._saveViewport();
    },

    updateTransform: function() {
        if (this.board) {
            this.board.style.transform = `translate(${this.transform.x}px, ${this.transform.y}px) scale(${this.transform.scale})`;
        }
        this._syncMinimapViewport();
    },

    addCard: function(nodeData) {
        const card = document.createElement('div');
        card.id = `canvas-node-${nodeData.id}`;
        if (nodeData.type !== 'group') {
            card.className = 'canvas-card';
        } else {
            card.className = 'canvas-group';
        }
        
        if (nodeData.color && nodeData.color !== 'default') {
            card.setAttribute('data-color', nodeData.color);
        }

        card.style.cssText = `
            position: absolute;
            left: ${nodeData.x}px;
            top: ${nodeData.y}px;
            width: ${nodeData.width || 200}px;
            min-height: ${nodeData.height || 80}px;
            ${nodeData.zIndex ? `z-index: ${nodeData.zIndex};` : ''}
        `;

        // === CARD CONTENT ===
        if (nodeData.type === 'file') {
            card.classList.add('file-node');
            const linkedNote = window.State.NOTES.find(n => n.id === nodeData.linkedNoteId);
            const noteTitle = linkedNote ? (linkedNote.title || 'Untitled') : 'Missing Note';

            // Render from blocks (BlockEditor format) → HTML
            let renderedHtml = '';
            if (linkedNote && linkedNote.blocks && linkedNote.blocks.length > 0) {
                renderedHtml = this._blocksToHtml(linkedNote.blocks);
            } else if (linkedNote && linkedNote.content) {
                // Legacy fallback: use renderMarkdown
                if (window.Notes && window.Notes.renderMarkdown) {
                    renderedHtml = window.Notes.renderMarkdown(linkedNote.content);
                } else {
                    renderedHtml = linkedNote.content.replace(/</g, '&lt;').replace(/\n/g, '<br>');
                }
            }

            card.innerHTML = `
                <div class="canvas-card-header">
                    <div class="canvas-card-title">📎 ${noteTitle}</div>
                    <span class="canvas-backlinks-badge" id="backlinks-badge-${nodeData.id}" style="display:none;" title="Backlinks">0</span>
                    <button class="canvas-card-file-open" title="Open in Editor">OPEN</button>
                    <span class="canvas-card-delete" role="button" aria-label="Delete node" title="Delete node">&times;</span>
                </div>
                <div class="canvas-card-file-body">${renderedHtml}</div>
            `;

            // Open button handler
            card.querySelector('.canvas-card-file-open').addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.Notes && linkedNote) {
                    window.Notes.open(linkedNote.id);
                }
            });

            // Show backlinks badge after a short delay (to allow edges to be rendered)
            setTimeout(() => {
                this._updateBacklinksBadge(nodeData.id);
            }, 10);

        } else if (nodeData.type === 'embed') {
            card.classList.add('embed-node');
            
            let renderUrl = nodeData.url;

            // === CSP-BLOCKED DOMAIN REGISTRY ===
            // These sites enforce frame-ancestors CSP that permanently blocks
            // embedding in chrome-extension:// origins under MV3.
            const CSP_BLOCKED_DOMAINS = [
                'youtube.com', 'youtu.be',
                'docs.google.com', 'sheets.google.com', 'slides.google.com',
                'drive.google.com', 'mail.google.com', 'calendar.google.com',
                'facebook.com', 'instagram.com', 'threads.net',
                'twitter.com', 'x.com',
                'linkedin.com',
                'github.com',
                'reddit.com',
                'tiktok.com',
                'netflix.com', 'hulu.com', 'disneyplus.com',
                'spotify.com', 'soundcloud.com',
                'notion.so', 'figma.com', 'canva.com',
                'dropbox.com', 'onedrive.live.com',
                'slack.com', 'discord.com',
                'amazon.com', 'ebay.com',
                'paypal.com', 'stripe.com',
                'medium.com', 'substack.com',
                'zoom.us',
            ];

            // Check if the URL belongs to a CSP-blocked domain
            let hostname = '';
            try { hostname = new URL(renderUrl).hostname.replace('www.', ''); } catch(e) {}
            const isBlocked = CSP_BLOCKED_DOMAINS.some(domain => hostname.includes(domain));

            // === YOUTUBE: Special thumbnail Smart Card ===
            if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
                let displayUrl = renderUrl;
                let videoId = '';
                if (renderUrl.includes('youtube.com/embed/')) {
                    videoId = renderUrl.split('embed/')[1].split('?')[0];
                    displayUrl = `https://www.youtube.com/watch?v=${videoId}`;
                } else if (renderUrl.includes('watch?v=')) {
                    try { videoId = new URL(renderUrl).searchParams.get('v'); } catch(e) {}
                } else if (renderUrl.includes('youtu.be/')) {
                    videoId = renderUrl.split('youtu.be/')[1].split('?')[0];
                }

                const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : `https://www.google.com/s2/favicons?domain=youtube.com&sz=128`;

                card.innerHTML = `
                    <div class="canvas-card-header">
                        <div class="canvas-card-title" contenteditable="true">🌐 ${nodeData.title || 'YouTube Video'}</div>
                        <span class="canvas-card-delete" role="button" aria-label="Delete node" title="Delete node">&times;</span>
                    </div>
                    <div class="canvas-card-smart-body youtube-body" style="padding: 10px; gap: 8px; display: flex; flex-direction: column; justify-content: center; height: calc(100% - 35px); box-sizing: border-box;">
                        <a href="${displayUrl}" target="_blank" class="youtube-link-wrapper" style="position: relative; width: 100%; aspect-ratio: 16/9; display: block; border-radius: 6px; overflow: hidden; background: #000; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
                            <img src="${thumbnailUrl}" alt="YouTube Thumbnail" style="width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s ease;" />
                            <div class="youtube-play-overlay" style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.3); transition: background-color 0.2s ease;">
                                <div class="play-button-icon" style="width: 50px; height: 35px; background: #ff0000; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 1.1rem; transition: background-color 0.2s ease, transform 0.2s ease;">▶</div>
                            </div>
                        </a>
                        <div class="smart-card-details" style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                            <a href="${displayUrl}" target="_blank" class="smart-card-link" style="font-size: 0.75rem; font-weight: bold; color: var(--main-color, #00ff41); opacity: 0.8; text-decoration: none; transition: opacity 0.15s ease;">Watch on YouTube ↗</a>
                        </div>
                    </div>
                    <div class="canvas-resizer" title="Resize node"></div>
                `;

                const linkWrapper = card.querySelector('.youtube-link-wrapper');
                const playIcon = card.querySelector('.play-button-icon');
                const overlay = card.querySelector('.youtube-play-overlay');
                const img = card.querySelector('.youtube-link-wrapper img');

                linkWrapper.addEventListener('mouseenter', () => {
                    overlay.style.backgroundColor = 'rgba(0,0,0,0.45)';
                    playIcon.style.backgroundColor = '#cc0000';
                    playIcon.style.transform = 'scale(1.08)';
                    img.style.transform = 'scale(1.03)';
                });
                linkWrapper.addEventListener('mouseleave', () => {
                    overlay.style.backgroundColor = 'rgba(0,0,0,0.3)';
                    playIcon.style.backgroundColor = '#ff0000';
                    playIcon.style.transform = 'none';
                    img.style.transform = 'none';
                });
            
            // === CSP-BLOCKED: Generic Smart Card with favicon ===
            } else if (isBlocked) {
                let displayUrl = renderUrl;
                // Clean Google Docs embed URLs back to editable links
                if (displayUrl.includes('docs.google.com/') && displayUrl.includes('/preview')) {
                    displayUrl = displayUrl.replace('/preview', '/edit');
                }

                const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;

                // Generate a friendly title based on domain (only as default)
                let friendlyTitle = hostname;
                if (hostname.includes('docs.google.com')) friendlyTitle = 'Google Docs';
                if (hostname.includes('sheets.google.com')) friendlyTitle = 'Google Sheets';
                if (hostname.includes('slides.google.com')) friendlyTitle = 'Google Slides';
                if (hostname.includes('drive.google.com')) friendlyTitle = 'Google Drive';
                if (hostname.includes('github.com')) friendlyTitle = 'GitHub';
                if (hostname.includes('notion.so')) friendlyTitle = 'Notion';
                if (hostname.includes('figma.com')) friendlyTitle = 'Figma';
                const displayTitle = nodeData.title || friendlyTitle;

                card.innerHTML = `
                    <div class="canvas-card-header">
                        <div class="canvas-card-title" contenteditable="true">🌐 ${displayTitle}</div>
                        <span class="canvas-card-delete" role="button" aria-label="Delete node" title="Delete node">&times;</span>
                    </div>
                    <div class="canvas-card-smart-body">
                        <img src="${faviconUrl}" alt="${hostname}" class="smart-card-favicon" />
                        <div class="smart-card-details">
                            <div class="smart-card-title">${displayTitle}</div>
                            <a href="${displayUrl}" target="_blank" class="smart-card-link">${displayUrl}</a>
                        </div>
                    </div>
                    <div class="canvas-resizer" title="Resize node"></div>
                `;

            // === EMBEDDABLE: Iframe + Shield for everything else ===
            } else {
                const title = nodeData.title || hostname;
                
                card.innerHTML = `
                    <div class="canvas-card-header">
                        <div class="canvas-card-title" contenteditable="true">🌐 ${title}</div>
                        <div class="canvas-card-actions">
                            <button class="canvas-card-interact-btn" title="Toggle Interaction (Obsidian Style)">🖱️ Interact</button>
                            <span class="canvas-card-delete" role="button" aria-label="Delete node" title="Delete node">&times;</span>
                        </div>
                    </div>
                    <div class="canvas-card-embed-body" style="position: relative;">
                        <iframe src="${renderUrl}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"></iframe>
                        <div class="canvas-iframe-shield" style="position: absolute; inset: 0; z-index: 5; background: transparent;"></div>
                    </div>
                    <div class="canvas-resizer" title="Resize node"></div>
                `;

                // Handle the obsidian-style Interaction Toggle
                const interactBtn = card.querySelector('.canvas-card-interact-btn');
                const shield = card.querySelector('.canvas-iframe-shield');
                
                interactBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Don't trigger canvas drag
                    if (shield.style.pointerEvents === 'none') {
                        // Shield is OFF. Iframe is interactive. Turn shield ON to drag.
                        shield.style.pointerEvents = 'auto';
                        interactBtn.style.color = '';
                        interactBtn.innerText = '🖱️ Interact';
                        card.style.outline = '';
                    } else {
                        // Shield is ON. Cannot click iframe. Turn shield OFF to interact.
                        shield.style.pointerEvents = 'none';
                        interactBtn.style.color = '#00ff41'; // Active color
                        interactBtn.innerText = '🔒 Lock Node';
                        card.style.outline = '2px solid #00ff41';
                    }
                });
            }

            // === UNIVERSAL: Bind window.open() to all Smart Card links ===
            // Chrome Extension new tab pages sandbox native <a target="_blank">,
            // so we must open links programmatically.
            card.querySelectorAll('.smart-card-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(link.href, '_blank');
                });
                // Also stop mousedown from triggering card drag
                link.addEventListener('mousedown', (e) => e.stopPropagation());
            });

            // === UNIVERSAL: Editable title persistence for embed nodes ===
            const embedTitle = card.querySelector('.canvas-card-title[contenteditable]');
            if (embedTitle) {
                embedTitle.addEventListener('mousedown', (e) => e.stopPropagation());
                embedTitle.addEventListener('keydown', (e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') { e.preventDefault(); embedTitle.blur(); }
                });
                embedTitle.addEventListener('blur', () => {
                    // Strip the emoji prefix to save clean title
                    let raw = embedTitle.innerText.replace(/^🌐\s*/, '').trim();
                    const newTitle = raw || hostname;
                    if (nodeData.title !== newTitle) {
                        this._saveHistoryState();
                        nodeData.title = newTitle;
                        this._saveData();
                    }
                });
            }

        } else if (nodeData.type === 'group') {
            card.innerHTML = `
                <div class="canvas-group-header">
                    <input type="text" class="canvas-group-label" value="${nodeData.label || 'Group'}">
                    <span class="canvas-group-delete canvas-card-delete" role="button" aria-label="Delete group" title="Delete group">&times;</span>
                </div>
                <div class="canvas-resizer" title="Resize group"></div>
            `;

            // Group label editing
            const labelInput = card.querySelector('.canvas-group-label');
            labelInput.addEventListener('mousedown', e => e.stopPropagation());
            labelInput.addEventListener('keydown', e => e.stopPropagation()); // Prevent canvas shortcuts stealing focus
            labelInput.addEventListener('blur', () => {
                if (nodeData.label !== labelInput.value) {
                    this._saveHistoryState();
                    nodeData.label = labelInput.value;
                    this._saveData();
                }
            });
        }
        
        // === NODE RESIZING (Groups & Embeds) ===
        const resizer = card.querySelector('.canvas-resizer');
        if (resizer) {
            resizer.addEventListener('mousedown', (e) => {
                e.stopPropagation(); // Prevent card drag
                this._saveHistoryState();
                this.draggedNodeId = nodeData.id;
                
                let startX = e.clientX;
                let startY = e.clientY;
                let startW = nodeData.width || (nodeData.type === 'group' ? 400 : 320);
                let startH = nodeData.height || (nodeData.type === 'group' ? 300 : 240);

                if (nodeData.type === 'embed') {
                    card.classList.add('is-dragging'); // Disable iframe pointer events during resize
                }

                const onResizeMove = (moveEvent) => {
                    const dx = (moveEvent.clientX - startX) / this.transform.scale;
                    const dy = (moveEvent.clientY - startY) / this.transform.scale;
                    
                    nodeData.width = Math.max(100, startW + dx);
                    nodeData.height = Math.max(60, startH + dy);
                    card.style.width = `${nodeData.width}px`;
                    card.style.height = `${nodeData.height}px`; 
                    card.style.minHeight = `${nodeData.height}px`;
                    
                    // Force refresh edges in real-time if resizing changes port locations significantly
                    this._refreshEdges(); 
                };

                const onResizeUp = () => {
                    window.removeEventListener('mousemove', onResizeMove);
                    window.removeEventListener('mouseup', onResizeUp);
                    this.draggedNodeId = null;
                    if (nodeData.type === 'embed') {
                        card.classList.remove('is-dragging');
                    }
                    this._saveData();
                };

                window.addEventListener('mousemove', onResizeMove);
                window.addEventListener('mouseup', onResizeUp);
            });
        }
        
        if (nodeData.type !== 'file' && nodeData.type !== 'embed' && nodeData.type !== 'group') {
            // Standard text node
            const titleText = nodeData.title || '';
            const bodyText = nodeData.preview || '';
            // Transform wiki-links into clickable spans (preserves innerText for correct save)
            var styledBody = bodyText.replace(
                /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g,
                '<span class="wiki-link" data-note-title="$1">[[$1]]</span>'
            );
            card.innerHTML = `
                <div class="canvas-card-header">
                    <div class="canvas-card-title" contenteditable="true" data-placeholder="Title...">${titleText}</div>
                    <button class="canvas-card-create-note" title="Create a proper note from this text node">+ NOTE</button>
                    <span class="canvas-card-delete" role="button" aria-label="Delete node" title="Delete node">&times;</span>
                </div>
                <div class="canvas-card-body" contenteditable="true" data-placeholder="Write something...">${styledBody}</div>
            `;
        }

        // === SAVE ON BLUR ===
        card.querySelectorAll('[contenteditable="true"]').forEach(el => {
            el.addEventListener('mousedown', e => e.stopPropagation());
            el.addEventListener('blur', () => {
                const newTitle = card.querySelector('.canvas-card-title').innerText;
                const newPreview = card.querySelector('.canvas-card-body').innerText;
                if (nodeData.title !== newTitle || nodeData.preview !== newPreview) {
                    this._saveHistoryState();
                    nodeData.title = newTitle;
                    nodeData.preview = newPreview;
                    this._saveData();
                    this._routeWikiLinks(nodeData.id);
                }
            });
            el.addEventListener('keydown', e => e.stopPropagation());
        });

        // === DELETE BUTTON ===
        const deleteBtn = card.querySelector('.canvas-card-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.selectedNodeIds.has(nodeData.id)) {
                    this.deleteSelectedNodes();
                } else {
                    this.clearSelection();
                    this.selectNode(nodeData.id, false);
                    this.deleteSelectedNodes();
                }
            });
        }

        // === CREATE NOTE BUTTON (text nodes only) ===
        const createNoteBtn = card.querySelector('.canvas-card-create-note');
        if (createNoteBtn) {
            createNoteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Blur any active editing to save current content
                if (document.activeElement && document.activeElement.blur) {
                    document.activeElement.blur();
                }
                this._convertTextNodeToFile(nodeData);
            });
        }

        // === WIKI-LINK CLICK HANDLING ===
        var bodyEl = card.querySelector('.canvas-card-body');
        if (bodyEl) {
            bodyEl.addEventListener('mousedown', function(e) {
                var wikiLink = e.target.closest('.wiki-link');
                if (!wikiLink) return;
                e.preventDefault();
                var noteTitle = wikiLink.getAttribute('data-note-title');
                if (!noteTitle) return;
                // Find matching note by title (case-insensitive)
                var targetNote = window.State.NOTES.find(function(n) {
                    return (n.title || '').toLowerCase() === noteTitle.trim().toLowerCase();
                });
                if (targetNote && window.Notes) {
                    // Blur contenteditable to save any pending edits
                    if (document.activeElement && document.activeElement.blur) {
                        document.activeElement.blur();
                    }
                    window.Notes.open(targetNote.id);
                }
            });
        }

        // === CONTEXT MENU (COLORS) ===
        card.addEventListener('contextmenu', (e) => {
            if (e.target.closest('input') || e.target.closest('[contenteditable]')) return;
            e.preventDefault();
            this._showContextMenu(e.clientX, e.clientY, nodeData);
        });

        // === DRAG / EDGE CREATION ===
        card.addEventListener('mousedown', (e) => {
            if (e.target.closest('[contenteditable]') || e.target.closest('.canvas-card-delete') || e.target.closest('input') || e.target.closest('.canvas-card-file-open') || e.target.closest('a')) return;
            e.stopPropagation();

            // Bring to Front (UX Improvement)
            if (nodeData.type !== 'group') {
                let maxZ = 1;
                document.querySelectorAll('.canvas-card:not(.canvas-group)').forEach(c => {
                    const z = parseInt(window.getComputedStyle(c).zIndex) || 1;
                    if (z > maxZ) maxZ = z;
                });
                card.style.zIndex = maxZ + 1;
                nodeData.zIndex = maxZ + 1;
            }

            // Selection Logic (with Cmd/Ctrl for toggling multi-select)
            const isMeta = e.metaKey || e.ctrlKey;
            if (isMeta) {
                if (this.selectedNodeIds.has(nodeData.id)) {
                    this.deselectNode(nodeData.id);
                } else {
                    this.selectNode(nodeData.id, true);
                }
            } else {
                if (!this.selectedNodeIds.has(nodeData.id)) {
                    this.clearSelection();
                    this.selectNode(nodeData.id, false);
                }
            }

            // SHIFT+DRAG = Draw edge (disable for groups)
            if (e.shiftKey && nodeData.type !== 'group') {
                this._startEdgeDraw(nodeData, e);
                return;
            }

            // Normal drag (moves all selected nodes)
            this.draggedNodeId = nodeData.id;
            card.style.cursor = 'grabbing';
            if (nodeData.type === 'embed') {
                card.classList.add('is-dragging'); // Allows drag over iframe
            }

            let startX = e.clientX;
            let startY = e.clientY;

            // Build set of nodes to move
            const nodesToMove = new Set();
            const noteDataObj = this._getActiveNote();
            
            if (this.selectedNodeIds.has(nodeData.id)) {
                this.selectedNodeIds.forEach(id => {
                    const n = noteDataObj.canvasData.nodes.find(item => item.id === id);
                    if (n) nodesToMove.add(n);
                });
            } else {
                nodesToMove.add(nodeData);
            }
            
            // Gather children of any group in the nodesToMove set (spatial grouping)
            const childrenSet = new Set();
            nodesToMove.forEach(n => {
                if (n.type === 'group' && noteDataObj && noteDataObj.canvasData && noteDataObj.canvasData.nodes) {
                    const gRect = { left: n.x, right: n.x + n.width, top: n.y, bottom: n.y + n.height };
                    noteDataObj.canvasData.nodes.forEach(item => {
                        if (item.id === n.id || item.type === 'group') return;
                        if (nodesToMove.has(item)) return; // Already moving
                        const cx = item.x + (item.width || 200) / 2;
                        const cy = item.y + (item.height || 80) / 2;
                        if (cx >= gRect.left && cx <= gRect.right && cy >= gRect.top && cy <= gRect.bottom) {
                            childrenSet.add(item);
                        }
                    });
                }
            });

            // Flag to track if actual dragging occurred for history
            let hasMoved = false;

            // Apply dragging classes for visual lift transition
            nodesToMove.forEach(n => {
                const el = document.getElementById(`canvas-node-${n.id}`);
                if (el) el.classList.add('is-dragging');
            });
            childrenSet.forEach(n => {
                const el = document.getElementById(`canvas-node-${n.id}`);
                if (el) el.classList.add('is-dragging');
            });

            const onMouseMove = (moveEvent) => {
                const dx = (moveEvent.clientX - startX) / this.transform.scale;
                const dy = (moveEvent.clientY - startY) / this.transform.scale;

                if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
                    if (!hasMoved) {
                        hasMoved = true;
                        if (this._saveHistoryState) this._saveHistoryState();
                    }
                }

                // Move selected nodes
                nodesToMove.forEach(n => {
                    n.x += dx;
                    n.y += dy;
                    const el = document.getElementById(`canvas-node-${n.id}`);
                    if (el) {
                        el.style.left = `${n.x}px`;
                        el.style.top = `${n.y}px`;
                    }
                });

                // Move children of selected groups
                childrenSet.forEach(n => {
                    n.x += dx;
                    n.y += dy;
                    const el = document.getElementById(`canvas-node-${n.id}`);
                    if (el) {
                        el.style.left = `${n.x}px`;
                        el.style.top = `${n.y}px`;
                    }
                });

                // Re-route connected edges in real-time
                this._refreshEdges();

                // Update backlinks panel position if a file node is being dragged
                if (this._backlinksPanel && this._backlinksFileNodeId) {
                    this._updateBacklinksPosition();
                }

                startX = moveEvent.clientX;
                startY = moveEvent.clientY;
            };

            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                card.style.cursor = '';
                
                // Remove dragging classes
                nodesToMove.forEach(n => {
                    const el = document.getElementById(`canvas-node-${n.id}`);
                    if (el) el.classList.remove('is-dragging');
                });
                childrenSet.forEach(n => {
                    const el = document.getElementById(`canvas-node-${n.id}`);
                    if (el) el.classList.remove('is-dragging');
                });

                this._saveData();
                this._updateMinimap();
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });

        this.board.appendChild(card);
    },

    // Convert BlockEditor blocks to rendered HTML for file node cards
    _blocksToHtml: function(blocks) {
        const tagMap = { h1:'h1', h2:'h2', h3:'h3', h4:'h4', h5:'h5', h6:'h6', p:'p', blockquote:'blockquote' };
        let html = '';
        for (const b of blocks) {
            const content = b.content || '';
            if (tagMap[b.type]) {
                html += `<${tagMap[b.type]}>${content}</${tagMap[b.type]}>`;
            } else if (b.type === 'list') {
                html += `<ul><li>${content}</li></ul>`;
            } else if (b.type === 'task') {
                const checked = b.checked ? 'checked disabled' : 'disabled';
                html += `<div class="task-line"><input type="checkbox" ${checked}> ${content}</div>`;
            } else if (b.type === 'code') {
                html += `<pre><code>${content.replace(/</g, '&lt;')}</code></pre>`;
            } else if (b.type === 'divider') {
                html += '<hr>';
            } else if (b.type === 'table') {
                html += `<div style="color:#555;font-size:0.7rem;">[Table]</div>`;
            } else {
                html += `<p>${content}</p>`;
            }
        }
        return html;
    },

    _startEdgeDraw: function(nodeData, e) {
        this.isDrawingEdge = true;
        this.edgeStartNodeId = nodeData.id;

        // Start from center (will snap to port on commit)
        const x1 = nodeData.x + (nodeData.width || 200) / 2;
        const y1 = nodeData.y + (nodeData.height || 80) / 2;

        this.tempEdge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.tempEdge.setAttribute('stroke', 'var(--main-color, #00ff41)');
        this.tempEdge.setAttribute('stroke-width', '2');
        this.tempEdge.setAttribute('stroke-dasharray', '6,4');
        this.tempEdge.setAttribute('fill', 'none');
        this.tempEdge.setAttribute('opacity', '0.6');
        this.tempEdge.setAttribute('marker-end', 'url(#canvas-arrowhead)');
        this.svgLayer.appendChild(this.tempEdge);

        const onMouseMoveEdge = (moveEvent) => {
            const rect = this.container.getBoundingClientRect();
            const targetX = (moveEvent.clientX - rect.left - this.transform.x) / this.transform.scale;
            const targetY = (moveEvent.clientY - rect.top - this.transform.y) / this.transform.scale;

            // Use port on source side
            const fromPort = this._getPortToward(nodeData, targetX, targetY);
            const tension = Math.abs(targetX - fromPort.x) * 0.4;
            const d = `M ${fromPort.x} ${fromPort.y} C ${fromPort.x + tension} ${fromPort.y}, ${targetX - tension} ${targetY}, ${targetX} ${targetY}`;
            this.tempEdge.setAttribute('d', d);
        };

        const onMouseUpEdge = (upEvent) => {
            window.removeEventListener('mousemove', onMouseMoveEdge);
            window.removeEventListener('mouseup', onMouseUpEdge);
            this.isDrawingEdge = false;

            if (this.tempEdge) {
                this.tempEdge.remove();
                this.tempEdge = null;
            }

            const dropTarget = upEvent.target.closest('.canvas-card');
            if (dropTarget && dropTarget.id !== `canvas-node-${this.edgeStartNodeId}`) {
                const toNodeId = dropTarget.id.replace('canvas-node-', '');
                this._saveHistoryState();
                const newEdge = {
                    id: 'edge_' + Date.now(),
                    fromNode: this.edgeStartNodeId,
                    toNode: toNodeId,
                    label: '',
                    color: 'var(--main-color, #00ff41)'
                };
                var note = this._getActiveNote();
                if (note && note.canvasData) {
                    if (!note.canvasData.edges) note.canvasData.edges = [];
                    note.canvasData.edges.push(newEdge);
                    this._saveData();
                    this.renderEdge(newEdge);
                }
            }
            this.edgeStartNodeId = null;
        };

        window.addEventListener('mousemove', onMouseMoveEdge);
        window.addEventListener('mouseup', onMouseUpEdge);
    },

    // ─── EDGE RENDERING ───

    // === PORT CALCULATION ===
    _getPortToward: function(nodeData, tx, ty) {
        const w = nodeData.width || 200;
        const h = nodeData.height || 80;
        const cx = nodeData.x + w / 2;
        const cy = nodeData.y + h / 2;

        const ports = {
            right:  { x: nodeData.x + w, y: cy },
            left:   { x: nodeData.x,     y: cy },
            bottom: { x: cx, y: nodeData.y + h },
            top:    { x: cx, y: nodeData.y }
        };

        let best = null;
        let bestDist = Infinity;
        for (const key in ports) {
            const p = ports[key];
            const d = Math.hypot(tx - p.x, ty - p.y);
            if (d < bestDist) { bestDist = d; best = p; }
        }
        return best;
    },

    _getAutoPorts: function(fromNode, toNode) {
        const fw = fromNode.width || 200, fh = fromNode.height || 80;
        const tw = toNode.width || 200, th = toNode.height || 80;
        const fcx = fromNode.x + fw / 2, fcy = fromNode.y + fh / 2;
        const tcx = toNode.x + tw / 2, tcy = toNode.y + th / 2;

        const fromPorts = [
            { x: fromNode.x + fw, y: fcy },  // right
            { x: fromNode.x,      y: fcy },  // left
            { x: fcx, y: fromNode.y + fh },   // bottom
            { x: fcx, y: fromNode.y }          // top
        ];
        const toPorts = [
            { x: toNode.x + tw, y: tcy },
            { x: toNode.x,      y: tcy },
            { x: tcx, y: toNode.y + th },
            { x: tcx, y: toNode.y }
        ];

        let best = { from: fromPorts[0], to: toPorts[0] };
        let bestDist = Infinity;
        for (const fp of fromPorts) {
            for (const tp of toPorts) {
                const d = Math.hypot(tp.x - fp.x, tp.y - fp.y);
                if (d < bestDist) { bestDist = d; best = { from: fp, to: tp }; }
            }
        }
        return best;
    },

    renderEdge: function(edge) {
        if (!window.State.NOTES) return;
        const note = this._getActiveNote();
        if (!note || !note.canvasData || !note.canvasData.nodes) return;

        const fromNode = note.canvasData.nodes.find(n => n.id === edge.fromNode);
        const toNode = note.canvasData.nodes.find(n => n.id === edge.toNode);
        if (!fromNode || !toNode) return;

        // Auto-port: find nearest pair of sides
        const ports = this._getAutoPorts(fromNode, toNode);
        const x1 = ports.from.x, y1 = ports.from.y;
        const x2 = ports.to.x, y2 = ports.to.y;

        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        const tension = Math.max(dx, dy) * 0.4;

        // Determine control point direction based on which ports were chosen
        const dirX = x2 > x1 ? 1 : -1;
        const dirY = y2 > y1 ? 1 : -1;
        const isHorizontal = dx > dy;

        let d;
        if (isHorizontal) {
            d = `M ${x1} ${y1} C ${x1 + tension * dirX} ${y1}, ${x2 - tension * dirX} ${y2}, ${x2} ${y2}`;
        } else {
            d = `M ${x1} ${y1} C ${x1} ${y1 + tension * dirY}, ${x2} ${y2 - tension * dirY}, ${x2} ${y2}`;
        }

        // Create or update path
        let path = document.getElementById(`edge-${edge.id}`);
        if (!path) {
            path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.id = `edge-${edge.id}`;
            path.classList.add('canvas-edge');
            path.setAttribute('stroke', edge.color || 'var(--main-color, #00ff41)');
            path.setAttribute('fill', 'none');

            if (edge.isWikiLink) {
                // Wiki-link routed edges: dashed and dimmer to distinguish from manual edges
                path.setAttribute('stroke-width', '1.5');
                path.setAttribute('opacity', '0.5');
                path.setAttribute('stroke-dasharray', '5,3');
                path.setAttribute('marker-end', 'url(#canvas-arrowhead-dim)');
            } else {
                path.setAttribute('stroke-width', '2');
                path.setAttribute('opacity', '0.7');
                path.setAttribute('marker-end', 'url(#canvas-arrowhead)');
            }
            path.style.pointerEvents = 'stroke';
            path.style.cursor = 'pointer';
            this.svgLayer.appendChild(path);

            // Click to select/delete edge
            path.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (confirm('Delete this connection?')) {
                    this._deleteEdge(edge.id);
                }
            });

            // Double-click to edit label
            path.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this._editEdgeLabel(edge, x1, y1, x2, y2);
            });
        }
        path.setAttribute('d', d);

        // Render label at midpoint
        this._renderEdgeLabel(edge, x1, y1, x2, y2);
    },

    _renderEdgeLabel: function(edge, x1, y1, x2, y2) {
        const labelId = `edge-label-${edge.id}`;
        let labelEl = document.getElementById(labelId);

        if (!edge.label) {
            if (labelEl) labelEl.remove();
            return;
        }

        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;

        if (!labelEl) {
            labelEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            labelEl.id = labelId;
            labelEl.classList.add('canvas-edge-label');
            labelEl.setAttribute('text-anchor', 'middle');
            labelEl.setAttribute('fill', '#aaa');
            labelEl.setAttribute('font-size', '11');
            labelEl.setAttribute('font-family', 'monospace');
            labelEl.style.pointerEvents = 'all';
            labelEl.style.cursor = 'pointer';
            this.svgLayer.appendChild(labelEl);

            labelEl.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this._editEdgeLabel(edge, x1, y1, x2, y2);
            });
        }
        labelEl.setAttribute('x', mx);
        labelEl.setAttribute('y', my - 8);
        labelEl.textContent = edge.label;
    },

    _editEdgeLabel: function(edge, x1, y1, x2, y2) {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;

        // Convert board coords to screen coords
        const screenX = mx * this.transform.scale + this.transform.x;
        const screenY = my * this.transform.scale + this.transform.y;
        const containerRect = this.container.getBoundingClientRect();

        const input = document.createElement('input');
        input.type = 'text';
        input.value = edge.label || '';
        input.placeholder = 'Label...';
        input.style.cssText = `
            position: absolute;
            left: ${screenX + containerRect.left - 60}px;
            top: ${screenY + containerRect.top - 14}px;
            width: 120px;
            padding: 4px 8px;
            background: #111;
            color: var(--main-color, #00ff41);
            border: 1px solid var(--main-color, #00ff41);
            border-radius: 3px;
            font-size: 11px;
            font-family: monospace;
            text-align: center;
            z-index: 30000;
            outline: none;
        `;
        document.body.appendChild(input);
        input.focus();
        input.select();

        const save = () => {
            edge.label = input.value.trim();
            input.remove();
            this._saveData();
            this.renderEdge(edge);
        };

        input.onblur = save;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { input.remove(); }
        };
    },

    _deleteEdge: function(edgeId) {
        this._saveHistoryState();
        const note = this._getActiveNote();
        if (!note || !note.canvasData) return;

        note.canvasData.edges = note.canvasData.edges.filter(e => e.id !== edgeId);

        // Remove SVG elements
        const path = document.getElementById(`edge-${edgeId}`);
        if (path) path.remove();
        const label = document.getElementById(`edge-label-${edgeId}`);
        if (label) label.remove();

        this._saveData();
    },

    // ─── WIKI-LINK AUTO-ROUTING ───

    _routeWikiLinks: function(textNodeId, createFileNodes) {
        if (createFileNodes === undefined) createFileNodes = true;

        var note = this._getActiveNote();
        if (!note || !note.canvasData || !note.canvasData.nodes) return;

        const textNode = note.canvasData.nodes.find(n => n.id === textNodeId);
        if (!textNode) return;

        // Parse [[Note Title]] or [[Note Title|Display Label]]
        var wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        var match;
        var changed = false;

        while ((match = wikiLinkRegex.exec(textNode.preview || '')) !== null) {
            var linkTarget = match[1].trim();
            if (!linkTarget) continue;

            // Find matching note by title (case-insensitive)
            var targetNote = window.State.NOTES.find(function(n) {
                return n.id !== this.activeNoteId && (n.title || '').toLowerCase() === linkTarget.toLowerCase();
            }.bind(this));
            if (!targetNote) continue;

            // Check if a file node already exists for this note
            var existingFileNode = note.canvasData.nodes.find(function(n) {
                return n.type === 'file' && n.linkedNoteId === targetNote.id;
            });

            var fileNode = existingFileNode;

            // Create a file node if allowed and none exists
            if (!fileNode && createFileNodes) {
                var textNodeRight = (textNode.x || 0) + (textNode.width || 200) + 60;
                var textNodeCenterY = (textNode.y || 0) + Math.max(((textNode.height || 80) / 2) - 40, 0);

                fileNode = {
                    id: 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    type: 'file',
                    linkedNoteId: targetNote.id,
                    title: targetNote.title || 'Untitled',
                    preview: '',
                    x: textNodeRight,
                    y: textNodeCenterY,
                    width: 240,
                    height: 160
                };

                note.canvasData.nodes.push(fileNode);
                this.addCard(fileNode);
                changed = true;
            }

            if (!fileNode) continue;

            // Check if an edge already exists between text node and file node
            var existingEdge = (note.canvasData.edges || []).find(function(e) {
                return e.fromNode === textNode.id && e.toNode === fileNode.id;
            });

            if (!existingEdge) {
                if (!note.canvasData.edges) note.canvasData.edges = [];
                var newEdge = {
                    id: 'edge_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    fromNode: textNode.id,
                    toNode: fileNode.id,
                    label: '',
                    color: 'var(--main-color, #00ff41)',
                    isWikiLink: true
                };
                note.canvasData.edges.push(newEdge);
                this.renderEdge(newEdge);
                changed = true;
            }
        }

        if (changed) {
            // Update backlinks badges for any file nodes affected
            var self = this;
            (note.canvasData.nodes || []).forEach(function(n) {
                if (n.type === 'file') {
                    self._updateBacklinksBadge(n.id);
                }
            });
            this.updateUI();
            this._saveData();
        }
    },

    _refreshEdges: function() {
        var note = this._getActiveNote();
        if (!note || !note.canvasData || !note.canvasData.edges) return;
        // Fix: clear existing lines first so deleted ones disappear
        this.svgLayer.innerHTML = '';
        note.canvasData.edges.forEach(edge => this.renderEdge(edge));
    },

    _showContextMenu: function(x, y, nodeData) {
        // remove existing
        const existing = document.getElementById('canvas-context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.className = 'canvas-context-menu';
        menu.id = 'canvas-context-menu';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;            // Only show Create Note option for text nodes (no type, or not file/embed/group)
            var isTextNode = !nodeData.type || (nodeData.type !== 'file' && nodeData.type !== 'embed' && nodeData.type !== 'group');
            menu.innerHTML = `
                <div class="canvas-context-item" id="ctx-create-note" style="display:${isTextNode ? 'block' : 'none'};">Create Note</div>
                <div class="canvas-context-item" id="ctx-delete">Delete Node</div>
                <div class="canvas-color-picker">
                    <div class="canvas-color-swatch" style="background:var(--main-color);" data-color="default"></div>
                    <div class="canvas-color-swatch" style="background:#ff3366;" data-color="red"></div>
                    <div class="canvas-color-swatch" style="background:#ffcc00;" data-color="yellow"></div>
                    <div class="canvas-color-swatch" style="background:#00ff41;" data-color="green"></div>
                    <div class="canvas-color-swatch" style="background:#00e5ff;" data-color="blue"></div>
                    <div class="canvas-color-swatch" style="background:#b82bf2;" data-color="purple"></div>
                </div>
            `;
        menu.style.zIndex = '35000'; // Ensure above everything
        document.body.appendChild(menu);

        // Events
        if (isTextNode) {
            menu.querySelector('#ctx-create-note').onclick = () => {
                if (document.activeElement && document.activeElement.blur) {
                    document.activeElement.blur();
                }
                this._convertTextNodeToFile(nodeData);
                menu.remove();
            };
        }
        menu.querySelector('#ctx-delete').onclick = () => {
            const cardDeleteBtn = document.querySelector(`#canvas-node-${nodeData.id} .canvas-card-delete`);
            if (cardDeleteBtn) cardDeleteBtn.click();
            menu.remove();
        };

        menu.querySelectorAll('.canvas-color-swatch').forEach(swatch => {
            swatch.onclick = () => {
                this._saveHistoryState();
                const color = swatch.getAttribute('data-color');
                nodeData.color = color;
                const card = document.getElementById(`canvas-node-${nodeData.id}`);
                if (card) {
                    if (color === 'default') card.removeAttribute('data-color');
                    else card.setAttribute('data-color', color);
                }
                this._saveData();
                menu.remove();
            };
        });

        // Close on outside click
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('mousedown', closeHandler);
                }
            };
            document.addEventListener('mousedown', closeHandler);
        }, 50);
    },

    // ─── BACKLINKS ───

    _updateBacklinks: function() {
        this._closeBacklinks();

        if (this.selectedNodeIds.size !== 1) return;

        var note = this._getActiveNote();
        if (!note || !note.canvasData) return;

        const selectedNodeData = note.canvasData.nodes.find(n => n.id === this.selectedNodeId);
        if (!selectedNodeData || selectedNodeData.type !== 'file') return;

        this._showBacklinks(this.selectedNodeId);
    },

    _showBacklinks: function(fileNodeId) {
        function esc(str) {
            return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        var note = this._getActiveNote();
        if (!note || !note.canvasData || !note.canvasData.edges) return;

        const fileNode = note.canvasData.nodes.find(n => n.id === fileNodeId);
        if (!fileNode) return;

        // Find all edges pointing to this file node
        var backlinkEdges = note.canvasData.edges.filter(function(e) {
            return e.toNode === fileNodeId;
        });

        if (backlinkEdges.length === 0) return;

        // Create backlinks panel
        var panel = document.createElement('div');
        panel.id = 'canvas-backlinks-panel';
        panel.className = 'canvas-backlinks-panel';
        this._backlinksPanel = panel;
        this._backlinksFileNodeId = fileNodeId;

        // Position to the right of the file node
        var fileCard = document.getElementById('canvas-node-' + fileNodeId);
        var fileRect = fileCard ? fileCard.getBoundingClientRect() : null;

        var html = '<div class="canvas-backlinks-header">' +
            '<span class="canvas-backlinks-title">BACKLINKS</span>' +
            '<span class="canvas-backlinks-close" id="canvas-backlinks-close">&times;</span>' +
            '</div>' +
            '<div class="canvas-backlinks-count">' + backlinkEdges.length + ' connection' +
            (backlinkEdges.length !== 1 ? 's' : '') + '</div>' +
            '<div class="canvas-backlinks-list">';

        var self = this;
        backlinkEdges.forEach(function(edge) {
            var sourceNode = note.canvasData.nodes.find(function(n) {
                return n.id === edge.fromNode;
            });
            if (!sourceNode) return;

            var sourceTitle = sourceNode.title || 'Untitled';
            // Find the wiki-link text in the source node preview
            var linkText = '';
            var bodyText = sourceNode.preview || '';
            var linkMatch = bodyText.match(/\[\[([^\]]+)\]\]/);
            if (linkMatch) {
                linkText = linkMatch[0];
            }
            var snippet = linkText ? '... ' + linkText + ' ...' : '';

            html += '<div class="canvas-backlinks-item" data-source-id="' + esc(sourceNode.id) + '">' +
                '<div class="canvas-backlinks-item-title">' + esc(sourceTitle) + '</div>' +
                (snippet ? '<div class="canvas-backlinks-item-snippet">' + esc(snippet) + '</div>' : '') +
                '</div>';
        });

        html += '</div>';
        panel.innerHTML = html;

        // Position panel
        document.body.appendChild(panel);

        // Set position based on file node location
        if (fileRect) {
            panel.style.left = (fileRect.right + 10) + 'px';
            panel.style.top = fileRect.top + 'px';
        } else {
            panel.style.left = '100px';
            panel.style.top = '100px';
        }

        // Adjust if off-screen
        setTimeout(function() {
            var panelRect = panel.getBoundingClientRect();
            if (panelRect.right > window.innerWidth) {
                panel.style.left = (window.innerWidth - panelRect.width - 10) + 'px';
            }
            if (panelRect.bottom > window.innerHeight) {
                panel.style.top = (window.innerHeight - panelRect.height - 10) + 'px';
            }
        }, 10);

        // Close button
        document.getElementById('canvas-backlinks-close').addEventListener('click', function(e) {
            e.stopPropagation();
            self._closeBacklinks();
        });

        // Click on backlink item → select that text node and scroll to it
        panel.querySelectorAll('.canvas-backlinks-item').forEach(function(item) {
            item.addEventListener('mousedown', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var sourceId = item.getAttribute('data-source-id');
                if (sourceId) {
                    self.clearSelection();
                    self.selectNode(sourceId, false);
                    // Scroll the source node into view
                    var sourceCard = document.getElementById('canvas-node-' + sourceId);
                    if (sourceCard) {
                        sourceCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            });
        });

        // Close when clicking outside
        setTimeout(function() {
            var closeHandler = function(e) {
                if (!panel.contains(e.target)) {
                    self._closeBacklinks();
                    document.removeEventListener('mousedown', closeHandler);
                }
            };
            document.addEventListener('mousedown', closeHandler);
        }, 50);
    },

    _closeBacklinks: function() {
        if (this._backlinksPanel) {
            this._backlinksPanel.remove();
            this._backlinksPanel = null;
            this._backlinksFileNodeId = null;
        }
    },

    _updateBacklinksPosition: function() {
        if (!this._backlinksPanel || !this._backlinksFileNodeId) return;
        var fileCard = document.getElementById('canvas-node-' + this._backlinksFileNodeId);
        if (!fileCard) return;
        var rect = fileCard.getBoundingClientRect();
        this._backlinksPanel.style.left = (rect.right + 10) + 'px';
        this._backlinksPanel.style.top = rect.top + 'px';
        // Re-check offscreen bounds
        var panelRect = this._backlinksPanel.getBoundingClientRect();
        if (panelRect.right > window.innerWidth) {
            this._backlinksPanel.style.left = (window.innerWidth - panelRect.width - 10) + 'px';
        }
        if (panelRect.bottom > window.innerHeight) {
            this._backlinksPanel.style.top = (window.innerHeight - panelRect.height - 10) + 'px';
        }
    },

    _convertTextNodeToFile: function(nodeData) {
        var note = this._getActiveNote();
        if (!note || !note.canvasData) return;

        this._saveHistoryState();

        // Create a new note in State.NOTES
        var title = nodeData.title || 'Untitled';
        var content = nodeData.preview || '';

        var newNote = {
            id: 'note_' + Date.now(),
            title: title,
            content: content,
            created: Date.now(),
            modified: Date.now()
        };

        if (!window.State.NOTES) window.State.NOTES = [];
        window.State.NOTES.push(newNote);

        // Convert the canvas node from text to file node
        nodeData.type = 'file';
        nodeData.linkedNoteId = newNote.id;
        nodeData.title = title;
        nodeData.preview = '';

        // Remove old card and re-render with the same ID
        var oldCard = document.getElementById('canvas-node-' + nodeData.id);
        if (oldCard) oldCard.remove();

        this.addCard(nodeData);
        this.selectNode(nodeData.id, false);

        // Save and update
        this._saveData();
        this._refreshEdges();
        this.updateUI();

        // Update backlinks badges
        this._updateBacklinksBadge(nodeData.id);
    },

    _updateBacklinksBadge: function(fileNodeId) {
        var note = this._getActiveNote();
        if (!note || !note.canvasData) return;
        var count = (note.canvasData.edges || []).filter(function(e) {
            return e.toNode === fileNodeId;
        }).length;
        var badge = document.getElementById('backlinks-badge-' + fileNodeId);
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count + '';
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }
};
