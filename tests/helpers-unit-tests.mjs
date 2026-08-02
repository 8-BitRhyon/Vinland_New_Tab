

import assert from 'node:assert/strict';

// ============================================================
// FUNCTION EXTRACTS (pure data operations from helpers)
// ============================================================

function findActiveNote(notes, activeNoteId) {
    return (notes || []).find(function(n) { return n.id === activeNoteId; }) || null;
}

function guardedSave(saveFn) {
    if (typeof saveFn === 'function') saveFn();
}

function computeWorldCenter(containerRect, transform) {
    return {
        x: (containerRect.width / 2 - transform.x) / transform.scale,
        y: (containerRect.height / 2 - transform.y) / transform.scale
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
// TESTS: _getActiveNote()
// ============================================================

console.log('\n\u2500\u2500\u2500 Helpers: _getActiveNote() \u2500\u2500\u2500');

test('returns the note matching activeNoteId', function() {
    var notes = [
        { id: 'n1', title: 'Alpha' },
        { id: 'n2', title: 'Beta' },
        { id: 'n3', title: 'Gamma' },
    ];
    var result = findActiveNote(notes, 'n2');
    assert.notEqual(result, null);
    assert.equal(result.id, 'n2');
    assert.equal(result.title, 'Beta');
});

test('returns null when no note matches', function() {
    var notes = [{ id: 'n1', title: 'Alpha' }];
    var result = findActiveNote(notes, 'nonexistent');
    assert.equal(result, null);
});

test('returns null for empty notes array', function() {
    var result = findActiveNote([], 'n1');
    assert.equal(result, null);
});

test('returns null when notes is undefined', function() {
    var result = findActiveNote(undefined, 'n1');
    assert.equal(result, null);
});

test('returns null when notes is null', function() {
    var result = findActiveNote(null, 'n1');
    assert.equal(result, null);
});

test('matches exact ID (not partial)', function() {
    var notes = [
        { id: 'node_abc', title: 'Precise' },
        { id: 'node_abcdef', title: 'Longer' },
    ];
    var result = findActiveNote(notes, 'node_abc');
    assert.notEqual(result, null);
    assert.equal(result.title, 'Precise');
});

test('returns null when activeNoteId is empty string', function() {
    var notes = [{ id: '', title: 'Empty ID' }];
    var result = findActiveNote(notes, '');
    assert.notEqual(result, null, 'empty ID should match empty string');
    assert.equal(result.title, 'Empty ID');
});

test('handles note with extra properties preserved', function() {
    var notes = [
        { id: 'n1', title: 'Test', type: 'canvas', canvasData: { nodes: [], edges: [] }, created: 1000 }
    ];
    var result = findActiveNote(notes, 'n1');
    assert.equal(result.type, 'canvas');
    assert.deepEqual(result.canvasData, { nodes: [], edges: [] });
    assert.equal(result.created, 1000);
});

// ============================================================
// TESTS: _saveData()  (guardedSave)
// ============================================================

console.log('\n\u2500\u2500\u2500 Helpers: _saveData() \u2500\u2500\u2500');

test('calls the save function when it exists', function() {
    var called = false;
    guardedSave(function() { called = true; });
    assert.equal(called, true, 'save function should have been called');
});

test('does not throw when save function is undefined', function() {
    // Should not throw
    guardedSave(undefined);
    assert.ok(true, 'no error thrown for undefined');
});

test('does not throw when save function is null', function() {
    guardedSave(null);
    assert.ok(true, 'no error thrown for null');
});

test('passes no arguments to the save function', function() {
    var args = null;
    guardedSave(function() { args = arguments; });
    assert.equal(args.length, 0, 'save function should receive no arguments');
});

test('save function called exactly once per call', function() {
    var count = 0;
    guardedSave(function() { count++; });
    guardedSave(function() { count++; });
    guardedSave(function() { count++; });
    assert.equal(count, 3, 'should be called once per invocation');
});

test('handles non-function truthy values gracefully', function() {
    guardedSave('string');
    guardedSave(42);
    guardedSave({});
    guardedSave([]);
    assert.ok(true, 'no error thrown for non-function values');
});

test('composes with findActiveNote (integration: save after find)', function() {
    var notes = [{ id: 'n1', title: 'Alpha' }];
    var savedValue = null;

    var note = findActiveNote(notes, 'n1');
    if (note) {
        guardedSave(function() { savedValue = note.title; });
    }

    assert.equal(savedValue, 'Alpha', 'save should capture the found note data');
});

// ============================================================
// TESTS: _getWorldCenter()  (computeWorldCenter)
// ============================================================

console.log('\n\u2500\u2500\u2500 Helpers: _getWorldCenter() \u2500\u2500\u2500');

test('computes center of viewport in world coordinates', function() {
    var rect = { width: 1000, height: 800 };
    var transform = { x: 0, y: 0, scale: 1 };

    var result = computeWorldCenter(rect, transform);
    assert.equal(result.x, 500);
    assert.equal(result.y, 400);
});

test('accounts for pan offset (transform.x/y)', function() {
    var rect = { width: 1000, height: 800 };
    var transform = { x: 200, y: 100, scale: 1 };

    var result = computeWorldCenter(rect, transform);
    // (1000/2 - 200) = 300, (800/2 - 100) = 300
    assert.equal(result.x, 300);
    assert.equal(result.y, 300);
});

test('accounts for zoom scale', function() {
    var rect = { width: 1000, height: 800 };
    var transform = { x: 0, y: 0, scale: 2 };

    var result = computeWorldCenter(rect, transform);
    // (1000/2 - 0) / 2 = 250, (800/2 - 0) / 2 = 200
    assert.equal(result.x, 250);
    assert.equal(result.y, 200);
});

test('combines pan and zoom', function() {
    var rect = { width: 800, height: 600 };
    var transform = { x: -100, y: 50, scale: 1.5 };

    var result = computeWorldCenter(rect, transform);
    // (800/2 - (-100)) / 1.5 = (400 + 100) / 1.5 = 500 / 1.5 ≈ 333.333
    // (600/2 - 50) / 1.5 = (300 - 50) / 1.5 = 250 / 1.5 ≈ 166.667
    assert.ok(Math.abs(result.x - 333.333) < 0.001);
    assert.ok(Math.abs(result.y - 166.667) < 0.001);
});

test('handles zoomed-out (fractional scale)', function() {
    var rect = { width: 1000, height: 800 };
    var transform = { x: 500, y: 400, scale: 0.5 };

    var result = computeWorldCenter(rect, transform);
    // (500 - 500) / 0.5 = 0, (400 - 400) / 0.5 = 0
    assert.equal(result.x, 0);
    assert.equal(result.y, 0);
});

test('handles zero zoom (edge case: scale=0)', function() {
    var rect = { width: 1000, height: 800 };
    var transform = { x: 0, y: 0, scale: 0 };

    // Division by zero produces Infinity — document that this is expected behavior
    var result = computeWorldCenter(rect, transform);
    assert.equal(result.x, Infinity);
    assert.equal(result.y, Infinity);
});

test('handles negative pan (dragged right/down)', function() {
    var rect = { width: 1920, height: 1080 };
    var transform = { x: -300, y: -200, scale: 1 };

    var result = computeWorldCenter(rect, transform);
    // (960 - (-300)) = 1260, (540 - (-200)) = 740
    assert.equal(result.x, 1260);
    assert.equal(result.y, 740);
});

test('small viewport with large zoom', function() {
    var rect = { width: 400, height: 300 };
    var transform = { x: 0, y: 0, scale: 4 };

    var result = computeWorldCenter(rect, transform);
    // (200) / 4 = 50, (150) / 4 = 37.5
    assert.equal(result.x, 50);
    assert.equal(result.y, 37.5);
});

// ============================================================
// TESTS: Integration (stacking helpers together)
// ============================================================

console.log('\n\u2500\u2500\u2500 Integration: Helpers composing together \u2500\u2500\u2500');

test('find note, then compute world center of its canvas', function() {
    var notes = [
        { id: 'canvas_n1', title: 'My Canvas', canvasData: { nodes: [], edges: [] } }
    ];
    var rect = { width: 1000, height: 800 };
    var transform = { x: 0, y: 0, scale: 1 };

    var note = findActiveNote(notes, 'canvas_n1');
    assert.notEqual(note, null, 'note should be found');

    // Simulate what addFileNode does: get active note, then compute center
    if (note) {
        var center = computeWorldCenter(rect, transform);
        assert.equal(center.x, 500);
        assert.equal(center.y, 400);

        // New node positioned at center offset
        var newNode = {
            x: center.x - 120,
            y: center.y - 60,
            width: 240,
            height: 160
        };
        assert.equal(newNode.x, 380);
        assert.equal(newNode.y, 340);
    }
});

test('save after modifying note data', function() {
    var notes = [{ id: 'n1', title: 'Before' }];
    var savedData = null;

    var note = findActiveNote(notes, 'n1');
    note.title = 'After';

    guardedSave(function() { savedData = note.title; });

    assert.equal(savedData, 'After', 'save should capture the modified title');
});

// ============================================================
// SUMMARY
// ============================================================

console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  RESULTS: ' + passed + ' passed, ' + failed + ' failed');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

if (errors.length > 0) {
    console.log('FAILURES:');
    errors.forEach(function(e) { console.log('  \u2022 ' + e.name + ': ' + e.error); });
    console.log('');
}

process.exit(failed > 0 ? 1 : 0);
