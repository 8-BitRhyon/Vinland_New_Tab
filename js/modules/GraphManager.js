
import { State } from '../core/Store.js';
import { ModalManager } from '../ui/ModalManager.js';
import { Notes } from './NotesController.js';

export const GraphManager = {
    simulation: null,
    svg: null,
    width: 0,
    height: 0,
    containerId: 'graph-container', // Matches HTML
    
    init: function() {
        // Initial setup if needed
    },

    open: function() {
        ModalManager.open('graph-modal');
        // V61: Longer delay + safety fallback to ensure layout is ready
        setTimeout(() => {
            this.render();
        }, 300);
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
        var nodes = validNotes.map(n => ({
            id: n.id,
            name: n.title,
            type: 'note',
            group: n.path.split('/')[1] || 'root',
            val: 1
        }));

        // Add Boards if available
        if (typeof window.BOARDS !== 'undefined' && Array.isArray(window.BOARDS)) {
            window.BOARDS.forEach(b => {
                 nodes.push({ id: b.id, name: b.title, type: 'board', group: 'BOARD', val: 2 });
            });
        }

        console.log('[Graph] Nodes:', nodes.length);

        var links = [];
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
                    // Check if both exist in nodes
                    var sourceExists = nodes.some(n => n.id === source.id);
                    var targetExists = nodes.some(n => n.id === target.id);
                    
                    if (sourceExists && targetExists) {
                         // Avoid duplicates
                        var exists = links.some(l => (l.source === source.id && l.target === target.id));
                        if (!exists) links.push({ source: source.id, target: target.id });
                    }
                }
            }
            
            // Note-to-Board links
            if (source.blocks) {
                source.blocks.forEach(block => {
                    if (block.type === 'kanban_ref' && block.boardId) {
                        if (nodes.some(n => n.id === block.boardId)) {
                             links.push({ source: source.id, target: block.boardId });
                        }
                    }
                });
            }
        });

        console.log('[Graph] Links:', links.length);

        // 2. D3 Simulation
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
            .force("charge", d3.forceManyBody().strength(-200))
            .force("center", d3.forceCenter(this.width / 2, this.height / 2))
            .force('collision', d3.forceCollide().radius(50));

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
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));

        node.append("circle")
            .attr("r", d => d.type === 'board' ? 8 : 6)
            .attr("fill", d => d.type === 'board' ? 'var(--board-color, #ff9900)' : 'var(--main-color, #00ff41)')
            .attr("class", d => (Notes && d.id === Notes.activeNoteId) ? 'active' : '');

        node.append("text")
            .text(d => d.name)
            .attr('x', 12)
            .attr('y', 4)
            .style("font-size", "10px")
            .style("fill", "#ccc")
            .style("pointer-events", "none"); // Prevent text blocking clicks
            
        // 3. Build Adjacency List for fast traversal
        this.adjacencyList = new Map();
        nodes.forEach(n => this.adjacencyList.set(n.id, []));
        links.forEach(l => {
            // Note: D3 replaces source/target with objects after simulation starts, 
            // but initially they are IDs. We handle both just in case.
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

        var self = this;
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
