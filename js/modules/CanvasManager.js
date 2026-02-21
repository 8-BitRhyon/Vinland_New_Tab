export const CanvasManager = {
    container: null,
    transform: { x: 0, y: 0, scale: 1 },
    isDragging: false,
    dragStart: { x: 0, y: 0 },

    init: function(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;
        
        this.board = document.createElement('div');
        this.board.className = 'canvas-board';
        this.container.appendChild(this.board);

        this.bindEvents();
    },

    bindEvents: function() {
        // Space + Click to Pan
        this.container.addEventListener('mousedown', (e) => {
            if (e.button === 1 || (e.button === 0 && e.shiftKey)) { // Middle click or Shift+Click to pan
                this.isDragging = true;
                this.dragStart = { x: e.clientX - this.transform.x, y: e.clientY - this.transform.y };
                this.container.style.cursor = 'grabbing';
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            this.transform.x = e.clientX - this.dragStart.x;
            this.transform.y = e.clientY - this.dragStart.y;
            this.updateTransform();
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
            this.container.style.cursor = 'default';
        });

        // Scroll to Zoom
        this.container.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const zoomIntensity = 0.1;
                const wheel = e.deltaY < 0 ? 1 : -1;
                const zoom = Math.exp(wheel * zoomIntensity);
                this.transform.scale *= zoom;
                this.updateTransform();
            }
        });
    },

    updateTransform: function() {
        this.board.style.transform = `translate(${this.transform.x}px, ${this.transform.y}px) scale(${this.transform.scale})`;
    },

    addCard: function(noteId, x, y) {
        // Renders a read-only preview of a note onto the canvas
        const card = document.createElement('div');
        card.className = 'canvas-card';
        card.style.transform = `translate(${x}px, ${y}px)`;
        // Load note content via PageManager...
        this.board.appendChild(card);
    }
};
