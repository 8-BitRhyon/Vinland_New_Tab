/**
 * Vinland MetadataCache System - Unit Tests
 *
 * Tests two layers:
 *   1. Pure function extracts (no state/DOM needed) – parseFrontmatter,
 *      extractTags, extractWikiLinks (same pattern as notes-unit-tests.mjs)
 *   2. Integration tests importing the REAL MetadataCache module with
 *      State + localStorage shims (same pattern as storage-shard.test.mjs)
 *
 * Run with: node tests/metadata-cache-unit-tests.mjs
 * (aggregated by tests/run-all.mjs)
 */

import assert from 'node:assert/strict';

// ============================================================
// SECTION 1: PURE FUNCTION EXTRACTS (from MetadataCache.js)
// These are copied from source to test in isolation. Keep in sync
// if the source functions are modified.
// ============================================================

function parseFrontmatter(content) {
    if (!content || typeof content !== 'string') return { frontmatter: {}, body: content || '' };

    var fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!fmMatch) return { frontmatter: {}, body: content };

    var fmText = fmMatch[1];
    var body = fmMatch[2];
    var frontmatter = {};

    var lines = fmText.split('\n');
    lines.forEach(line => {
        var match = line.match(/^\s*([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
        if (match) {
            var key = match[1].trim();
            var value = match[2].trim();

            // Handle arrays: [item1, item2]
            if (value.startsWith('[') && value.endsWith(']')) {
                value = value.slice(1, -1).split(',').map(function (v) { return v.trim(); });
            }
            // Handle quoted strings
            else if ((value.startsWith('"') && value.endsWith('"')) ||
                     (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            // Handle booleans
            else if (value === 'true') value = true;
            else if (value === 'false') value = false;
            // Handle numbers
            else if (!isNaN(value)) value = parseFloat(value);

            frontmatter[key] = value;
        }
    });

    return { frontmatter: frontmatter, body: body };
}

function extractTags(content, frontmatter) {
    var tags = new Set();

    // Get tags from frontmatter
    if (frontmatter && frontmatter.tags) {
        var fmTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags];
        fmTags.forEach(function (tag) {
            if (typeof tag === 'string') {
                tags.add(tag.replace(/^#/, '').toLowerCase());
            }
        });
    }

    // Extract #hashtags from content
    if (content) {
        var hashtagMatches = content.match(/#[\w-]+/g);
        if (hashtagMatches) {
            hashtagMatches.forEach(function (tag) {
                tags.add(tag.replace(/^#/, '').toLowerCase());
            });
        }
    }

    return Array.from(tags);
}

function extractWikiLinks(content) {
    if (!content) return [];

    var links = [];
    var regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    var match;

    while ((match = regex.exec(content)) !== null) {
        links.push({
            target: match[1].trim(),
            alias: match[2] ? match[2].trim() : match[1].trim()
        });
    }

    return links;
}

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

globalThis.localStorage = localStorageShim;
globalThis.document = { getElementById: function () { return null; } };
globalThis.window = {};
// Storage.js accesses indexedDB only conditionally with typeof check; we don't need it
// but the typeof check guards against access in Node

// ============================================================
// SECTION 3: IMPORT REAL MODULES
// ============================================================

import { State } from '../js/core/Store.js';
// The MetadataCache import will also pull in Storage.js (which uses the shims above)
const metadataModule = await import('../js/core/MetadataCache.js');
const MetadataCache = metadataModule.MetadataCache;

// Also need saveData for testing saveCache dependencies
const storageModule = await import('../js/core/Storage.js');
const { loadData, saveData } = storageModule;

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

// Helper: reset MetadataCache internals between integration tests
function freshCache() {
    MetadataCache.index = new Map();
    MetadataCache.tagIndex = new Map();
    MetadataCache.linkIndex = new Map();
    MetadataCache.backlinks = new Map();
    MetadataCache.initialized = false;
    localStorageShim.clear();
}

// Helper: populate State.NOTES with test notes
function setupTestNotes() {
    State.NOTES = [
        {
            id: 'n1',
            title: 'Alpha',
            path: '/',
            content: 'This is [[Beta]] and #important',
            created: 1000,
            modified: 2000
        },
        {
            id: 'n2',
            title: 'Beta',
            path: '/docs',
            content: 'See [[Alpha]] and [[Gamma]]. Tagged #reference',
            created: 1001,
            modified: 2001
        },
        {
            id: 'n3',
            title: 'Gamma',
            path: '/docs/archive',
            content: 'No links here, just #archive #old',
            created: 1002,
            modified: 2002
        },
        {
            id: 'n4',
            title: 'Delta',
            path: '/.trash',
            content: 'Trashed note with #hidden tag',
            created: 1003,
            modified: 2003
        },
        {
            id: 'n5',
            title: 'Empty Note',
            path: '/',
            content: '',
            created: 1004,
            modified: 2004
        }
    ];
}

// Helper: pre-populate test notes + init MetadataCache
function setupAndInit() {
    setupTestNotes();
    MetadataCache.init();
}

// ============================================================
// PURE FUNCTION TESTS
// ============================================================

console.log('\n\u2500\u2500\u2500 parseFrontmatter() \u2500\u2500\u2500');

test('returns empty frontmatter + body for null/undefined/empty', () => {
    var r1 = parseFrontmatter(null);
    assert.deepEqual(r1.frontmatter, {});
    assert.equal(r1.body, '');

    var r2 = parseFrontmatter(undefined);
    assert.deepEqual(r2.frontmatter, {});
    assert.equal(r2.body, '');

    var r3 = parseFrontmatter('');
    assert.deepEqual(r3.frontmatter, {});
    assert.equal(r3.body, '');
});

test('returns empty frontmatter + full body when no frontmatter delimiter', () => {
    var r = parseFrontmatter('just plain text\nno frontmatter here');
    assert.deepEqual(r.frontmatter, {});
    assert.equal(r.body, 'just plain text\nno frontmatter here');
});

test('parses simple key: value frontmatter', () => {
    var r = parseFrontmatter('---\ntitle: Hello\nstatus: Active\n---\nBody text');
    assert.equal(r.frontmatter.title, 'Hello');
    assert.equal(r.frontmatter.status, 'Active');
    assert.equal(r.body, 'Body text');
});

test('parses boolean frontmatter values', () => {
    var r = parseFrontmatter('---\npublished: true\narchived: false\n---\nBody');
    assert.equal(r.frontmatter.published, true);
    assert.equal(r.frontmatter.archived, false);
});

test('parses numeric frontmatter values', () => {
    var r = parseFrontmatter('---\npriority: 5\nprice: 19.99\ncount: 0\n---\nBody');
    assert.equal(r.frontmatter.priority, 5);
    assert.equal(r.frontmatter.price, 19.99);
    assert.equal(r.frontmatter.count, 0);
});

test('parses array frontmatter values', () => {
    var r = parseFrontmatter('---\ntags: [urgent, frontend, bug]\ncategories: [dev, ops]\n---\nBody');
    assert.deepEqual(r.frontmatter.tags, ['urgent', 'frontend', 'bug']);
    assert.deepEqual(r.frontmatter.categories, ['dev', 'ops']);
});

test('parses quoted string frontmatter values', () => {
    var r = parseFrontmatter('---\ntitle: "My Note"\nsubtitle: \'Single Quoted\'\n---\nBody');
    assert.equal(r.frontmatter.title, 'My Note');
    assert.equal(r.frontmatter.subtitle, 'Single Quoted');
});

test('parses frontmatter with indented keys', () => {
    var r = parseFrontmatter('---\n  key1: val1\n  key2: val2\n---\nBody');
    assert.equal(r.frontmatter.key1, 'val1');
    assert.equal(r.frontmatter.key2, 'val2');
});

test('strips body from frontmatter correctly preserving newlines', () => {
    var r = parseFrontmatter('---\ntitle: Multi\n---\nLine1\n\nLine2\n\nLine3');
    assert.equal(r.frontmatter.title, 'Multi');
    assert.equal(r.body, 'Line1\n\nLine2\n\nLine3');
});

test('handles body with frontmatter-like content that is not actually frontmatter', () => {
    var r = parseFrontmatter('This is not frontmatter\n---\nstill not frontmatter');
    assert.deepEqual(r.frontmatter, {});
    assert.equal(r.body, 'This is not frontmatter\n---\nstill not frontmatter');
});

test('handles keys with underscores and hyphens', () => {
    var r = parseFrontmatter('---\nmy_key: val\nanother-key: val2\n---\nBody');
    assert.equal(r.frontmatter.my_key, 'val');
    assert.equal(r.frontmatter['another-key'], 'val2');
});

test('EDGE: value with colon inside string does not break parsing', () => {
    var r = parseFrontmatter('---\ndescription: "time: 10:30"\n---\nBody');
    assert.equal(r.frontmatter.description, 'time: 10:30');
});

test('EDGE: zero as number is correctly parsed', () => {
    var r = parseFrontmatter('---\ncount: 0\n---\nBody');
    assert.strictEqual(r.frontmatter.count, 0);
    assert.strictEqual(typeof r.frontmatter.count, 'number');
});

test('EDGE: string "0" as value without frontmatter delimiters remains body text', () => {
    var r = parseFrontmatter('count: 0');
    assert.deepEqual(r.frontmatter, {});
    assert.equal(r.body, 'count: 0');
});


console.log('\n\u2500\u2500\u2500 extractTags() \u2500\u2500\u2500');

test('returns empty array for null/undefined/empty content and no frontmatter', () => {
    assert.deepEqual(extractTags(null, {}), []);
    assert.deepEqual(extractTags(undefined, {}), []);
    assert.deepEqual(extractTags('', {}), []);
});

test('extracts single #hashtag from content', () => {
    var tags = extractTags('hello #world', {});
    assert.deepEqual(tags, ['world']);
});

test('extracts multiple #hashtags from content', () => {
    var tags = extractTags('#urgent #important task', {});
    assert.ok(tags.includes('urgent'));
    assert.ok(tags.includes('important'));
    assert.equal(tags.length, 2);
});

test('extracts tags from frontmatter tags array', () => {
    var tags = extractTags('Body text', { tags: ['project', 'active'] });
    assert.ok(tags.includes('project'));
    assert.ok(tags.includes('active'));
});

test('extracts single frontmatter tag (not in array)', () => {
    var tags = extractTags('Body text', { tags: 'single-tag' });
    assert.deepEqual(tags, ['single-tag']);
});

test('combines frontmatter and content tags with deduplication', () => {
    var tags = extractTags('#project content', { tags: ['project', 'active'] });
    assert.equal(tags.length, 2);
    assert.ok(tags.includes('project'));
    assert.ok(tags.includes('active'));
});

test('removes # prefix from frontmatter tags and lowercases', () => {
    var tags = extractTags('', { tags: ['#URGENT', '#Project'] });
    assert.ok(tags.includes('urgent'));
    assert.ok(tags.includes('project'));
});

test('lowercases #hashtag matches', () => {
    var tags = extractTags('#URGENT', {});
    assert.deepEqual(tags, ['urgent']);
});

test('supports tags with hyphens', () => {
    var tags = extractTags('#my-tag #another-one', {});
    assert.deepEqual(tags.sort(), ['another-one', 'my-tag']);
});

test('deduplicates identical tags from content and frontmatter', () => {
    var tags = extractTags('#project', { tags: ['project'] });
    assert.equal(tags.length, 1);
    assert.equal(tags[0], 'project');
});

test('EDGE: returns empty array when no tags exist in content or frontmatter', () => {
    assert.deepEqual(extractTags('plain text with no tags', {}), []);
});

test('EDGE: handles undefined frontmatter gracefully', () => {
    assert.deepEqual(extractTags('#tag', undefined), ['tag']);
});

test('EDGE: handles null frontmatter gracefully', () => {
    assert.deepEqual(extractTags('#tag', null), ['tag']);
});

test('EDGE: handles frontmatter with tags set to empty array', () => {
    assert.deepEqual(extractTags('', { tags: [] }), []);
});


console.log('\n\u2500\u2500\u2500 extractWikiLinks() \u2500\u2500\u2500');

test('returns empty array for null/undefined/empty content', () => {
    assert.deepEqual(extractWikiLinks(null), []);
    assert.deepEqual(extractWikiLinks(undefined), []);
    assert.deepEqual(extractWikiLinks(''), []);
});

test('extracts basic [[Page]] wiki link', () => {
    var links = extractWikiLinks('see [[My Page]]');
    assert.equal(links.length, 1);
    assert.equal(links[0].target, 'My Page');
    assert.equal(links[0].alias, 'My Page');
});

test('extracts [[Page|Alias]] with pipe alias', () => {
    var links = extractWikiLinks('go to [[Destination|the place]]');
    assert.equal(links.length, 1);
    assert.equal(links[0].target, 'Destination');
    assert.equal(links[0].alias, 'the place');
});

test('extracts multiple wiki links', () => {
    var links = extractWikiLinks('see [[Alpha]], [[Beta]], and [[Gamma|last]]');
    assert.equal(links.length, 3);
    assert.equal(links[0].target, 'Alpha');
    assert.equal(links[1].target, 'Beta');
    assert.equal(links[2].target, 'Gamma');
    assert.equal(links[2].alias, 'last');
});

test('handles wiki links with no content between brackets', () => {
    var links = extractWikiLinks('[[Page1]][[Page2]]');
    assert.equal(links.length, 2);
    assert.equal(links[0].target, 'Page1');
    assert.equal(links[1].target, 'Page2');
});

test('trims whitespace inside wiki link brackets', () => {
    var links = extractWikiLinks('see [[  Spaced Page  |  alias  ]]');
    assert.equal(links.length, 1);
    assert.equal(links[0].target, 'Spaced Page');
    assert.equal(links[0].alias, 'alias');
});

test('handles wiki links with special characters in target', () => {
    var links = extractWikiLinks('see [[Project_123]]');
    assert.equal(links.length, 1);
    assert.equal(links[0].target, 'Project_123');
});

test('returns empty array for content with only regular brackets', () => {
    var links = extractWikiLinks('just [brackets] not wiki links');
    assert.equal(links.length, 0);
});

test('returns empty array for content with single bracket pairs', () => {
    var links = extractWikiLinks('see [link text](http://url.com) not [[wiki]]');
    assert.equal(links.length, 1);
    assert.equal(links[0].target, 'wiki');
});

test('EDGE: alias containing brackets returns no match (regex alias excludes ])', () => {
    var links = extractWikiLinks('[[Page|[brackets] in alias]]');
    assert.equal(links.length, 0, 'alias capture [^\\]]+ excludes brackets, so no match');
});

test('EDGE: empty wiki link [[]] returns no results (regex requires target chars)', () => {
    var links = extractWikiLinks('[[]]');
    assert.equal(links.length, 0, 'should not match because target needs at least 1 char');
});

test('EDGE: pipe with empty alias [[Page|]] returns no results (regex requires alias chars)', () => {
    var links = extractWikiLinks('[[Page|]]');
    assert.equal(links.length, 0, 'should not match because alias needs at least 1 char after pipe');
});


// ============================================================
// INTEGRATION TESTS (real MetadataCache module)
// ============================================================

console.log('\n\u2500\u2500\u2500 MetadataCache.updateNote() \u2500\u2500\u2500');

test('indexes a note with content and extracts metadata', () => {
    freshCache();
    State.NOTES = [{
        id: 'test1',
        title: 'Test Note',
        path: '/',
        content: 'Hello [[Wiki]] world #tag1',
        created: 100,
        modified: 200
    }];
    var meta = MetadataCache.updateNote('test1');
    assert.ok(meta, 'should return metadata');
    assert.equal(meta.title, 'Test Note');
    assert.equal(meta.tags.length, 1);
    assert.equal(meta.tags[0], 'tag1');
    assert.equal(meta.links.length, 1);
    assert.equal(meta.links[0].target, 'Wiki');
    // body = 'Hello [[Wiki]] world #tag1' -> split on /\s+/ -> ['Hello', '[[Wiki]]', 'world', '#tag1'] = 4 tokens
    assert.equal(meta.wordCount, 4);
    assert.equal(meta.blockCount, 0); // no blocks
});

test('indexes note with blocks instead of content', () => {
    freshCache();
    State.NOTES = [{
        id: 'test2',
        title: 'Block Note',
        path: '/',
        blocks: [
            { content: 'First block [[Target]]' },
            { content: 'Second block #urgent' }
        ],
        created: 100,
        modified: 200
    }];
    var meta = MetadataCache.updateNote('test2');
    assert.ok(meta, 'should return metadata');
    assert.equal(meta.links.length, 1);
    assert.equal(meta.links[0].target, 'Target');
    assert.ok(meta.tags.includes('urgent'));
    assert.equal(meta.blockCount, 2);
});

test('returns null for non-existent note and removes from cache if present', () => {
    freshCache();
    var meta = MetadataCache.updateNote('nonexistent');
    assert.equal(meta, null, 'should return null for non-existent note');
});

test('returns null for null/undefined note id', () => {
    freshCache();
    assert.equal(MetadataCache.updateNote(null), null);
    assert.equal(MetadataCache.updateNote(undefined), null);
});

test('removes note from cache when updateNote is called on a deleted note', () => {
    freshCache();
    State.NOTES = [{ id: 'gone', title: 'Gone', content: 'bye' }];
    MetadataCache.updateNote('gone');
    assert.ok(MetadataCache.get('gone'), 'should exist before deletion');
    assert.equal(MetadataCache.index.size, 1);

    // Remove from State and update again
    State.NOTES = [];
    var result = MetadataCache.updateNote('gone');
    assert.equal(result, null, 'should return null for deleted note');
    assert.equal(MetadataCache.index.size, 0, 'should remove from cache');
    assert.equal(MetadataCache.get('gone'), null, 'get should return null');
});


console.log('\n\u2500\u2500\u2500 MetadataCache.init() \u2500\u2500\u2500');

test('init indexes all notes in State.NOTES', () => {
    freshCache();
    setupTestNotes();
    MetadataCache.init();
    assert.ok(MetadataCache.initialized, 'initialized flag set');
    assert.equal(MetadataCache.index.size, 5, 'should index all 5 notes');
    assert.ok(MetadataCache.get('n1'), 'should have n1');
    assert.ok(MetadataCache.get('n5'), 'should have empty note n5');
});

test('init is idempotent (second call does nothing)', () => {
    freshCache();
    setupTestNotes();
    MetadataCache.init();
    var sizeAfterFirst = MetadataCache.index.size;
    MetadataCache.init();
    assert.equal(MetadataCache.index.size, sizeAfterFirst, 'size should not change');
});

test('init handles empty State.NOTES gracefully', () => {
    freshCache();
    State.NOTES = [];
    MetadataCache.init();
    assert.equal(MetadataCache.index.size, 0);
});


console.log('\n\u2500\u2500\u2500 MetadataCache.get() \u2500\u2500\u2500');

test('get returns null for non-existent note id', () => {
    freshCache();
    assert.equal(MetadataCache.get('no-such-id'), null);
});

test('returns null for null/undefined id', () => {
    freshCache();
    assert.equal(MetadataCache.get(null), null);
    assert.equal(MetadataCache.get(undefined), null);
});

test('returns metadata object for existing note', () => {
    freshCache();
    setupAndInit();
    var meta = MetadataCache.get('n1');
    assert.ok(meta, 'should return metadata');
    assert.equal(meta.title, 'Alpha');
    assert.equal(meta.path, '/');
});


console.log('\n\u2500\u2500\u2500 MetadataCache.getBacklinks() \u2500\u2500\u2500');

test('returns backlinks for a note that is referenced', () => {
    freshCache();
    setupAndInit();
    // Alpha links to [[Beta]], so Beta should have Alpha as a backlink
    var betaBacklinks = MetadataCache.getBacklinks('n2');
    assert.equal(betaBacklinks.length, 1, 'Beta should have 1 backlink');
    assert.equal(betaBacklinks[0].title, 'Alpha');
});

test('returns backlinks for note that is referenced by others', () => {
    freshCache();
    setupAndInit();
    // Gamma (n3) has no wiki links itself, but Beta (n2) links to [[Gamma]]
    // So Gamma should have Beta as a backlink
    var gammaBacklinks = MetadataCache.getBacklinks('n3');
    assert.equal(gammaBacklinks.length, 1, 'Gamma should have 1 backlink from Beta');
    assert.equal(gammaBacklinks[0].title, 'Beta', 'Beta should be the backlinker');
});

test('returns empty array for non-existent note id', () => {
    freshCache();
    setupAndInit();
    var backlinks = MetadataCache.getBacklinks('no-such-id');
    assert.deepEqual(backlinks, []);
});

test('backlinks are bidirectional: Alpha links to Beta, Beta links back to Alpha', () => {
    freshCache();
    setupAndInit();
    // Alpha has [[Beta]], Beta has [[Alpha]]
    var alphaBacklinks = MetadataCache.getBacklinks('n1');
    var betaBacklinks = MetadataCache.getBacklinks('n2');
    assert.ok(alphaBacklinks.some(function (m) { return m.title === 'Beta'; }), 'Alpha backlinks should include Beta');
    assert.ok(betaBacklinks.some(function (m) { return m.title === 'Alpha'; }), 'Beta backlinks should include Alpha');
});

test('backlinks update when a note removes its wiki links', () => {
    freshCache();
    setupAndInit();

    // Initially Alpha links to Beta
    assert.equal(MetadataCache.getBacklinks('n2').length, 1);

    // Remove link from Alpha's content
    State.NOTES[0].content = 'No links here anymore';
    MetadataCache.updateNote('n1');

    // Beta should no longer have Alpha as a backlink
    var betaBacklinks = MetadataCache.getBacklinks('n2');
    var alphaStillLinked = betaBacklinks.some(function (m) { return m.id === 'n1'; });
    assert.ok(!alphaStillLinked, 'Alpha should no longer be in Beta backlinks');
});


console.log('\n\u2500\u2500\u2500 MetadataCache.getByTag() \u2500\u2500\u2500');

test('returns notes with a specific tag', () => {
    freshCache();
    setupAndInit();
    var importantNotes = MetadataCache.getByTag('important');
    assert.equal(importantNotes.length, 1, 'should find 1 note with #important');
    assert.equal(importantNotes[0].title, 'Alpha');
});

test('returns notes matching archive tag', () => {
    freshCache();
    setupAndInit();
    var archiveNotes = MetadataCache.getByTag('archive');
    assert.equal(archiveNotes.length, 1);
    assert.equal(archiveNotes[0].title, 'Gamma');
});

test('returns empty array for non-existent tag', () => {
    freshCache();
    setupAndInit();
    var noTag = MetadataCache.getByTag('nonexistent');
    assert.deepEqual(noTag, []);
});

test('tag lookup is case-insensitive', () => {
    freshCache();
    setupAndInit();
    var upper = MetadataCache.getByTag('IMPORTANT');
    var lower = MetadataCache.getByTag('important');
    assert.equal(upper.length, lower.length);
});


console.log('\n\u2500\u2500\u2500 MetadataCache.getAllTags() \u2500\u2500\u2500');

test('returns all tags with correct counts', () => {
    freshCache();
    setupAndInit();
    var tags = MetadataCache.getAllTags();
    assert.equal(tags['important'], 1);
    assert.equal(tags['reference'], 1);
    assert.equal(tags['archive'], 1);
    assert.equal(tags['old'], 1);
    // Note: #hidden tag is on n4 which is trashed but still indexed by MetadataCache
    // MetadataCache does NOT filter by path - it indexes ALL notes
    assert.equal(tags['hidden'], 1);
});

test('returns empty object when no tags exist', () => {
    freshCache();
    assert.deepEqual(MetadataCache.getAllTags(), {});
});


console.log('\n\u2500\u2500\u2500 MetadataCache.search() \u2500\u2500\u2500');

test('returns sorted results for title match', () => {
    freshCache();
    setupAndInit();
    var results = MetadataCache.search('alpha');
    assert.ok(results.length >= 1, 'should find at least 1 result');
    assert.equal(results[0].title, 'Alpha', 'Alpha should be first (score=100)');
});

test('returns empty array for empty query', () => {
    freshCache();
    setupAndInit();
    assert.deepEqual(MetadataCache.search(''), []);
    assert.deepEqual(MetadataCache.search('   '), []);
});

test('returns empty array for null/undefined query', () => {
    freshCache();
    setupAndInit();
    assert.deepEqual(MetadataCache.search(null), []);
    assert.deepEqual(MetadataCache.search(undefined), []);
});

test('returns empty array for query with no matches', () => {
    freshCache();
    setupAndInit();
    assert.deepEqual(MetadataCache.search('zzzzz_nonexistent'), []);
});

test('finds notes by tag with search', () => {
    freshCache();
    setupAndInit();
    var results = MetadataCache.search('reference');
    assert.ok(results.length >= 1);
    assert.equal(results[0].title, 'Beta', 'Beta has #reference tag (score=50)');
});

test('search ranks title matches above tag matches', () => {
    freshCache();
    setupAndInit();
    // Both Alpha (title: Alpha) and Beta (has #reference) contain "a"
    var results = MetadataCache.search('alpha');
    assert.ok(results.length >= 1);
    assert.equal(results[0].title, 'Alpha', 'title match should rank highest');
});

test('search matches frontmatter properties', () => {
    freshCache();
    State.NOTES = [{
        id: 'fm1',
        title: 'Frontmatter Note',
        path: '/',
        content: '---\nstatus: published\n---\nBody text',
        created: 100,
        modified: 200
    }];
    MetadataCache.init();
    var results = MetadataCache.search('published');
    assert.ok(results.length >= 1, 'should find note with frontmatter matching "published"');
});

test('search is case-insensitive', () => {
    freshCache();
    setupAndInit();
    var upper = MetadataCache.search('ALPHA');
    var lower = MetadataCache.search('alpha');
    assert.equal(upper.length, lower.length);
    assert.equal(upper[0].id, lower[0].id);
});


console.log('\n\u2500\u2500\u2500 MetadataCache.query() \u2500\u2500\u2500');

test('returns notes matching frontmatter property', () => {
    freshCache();
    State.NOTES = [{
        id: 'q1',
        title: 'Published Note',
        path: '/',
        content: '---\nstatus: published\n---\nBody',
        created: 100,
        modified: 200
    }, {
        id: 'q2',
        title: 'Draft Note',
        path: '/',
        content: '---\nstatus: draft\n---\nBody',
        created: 101,
        modified: 201
    }];
    MetadataCache.init();
    var published = MetadataCache.query('status', 'published');
    assert.equal(published.length, 1);
    assert.equal(published[0].title, 'Published Note');
});

test('returns empty array when no notes match property', () => {
    freshCache();
    setupAndInit(); // no notes have 'status' frontmatter
    var results = MetadataCache.query('status', 'published');
    assert.deepEqual(results, []);
});

test('query handles non-existent property key', () => {
    freshCache();
    setupAndInit();
    var results = MetadataCache.query('nonexistent_property', 'any_value');
    assert.deepEqual(results, []);
});


console.log('\n\u2500\u2500\u2500 MetadataCache.getStats() \u2500\u2500\u2500');

test('returns correct stats after init', () => {
    freshCache();
    setupAndInit();
    var stats = MetadataCache.getStats();
    assert.equal(stats.totalNotes, 5, 'should have 5 notes');
    assert.equal(stats.totalTags, 5, 'should have 5 unique tags');
    // Alpha->Beta, Beta->Alpha, Beta->Gamma = 3 link entries
    assert.equal(stats.totalLinks >= 3, true, 'should have at least 3 link references');
    // Beta backlinks: Alpha, Gamma backlinks: none, Alpha backlinks: Beta = at least 1
    assert.equal(stats.totalBacklinks >= 1, true, 'should have at least 1 backlink');
});

test('returns zero stats for empty cache', () => {
    freshCache();
    var stats = MetadataCache.getStats();
    assert.equal(stats.totalNotes, 0);
    assert.equal(stats.totalTags, 0);
    assert.equal(stats.totalLinks, 0);
    assert.equal(stats.totalBacklinks, 0);
});


console.log('\n\u2500\u2500\u2500 MetadataCache.saveCache() / loadCache() \u2500\u2500\u2500');

test('saveCache persists to localStorage', () => {
    freshCache();
    setupAndInit();
    // init() calls updateNote with shouldSave=false, so saveCache() isn't called automatically
    MetadataCache.saveCache();
    var savedRaw = localStorageShim.getItem('VINLAND_METADATA_CACHE');
    assert.ok(savedRaw, 'should have saved to localStorage');
    var parsed = JSON.parse(savedRaw);
    assert.ok(parsed.tagIndex, 'should have tagIndex');
    assert.ok(parsed.linkIndex, 'should have linkIndex');
    assert.ok(parsed.backlinks, 'should have backlinks');
    assert.ok(parsed.index, 'v2 should persist the main index');
    assert.ok(parsed.fingerprint, 'v2 should persist the vault fingerprint');
    assert.equal(parsed.version, 2);
});

test('loadCache reconstructs Maps from localStorage', () => {
    freshCache();
    setupAndInit();
    // Persist first, then reset
    MetadataCache.saveCache();
    MetadataCache.index = new Map();
    MetadataCache.tagIndex = new Map();
    MetadataCache.linkIndex = new Map();
    MetadataCache.backlinks = new Map();
    MetadataCache.initialized = false;

    var loaded = MetadataCache.loadCache();
    assert.ok(loaded, 'loadCache should return true');
    assert.ok(MetadataCache.tagIndex.size > 0, 'should have restored tag index');
    assert.ok(MetadataCache.linkIndex.size > 0, 'should have restored link index');
});

test('loadCache returns false when no cached data exists', () => {
    freshCache();
    var loaded = MetadataCache.loadCache();
    assert.equal(loaded, false);
});

test('loadCache handles corrupted data gracefully', () => {
    freshCache();
    localStorageShim.setItem('VINLAND_METADATA_CACHE', 'not valid json{{{');
    var loaded = MetadataCache.loadCache();
    assert.equal(loaded, false, 'should handle parse error gracefully');
});

test('loadCache rejects a cache whose fingerprint does not match the vault (staleness guard)', () => {
    freshCache();
    setupAndInit();
    MetadataCache.saveCache();
    // Mutate the vault WITHOUT going through updateNote (e.g. import/restore
    // path) — the fingerprint must catch it and force a rebuild.
    State.NOTES[0].content = 'changed without updateNote';
    State.NOTES[0].modified = 999999;
    MetadataCache.initialized = false;
    var loaded = MetadataCache.loadCache();
    assert.equal(loaded, false, 'stale cache must be rejected');
});

test('init loads from a fresh persisted cache instead of rebuilding', () => {
    freshCache();
    setupTestNotes();
    MetadataCache.init(); // full rebuild + persist
    assert.equal(MetadataCache.index.size, 5);
    // Simulate a new boot: reset maps + initialized, keep localStorage cache
    MetadataCache.index = new Map();
    MetadataCache.tagIndex = new Map();
    MetadataCache.linkIndex = new Map();
    MetadataCache.backlinks = new Map();
    MetadataCache.initialized = false;
    MetadataCache.init();
    assert.ok(MetadataCache.initialized, 'init should have initialized');
    assert.equal(MetadataCache.index.size, 5, 'index should be restored from cache, not rebuilt');
    assert.ok(MetadataCache.get('n1'), 'n1 restored from cache');
    assert.ok(MetadataCache.get('n2'), 'n2 restored from cache');
});

test('init rebuilds when the persisted cache is stale (vault changed between sessions)', () => {
    freshCache();
    setupTestNotes();
    MetadataCache.init(); // persist with fingerprint of 5 notes
    // Vault changes on disk between sessions (new note, no cache write)
    State.NOTES.push({ id: 'n6', title: 'New', path: '/', content: '#newtag', created: 3000, modified: 3001 });
    MetadataCache.initialized = false;
    MetadataCache.init();
    assert.equal(MetadataCache.index.size, 6, 'should rebuild to include n6');
    assert.ok(MetadataCache.get('n6'), 'n6 indexed after rebuild');
});


console.log('\n\u2500\u2500\u2500 MetadataCache.removeNote() \u2500\u2500\u2500');

test('removes note from all indexes', () => {
    freshCache();
    setupAndInit();
    assert.ok(MetadataCache.get('n1'), 'note should exist before removal');
    MetadataCache.removeNote('n1');
    assert.equal(MetadataCache.get('n1'), null, 'note should be null after removal');
    assert.equal(MetadataCache.index.size, 4, 'index should shrink');
});

test('removeNote handles non-existent note gracefully', () => {
    freshCache();
    // Should not throw
    MetadataCache.removeNote('no-such-id');
});

test('removeNote cleans up tag index', () => {
    freshCache();
    setupAndInit();
    assert.ok(MetadataCache.tagIndex.has('important'), 'tag should exist before removal');
    MetadataCache.removeNote('n1');
    assert.ok(!MetadataCache.tagIndex.has('important'), 'tag should be cleaned up if no other notes use it');
});

test('removeNote cleans up link index', () => {
    freshCache();
    setupAndInit();
    // n1 links to [[beta]]. After n1 removal, the linkIndex for 'beta' should be gone
    // because only n1 linked to it directly (n2 links to [[alpha]] and [[gamma]])
    assert.ok(MetadataCache.linkIndex.has('beta'), 'link index should have beta before removal');
    MetadataCache.removeNote('n1');
    // After removing n1, beta might still be in linkIndex if other notes link there
    // Actually, n2 links to [[Alpha]] and [[Gamma]], not [[Beta]]. So beta should be cleared.
    assert.ok(!MetadataCache.linkIndex.has('beta'), 'link index should clean up orphaned entries');
});

test('getLinkingNotes returns notes that link to a specific title', () => {
    freshCache();
    setupAndInit();
    // Notes linking to "alpha" (case-insensitive)
    var linkingToAlpha = MetadataCache.getLinkingNotes('Alpha');
    assert.equal(linkingToAlpha.length, 1, 'only Beta links to Alpha');
    assert.equal(linkingToAlpha[0].title, 'Beta');
});

test('getLinkingNotes returns empty array for title with no links', () => {
    freshCache();
    setupAndInit();
    var linkingToNonexistent = MetadataCache.getLinkingNotes('NoSuchPage');
    assert.deepEqual(linkingToNonexistent, []);
});

test('getLinkingNotes is case-insensitive', () => {
    freshCache();
    setupAndInit();
    var upper = MetadataCache.getLinkingNotes('ALPHA');
    var lower = MetadataCache.getLinkingNotes('alpha');
    assert.equal(upper.length, lower.length);
});

test('removeNote cleans stale backlinks from other notes sets', () => {
    freshCache();
    setupAndInit();
    // After init:
    //   backlinks.get('n2') = Set{'n1'}  (Alpha links to Beta)
    //   backlinks.get('n1') = Set{'n2'} (Beta links to Alpha)
    //   backlinks.get('n3') = Set{'n2'} (Beta links to Gamma)

    // Verify the initial state: Alpha's backlinks set contains Beta's ID
    var alphaBacklinksSet = MetadataCache.backlinks.get('n1');
    assert.ok(alphaBacklinksSet, 'Alpha should have a backlinks entry');
    assert.ok(alphaBacklinksSet.has('n2'), 'Alpha backlinks should include Beta (n2)');

    // Delete Beta (n2)
    MetadataCache.removeNote('n2');

    // After removal: backlinks entries that only contained n2 are now completely
    // deleted (set became empty -> entry removed). The key assertions:
    //   1. No backlink set ANYWHERE contains 'n2' as a stale reference
    //   2. Beta's own backlinks entry should be gone

    // 1. Scan ALL backlinks sets to ensure no stale 'n2' reference exists
    var staleFound = false;
    MetadataCache.backlinks.forEach(function(noteSet) {
        if (noteSet.has('n2')) {
            staleFound = true;
        }
    });
    assert.ok(!staleFound, 'no backlink set should contain stale Beta (n2) reference');

    // 2. Beta's own backlinks entry should be fully deleted
    assert.ok(!MetadataCache.backlinks.has('n2'), 'Beta backlinks entry should be fully deleted');
});

test('removeNote does not corrupt backlinks for unaffected notes', () => {
    freshCache();
    setupAndInit();
    // Delete a note that is not referenced by any other (e.g., n5 - Empty Note with no content)
    MetadataCache.removeNote('n5');

    // All other backlinks should remain intact
    var alphaSet = MetadataCache.backlinks.get('n1');
    assert.ok(alphaSet, 'Alpha backlinks should still exist');
    assert.ok(alphaSet.has('n2'), 'Alpha backlinks should still include Beta (n2)');

    var betaSet = MetadataCache.backlinks.get('n2');
    assert.ok(betaSet, 'Beta backlinks should still exist');
    assert.ok(betaSet.has('n1'), 'Beta backlinks should still include Alpha (n1)');
});


// ============================================================
// SUMMARY
// ============================================================

console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  METADATA CACHE SUITE: ' + passed + ' passed, ' + failed + ' failed');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

if (errors.length > 0) {
    console.log('FAILURES:');
    errors.forEach(function (e) {
        console.log('  \u2022 ' + e.name + ': ' + e.error);
    });
    console.log('');
}

process.exit(failed > 0 ? 1 : 0);
