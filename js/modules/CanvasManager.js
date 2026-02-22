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

    init: function() {
        this.container = document.getElementById('canvas-container');
        console.log('[CanvasManager] init() — container found:', !!this.container);
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

        // Zoom label reference
        this.zoomLabel = this.toolbar.querySelector('#canvas-zoom-label');

        this.bindToolbar();
        this.bindEvents();
    },

    load: function(noteId) {
        console.log('[CanvasManager] load() — noteId:', noteId, '| board:', !!this.board, '| container:', !!this.container);
        
        // Anti-Race Condition: Self-initialize if not ready
        if (!this.container || !this.board) {
            console.log('[CanvasManager] Auto-initializing to prevent race condition.');
            this.init();
        }
        
        this.activeNoteId = noteId;
        const note = window.State.NOTES.find(n => n.id === noteId);
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

        // Clear existing nodes
        if (this.board) {
            this.board.querySelectorAll('.canvas-card').forEach(n => n.remove());
            this.svgLayer.innerHTML = '';
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
        setTimeout(() => this.updateUI(), 50);

        // Feature 6: Minimap
        this._initMinimap();
        this._updateMinimap();
    },

    updateUI: function() {
        const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
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

            const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
            if (note && note.canvasData) {
                if (!note.canvasData.nodes) note.canvasData.nodes = [];
                note.canvasData.nodes.push(newNode);
                this.addCard(newNode);
                if (window.saveData) window.saveData();
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
    },

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

        const self = this;
        const allNotes = (window.State.NOTES || []).filter(n => n.type !== 'canvas' && n.id !== this.activeNoteId);

        const renderList = (filter) => {
            list.innerHTML = '';
            const filtered = filter
                ? allNotes.filter(n => (n.title || '').toLowerCase().includes(filter.toLowerCase()))
                : allNotes;

            filtered.slice(0, 15).forEach(n => {
                const item = document.createElement('div');
                item.className = 'canvas-note-picker-item';
                item.textContent = n.title || 'Untitled';
                item.addEventListener('click', () => {
                    self._addFileNode(n.id);
                    self._closeNotePicker();
                });
                list.appendChild(item);
            });

            if (filtered.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'padding:8px;color:#555;font-size:0.75rem;text-align:center;';
                empty.textContent = 'No notes found';
                list.appendChild(empty);
            }
        };

        renderList('');
        search.addEventListener('input', () => renderList(search.value));

        document.body.appendChild(picker);
        search.focus();

        // Close on outside click
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!picker.contains(e.target)) {
                    self._closeNotePicker();
                    document.removeEventListener('mousedown', closeHandler);
                }
            };
            document.addEventListener('mousedown', closeHandler);
        }, 50);
    },

    _closeNotePicker: function() {
        const existing = document.getElementById('canvas-note-picker');
        if (existing) existing.remove();
    },

    _showUrlPicker: function(screenX, screenY) {
        this._closeUrlPicker();

        const picker = document.createElement('div');
        picker.className = 'canvas-note-picker'; // Reuse same styling as note picker
        picker.id = 'canvas-url-picker';
        picker.style.left = screenX + 'px';
        picker.style.top = screenY + 'px';
        picker.style.position = 'fixed';
        picker.style.width = '300px';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Paste YouTube or Website URL...';
        input.style.width = '100%';
        picker.appendChild(input);

        const self = this;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const url = input.value.trim();
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
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!picker.contains(e.target)) {
                    self._closeUrlPicker();
                    document.removeEventListener('mousedown', closeHandler);
                }
            };
            document.addEventListener('mousedown', closeHandler);
        }, 50);
    },

    _closeUrlPicker: function() {
        const existing = document.getElementById('canvas-url-picker');
        if (existing) existing.remove();
    },

    _addFileNode: function(linkedNoteId) {
        const linkedNote = window.State.NOTES.find(n => n.id === linkedNoteId);
        if (!linkedNote) return;

        const rect = this.container.getBoundingClientRect();
        const cx = (rect.width / 2 - this.transform.x) / this.transform.scale;
        const cy = (rect.height / 2 - this.transform.y) / this.transform.scale;

        const newNode = {
            id: 'node_' + Date.now(),
            type: 'file',
            linkedNoteId: linkedNoteId,
            title: linkedNote.title || 'Untitled',
            preview: '',
            x: cx - 120,
            y: cy - 60,
            width: 240,
            height: 160
        };

        const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
        if (note && note.canvasData) {
            if (!note.canvasData.nodes) note.canvasData.nodes = [];
            note.canvasData.nodes.push(newNode);
            this.addCard(newNode);
            if (window.saveData) window.saveData();
            this.updateUI();
        }
    },

    _addEmbedNode: function(url) {
        const rect = this.container.getBoundingClientRect();
        const cx = (rect.width / 2 - this.transform.x) / this.transform.scale;
        const cy = (rect.height / 2 - this.transform.y) / this.transform.scale;

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

        const newNode = {
            id: 'node_' + Date.now(),
            type: 'embed',
            url: embedUrl,
            title: new URL(embedUrl).hostname.replace('www.', ''),
            x: cx - 160,
            y: cy - 100,
            width: 320,
            height: 240
        };

        const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
        if (note && note.canvasData) {
            if (!note.canvasData.nodes) note.canvasData.nodes = [];
            note.canvasData.nodes.push(newNode);
            this.addCard(newNode);
            if (window.saveData) window.saveData();
            this.updateUI();
        }
    },

    _addGroupNode: function() {
        const rect = this.container.getBoundingClientRect();
        const cx = (rect.width / 2 - this.transform.x) / this.transform.scale;
        const cy = (rect.height / 2 - this.transform.y) / this.transform.scale;

        const newNode = {
            id: 'node_' + Date.now(),
            type: 'group',
            label: 'New Group',
            x: cx - 200,
            y: cy - 150,
            width: 400,
            height: 300,
            color: 'default' // Add optional color property
        };

        const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
        if (note && note.canvasData) {
            if (!note.canvasData.nodes) note.canvasData.nodes = [];
            // Push group to beginning of array so it renders behind text/file/embed nodes
            note.canvasData.nodes.unshift(newNode);
            
            // Re-render entire canvas to ensure z-indexing / DOM order is correct
            this.load(this.activeNoteId);
            if (window.saveData) window.saveData();
            
            // UX / Bugfix: Auto-focus the label to prevent the +Button from retaining focus
            // and being accidentally triggered again by Enter/Space.
            setTimeout(() => {
                const el = document.getElementById(`canvas-node-${newNode.id}`);
                if (el) {
                    const input = el.querySelector('.canvas-group-label');
                    if (input) {
                        input.focus();
                        input.select();
                    }
                }
            }, 60);
        }
    },

    bindEvents: function() {
        if (!this.container) return;

        // === KEYBOARD SHORTCUTS & PAN STATE ===
        let isSpacePressed = false;
        window.addEventListener('keydown', (e) => {
            const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
            
            // Shift + 1 = Zoom to Fit
            if (e.shiftKey && e.key === '!' && !isInput) {
                e.preventDefault();
                this.zoomToFit();
                return;
            }

            if (e.code === 'Space' && !isInput) {
                isSpacePressed = true;
                this.container.style.cursor = 'grab';
                e.preventDefault(); // Prevent page scroll
                return;
            }

            // FEATURE: Keyboard Spawning (Tab / Enter)
            if (this.selectedNodeId && (e.key === 'Tab' || (!e.shiftKey && e.key === 'Enter'))) {
                // If we are typing, it should be the input of the SELECTED node, otherwise ignore.
                if (isInput) {
                    const activeCard = e.target.closest('.canvas-card, .canvas-group');
                    if (!activeCard || activeCard.id !== `canvas-node-${this.selectedNodeId}`) return;
                }

                e.preventDefault(); // Prevent standard tabbing/newline
                
                // Unfocus current text if needed
                if (document.activeElement && document.activeElement.blur) {
                    document.activeElement.blur();
                }

                const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
                if (!note || !note.canvasData) return;

                const parentNode = note.canvasData.nodes.find(n => n.id === this.selectedNodeId);
                if (!parentNode) return;

                // Create new generic text node
                const newNode = {
                    id: 'node_' + Date.now(),
                    title: '',
                    preview: '',
                    width: 200,
                    height: 80
                };

                if (e.key === 'Tab') {
                    // Spawn child to the right
                    newNode.x = parentNode.x + (parentNode.width || 200) + 60;
                    newNode.y = parentNode.y;
                } else if (e.key === 'Enter') {
                    // Spawn sibling below
                    newNode.x = parentNode.x;
                    newNode.y = parentNode.y + (parentNode.height || 80) + 60;
                }

                note.canvasData.nodes.push(newNode);

                // If Tab, draw edge from parent to child
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

                this.selectedNodeId = newNode.id;
                this.addCard(newNode);
                
                if (e.key === 'Tab') {
                    this._refreshEdges();
                }

                if (window.saveData) window.saveData();

                // Select the new node and focus its body text
                document.querySelectorAll('.canvas-card.selected-node, .canvas-group.selected-node').forEach(el => el.classList.remove('selected-node'));
                const newCard = document.getElementById(`canvas-node-${newNode.id}`);
                if (newCard) {
                    newCard.classList.add('selected-node');
                    // setTimeout to allow DOM insertion settling
                    setTimeout(() => {
                        const bodyContent = newCard.querySelector('.canvas-card-body');
                        if (bodyContent) {
                            bodyContent.focus();
                            // Place cursor at end if needed, but it's empty so focus is fine
                        }
                    }, 50);
                }
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                isSpacePressed = false;
                this.container.style.cursor = '';
            }
        });

        // === PAN: Spacebar-drag or Middle-click drag ===
        this.container.addEventListener('mousedown', (e) => {
            // Only allow background drag or Spacebar/Middle-click drag
            const isBgClick = !e.target.closest('.canvas-card') && !e.target.closest('.canvas-toolbar') && !e.target.closest('#canvas-note-picker');
            
            if (isBgClick) {
                // Clear selection
                document.querySelectorAll('.canvas-card.selected-node, .canvas-group.selected-node').forEach(el => el.classList.remove('selected-node'));
                this.selectedNodeId = null;
            }

            if (isBgClick || isSpacePressed || e.button === 1) {
                e.preventDefault();
                this.isPanning = true;
                this.dragStart = { x: e.clientX - this.transform.x, y: e.clientY - this.transform.y };
                this.container.style.cursor = 'grabbing';
            }
        });

        // === DOUBLE CLICK: Create node ===
        this.container.addEventListener('dblclick', (e) => {
            if (e.target.closest('.canvas-card') || e.target.closest('.canvas-toolbar')) return;
            const rect = this.container.getBoundingClientRect();
            const x = (e.clientX - rect.left - this.transform.x) / this.transform.scale;
            const y = (e.clientY - rect.top - this.transform.y) / this.transform.scale;

            const newNode = {
                id: 'node_' + Date.now(),
                title: '',
                preview: '',
                x: x - 100,
                y: y - 40,
                width: 200,
                height: 80
            };

            const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
            if (note && note.canvasData) {
                if (!note.canvasData.nodes) note.canvasData.nodes = [];
                note.canvasData.nodes.push(newNode);
                this.addCard(newNode);
                if (window.saveData) window.saveData();
                this.updateUI();
            }
        });

        // === GLOBAL MOUSE MOVE: Panning + Edge re-rendering ===
        window.addEventListener('mousemove', (e) => {
            if (this.isPanning) {
                this.transform.x = e.clientX - this.dragStart.x;
                this.transform.y = e.clientY - this.dragStart.y;
                this.updateTransform();
                return;
            }

            if (this.draggedNodeId) {
                const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
                if (!note || !note.canvasData || !note.canvasData.edges) return;

                note.canvasData.edges.forEach(edge => {
                    if (edge.fromNode === this.draggedNodeId || edge.toNode === this.draggedNodeId) {
                        this.renderEdge(edge);
                    }
                });
            }
        });

        // === GLOBAL MOUSE UP ===
        window.addEventListener('mouseup', () => {
            if (this.isPanning) {
                this.isPanning = false;
                this.container.style.cursor = isSpacePressed ? 'grab' : '';
                this._saveViewport();
            }
            this.draggedNodeId = null;
        });

        // === ZOOM & PAN (Trackpad / Mouse Wheel) ===
        this.container.addEventListener('wheel', (e) => {
            e.preventDefault();

            if (e.ctrlKey || e.metaKey) {
                // PINCH TO ZOOM / MOUSE WHEEL ZOOM
                const rect = this.container.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                // Zoom intensity relative to scroll delta
                const zoomFactor = Math.pow(0.995, e.deltaY);
                const newScale = Math.max(0.1, Math.min(5, this.transform.scale * zoomFactor));

                // Calculate offset to zoom *into* the cursor position
                this.transform.x = mouseX - (mouseX - this.transform.x) * (newScale / this.transform.scale);
                this.transform.y = mouseY - (mouseY - this.transform.y) * (newScale / this.transform.scale);
                this.transform.scale = newScale;
                
            } else {
                // TWO-FINGER PANNING (Trackpad)
                this.transform.x -= e.deltaX;
                this.transform.y -= e.deltaY;
            }
            
            this.updateTransform();
            this.updateUI();
            
            // Debounce save viewport to avoid localstorage spam during swipe
            clearTimeout(this._wheelSaveTimeout);
            this._wheelSaveTimeout = setTimeout(() => this._saveViewport(), 300);

        }, { passive: false });
    },

    _saveViewport: function() {
        const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
        if (note && note.canvasData) {
            note.canvasData.viewport = { x: this.transform.x, y: this.transform.y, scale: this.transform.scale };
            if (window.saveData) window.saveData();
        }
    },

    zoomToFit: function() {
        const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
        if (!note || !note.canvasData || !note.canvasData.nodes || note.canvasData.nodes.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        note.canvasData.nodes.forEach(n => {
            const w = n.width || 200;
            const h = n.height || 80;
            if (n.x < minX) minX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.x + w > maxX) maxX = n.x + w;
            if (n.y + h > maxY) maxY = n.y + h;
        });

        const padding = 60; // Extra breathing room
        const contentWidth = (maxX - minX) + (padding * 2);
        const contentHeight = (maxY - minY) + (padding * 2);
        
        const rect = this.container.getBoundingClientRect();
        const scaleX = rect.width / contentWidth;
        const scaleY = rect.height / contentHeight;
        
        let newScale = Math.min(scaleX, scaleY);
        newScale = Math.max(0.1, Math.min(2, newScale)); // Cap scale between 10% and 200%

        // Center point of nodes
        const centerX = minX + (maxX - minX) / 2;
        const centerY = minY + (maxY - minY) / 2;

        // Calculate offset to place center of nodes at center of screen
        this.transform.scale = newScale;
        this.transform.x = (rect.width / 2) - (centerX * newScale);
        this.transform.y = (rect.height / 2) - (centerY * newScale);

        this.updateTransform();
        this.updateUI();
        this._saveViewport();

        // Optional UX: flash the canvas grid to show transition
        this.container.style.transition = 'background-position 0.3s ease';
        setTimeout(() => this.container.style.transition = '', 300);
    },

    // ==========================================
    // MINIMAP
    // ==========================================

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
        const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
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
                    <button class="canvas-card-file-open" title="Open in Editor">OPEN</button>
                    <span class="canvas-card-delete" title="Delete node">&times;</span>
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

        } else if (nodeData.type === 'embed') {
            card.classList.add('embed-node');
            
            let renderUrl = nodeData.url;
            
            // YouTube strictly fails in MV3 locals. Fallback to Smart Card.
            if (renderUrl.includes('youtube')) {
                let displayUrl = renderUrl;
                let videoId = '';
                if (renderUrl.includes('youtube.com/embed/')) {
                    videoId = renderUrl.split('embed/')[1].split('?')[0];
                    displayUrl = `https://www.youtube.com/watch?v=${videoId}`;
                } else if (renderUrl.includes('watch?v=')) {
                    videoId = new URL(renderUrl).searchParams.get('v');
                } else if (renderUrl.includes('youtu.be/')) {
                    videoId = renderUrl.split('youtu.be/')[1].split('?')[0];
                }

                const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : `https://www.google.com/s2/favicons?domain=youtube.com&sz=128`;

                 card.innerHTML = `
                    <div class="canvas-card-header">
                        <div class="canvas-card-title">🌐 YouTube Video</div>
                        <span class="canvas-card-delete" title="Delete node">&times;</span>
                    </div>
                    <div class="canvas-card-smart-body" style="padding: 10px; gap: 10px;">
                        <img src="${thumbnailUrl}" alt="YouTube Thumbnail" style="width: 100%; height: auto; aspect-ratio: 16/9; border-radius: 6px; object-fit: contain; background: #000; box-shadow: 0 4px 12px rgba(0,0,0,0.5);" />
                        <div class="smart-card-details" style="margin-top: 5px;">
                            <a href="${displayUrl}" target="_blank" class="smart-card-link" style="font-size: 0.9rem; font-weight: bold; padding: 4px 10px; background: rgba(255,255,255,0.1); border-radius: 4px; display: inline-block;">▶ Watch on YouTube</a>
                        </div>
                    </div>
                    <div class="canvas-resizer" title="Resize node"></div>
                `;
            } else {
                // For Google Docs and standard sites, render an Obsidian-style protected iframe
                let finalUrl = renderUrl;
                
                // Upgrade legacy read-only sheets to live editors
                if (finalUrl.includes('docs.google.com/') && finalUrl.includes('/preview')) {
                    finalUrl = finalUrl.replace('/preview', '/edit');
                }
                
                const hostname = new URL(finalUrl).hostname.replace('www.', '');
                const title = nodeData.title || hostname;
                
                card.innerHTML = `
                    <div class="canvas-card-header">
                        <div class="canvas-card-title">🌐 ${title}</div>
                        <div class="canvas-card-actions">
                            <button class="canvas-card-interact-btn" title="Toggle Interaction (Obsidian Style)">🖱️ Interact</button>
                            <span class="canvas-card-delete" title="Delete node">&times;</span>
                        </div>
                    </div>
                    <div class="canvas-card-embed-body" style="position: relative;">
                        <iframe src="${finalUrl}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"></iframe>
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

        } else if (nodeData.type === 'group') {
            card.innerHTML = `
                <div class="canvas-group-header">
                    <input type="text" class="canvas-group-label" value="${nodeData.label || 'Group'}">
                    <span class="canvas-group-delete canvas-card-delete" title="Delete group">&times;</span>
                </div>
                <div class="canvas-resizer" title="Resize group"></div>
            `;

            // Group label editing
            const labelInput = card.querySelector('.canvas-group-label');
            labelInput.addEventListener('mousedown', e => e.stopPropagation());
            labelInput.addEventListener('keydown', e => e.stopPropagation()); // Prevent canvas shortcuts stealing focus
            labelInput.addEventListener('blur', () => {
                nodeData.label = labelInput.value;
                if (window.saveData) window.saveData();
            });
        }
        
        // === NODE RESIZING (Groups & Embeds) ===
        const resizer = card.querySelector('.canvas-resizer');
        if (resizer) {
            resizer.addEventListener('mousedown', (e) => {
                e.stopPropagation(); // Prevent card drag
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
                    if (window.saveData) window.saveData();
                };

                window.addEventListener('mousemove', onResizeMove);
                window.addEventListener('mouseup', onResizeUp);
            });
        }
        
        if (nodeData.type !== 'file' && nodeData.type !== 'embed' && nodeData.type !== 'group') {
            // Standard text node
            const titleText = nodeData.title || '';
            const bodyText = nodeData.preview || '';
            card.innerHTML = `
                <div class="canvas-card-header">
                    <div class="canvas-card-title" contenteditable="true" data-placeholder="Title...">${titleText}</div>
                    <span class="canvas-card-delete" title="Delete node">&times;</span>
                </div>
                <div class="canvas-card-body" contenteditable="true" data-placeholder="Write something...">${bodyText}</div>
            `;
        }

        // === SAVE ON BLUR ===
        card.querySelectorAll('[contenteditable="true"]').forEach(el => {
            el.addEventListener('mousedown', e => e.stopPropagation());
            el.addEventListener('blur', () => {
                nodeData.title = card.querySelector('.canvas-card-title').innerText;
                nodeData.preview = card.querySelector('.canvas-card-body').innerText;
                if (window.saveData) window.saveData();
            });
            el.addEventListener('keydown', e => e.stopPropagation());
        });

        // === DELETE BUTTON ===
        const deleteBtn = card.querySelector('.canvas-card-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
                if (note && note.canvasData) {
                    note.canvasData.nodes = note.canvasData.nodes.filter(n => n.id !== nodeData.id);
                    if (note.canvasData.edges) {
                        note.canvasData.edges = note.canvasData.edges.filter(edge => edge.fromNode !== nodeData.id && edge.toNode !== nodeData.id);
                    }
                    if (window.saveData) window.saveData();

                    // Synchronously remove from DOM to prevent ghosts
                    card.remove(); 
                    
                    // Also redraw edges in case this was connected
                    this._refreshEdges();
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
            if (e.target.closest('[contenteditable]') || e.target.closest('.canvas-card-delete') || e.target.closest('input') || e.target.closest('.canvas-card-file-open')) return;
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

            // Set Selected Node Context
            document.querySelectorAll('.canvas-card.selected-node, .canvas-group.selected-node').forEach(el => el.classList.remove('selected-node'));
            card.classList.add('selected-node');
            this.selectedNodeId = nodeData.id;

            // SHIFT+DRAG = Draw edge (disable for groups)
            if (e.shiftKey && nodeData.type !== 'group') {
                this._startEdgeDraw(nodeData, e);
                return;
            }

            // Normal drag
            this.draggedNodeId = nodeData.id;
            card.style.cursor = 'grabbing';
            if (nodeData.type === 'embed') {
                card.classList.add('is-dragging'); // Allows drag over iframe
            }

            let startX = e.clientX;
            let startY = e.clientY;

            // Feature 4: Spatial Grouping - Gather children to move with group
            let childrenToMove = [];
            const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
            if (nodeData.type === 'group' && note && note.canvasData && note.canvasData.nodes) {
                const gRect = { left: nodeData.x, right: nodeData.x + nodeData.width, top: nodeData.y, bottom: nodeData.y + nodeData.height };
                childrenToMove = note.canvasData.nodes.filter(n => {
                    if (n.id === nodeData.id || n.type === 'group') return false;
                    const cx = n.x + (n.width || 200)/2;
                    const cy = n.y + (n.height || 80)/2;
                    return cx >= gRect.left && cx <= gRect.right && cy >= gRect.top && cy <= gRect.bottom;
                });
            }

            const onMouseMove = (moveEvent) => {
                const dx = (moveEvent.clientX - startX) / this.transform.scale;
                const dy = (moveEvent.clientY - startY) / this.transform.scale;

                nodeData.x += dx;
                nodeData.y += dy;
                card.style.left = `${nodeData.x}px`;
                card.style.top = `${nodeData.y}px`;

                // Move spatial group children
                childrenToMove.forEach(child => {
                    child.x += dx;
                    child.y += dy;
                    const childEl = document.getElementById(`canvas-node-${child.id}`);
                    if (childEl) {
                        childEl.style.left = `${child.x}px`;
                        childEl.style.top = `${child.y}px`;
                    }
                });

                // Re-route connected edges in real-time
                this._refreshEdges();

                startX = moveEvent.clientX;
                startY = moveEvent.clientY;
            };

            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                card.style.cursor = '';
                if (nodeData.type === 'embed') card.classList.remove('is-dragging');
                if (window.saveData) window.saveData();
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
                const newEdge = {
                    id: 'edge_' + Date.now(),
                    fromNode: this.edgeStartNodeId,
                    toNode: toNodeId,
                    label: '',
                    color: 'var(--main-color, #00ff41)'
                };
                const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
                if (note && note.canvasData) {
                    if (!note.canvasData.edges) note.canvasData.edges = [];
                    note.canvasData.edges.push(newEdge);
                    if (window.saveData) window.saveData();
                    this.renderEdge(newEdge);
                }
            }
            this.edgeStartNodeId = null;
        };

        window.addEventListener('mousemove', onMouseMoveEdge);
        window.addEventListener('mouseup', onMouseUpEdge);
    },

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
        const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
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
            path.setAttribute('stroke-width', '2');
            path.setAttribute('fill', 'none');
            path.setAttribute('opacity', '0.7');
            path.setAttribute('marker-end', 'url(#canvas-arrowhead)');
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
            if (window.saveData) window.saveData();
            this.renderEdge(edge);
        };

        input.onblur = save;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { input.remove(); }
        };
    },

    _deleteEdge: function(edgeId) {
        const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
        if (!note || !note.canvasData) return;

        note.canvasData.edges = note.canvasData.edges.filter(e => e.id !== edgeId);

        // Remove SVG elements
        const path = document.getElementById(`edge-${edgeId}`);
        if (path) path.remove();
        const label = document.getElementById(`edge-label-${edgeId}`);
        if (label) label.remove();

        if (window.saveData) window.saveData();
    },

    _refreshEdges: function() {
        const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
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
        menu.style.top = `${y}px`;

        menu.innerHTML = `
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
        menu.querySelector('#ctx-delete').onclick = () => {
            const cardDeleteBtn = document.querySelector(`#canvas-node-${nodeData.id} .canvas-card-delete`);
            if (cardDeleteBtn) cardDeleteBtn.click();
            menu.remove();
        };

        menu.querySelectorAll('.canvas-color-swatch').forEach(swatch => {
            swatch.onclick = () => {
                const color = swatch.getAttribute('data-color');
                nodeData.color = color;
                const card = document.getElementById(`canvas-node-${nodeData.id}`);
                if (card) {
                    if (color === 'default') card.removeAttribute('data-color');
                    else card.setAttribute('data-color', color);
                }
                if (window.saveData) window.saveData();
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
    }
};
