

import assert from 'node:assert/strict';

// ============================================================
// FUNCTION EXTRACTS (pure data operations from helpers)
// ============================================================

function snapToGrid(val, gridSize) {
    return (Math.round(val / gridSize) * gridSize) + 0;  // +0 converts -0 to 0
}

function snapNodePosition(node, gridSize, getEl) {
    node.x = snapToGrid(node.x, gridSize);
    node.y = snapToGrid(node.y, gridSize);
    var el = getEl ? getEl('canvas-node-' + node.id) : null;
    if (el) {
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';
    }
}

function applySnapToAllNodes(nodes, gridSize, getEl) {
    if (!nodes) return;
    nodes.forEach(function(n) {
        snapNodePosition(n, gridSize, getEl);
    });
}

function createMockDom() {
    var elements = {};
    return {
        getElementById: function(id) {
            return elements[id] || null;
        },
        _createElement: function(id) {
            var el = { style: { left: '', top: '' }, id: id };
            elements[id] = el;
            return el;
        },
        _reset: function() {
            elements = {};
        }
    };
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

// ============================================================
// TESTS: _snapToGrid()
// ============================================================

console.log('\n\u2500\u2500\u2500 Snap-to-Grid: _snapToGrid() \u2500\u2500\u2500');

test('snaps exact grid multiple to itself', function() {
    assert.equal(snapToGrid(0, 30), 0);
    assert.equal(snapToGrid(30, 30), 30);
    assert.equal(snapToGrid(60, 30), 60);
    assert.equal(snapToGrid(90, 30), 90);
});

test('rounds down to nearest grid point', function() {
    assert.equal(snapToGrid(14, 30), 0);
    assert.equal(snapToGrid(29, 30), 30);
    assert.equal(snapToGrid(44, 30), 30);
    assert.equal(snapToGrid(59, 30), 60);
});

test('rounds up to nearest grid point', function() {
    assert.equal(snapToGrid(16, 30), 30);
    assert.equal(snapToGrid(31, 30), 30);
    assert.equal(snapToGrid(46, 30), 60);
    assert.equal(snapToGrid(61, 30), 60);
});

test('handles negative values', function() {
    assert.equal(snapToGrid(-14, 30), 0);
    assert.equal(snapToGrid(-16, 30), -30);
    assert.equal(snapToGrid(-44, 30), -30);
    assert.equal(snapToGrid(-46, 30), -60);
});

test('snaps at midpoint boundary (val = gridSize/2)', function() {
    // 15/30 = 0.5 → round(0.5) = 1 → 1 * 30 = 30
    assert.equal(snapToGrid(15, 30), 30);
    // -15/30 = -0.5 → round(-0.5) = -0 → -0 * 30 = -0 (which is 0)
    assert.equal(Math.abs(snapToGrid(-15, 30)), 0);
});

test('works with different grid sizes', function() {
    assert.equal(snapToGrid(7, 10), 10);
    assert.equal(snapToGrid(23, 25), 25);
    assert.equal(snapToGrid(49, 50), 50);
    assert.equal(snapToGrid(120, 100), 100);
});

test('preserves zero', function() {
    assert.equal(snapToGrid(0, 30), 0);
    assert.equal(snapToGrid(0, 50), 0);
    assert.equal(snapToGrid(-0, 30), 0);
});

test('handles large grid sizes', function() {
    assert.equal(snapToGrid(249, 100), 200);
    assert.equal(snapToGrid(250, 100), 300);
    assert.equal(snapToGrid(749, 500), 500);
    assert.equal(snapToGrid(750, 500), 1000);
});

test('handles large values', function() {
    assert.equal(snapToGrid(10007, 30), 10020);
    assert.equal(snapToGrid(10014, 30), 10020);
    assert.equal(snapToGrid(10016, 30), 10020);
    assert.equal(snapToGrid(9994, 30), 9990);
});

test('handles floating point', function() {
    assert.equal(snapToGrid(3.7, 30), 0);
    assert.equal(snapToGrid(14.2, 30), 0);
    assert.equal(snapToGrid(15.8, 30), 30);
    assert.equal(snapToGrid(29.9, 30), 30);
});

// ============================================================
// TESTS: _snapNodePosition()
// ============================================================

console.log('\n\u2500\u2500\u2500 Snap-to-Grid: _snapNodePosition() \u2500\u2500\u2500');

test('snaps node.x and node.y to grid', function() {
    var node = { id: 'n1', x: 14, y: 46 };
    snapNodePosition(node, 30);
    assert.equal(node.x, 0);
    assert.equal(node.y, 60);
});

test('updates DOM element left/top when element exists', function() {
    var mock = createMockDom();
    var el = mock._createElement('canvas-node-n1');
    var node = { id: 'n1', x: 67, y: 123 };

    snapNodePosition(node, 30, mock.getElementById);

    assert.equal(node.x, 60);
    assert.equal(node.y, 120);
    assert.equal(el.style.left, '60px');
    assert.equal(el.style.top, '120px');
});

test('does not throw when DOM element is missing', function() {
    var mock = createMockDom();
    var node = { id: 'nonexistent', x: 45, y: 78 };

    // Should not throw — element doesn't exist in mock
    snapNodePosition(node, 30, mock.getElementById);

    assert.equal(node.x, 60);
    assert.equal(node.y, 90);
});

test('keeps node at grid when already aligned', function() {
    var mock = createMockDom();
    mock._createElement('canvas-node-aligned');
    var node = { id: 'aligned', x: 60, y: 120 };

    snapNodePosition(node, 30, mock.getElementById);

    assert.equal(node.x, 60);
    assert.equal(node.y, 120);
});

test('snaps negative positions', function() {
    var mock = createMockDom();
    mock._createElement('canvas-node-neg');
    var node = { id: 'neg', x: -14, y: -46 };

    snapNodePosition(node, 30, mock.getElementById);

    assert.equal(node.x, 0);
    assert.equal(node.y, -60);
});

test('snaps node with width/height (only x/y affected)', function() {
    var node = { id: 'n1', x: 17, y: 89, width: 200, height: 80 };
    snapNodePosition(node, 30);
    assert.equal(node.x, 30);
    assert.equal(node.y, 90);
    assert.equal(node.width, 200, 'width should not change');
    assert.equal(node.height, 80, 'height should not change');
});

test('snaps multiple nodes independently', function() {
    var mock = createMockDom();
    mock._createElement('canvas-node-a');
    mock._createElement('canvas-node-b');

    var nodeA = { id: 'a', x: 14, y: 29 };
    var nodeB = { id: 'b', x: 46, y: 61 };

    snapNodePosition(nodeA, 30, mock.getElementById);
    snapNodePosition(nodeB, 30, mock.getElementById);

    assert.equal(nodeA.x, 0);
    assert.equal(nodeA.y, 30);
    assert.equal(nodeB.x, 60);
    assert.equal(nodeB.y, 60);
});

// ============================================================
// TESTS: applySnapToAllNodes (batch snap, like grid toggle)
// ============================================================

console.log('\n\u2500\u2500\u2500 Snap-to-Grid: Batch snap (applySnapToAllNodes) \u2500\u2500\u2500');

test('snaps all nodes in an array', function() {
    var nodes = [
        { id: 'n1', x: 14, y: 29 },
        { id: 'n2', x: 46, y: 61 },
        { id: 'n3', x: -7, y: -23 }
    ];

    var mock = createMockDom();
    mock._createElement('canvas-node-n1');
    mock._createElement('canvas-node-n2');
    mock._createElement('canvas-node-n3');

    applySnapToAllNodes(nodes, 30, mock.getElementById);

    assert.equal(nodes[0].x, 0);
    assert.equal(nodes[0].y, 30);
    assert.equal(nodes[1].x, 60);
    assert.equal(nodes[1].y, 60);
    assert.equal(nodes[2].x, 0);
    assert.equal(nodes[2].y, -30);
});

test('handles empty node array', function() {
    // Should not throw
    applySnapToAllNodes([], 30);
    assert.ok(true, 'empty array does not cause error');
});

test('handles null nodes', function() {
    applySnapToAllNodes(null, 30);
    assert.ok(true, 'null does not cause error');
});

test('handles nodes with extra properties (preserved after snap)', function() {
    var nodes = [{
        id: 'n1',
        x: 14,
        y: 46,
        title: 'Test',
        type: 'text',
        width: 200,
        height: 80,
        zIndex: 5
    }];

    applySnapToAllNodes(nodes, 30);

    assert.equal(nodes[0].x, 0);
    assert.equal(nodes[0].y, 60);
    assert.equal(nodes[0].title, 'Test');
    assert.equal(nodes[0].type, 'text');
    assert.equal(nodes[0].width, 200);
    assert.equal(nodes[0].zIndex, 5);
});

// ============================================================
// TESTS: Grid toggle disabled guard
// ============================================================

console.log('\n\u2500\u2500\u2500 Snap-to-Grid: Disabled guard (toggle off) \u2500\u2500\u2500');

function snapNodePositionGuarded(node, gridSize, getEl, enabled) {
    if (!enabled) return;
    snapNodePosition(node, gridSize, getEl);
}

test('does not snap when disabled', function() {
    var node = { id: 'n1', x: 14, y: 46 };
    snapNodePositionGuarded(node, 30, null, false);
    assert.equal(node.x, 14, 'x should remain unchanged when disabled');
    assert.equal(node.y, 46, 'y should remain unchanged when disabled');
});

test('snaps when enabled', function() {
    var node = { id: 'n1', x: 14, y: 46 };
    snapNodePositionGuarded(node, 30, null, true);
    assert.equal(node.x, 0, 'x should snap when enabled');
    assert.equal(node.y, 60, 'y should snap when enabled');
});

// ============================================================
// TESTS: Integration — real-world drag-end snap scenario
// ============================================================

console.log('\n\u2500\u2500\u2500 Snap-to-Grid: Integration scenarios \u2500\u2500\u2500');

test('simulates drag-end snap: nodes moved then snapped on release', function() {
    // Simulate what happens during a drag: positions accumulate deltas
    var mock = createMockDom();
    mock._createElement('canvas-node-n1');
    mock._createElement('canvas-node-n2');

    var note = {
        id: 'canvas1',
        canvasData: {
            nodes: [
                { id: 'n1', x: 100, y: 200 },
                { id: 'n2', x: 400, y: 300 }
            ]
        }
    };

    // Simulate drag deltas applied in onMouseMove
    var dx = 17;
    var dy = 13;
    note.canvasData.nodes.forEach(function(n) {
        n.x += dx;
        n.y += dy;
    });

    // Simulate onMouseUp snap
    note.canvasData.nodes.forEach(function(n) {
        snapNodePosition(n, 30, mock.getElementById);
    });

    // Original 100+17=117 → snap 120, 200+13=213 → snap 210
    assert.equal(note.canvasData.nodes[0].x, 120);
    assert.equal(note.canvasData.nodes[0].y, 210);
    // Original 400+17=417 → snap 420, 300+13=313 → snap 300
    assert.equal(note.canvasData.nodes[1].x, 420);
    assert.equal(note.canvasData.nodes[1].y, 300);
});

test('simulates group children snap after parent group drag', function() {
    var mock = createMockDom();
    mock._createElement('canvas-node-group1');
    mock._createElement('canvas-node-child1');
    mock._createElement('canvas-node-child2');

    var nodesToMove = [
        { id: 'group1', x: 200, y: 150, width: 400, height: 300, type: 'group' }
    ];

    var childrenSet = [
        { id: 'child1', x: 220, y: 170, width: 200, height: 80 },
        { id: 'child2', x: 250, y: 300, width: 200, height: 80 }
    ];

    // Simulate drag deltas
    var dx = -13;
    var dy = 7;
    nodesToMove.forEach(function(n) {
        n.x += dx;
        n.y += dy;
    });
    childrenSet.forEach(function(n) {
        n.x += dx;
        n.y += dy;
    });

    // Simulate onMouseUp snap
    nodesToMove.forEach(function(n) {
        snapNodePosition(n, 30, mock.getElementById);
    });
    childrenSet.forEach(function(n) {
        snapNodePosition(n, 30, mock.getElementById);
    });

    // Group: 200-13=187 → snap 180, 150+7=157 → snap 150
    assert.equal(nodesToMove[0].x, 180);
    assert.equal(nodesToMove[0].y, 150);
    // Child1: 220-13=207 → snap 210, 170+7=177 → snap 180
    assert.equal(childrenSet[0].x, 210);
    assert.equal(childrenSet[0].y, 180);
    // Child2: 250-13=237 → snap 240, 300+7=307 → snap 300
    assert.equal(childrenSet[1].x, 240);
    assert.equal(childrenSet[1].y, 300);
});

test('simulates new node creation with grid snap', function() {
    var mock = createMockDom();
    mock._createElement('canvas-node-0');

    // Simulate double-click to create node at (317, 442)
    var newNode = {
        id: '0',
        x: 317 - 100,  // centered offset
        y: 442 - 40,
        width: 200,
        height: 80
    };

    // Simulate addCard grid snap
    newNode.x = snapToGrid(newNode.x, 30);
    newNode.y = snapToGrid(newNode.y, 30);

    // 317-100=217 → snap 210, 442-40=402 → snap 390
    assert.equal(newNode.x, 210);
    assert.equal(newNode.y, 390);
});

test('simulates keyboard-spawned node (Tab/Enter) with grid snap', function() {
    // Tab spawn: parentNode.x + parentNode.width + 60
    var parentNode = { id: 'parent', x: 150, y: 200, width: 200, height: 80 };

    var tabNode = {
        id: 'tab_child',
        x: parentNode.x + (parentNode.width || 200) + 60,
        y: parentNode.y
    };

    tabNode.x = snapToGrid(tabNode.x, 30);
    tabNode.y = snapToGrid(tabNode.y, 30);

    // 150+200+60=410 → snap 420, 200 → snap 210
    assert.equal(tabNode.x, 420);
    assert.equal(tabNode.y, 210);

    // Enter spawn: parentNode.y + parentNode.height + 60
    var enterNode = {
        id: 'enter_sibling',
        x: parentNode.x,
        y: parentNode.y + (parentNode.height || 80) + 60
    };

    enterNode.x = snapToGrid(enterNode.x, 30);
    enterNode.y = snapToGrid(enterNode.y, 30);

    // 150 → snap 150, 200+80+60=340 → snap 330
    assert.equal(enterNode.x, 150);
    assert.equal(enterNode.y, 330);
});

// ============================================================
// SUMMARY
// ============================================================

console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  RESULTS: ' + passed + ' passed, ' + failed + ' failed');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

if (errors.length > 0) {
    console.log('FAILURES:');
    errors.forEach(function(e) { console.log('  \u2022 ' + e.name + ': ' + e.error); });
    console.log('');
}

process.exit(failed > 0 ? 1 : 0);
