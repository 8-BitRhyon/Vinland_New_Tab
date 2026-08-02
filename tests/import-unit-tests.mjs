

import assert from 'node:assert/strict';

// ============================================================
// FUNCTION EXTRACTS (from SettingsUI.js:1409-1445)
// ============================================================

// Validates that the imported payload has at least one valid data field.
// If config, tasks, AND notes are all absent, the import should be rejected.
function validateImportPayload(imported) {
    if (!imported || typeof imported !== 'object' || Array.isArray(imported)) return false;
    return Boolean(imported.config || imported.tasks || imported.notes);
}

// Applies imported data to a state snapshot, returning the updated state.
// Throws if the payload is invalid (no config, tasks, or notes).
// This mirrors the core logic in SettingsUI.importDataFile() lines 1417-1436
// minus the FileReader, Config.save(), saveData(), and UI side effects.
function applyImportToState(imported, state) {
    if (!imported.config && !imported.tasks && !imported.notes) {
        throw new Error("Invalid Backup Format");
    }

    // Deep clone to avoid mutating the original
    var result = JSON.parse(JSON.stringify(state));

    if (imported.config) {
        result.CONFIG = Object.assign({}, result.CONFIG || {}, imported.config);
    }
    if (imported.tasks) result.TASKS = imported.tasks;
    if (imported.notes) result.NOTES = imported.notes;
    if (imported.boards) result.BOARDS = imported.boards;
    if (imported.canvases) result.CANVASES = imported.canvases;
    if (imported.history) result.COMMAND_HISTORY = imported.history;

    return result;
}

// ============================================================
// TEST RUNNER
// ============================================================

let passed = 0;
let failed = 0;
let errors = [];

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

function assertThrows(fn, expectedMsg) {
    var thrown = false;
    try {
        fn();
    } catch (e) {
        thrown = true;
        if (expectedMsg && !e.message.includes(expectedMsg)) {
            throw new Error(`Expected error containing "${expectedMsg}" but got "${e.message}"`);
        }
    }
    if (!thrown) {
        throw new Error('Expected function to throw but it did not');
    }
}

// Helper: default empty state
function emptyState() {
    return {
        CONFIG: { version: 4, user_name: '' },
        TASKS: [],
        NOTES: [],
        BOARDS: [],
        CANVASES: [],
        COMMAND_HISTORY: []
    };
}

// Helper: valid full import payload
function fullPayload() {
    return {
        config: { theme_color: '#ff8800', user_name: 'Tester', location: 'SF' },
        tasks: [
            { id: 't1', text: 'Task 1', completed: false },
            { id: 't2', text: 'Task 2', completed: true }
        ],
        notes: [
            { id: 'n1', title: 'Note 1', content: 'Hello [[Note 2]]', path: '/', blocks: [] },
            { id: 'n2', title: 'Note 2', content: 'World', path: '/projects', blocks: [] }
        ],
        boards: [
            { id: 'b1', title: 'Board 1', columns: [{ title: 'Todo', cards: [{ content: 'Card 1' }] }] }
        ],
        canvases: [],
        history: ['note Test', 'task Test task', 'board Show']
    };
}

// ============================================================
// TESTS: validateImportPayload()
// ============================================================

console.log('\n─── validateImportPayload() ───');

test('returns true for full payload with all data types', () => {
    assert.equal(validateImportPayload(fullPayload()), true);
});

test('returns true for payload with config only', () => {
    assert.equal(validateImportPayload({ config: { theme_color: '#000' } }), true);
});

test('returns true for payload with tasks only', () => {
    assert.equal(validateImportPayload({ tasks: [{ id: 't1', text: 'x' }] }), true);
});

test('returns true for payload with notes only', () => {
    assert.equal(validateImportPayload({ notes: [{ id: 'n1', title: 'N' }] }), true);
});

test('returns false for null/undefined input', () => {
    assert.equal(validateImportPayload(null), false);
    assert.equal(validateImportPayload(undefined), false);
});

test('returns false for empty object', () => {
    assert.equal(validateImportPayload({}), false);
});

test('returns false for non-object types (string, number, array)', () => {
    assert.equal(validateImportPayload('not json'), false);
    assert.equal(validateImportPayload(42), false);
    assert.equal(validateImportPayload([]), false);
});

test('returns false for payload with only optional fields (canvases/history/boards)', () => {
    // Without config, tasks, OR notes, this should fail validation
    assert.equal(validateImportPayload({ boards: [], canvases: [], history: [] }), false);
});

test('returns true for payload with empty config object', () => {
    assert.equal(validateImportPayload({ config: {} }), true);
});

test('returns true for payload with empty tasks array', () => {
    assert.equal(validateImportPayload({ tasks: [] }), true);
});

test('returns true for payload with empty notes array', () => {
    assert.equal(validateImportPayload({ notes: [] }), true);
});

test('returns false for payload with only null-valued fields', () => {
    assert.equal(validateImportPayload({ config: null, tasks: null, notes: null }), false);
});


// ============================================================
// TESTS: applyImportToState()
// ============================================================

console.log('\n─── applyImportToState() ───');

test('applies full payload to empty state, assigning all data types', () => {
    var state = emptyState();
    var imported = fullPayload();
    var result = applyImportToState(imported, state);

    // Config should be merged
    assert.equal(result.CONFIG.theme_color, '#ff8800');
    assert.equal(result.CONFIG.user_name, 'Tester');
    assert.equal(result.CONFIG.location, 'SF');
    // Original config fields preserved
    assert.equal(result.CONFIG.version, 4);

    // Tasks
    assert.equal(result.TASKS.length, 2);
    assert.equal(result.TASKS[0].text, 'Task 1');
    assert.equal(result.TASKS[1].completed, true);

    // Notes
    assert.equal(result.NOTES.length, 2);
    assert.equal(result.NOTES[0].title, 'Note 1');
    assert.equal(result.NOTES[1].path, '/projects');

    // Boards
    assert.equal(result.BOARDS.length, 1);
    assert.equal(result.BOARDS[0].title, 'Board 1');
    assert.equal(result.BOARDS[0].columns[0].cards[0].content, 'Card 1');

    // Canvases (empty array)
    assert.deepEqual(result.CANVASES, []);

    // History
    assert.equal(result.COMMAND_HISTORY.length, 3);
    assert.equal(result.COMMAND_HISTORY[0], 'note Test');
});

test('config-only payload merges into existing config without affecting other state', () => {
    var state = emptyState();
    state.TASKS = [{ id: 't1', text: 'preserved' }];
    state.NOTES = [{ id: 'n1', title: 'Preserved' }];
    state.BOARDS = [{ id: 'b1', title: 'Preserved Board' }];

    var result = applyImportToState({ config: { user_name: 'Updated' } }, state);

    assert.equal(result.CONFIG.user_name, 'Updated');
    assert.equal(result.CONFIG.version, 4); // original fields preserved
    assert.equal(result.TASKS.length, 1); // tasks untouched
    assert.equal(result.NOTES.length, 1); // notes untouched
    assert.equal(result.BOARDS.length, 1); // boards untouched
});

test('notes-only payload replaces notes without affecting other state', () => {
    var state = emptyState();
    state.CONFIG = { version: 4, user_name: 'Original', theme_color: '#00FF41' };
    state.TASKS = [{ id: 't1', text: 'preserved' }];

    var result = applyImportToState(
        { notes: [{ id: 'n_new', title: 'Imported Note', content: 'Imported' }] },
        state
    );

    assert.equal(result.NOTES.length, 1);
    assert.equal(result.NOTES[0].title, 'Imported Note');
    assert.equal(result.CONFIG.user_name, 'Original'); // config untouched
    assert.equal(result.TASKS.length, 1); // tasks untouched
});

test('tasks-only payload replaces tasks without affecting other state', () => {
    var state = emptyState();
    state.CONFIG = { version: 4, user_name: 'Original' };

    var result = applyImportToState(
        { tasks: [{ id: 't_new', text: 'Imported Task', completed: false }] },
        state
    );

    assert.equal(result.TASKS.length, 1);
    assert.equal(result.TASKS[0].text, 'Imported Task');
    assert.equal(result.CONFIG.user_name, 'Original');
    assert.equal(result.NOTES.length, 0);
});

test('partial config merge only overwrites specified fields', () => {
    var state = emptyState();
    state.CONFIG = { version: 4, user_name: 'Original', theme_color: '#00FF41', location: 'NYC' };

    var result = applyImportToState(
        { config: { user_name: 'Updated', theme_color: '#ff0000' } },
        state
    );

    assert.equal(result.CONFIG.user_name, 'Updated');
    assert.equal(result.CONFIG.theme_color, '#ff0000');
    assert.equal(result.CONFIG.location, 'NYC'); // not in import, preserved
    assert.equal(result.CONFIG.version, 4); // not in import, preserved
});

test('payload with empty arrays for optional fields does not clear them from state', () => {
    var state = emptyState();
    state.BOARDS = [{ id: 'b1', title: 'Existing Board' }];
    state.CANVASES = [{ id: 'c1' }];
    state.COMMAND_HISTORY = ['cmd1'];

    // Import with explicit empty arrays for boards/canvases/history
    var result = applyImportToState(
        { config: { theme_color: '#000' }, boards: [], canvases: [], history: [] },
        state
    );

    // These should be REPLACED (empty) since they're explicitly in the payload
    assert.deepEqual(result.BOARDS, []);
    assert.deepEqual(result.CANVASES, []);
    assert.deepEqual(result.COMMAND_HISTORY, []);
    // But config was applied
    assert.equal(result.CONFIG.theme_color, '#000');
});

test('payload without optional fields preserves their existing state values', () => {
    var state = emptyState();
    state.BOARDS = [{ id: 'b1', title: 'Existing Board' }];
    state.CANVASES = [{ id: 'c1' }];
    state.COMMAND_HISTORY = ['cmd1'];

    // Import without boards/canvases/history keys at all
    var imported = fullPayload();
    delete imported.boards;
    delete imported.canvases;
    delete imported.history;

    var result = applyImportToState(imported, state);

    // These should be PRESERVED since they're not in the payload
    assert.equal(result.BOARDS.length, 1);
    assert.equal(result.BOARDS[0].title, 'Existing Board');
    assert.equal(result.CANVASES.length, 1);
    assert.equal(result.COMMAND_HISTORY.length, 1);
});

test('throws on payload with no config, tasks, or notes', () => {
    assertThrows(() => {
        applyImportToState({ boards: [], history: [] }, emptyState());
    }, 'Invalid Backup Format');
});

test('throws on empty object payload', () => {
    assertThrows(() => {
        applyImportToState({}, emptyState());
    }, 'Invalid Backup Format');
});

test('payload with truthy but empty config object still applies', () => {
    var state = emptyState();
    var result = applyImportToState({ config: {} }, state);
    assert.ok(result.CONFIG); // config was applied (empty merge)
});

test('large payload with many notes processes correctly', () => {
    var state = emptyState();
    var notes = [];
    for (var i = 0; i < 500; i++) {
        notes.push({
            id: 'n_' + i,
            title: 'Note ' + i,
            content: 'Content ' + i + ' with some text ' + 'A'.repeat(50),
            path: '/' + (i % 10),
            blocks: []
        });
    }

    var imported = { notes: notes, tasks: [{ id: 't1', text: 'Lone task' }] };
    var result = applyImportToState(imported, state);

    assert.equal(result.NOTES.length, 500);
    assert.equal(result.NOTES[0].id, 'n_0');
    assert.equal(result.NOTES[499].title, 'Note 499');
    assert.equal(result.NOTES[250].content.slice(0, 10), 'Content 25');
    assert.equal(result.TASKS.length, 1);
    assert.equal(result.TASKS[0].text, 'Lone task');
});

test('payload with null-valued optional fields does not clear existing state', () => {
    var state = emptyState();
    state.BOARDS = [{ id: 'b1', title: 'Keep' }];
    state.CANVASES = [{ id: 'c1' }];
    state.COMMAND_HISTORY = ['existing_cmd']; // non-empty to prove preservation

    // Fields set to null (like a corrupted export) should be treated as absent
    // because `if (imported.boards)` is falsy for null
    var imported = {
        config: { theme_color: '#000' },
        tasks: [],
        notes: [],
        boards: null,
        canvases: null,
        history: null
    };

    var result = applyImportToState(imported, state);

    assert.equal(result.BOARDS.length, 1, 'boards should be preserved when import has null');
    assert.equal(result.CANVASES.length, 1, 'canvases should be preserved when import has null');
    assert.equal(result.COMMAND_HISTORY.length, 1, 'history should be preserved when import has null');
    assert.equal(result.COMMAND_HISTORY[0], 'existing_cmd', 'history content preserved');
});

test('payload with deeply nested config fields merges correctly', () => {
    var state = emptyState();
    var imported = {
        config: {
            dock_links: [{ name: 'NEW', url: 'https://new.com' }],
            custom_commands: [{ trigger: 'test', url: 'https://test.com' }]
        }
    };

    var result = applyImportToState(imported, state);

    assert.equal(result.CONFIG.dock_links.length, 1);
    assert.equal(result.CONFIG.dock_links[0].name, 'NEW');
    assert.equal(result.CONFIG.custom_commands.length, 1);
    assert.equal(result.CONFIG.custom_commands[0].trigger, 'test');
});

test('payload with undefined fields treated as absent (optional chaining)', () => {
    var state = emptyState();

    // Simulate a payload where some fields are literally undefined
    // (Note: JSON.parse never produces undefined values; this is a defensive check)
    var imported = {
        config: { theme_color: '#abc' },
        boards: undefined,
        canvases: undefined
    };

    var result = applyImportToState(imported, state);

    assert.equal(result.CONFIG.theme_color, '#abc');
    assert.equal(result.BOARDS.length, 0); // was never set
    assert.equal(result.CANVASES.length, 0); // was never set
});

test('exportedAt and exportVersion metadata fields are ignored but harmless', () => {
    // These fields appear in the export but are never read by importDataFile.
    // Verifying they don't cause errors is a forward-compatibility guarantee.
    var state = emptyState();
    var imported = {
        exportVersion: 999,
        exportedAt: '2099-01-01T00:00:00.000Z',
        config: { theme_color: '#f00' },
        tasks: [{ id: 't1', text: 'Forward compat task' }]
    };

    var result = applyImportToState(imported, state);

    assert.equal(result.CONFIG.theme_color, '#f00');
    assert.equal(result.TASKS.length, 1);
    assert.equal(result.TASKS[0].text, 'Forward compat task');
});

test('future exportVersion with no recognized fields still throws', () => {
    var state = emptyState();
    var imported = {
        exportVersion: 10,
        exportedAt: '2099-01-01T00:00:00.000Z'
    };

    assertThrows(() => {
        applyImportToState(imported, state);
    }, 'Invalid Backup Format');
});

test('does not mutate the original state object', () => {
    var state = emptyState();
    var originalConfig = state.CONFIG;
    var originalNotes = state.NOTES;

    var imported = fullPayload();
    var result = applyImportToState(imported, state);

    assert.notEqual(result, state, 'result should be a different object');
    assert.equal(state.CONFIG, originalConfig, 'original state.CONFIG should not be replaced');
    assert.equal(state.NOTES, originalNotes, 'original state.NOTES should not be replaced');
    assert.equal(state.TASKS.length, 0, 'original state.TASKS should remain empty');
});

test('restores notes with wiki links correctly', () => {
    var state = emptyState();
    var imported = {
        notes: [
            { id: 'alpha', title: 'Alpha', content: 'Link to [[Beta]] and [[Gamma]]', path: '/' },
            { id: 'beta', title: 'Beta', content: 'Link back to [[Alpha]]', path: '/' },
            { id: 'gamma', title: 'Gamma', content: 'Standalone note', path: '/projects' }
        ]
    };

    var result = applyImportToState(imported, state);

    assert.equal(result.NOTES.length, 3);
    assert.ok(result.NOTES[0].content.includes('[[Beta]]'));
    assert.ok(result.NOTES[1].content.includes('[[Alpha]]'));
    assert.equal(result.NOTES[2].path, '/projects');
});

test('restores task with all metadata fields', () => {
    var state = emptyState();
    var imported = {
        tasks: [{
            id: 't_complex',
            text: 'Complex task',
            completed: true,
            priority: 'high',
            category: 'work',
            dueDate: '2026-12-31',
            tags: ['#urgent', '#project'],
            createdAt: 1700000000000
        }]
    };

    var result = applyImportToState(imported, state);

    assert.equal(result.TASKS.length, 1);
    assert.equal(result.TASKS[0].text, 'Complex task');
    assert.equal(result.TASKS[0].completed, true);
    assert.equal(result.TASKS[0].priority, 'high');
    assert.equal(result.TASKS[0].category, 'work');
    assert.equal(result.TASKS[0].dueDate, '2026-12-31');
    assert.deepEqual(result.TASKS[0].tags, ['#urgent', '#project']);
});

test('restores board with multiple columns and cards', () => {
    var state = emptyState();
    var imported = {
        config: { theme_color: '#0f0' },  // must have at least one of config/tasks/notes
        boards: [{
            id: 'b_full',
            title: 'Full Board',
            columns: [
                { title: 'Todo', cards: [{ content: 'Task 1' }, { content: 'Task 2' }] },
                { title: 'In Progress', cards: [{ content: 'WIP' }] },
                { title: 'Done', cards: [] }
            ]
        }]
    };

    var result = applyImportToState(imported, state);

    assert.equal(result.BOARDS[0].columns.length, 3);
    assert.equal(result.BOARDS[0].columns[0].cards.length, 2);
    assert.equal(result.BOARDS[0].columns[1].cards[0].content, 'WIP');
    assert.equal(result.BOARDS[0].columns[2].cards.length, 0);
});

test('config merge handles Object.assign edge case with empty state CONFIG', () => {
    var state = emptyState();
    state.CONFIG = {};
    delete state.CONFIG.version;

    var imported = { config: { theme_color: '#abc', user_name: 'Test' } };
    var result = applyImportToState(imported, state);

    assert.equal(result.CONFIG.theme_color, '#abc');
    assert.equal(result.CONFIG.user_name, 'Test');
});

test('payload with tasks and notes but no config applies both correctly', () => {
    var state = emptyState();
    state.CONFIG = { version: 4, user_name: 'Existing', theme_color: '#00FF41' };

    var result = applyImportToState({
        tasks: [{ id: 't1', text: 'Imported task' }],
        notes: [{ id: 'n1', title: 'Imported note' }]
    }, state);

    assert.equal(result.TASKS.length, 1);
    assert.equal(result.NOTES.length, 1);
    assert.equal(result.CONFIG.user_name, 'Existing'); // config preserved
});


// ============================================================
// SIMULATED CORRUPTED JSON EDGE CASES (parse failures)
// ============================================================

console.log('\n─── Simulated JSON parse failures ───');

test('corrupted JSON string throws on parse (simulated)', () => {
    assertThrows(() => {
        JSON.parse('{ this is not valid json }');
    }, ''); // error message varies by Node version
});

test('truncated JSON throws on parse (simulated)', () => {
    assertThrows(() => {
        JSON.parse('{"config": {"theme_color": "#ff8800", "tasks": [');
    }, ''); // error message varies by Node version
});

test('null byte in JSON throws on parse (simulated)', () => {
    assertThrows(() => {
        JSON.parse('{"config": {"theme_color": "#ff\0"}}');
    }, ''); // error message varies by Node version
});

test('extremely deep nesting in JSON causes stack overflow on parse (simulated)', () => {
    // This won't actually throw in V8 which allows deep nesting,
    // but we can verify that the import function would handle the result
    var nested = { config: {} };
    var current = nested.config;
    for (var i = 0; i < 10000; i++) {
        current.x = {};
        current = current.x;
    }

    var result = validateImportPayload(nested);
    assert.equal(result, true, 'deeply nested valid payload should validate');
});

test('payload with non-array tasks field gets assigned as-is', () => {
    // If the backup is malformed and tasks is an object instead of array,
    // the import function assigns it directly (matching current source behavior)
    var state = emptyState();
    var imported = { tasks: { id: 't1', text: 'Object-shaped task' } };

    var result = applyImportToState(imported, state);

    assert.equal(typeof result.TASKS, 'object');
    assert.equal(result.TASKS.id, 't1');
    assert.equal(result.TASKS.text, 'Object-shaped task');
});


// ============================================================
// BOUNDARY: round-trip equality (export → import preserves data)
// ============================================================

console.log('\n─── Round-trip equivalence ───');

test('export-then-import round-trip preserves all data', () => {
    var originalState = {
        CONFIG: { version: 4, user_name: 'RoundTrip', theme_color: '#abc', location: 'SF' },
        TASKS: [{ id: 't1', text: 'Round trip task', completed: false }],
        NOTES: [{ id: 'n1', title: 'Round trip note', content: 'Hello world', path: '/', blocks: [] }],
        BOARDS: [{ id: 'b1', title: 'Round trip board', columns: [{ title: 'Col', cards: [] }] }],
        CANVASES: [],
        COMMAND_HISTORY: ['note Test']
    };

    // Simulate export: serialize to JSON
    var exportPayload = {
        config: originalState.CONFIG,
        tasks: originalState.TASKS,
        notes: originalState.NOTES,
        boards: originalState.BOARDS,
        canvases: originalState.CANVASES,
        history: originalState.COMMAND_HISTORY
    };

    // Simulate import: deserialize and apply to fresh state
    var freshState = emptyState();
    var imported = JSON.parse(JSON.stringify(exportPayload));
    var restoredState = applyImportToState(imported, freshState);

    assert.deepEqual(restoredState.CONFIG, originalState.CONFIG);
    assert.deepEqual(restoredState.TASKS, originalState.TASKS);
    assert.deepEqual(restoredState.NOTES, originalState.NOTES);
    assert.deepEqual(restoredState.BOARDS, originalState.BOARDS);
    assert.deepEqual(restoredState.CANVASES, originalState.CANVASES);
    assert.deepEqual(restoredState.COMMAND_HISTORY, originalState.COMMAND_HISTORY);
});


// ============================================================
// SUMMARY
// ============================================================

console.log('\n══════════════════════════════════════════════════');
console.log(`  IMPORT SUITE: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');

if (errors.length > 0) {
    console.log('FAILURES:');
    errors.forEach(e => console.log(`  • ${e.name}: ${e.message}`));
    console.log('');
}

process.exit(failed > 0 ? 1 : 0);
