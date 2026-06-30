# Spec: Obsidian-Style Canvas Enhancements

## Objective
To extend the current canvas implementation (`CanvasManager` in `js/modules/canvasmanager.js`) to support advanced, productivity-boosting features inspired by Obsidian Canvas. This will allow the user to manage nodes efficiently, perform bulk operations, recover from mistakes, and coordinate spatial workflows.

### User Stories / Acceptance Criteria
1. **Selection Marquee (Lasso Select)**: As a user, I can click and drag on the canvas background to draw a selection marquee. Any nodes intersecting or contained within this marquee should be selected.
2. **Multi-Node Dragging & Deleting**: As a user, when I drag one selected node, all other selected nodes move with it by the same offset. Pressing `Delete` or `Backspace` deletes all selected nodes and their connecting edges.
3. **Clipboard Actions (Copy/Paste/Duplicate)**: As a user, I can copy selected nodes (`Cmd+C` / `Ctrl+C`), paste them (`Cmd+V` / `Ctrl+V`) under my current cursor position, and duplicate them directly (`Cmd+D` / `Ctrl+D`).
4. **Undo/Redo History**: As a user, I can press `Cmd+Z` / `Ctrl+Z` to undo any canvas action (moving, resizing, deleting, grouping, styling, connecting) and `Cmd+Y` / `Ctrl+Y` or `Cmd+Shift+Z` to redo.
5. **Polished Grouping UX**: As a user, dragging a group card moves all items visually inside it. Group labels can be double-clicked to rename, and their custom colors apply cleanly to their borders and background.

---

## Tech Stack
*   **Core**: Vanilla HTML5, CSS3, and ES6 Javascript.
*   **Libraries**: Standard browser APIs (DOM, SVG, pointer/mouse events). No external canvas frameworks (e.g., Fabric.js or PixiJS) to keep performance fast and lightweight.
*   **Persistence**: Note-level JSON serialization stored in `State.NOTES[x].canvasData`.

---

## Commands
*   **Dev Server**: Run the local web extension development environment.
*   **Testing**: Since it is a client-side Chrome Extension module, verification will be performed through:
    1. Interactive testing in the browser extension runtime.
    2. Debugger evaluation of state persistence in local storage.

---

## Project Structure
*   `js/modules/canvasmanager.js` -> Main canvas controller and event processor.
*   `index.html` -> CSS rules for `.canvas-selection-marquee`, `.canvas-card.selected-node`, and related visual styling.
*   `canvas_obsidian_features_spec.md` -> This specification file.

---

## Code Style
The code must follow the existing patterns in `canvasmanager.js` (vanilla ES6, object literal notation, manual DOM updates, and direct manipulation of `State.NOTES` variables followed by `window.saveData()` updates).

Example pattern for adding a multi-node operation:
```javascript
// Clean, declarative multi-node translation
translateSelectedNodes: function(dx, dy) {
    const note = window.State.NOTES.find(n => n.id === this.activeNoteId);
    if (!note || !note.canvasData || !note.canvasData.nodes) return;
    
    note.canvasData.nodes.forEach(node => {
        if (this.selectedNodeIds.has(node.id)) {
            node.x += dx;
            node.y += dy;
            const el = document.getElementById(`canvas-node-${node.id}`);
            if (el) {
                el.style.left = `${node.x}px`;
                el.style.top = `${node.y}px`;
            }
        }
    });
    this._refreshEdges();
}
```

---

## Testing Strategy
*   **Manual Verification**:
    - Draw a selection marquee on empty space and ensure multiple nodes are selected.
    - Drag a selected node; verify all selected nodes shift together and align correctly.
    - Copy selected nodes, move the mouse cursor to a new location, and paste. Confirm nodes are cloned with clean coordinates and their configurations are persisted.
    - Move nodes, resize them, add connections, and delete them. Verify `Cmd+Z` rolls back the exact action, and `Cmd+Y` restores it.
*   **State Integrity**:
    - Check browser LocalStorage to verify that `canvasData` matches the live state of the nodes and connections after copy, paste, delete, and undo/redo operations.

---

## Boundaries
*   **Always**: Update `window.saveData()` after mutating canvas data. Sync the minimap viewport layout on transform/state changes. Limit history stack size to prevent memory bloat (e.g., max 50 states).
*   **Ask First**: Modifying standard note routing triggers inside `notescontroller.js`.
*   **Never**: Overwrite the entire `State.NOTES` array during undo/redo operations (only modify `canvasData` properties of the active note).

---

## Success Criteria
- [ ] Bounding-box selection marquee functions via mouse drag on background.
- [ ] Multiple nodes can be dragged simultaneously without offset drift or glitches.
- [ ] Node duplicate (`Cmd+D`) creates offset clones. Copy (`Cmd+C`) and Paste (`Cmd+V`) duplicates nodes under the cursor.
- [ ] Undo (`Cmd+Z`) and Redo (`Cmd+Y` / `Cmd+Shift+Z`) revert node moves, resizes, deletions, edits, colors, and line connections.
- [ ] Group cards move children in their bounding boxes on drag.
- [ ] Styles and states are successfully persisted to `localStorage` via the existing `window.saveData()`.

---

## Open Questions
1. Should edges (connections) between two copied nodes also be duplicated when pasted? *(Recommendation: Yes, duplicate connections if both the source and target nodes are part of the copy selection.)*
2. Should we support selection of connection lines (edges) to delete them with the delete key? *(Recommendation: Focus on node deletion first. Keep edge deletion on context-menu click for this phase to simplify lasso selection logic.)*
3. For the Undo/Redo stack: should we save history state continuously on dragging, or only once dragging finishes (on mouse up)? *(Recommendation: Save history state on mouse up to avoid bloating the history stack during dragging.)*
