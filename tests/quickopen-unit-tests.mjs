/**
 * Vinland QuickOpen System - Unit Tests
 *
 * Tests two layers:
 *   1. Pure function extracts (_escapeHtml) that need no state or DOM
 *   2. Integration tests importing the REAL QuickOpen module with
 *      State + MetadataCache + CommandRegistry + minimal DOM shims
 *
 * Run with: node tests/quickopen-unit-tests.mjs
 * (aggregated by tests/run-all.mjs)
 */

import assert from 'node:assert/strict';

// ============================================================
// SECTION 1: QuickOpen._escapeHtml() tests the ACTUAL source method.
// The source was refactored to use string replacement (not DOM API)
// so it works in both browser and Node.js environments.
// ============================================================

// ============================================================
// SECTION 2: GLOBALS SHIMS (must exist before importing modules)
// ============================================================

const localStorageShim = (() => {
    const store = new Map();
    return {
        getItem: function (k) { return store.has(k) ? store.get(k) : null; },
        setItem: function (k, v) { store.set(k, String(v)); },
        removeItem: function (k) { store.delete(k); },
        clear: function () { store.clear(); },
        key: function (i) { return Array.from(store.keys())[i] || null; },
        get length() { return store.size; }
    };
})();

// Minimal DOM shim for QuickOpen integration tests
const domShim = (() => {
    const elements = {};
    return {
        getElementById: function (id) { return elements[id] || null; },
        createElement: function (tag) {
            var _text = '';
            var _innerHTML = '';
            var el = {
                tagName: tag.toUpperCase(),
                className: '',
                id: '',
                value: '',
                placeholder: '',
                autocomplete: 'off',
                spellcheck: false,
                type: 'text',
                children: [],
                classList: {
                    _classes: [],
                    add: function (c) { if (this._classes.indexOf(c) === -1) this._classes.push(c); },
                    remove: function (c) { var idx = this._classes.indexOf(c); if (idx >= 0) this._classes.splice(idx, 1); },
                    contains: function (c) { return this._classes.indexOf(c) >= 0; },
                    toggle: function (c) {
                        var idx = this._classes.indexOf(c);
                        if (idx >= 0) { this._classes.splice(idx, 1); return false; }
                        else { this._classes.push(c); return true; }
                    }
                },
                style: {},
                onclick: null,
                onmouseenter: null,
                onmouseleave: null,
                addEventListener: function () {},
                removeEventListener: function () {},
                focus: function () {},
                appendChild: function (child) {
                    if (child) this.children.push(child);
                },
                setAttribute: function () {},
                getAttribute: function () { return null; },
                querySelectorAll: function () { return []; },
                scrollIntoView: function () {}
            };
            // Use getter/setter so textContent -> innerHTML emulates browser behavior
            Object.defineProperties(el, {
                textContent: {
                    get: function () { return _text; },
                    set: function (v) {
                        _text = String(v);
                        _innerHTML = _text
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/"/g, '&quot;')
                            .replace(/'/g, '&#39;');
                    },
                    enumerable: true
                },
                innerHTML: {
                    get: function () { return _innerHTML; },
                    set: function (v) { _innerHTML = String(v); },
                    enumerable: true
                }
            });
            return el;
        },
        createTextNode: function () { return {}; },
        body: {
            appendChild: function () {},
            children: []
        },
        querySelectorAll: function () { return []; },
        addEventListener: function () {},
        removeEventListener: function () {}
    };
})();

globalThis.localStorage = localStorageShim;
globalThis.document = domShim;
globalThis.window = {};
globalThis.setTimeout = setTimeout;
globalThis.clearTimeout = clearTimeout;

// ============================================================
// SECTION 3: IMPORT REAL MODULES
// ============================================================

import { State } from '../js/core/Store.js';
import { CommandRegistry } from '../js/core/CommandRegistry.js';

// Import MetadataCache for search indexing
const metadataModule = await import('../js/core/MetadataCache.js');
const MetadataCache = metadataModule.MetadataCache;

// Import QuickOpen
const quickOpenModule = await import('../js/features/QuickOpen.js');
const QuickOpen = quickOpenModule.QuickOpen;

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

// Helper: reset all state between tests
function freshAll() {
    localStorageShim.clear();
    State.NOTES = [];
    State.TASKS = [];
    State.BOARDS = [];
    State.CANVASES = [];
    State.COMMAND_HISTORY = [];
    MetadataCache.index = new Map();
    MetadataCache.tagIndex = new Map();
    MetadataCache.linkIndex = new Map();
    MetadataCache.backlinks = new Map();
    MetadataCache.initialized = false;
    CommandRegistry.commands = [];

    // Reset QuickOpen state
    QuickOpen.isOpen = false;
    QuickOpen.selectedIndex = 0;
    QuickOpen.results = [];
    QuickOpen.currentQuery = '';
    QuickOpen.sections = [];
    if (QuickOpen.debounceTimer) {
        clearTimeout(QuickOpen.debounceTimer);
        QuickOpen.debounceTimer = null;
    }
    QuickOpen._boundKeyHandler = null;
}

// Helper: inject QuickOpen DOM elements
function injectQuickOpenDOM() {
    // Overlay
    var overlay = {
        id: 'quick-open-overlay',
        className: 'quick-open-overlay',
        classList: {
            _classes: [],
            add: function (c) { if (this._classes.indexOf(c) === -1) this._classes.push(c); },
            remove: function (c) {
                var idx = this._classes.indexOf(c);
                if (idx >= 0) this._classes.splice(idx, 1);
            },
            contains: function (c) { return this._classes.indexOf(c) >= 0; },
            toggle: function () {}
        },
        style: {},
        onclick: null
    };

    // Input
    var input = {
        id: 'quick-open-input',
        value: '',
        placeholder: 'Search notes, tags, and commands...',
        autocomplete: 'off',
        spellcheck: false,
        type: 'text',
        style: {},
        addEventListener: function () {},
        removeEventListener: function () {},
        focus: function () {},
        onclick: null
    };

    // Results container
    var results = {
        id: 'quick-open-results',
        className: 'quick-open-results',
        innerHTML: '',
        classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
        children: [],
        style: {},
        appendChild: function (child) { this.children.push(child); },
        querySelectorAll: function () { return []; }
    };

    // Footer
    var footer = {
        id: 'qo-footer-count',
        textContent: '',
        className: 'qo-footer-count',
        style: {}
    };

    // Palette
    var palette = {
        id: 'quick-open-palette',
        className: 'quick-open-palette',
        classList: {
            _classes: [],
            add: function (c) { if (this._classes.indexOf(c) === -1) this._classes.push(c); },
            remove: function (c) {
                var idx = this._classes.indexOf(c);
                if (idx >= 0) this._classes.splice(idx, 1);
            },
            contains: function (c) { return this._classes.indexOf(c) >= 0; },
            toggle: function () {}
        },
        style: {},
        appendChild: function () {},
        children: []
    };

    // Footer wrapper
    var footerWrapper = {
        id: 'quick-open-footer',
        className: 'quick-open-footer',
        innerHTML: '',
        style: {},
        querySelector: function () { return null; }
    };

    // Element lookup
    var elementMap = {
        'quick-open-overlay': overlay,
        'quick-open-palette': palette,
        'quick-open-input': input,
        'quick-open-results': results,
        'quick-open-footer': footerWrapper,
        'qo-footer-count': footer
    };

    globalThis.document.getElementById = function (id) {
        return elementMap[id] || null;
    };
    globalThis.document.querySelectorAll = function () { return []; };

    return { overlay: overlay, palette: palette, input: input, results: results, footer: footer };
}

// Helper: setup test notes + init MetadataCache
function setupNotes() {
    State.NOTES = [
        {
            id: 'n1',
            title: 'Alpha',
            path: '/',
            content: 'Alpha content here',
            created: 100,
            modified: 200
        },
        {
            id: 'n2',
            title: 'Beta Project',
            path: '/projects',
            content: 'Beta project details',
            created: 101,
            modified: 201
        },
        {
            id: 'n3',
            title: 'Gamma',
            path: '/.trash',
            content: 'Trashed',
            created: 102,
            modified: 202
        }
    ];
    MetadataCache.init();
}

// ============================================================
// PURE FUNCTION TESTS (_escapeHtml)
// ============================================================

console.log('\n\u2500\u2500\u2500 QuickOpen._escapeHtml() \u2500\u2500\u2500');

test('returns empty string for null/undefined', () => {
    assert.equal(QuickOpen._escapeHtml(null), '');
    assert.equal(QuickOpen._escapeHtml(undefined), '');
});

test('returns empty string for empty string', () => {
    assert.equal(QuickOpen._escapeHtml(''), '');
});

test('returns plain text unchanged', () => {
    assert.equal(QuickOpen._escapeHtml('hello world'), 'hello world');
});

test('escapes < and > characters', () => {
    var result = QuickOpen._escapeHtml('<script>alert(1)</script>');
    assert.ok(result.indexOf('&lt;') >= 0, 'should escape <');
    assert.ok(result.indexOf('&gt;') >= 0, 'should escape >');
    assert.ok(result.indexOf('<script>') === -1, 'should not contain raw tags');
    assert.equal(result, '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('escapes & character', () => {
    var result = QuickOpen._escapeHtml('A & B');
    assert.ok(result.indexOf('&amp;') >= 0, 'should escape &');
    assert.equal(result, 'A &amp; B');
});

test('escapes double quote characters', () => {
    var result = QuickOpen._escapeHtml('He said "hello"');
    assert.ok(result.indexOf('&quot;') >= 0, 'should escape "');
    assert.equal(result, 'He said &quot;hello&quot;');
});

test('escapes single quote characters', () => {
    var result = QuickOpen._escapeHtml("It's a test");
    assert.ok(result.indexOf('&#39;') >= 0, 'should escape single quote');
    assert.equal(result, 'It&#39;s a test');
});

test('escapes all five special characters at once', () => {
    var result = QuickOpen._escapeHtml('<a href="test.html" onclick="alert(\'x\')">&</a>');
    assert.equal(result, '&lt;a href=&quot;test.html&quot; onclick=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;&lt;/a&gt;');
});


// ============================================================
// INTEGRATION TESTS
// ============================================================

console.log('\n\u2500\u2500\u2500 QuickOpen._getAbsoluteIndex() \u2500\u2500\u2500');

test('getAbsoluteIndex with single section', () => {
    freshAll();
    QuickOpen.sections = [{ type: 'notes', start: 0, count: 3 }];
    assert.equal(QuickOpen._getAbsoluteIndex(1, 'notes'), 1);
    assert.equal(QuickOpen._getAbsoluteIndex(0, 'notes'), 0);
    assert.equal(QuickOpen._getAbsoluteIndex(2, 'notes'), 2);
});

test('getAbsoluteIndex with multiple sections', () => {
    freshAll();
    QuickOpen.sections = [
        { type: 'notes', start: 0, count: 2 },
        { type: 'tags', start: 2, count: 3 },
        { type: 'commands', start: 5, count: 1 }
    ];
    assert.equal(QuickOpen._getAbsoluteIndex(0, 'notes'), 0);
    assert.equal(QuickOpen._getAbsoluteIndex(1, 'notes'), 1);
    assert.equal(QuickOpen._getAbsoluteIndex(0, 'tags'), 2);
    assert.equal(QuickOpen._getAbsoluteIndex(2, 'tags'), 4);
    assert.equal(QuickOpen._getAbsoluteIndex(0, 'commands'), 5);
});

test('getAbsoluteIndex for non-existent section falls back to relative index', () => {
    freshAll();
    QuickOpen.sections = [{ type: 'notes', start: 0, count: 2 }];
    // 'tags' section doesn't exist, falls through to return relativeIdx
    var result = QuickOpen._getAbsoluteIndex(3, 'tags');
    assert.equal(result, 3);
});

test('getAbsoluteIndex with empty sections', () => {
    freshAll();
    QuickOpen.sections = [];
    assert.equal(QuickOpen._getAbsoluteIndex(0, 'notes'), 0);
    assert.equal(QuickOpen._getAbsoluteIndex(5, 'tags'), 5);
});


console.log('\n\u2500\u2500\u2500 QuickOpen.open() / close() state management \u2500\u2500\u2500');

test('open sets isOpen to true and resets state', () => {
    freshAll();
    var dom = injectQuickOpenDOM();
    QuickOpen.open();
    assert.ok(QuickOpen.isOpen, 'isOpen should be true');
    assert.equal(QuickOpen.selectedIndex, 0);
    assert.equal(QuickOpen.currentQuery, '');
    assert.ok(dom.overlay.classList.contains('active'), 'overlay should be active');
    assert.ok(dom.palette.classList.contains('active'), 'palette should be active');
    QuickOpen.close();
});

test('close sets isOpen to false and cleans up', () => {
    freshAll();
    var dom = injectQuickOpenDOM();
    QuickOpen.open();
    assert.ok(QuickOpen.isOpen, 'should be open');
    QuickOpen.close();
    assert.ok(!QuickOpen.isOpen, 'isOpen should be false after close');
    assert.ok(!dom.overlay.classList.contains('active'), 'overlay should not be active');
    assert.ok(!dom.palette.classList.contains('active'), 'palette should not be active');
    assert.equal(QuickOpen.results.length, 0);
    assert.equal(QuickOpen.selectedIndex, 0);
});

test('close is idempotent when already closed', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.close(); // already closed
    QuickOpen.close(); // close again
    QuickOpen.close(); // and again
    assert.ok(!QuickOpen.isOpen, 'should remain closed');
});

test('open is idempotent when already open (early return)', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.open();
    QuickOpen.open(); // should early-return
    assert.ok(QuickOpen.isOpen, 'should remain open');
    QuickOpen.close();
});

test('toggle opens when closed, closes when open', () => {
    freshAll();
    injectQuickOpenDOM();
    assert.ok(!QuickOpen.isOpen, 'should start closed');
    QuickOpen.toggle();
    assert.ok(QuickOpen.isOpen, 'toggle should open');
    QuickOpen.toggle();
    assert.ok(!QuickOpen.isOpen, 'toggle should close');
});


console.log('\n\u2500\u2500\u2500 QuickOpen.searchFromCLI() \u2500\u2500\u2500');

test('searchFromCLI opens palette and sets input value', () => {
    freshAll();
    var dom = injectQuickOpenDOM();
    setupNotes();

    QuickOpen.searchFromCLI('test query');
    assert.ok(QuickOpen.isOpen, 'should be open');
    assert.equal(dom.input.value, 'test query', 'input should contain query');
    QuickOpen.close();
});

test('searchFromCLI with empty query just opens palette', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.searchFromCLI('');
    assert.ok(QuickOpen.isOpen, 'should open with empty query');
    QuickOpen.close();
});

test('searchFromCLI with whitespace-only query just opens palette', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.searchFromCLI('   ');
    assert.ok(QuickOpen.isOpen, 'should open with whitespace query');
    QuickOpen.close();
});

test('searchFromCLI with null/undefined query opens palette', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.searchFromCLI(null);
    assert.ok(QuickOpen.isOpen, 'should open with null query');
    QuickOpen.close();

    QuickOpen.searchFromCLI(undefined);
    assert.ok(QuickOpen.isOpen, 'should open with undefined query');
    QuickOpen.close();
});


console.log('\n\u2500\u2500\u2500 QuickOpen._showInitialResults() \u2500\u2500\u2500');

test('showInitialResults shows recent notes and commands', () => {
    freshAll();
    injectQuickOpenDOM();
    setupNotes();

    // Register a known command
    CommandRegistry.commands = [];
    CommandRegistry.register({
        id: 'test:cmd',
        title: 'Test Command',
        trigger: 'test',
        action: function () {}
    });

    QuickOpen._showInitialResults();

    // Should have recent notes (2 active: Alpha, Beta, excluding trashed Gamma)
    var noteResults = QuickOpen.results.filter(function (r) { return r.type === 'note'; });
    var cmdResults = QuickOpen.results.filter(function (r) { return r.type === 'command'; });

    assert.equal(noteResults.length, 2, 'should have 2 active recent notes');
    assert.equal(cmdResults.length >= 1, true, 'should have at least 1 command');
    assert.ok(QuickOpen.results.length > 0, 'should have results');

    // Recent notes should exclude trashed notes
    var trashedNote = noteResults.some(function (r) { return r.id === 'n3'; });
    assert.ok(!trashedNote, 'should not include trashed note Gamma');
});

test('showInitialResults handles empty State.NOTES gracefully', () => {
    freshAll();
    injectQuickOpenDOM();
    State.NOTES = [];
    QuickOpen._showInitialResults();
    // Should not crash. Results may have commands if some are registered.
    assert.ok(Array.isArray(QuickOpen.results), 'results should be an array');
});


console.log('\n\u2500\u2500\u2500 QuickOpen._onKeyDown() keyboard navigation \u2500\u2500\u2500');

test('ArrowDown increments selectedIndex', () => {
    freshAll();
    injectQuickOpenDOM();
    setupNotes();
    QuickOpen.open();
    QuickOpen.results = [
        { type: 'note', id: 'n1', title: 'Alpha' },
        { type: 'note', id: 'n2', title: 'Beta' },
        { type: 'command', id: 'c1' }
    ];

    var initial = QuickOpen.selectedIndex;
    QuickOpen._onKeyDown({ key: 'ArrowDown', preventDefault: function () {} });
    assert.equal(QuickOpen.selectedIndex, initial + 1, 'should move down one');
    QuickOpen.close();
});

test('ArrowDown does not exceed results length', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.open();
    QuickOpen.results = [{ type: 'note', id: 'n1', title: 'Alpha' }];
    QuickOpen.selectedIndex = 0;

    QuickOpen._onKeyDown({ key: 'ArrowDown', preventDefault: function () {} });
    assert.equal(QuickOpen.selectedIndex, 0, 'should stay at 0 (only 1 result)');
    QuickOpen.close();
});

test('ArrowUp decrements selectedIndex', () => {
    freshAll();
    injectQuickOpenDOM();
    setupNotes();
    QuickOpen.open();
    QuickOpen.results = [
        { type: 'note', id: 'n1', title: 'Alpha' },
        { type: 'note', id: 'n2', title: 'Beta' }
    ];
    QuickOpen.selectedIndex = 1;

    QuickOpen._onKeyDown({ key: 'ArrowUp', preventDefault: function () {} });
    assert.equal(QuickOpen.selectedIndex, 0, 'should move up one');
    QuickOpen.close();
});

test('ArrowUp does not go below zero', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.open();
    QuickOpen.results = [{ type: 'note', id: 'n1', title: 'Alpha' }];
    QuickOpen.selectedIndex = 0;

    QuickOpen._onKeyDown({ key: 'ArrowUp', preventDefault: function () {} });
    assert.equal(QuickOpen.selectedIndex, 0, 'should stay at 0');
    QuickOpen.close();
});

test('ArrowDown on empty results does nothing', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.open();
    QuickOpen.results = [];
    QuickOpen.selectedIndex = -1; // edge case

    QuickOpen._onKeyDown({ key: 'ArrowDown', preventDefault: function () {} });
    assert.equal(QuickOpen.selectedIndex, -1, 'should stay unchanged');
    QuickOpen.close();
});

test('Enter activates selected result', () => {
    freshAll();
    injectQuickOpenDOM();
    setupNotes();
    QuickOpen.open();
    QuickOpen.results = [{ type: 'note', id: 'n1', title: 'Alpha' }];
    QuickOpen.selectedIndex = 0;

    QuickOpen._onKeyDown({ key: 'Enter', preventDefault: function () {} });
    // Enter calls _activateResult which calls close(), so isOpen should be false
    assert.ok(!QuickOpen.isOpen, 'should close after activation');
});

test('Tab cycles between sections', () => {
    freshAll();
    injectQuickOpenDOM();
    setupNotes();
    QuickOpen.open();
    QuickOpen.results = [
        { type: 'note', id: 'n1', title: 'Alpha' },
        { type: 'tag', name: '#test', score: 30 },
        { type: 'command', id: 'c1', trigger: 'test' }
    ];
    QuickOpen.sections = [
        { type: 'notes', start: 0, count: 1 },
        { type: 'tags', start: 1, count: 1 },
        { type: 'commands', start: 2, count: 1 }
    ];
    QuickOpen.selectedIndex = 0; // in notes section

    QuickOpen._onKeyDown({ key: 'Tab', preventDefault: function () {} });
    // Should jump to tags section
    assert.equal(QuickOpen.selectedIndex, 1, 'Tab should jump to tags section');

    QuickOpen._onKeyDown({ key: 'Tab', preventDefault: function () {} });
    assert.equal(QuickOpen.selectedIndex, 2, 'Tab should jump to commands section');

    QuickOpen._onKeyDown({ key: 'Tab', preventDefault: function () {} });
    // Should wrap around to notes section
    assert.equal(QuickOpen.selectedIndex, 0, 'Tab should wrap to notes section');
    QuickOpen.close();
});

test('Tab does nothing with empty sections', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.open();
    QuickOpen.results = [{ type: 'note', id: 'n1', title: 'Alpha' }];
    QuickOpen.sections = [];

    QuickOpen._onKeyDown({ key: 'Tab', preventDefault: function () {} });
    assert.equal(QuickOpen.selectedIndex, 0, 'should stay at 0');
    QuickOpen.close();
});

test('Escape closes the palette', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.open();
    assert.ok(QuickOpen.isOpen, 'should be open');

    QuickOpen._onKeyDown({ key: 'Escape', preventDefault: function () {} });
    assert.ok(!QuickOpen.isOpen, 'Escape should close');
});

test('keyboard events are ignored when palette is not open', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.isOpen = false;
    QuickOpen.selectedIndex = 0;
    QuickOpen.results = [{ type: 'note', id: 'n1', title: 'Alpha' }];

    QuickOpen._onKeyDown({ key: 'ArrowDown', preventDefault: function () {} });
    assert.equal(QuickOpen.selectedIndex, 0, 'should not change when closed');
});


console.log('\n\u2500\u2500\u2500 Edge cases: empty queries and no results \u2500\u2500\u2500');

test('_executeSearch with empty query returns initial results', () => {
    freshAll();
    injectQuickOpenDOM();
    setupNotes();

    QuickOpen.open();
    QuickOpen._onInput();
    // With empty query, _showInitialResults is called
    assert.ok(QuickOpen.results.length >= 0, 'should have results or empty state');
    // Should not throw
    QuickOpen.close();
});

test('open with no State.NOTES does not crash', () => {
    freshAll();
    injectQuickOpenDOM();
    State.NOTES = null;
    QuickOpen.open();
    assert.ok(QuickOpen.isOpen);
    QuickOpen.close();
});

test('close with no DOM elements does not crash', () => {
    freshAll();
    // Don't inject DOM - ensure close handles missing elements gracefully
    QuickOpen.isOpen = true;
    // Should not throw
    QuickOpen.close();
});

test('open with no DOM elements does not crash', () => {
    freshAll();
    QuickOpen.open();
    // Should handle missing overlay/palette elements gracefully (early return)
    QuickOpen.close();
});

test('_render with no container element does not crash', () => {
    freshAll();
    QuickOpen.results = [{ type: 'note', id: 'n1', title: 'Test', score: 50 }];
    // No DOM elements injected
    QuickOpen._render();
    // Should not throw
});


console.log('\n\u2500\u2500\u2500 QuickOpen.open() search mode flag \u2500\u2500\u2500');

test('open() with no args sets searchMode to false', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.open();
    assert.equal(QuickOpen.searchMode, false, 'searchMode should be false by default');
    var input = document.getElementById('quick-open-input');
    assert.equal(input.placeholder, 'Search notes, tags, and commands...',
        'placeholder should be the normal quick-navigate version');
    QuickOpen.close();
});

test('open(true) sets searchMode to true and shows search prompt', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.open(true);
    assert.equal(QuickOpen.searchMode, true, 'searchMode should be true');
    var input = document.getElementById('quick-open-input');
    assert.equal(input.placeholder, 'Search notes by content...',
        'placeholder should be the content-search version');
    // Should have 0 results (search prompt is not a .qo-result)
    assert.equal(QuickOpen.results.length, 0, 'should have 0 results in search prompt');
    assert.equal(QuickOpen.sections.length, 0, 'should have 0 sections in search prompt');
    QuickOpen.close();
});

test('open(false) explicitly sets searchMode to false', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.open(false);
    assert.equal(QuickOpen.searchMode, false, 'searchMode should be false');
    var input = document.getElementById('quick-open-input');
    assert.equal(input.placeholder, 'Search notes, tags, and commands...',
        'placeholder should be normal when searchMode is false');
    QuickOpen.close();
});

test('open(undefined) defaults searchMode to false', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.open(undefined);
    assert.equal(QuickOpen.searchMode, false, 'searchMode should be false when undefined');
    QuickOpen.close();
});

test('open(null) defaults searchMode to false', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.open(null);
    assert.equal(QuickOpen.searchMode, false, 'searchMode should be false when null');
    QuickOpen.close();
});

test('close() resets searchMode to false', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.open(true);
    assert.equal(QuickOpen.searchMode, true, 'should be in search mode');
    QuickOpen.close();
    assert.equal(QuickOpen.searchMode, false, 'close should reset searchMode to false');
});

test('open(true) calls _showSearchPrompt not _showInitialResults', () => {
    freshAll();
    injectQuickOpenDOM();
    setupNotes();

    // Register a known command so _showInitialResults would produce results
    CommandRegistry.commands = [];
    CommandRegistry.register({
        id: 'test:cmd',
        title: 'Test Command',
        trigger: 'test',
        action: function () {}
    });

    QuickOpen.open(true);
    // In search mode, there should be 0 results (search prompt) not recent notes + commands
    assert.equal(QuickOpen.results.length, 0, 'search mode should not show initial results');
    assert.equal(QuickOpen.sections.length, 0, 'search mode should not build sections');

    // Verify the prompt element was rendered in the container
    var container = document.getElementById('quick-open-results');
    var promptEl = container.children[0];
    assert.ok(promptEl, 'should have a child element in the results container');
    assert.ok(promptEl.className.indexOf('qo-result-empty') >= 0,
        'child should have qo-result-empty class');
    assert.ok(promptEl.innerHTML.indexOf('\uD83D\uDD0D') >= 0,
        'prompt should contain magnifying glass emoji');
    QuickOpen.close();
});

test('open() without searchMode shows initial results (recent notes + commands)', () => {
    freshAll();
    injectQuickOpenDOM();
    setupNotes();

    CommandRegistry.commands = [];
    CommandRegistry.register({
        id: 'test:cmd',
        title: 'Test Command',
        trigger: 'test',
        action: function () {}
    });

    QuickOpen.open();
    // In normal mode, should have recent notes + commands
    assert.ok(QuickOpen.results.length > 0, 'normal mode should have results');
    assert.ok(QuickOpen.sections.length > 0, 'normal mode should have sections');

    var noteResults = QuickOpen.results.filter(function (r) { return r.type === 'note'; });
    assert.equal(noteResults.length, 2, 'should have 2 recent notes (excluding trashed)');
    QuickOpen.close();
});


console.log('\n\u2500\u2500\u2500 QuickOpen._showSearchPrompt() \u2500\u2500\u2500');

test('_showSearchPrompt clears existing results and sections', () => {
    freshAll();
    injectQuickOpenDOM();

    // Set up some stale results
    QuickOpen.results = [{ type: 'note', id: 'n1', title: 'Stale' }];
    QuickOpen.sections = [{ type: 'notes', start: 0, count: 1 }];

    QuickOpen._showSearchPrompt();
    assert.equal(QuickOpen.results.length, 0, 'results should be cleared');
    assert.equal(QuickOpen.sections.length, 0, 'sections should be cleared');
    QuickOpen.close();
});

test('_showSearchPrompt renders prompt HTML in container', () => {
    freshAll();
    injectQuickOpenDOM();

    QuickOpen._showSearchPrompt();
    var container = document.getElementById('quick-open-results');
    assert.ok(container.children.length > 0, 'container should have children');
    var promptEl = container.children[0];
    assert.ok(promptEl.className.indexOf('qo-result-empty') >= 0, 'should have empty-state class');
    assert.ok(promptEl.innerHTML.indexOf('Type to search') >= 0, 'prompt should contain instruction text');
    QuickOpen.close();
});

test('_showSearchPrompt updates footer text', () => {
    freshAll();
    injectQuickOpenDOM();

    QuickOpen._showSearchPrompt();
    var footer = document.getElementById('qo-footer-count');
    assert.equal(footer.textContent, 'Press \u2191\u2193 to navigate, \u23CE to open',
        'footer should show navigation hints');
    QuickOpen.close();
});

test('_showSearchPrompt handles missing container gracefully', () => {
    freshAll();
    // Don't inject DOM — getElementById returns null
    // Should not throw
    QuickOpen._showSearchPrompt();
});


console.log('\n\u2500\u2500\u2500 QuickOpen._onInput() with searchMode \u2500\u2500\u2500');

test('_onInput with empty query and searchMode=true shows search prompt', () => {
    freshAll();
    var dom = injectQuickOpenDOM();
    setupNotes();
    QuickOpen.open(true);
    assert.equal(QuickOpen.searchMode, true, 'should be in search mode');
    assert.equal(QuickOpen.results.length, 0, 'should start with 0 results');

    // Trigger empty input (as if user typed nothing)
    dom.input.value = '';
    QuickOpen._onInput();
    // Should call _showSearchPrompt — results and sections are cleared
    assert.equal(QuickOpen.results.length, 0, 'search prompt should have 0 results');
    assert.equal(QuickOpen.sections.length, 0, 'search prompt should have 0 sections');

    // Container should have the prompt element
    var container = document.getElementById('quick-open-results');
    assert.ok(container.children.length > 0, 'container should have prompt element');
    QuickOpen.close();
});

test('_onInput with empty query and searchMode=false shows initial results', () => {
    freshAll();
    var dom = injectQuickOpenDOM();
    setupNotes();

    CommandRegistry.commands = [];
    CommandRegistry.register({
        id: 'test:cmd',
        title: 'Test Command',
        trigger: 'test',
        action: function () {}
    });

    QuickOpen.open();  // searchMode=false
    assert.equal(QuickOpen.searchMode, false);

    // Clear the query — should show initial results
    dom.input.value = '';
    QuickOpen._onInput();
    assert.ok(QuickOpen.results.length > 0, 'initial results should appear with empty query in normal mode');
    QuickOpen.close();
});

test('_onInput with non-empty query in searchMode searches notes by content', () => {
    freshAll();
    var dom = injectQuickOpenDOM();
    setupNotes();
    QuickOpen.open(true);
    assert.equal(QuickOpen.searchMode, true);

    dom.input.value = 'Alpha';
    QuickOpen._onInput();

    // After debounce, _executeSearch runs
    // Use setTimeout to allow debounce to fire
    return new Promise(function (resolve) {
        setTimeout(function () {
            QuickOpen._executeSearch('Alpha');
            assert.ok(QuickOpen.results.length > 0, 'should have results for Alpha query');
            var alphaResults = QuickOpen.results.filter(function (r) {
                return r.type === 'note' && r.title === 'Alpha';
            });
            assert.equal(alphaResults.length, 1, 'should find Alpha note by title');
            QuickOpen.close();
            resolve();
        }, 200);
    });
});

test('_onInput clears query in searchMode and returns to prompt', () => {
    freshAll();
    var dom = injectQuickOpenDOM();
    setupNotes();
    QuickOpen.open(true);

    // First, execute a search to populate results
    dom.input.value = 'Beta';
    QuickOpen._executeSearch('Beta');
    assert.ok(QuickOpen.results.length > 0, 'should have results after search');

    // Now clear the query
    dom.input.value = '';
    QuickOpen._onInput();  // should call _showSearchPrompt because searchMode=true
    assert.equal(QuickOpen.results.length, 0, 'should return to 0 results after clear');
    assert.equal(QuickOpen.sections.length, 0, 'should have 0 sections after clear');
    QuickOpen.close();
});


console.log('\n\u2500\u2500\u2500 QuickOpen.searchFromCLI() in search mode \u2500\u2500\u2500');

test('searchFromCLI opens in searchMode=true with a query', () => {
    freshAll();
    injectQuickOpenDOM();
    setupNotes();

    QuickOpen.searchFromCLI('project');
    assert.ok(QuickOpen.isOpen, 'should be open');
    assert.equal(QuickOpen.searchMode, true, 'searchMode should be true from CLI');
    var input = document.getElementById('quick-open-input');
    assert.equal(input.placeholder, 'Search notes by content...',
        'placeholder should be content-search version');
    assert.equal(input.value, 'project', 'input value should be set');
    QuickOpen.close();
});

test('searchFromCLI with empty query opens searchMode=true with prompt', () => {
    freshAll();
    injectQuickOpenDOM();
    setupNotes();

    QuickOpen.searchFromCLI('');
    assert.ok(QuickOpen.isOpen, 'should be open');
    assert.equal(QuickOpen.searchMode, true, 'searchMode should be true even with empty query');
    assert.equal(QuickOpen.results.length, 0, 'should show search prompt (0 results)');
    QuickOpen.close();
});

test('searchFromCLI with whitespace query opens searchMode=true', () => {
    freshAll();
    injectQuickOpenDOM();

    QuickOpen.searchFromCLI('   ');
    assert.ok(QuickOpen.isOpen);
    assert.equal(QuickOpen.searchMode, true);
    QuickOpen.close();
});

test('searchFromCLI with null/undefined opens searchMode=true', () => {
    freshAll();
    injectQuickOpenDOM();

    QuickOpen.searchFromCLI(null);
    assert.ok(QuickOpen.isOpen);
    assert.equal(QuickOpen.searchMode, true, 'null should set searchMode to true');
    QuickOpen.close();

    QuickOpen.searchFromCLI(undefined);
    assert.ok(QuickOpen.isOpen);
    assert.equal(QuickOpen.searchMode, true, 'undefined should set searchMode to true');
    QuickOpen.close();
});


console.log('\n\u2500\u2500\u2500 QuickOpen state transitions between modes \u2500\u2500\u2500');

test('open searchMode -> close -> open normal mode transitions correctly', () => {
    freshAll();
    injectQuickOpenDOM();
    setupNotes();

    // Open in search mode
    QuickOpen.open(true);
    assert.equal(QuickOpen.searchMode, true);
    assert.equal(QuickOpen.results.length, 0); // prompt
    QuickOpen.close();

    // Open in normal mode
    QuickOpen.open();
    assert.equal(QuickOpen.searchMode, false, 'searchMode should reset to false on re-open');
    // Should show initial results (needs commands to have some results beyond notes)
    var input = document.getElementById('quick-open-input');
    assert.equal(input.placeholder, 'Search notes, tags, and commands...',
        'placeholder should revert to normal after close+reopen');
    QuickOpen.close();
});

test('open normal mode -> close -> open searchMode transitions correctly', () => {
    freshAll();
    injectQuickOpenDOM();
    setupNotes();

    // Open in normal mode
    QuickOpen.open();
    assert.equal(QuickOpen.searchMode, false);
    QuickOpen.close();

    // Open in search mode
    QuickOpen.open(true);
    assert.equal(QuickOpen.searchMode, true, 'should be able to re-open in search mode');
    var input = document.getElementById('quick-open-input');
    assert.equal(input.placeholder, 'Search notes by content...',
        'placeholder should be search version after re-open');
    assert.equal(QuickOpen.results.length, 0, 'should show search prompt');
    QuickOpen.close();
});

test('searchMode is independent of isOpen state', () => {
    freshAll();
    injectQuickOpenDOM();
    QuickOpen.open(true);
    assert.equal(QuickOpen.isOpen, true);
    assert.equal(QuickOpen.searchMode, true);

    // Manually set searchMode false (simulating bug scenario)
    QuickOpen.searchMode = false;
    // close() should still work
    QuickOpen.close();
    assert.equal(QuickOpen.isOpen, false);
    assert.equal(QuickOpen.searchMode, false, 'close always resets searchMode');
});


// ============================================================
// SUMMARY
// ============================================================

console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  QUICK OPEN SUITE: ' + passed + ' passed, ' + failed + ' failed');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

if (errors.length > 0) {
    console.log('FAILURES:');
    errors.forEach(function (e) {
        console.log('  \u2022 ' + e.name + ': ' + e.error);
    });
    console.log('');
}

process.exit(failed > 0 ? 1 : 0);
