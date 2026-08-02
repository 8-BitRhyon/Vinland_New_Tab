/**
 * Vinland Storage Sharding - Unit Tests
 *
 * Tests the REAL js/core/storage.js (per-note sharding) against the real
 * js/core/store.js State. No copied extracts - tests cannot drift from source.
 *
 * Run with: node tests/storage-shard.test.mjs
 * (aggregated by tests/run-all.mjs)
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

// ------------------------------------------------------------
// Globals shims (must exist before importing storage.js)
// ------------------------------------------------------------
const localStorageShim = (() => {
  const store = new Map();
  const writes = [];
  return {
    _writes: writes,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      store.set(k, String(v));
      writes.push(k);
    },
    removeItem: (k) => store.delete(k),
    clear: () => {
      store.clear();
      writes.length = 0;
    },
    has: (k) => store.has(k),
    raw: (k) => store.get(k),
  };
})();

globalThis.localStorage = localStorageShim;
globalThis.document = { getElementById: () => null };

// ------------------------------------------------------------
// Import REAL modules (shared cached State instance)
// ------------------------------------------------------------
import { State } from '../js/core/Store.js';
const storage = await import('../js/core/Storage.js');
const { loadData, saveData, saveAllNotes, clearAllNotes, markNoteDirty, markAllNotesDirty } = storage;

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
    console.log(`  ✗ ${name}`);
    console.log(`    → ${e.message}`);
  }
}

// Reset between cases: clear shim, zero State, rebuild internals via loadData()
function freshState() {
  localStorageShim.clear();
  State.TASKS = [];
  State.NOTES = [];
  State.BOARDS = [];
  State.CANVASES = [];
  State.COMMAND_HISTORY = [];
  loadData();
}

function noteShardKey(id) {
  return `OPERATOR_NOTE_${id}`;
}
function noteShardWrites() {
  // Count setItem calls for note shards (exclude the always-rewritten index)
  return localStorageShim._writes.filter(
    (k) => k.startsWith('OPERATOR_NOTE_') && k !== 'OPERATOR_NOTES_INDEX'
  );
}
function indexIds() {
  const raw = localStorageShim.raw('OPERATOR_NOTES_INDEX');
  return raw ? JSON.parse(raw) : [];
}

// ============================================================
console.log('\n─── storage.js per-note sharding ───');

test('(a) legacy migration shards OPERATOR_NOTES_V2 blob', () => {
  freshState();
  localStorageShim.clear();
  localStorageShim.setItem(
    'OPERATOR_NOTES_V2',
    JSON.stringify([
      { id: 'a', title: 'A', content: 'x' },
      { id: 'b', title: 'B', content: 'y' },
    ])
  );
  loadData();
  assert.equal(State.NOTES.length, 2, 'should hydrate 2 notes');
  assert.ok(localStorageShim.has(noteShardKey('a')), 'shard a missing');
  assert.ok(localStorageShim.has(noteShardKey('b')), 'shard b missing');
  assert.ok(!localStorageShim.has('OPERATOR_NOTES_V2'), 'legacy key not removed');
  assert.deepEqual(indexIds(), ['a', 'b'], 'index wrong');
});

test('(b) saveData diff-writes only the changed note shard', () => {
  freshState();
  localStorageShim.setItem(
    'OPERATOR_NOTES_V2',
    JSON.stringify([
      { id: 'a', title: 'A', content: 'x' },
      { id: 'b', title: 'B', content: 'y' },
    ])
  );
  loadData();
  localStorageShim._writes.length = 0; // reset measurement

  State.NOTES[0].content = 'x2';
  saveData();

  const shardWrites = noteShardWrites();
  assert.equal(shardWrites.length, 1, 'expected exactly 1 shard write, got ' + shardWrites.length);
  assert.equal(shardWrites[0], noteShardKey('a'), 'wrong shard written');
  assert.equal(JSON.parse(localStorageShim.raw(noteShardKey('a'))).content, 'x2', 'edit not persisted');
  assert.equal(JSON.parse(localStorageShim.raw(noteShardKey('b'))).content, 'y', 'other note mutated');
});

test('(c) reload round-trips edited content from shards', () => {
  freshState();
  localStorageShim.setItem(
    'OPERATOR_NOTES_V2',
    JSON.stringify([{ id: 'a', title: 'A', content: 'x' }])
  );
  loadData();
  State.NOTES[0].content = 'persisted';
  saveData();

  State.NOTES = [];
  loadData();
  assert.equal(State.NOTES.length, 1, 'reload hydrate len');
  assert.equal(State.NOTES[0].content, 'persisted', 'edited content lost on reload');
});

test('(d) deleting a note removes its orphaned shard + updates index', () => {
  freshState();
  localStorageShim.setItem(
    'OPERATOR_NOTES_V2',
    JSON.stringify([
      { id: 'a', title: 'A', content: 'x' },
      { id: 'b', title: 'B', content: 'y' },
    ])
  );
  loadData();
  State.NOTES.shift(); // remove 'a'
  saveData();
  assert.ok(!localStorageShim.has(noteShardKey('a')), 'orphan shard not removed');
  assert.ok(localStorageShim.has(noteShardKey('b')), 'surviving shard wrongly removed');
  assert.deepEqual(indexIds(), ['b'], 'index not updated after delete');
});

test('(e) clearAllNotes removes all shards + index', () => {
  freshState();
  localStorageShim.setItem(
    'OPERATOR_NOTES_V2',
    JSON.stringify([{ id: 'a', title: 'A', content: 'x' }])
  );
  loadData();
  clearAllNotes();
  assert.ok(!localStorageShim.has(noteShardKey('a')), 'clearAllNotes left a note key');
  assert.ok(!localStorageShim.has('OPERATOR_NOTES_INDEX'), 'clearAllNotes left the index');
});

test('(f) small collections persist via saveData', () => {
  freshState();
  State.TASKS = [{ id: 't1', text: 'do thing' }];
  saveData();
  const raw = localStorageShim.raw('OPERATOR_TASKS_V2');
  assert.ok(raw, 'TASKS not written');
  assert.deepEqual(JSON.parse(raw), [{ id: 't1', text: 'do thing' }], 'TASKS content wrong');
});

test('(g) no-op save produces no new shard writes', () => {
  freshState();
  localStorageShim.setItem(
    'OPERATOR_NOTES_V2',
    JSON.stringify([{ id: 'a', title: 'A', content: 'x' }])
  );
  loadData();
  saveData();
  localStorageShim._writes.length = 0; // reset after first save
  saveData(); // identical state
  assert.equal(noteShardWrites().length, 0, 'expected 0 new shard writes, got ' + noteShardWrites().length);
});

test('(h) malformed shard is skipped without throwing', () => {
  freshState();
  localStorageShim.clear();
  localStorageShim.setItem(noteShardKey('a'), JSON.stringify({ id: 'a', title: 'A' }));
  localStorageShim.setItem(noteShardKey('b'), '{ this is not valid json');
  localStorageShim.setItem('OPERATOR_NOTES_INDEX', JSON.stringify(['a', 'b']));
  loadData();
  assert.equal(State.NOTES.length, 1, 'should hydrate only the valid shard');
  assert.equal(State.NOTES[0].id, 'a', 'wrong note hydrated');
});

test('(i) saveAllNotes fully resyncs every shard + index', () => {
  freshState();
  localStorageShim.clear();
  State.NOTES = [
    { id: 'a', title: 'A', content: 'x' },
    { id: 'b', title: 'B', content: 'y' },
  ];
  saveAllNotes();
  assert.ok(localStorageShim.has(noteShardKey('a')), 'shard a missing after saveAllNotes');
  assert.ok(localStorageShim.has(noteShardKey('b')), 'shard b missing after saveAllNotes');
  assert.deepEqual(indexIds(), ['a', 'b'], 'index wrong after saveAllNotes');
});

test('(j) canvas note offload writes _external marker, not full canvasData', () => {
  freshState();
  localStorageShim.clear();
  State.NOTES = [{
    id: 'canvas_1',
    title: 'C',
    type: 'canvas',
    canvasData: { nodes: [{ id: 'node_1', title: 'n' }], edges: [] },
  }];
  saveData();
  const raw = localStorageShim.raw(noteShardKey('canvas_1'));
  assert.ok(raw, 'canvas shard not written');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.canvasData && parsed.canvasData._external, true, 'shard should carry _external marker');
  assert.ok(!raw.includes('node_1'), 'canvas payload should not be in localStorage shard');
});

test('(k) non-canvas note serializes normally (no marker)', () => {
  freshState();
  localStorageShim.clear();
  State.NOTES = [{ id: 'n1', title: 'N', content: 'hello' }];
  saveData();
  const parsed = JSON.parse(localStorageShim.raw(noteShardKey('n1')));
  assert.equal(parsed.canvasData, undefined, 'non-canvas note should not get canvasData marker');
  assert.equal(parsed.content, 'hello', 'content wrong for non-canvas note');
});

test('(l) dirty-set: saveData re-serializes only marked notes', () => {
  freshState();
  localStorageShim.setItem(
    'OPERATOR_NOTES_V2',
    JSON.stringify([
      { id: 'a', title: 'A', content: 'x' },
      { id: 'b', title: 'B', content: 'y' },
    ])
  );
  loadData();
  saveData(); // full scan (empty dirty) — hydrates diff caches
  localStorageShim._writes.length = 0;

  State.NOTES[0].content = 'x2';
  markNoteDirty('a');
  saveData(); // dirty-only

  const shardWrites = noteShardWrites();
  assert.equal(shardWrites.length, 1, 'expected exactly 1 shard write via dirty-set');
  assert.equal(shardWrites[0], noteShardKey('a'), 'wrong shard written via dirty-set');
  assert.equal(JSON.parse(localStorageShim.raw(noteShardKey('a'))).content, 'x2', 'edit not persisted');
});

test('(m) unmarked mutations persist via the full-scan fallback (no data loss)', () => {
  freshState();
  localStorageShim.setItem(
    'OPERATOR_NOTES_V2',
    JSON.stringify([
      { id: 'a', title: 'A', content: 'x' },
      { id: 'b', title: 'B', content: 'y' },
    ])
  );
  loadData();
  saveData();
  localStorageShim._writes.length = 0;

  // Mutate WITHOUT marking — the safety fallback must still persist it.
  State.NOTES[1].content = 'y2';
  saveData();

  const shardWrites = noteShardWrites();
  assert.equal(shardWrites.length, 1, 'fallback should write the changed shard');
  assert.equal(shardWrites[0], noteShardKey('b'), 'wrong shard written by fallback');
  assert.equal(JSON.parse(localStorageShim.raw(noteShardKey('b'))).content, 'y2', 'unmarked edit lost');
});

test('(n) saveData(true) persists unmarked notes even when the dirty-set is non-empty', () => {
  freshState();
  State.NOTES = [
    { id: 'a', title: 'A', content: 'x' },
    { id: 'b', title: 'B', content: 'y' },
  ];
  saveData();
  localStorageShim._writes.length = 0;

  // Mark only 'a' dirty, but mutate 'b' unmarked (simulates a missed mark).
  markNoteDirty('a');
  State.NOTES[0].content = 'x2';
  State.NOTES[1].content = 'y2';
  saveData(true); // beforeunload-style forced save

  const shardWrites = noteShardWrites();
  assert.equal(shardWrites.length, 2, 'forced save must persist both notes');
  assert.equal(JSON.parse(localStorageShim.raw(noteShardKey('b'))).content, 'y2', 'unmarked note not persisted by forced save');
});

test('(o) unpersisted new note forces full scan even with a non-empty dirty-set', () => {
  freshState();
  State.NOTES = [{ id: 'a', title: 'A', content: 'x' }];
  saveData();
  localStorageShim._writes.length = 0;

  // Mark 'a' dirty AND push a brand-new note that was never written to disk.
  // The safety net must promote this to a full scan so the new note cannot
  // be skipped by the dirty-only path (importers/autocomplete/duplicate).
  markNoteDirty('a');
  State.NOTES[0].content = 'x2';
  State.NOTES.push({ id: 'fresh', title: 'Fresh', content: 'z' });
  saveData();

  const shardWrites = noteShardWrites();
  assert.equal(shardWrites.length, 2, 'safety net must persist both notes');
  assert.equal(JSON.parse(localStorageShim.raw(noteShardKey('fresh'))).content, 'z', 'new note lost');
  assert.equal(JSON.parse(localStorageShim.raw(noteShardKey('a'))).content, 'x2', 'dirty note not persisted');
});

// ============================================================
console.log('\n══════════════════════════════════════════════════');
console.log(`  STORAGE SUITE: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');

if (errors.length > 0) {
  console.log('FAILURES:');
  errors.forEach((e) => console.log(`  • ${e.name}: ${e.error}`));
  console.log('');
}

process.exit(failed > 0 ? 1 : 0);
