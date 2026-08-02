/**
 * Vinland Note Lookup Maps - Unit Tests (Sprint C / M1)
 *
 * Tests the O(1) id/title lookup maps added to Store.js:
 *   - getNote(id) / getNoteByTitle(title) correctness
 *   - lazy rebuild when the State.NOTES array reference or length changes
 *   - reference stability (in-place edits are visible without rebuild)
 *   - first-match-wins for duplicate titles
 *   - invalidation via _invalidateNoteMaps()
 *
 * Run with: node tests/note-maps-unit-tests.mjs
 * (aggregated by tests/run-all.mjs)
 */

import assert from 'node:assert/strict';

// ------------------------------------------------------------
// Import REAL Store module (no DOM/IDB needed for the maps)
// ------------------------------------------------------------
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

function freshNotes() {
  State.NOTES = [
    { id: 'n1', title: 'Alpha', content: 'a' },
    { id: 'n2', title: 'Beta', content: 'b' },
    { id: 'n3', title: '', content: 'c' }, // untitled
  ];
  State._invalidateNoteMaps();
}

// ------------------------------------------------------------

test('getNote: finds by id, returns undefined for missing', () => {
  freshNotes();
  const note = State.getNote('n2');
  assert.equal(note.title, 'Beta');
  assert.equal(State.getNote('nope'), undefined);
  assert.equal(State.getNote(null), undefined);
  assert.equal(State.getNote(''), undefined);
});

test('getNoteByTitle: case-insensitive, first-match-wins', () => {
  freshNotes();
  assert.equal(State.getNoteByTitle('beta').id, 'n2');
  assert.equal(State.getNoteByTitle('BETA').id, 'n2');
  assert.equal(State.getNoteByTitle('Alpha').id, 'n1');
  assert.equal(State.getNoteByTitle('missing'), undefined);

  // Duplicate titles: first in array wins
  State.NOTES.push({ id: 'n4', title: 'Alpha', content: 'dup' });
  State._invalidateNoteMaps();
  assert.equal(State.getNoteByTitle('alpha').id, 'n1', 'first Alpha should win');
});

test('lazy rebuild: length change (push) is picked up without explicit invalidation', () => {
  freshNotes();
  State.getNote('n1'); // build maps
  State.NOTES.push({ id: 'n5', title: 'Gamma', content: 'g' });
  // No _invalidateNoteMaps() — the length check must trigger the rebuild
  assert.equal(State.getNote('n5').title, 'Gamma');
  assert.equal(State.getNoteByTitle('gamma').id, 'n5');
});

test('lazy rebuild: array reference change (reassignment) is picked up', () => {
  freshNotes();
  State.getNote('n1'); // build maps against first array
  State.NOTES = [{ id: 'n9', title: 'Zeta', content: 'z' }];
  assert.equal(State.getNote('n9').title, 'Zeta');
  assert.equal(State.getNote('n1'), undefined, 'old note gone from new array');
});

test('lazy rebuild: splice removal is picked up via length change', () => {
  freshNotes();
  State.getNote('n1');
  State.NOTES.splice(0, 1); // remove n1
  assert.equal(State.getNote('n1'), undefined, 'removed note should be gone');
  assert.equal(State.getNote('n2').id, 'n2', 'remaining note still found');
});

test('reference stability: in-place edits need no rebuild', () => {
  freshNotes();
  const note = State.getNote('n1');
  note.content = 'updated in place';
  assert.equal(State.getNote('n1').content, 'updated in place', 'same object reference');
  assert.equal(State.getNote('n1'), note, 'identical object returned');
});

test('_invalidateNoteMaps: title map rebuilds after invalidation, id map stays warm', () => {
  freshNotes();
  State.getNote('n1'); // build both maps
  // Simulate a saveData-style rename: in-place title mutation + invalidate
  State.getNote('n1').title = 'Renamed';
  State._invalidateNoteMaps();
  // id map: no structural change, stays warm (O(1), no rebuild needed)
  assert.equal(State.getNote('n1').title, 'Renamed', 'id map reflects in-place edit via reference');
  // title map: dirty flag forces rebuild so the NEW title resolves
  assert.equal(State.getNoteByTitle('renamed').id, 'n1');
  assert.equal(State.getNoteByTitle('alpha'), undefined, 'old title no longer resolves after rename');
});

test('_invalidateNoteMaps: id map also picks up structural adds without full rebuild', () => {
  freshNotes();
  State.getNote('n1'); // build
  State.NOTES.push({ id: 'n6', title: 'Delta' });
  State._invalidateNoteMaps();
  // getNote detects the length change itself (ref+length check) and rebuilds
  assert.equal(State.getNote('n6').id, 'n6');
  assert.equal(State.getNoteByTitle('delta').id, 'n6');
});

test('title map: skips empty titles (untitled notes are id-addressable only)', () => {
  freshNotes();
  assert.equal(State.getNoteByTitle(''), undefined, 'empty title lookup is a no-op');
  assert.equal(State.getNote('n3').id, 'n3', 'untitled note still found by id');
});

// ------------------------------------------------------------
console.log('\n══════════════════════════════════════════════════');
console.log(`  NOTE MAPS SUITE: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');

if (errors.length > 0) {
  console.log('FAILURES:');
  errors.forEach((e) => console.log(`  • ${e.name}: ${e.error}`));
  console.log('');
}

process.exit(failed > 0 ? 1 : 0);
