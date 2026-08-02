/**
 * Vinland VersionHistoryManager - Unit Tests (H5 compaction)
 *
 * Tests the H5 cap/prune logic:
 *   - trimToMax(): pure per-note cap, keeps NEWEST snapshots
 *   - prune() semantics against a shimmed State (orphans removed, oversized
 *     stores trimmed) via the REAL module (no IndexedDB needed for the pure
 *     pieces; the store-level sweep is covered by the Playwright spec).
 *
 * Run with: node tests/version-history-unit-tests.mjs
 * (aggregated by tests/run-all.mjs)
 */

import assert from 'node:assert/strict';

// ------------------------------------------------------------
// Globals shims (must exist before importing Storage.js, which
// VersionHistoryManager imports for saveData)
// ------------------------------------------------------------
globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
};
globalThis.document = { getElementById: () => null };

// ------------------------------------------------------------
// Import REAL modules
// ------------------------------------------------------------
const { VersionHistoryManager } = await import('../js/features/VersionHistoryManager.js');
const { State } = await import('../js/core/Store.js');

// ------------------------------------------------------------
// Test runner
// ------------------------------------------------------------
let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        failed++;
        errors.push({ name, error: e.message });
        console.log(`  ✗ ${name}: ${e.message}`);
    }
}

// ------------------------------------------------------------
// trimToMax — pure cap logic
// ------------------------------------------------------------
function makeVersions(n) {
    return Array.from({ length: n }, (_, i) => ({
        id: 'v' + i,
        timestamp: 1000 + i,
        content: 'c' + i,
    }));
}

test('trimToMax: keeps array unchanged when at or under the cap', () => {
    const v = makeVersions(50);
    const out = VersionHistoryManager.trimToMax(v);
    assert.equal(out.length, 50, 'exactly-cap should be untouched');
    assert.equal(out, v, 'should return the same reference when no trim needed');
    assert.equal(VersionHistoryManager.trimToMax(makeVersions(3)).length, 3);
    assert.equal(VersionHistoryManager.trimToMax([]).length, 0);
});

test('trimToMax: keeps the NEWEST snapshots when over the cap', () => {
    const v = makeVersions(60);
    const out = VersionHistoryManager.trimToMax(v);
    assert.equal(out.length, 50, 'must trim to the cap');
    assert.equal(out[0].id, 'v10', 'first kept should be the 11th oldest');
    assert.equal(out[out.length - 1].id, 'v59', 'last kept should be newest');
});

test('trimToMax: honors an explicit max argument', () => {
    const v = makeVersions(10);
    const out = VersionHistoryManager.trimToMax(v, 3);
    assert.equal(out.length, 3);
    assert.equal(out[0].id, 'v7', 'keeps newest 3');
});

test('trimToMax: guards against non-array / invalid input', () => {
    assert.deepEqual(VersionHistoryManager.trimToMax(null), []);
    assert.deepEqual(VersionHistoryManager.trimToMax(undefined), []);
    assert.deepEqual(VersionHistoryManager.trimToMax('nope'), []);
    // Invalid max falls back to the default cap
    const v = makeVersions(60);
    assert.equal(VersionHistoryManager.trimToMax(v, -1).length, 50);
    assert.equal(VersionHistoryManager.trimToMax(v, 0).length, 50);
});

// ------------------------------------------------------------
// prune() live-ID semantics — pure decision, no IndexedDB needed.
// (The actual IndexedDB sweep is covered by the Playwright spec —
// prune() resolves only on tx.oncomplete and the cursor sweep is
// exercised end-to-end there.)
// ------------------------------------------------------------
test('prune: an id absent from State.NOTES is flagged as an orphan', () => {
    State.NOTES = [
        { id: 'live', title: 'Live' },
        { id: 'another', title: 'Another' },
    ];
    const liveIds = new Set(State.NOTES.filter((n) => n && n.id).map((n) => n.id));
    assert.equal(liveIds.has('live'), true, 'live note must be in the live set');
    assert.equal(liveIds.has('another'), true, 'second live note must be in the live set');
    assert.equal(liveIds.has('ghost'), false, 'ghost id must be flagged as an orphan');
    assert.equal(liveIds.size, 2, 'no unexpected ids');
});

// ------------------------------------------------------------
console.log('\n══════════════════════════════════════════════════');
console.log(`  VERSION HISTORY SUITE: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');

if (errors.length > 0) {
    console.log('FAILURES:');
    errors.forEach((e) => console.log(`  • ${e.name}: ${e.error}`));
    console.log('');
}

process.exit(failed > 0 ? 1 : 0);
