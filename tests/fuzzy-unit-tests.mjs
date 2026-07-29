/**
 * Vinland Fuzzy Matching — Unit Tests
 *
 * Tests the _fuzzyMatch() algorithm used by CommandRegistry.search()
 * for CLI command suggestions.
 *
 * Run with: node tests/fuzzy-unit-tests.mjs
 * (aggregated by tests/run-all.mjs)
 */

import assert from 'node:assert/strict';
import { _fuzzyMatch } from '../js/core/CommandRegistry.js';

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

function assertScore(query, target, expected, label) {
    var result = _fuzzyMatch(query, target);
    var msg = label || ('_fuzzyMatch("' + query + '", "' + target + '") → score=' + result.score);
    assert.ok(result.score >= expected.low && result.score <= expected.high, msg + ' expected range [' + expected.low + '-' + expected.high + '] but got ' + result.score);
}

function assertNoMatch(query, target, label) {
    var result = _fuzzyMatch(query, target);
    var msg = label || ('_fuzzyMatch("' + query + '", "' + target + '") → score=' + result.score + ' (expected 0)');
    assert.equal(result.score, 0, msg);
}

function assertExactMatch(query, target, label) {
    var result = _fuzzyMatch(query, target);
    var msg = label || ('_fuzzyMatch("' + query + '", "' + target + '") → score=100 (expected)');
    assert.equal(result.score, 100, msg);
}

function assertPrefixMatch(query, target, label) {
    var result = _fuzzyMatch(query, target);
    var msg = label || ('_fuzzyMatch("' + query + '", "' + target + '") → score=90 (expected)');
    assert.equal(result.score, 90, msg);
}

function assertSubstringMatch(query, target, label) {
    var result = _fuzzyMatch(query, target);
    var msg = label || ('_fuzzyMatch("' + query + '", "' + target + '") → score=70 (expected)');
    assert.equal(result.score, 70, msg);
}

// ============================================================
// TESTS: Exact matches (score 100)
// ============================================================

console.log('\n─── Exact matches ───');

test('exact match on trigger "note"', function() {
    assertExactMatch('note', 'note');
});

test('exact match on title "Create New Note"', function() {
    assertExactMatch('create new note', 'create new note');
});

test('exact match is case-insensitive', function() {
    assertExactMatch('NOTE', 'note');
    assertExactMatch('Note', 'note');
    assertExactMatch('note', 'NOTE');
});

test('exact match on single character "h"', function() {
    assertExactMatch('h', 'h');
});

test('exact match on multi-word trigger "clear done"', function() {
    assertExactMatch('clear done', 'clear done');
});

// ============================================================
// TESTS: Prefix matches (score 90)
// ============================================================

console.log('\n─── Prefix matches ───');

test('prefix match "not" → "note"', function() {
    assertPrefixMatch('not', 'note');
});

test('prefix match "cre" → "create"', function() {
    assertPrefixMatch('cre', 'create');
});

test('prefix match "hel" → "help"', function() {
    assertPrefixMatch('hel', 'help');
});

test('prefix match on multi-word "clear d" → "clear done"', function() {
    assertPrefixMatch('clear d', 'clear done');
});

test('prefix match "sear" → "search notes"', function() {
    assertPrefixMatch('sear', 'search notes');
});

// ============================================================
// TESTS: Substring matches (score 70)
// ============================================================

console.log('\n─── Substring matches ───');

test('substring match "ote" in "note"', function() {
    assertSubstringMatch('ote', 'note');
});

test('substring match "eat" in "Create New Note"', function() {
    assertSubstringMatch('eat', 'Create New Note');
});

test('substring match "rt" in "Export All Data"', function() {
    assertSubstringMatch('rt', 'Export All Data');
});

test('fuzzy "ograph" in "Local Graph Overview" (chars match in sequence, not substring)', function() {
    // 'ograph' matches as sequential fuzzy: o(1)→g(6)→r(7)→a(8)→p(9)→h(10)
    assertScore('ograph', 'Local Graph Overview', { low: 1, high: 89 });
});

// ============================================================
// TESTS: Fuzzy sequential matches (score 1-89)
// ============================================================

console.log('\n─── Fuzzy sequential matches ───');

test('fuzzy "createnote" → "Create New Note" (sequential chars)', function() {
    assertScore('createnote', 'Create New Note', { low: 1, high: 89 });
});

test('fuzzy "cnn" → "Create New Note" (acronym/initialism)', function() {
    assertScore('cnn', 'Create New Note', { low: 1, high: 89 });
});

test('fuzzy "wrk" → "Workspace Manager" (word boundaries)', function() {
    assertScore('wrk', 'Workspace Manager', { low: 1, high: 89 });
});

test('fuzzy "imp" → "Import Data from JSON Backup" (starts with)', function() {
    // 'imp' is a prefix of 'Import' — should score 90 (prefix match)
    assertPrefixMatch('imp', 'Import Data from JSON Backup');
});

test('fuzzy "bckp" → "Backup Download" (gap matching)', function() {
    assertScore('bckp', 'Backup Download', { low: 1, high: 89 });
});

test('fuzzy "fnd" → "Search Notes" (sequential but not prefix)', function() {
    // 'fnd' characters appear in 'Search Notes' in order: no direct match
    // Actually 'f' appears in 'Search' at position 3, 'n' at... let me check
    // 'Search Notes' → s,e,a,r,c,h, ,n,o,t,e,s
    // 'fnd' → f... no 'f' in 'Search Notes'. So this should be 0.
    assertNoMatch('fnd', 'Search Notes');
});

test('fuzzy "sch" → "Search Notes" (word-start bonus)', function() {
    assertScore('sch', 'Search Notes', { low: 1, high: 89 });
});

test('fuzzy "bms" → "Bookmark Search" (across word boundary)', function() {
    // 'b' from 'Bookmark', 'm' from 'Bookmark', 's' from 'Search'
    assertScore('bms', 'Bookmark Search', { low: 1, high: 89 });
});

test('fuzzy "dtv" → "Dataview Query" (initials-style)', function() {
    assertScore('dtv', 'Dataview Query', { low: 1, high: 89 });
});

test('fuzzy "cldn" → "Clear Done" (all chars present in order, d before n)', function() {
    // 'clear done' → c(0) l(1) d(5) n(7) — 'd' comes before 'n'
    // 'cldn' matches: c(0)→l(1)→d(5)→n(7) — sequential in order
    assertScore('cldn', 'Clear Done', { low: 1, high: 89 });
});

test('fuzzy "addtask" → "Add Task" (near-exact, gets very high score)', function() {
    // 'addtask' matches all 7 chars in order — only missing the space
    // Scores ~95 due to tight consecutive groups + word boundary on 't'
    assertScore('addtask', 'Add Task', { low: 85, high: 100 });
});

// ============================================================
// TESTS: No match (score 0)
// ============================================================

console.log('\n─── No match ───');

test('no match for completely different string', function() {
    assertNoMatch('xyz', 'Create New Note');
});

test('no match for reversed characters', function() {
    assertNoMatch('eton', 'note');  // 'e' not in 'note'
});

test('no match for empty query', function() {
    assertNoMatch('', 'anything');
});

test('no match for query in wrong order "eon" → "note"', function() {
    assertNoMatch('eon', 'note'); // 'e' in 'note'? no → 0
});

test('no match when query has extra char not in target', function() {
    assertNoMatch('notex', 'note');
});

test('no match for null/undefined target', function() {
    var r1 = _fuzzyMatch('test', null);
    assert.equal(r1.score, 0);
    var r2 = _fuzzyMatch('test', undefined);
    assert.equal(r2.score, 0);
});

test('no match for null/undefined query', function() {
    var r1 = _fuzzyMatch(null, 'test');
    assert.equal(r1.score, 0);
    var r2 = _fuzzyMatch(undefined, 'test');
    assert.equal(r2.score, 0);
});

// ============================================================
// TESTS: Matched indices (boolean array)
// ============================================================

console.log('\n─── Matched indices ───');

test('exact match has all true indices', function() {
    var result = _fuzzyMatch('note', 'note');
    assert.deepEqual(result.matched, [true, true, true, true]);
});

test('prefix match marks only prefix chars', function() {
    var result = _fuzzyMatch('not', 'note');
    assert.deepEqual(result.matched, [true, true, true, false]);
});

test('substring match marks only substring range', function() {
    var result = _fuzzyMatch('ote', 'note');
    assert.deepEqual(result.matched, [false, true, true, true]);
});

test('fuzzy match marks correct positions', function() {
    var result = _fuzzyMatch('cnn', 'Create New Note');
    // c at 0, n at 1 (from 'New'), n at 10 (from 'Note')
    // But wait, 'Create New Note' lowercase → 'create new note'
    // c=0 ✓, n=8 (from 'new'), n=12 (from 'note')... actually let me check
    // 'create new note' → c(0) r(1) e(2) a(3) t(4) e(5) (6) n(7) e(8) w(9) (10) n(11) o(12) t(13) e(14)
    // 'cnn' → c at 0, n at 7, n at 11
    assert.ok(result.matched[0] === true, 'c should match at index 0');
    assert.ok(result.matched[7] === true, 'first n should match at index 7 (from "new")');
    assert.ok(result.matched[11] === true, 'second n should match at index 11 (from "note")');
    assert.ok(result.score > 0, 'should have a positive score');
});

test('empty target returns empty matched array', function() {
    var result = _fuzzyMatch('n', '');
    assert.equal(result.score, 0);
    assert.deepEqual(result.matched, []);
});

// ============================================================
// TESTS: Score ordering (higher = better match)
// ============================================================

console.log('\n─── Score ordering ───');

test('prefix match scores higher than fuzzy match', function() {
    var prefix = _fuzzyMatch('no', 'note');
    var fuzzy = _fuzzyMatch('no', 'Create New Note');
    assert.ok(prefix.score > fuzzy.score, 'prefix match should score higher than fuzzy match');
});

test('fuzzy with consecutive chars scores higher than spread-out', function() {
    var tight = _fuzzyMatch('note', 'Create New Note'); // consecutive "note"
    var spread = _fuzzyMatch('ne', 'Create New Note');  // spread: n from New, e from Note
    // "note" should score higher because all chars are consecutive
    // Well actually "note" as a substring of "note" in "Create New Note" → substring match → 70
    assert.ok(tight.score >= spread.score, 'consecutive match should score >= spread match');
});

test('word boundary match scores higher than mid-word', function() {
    var boundary = _fuzzyMatch('n', 'New');  // 'n' at word start
    var midword = _fuzzyMatch('n', 'done'); // 'n' mid-word (index 3)
    // Both are prefix matches ('n' is a prefix of 'New', 'n' is NOT a prefix of 'done')
    // 'n' → 'done': not a prefix. It's a substring → 70
    // 'n' → 'New': prefix → 90
    assert.ok(boundary.score > midword.score, 'word-start match should score higher than mid-word');
});

test('short query ranks higher than longer query for same target', function() {
    var short = _fuzzyMatch('n', 'note');
    var long = _fuzzyMatch('notex', 'note');
    assert.ok(short.score > 0, 'short query should match');
    assert.equal(long.score, 0, 'long query with extra chars should not match');
});

// ============================================================
// SUMMARY
// ============================================================

console.log('\n══════════════════════════════════════════════════════════');
console.log('  RESULTS: ' + passed + ' passed, ' + failed + ' failed');
console.log('══════════════════════════════════════════════════════════\n');

if (errors.length > 0) {
    console.log('FAILURES:');
    errors.forEach(function(e) { console.log('  \u2022 ' + e.name + ': ' + e.error); });
    console.log('');
}

process.exit(failed > 0 ? 1 : 0);
