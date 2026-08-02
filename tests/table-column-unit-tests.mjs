

import assert from 'node:assert/strict';

// ============================================================
// FUNCTION EXTRACTS (pure data operations)
// ============================================================

const MIN_COL_WIDTH = 80;

function syncColumnWidths(columnWidths, headerCount) {
    var widths = (columnWidths || []).slice(); // clone to avoid mutation
    while (widths.length < headerCount) {
        widths.push('');
    }
    return widths;
}

function computeResizeWidth(startWidth, dx) {
    return Math.max(MIN_COL_WIDTH, startWidth + dx);
}

function getColumnStyleWidth(columnWidths, colIdx) {
    if (!columnWidths) return undefined;
    var w = columnWidths[colIdx];
    if (!w) return undefined;
    return w + 'px';
}

function setColumnWidth(columnWidths, colIdx, newWidth, headerCount) {
    var widths = syncColumnWidths(columnWidths || [], headerCount);
    widths[colIdx] = newWidth;
    return widths;
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
// TESTS: syncColumnWidths()
// ============================================================

console.log('\n\u2500\u2500\u2500 Table: syncColumnWidths() \u2500\u2500\u2500');

test('fills empty array to match header count', function() {
    var result = syncColumnWidths([], 3);
    assert.equal(result.length, 3);
    assert.equal(result[0], '');
    assert.equal(result[1], '');
    assert.equal(result[2], '');
});

test('preserves existing widths when already matching', function() {
    var result = syncColumnWidths([120, 200, 150], 3);
    assert.equal(result.length, 3);
    assert.equal(result[0], 120);
    assert.equal(result[1], 200);
    assert.equal(result[2], 150);
});

test('appends empty strings when array is too short', function() {
    var result = syncColumnWidths([150, 200], 4);
    assert.equal(result.length, 4);
    assert.equal(result[0], 150);
    assert.equal(result[1], 200);
    assert.equal(result[2], '');
    assert.equal(result[3], '');
});

test('preserves extra entries when array exceeds header count', function() {
    var result = syncColumnWidths([100, 200, 300, 400], 3);
    // While loop only pushes, doesn't remove — extra entries are preserved
    assert.equal(result.length, 4);
    assert.equal(result[0], 100);
    assert.equal(result[1], 200);
    assert.equal(result[2], 300);
    assert.equal(result[3], 400);
});

test('handles undefined columnWidths', function() {
    var result = syncColumnWidths(undefined, 2);
    assert.equal(result.length, 2);
    assert.equal(result[0], '');
    assert.equal(result[1], '');
});

test('handles null columnWidths', function() {
    var result = syncColumnWidths(null, 1);
    assert.equal(result.length, 1);
    assert.equal(result[0], '');
});

test('does not mutate the original array', function() {
    var original = [100, 200];
    var result = syncColumnWidths(original, 3);
    assert.equal(original.length, 2, 'original array length should not change');
    assert.equal(result.length, 3, 'result should have new entries');
});

test('handles single header', function() {
    var result = syncColumnWidths([], 1);
    assert.equal(result.length, 1);
    assert.equal(result[0], '');
});

test('handles many headers (10)', function() {
    var result = syncColumnWidths([100], 10);
    assert.equal(result.length, 10);
    assert.equal(result[0], 100);
    for (var i = 1; i < 10; i++) {
        assert.equal(result[i], '');
    }
});

// ============================================================
// TESTS: computeResizeWidth()
// ============================================================

console.log('\n\u2500\u2500\u2500 Table: computeResizeWidth() \u2500\u2500\u2500');

test('clamps to MIN_COL_WIDTH when new width is below minimum', function() {
    assert.equal(computeResizeWidth(100, -50), 80);
});

test('returns startWidth + dx when above minimum', function() {
    assert.equal(computeResizeWidth(100, 50), 150);
});

test('handles zero dx', function() {
    assert.equal(computeResizeWidth(150, 0), 150);
});

test('handles negative dx above minimum', function() {
    assert.equal(computeResizeWidth(200, -30), 170);
});

test('handles exact minimum boundary', function() {
    assert.equal(computeResizeWidth(80, 0), 80);
    assert.equal(computeResizeWidth(90, -10), 80);
});

test('handles large positive dx', function() {
    assert.equal(computeResizeWidth(100, 500), 600);
});

test('handles large negative dx (large shrink)', function() {
    assert.equal(computeResizeWidth(1000, -2000), 80);
});

test('handles zero start width', function() {
    assert.equal(computeResizeWidth(0, 200), 200);
});

test('handles negative start width (edge case)', function() {
    assert.equal(computeResizeWidth(-50, 100), 80);
});

test('handles floating point dx', function() {
    assert.equal(computeResizeWidth(150, 33.5), 183.5);
});

// ============================================================
// TESTS: getColumnStyleWidth()
// ============================================================

console.log('\n\u2500\u2500\u2500 Table: getColumnStyleWidth() \u2500\u2500\u2500');

test('returns formatted width string for valid width', function() {
    assert.equal(getColumnStyleWidth([120, 200], 0), '120px');
    assert.equal(getColumnStyleWidth([120, 200], 1), '200px');
});

test('returns undefined when columnWidths is undefined', function() {
    assert.equal(getColumnStyleWidth(undefined, 0), undefined);
});

test('returns undefined when columnWidths is null', function() {
    assert.equal(getColumnStyleWidth(null, 0), undefined);
});

test('returns undefined for empty string width (not set)', function() {
    assert.equal(getColumnStyleWidth(['', '', ''], 1), undefined);
});

test('returns undefined for empty array', function() {
    assert.equal(getColumnStyleWidth([], 0), undefined);
});

test('returns undefined when colIdx is out of bounds', function() {
    assert.equal(getColumnStyleWidth([100], 5), undefined);
});

test('returns undefined for zero (falsy) width', function() {
    // Zero is falsy, so getColumnStyleWidth treats it as unset.
    // In practice, widths are always >= 80 after clamping.
    assert.equal(getColumnStyleWidth([0, 150], 0), undefined);
});

// ============================================================
// TESTS: setColumnWidth()
// ============================================================

console.log('\n\u2500\u2500\u2500 Table: setColumnWidth() \u2500\u2500\u2500');

test('sets width at colIdx and syncs other columns', function() {
    var result = setColumnWidth(['', '', ''], 1, 200, 3);
    assert.equal(result.length, 3);
    assert.equal(result[0], '');
    assert.equal(result[1], 200);
    assert.equal(result[2], '');
});

test('sets width and fills empty entries', function() {
    var result = setColumnWidth([], 0, 150, 3);
    assert.equal(result.length, 3);
    assert.equal(result[0], 150);
    assert.equal(result[1], '');
    assert.equal(result[2], '');
});

test('overwrites existing width at colIdx', function() {
    var result = setColumnWidth([100, 200, 150], 1, 250, 3);
    assert.equal(result[1], 250);
    assert.equal(result[0], 100);
    assert.equal(result[2], 150);
});

test('handles undefined columnWidths', function() {
    var result = setColumnWidth(undefined, 0, 180, 2);
    assert.equal(result.length, 2);
    assert.equal(result[0], 180);
    assert.equal(result[1], '');
});

test('sets width for last column', function() {
    var result = setColumnWidth(['', '', ''], 2, 300, 3);
    assert.equal(result[2], 300);
});

test('preserves existing widths when setting a new one', function() {
    var result = setColumnWidth([100, '', 150], 1, 200, 3);
    assert.equal(result[0], 100);
    assert.equal(result[1], 200);
    assert.equal(result[2], 150);
});

// ============================================================
// TESTS: Integration scenarios
// ============================================================

console.log('\n\u2500\u2500\u2500 Table: Integration scenarios \u2500\u2500\u2500');

test('simulates column creation: add column then set width', function() {
    // Simulate adding a 4th column: headers increase, columnWidths should sync
    var columnWidths = [120, 200, 150];
    var newHeaderCount = 4;

    // After insert-col-right in toolbar, tableData.columnWidths is synced
    var synced = syncColumnWidths(columnWidths, newHeaderCount);
    assert.equal(synced.length, 4);
    assert.equal(synced[3], '', 'new column should start with empty width');

    // User resizes new column
    var updated = setColumnWidth(synced, 3, 180, 4);
    assert.equal(updated[3], 180);
});

test('simulates column deletion: columnWidths should be re-synced on render', function() {
    // Simulate deleting column at index 1: headers.length becomes 2
    // On re-render, the while loop syncs columnWidths to match
    var columnWidths = [120, 200, 150];

    // After deletion, the render loop would create tableData.columnWidths from scratch
    // Since the table re-renders entirely, columnWidths from the previous render
    // would have been saved and then re-loaded. For a deleted column, the width
    // entry is removed by the splice in the toolbar action, and columnWidths
    // gets synced on re-render.
    
    // Simulate the toolbar action (splice on header also does splice on columnWidths)
    columnWidths.splice(1, 1);
    assert.equal(columnWidths.length, 2);
    assert.equal(columnWidths[0], 120);
    assert.equal(columnWidths[1], 150);
});

test('simulates resize then re-render: widths persist', function() {
    // Set widths via setColumnWidth
    var columnWidths = ['', '', ''];
    columnWidths = setColumnWidth(columnWidths, 0, 120, 3);
    columnWidths = setColumnWidth(columnWidths, 1, 200, 3);
    columnWidths = setColumnWidth(columnWidths, 2, 150, 3);

    // Simulate re-render: getStyleWidth for each column
    assert.equal(getColumnStyleWidth(columnWidths, 0), '120px');
    assert.equal(getColumnStyleWidth(columnWidths, 1), '200px');
    assert.equal(getColumnStyleWidth(columnWidths, 2), '150px');
});

test('simulates full table lifecycle: create → resize → add column → resize → delete column', function() {
    // Start: new 3-column table
    var columnWidths = syncColumnWidths([], 3);
    assert.equal(columnWidths.length, 3);

    // Resize col 0 to 150px
    columnWidths = setColumnWidth(columnWidths, 0, 150, 3);
    assert.equal(getColumnStyleWidth(columnWidths, 0), '150px');

    // Add column at index 1 (+ Col Right)
    columnWidths.splice(1, 0, ''); // emulate toolbar insert-col-right
    columnWidths = syncColumnWidths(columnWidths, 4); // headers now 4
    assert.equal(columnWidths.length, 4);
    assert.equal(getColumnStyleWidth(columnWidths, 0), '150px', 'previous width should survive');
    assert.equal(columnWidths[1], '', 'new column has no width');

    // Resize new column
    columnWidths = setColumnWidth(columnWidths, 1, 180, 4);
    assert.equal(columnWidths[1], 180);

    // Delete column at index 2
    columnWidths.splice(2, 1);
    columnWidths = syncColumnWidths(columnWidths, 3); // headers now 3
    assert.equal(columnWidths.length, 3);
    assert.equal(getColumnStyleWidth(columnWidths, 0), '150px', 'col 0 width should survive');
    assert.equal(columnWidths[1], 180, 'col 1 width should survive');
    assert.equal(columnWidths[2], '', 'col 3 was deleted');
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
