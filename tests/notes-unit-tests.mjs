

import assert from 'node:assert/strict';

// ============================================================
// FUNCTION EXTRACTS (copied from source to test in isolation)
// ============================================================

// From notescontroller.js:66-108
function getPlainTextPreview(text) {
    if (!text) return '';
    var t = text;
    t = t.replace(/```[\w]*\n[\s\S]*?```/g, '');
    t = t.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
    t = t.replace(/%%KANBAN:[^%]+%%/g, '');
    t = t.replace(/\[\[KANBAN:[^\]]+\]\]/g, '');
    t = t.replace(/^---$/gm, '');
    t = t.replace(/^#{1,6}\s+/gm, '');
    t = t.replace(/^>\s?/gm, '');
    t = t.replace(/^\s*- \[[ x]\]\s*/gm, '');
    t = t.replace(/^\s*[-*]\s+/gm, '');
    t = t.replace(/^\s*\d+\.\s+/gm, '');
    t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    t = t.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2');
    t = t.replace(/\[\[([^\]]+)\]\]/g, '$1');
    t = t.replace(/\*\*(.+?)\*\*/g, '$1');
    t = t.replace(/\*(.+?)\*/g, '$1');
    t = t.replace(/<\/?u>/g, '');
    t = t.replace(/`([^`]+)`/g, '$1');
    t = t.replace(/%%align:(left|center|right)%%/g, '');
    t = t.replace(/^\|.*\|$/gm, '');
    t = t.replace(/\n{2,}/g, ' · ');
    t = t.replace(/\n/g, ' ');
    t = t.replace(/\s{2,}/g, ' ');
    return t.trim().substring(0, 150);
}

// From notescontroller.js:1635-1641 (FIXED version)
function extractTags(content) {
    if (!content) return [];
    var cleaned = content.replace(/```[\w]*\n[\s\S]*?```/g, '');
    cleaned = cleaned.replace(/`[^`]+`/g, '');
    var matches = cleaned.match(/#[\w]+/g);
    return matches ? [...new Set(matches)] : [];
}

// From PageManager.js:129-132
function sanitizePath(path) {
    if (!path) return '/';
    return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

// From PageManager.js:13-127 (simplified for testing)
function parseContentToBlocks(content) {
    if (!content) return [];
    var lines = content.split('\n');
    var blocks = [];
    var order = 0;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var block = { id: 'blk_test_' + order, order: order };
        var workingLine = line;

        var indentMatch = workingLine.match(/^(\s+)/);
        if (indentMatch) {
            block.level = Math.floor(indentMatch[1].length / 2);
            workingLine = workingLine.substring(indentMatch[1].length);
        } else {
            block.level = 0;
        }

        var alignMatch = workingLine.match(/\s?%%align:(left|center|right)%%$/);
        if (alignMatch) {
            block.align = alignMatch[1];
            workingLine = workingLine.substring(0, workingLine.length - alignMatch[0].length);
        }

        if (workingLine.startsWith('# ')) {
            block.type = 'h1';
            block.content = workingLine.substring(2);
        } else if (workingLine.startsWith('## ')) {
            block.type = 'h2';
            block.content = workingLine.substring(3);
        } else if (workingLine.startsWith('### ')) {
            block.type = 'h3';
            block.content = workingLine.substring(4);
        } else if (workingLine.match(/^- \[( |x)\] /)) {
            block.type = 'task';
            block.checked = workingLine.includes('[x]');
            block.content = workingLine.replace(/^- \[( |x)\] /, '');
        } else if (workingLine.startsWith('- ') || workingLine.startsWith('* ')) {
            block.type = 'bullet';
            block.content = workingLine.substring(2);
        } else if (workingLine.match(/^1\.\s/)) {
            block.type = 'numbered';
            block.content = workingLine.substring(3);
        } else if (workingLine.startsWith('```')) {
            block.type = 'code';
            block.language = workingLine.substring(3).trim() || 'plain';
            var codeContent = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('```')) {
                codeContent.push(lines[i]);
                i++;
            }
            block.content = codeContent.join('\n');
        } else if (workingLine === '---') {
            block.type = 'divider';
            block.content = '';
        } else if (workingLine.startsWith('> ')) {
            block.type = 'quote';
            block.content = workingLine.substring(2);
        } else {
            block.type = 'p';
            block.content = workingLine;
        }

        blocks.push(block);
        order++;
    }
    return blocks;
}

// From Sidebar.js:16-59
function buildDirectoryStructure(notes) {
    var root = { __files__: [], __path__: '/' };

    notes.forEach(function (note) {
        var path = note.path || '/';
        if (path.indexOf('/.trash') === 0) return;

        var parts = path.split('/').filter(function (p) { return p.length > 0; });
        var current = root;
        var currentPath = '';

        parts.forEach(function (part) {
            currentPath += '/' + part;
            if (!current[part]) {
                current[part] = { __files__: [], __path__: currentPath };
            }
            current = current[part];
        });

        current.__files__.push(note);
    });

    return root;
}

// From Sidebar.js:66-100
function filterTreeStructure(structure, query) {
    var newStructure = { __files__: [], __path__: structure.__path__ };
    var hasMatch = false;

    var pathParts = structure.__path__.split('/').filter(Boolean);
    var folderName = pathParts[pathParts.length - 1] || '';
    var folderNameMatch = folderName.toLowerCase().indexOf(query) !== -1;

    newStructure.__files__ = structure.__files__.filter(function (note) {
        var matchTitle = (note.title && note.title.toLowerCase().indexOf(query) !== -1);
        var matchContent = (note.content && note.content.toLowerCase().indexOf(query) !== -1);
        var match = matchTitle || matchContent || folderNameMatch;
        if (match) hasMatch = true;
        return match;
    });

    Object.keys(structure).forEach(function (key) {
        if (key === '__files__' || key === '__path__') return;
        var childResult = filterTreeStructure(structure[key], query);
        if (childResult) {
            newStructure[key] = childResult;
            hasMatch = true;
        }
    });

    return hasMatch ? newStructure : null;
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

// ============================================================
// TESTS
// ============================================================

console.log('\n─── getPlainTextPreview() ───');

test('returns empty string for null/undefined', () => {
    assert.equal(getPlainTextPreview(null), '');
    assert.equal(getPlainTextPreview(undefined), '');
    assert.equal(getPlainTextPreview(''), '');
});

test('strips markdown headers', () => {
    assert.equal(getPlainTextPreview('# Hello'), 'Hello');
    assert.equal(getPlainTextPreview('## World'), 'World');
    assert.equal(getPlainTextPreview('### Deep'), 'Deep');
});

test('strips bold and italic markers', () => {
    assert.equal(getPlainTextPreview('**bold** and *italic*'), 'bold and italic');
});

test('strips inline code backticks', () => {
    assert.equal(getPlainTextPreview('use `console.log`'), 'use console.log');
});

test('strips fenced code blocks entirely', () => {
    var input = 'before\n```js\nconsole.log("hi")\n```\nafter';
    assert.equal(getPlainTextPreview(input), 'before · after');
});

test('strips images', () => {
    assert.equal(getPlainTextPreview('![alt](http://img.png)'), '');
});

test('strips task markers but keeps text', () => {
    assert.equal(getPlainTextPreview('- [ ] buy milk'), 'buy milk');
    assert.equal(getPlainTextPreview('- [x] done'), 'done');
});

test('strips bullet markers but keeps text', () => {
    assert.equal(getPlainTextPreview('- item one'), 'item one');
    assert.equal(getPlainTextPreview('* item two'), 'item two');
});

test('strips numbered list markers but keeps text', () => {
    assert.equal(getPlainTextPreview('1. first'), 'first');
});

test('strips wiki links and keeps label', () => {
    assert.equal(getPlainTextPreview('see [[My Note]]'), 'see My Note');
    assert.equal(getPlainTextPreview('see [[My Note|label]]'), 'see label');
});

test('strips standard links and keeps text', () => {
    assert.equal(getPlainTextPreview('[click](http://url)'), 'click');
});

test('strips blockquote markers', () => {
    assert.equal(getPlainTextPreview('> quoted text'), 'quoted text');
});

test('strips kanban markers', () => {
    assert.equal(getPlainTextPreview('%%KANBAN:id:blk:title:3:5%%'), '');
    assert.equal(getPlainTextPreview('[[KANBAN:board123]]'), '');
});

test('strips dividers', () => {
    assert.equal(getPlainTextPreview('---'), '');
});

test('strips alignment markers', () => {
    assert.equal(getPlainTextPreview('centered text %%align:center%%'), 'centered text');
});

test('strips table rows', () => {
    assert.equal(getPlainTextPreview('| A | B |'), '');
});

test('truncates to 150 characters', () => {
    var long = 'a'.repeat(200);
    assert.equal(getPlainTextPreview(long).length, 150);
});

test('collapses multiple newlines with separator', () => {
    assert.equal(getPlainTextPreview('line1\n\nline2'), 'line1 · line2');
});

test('strips underline tags', () => {
    assert.equal(getPlainTextPreview('<u>underlined</u>'), 'underlined');
});


console.log('\n─── extractTags() ───');

test('returns empty array for null/empty', () => {
    assert.deepEqual(extractTags(null), []);
    assert.deepEqual(extractTags(''), []);
});

test('extracts single tag', () => {
    assert.deepEqual(extractTags('hello #world'), ['#world']);
});

test('extracts multiple tags', () => {
    var tags = extractTags('#urgent task #important');
    assert.ok(tags.includes('#urgent'));
    assert.ok(tags.includes('#important'));
});

test('deduplicates tags', () => {
    assert.deepEqual(extractTags('#tag #tag #tag'), ['#tag']);
});

test('BUG FIX: does NOT extract tags from fenced code blocks', () => {
    var content = 'real #tag here\n```c\n#include <stdio.h>\n#define MAX 100\n```\nmore text';
    var tags = extractTags(content);
    assert.ok(tags.includes('#tag'), 'Should find #tag outside code');
    assert.ok(!tags.includes('#include'), 'Should NOT find #include inside code fence');
    assert.ok(!tags.includes('#define'), 'Should NOT find #define inside code fence');
});

test('BUG FIX: does NOT extract tags from inline code', () => {
    var content = 'use `#selector` for CSS';
    var tags = extractTags(content);
    assert.ok(!tags.includes('#selector'), 'Should NOT find #selector inside inline code');
});

test('extracts tags with underscores and numbers', () => {
    assert.deepEqual(extractTags('#my_tag_2'), ['#my_tag_2']);
});


console.log('\n─── sanitizePath() ───');

test('returns / for null/empty', () => {
    assert.equal(sanitizePath(null), '/');
    assert.equal(sanitizePath(''), '/');
    assert.equal(sanitizePath(undefined), '/');
});

test('collapses multiple slashes', () => {
    assert.equal(sanitizePath('//a///b'), '/a/b');
});

test('strips trailing slash', () => {
    assert.equal(sanitizePath('/folder/'), '/folder');
});

test('preserves root path', () => {
    assert.equal(sanitizePath('/'), '/');
});

test('handles normal path', () => {
    assert.equal(sanitizePath('/projects/notes'), '/projects/notes');
});

test('EDGE: path with only slashes', () => {
    assert.equal(sanitizePath('///'), '/');
});


console.log('\n─── parseContentToBlocks() ───');

test('returns empty array for null/empty', () => {
    assert.deepEqual(parseContentToBlocks(null), []);
    assert.deepEqual(parseContentToBlocks(''), []);
});

test('parses plain text as paragraph', () => {
    var blocks = parseContentToBlocks('hello world');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'p');
    assert.equal(blocks[0].content, 'hello world');
});

test('parses headers (h1, h2, h3)', () => {
    var blocks = parseContentToBlocks('# Title\n## Subtitle\n### Section');
    assert.equal(blocks[0].type, 'h1');
    assert.equal(blocks[0].content, 'Title');
    assert.equal(blocks[1].type, 'h2');
    assert.equal(blocks[1].content, 'Subtitle');
    assert.equal(blocks[2].type, 'h3');
    assert.equal(blocks[2].content, 'Section');
});

test('parses unchecked task', () => {
    var blocks = parseContentToBlocks('- [ ] buy milk');
    assert.equal(blocks[0].type, 'task');
    assert.equal(blocks[0].checked, false);
    assert.equal(blocks[0].content, 'buy milk');
});

test('parses checked task', () => {
    var blocks = parseContentToBlocks('- [x] done');
    assert.equal(blocks[0].type, 'task');
    assert.equal(blocks[0].checked, true);
    assert.equal(blocks[0].content, 'done');
});

test('parses bullet list', () => {
    var blocks = parseContentToBlocks('- item one\n* item two');
    assert.equal(blocks[0].type, 'bullet');
    assert.equal(blocks[0].content, 'item one');
    assert.equal(blocks[1].type, 'bullet');
    assert.equal(blocks[1].content, 'item two');
});

test('parses numbered list', () => {
    var blocks = parseContentToBlocks('1. first');
    assert.equal(blocks[0].type, 'numbered');
    assert.equal(blocks[0].content, 'first');
});

test('parses fenced code block', () => {
    var blocks = parseContentToBlocks('```js\nconsole.log("hi")\n```');
    assert.equal(blocks[0].type, 'code');
    assert.equal(blocks[0].language, 'js');
    assert.equal(blocks[0].content, 'console.log("hi")');
});

test('parses code block without language', () => {
    var blocks = parseContentToBlocks('```\nplain text\n```');
    assert.equal(blocks[0].type, 'code');
    assert.equal(blocks[0].language, 'plain');
});

test('parses divider', () => {
    var blocks = parseContentToBlocks('---');
    assert.equal(blocks[0].type, 'divider');
});

test('parses indented content with correct level', () => {
    var blocks = parseContentToBlocks('  - nested item');
    assert.equal(blocks[0].level, 1);
    assert.equal(blocks[0].type, 'bullet');
});

test('parses alignment markers', () => {
    var blocks = parseContentToBlocks('centered %%align:center%%');
    assert.equal(blocks[0].align, 'center');
    assert.equal(blocks[0].content, 'centered');
});

test('parses multi-line code block preserving newlines', () => {
    var blocks = parseContentToBlocks('```python\ndef foo():\n    return 42\n```');
    assert.equal(blocks[0].type, 'code');
    assert.equal(blocks[0].language, 'python');
    assert.ok(blocks[0].content.includes('def foo():'));
    assert.ok(blocks[0].content.includes('return 42'));
});


console.log('\n─── buildDirectoryStructure() ───');

test('returns root with files for root-level notes', () => {
    var notes = [
        { id: '1', title: 'A', path: '/' },
        { id: '2', title: 'B', path: '/' }
    ];
    var tree = buildDirectoryStructure(notes);
    assert.equal(tree.__files__.length, 2);
});

test('nests notes into correct folders', () => {
    var notes = [
        { id: '1', title: 'A', path: '/projects' },
        { id: '2', title: 'B', path: '/projects/web' }
    ];
    var tree = buildDirectoryStructure(notes);
    assert.ok(tree.projects, 'should have projects folder');
    assert.equal(tree.projects.__files__.length, 1);
    assert.ok(tree.projects.web, 'should have web subfolder');
    assert.equal(tree.projects.web.__files__.length, 1);
});

test('excludes trashed notes from tree', () => {
    var notes = [
        { id: '1', title: 'Active', path: '/' },
        { id: '2', title: 'Trashed', path: '/.trash' }
    ];
    var tree = buildDirectoryStructure(notes);
    assert.equal(tree.__files__.length, 1);
    assert.equal(tree.__files__[0].title, 'Active');
    assert.ok(!tree['.trash'], 'should not have .trash folder');
});

test('handles notes with no path (defaults to root)', () => {
    var notes = [{ id: '1', title: 'No Path' }];
    var tree = buildDirectoryStructure(notes);
    assert.equal(tree.__files__.length, 1);
});

test('creates deep nested structure', () => {
    var notes = [{ id: '1', title: 'Deep', path: '/a/b/c' }];
    var tree = buildDirectoryStructure(notes);
    assert.ok(tree.a);
    assert.ok(tree.a.b);
    assert.ok(tree.a.b.c);
    assert.equal(tree.a.b.c.__files__.length, 1);
});


console.log('\n─── filterTreeStructure() ───');

test('returns null when no matches', () => {
    var tree = buildDirectoryStructure([{ id: '1', title: 'Hello', path: '/', content: '' }]);
    var result = filterTreeStructure(tree, 'zzzzz');
    assert.equal(result, null);
});

test('filters by title match', () => {
    var tree = buildDirectoryStructure([
        { id: '1', title: 'Meeting Notes', path: '/', content: '' },
        { id: '2', title: 'Shopping List', path: '/', content: '' }
    ]);
    var result = filterTreeStructure(tree, 'meeting');
    assert.ok(result);
    assert.equal(result.__files__.length, 1);
    assert.equal(result.__files__[0].title, 'Meeting Notes');
});

test('filters by content match', () => {
    var tree = buildDirectoryStructure([
        { id: '1', title: 'Note', path: '/', content: 'search for this keyword' }
    ]);
    var result = filterTreeStructure(tree, 'keyword');
    assert.ok(result);
    assert.equal(result.__files__.length, 1);
});

test('preserves parent folders when child matches', () => {
    var tree = buildDirectoryStructure([
        { id: '1', title: 'Deep Note', path: '/projects/web' }
    ]);
    var result = filterTreeStructure(tree, 'deep');
    assert.ok(result);
    assert.ok(result.projects);
    assert.ok(result.projects.web);
});


console.log('\n─── Trash & Restore Path Preservation ───');

test('trashing a note stores its original path in note.originalPath', () => {
    var note = { id: '1', title: 'Test Note', path: '/projects/web' };
    
    // Simulate trashNote logic
    note.originalPath = note.path || '/';
    note.path = '/.trash';
    
    assert.equal(note.path, '/.trash');
    assert.equal(note.originalPath, '/projects/web');
});

test('restoring a note recovers the original path and deletes originalPath property', () => {
    var note = { id: '1', title: 'Test Note', path: '/.trash', originalPath: '/projects/web' };
    
    // Simulate restore note logic
    note.path = note.originalPath || '/';
    delete note.originalPath;
    
    assert.equal(note.path, '/projects/web');
    assert.equal(note.originalPath, undefined);
});

test('restoring a note with no originalPath defaults to root "/"', () => {
    var note = { id: '1', title: 'Test Note', path: '/.trash' };
    
    // Simulate restore note logic
    note.path = note.originalPath || '/';
    delete note.originalPath;
    
    assert.equal(note.path, '/');
});

test('Quick Notes list filter excludes trashed notes', () => {
    var notes = [
        { id: '1', title: 'Active Note', path: '/' },
        { id: '2', title: 'Trashed Note', path: '/.trash' }
    ];
    var activeNotes = notes.filter(function(n) {
        return !n.path || n.path.indexOf('/.trash') !== 0;
    });
    assert.equal(activeNotes.length, 1);
    assert.equal(activeNotes[0].title, 'Active Note');
});

test('Task Aggregator excludes tasks from trashed notes', () => {
    var notes = [
        { id: '1', path: '/', blocks: [{ type: 'task', content: 'Active Task' }] },
        { id: '2', path: '/.trash', blocks: [{ type: 'task', content: 'Trashed Task' }] }
    ];
    
    var tasks = [];
    notes.forEach(function (note) {
        if (note.path && note.path.indexOf('/.trash') === 0) return;
        if (!note.blocks) return;
        note.blocks.forEach(function (block) {
            if (block.type === 'task') {
                tasks.push(block.content);
            }
        });
    });
    
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0], 'Active Task');
});

test('Tag collection excludes tags from trashed notes', () => {
    var notes = [
        { id: '1', path: '/', content: 'hello #active' },
        { id: '2', path: '/.trash', content: 'hello #trashed' }
    ];
    
    var collectedTags = [];
    notes.forEach(function (note) {
        if (note.path && note.path.indexOf('/.trash') === 0) return;
        var tags = extractTags(note.content);
        tags.forEach(t => collectedTags.push(t));
    });
    
    assert.equal(collectedTags.length, 1);
    assert.equal(collectedTags[0], '#active');
});


// ============================================================
// SUMMARY
// ============================================================

console.log('\n═══════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════\n');

if (errors.length > 0) {
    console.log('FAILURES:');
    errors.forEach(e => console.log(`  • ${e.name}: ${e.error}`));
    console.log('');
}

process.exit(failed > 0 ? 1 : 0);
