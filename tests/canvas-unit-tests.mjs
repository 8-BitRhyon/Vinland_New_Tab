/**
 * Vinland CanvasManager - Unit Tests
 *
 * Tests pure-logic extracts from CanvasManager covering:
 * - Undo/redo history stack (save, undo, redo, cap at 50, empty, full cycle)
 * - Clipboard copy (empty selection, single node, multi-node, edges between selected)
 * - Duplicate selected nodes (empty selection, single node, multi-node, edges preserved)
 * - Viewport persistence (save/restore/replace)
 * - Zoom-to-fit math (bounding box, scale, translate, capping)
 *
 * Run with: node tests/canvas-unit-tests.mjs
 * (aggregated by tests/run-all.mjs)
 */

import assert from 'node:assert/strict';

// ============================================================
// FUNCTION EXTRACTS (pure data operations from CanvasManager)
// ============================================================

function historySave(historyStack, redoStack, canvasData) {
    var stack = historyStack.slice();
    var redo = [];
    var stateCopy = JSON.parse(JSON.stringify(canvasData));
    stack.push(stateCopy);
    if (stack.length > 50) {
        stack.shift();
    }
    return { historyStack: stack, redoStack: redo };
}

function historyUndo(historyStack, redoStack, canvasData) {
    if (historyStack.length === 0) return null;

    var stack = historyStack.slice();
    var redo = redoStack.slice();
    var currentState = JSON.parse(JSON.stringify(canvasData));
    redo.push(currentState);

    var previousState = stack.pop();
    return { historyStack: stack, redoStack: redo, canvasData: previousState };
}

function historyRedo(historyStack, redoStack, canvasData) {
    if (redoStack.length === 0) return null;

    var stack = historyStack.slice();
    var redo = redoStack.slice();
    var currentState = JSON.parse(JSON.stringify(canvasData));
    stack.push(currentState);

    var nextState = redo.pop();
    return { historyStack: stack, redoStack: redo, canvasData: nextState };
}

function clipboardCopy(nodes, edges, selectedIds) {
    var selectedSet = new Set(selectedIds);
    var clonedNodes = [];
    var clonedEdges = [];

    nodes.forEach(function(n) {
        if (selectedSet.has(n.id)) {
            clonedNodes.push(JSON.parse(JSON.stringify(n)));
        }
    });

    if (edges) {
        edges.forEach(function(e) {
            if (selectedSet.has(e.fromNode) && selectedSet.has(e.toNode)) {
                clonedEdges.push(JSON.parse(JSON.stringify(e)));
            }
        });
    }

    if (clonedNodes.length === 0) return null;
    return { nodes: clonedNodes, edges: clonedEdges };
}

function clipboardDuplicate(nodes, edges, selectedIds) {
    var selectedSet = new Set(selectedIds);
    if (selectedSet.size === 0) return { newNodes: [], newEdges: [] };

    var idMap = {};
    var newNodes = [];

    nodes.forEach(function(n) {
        if (selectedSet.has(n.id)) {
            var oldId = n.id;
            var newId = 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            idMap[oldId] = newId;

            var cloned = JSON.parse(JSON.stringify(n));
            cloned.id = newId;
            cloned.x += 24;
            cloned.y += 24;
            newNodes.push(cloned);
        }
    });

    var newEdges = [];
    if (edges) {
        edges.forEach(function(e) {
            if (selectedSet.has(e.fromNode) && selectedSet.has(e.toNode)) {
                var clonedEdge = JSON.parse(JSON.stringify(e));
                clonedEdge.id = 'edge_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                clonedEdge.fromNode = idMap[e.fromNode];
                clonedEdge.toNode = idMap[e.toNode];
                newEdges.push(clonedEdge);
            }
        });
    }

    return { newNodes: newNodes, newEdges: newEdges };
}

// ============================================================
// VIEWPORT PERSISTENCE (_saveViewport)
// ============================================================

function saveViewportToNote(note, transform) {
    if (note && note.canvasData) {
        note.canvasData.viewport = { x: transform.x, y: transform.y, scale: transform.scale };
    }
    return note;
}

// ============================================================
// ZOOM-TO-FIT MATH (zoomToFit)
// ============================================================

function computeZoomToFit(nodes, containerWidth, containerHeight) {
    if (!nodes || nodes.length === 0) return null;

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function(n) {
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

    if (contentWidth <= 0 || contentHeight <= 0) return null;

    var scaleX = containerWidth / contentWidth;
    var scaleY = containerHeight / contentHeight;

    var newScale = Math.min(scaleX, scaleY);
    newScale = Math.max(0.1, Math.min(2, newScale));

    var centerX = minX + (maxX - minX) / 2;
    var centerY = minY + (maxY - minY) / 2;

    var newX = (containerWidth / 2) - (centerX * newScale);
    var newY = (containerHeight / 2) - (centerY * newScale);

    return { scale: newScale, x: newX, y: newY };
}

// ============================================================
// TEST RUNNER
// ============================================================

var passed = 0;
var failed = 0;
var errors = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  \u2713 ' + name);
    } catch (e) {
        failed++;
        errors.push({ name: name, error: e.message });
        console.log('  \u2717 ' + name);
        console.log('    \u2192 ' + e.message);
    }
}

// ─── Fixture helpers ────────────────────────────────────────

function makeNode(id, x, y) {
    return { id: id, title: id, x: x || 100, y: y || 100, width: 200, height: 80 };
}

function makeEdge(id, from, to, label) {
    return { id: id, fromNode: from, toNode: to, fromPort: 'right', toPort: 'left', label: label || '' };
}

// ============================================================
// TESTS
// ============================================================

// ─── HISTORY STACK ─────────────────────────────────────────

console.log('\n\u2500\u2500\u2500 History: _saveHistoryState() \u2500\u2500\u2500');

test('saves a snapshot of canvasData onto the stack', function() {
    var stack = [];
    var redoStack = [];
    var data = { nodes: [{ id: 'a', x: 10 }], edges: [] };

    var result = historySave(stack, redoStack, data);
    assert.equal(result.historyStack.length, 1);
    assert.deepEqual(result.historyStack[0], data);
    assert.deepEqual(result.redoStack, [], 'redo stack should be cleared');
});

test('deep copies the canvasData (mutation does not affect saved state)', function() {
    var stack = [];
    var redoStack = [];
    var data = { nodes: [{ id: 'a', x: 10 }], edges: [] };

    var result = historySave(stack, redoStack, data);
    data.nodes[0].x = 999;
    assert.equal(result.historyStack[0].nodes[0].x, 10, 'saved copy should not mutate');
});

test('caps history stack at 50 entries', function() {
    var stack = [];
    var redoStack = [];
    var data = { nodes: [], edges: [] };

    for (var i = 0; i < 60; i++) {
        data.nodes[0] = { id: 'n' + i, x: i };
        var result = historySave(stack, redoStack, data);
        stack = result.historyStack;
        redoStack = result.redoStack;
    }
    assert.equal(stack.length, 50, 'stack should be capped at 50');
    // Oldest entry should have been shifted out
    assert.equal(stack[0].nodes[0].id, 'n10', 'oldest entry should be n10 (10th saved)');
    assert.equal(stack[49].nodes[0].id, 'n59', 'newest entry should be n59');
});

test('clears the redo stack on save', function() {
    var stack = [];
    var redoStack = ['some_old_state'];
    var data = { nodes: [], edges: [] };

    var result = historySave(stack, redoStack, data);
    assert.equal(result.redoStack.length, 0, 'redo stack must be cleared');
});

console.log('\n\u2500\u2500\u2500 History: undo() \u2500\u2500\u2500');

test('undo returns null when history stack is empty', function() {
    var result = historyUndo([], [], { nodes: [], edges: [] });
    assert.equal(result, null);
});

test('undo restores previous state and pushes current to redo stack', function() {
    var stack = [];
    var redoStack = [];
    var state = { nodes: [{ id: 'a', val: 1 }], edges: [] };

    // Save state A (before Action 1)
    var r = historySave(stack, redoStack, state);
    stack = r.historyStack;

    // Action 1: mutate state
    state.nodes[0].val = 2;

    // Save state B (before Action 2)
    r = historySave(stack, redoStack, state);
    stack = r.historyStack;

    // Action 2: mutate state
    state.nodes[0].val = 3;

    // Now state = { val: 3 }, stack = [A, B]
    // Undo restores B (the state before Action 2)
    var undoResult = historyUndo(stack, redoStack, state);
    assert.notEqual(undoResult, null);
    assert.equal(undoResult.historyStack.length, 1, 'one entry popped');
    assert.equal(undoResult.redoStack.length, 1, 'current state pushed to redo');
    assert.equal(undoResult.canvasData.nodes[0].val, 2, 'should restore state B (val=2)');
    // The redo stack entry should be the "current" state (val=3)
    assert.equal(undoResult.redoStack[0].nodes[0].val, 3);
});

test('undo returns null when called on empty stack (no prior save)', function() {
    var result = historyUndo([], [], { nodes: [], edges: [] });
    assert.equal(result, null);
});

test('undo multiple steps restores progressively older states', function() {
    var stack = [];
    var redoStack = [];
    var state = { nodes: [{ id: 'x', val: 0 }], edges: [] };

    // Save state 0 (before action 1)
    var r = historySave(stack, redoStack, state);
    stack = r.historyStack;

    // Action 1: val 0 → 1
    state.nodes[0].val = 1;

    // Save state 1 (before action 2)
    r = historySave(stack, redoStack, state);
    stack = r.historyStack;

    // Action 2: val 1 → 2
    state.nodes[0].val = 2;

    // Save state 2 (before action 3)
    r = historySave(stack, redoStack, state);
    stack = r.historyStack;

    // Action 3: val 2 → 3
    state.nodes[0].val = 3;

    // Stack = [s0, s1, s2], state = { val: 3 }
    // Undo 1: restore s2 (val=2)
    var u1 = historyUndo(stack, redoStack, state);
    assert.equal(u1.canvasData.nodes[0].val, 2);
    assert.equal(u1.historyStack.length, 2, 'stack has [s0, s1]');

    // Undo 2: restore s1 (val=1)
    var u2 = historyUndo(u1.historyStack, u1.redoStack, u1.canvasData);
    assert.equal(u2.canvasData.nodes[0].val, 1);
    assert.equal(u2.historyStack.length, 1, 'stack has [s0]');

    // Undo 3: restore s0 (val=0)
    var u3 = historyUndo(u2.historyStack, u2.redoStack, u2.canvasData);
    assert.equal(u3.canvasData.nodes[0].val, 0);
    assert.equal(u3.historyStack.length, 0, 'stack is empty');

    // Undo on empty stack
    var u4 = historyUndo(u3.historyStack, u3.redoStack, u3.canvasData);
    assert.equal(u4, null);
});

console.log('\n\u2500\u2500\u2500 History: redo() \u2500\u2500\u2500');

test('redo returns null when redo stack is empty', function() {
    var result = historyRedo([], [], { nodes: [], edges: [] });
    assert.equal(result, null);
});

test('redo restores state from redo stack', function() {
    var stack = [];
    var redoStack = [];
    var state = { nodes: [{ id: 'a', val: 1 }], edges: [] };

    // Save state A (before action 1)
    var r = historySave(stack, redoStack, state);
    stack = r.historyStack;

    // Action 1: val 1 → 2
    state.nodes[0].val = 2;

    // Save state B (before action 2)
    r = historySave(stack, redoStack, state);
    stack = r.historyStack;

    // Action 2: val 2 → 3
    state.nodes[0].val = 3;

    // Stack = [A, B], state = { val: 3 }

    // Undo: restore B (val=2)
    var undoResult = historyUndo(stack, redoStack, state);
    assert.equal(undoResult.canvasData.nodes[0].val, 2, 'undo restores val=2');
    assert.equal(undoResult.historyStack.length, 1, 'undo: stack=[A]');
    assert.equal(undoResult.redoStack.length, 1, 'undo: redo=[C(val=3)]');

    // Redo: restore C (val=3)
    var redoResult = historyRedo(undoResult.historyStack, undoResult.redoStack, undoResult.canvasData);
    assert.notEqual(redoResult, null);
    assert.equal(redoResult.canvasData.nodes[0].val, 3);
    // Redo pushes current state to history and pops from redo
    assert.equal(redoResult.historyStack.length, 2, 'redo: stack=[A, B]');
    assert.equal(redoResult.redoStack.length, 0, 'redo: empty');
});

test('full undo-redo-undo cycle preserves consistency', function() {
    var stack = [];
    var redoStack = [];
    var state = { nodes: [{ id: 'a', val: 'initial' }], edges: [] };

    // Save state A (before action 1)
    var r = historySave(stack, redoStack, state);
    stack = r.historyStack;

    // Action 1: initial → edited
    state.nodes[0].val = 'edited';

    // Save state B (before action 2)
    r = historySave(stack, redoStack, state);
    stack = r.historyStack;

    // Action 2: edited → final
    state.nodes[0].val = 'final';

    // Stack = [A, B], state = { val: 'final' }

    // Undo: restore B (val='edited')
    var u = historyUndo(stack, redoStack, state);
    assert.equal(u.canvasData.nodes[0].val, 'edited');
    assert.equal(u.historyStack.length, 1, 'undo: stack=[A]');
    assert.equal(u.redoStack.length, 1, 'undo: redo=[final]');
    assert.equal(u.redoStack[0].nodes[0].val, 'final');

    // Redo: restore 'final'
    var re = historyRedo(u.historyStack, u.redoStack, u.canvasData);
    assert.equal(re.canvasData.nodes[0].val, 'final');
    assert.equal(re.historyStack.length, 2, 'redo: stack=[A, B]');
    assert.equal(re.redoStack.length, 0, 'redo: redo=[]');

    // Undo again: restore B (val='edited')
    var u2 = historyUndo(re.historyStack, re.redoStack, re.canvasData);
    assert.equal(u2.canvasData.nodes[0].val, 'edited');
    assert.equal(u2.historyStack.length, 1, 'undo2: stack=[A]');
    assert.equal(u2.redoStack.length, 1, 'undo2: redo=[final]');
});

// ─── CLIPBOARD COPY ───────────────────────────────────────

console.log('\n\u2500\u2500\u2500 Clipboard: copySelectedNodes() \u2500\u2500\u2500');

test('copy returns null when no nodes are selected', function() {
    var nodes = [makeNode('a'), makeNode('b')];
    var result = clipboardCopy(nodes, [], []);
    assert.equal(result, null);
});

test('copy returns null when selectedIds do not match any node', function() {
    var nodes = [makeNode('a'), makeNode('b')];
    var result = clipboardCopy(nodes, [], ['nonexistent']);
    assert.equal(result, null);
});

test('copy captures a single selected node', function() {
    var nodes = [makeNode('a', 100, 200), makeNode('b', 400, 200)];
    var result = clipboardCopy(nodes, [], ['a']);
    assert.notEqual(result, null);
    assert.equal(result.nodes.length, 1);
    assert.equal(result.nodes[0].id, 'a');
    assert.equal(result.nodes[0].x, 100);
    assert.equal(result.nodes[0].y, 200);
    assert.equal(result.edges.length, 0);
});

test('copy captures multiple selected nodes', function() {
    var nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    var result = clipboardCopy(nodes, [], ['a', 'c']);
    assert.equal(result.nodes.length, 2);
    assert.equal(result.nodes[0].id, 'a');
    assert.equal(result.nodes[1].id, 'c');
});

test('copy excludes edges not fully contained in selection', function() {
    var nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    var edges = [
        makeEdge('e1', 'a', 'b'),   // both selected → included
        makeEdge('e2', 'b', 'c'),   // 'c' not selected → excluded
    ];
    var result = clipboardCopy(nodes, edges, ['a', 'b']);
    assert.equal(result.nodes.length, 2);
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].id, 'e1');
});

test('copy deep clones nodes (mutation safe)', function() {
    var nodes = [makeNode('a')];
    var result = clipboardCopy(nodes, [], ['a']);
    result.nodes[0].x = 999;
    assert.equal(nodes[0].x, 100, 'original should not be mutated');
});

test('copy with all nodes and all edges selected captures everything', function() {
    var nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    var edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'c'),
    ];
    var result = clipboardCopy(nodes, edges, ['a', 'b', 'c']);
    assert.equal(result.nodes.length, 3);
    assert.equal(result.edges.length, 2);
});

// ─── DUPLICATE ────────────────────────────────────────────

console.log('\n\u2500\u2500\u2500 Duplicate: duplicateSelectedNodes() \u2500\u2500\u2500');

test('duplicate returns empty arrays when no nodes are selected', function() {
    var nodes = [makeNode('a')];
    var result = clipboardDuplicate(nodes, [], []);
    assert.equal(result.newNodes.length, 0);
    assert.equal(result.newEdges.length, 0);
});

test('duplicate returns empty arrays when selectedIds do not match', function() {
    var nodes = [makeNode('a')];
    var result = clipboardDuplicate(nodes, [], ['nonexistent']);
    assert.equal(result.newNodes.length, 0);
    assert.equal(result.newEdges.length, 0);
});

test('duplicate creates a deep copy of a single node with offset', function() {
    var nodes = [makeNode('a', 100, 200)];
    var result = clipboardDuplicate(nodes, [], ['a']);
    assert.equal(result.newNodes.length, 1);
    assert.notEqual(result.newNodes[0].id, 'a', 'new node should have different id');
    assert.equal(result.newNodes[0].x, 124, 'x should be shifted by 24');
    assert.equal(result.newNodes[0].y, 224, 'y should be shifted by 24');
    assert.equal(result.newNodes[0].title, 'a', 'other properties preserved');
    assert.equal(result.newEdges.length, 0);
});

test('duplicate creates deep copies of multiple selected nodes', function() {
    var nodes = [makeNode('a', 10, 20), makeNode('b', 50, 60), makeNode('c', 90, 100)];
    var result = clipboardDuplicate(nodes, [], ['a', 'c']);
    assert.equal(result.newNodes.length, 2);
    assert.equal(result.newNodes[0].x, 34);  // 10 + 24
    assert.equal(result.newNodes[0].y, 44);  // 20 + 24
    assert.equal(result.newNodes[1].x, 114); // 90 + 24
    assert.equal(result.newNodes[1].y, 124); // 100 + 24
});

test('duplicate preserves edges between selected nodes', function() {
    var nodes = [makeNode('a'), makeNode('b')];
    var edges = [makeEdge('e1', 'a', 'b')];

    var result = clipboardDuplicate(nodes, edges, ['a', 'b']);
    assert.equal(result.newNodes.length, 2);
    assert.equal(result.newEdges.length, 1);

    var dupEdge = result.newEdges[0];
    // fromNode should map to one of the new node IDs
    assert.ok(result.newNodes.some(function(n) { return n.id === dupEdge.fromNode; }));
    assert.ok(result.newNodes.some(function(n) { return n.id === dupEdge.toNode; }));
    // Should not reference old IDs
    assert.notEqual(dupEdge.fromNode, 'a');
    assert.notEqual(dupEdge.toNode, 'b');
});

test('duplicate excludes edges where only one endpoint is selected', function() {
    var nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    var edges = [
        makeEdge('e1', 'a', 'b'),   // both selected → duplicated
        makeEdge('e2', 'b', 'c'),   // 'c' not selected → excluded
    ];

    var result = clipboardDuplicate(nodes, edges, ['a', 'b']);
    assert.equal(result.newNodes.length, 2);
    assert.equal(result.newEdges.length, 1);
    assert.equal(result.newEdges[0].fromNode.indexOf('node_'), 0, 'edge should reference new ID');
});

test('duplicate deep clones (mutation safe)', function() {
    var nodes = [makeNode('a')];
    var result = clipboardDuplicate(nodes, [], ['a']);
    result.newNodes[0].x = 999;
    assert.equal(nodes[0].x, 100, 'original should not be mutated');
});

test('duplicate does not mutate original edges array', function() {
    var nodes = [makeNode('a'), makeNode('b')];
    var edges = [makeEdge('e1', 'a', 'b')];
    var edgesBefore = edges.length;

    var result = clipboardDuplicate(nodes, edges, ['a', 'b']);
    assert.equal(result.newEdges.length, 1);
    assert.equal(edges.length, edgesBefore, 'original edges not mutated');
});

// ─── VIEWPORT PERSISTENCE ────────────────────────────────

console.log('\n\u2500\u2500\u2500 Viewport: _saveViewport() \u2500\u2500\u2500');

test('saves transform to note.canvasData.viewport', function() {
    var note = { id: 'canvas_1', canvasData: { nodes: [], edges: [] } };
    var transform = { x: 100, y: 50, scale: 1.5 };

    var result = saveViewportToNote(note, transform);
    assert.deepEqual(result.canvasData.viewport, { x: 100, y: 50, scale: 1.5 });
});

test('overwrites previous viewport values', function() {
    var note = { id: 'canvas_1', canvasData: { nodes: [], edges: [], viewport: { x: 0, y: 0, scale: 1 } } };
    var transform = { x: 200, y: -50, scale: 0.5 };

    var result = saveViewportToNote(note, transform);
    assert.deepEqual(result.canvasData.viewport, { x: 200, y: -50, scale: 0.5 });
});

test('saves extreme zoom values', function() {
    var note = { id: 'canvas_1', canvasData: {} };
    var transform = { x: -9999, y: 9999, scale: 5 };

    var result = saveViewportToNote(note, transform);
    assert.equal(result.canvasData.viewport.x, -9999);
    assert.equal(result.canvasData.viewport.y, 9999);
    assert.equal(result.canvasData.viewport.scale, 5);
});

test('saves fractional zoom values', function() {
    var note = { id: 'canvas_1', canvasData: {} };
    var transform = { x: 33.333, y: -12.75, scale: 0.375 };

    var result = saveViewportToNote(note, transform);
    assert.equal(result.canvasData.viewport.scale, 0.375);
    assert.equal(result.canvasData.viewport.x, 33.333);
});

test('viewport save is a shallow object copy (not reference)', function() {
    var note = { id: 'canvas_1', canvasData: {} };
    var transform = { x: 50, y: 50, scale: 1 };

    saveViewportToNote(note, transform);
    transform.x = 999;
    assert.equal(note.canvasData.viewport.x, 50, 'stored value should not change when transform mutates');
});


console.log('\n\u2500\u2500\u2500 Zoom-to-Fit: zoomToFit() \u2500\u2500\u2500');

test('returns null when nodes array is empty', function() {
    var result = computeZoomToFit([], 1000, 800);
    assert.equal(result, null);
});

test('returns null when nodes is null/undefined', function() {
    assert.equal(computeZoomToFit(null, 1000, 800), null);
    assert.equal(computeZoomToFit(undefined, 1000, 800), null);
});

test('single node at origin fits within container', function() {
    var nodes = [{ id: 'a', x: 0, y: 0, width: 200, height: 80 }];
    var result = computeZoomToFit(nodes, 1000, 800);
    assert.notEqual(result, null);
    // Content dimensions: width=0+200+120=320, height=0+80+120=200
    // scaleX = 1000/320 ≈ 3.125, scaleY = 800/200 = 4
    // newScale = min(3.125, 4) = 3.125, capped at max=2
    // So scale should be 2
    assert.equal(result.scale, 2, 'should cap at max scale 2');
    // centerX = 0+100=100, centerY = 0+40=40
    // x = 1000/2 - 100*2 = 500 - 200 = 300
    // y = 800/2 - 40*2 = 400 - 80 = 320
    assert.equal(result.x, 300);
    assert.equal(result.y, 320);
});

test('two nodes side by side fit within container', function() {
    var nodes = [
        { id: 'a', x: 0, y: 0, width: 200, height: 80 },
        { id: 'b', x: 400, y: 0, width: 200, height: 80 },
    ];
    var result = computeZoomToFit(nodes, 1000, 800);
    assert.notEqual(result, null);
    // Bounds: minX=0, maxX=600, minY=0, maxY=80
    // Content: width=600+120=720, height=80+120=200
    // scaleX = 1000/720 ≈ 1.389, scaleY = 800/200 = 4
    // newScale = min(1.389, 4) = 1.389 (no capping)
    assert.ok(result.scale < 2, 'scale should be under cap');
    // centerX = 300, centerY = 40
    // x = 500 - 300*scale, y = 400 - 40*scale
    assert.ok(result.x > 0, 'x should be positive');
    assert.ok(result.y > 0, 'y should be positive');
});

test('nodes use default dimensions when width/height are missing', function() {
    var nodes = [
        { id: 'a', x: 0, y: 0 },  // no width/height — defaults to 200x80
    ];
    var result = computeZoomToFit(nodes, 1000, 800);
    assert.notEqual(result, null);
    // Should use defaults: width=200, height=80
    // Content: width=0+200+120=320, height=0+80+120=200
    assert.equal(result.scale, 2, 'should cap at max scale 2');
});

test('zoom scale is never below 0.1 minimum', function() {
    // Very wide layout: nodes spanning 10000px
    var nodes = [
        { id: 'a', x: 0, y: 0, width: 5000, height: 80 },
        { id: 'b', x: 10000, y: 0, width: 5000, height: 80 },
    ];
    var result = computeZoomToFit(nodes, 1000, 800);
    assert.notEqual(result, null);
    // Bounds: minX=0, maxX=15000, contentWidth=15000+120=15120
    // scaleX = 1000/15120 ≈ 0.066
    // scaleY = 800/200 = 4
    // newScale = min(0.066, 4) = 0.066, capped at min=0.1
    assert.equal(result.scale, 0.1, 'should floor at min scale 0.1');
});

test('tall layout uses height scale factor (not width)', function() {
    var nodes = [
        { id: 'a', x: 0, y: 0, width: 200, height: 5000 },
    ];
    var result = computeZoomToFit(nodes, 1000, 800);
    assert.notEqual(result, null);
    // Bounds: minX=0, maxX=200, minY=0, maxY=5000
    // contentWidth = 200+120=320, contentHeight = 5000+120=5120
    // scaleX = 1000/320 ≈ 3.125, scaleY = 800/5120 ≈ 0.156
    // newScale = min(3.125, 0.156) = 0.156
    // Height is the limiting factor
    assert.ok(result.scale < 1, 'scale should be <1 (zoomed out)');
    assert.ok(result.scale > 0.1, 'scale should be above min floor');
});

test('centers nodes in the viewport', function() {
    var nodes = [
        { id: 'a', x: 100, y: 100, width: 200, height: 80 },
        { id: 'b', x: 500, y: 300, width: 200, height: 80 },
    ];
    var result = computeZoomToFit(nodes, 800, 600);
    assert.notEqual(result, null);
    // Bounds: minX=100, maxX=700, minY=100, maxY=380
    // centerX = 100 + (700-100)/2 = 400
    // centerY = 100 + (380-100)/2 = 240
    // contentWidth = 600+120=720, contentHeight = 280+120=400
    // scaleX = 800/720 ≈ 1.111, scaleY = 600/400 = 1.5
    // newScale = min(1.111, 1.5) = 1.111
    // x = 800/2 - 400*1.111 = 400 - 444.4 = -44.4
    // y = 600/2 - 240*1.111 = 300 - 266.6 = 33.4
    assert.ok(result.x < 0, 'first node left of center pushes x negative');
    assert.ok(result.y > 0, 'nodes below center push y positive');
});

test('zero-dimension nodes use default width/height (not null)', function() {
    var nodes = [{ id: 'a', x: 100, y: 100, width: 0, height: 0 }];
    var result = computeZoomToFit(nodes, 800, 600);
    // width=0, height=0 is falsy, so defaults to width=200, height=80
    assert.notEqual(result, null, 'defaults prevent null return');
});

test('padding breathing room reduces scale compared to no-padding', function() {
    // Use a case where without padding the scale would be exactly 1, but with 60px padding it's ~0.806
    var nodes = [{ id: 'a', x: 0, y: 0, width: 500, height: 300 }];
    var result = computeZoomToFit(nodes, 500, 400);
    assert.notEqual(result, null);
    // With padding=60: contentWidth = 500+120=620, contentHeight = 300+120=420
    // scaleX = 500/620 ≈ 0.806, scaleY = 400/420 ≈ 0.952
    // newScale = min(0.806, 0.952) = 0.806
    // Without padding: contentWidth=500, contentHeight=300
    // scaleX=1, scaleY=1.333, newScale_noPad=1
    // So padding reduces the scale from 1.0 to about 0.806
    var expectedScale = 500 / (500 + 120);  // 0.80645...
    assert.ok(Math.abs(result.scale - expectedScale) < 0.001,
        'padding breathing room: scale ' + result.scale + ' should be ~' + expectedScale);
});

console.log('\n\u2500\u2500\u2500 Edge Cases \u2500\u2500\u2500');

test('duplicate with no edges in data model handles gracefully', function() {
    var nodes = [makeNode('a')];
    var result = clipboardDuplicate(nodes, null, ['a']);
    assert.equal(result.newNodes.length, 1);
    assert.equal(result.newEdges.length, 0);
});

test('copy with no edges in data model handles gracefully', function() {
    var nodes = [makeNode('a')];
    var result = clipboardCopy(nodes, null, ['a']);
    assert.notEqual(result, null);
    assert.equal(result.nodes.length, 1);
    assert.equal(result.edges.length, 0);
});

test('undo/redo with complex canvasData (nodes + edges + viewport)', function() {
    var state = {
        nodes: [makeNode('a'), makeNode('b')],
        edges: [makeEdge('e1', 'a', 'b')],
        viewport: { x: 100, y: 50, scale: 1.5 }
    };

    // Save state A (before action 1)
    var r = historySave([], [], state);
    var stack = r.historyStack;
    var redoStack = r.redoStack;

    // Action 1: add node c + edge e2
    state.nodes.push({ id: 'c', x: 300, y: 300, width: 200, height: 80 });
    state.edges.push({ id: 'e2', fromNode: 'b', toNode: 'c', fromPort: 'right', toPort: 'left' });

    // Save state B (before action 2)
    r = historySave(stack, redoStack, state);
    stack = r.historyStack;
    redoStack = r.redoStack;

    // Action 2: add node d
    state.nodes.push({ id: 'd', x: 500, y: 500, width: 200, height: 80 });

    // Stack = [A, B], state = 4 nodes, 2 edges

    // Undo 1: restore B (3 nodes, 2 edges)
    var u1 = historyUndo(stack, redoStack, state);
    assert.equal(u1.canvasData.nodes.length, 3, 'node d removed');
    assert.equal(u1.canvasData.edges.length, 2, 'edges preserved');
    assert.deepEqual(u1.canvasData.viewport, { x: 100, y: 50, scale: 1.5 }, 'viewport preserved');

    // Undo 2: restore A (2 nodes, 1 edge)
    var u2 = historyUndo(u1.historyStack, u1.redoStack, u1.canvasData);
    assert.equal(u2.canvasData.nodes.length, 2, 'node c removed');
    assert.equal(u2.canvasData.edges.length, 1, 'edge e2 removed');
    assert.deepEqual(u2.canvasData.viewport, { x: 100, y: 50, scale: 1.5 }, 'viewport preserved');

    // Redo: restore B (3 nodes, 2 edges)
    var re = historyRedo(u2.historyStack, u2.redoStack, u2.canvasData);
    assert.equal(re.canvasData.nodes.length, 3);
    assert.equal(re.canvasData.edges.length, 2);
});

test('duplicate generates unique IDs each call', function() {
    var nodes = [makeNode('a')];

    var r1 = clipboardDuplicate(nodes, [], ['a']);
    var r2 = clipboardDuplicate(nodes, [], ['a']);

    assert.notEqual(r1.newNodes[0].id, r2.newNodes[0].id, 'each call should generate unique IDs');
});

test('copy preserves node properties (custom type, color, url, etc.)', function() {
    var nodes = [
        { id: 'url1', type: 'embed', url: 'https://example.com', x: 100, y: 100, width: 320, height: 240, title: 'Example' },
        { id: 'file1', type: 'file', linkedNoteId: 'note_123', x: 500, y: 100, width: 240, height: 160, title: 'Embedded Note' },
    ];

    var result = clipboardCopy(nodes, [], ['url1', 'file1']);
    assert.equal(result.nodes.length, 2);
    assert.equal(result.nodes[0].type, 'embed');
    assert.equal(result.nodes[0].url, 'https://example.com');
    assert.equal(result.nodes[1].type, 'file');
    assert.equal(result.nodes[1].linkedNoteId, 'note_123');
});

// ============================================================
// SUMMARY
// ============================================================

console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  RESULTS: ' + passed + ' passed, ' + failed + ' failed');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

if (errors.length > 0) {
    console.log('FAILURES:');
    errors.forEach(function(e) { console.log('  \u2022 ' + e.name + ': ' + e.error); });
    console.log('');
}

process.exit(failed > 0 ? 1 : 0);
