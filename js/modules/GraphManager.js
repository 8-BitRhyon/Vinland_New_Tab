
import { State } from '../core/Store.js';
import { ModalManager } from '../ui/ModalManager.js';
import { Notes } from './NotesController.js';

export const GraphManager = {
    simulation: null,
    svg: null,
    width: 0,
    height: 0,
    containerId: 'graph-container',
    isLocalMode: false, // V87: Local Focus Mode state

    init: function() {
        // Initial setup if needed
    },

    open: function() {
        ModalManager.open('graph-modal');
        
        // Ensure the button text matches the current state (in case PageActions changed it)
        var toggleBtn = document.getElementById('graph-mode-toggle');
        if (toggleBtn) {
            var self = this;
            toggleBtn.textContent = this.isLocalMode ? 'LOCAL' : 'GLOBAL';
            toggleBtn.classList.toggle('active', this.isLocalMode);
            toggleBtn.onclick = function() { self.toggleLocalMode(); };
        }
        
        // Render after modal animation
        setTimeout(() => {
            this.render();
        }, 300);
    },

    // V87: Toggle between Global and Local (1-degree neighbor) view
    toggleLocalMode: function() {
        this.isLocalMode = !this.isLocalMode;
        var btn = document.getElementById('graph-mode-toggle');
        if (btn) {
            btn.textContent = this.isLocalMode ? 'LOCAL' : 'GLOBAL';
            btn.classList.toggle('active', this.isLocalMode);
        }
        this.render();
    },

    // V87: Helper — calculate node radius from degree
    getNodeRadius: function(node) {
        var base = node.type === 'board' ? 8 : 5;
        return base + (Math.sqrt(node.degree || 0) * 3);
    },

    render: function() {
        console.log('[Graph] Render called');
        var container = document.getElementById(this.containerId);
        if (!container) return;
        
        if (typeof d3 === 'undefined') {
            console.error('[Graph] D3 is undefined!');
            container.innerHTML = '<div style="color:red; padding:20px;">Error: D3 Library not loaded.<br>Please check internet connection or index.html</div>';
            return;
        }

        container.innerHTML = '';
        // V61: Fallback dimensions if container is not layouted yet
        this.width = container.clientWidth || 1200;
        this.height = container.clientHeight || 800;
        console.log('[Graph] Dimensions:', this.width, 'x', this.height);

        // 1. Prepare Data
        var validNotes = State.NOTES.filter(n => n.title && n.title !== 'Untitled');
        
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

        console.log('[Graph] Nodes:', nodes.length, '| Links:', links.length, '| Mode:', this.isLocalMode ? 'LOCAL' : 'GLOBAL');

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

        this.svg = d3.select('#' + this.containerId).append("svg")
            .attr("width", '100%')
            .attr("height", '100%')
            .attr('viewBox', [0, 0, this.width, this.height])
            .call(d3.zoom().on("zoom", function (event) {
                g.attr("transform", event.transform);
            }))
            .append("g");
            
        var g = this.svg;

        this.simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(links).id(d => d.id).distance(100))
            .force("charge", d3.forceManyBody().strength(-300)) // V87: Stronger repulsion for larger nodes
            .force("center", d3.forceCenter(this.width / 2, this.height / 2))
            .force('collision', d3.forceCollide().radius(function(d) {
                return self.getNodeRadius(d) + 5; // V87: Dynamic collision + padding
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

        // V87: Dynamic radius + cluster color
        node.append("circle")
            .attr("r", function(d) { return self.getNodeRadius(d); })
            .attr("fill", function(d) { return getColor(d.group); })
            .attr("class", function(d) { return (Notes && d.id === Notes.activeNoteId) ? 'active' : ''; })
            .attr("stroke", "#000")
            .attr("stroke-width", "1.5px");

        // V87: Scale text size slightly for high-degree nodes
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

        node.on('mouseover', (event, d) => {
            // 1. BFS to find all connected nodes (Full Chain)
            var connectedNodeIds = new Set();
            var queue = [d.id];
            connectedNodeIds.add(d.id);

            while (queue.length > 0) {
                var currentId = queue.shift();
                var neighbors = self.adjacencyList.get(currentId) || [];
                
                neighbors.forEach(neighborId => {
                    if (!connectedNodeIds.has(neighborId)) {
                        connectedNodeIds.add(neighborId);
                        queue.push(neighborId);
                    }
                });
            }

            // 2. Highlight Nodes (Full Chain)
            node.classed('highlighted', n => connectedNodeIds.has(n.id));
            node.select('circle').classed('highlighted', n => connectedNodeIds.has(n.id));
            node.select('text').classed('highlighted', n => connectedNodeIds.has(n.id));

            // 3. Highlight Links (Between any highlighted nodes)
            link.classed('highlighted', l => {
                const s = l.source.id || l.source;
                const t = l.target.id || l.target;
                return connectedNodeIds.has(s) && connectedNodeIds.has(t);
            });
            
            // 4. Dim the Rest
            node.classed('dimmed', n => !connectedNodeIds.has(n.id));
            link.classed('dimmed', l => {
                const s = l.source.id || l.source;
                const t = l.target.id || l.target;
                return !(connectedNodeIds.has(s) && connectedNodeIds.has(t));
            });

        }).on('mouseout', function () {
            // Reset All
            node.classed('highlighted', false).classed('dimmed', false);
            node.select('circle').classed('highlighted', false);
            node.select('text').classed('highlighted', false);
            link.classed('highlighted', false).classed('dimmed', false);
        }).on('click', function(event, d) {
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
            event.subject.fx = null;
            event.subject.fy = null;
        }
    }
};
