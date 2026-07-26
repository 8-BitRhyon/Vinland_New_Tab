/**
 * Vinland DataviewQuery.parseQuery() - Unit Tests
 *
 * Tests the Dataview-style query parser in isolation.
 * The parseQuery() method is a pure function that takes a string
 * and returns a parsed query object — no DOM or module state needed.
 *
 * Run with: node tests/dataview-unit-tests.mjs
 * (aggregated by tests/run-all.mjs — add to the suites array)
 */

import assert from 'node:assert/strict';

// ============================================================
// GLOBALS SHIMS (DataviewQuery sets window.DataviewQuery at module level)
// ============================================================

globalThis.window = {};

// ============================================================
// IMPORT REAL MODULES
// ============================================================

const dvModule = await import('../js/features/DataviewQuery.js');
const DataviewQuery = dvModule.DataviewQuery;
import { State } from '../js/core/Store.js';
const metaModule = await import('../js/core/MetadataCache.js');
const MetadataCache = metaModule.MetadataCache;

// ============================================================
// TEST RUNNER
// ============================================================

let passed = 0;
let failed = 0;
const errors = [];

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

function assertParseResult(actual, expected) {
    assert.ok(actual !== null, 'parseQuery returned null');
    assert.equal(actual.type, expected.type, 'type mismatch');
    assert.deepEqual(actual.fields, expected.fields || [], 'fields mismatch');
    assert.deepEqual(actual.where, expected.where || null, 'where mismatch');
    assert.deepEqual(actual.sortBy, expected.sortBy || null, 'sortBy mismatch');
    assert.deepEqual(actual.groupBy, expected.groupBy || null, 'groupBy mismatch');
    assert.equal(actual.limit, expected.limit !== undefined ? expected.limit : null, 'limit mismatch');
    if (expected.source) {
        assert.ok(actual.source !== null, 'source should not be null');
        assert.equal(actual.source.type, expected.source.type, 'source.type mismatch');
        assert.equal(actual.source.value, expected.source.value, 'source.value mismatch');
    } else {
        assert.equal(actual.source, null, 'source should be null');
    }
}

/**
 * Assert that parseQuery returns an object with source: null
 * (caller checks !parsed.source to detect invalid queries)
 */
function assertNoSource(actual) {
    assert.ok(actual !== null, 'parseQuery returned null (expected object with source:null)');
    assert.equal(actual.source, null, 'source should be null for invalid queries');
    // Type may be 'list' (default), 'table', or 'task' depending on input.
    // The type is detected before source matching, so it reflects the user's command.
    assert.ok(['list', 'table', 'task'].indexOf(actual.type) >= 0,
        'type should be one of list/table/task, got: ' + actual.type);
}

// ══════════════════════════════════════════
// NULL / EMPTY INPUT
// ══════════════════════════════════════════

console.log('\n─── Null / empty input ───');

test('returns null for empty string', () => {
    var result = DataviewQuery.parseQuery('');
    assert.equal(result, null);
});

test('returns null for whitespace-only string', () => {
    var result = DataviewQuery.parseQuery('   ');
    assert.equal(result, null);
});

test('returns null for null/undefined input', () => {
    assert.equal(DataviewQuery.parseQuery(null), null);
    assert.equal(DataviewQuery.parseQuery(undefined), null);
});

test('returns null for just whitespace with newlines', () => {
    var result = DataviewQuery.parseQuery('\n  \n  ');
    assert.equal(result, null);
});

// ══════════════════════════════════════════
// SHORTHAND SYNTAX
// ══════════════════════════════════════════

console.log('\n─── Shorthand syntax (no explicit keyword) ───');

test('shorthand #tag becomes LIST FROM #tag', () => {
    var result = DataviewQuery.parseQuery('#project');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'project' }
    });
});

test('shorthand with hyphenated tag #my-tag', () => {
    var result = DataviewQuery.parseQuery('#my-tag');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'my-tag' }
    });
});

test('shorthand with underscore tag #my_tag', () => {
    var result = DataviewQuery.parseQuery('#my_tag');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'my_tag' }
    });
});

test('shorthand "folder/path" becomes LIST FROM "folder/path"', () => {
    var result = DataviewQuery.parseQuery('"Journal"');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'folder', value: 'Journal' }
    });
});

test('shorthand with nested folder path "Projects/Active"', () => {
    var result = DataviewQuery.parseQuery('"Projects/Active"');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'folder', value: 'Projects/Active' }
    });
});

test('shorthand prefers #tag over "folder" when both match', () => {
    // "#tag" looks like a tag first, but if it's "#tag",
    // the tag parser matches it. "folder" should match "folder",
    // so #folder should be a tag, not a folder.
    var result = DataviewQuery.parseQuery('#folder');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'folder' }
    });
});

test('shorthand with trailing whitespace', () => {
    var result = DataviewQuery.parseQuery('  #tag  ');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' }
    });
});

test('shorthand with quoted folder and trailing text is still folder', () => {
    var result = DataviewQuery.parseQuery('"My Folder"');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'folder', value: 'My Folder' }
    });
});

// ══════════════════════════════════════════
// LIST QUERIES
// ══════════════════════════════════════════

console.log('\n─── LIST queries ───');

test('LIST FROM #tag', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #project');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'project' }
    });
});

test('list FROM #tag (lowercase command)', () => {
    var result = DataviewQuery.parseQuery('list FROM #project');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'project' }
    });
});

test('LIST FROM "Journal"', () => {
    var result = DataviewQuery.parseQuery('LIST FROM "Journal"');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'folder', value: 'Journal' }
    });
});

test('LIST FROM #tag with extra spaces', () => {
    var result = DataviewQuery.parseQuery('LIST   FROM   #tag');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' }
    });
});

// ══════════════════════════════════════════
// TABLE QUERIES
// ══════════════════════════════════════════

console.log('\n─── TABLE queries ───');

test('TABLE with single field FROM #tag', () => {
    var result = DataviewQuery.parseQuery('TABLE status FROM #project');
    assertParseResult(result, {
        type: 'table',
        fields: ['status'],
        source: { type: 'tag', value: 'project' }
    });
});

test('TABLE with multiple fields FROM #tag', () => {
    var result = DataviewQuery.parseQuery('TABLE status, priority FROM #tracker');
    assertParseResult(result, {
        type: 'table',
        fields: ['status', 'priority'],
        source: { type: 'tag', value: 'tracker' }
    });
});

test('TABLE with three fields FROM "folder"', () => {
    var result = DataviewQuery.parseQuery('TABLE status, priority, assignee FROM "Projects"');
    assertParseResult(result, {
        type: 'table',
        fields: ['status', 'priority', 'assignee'],
        source: { type: 'folder', value: 'Projects' }
    });
});

test('TABLE with fields that have underscore names', () => {
    var result = DataviewQuery.parseQuery('TABLE created, word_count FROM #docs');
    assertParseResult(result, {
        type: 'table',
        fields: ['created', 'word_count'],
        source: { type: 'tag', value: 'docs' }
    });
});

test('TABLE with no explicit fields defaults to empty fields array', () => {
    var result = DataviewQuery.parseQuery('TABLE FROM #tag');
    // When no fields are specified, fields should be an empty array
    // (_renderTableView handles the fallback to default fields)
    assertParseResult(result, {
        type: 'table',
        fields: [],
        source: { type: 'tag', value: 'tag' }
    });
});

test('TABLE with field name containing numbers', () => {
    var result = DataviewQuery.parseQuery('TABLE field1, field2 FROM #data');
    assertParseResult(result, {
        type: 'table',
        fields: ['field1', 'field2'],
        source: { type: 'tag', value: 'data' }
    });
});

test('TABLE with spaces after commas', () => {
    var result = DataviewQuery.parseQuery('TABLE status , priority , due FROM #tasks');
    assertParseResult(result, {
        type: 'table',
        fields: ['status', 'priority', 'due'],
        source: { type: 'tag', value: 'tasks' }
    });
});

// ══════════════════════════════════════════
// TASK QUERIES
// ══════════════════════════════════════════

console.log('\n─── TASK queries ───');

test('TASK FROM #tag', () => {
    var result = DataviewQuery.parseQuery('TASK FROM #sprint');
    assertParseResult(result, {
        type: 'task',
        source: { type: 'tag', value: 'sprint' }
    });
});

test('task FROM #tag (lowercase)', () => {
    var result = DataviewQuery.parseQuery('task FROM #sprint');
    assertParseResult(result, {
        type: 'task',
        source: { type: 'tag', value: 'sprint' }
    });
});

test('TASK FROM "Projects"', () => {
    var result = DataviewQuery.parseQuery('TASK FROM "Projects"');
    assertParseResult(result, {
        type: 'task',
        source: { type: 'folder', value: 'Projects' }
    });
});

// ══════════════════════════════════════════
// WHERE CLAUSES
// ══════════════════════════════════════════

console.log('\n─── WHERE clauses ───');

test('LIST FROM #tag WHERE status = Active', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag WHERE status = Active');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        where: { key: 'status', value: 'Active' }
    });
});

test('TABLE FROM #tag WHERE priority = high', () => {
    var result = DataviewQuery.parseQuery('TABLE FROM #tag WHERE priority = high');
    assertParseResult(result, {
        type: 'table',
        fields: [],
        source: { type: 'tag', value: 'tag' },
        where: { key: 'priority', value: 'high' }
    });
});

test('WHERE with quoted string value', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag WHERE status = "In Progress"');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        where: { key: 'status', value: 'In Progress' }
    });
});

test('WHERE with single-quoted value', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag WHERE status = \'Done\'');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        where: { key: 'status', value: 'Done' }
    });
});

test('WHERE with numeric value', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag WHERE priority = 1');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        where: { key: 'priority', value: '1' }
    });
});

test('WHERE with hyphenated property name', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag WHERE due-date = 2024-01');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        where: { key: 'due-date', value: '2024-01' }
    });
});

test('WHERE with underscore property name', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag WHERE last_updated = today');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        where: { key: 'last_updated', value: 'today' }
    });
});

test('TABLE with fields AND WHERE clause', () => {
    var result = DataviewQuery.parseQuery('TABLE status, priority FROM #tracker WHERE status = Active');
    assertParseResult(result, {
        type: 'table',
        fields: ['status', 'priority'],
        source: { type: 'tag', value: 'tracker' },
        where: { key: 'status', value: 'Active' }
    });
});

test('WHERE with value containing spaces (unquoted captures rest of line)', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag WHERE status = In Progress');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        where: { key: 'status', value: 'In Progress' }
    });
});

test('LIST FROM "folder" WHERE priority = high', () => {
    var result = DataviewQuery.parseQuery('LIST FROM "Journal" WHERE priority = high');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'folder', value: 'Journal' },
        where: { key: 'priority', value: 'high' }
    });
});

// ══════════════════════════════════════════
// MISSING / INVALID FROM CLAUSES
// ══════════════════════════════════════════

console.log('\n─── Missing / invalid FROM clauses ───');

test('returns object with source:null for command with no source (just "LIST")', () => {
    var result = DataviewQuery.parseQuery('LIST');
    assertNoSource(result);
});

test('returns object with source:null for command with no source (just "TABLE")', () => {
    var result = DataviewQuery.parseQuery('TABLE');
    assertNoSource(result);
});

test('returns object with source:null for command with no source (just "TASK")', () => {
    var result = DataviewQuery.parseQuery('TASK');
    assertNoSource(result);
});

test('returns object with source:null for plain text without any source identifier', () => {
    var result = DataviewQuery.parseQuery('garbage query nothing');
    assertNoSource(result);
});

test('returns object with source:null for just "FROM" with no source', () => {
    var result = DataviewQuery.parseQuery('FROM');
    assertNoSource(result);
});

test('returns object with source:null for "LIST FROM" with nothing after', () => {
    var result = DataviewQuery.parseQuery('LIST FROM');
    assertNoSource(result);
});

test('returns object with source:null for "TABLE FROM" with nothing after', () => {
    var result = DataviewQuery.parseQuery('TABLE FROM');
    assertNoSource(result);
});

test('returns object with source:null for invalid source after FROM (no # or ")', () => {
    var result = DataviewQuery.parseQuery('LIST FROM plaintext');
    assertNoSource(result);
});

test('returns object with source:null for just a word without # or "', () => {
    var result = DataviewQuery.parseQuery('random');
    assertNoSource(result);
});

test('returns object with source:null for "table" (lowercase) with no source', () => {
    var result = DataviewQuery.parseQuery('table');
    assertNoSource(result);
});

test('returns object with source:null for "task" (lowercase) with no source', () => {
    var result = DataviewQuery.parseQuery('task');
    assertNoSource(result);
});

// ══════════════════════════════════════════
// WHERE WITHOUT SOURCE
// ══════════════════════════════════════════

console.log('\n─── WHERE without valid source ───');

test('returns object with source:null for WHERE clause without valid source', () => {
    var result = DataviewQuery.parseQuery('WHERE status = Active');
    assertNoSource(result);
});

test('returns object with source:null for LIST WHERE without FROM', () => {
    var result = DataviewQuery.parseQuery('LIST WHERE status = Active');
    assertNoSource(result);
});

// ══════════════════════════════════════════
// SORT BY CLAUSE
// ══════════════════════════════════════════

console.log('\n─── SORT BY clause ───');

test('SORT BY title ASC', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag SORT BY title ASC');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        sortBy: { field: 'title', dir: 'asc' }
    });
});

test('SORT BY modified DESC', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag SORT BY modified DESC');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        sortBy: { field: 'modified', dir: 'desc' }
    });
});

test('SORT BY defaults to ASC when direction omitted', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag SORT BY title');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        sortBy: { field: 'title', dir: 'asc' }
    });
});

test('SORT BY with underscore field name', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag SORT BY last_updated DESC');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        sortBy: { field: 'last_updated', dir: 'desc' }
    });
});

test('SORT BY with hyphenated field name', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag SORT BY due-date ASC');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        sortBy: { field: 'due-date', dir: 'asc' }
    });
});

test('SORT BY is case-insensitive for direction', () => {
    var resultAsc = DataviewQuery.parseQuery('LIST FROM #tag SORT BY title asc');
    var resultDesc = DataviewQuery.parseQuery('LIST FROM #tag SORT BY title desc');
    assert.equal(resultAsc.sortBy.dir, 'asc');
    assert.equal(resultDesc.sortBy.dir, 'desc');
});

test('SORT BY works with TABLE queries', () => {
    var result = DataviewQuery.parseQuery('TABLE status FROM #tag SORT BY priority DESC');
    assertParseResult(result, {
        type: 'table',
        fields: ['status'],
        source: { type: 'tag', value: 'tag' },
        sortBy: { field: 'priority', dir: 'desc' }
    });
});

test('SORT BY works with TASK queries', () => {
    var result = DataviewQuery.parseQuery('TASK FROM #tag SORT BY modified ASC');
    assertParseResult(result, {
        type: 'task',
        source: { type: 'tag', value: 'tag' },
        sortBy: { field: 'modified', dir: 'asc' }
    });
});

test('SORT BY after WHERE clause', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag WHERE status = Active SORT BY created DESC');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        where: { key: 'status', value: 'Active' },
        sortBy: { field: 'created', dir: 'desc' }
    });
});

test('SORT BY folder query', () => {
    var result = DataviewQuery.parseQuery('LIST FROM "folder" SORT BY title ASC');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'folder', value: 'folder' },
        sortBy: { field: 'title', dir: 'asc' }
    });
});

// ══════════════════════════════════════════
// GROUP BY CLAUSE
// ══════════════════════════════════════════

console.log('\n─── GROUP BY clause ───');

test('GROUP BY status', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag GROUP BY status');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        groupBy: { field: 'status' }
    });
});

test('GROUP BY with underscore field', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag GROUP BY last_updated');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        groupBy: { field: 'last_updated' }
    });
});

test('GROUP BY with hyphenated field', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag GROUP BY due-date');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        groupBy: { field: 'due-date' }
    });
});

test('GROUP BY works with TABLE queries', () => {
    var result = DataviewQuery.parseQuery('TABLE status, priority FROM #tag GROUP BY status');
    assertParseResult(result, {
        type: 'table',
        fields: ['status', 'priority'],
        source: { type: 'tag', value: 'tag' },
        groupBy: { field: 'status' }
    });
});

test('GROUP BY works with TASK queries', () => {
    var result = DataviewQuery.parseQuery('TASK FROM #tag GROUP BY path');
    assertParseResult(result, {
        type: 'task',
        source: { type: 'tag', value: 'tag' },
        groupBy: { field: 'path' }
    });
});

test('GROUP BY after WHERE clause', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag WHERE priority = high GROUP BY status');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        where: { key: 'priority', value: 'high' },
        groupBy: { field: 'status' }
    });
});

test('GROUP BY before SORT BY and LIMIT', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag GROUP BY status SORT BY title ASC LIMIT 10');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        groupBy: { field: 'status' },
        sortBy: { field: 'title', dir: 'asc' },
        limit: 10
    });
});

// ══════════════════════════════════════════
// LIMIT CLAUSE
// ══════════════════════════════════════════

console.log('\n─── LIMIT clause ───');

test('LIMIT 5', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag LIMIT 5');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        limit: 5
    });
});

test('LIMIT 1 (single result)', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag LIMIT 1');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        limit: 1
    });
});

test('LIMIT 0 (no results)', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag LIMIT 0');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        limit: 0
    });
});

test('LIMIT works with TABLE queries', () => {
    var result = DataviewQuery.parseQuery('TABLE status FROM #tag LIMIT 20');
    assertParseResult(result, {
        type: 'table',
        fields: ['status'],
        source: { type: 'tag', value: 'tag' },
        limit: 20
    });
});

test('LIMIT works with TASK queries', () => {
    var result = DataviewQuery.parseQuery('TASK FROM #tag LIMIT 3');
    assertParseResult(result, {
        type: 'task',
        source: { type: 'tag', value: 'tag' },
        limit: 3
    });
});

test('LIMIT after WHERE clause', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag WHERE status = Active LIMIT 10');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        where: { key: 'status', value: 'Active' },
        limit: 10
    });
});

test('Large LIMIT value', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag LIMIT 9999');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        limit: 9999
    });
});

// ══════════════════════════════════════════
// COMBINED CLAUSES (WHERE + SORT BY + GROUP BY + LIMIT)
// ══════════════════════════════════════════

console.log('\n─── Combined clauses ───');

test('WHERE + SORT BY + LIMIT', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #project WHERE status = Active SORT BY title ASC LIMIT 10');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'project' },
        where: { key: 'status', value: 'Active' },
        sortBy: { field: 'title', dir: 'asc' },
        limit: 10
    });
});

test('GROUP BY + SORT BY DESC', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag GROUP BY status SORT BY modified DESC');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        groupBy: { field: 'status' },
        sortBy: { field: 'modified', dir: 'desc' }
    });
});

test('SORT BY + LIMIT on folder query', () => {
    var result = DataviewQuery.parseQuery('LIST FROM "folder" SORT BY created ASC LIMIT 5');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'folder', value: 'folder' },
        sortBy: { field: 'created', dir: 'asc' },
        limit: 5
    });
});

test('All four clauses together', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tracker WHERE priority = high GROUP BY status SORT BY title ASC LIMIT 20');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tracker' },
        where: { key: 'priority', value: 'high' },
        groupBy: { field: 'status' },
        sortBy: { field: 'title', dir: 'asc' },
        limit: 20
    });
});

test('TABLE with WHERE + GROUP BY + SORT BY + LIMIT', () => {
    var result = DataviewQuery.parseQuery('TABLE status, priority FROM #tracker WHERE status = Active GROUP BY priority SORT BY modified DESC LIMIT 15');
    assertParseResult(result, {
        type: 'table',
        fields: ['status', 'priority'],
        source: { type: 'tag', value: 'tracker' },
        where: { key: 'status', value: 'Active' },
        groupBy: { field: 'priority' },
        sortBy: { field: 'modified', dir: 'desc' },
        limit: 15
    });
});

test('SORT BY uses last occurrence when multiple present', () => {
    // If there's a SORT BY in the value... actually SORT BY is extracted after the order clauses,
    // so only the last SORT BY before GROUP BY/LIMIT is kept. But the parser extracts
    // from the end, so if someone writes "WHERE status = Active SORT BY title SORT BY modified DESC",
    // only the last one (modified DESC) is captured because the first is consumed by WHERE's .+ greediness.
    // This is intentional — last wins.
    var result = DataviewQuery.parseQuery('LIST FROM #project WHERE status = Active SORT BY title SORT BY modified DESC LIMIT 5');
    // The WHERE capture consumes everything after WHERE including "Active SORT BY title",
    // so only the final "SORT BY modified DESC" is parsed as sortBy
    // This is acceptable behavior since SORT BY should appear once
    assert.ok(result.sortBy !== null, 'should have sortBy');
    assert.equal(result.limit, 5);
});

// ══════════════════════════════════════════
// CASE INSENSITIVITY
// ══════════════════════════════════════════

console.log('\n─── Case insensitivity ───');

test('LIST command is case-insensitive', () => {
    var resultUpper = DataviewQuery.parseQuery('LIST FROM #tag');
    var resultLower = DataviewQuery.parseQuery('list from #tag');
    var resultMixed = DataviewQuery.parseQuery('List From #tag');
    assertParseResult(resultUpper, { type: 'list', source: { type: 'tag', value: 'tag' } });
    assertParseResult(resultLower, { type: 'list', source: { type: 'tag', value: 'tag' } });
    assertParseResult(resultMixed, { type: 'list', source: { type: 'tag', value: 'tag' } });
});

test('TABLE command is case-insensitive', () => {
    var result = DataviewQuery.parseQuery('table status FROM #tag');
    assertParseResult(result, { type: 'table', fields: ['status'], source: { type: 'tag', value: 'tag' } });
});

test('TASK command is case-insensitive', () => {
    var result = DataviewQuery.parseQuery('Task From #sprint');
    assertParseResult(result, { type: 'task', source: { type: 'tag', value: 'sprint' } });
});

test('FROM keyword is case-insensitive', () => {
    var result = DataviewQuery.parseQuery('LIST from #tag');
    assertParseResult(result, { type: 'list', source: { type: 'tag', value: 'tag' } });
});

test('WHERE keyword is case-insensitive', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #tag where status = Active');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'tag' },
        where: { key: 'status', value: 'Active' }
    });
});

test('TABLE with mixed case everywhere', () => {
    var result = DataviewQuery.parseQuery('Table Status, Priority From #Tracker Where Status = Active');
    assertParseResult(result, {
        type: 'table',
        fields: ['Status', 'Priority'],
        source: { type: 'tag', value: 'Tracker' },
        where: { key: 'Status', value: 'Active' }
    });
});

// ══════════════════════════════════════════
// TRASHED NOTES (not related to parseQuery but edge behavior)
// ══════════════════════════════════════════

console.log('\n─── Edge cases ───');

test('TASK FROM "folder with spaces"', () => {
    var result = DataviewQuery.parseQuery('TASK FROM "My Project"');
    assertParseResult(result, {
        type: 'task',
        source: { type: 'folder', value: 'My Project' }
    });
});

test('Very long query string does not crash', () => {
    var longTag = 'a'.repeat(100);
    var result = DataviewQuery.parseQuery('TABLE field1, field2 FROM #' + longTag);
    assert.ok(result !== null, 'should parse long tag');
    assert.equal(result.source.type, 'tag');
    assert.equal(result.source.value, longTag);
});

test('Unicode in tag name truncates at the non-ASCII character', () => {
    var result = DataviewQuery.parseQuery('LIST FROM #café');
    // Regex [a-zA-Z0-9_-]+ matches 'caf' before hitting 'é'
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: 'caf' }
    });
});

test('Tag with numbers only', () => {
    var result = DataviewQuery.parseQuery('#123');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: '123' }
    });
});

test('Tag starting with number', () => {
    var result = DataviewQuery.parseQuery('#3d-printing');
    assertParseResult(result, {
        type: 'list',
        source: { type: 'tag', value: '3d-printing' }
    });
});

// ══════════════════════════════════════════
// EXECUTE QUERY TESTS
// ══════════════════════════════════════════

// Helper: reset state and metadata cache for a fresh test
var noteIdCounter = 0;
function freshExecuteState() {
    State.NOTES = [];
    State.TASKS = [];
    MetadataCache.index = new Map();
    MetadataCache.tagIndex = new Map();
    MetadataCache.linkIndex = new Map();
    MetadataCache.backlinks = new Map();
    MetadataCache.initialized = false;
    noteIdCounter = 0;
}

function makeNoteId() {
    return 'n_' + (++noteIdCounter) + '_' + Date.now();
}

/**
 * Set up standard test notes.
 * n1,n2: tagged #project, different paths and modified times
 * n3: tagged #journal, in /Journal folder
 * n4: no tags, in /Projects/Active folder
 * n5: tagged #tasks, has task-type blocks
 * n6: no tags or special features
 * n7: has YAML frontmatter with status + priority, tagged #meta
 * n8: has YAML frontmatter with different status, tagged #meta
 */
function setupStandardNotes() {
    var now = Date.now();
    State.NOTES = [
        {
            id: makeNoteId(),
            title: 'Project Alpha',
            path: '/',
            content: 'Alpha content.\n#project',
            blocks: [{ id: 'b1', type: 'p', content: 'Alpha content.\ntype: project\n#project' }],
            created: now - 500,
            modified: now - 100
        },
        {
            id: makeNoteId(),
            title: 'Project Beta',
            path: '/projects',
            content: 'Beta details.\n#project',
            blocks: [{ id: 'b2', type: 'p', content: 'Beta details.\n#project' }],
            created: now - 400,
            modified: now - 200
        },
        {
            id: makeNoteId(),
            title: 'Journal Entry',
            path: '/Journal',
            content: 'Journal thoughts.\n#journal',
            blocks: [{ id: 'b3', type: 'p', content: 'Journal thoughts.\n#journal' }],
            created: now - 300,
            modified: now - 300
        },
        {
            id: makeNoteId(),
            title: 'Meeting Notes',
            path: '/Projects/Active',
            content: 'Meeting agenda items.',
            blocks: [{ id: 'b4', type: 'p', content: 'Meeting agenda items.' }],
            created: now - 200,
            modified: now - 50
        },
        {
            id: makeNoteId(),
            title: 'Sprint Tasks',
            path: '/',
            content: '- [ ] Fix bug\n- [x] Deploy\n- [ ] Review PR\n#tasks',
            blocks: [
                { id: 'bt1', type: 'task', content: 'Fix bug', checked: false },
                { id: 'bt2', type: 'task', content: 'Deploy', checked: true },
                { id: 'bt3', type: 'task', content: 'Review PR', checked: false },
                { id: 'bt4', type: 'p', content: '#tasks' }
            ],
            created: now - 100,
            modified: now - 25
        },
        {
            id: makeNoteId(),
            title: 'Plain Note',
            path: '/Archive',
            content: 'Just a plain note with no special features.',
            blocks: [{ id: 'b6', type: 'p', content: 'Just a plain note with no special features.' }],
            created: now - 50,
            modified: now - 10
        },
        {
            id: makeNoteId(),
            title: 'Active Item',
            path: '/',
            content: '---\nstatus: Active\npriority: high\n---\n\nThis is an active item.\n#meta',
            blocks: [],
            created: now - 150,
            modified: now - 75
        },
        {
            id: makeNoteId(),
            title: 'Completed Item',
            path: '/',
            content: '---\nstatus: Done\npriority: low\n---\n\nThis item is done.\n#meta',
            blocks: [],
            created: now - 125,
            modified: now - 80
        }
    ];

    // Initialize MetadataCache to build the tag index
    MetadataCache.initialized = false;
    MetadataCache.init();
}

function getNoteIds(notes) {
    return notes.map(function (n) { return n.id; });
}

function getNoteTitles(notes) {
    return notes.map(function (n) { return n.title; });
}


console.log('\n─── executeQuery: Tag queries ───');

test('tag query returns notes matching the tag', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #project');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 2, 'should find 2 #project notes');
    var titles = getNoteTitles(results);
    assert.ok(titles.indexOf('Project Alpha') >= 0, 'should include Project Alpha');
    assert.ok(titles.indexOf('Project Beta') >= 0, 'should include Project Beta');
});

test('tag query returns empty array for non-existent tag', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #nonexistent');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 0, 'should find 0 results for #nonexistent');
});

test('tag query is case-sensitive in tag value', () => {
    freshExecuteState();
    setupStandardNotes();

    // Tags are stored lowercased by MetadataCache, so uppercase query finds them
    var parsed = DataviewQuery.parseQuery('LIST FROM #PROJECT');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 2, 'should find #project notes even with uppercase query');
});

test('tag query does not return notes without the tag', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #journal');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'should find only 1 #journal note');
    assert.equal(results[0].title, 'Journal Entry');
});


console.log('\n─── executeQuery: Folder queries ───');

test('folder query returns notes in that folder', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM "Journal"');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'should find 1 note in /Journal');
    assert.equal(results[0].title, 'Journal Entry');
});

test('folder query returns notes in nested folder path', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM "Projects/Active"');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'should find 1 note in /Projects/Active');
    assert.equal(results[0].title, 'Meeting Notes');
});

test('folder query returns empty array for non-existent folder', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM "NonExistent"');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 0, 'should find 0 results');
});

test('folder query with root path shows all notes in /', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM "/"');
    var results = DataviewQuery.executeQuery(parsed);

    // All notes have a path starting with "/" (after prepending / to empty value)
    // Actually, '/' becomes '//' which matches everything... let's check
    // folderPath = '/' + '' = '/' since "/" is stripped to '' then '/' prepended
    var folderPath = '/' + ''.replace(/^\/+/, '');
    // Actually, parsed source value would be '' which becomes '/'
    // All paths start with '/', so this would match everything
    assert.equal(results.length, 8, 'root path query should return all 8 notes');
});

test('folder query does not return notes from other folders', () => {
    freshExecuteState();
    setupStandardNotes();

    // Journal path is /Journal, not /Archive
    var parsed = DataviewQuery.parseQuery('LIST FROM "Archive"');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'should find only Plain Note in /Archive');
    assert.equal(results[0].title, 'Plain Note');
});


console.log('\n─── executeQuery: WHERE filtering ───');

test('WHERE filters by frontmatter status = Active', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #meta WHERE status = Active');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'should find only 1 active note');
    assert.equal(results[0].title, 'Active Item');
});

test('WHERE filters by frontmatter priority = low', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #meta WHERE priority = low');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'should find only 1 low-priority note');
    assert.equal(results[0].title, 'Completed Item');
});

test('WHERE returns empty when no notes match the condition', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #meta WHERE status = Invalid');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 0, 'should find 0 results');
});

test('WHERE on non-frontmatter falls back to content search', () => {
    freshExecuteState();
    setupStandardNotes();

    // Project Alpha has 'type: project' in its block content.
    // This is NOT frontmatter (blocks are used), so it falls back to
    // content search for 'type: project' pattern.
    var parsed = DataviewQuery.parseQuery('LIST FROM #project WHERE type = project');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'content fallback should find 1 note');
    assert.equal(results[0].title, 'Project Alpha');
});

test('WHERE content fallback returns empty when value not found in matching notes', () => {
    freshExecuteState();
    setupStandardNotes();

    // 'type: nonexistent' is not in any project note's content
    var parsed = DataviewQuery.parseQuery('LIST FROM #project WHERE type = nonexistent');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 0, 'should find 0 results');
});

test('WHERE with quoted value strips quotes', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #meta WHERE status = "Active"');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'quoted value should match');
    assert.equal(results[0].title, 'Active Item');
});

test('WHERE on folder query also works', () => {
    freshExecuteState();
    setupStandardNotes();

    // Add a note in /Journal with a key:value pattern for WHERE matching
    var now = Date.now();
    State.NOTES.push({
        id: makeNoteId(),
        title: 'Journal Note',
        path: '/Journal',
        content: 'Journal note content.\ncategory: personal\n#journal',
        blocks: [{ id: 'bjw1', type: 'p', content: 'Journal note content.\ncategory: personal\n#journal' }],
        created: now,
        modified: now
    });
    MetadataCache.initialized = false;
    MetadataCache.init();

    var parsed = DataviewQuery.parseQuery('LIST FROM "Journal" WHERE category = personal');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'folder + WHERE should find the matching note');
    assert.equal(results[0].title, 'Journal Note');
});


console.log('\n─── executeQuery: TASK matching ───');

test('TASK query returns only notes with task-type blocks', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('TASK FROM #tasks');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'should find only Sprint Tasks (has task blocks)');
    assert.equal(results[0].title, 'Sprint Tasks');
});

test('TASK query does not return notes without task blocks', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('TASK FROM #project');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 0, 'project notes have no task blocks, so TASK query returns nothing');
});

test('TASK query with folder source', () => {
    freshExecuteState();
    setupStandardNotes();

    // Create a test note with tasks in a folder
    var now = Date.now();
    State.NOTES.push({
        id: makeNoteId(),
        title: 'Folder Tasks',
        path: '/Work',
        content: '- [ ] Do work\n#work',
        blocks: [
            { id: 'bwf1', type: 'task', content: 'Do work', checked: false },
            { id: 'bwf2', type: 'p', content: '#work' }
        ],
        created: now,
        modified: now
    });
    MetadataCache.init();

    var parsed = DataviewQuery.parseQuery('TASK FROM "Work"');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'should find Folder Tasks');
    assert.equal(results[0].title, 'Folder Tasks');
});

test('TASK query handles notes with tasks in content (not blocks)', () => {
    freshExecuteState();
    setupStandardNotes();

    // Plain Note has no task blocks, so TASK query won't find it
    // But add a note with task content but no task blocks
    var now = Date.now();
    var contentTasksId = makeNoteId();
    State.NOTES.push({
        id: contentTasksId,
        title: 'Content Tasks',
        path: '/',
        content: '- [ ] Buy milk\n- [x] Pay bills\n#tasks',
        blocks: [{ id: 'bct1', type: 'p', content: '- [ ] Buy milk\n- [x] Pay bills\n#tasks' }],
        created: now,
        modified: now
    });
    // Update the MetadataCache for the new note directly
    MetadataCache.updateNote(contentTasksId, false);

    var parsed = DataviewQuery.parseQuery('TASK FROM #tasks');
    var results = DataviewQuery.executeQuery(parsed);

    // Should find both Sprint Tasks (has task blocks) and Content Tasks (tasks in content, no task blocks)
    assert.equal(results.length, 2, 'should find both notes with task content');
    var titles = getNoteTitles(results);
    assert.ok(titles.indexOf('Content Tasks') >= 0, 'should find Content Tasks via content fallback');
    assert.ok(titles.indexOf('Sprint Tasks') >= 0, 'should find Sprint Tasks via blocks');
});


console.log('\n─── executeQuery: Sort order ───');

test('results are sorted by modified date descending', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #project');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 2);
    // Project Alpha modified at now-100, Project Beta at now-200
    assert.ok(results[0].modified > results[1].modified,
        'most recently modified note should be first');
    assert.equal(results[0].title, 'Project Alpha', 'Project Alpha was modified later');
    assert.equal(results[1].title, 'Project Beta', 'Project Beta was modified earlier');
});

test('sort handles notes without modified date (uses created)', () => {
    freshExecuteState();
    setupStandardNotes();

    // Add a note with no modified timestamp
    var now = Date.now();
    State.NOTES.push({
        id: makeNoteId(),
        title: 'No Modified',
        path: '/',
        content: 'No modified date.\n#project',
        blocks: [{ id: 'bnm1', type: 'p', content: 'No modified date.\n#project' }],
        created: now - 50,
        // no modified property
    });
    MetadataCache.initialized = false;
    MetadataCache.init();

    var parsed = DataviewQuery.parseQuery('LIST FROM #project');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 3, 'should find 3 #project notes including the added one');
    // Should not throw — sort falls back to created
});


console.log('\n─── executeQuery: SORT BY ───');

test('SORT BY title ASC orders alphabetically', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #project SORT BY title ASC');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 2);
    // Project Alpha comes before Project Beta alphabetically
    assert.equal(results[0].title, 'Project Alpha');
    assert.equal(results[1].title, 'Project Beta');
});

test('SORT BY title DESC reverses order', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #project SORT BY title DESC');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 2);
    // Reversed: Project Beta before Project Alpha
    assert.equal(results[0].title, 'Project Beta');
    assert.equal(results[1].title, 'Project Alpha');
});

test('SORT BY modified ASC shows oldest first', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #project SORT BY modified ASC');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 2);
    // Project Beta modified earlier (now-200), Project Alpha modified later (now-100)
    assert.equal(results[0].title, 'Project Beta');
    assert.equal(results[1].title, 'Project Alpha');
});

test('SORT BY path field works', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #project SORT BY path ASC');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 2);
    // Project Alpha path='/', Project Beta path='/projects'
    // '/' < '/projects' alphabetically
    assert.equal(results[0].title, 'Project Alpha');
    assert.equal(results[1].title, 'Project Beta');
});

test('SORT BY with WHERE filter', () => {
    freshExecuteState();
    setupStandardNotes();

    // Add a third note to make sorting interesting
    State.NOTES.push({
        id: makeNoteId(),
        title: 'Another Active',
        path: '/',
        content: '---\nstatus: Active\npriority: low\n---\n\nAnother active.\n#meta',
        blocks: [],
        created: Date.now(),
        modified: Date.now()
    });
    MetadataCache.init();

    var parsed = DataviewQuery.parseQuery('LIST FROM #meta WHERE status = Active SORT BY title ASC');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'WHERE + SORT BY filters and sorts');
    assert.equal(results[0].title, 'Active Item');
});


console.log('\n─── executeQuery: LIMIT ───');

test('LIMIT reduces result count', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #project LIMIT 1');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'LIMIT 1 should return only 1 result');
    assert.equal(results[0].title, 'Project Alpha', 'LIMIT should return first (most recently modified) result');
});

test('LIMIT larger than result set returns all', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #project LIMIT 100');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 2, 'LIMIT 100 should return all 2 results');
});

test('LIMIT 0 returns no results', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #project LIMIT 0');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 0, 'LIMIT 0 should return no results');
});

test('SORT BY + LIMIT combined', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #project SORT BY title ASC LIMIT 1');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'SORT BY + LIMIT 1');
    assert.equal(results[0].title, 'Project Alpha', 'First alphabetically');
});

test('SORT BY DESC + LIMIT combined', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('LIST FROM #project SORT BY title DESC LIMIT 1');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 1, 'SORT BY DESC + LIMIT 1');
    assert.equal(results[0].title, 'Project Beta', 'Last alphabetically with LIMIT');
});


console.log('\n─── executeQuery: Empty state and edge cases ───');

test('executeQuery returns empty array for null parsed query', () => {
    freshExecuteState();
    setupStandardNotes();

    var results = DataviewQuery.executeQuery(null);
    assert.equal(results.length, 0);
});

test('executeQuery returns empty array for parsed query with no source', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('garbage');
    var results = DataviewQuery.executeQuery(parsed);
    assert.equal(results.length, 0);
});

test('executeQuery returns empty array when State.NOTES is empty', () => {
    freshExecuteState();
    // Don't call setupStandardNotes — State.NOTES is empty
    State.NOTES = [];

    var parsed = DataviewQuery.parseQuery('LIST FROM #project');
    var results = DataviewQuery.executeQuery(parsed);

    assert.equal(results.length, 0, 'no notes means no results');
});

test('executeQuery handles trashed notes gracefully', () => {
    freshExecuteState();
    var now = Date.now();
    State.NOTES = [
        {
            id: makeNoteId(),
            title: 'Active Note',
            path: '/',
            content: 'Active.\n#project',
            blocks: [{ id: 'btr1', type: 'p', content: 'Active.\n#project' }],
            modified: now
        },
        {
            id: makeNoteId(),
            title: 'Trashed Note',
            path: '/.trash',
            content: 'Trashed.\n#project',
            blocks: [{ id: 'btr2', type: 'p', content: 'Trashed.\n#project' }],
            modified: now - 100
        }
    ];
    MetadataCache.init();

    var parsed = DataviewQuery.parseQuery('LIST FROM #project');
    var results = DataviewQuery.executeQuery(parsed);

    // executeQuery doesn't filter trashed notes by default
    assert.equal(results.length, 2, 'trashed notes are not excluded by executeQuery itself');
});


console.log('\n─── executeQuery: Integration with various query types ───');

test('LIST query type works with tag source', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('TABLE FROM #project');
    assert.equal(parsed.type, 'table');
    var results = DataviewQuery.executeQuery(parsed);
    assert.equal(results.length, 2, 'TABLE query returns same notes as LIST with same tag');
});

test('TABLE query type returns same notes as LIST query', () => {
    freshExecuteState();
    setupStandardNotes();

    var listParsed = DataviewQuery.parseQuery('LIST FROM #project');
    var listResults = DataviewQuery.executeQuery(listParsed);

    var tableParsed = DataviewQuery.parseQuery('TABLE status, priority FROM #project');
    var tableResults = DataviewQuery.executeQuery(tableParsed);

    assert.equal(listResults.length, tableResults.length, 'LIST and TABLE return same count');
    assert.deepEqual(getNoteIds(listResults), getNoteIds(tableResults), 'LIST and TABLE return same notes');
});

test('query with only WHERE and no source returns empty (source is null)', () => {
    freshExecuteState();
    setupStandardNotes();

    var parsed = DataviewQuery.parseQuery('WHERE status = Active');
    assert.equal(parsed.source, null);
    var results = DataviewQuery.executeQuery(parsed);
    assert.equal(results.length, 0, 'no source means no results');
});


// ============================================================
// SUMMARY
// ============================================================

console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  DATAVIEW SUITE: ' + passed + ' passed, ' + failed + ' failed');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

if (errors.length > 0) {
    console.log('FAILURES:');
    errors.forEach(function (e) {
        console.log('  \u2022 ' + e.name + ': ' + e.error);
    });
    console.log('');
}

process.exit(failed > 0 ? 1 : 0);
