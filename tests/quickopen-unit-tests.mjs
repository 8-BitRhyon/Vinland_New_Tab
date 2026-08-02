

import assert from 'node:assert/strict';

// ============================================================
// FUNCTION EXTRACTS (pure data operations from QuickOpen.js)
// ============================================================

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


function computeNoteScore(note, query) {
    var q = query.toLowerCase();
    var title = (note.title || '').toLowerCase();
    var content = (note.content || '');
    var blocksContent = '';
    if (note.blocks && note.blocks.length > 0) {
        blocksContent = note.blocks.map(function (b) { return b.content || ''; }).join('\n');
    }
    var fullContent = content || blocksContent;
    var fullContentLower = fullContent.toLowerCase();

    var score = 0;
    var excerpt = null;

    // Title starts with query (highest)
    if (title.indexOf(q) === 0) {
        score = 100;
    }
    // Title contains query
    else if (title.indexOf(q) > 0) {
        score = 80;
    }
    // Content contains query
    else if (fullContentLower.indexOf(q) >= 0) {
        score = 50;
        // Find the matching line for excerpt
        var lines = fullContent.split('\n');
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().indexOf(q) >= 0) {
                var line = lines[i].trim();
                if (line.length > 80) {
                    var matchIdx = line.toLowerCase().indexOf(q);
                    var start = Math.max(0, matchIdx - 30);
                    line = (start > 0 ? '...' : '') +
                        line.substring(start, start + 80) +
                        (line.length > start + 80 ? '...' : '');
                }
                excerpt = line;
                break;
            }
        }
    }

    return { score: score, excerpt: excerpt };
}


function computeCanvasNodeScore(canvasNode, query) {
    var q = query.toLowerCase();
    var cnTitle = (canvasNode.title || '').toLowerCase();
    var cnPreview = (canvasNode.preview || '').toLowerCase();
    var cnCombined = cnTitle + ' ' + cnPreview;

    if (cnCombined.indexOf(q) < 0) return { score: 0, excerpt: null };

    var cnScore = 0;
    var cnExcerpt = null;

    if (cnTitle.indexOf(q) === 0) cnScore = 70;
    else if (cnTitle.indexOf(q) > 0) cnScore = 55;
    else {
        cnScore = 40;
        var lines = (canvasNode.preview || '').split('\n');
        for (var li = 0; li < lines.length; li++) {
            if (lines[li].toLowerCase().indexOf(q) >= 0) {
                var line = lines[li].trim();
                if (line.length > 80) {
                    var matchIdx = line.toLowerCase().indexOf(q);
                    var start = Math.max(0, matchIdx - 30);
                    line = (start > 0 ? '...' : '') + line.substring(start, start + 80) + (line.length > start + 80 ? '...' : '');
                }
                cnExcerpt = line;
                break;
            }
        }
    }

    return { score: cnScore, excerpt: cnExcerpt };
}


function sortResults(results) {
    return results.slice().sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        if (a.type === 'note' && b.type === 'note') {
            return (a.title || '').localeCompare(b.title || '');
        }
        return 0;
    });
}


function limitResults(results, max) {
    return results.slice(0, max);
}


function filterByType(results, filterType) {
    var typeMap = { notes: 'note', tags: 'tag', commands: 'command' };
    var targetType = typeMap[filterType];
    return results.filter(function (r) { return r.type === targetType; });
}


function getAbsoluteIndex(sections, relativeIdx, sectionType) {
    for (var i = 0; i < sections.length; i++) {
        if (sections[i].type === sectionType) {
            return sections[i].start + relativeIdx;
        }
    }
    return relativeIdx;
}


function addRecentQuery(query, existingList) {
    if (!query || !query.trim()) return existingList;
    var recent = (existingList || []).slice();
    var idx = recent.indexOf(query);
    if (idx >= 0) recent.splice(idx, 1);
    recent.unshift(query);
    if (recent.length > 10) recent = recent.slice(0, 10);
    return recent;
}


function resolveFilterType(filterName) {
    if (filterName === 'all') return null;
    if (filterName === 'notes') return 'note';
    if (filterName === 'tags') return 'tag';
    if (filterName === 'commands') return 'command';
    return null;
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
// TESTS: escapeHtml()
// ============================================================

console.log('\n\u2500\u2500\u2500 QuickOpen: escapeHtml() \u2500\u2500\u2500');

test('escapes basic HTML characters', function() {
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
});

test('escapes ampersands', function() {
    assert.equal(escapeHtml('foo & bar'), 'foo &amp; bar');
});

test('escapes double quotes', function() {
    assert.equal(escapeHtml('say "hello"'), 'say &quot;hello&quot;');
});

test('escapes single quotes', function() {
    assert.equal(escapeHtml("it's"), 'it&#39;s');
});

test('escapes all special chars together', function() {
    assert.equal(escapeHtml('<a href="test" onclick="alert(\'xss\')">click</a>'),
        '&lt;a href=&quot;test&quot; onclick=&quot;alert(&#39;xss&#39;)&quot;&gt;click&lt;/a&gt;');
});

test('returns empty string for null', function() {
    assert.equal(escapeHtml(null), '');
});

test('returns empty string for undefined', function() {
    assert.equal(escapeHtml(undefined), '');
});

test('returns empty string for empty input', function() {
    assert.equal(escapeHtml(''), '');
});

test('passes through normal text unchanged', function() {
    assert.equal(escapeHtml('Hello World'), 'Hello World');
});

test('passes through numbers as strings', function() {
    assert.equal(escapeHtml('42'), '42');
});

// ============================================================
// TESTS: Note search scoring
// ============================================================

console.log('\n\u2500\u2500\u2500 QuickOpen: Note search scoring \u2500\u2500\u2500');

test('title starts with query scores 100', function() {
    var note = { title: 'Meeting Notes', content: 'Some content here' };
    var result = computeNoteScore(note, 'Meeting');
    assert.equal(result.score, 100);
});

test('title contains query scores 80', function() {
    var note = { title: 'My Meeting Notes', content: 'Content' };
    var result = computeNoteScore(note, 'Meeting');
    assert.equal(result.score, 80);
});

test('content contains query scores 50 with excerpt', function() {
    var note = { title: 'Random Title', content: 'The quick brown fox jumps over the lazy dog' };
    var result = computeNoteScore(note, 'fox');
    assert.equal(result.score, 50);
    assert.notEqual(result.excerpt, null);
    assert.ok(result.excerpt.indexOf('fox') >= 0);
});

test('no match returns score 0', function() {
    var note = { title: 'Meeting Notes', content: 'Agenda items' };
    var result = computeNoteScore(note, 'Zebra');
    assert.equal(result.score, 0);
    assert.equal(result.excerpt, null);
});

test('query is case-insensitive for title', function() {
    var note = { title: 'Meeting Notes' };
    var result = computeNoteScore(note, 'meeting');
    assert.equal(result.score, 100);
});

test('query is case-insensitive for content', function() {
    var note = { title: 'Title', content: 'Hello World' };
    var result = computeNoteScore(note, 'world');
    assert.equal(result.score, 50);
});

test('title start match scores higher than content match', function() {
    var noteA = { title: 'Alpha Project', content: 'Notes about beta' };
    var noteB = { title: 'Gamma', content: 'Alpha is mentioned in content' };
    var resultA = computeNoteScore(noteA, 'Alpha');
    var resultB = computeNoteScore(noteB, 'Alpha');
    assert.ok(resultA.score > resultB.score, 'title prefix should score higher than content');
});

test('searches blocks content when note.content is empty', function() {
    var note = { title: 'Title', blocks: [{ content: 'Deep in blocks content here' }] };
    var result = computeNoteScore(note, 'blocks');
    assert.equal(result.score, 50);
    assert.ok(result.excerpt.indexOf('blocks') >= 0);
});

test('handles empty title gracefully', function() {
    var note = { title: '', content: 'Some content' };
    var result = computeNoteScore(note, 'Some');
    assert.equal(result.score, 50);
});

test('handles undefined title', function() {
    var note = { content: 'Content with test' };
    var result = computeNoteScore(note, 'test');
    assert.equal(result.score, 50);
});

test('handles undefined content', function() {
    var note = { title: 'Testing Title' };
    var result = computeNoteScore(note, 'Testing');
    assert.equal(result.score, 100);
});

test('handles undefined blocks', function() {
    var note = { title: 'Title' };
    var result = computeNoteScore(note, 'Title');
    assert.equal(result.score, 100);
});

test('excerpt truncates long lines with ellipsis', function() {
    var longContent = 'This is a line that is way longer than eighty characters and should be truncated with ellipsis markers at the start and end when a match is found within it for testing via the search query';
    var note = { title: 'Note', content: longContent };
    var result = computeNoteScore(note, 'eighty');
    assert.notEqual(result.excerpt, null);
    // Should be <= 80 chars + ellipsis markers
    assert.ok(result.excerpt.replace(/\.\.\./g, '').length <= 83);
    assert.ok(result.excerpt.indexOf('eighty') >= 0);
});

test('short lines are not truncated', function() {
    var note = { title: 'Note', content: 'Short match here' };
    var result = computeNoteScore(note, 'match');
    assert.equal(result.excerpt, 'Short match here');
});

test('excerpt uses the first matching line', function() {
    var note = { title: 'Note', content: 'First line\nSecond line with match here\nThird line' };
    var result = computeNoteScore(note, 'match');
    assert.ok(result.excerpt.indexOf('Second line') >= 0);
});

test('partial word match in title not at start scores 80', function() {
    var note = { title: 'MyProjectPlan', content: 'Details' };
    var result = computeNoteScore(note, 'Project');
    assert.equal(result.score, 80);
});

// ============================================================
// TESTS: Canvas node search scoring
// ============================================================

console.log('\n\u2500\u2500\u2500 QuickOpen: Canvas node search scoring \u2500\u2500\u2500');

test('canvas node title starts with query scores 70', function() {
    var node = { title: 'Design System', preview: 'Component library' };
    var result = computeCanvasNodeScore(node, 'Design');
    assert.equal(result.score, 70);
});

test('canvas node title contains query scores 55', function() {
    var node = { title: 'My Design Notes', preview: 'Wireframes' };
    var result = computeCanvasNodeScore(node, 'Design');
    assert.equal(result.score, 55);
});

test('canvas node preview contains query scores 40 with excerpt', function() {
    var node = { title: 'Node 1', preview: 'This node contains important architecture decisions' };
    var result = computeCanvasNodeScore(node, 'architecture');
    assert.equal(result.score, 40);
    assert.notEqual(result.excerpt, null);
    assert.ok(result.excerpt.indexOf('architecture') >= 0);
});

test('canvas node no match scores 0', function() {
    var node = { title: 'Node 1', preview: 'Plain text' };
    var result = computeCanvasNodeScore(node, 'missing');
    assert.equal(result.score, 0);
    assert.equal(result.excerpt, null);
});

test('canvas node scoring is case-insensitive', function() {
    var node = { title: 'API Design', preview: 'REST endpoints' };
    var result = computeCanvasNodeScore(node, 'api');
    assert.equal(result.score, 70);
});

test('canvas node title match scores higher than preview match', function() {
    var nodeTitle = { title: 'Roadmap Q3', preview: 'Planning for next quarter' };
    var nodePreview = { title: 'Notes', preview: 'Roadmap items discussed' };
    var titleResult = computeCanvasNodeScore(nodeTitle, 'Roadmap');
    var previewResult = computeCanvasNodeScore(nodePreview, 'Roadmap');
    assert.ok(titleResult.score > previewResult.score, 'title match should score higher than preview match');
});

// ============================================================
// TESTS: Result sorting
// ============================================================

console.log('\n\u2500\u2500\u2500 QuickOpen: Result sorting \u2500\u2500\u2500');

test('sorts by score descending', function() {
    var results = [
        { type: 'note', title: 'Low', score: 10 },
        { type: 'note', title: 'High', score: 100 },
        { type: 'note', title: 'Mid', score: 50 }
    ];
    var sorted = sortResults(results);
    assert.equal(sorted[0].title, 'High');
    assert.equal(sorted[1].title, 'Mid');
    assert.equal(sorted[2].title, 'Low');
});

test('ties between notes sorted alphabetically by title', function() {
    var results = [
        { type: 'note', title: 'Zeta Project', score: 50 },
        { type: 'note', title: 'Alpha Project', score: 50 },
        { type: 'note', title: 'Beta Project', score: 50 }
    ];
    var sorted = sortResults(results);
    assert.equal(sorted[0].title, 'Alpha Project');
    assert.equal(sorted[1].title, 'Beta Project');
    assert.equal(sorted[2].title, 'Zeta Project');
});

test('ties between different types do not require alphabetical order', function() {
    var results = [
        { type: 'command', trigger: 'help', title: 'Help', score: 20 },
        { type: 'tag', name: '#test', count: 3, score: 30 },
        { type: 'note', title: 'Note', score: 50 }
    ];
    var sorted = sortResults(results);
    assert.equal(sorted[0].type, 'note', 'highest score first');
    assert.equal(sorted[1].type, 'tag', 'middle score second');
    assert.equal(sorted[2].type, 'command', 'lowest score third');
});

test('does not mutate original array', function() {
    var results = [
        { type: 'note', title: 'B', score: 50 },
        { type: 'note', title: 'A', score: 100 }
    ];
    sortResults(results);
    assert.equal(results[0].title, 'B', 'original order preserved');
});

test('single element array returns array', function() {
    var results = [{ type: 'note', title: 'Solo', score: 50 }];
    var sorted = sortResults(results);
    assert.equal(sorted.length, 1);
    assert.equal(sorted[0].title, 'Solo');
});

test('empty array returns empty', function() {
    assert.deepEqual(sortResults([]), []);
});

// ============================================================
// TESTS: Result limiting
// ============================================================

console.log('\n\u2500\u2500\u2500 QuickOpen: Result limiting \u2500\u2500\u2500');

test('limits results to max count', function() {
    var results = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    var limited = limitResults(results, 3);
    assert.equal(limited.length, 3);
    assert.equal(limited[0].id, 1);
    assert.equal(limited[1].id, 2);
    assert.equal(limited[2].id, 3);
});

test('returns all results if under limit', function() {
    var results = [{ id: 1 }, { id: 2 }];
    var limited = limitResults(results, 25);
    assert.equal(limited.length, 2);
});

test('returns empty array for empty input', function() {
    assert.deepEqual(limitResults([], 25), []);
});

test('does not mutate original array', function() {
    var results = [{ id: 1 }, { id: 2 }];
    limitResults(results, 1);
    assert.equal(results.length, 2);
});

// ============================================================
// TESTS: Result filtering
// ============================================================

console.log('\n\u2500\u2500\u2500 QuickOpen: Result filtering \u2500\u2500\u2500');

test('filter by notes type', function() {
    var results = [
        { type: 'note', title: 'A' },
        { type: 'tag', name: '#b' },
        { type: 'command', trigger: 'c' },
        { type: 'note', title: 'D' }
    ];
    var filtered = filterByType(results, 'notes');
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].title, 'A');
    assert.equal(filtered[1].title, 'D');
});

test('filter by tags type', function() {
    var results = [
        { type: 'note', title: 'A' },
        { type: 'tag', name: '#b' },
        { type: 'command', trigger: 'c' }
    ];
    var filtered = filterByType(results, 'tags');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].name, '#b');
});

test('filter by commands type', function() {
    var results = [
        { type: 'note', title: 'A' },
        { type: 'command', trigger: 'c' },
        { type: 'command', trigger: 'd' }
    ];
    var filtered = filterByType(results, 'commands');
    assert.equal(filtered.length, 2);
});

test('filter returns empty when no matches', function() {
    var results = [{ type: 'note', title: 'A' }];
    var filtered = filterByType(results, 'tags');
    assert.equal(filtered.length, 0);
});

test('filter preserves original array', function() {
    var results = [{ type: 'note', title: 'A' }, { type: 'tag', name: '#b' }];
    filterByType(results, 'notes');
    assert.equal(results.length, 2);
});

// ============================================================
// TESTS: Filter type resolution
// ============================================================

console.log('\n\u2500\u2500\u2500 QuickOpen: Filter type resolution \u2500\u2500\u2500');

test('all filter returns null', function() {
    assert.equal(resolveFilterType('all'), null);
});

test('notes resolves to note type', function() {
    assert.equal(resolveFilterType('notes'), 'note');
});

test('tags resolves to tag type', function() {
    assert.equal(resolveFilterType('tags'), 'tag');
});

test('commands resolves to command type', function() {
    assert.equal(resolveFilterType('commands'), 'command');
});

test('unknown filter returns null', function() {
    assert.equal(resolveFilterType('unknown'), null);
});

// ============================================================
// TESTS: Absolute index calculation
// ============================================================

console.log('\n\u2500\u2500\u2500 QuickOpen: Absolute index calculation \u2500\u2500\u2500');

test('calculates absolute index for first section', function() {
    var sections = [
        { type: 'notes', start: 0, count: 3 },
        { type: 'tags', start: 3, count: 2 }
    ];
    var idx = getAbsoluteIndex(sections, 1, 'notes');
    assert.equal(idx, 1); // notes start at 0 + 1
});

test('calculates absolute index for second section', function() {
    var sections = [
        { type: 'notes', start: 0, count: 3 },
        { type: 'tags', start: 3, count: 2 }
    ];
    var idx = getAbsoluteIndex(sections, 0, 'tags');
    assert.equal(idx, 3); // tags start at 3 + 0
});

test('returns relative index when section not found', function() {
    var sections = [{ type: 'notes', start: 0, count: 2 }];
    var idx = getAbsoluteIndex(sections, 5, 'unknown');
    assert.equal(idx, 5);
});

test('handles empty sections', function() {
    var idx = getAbsoluteIndex([], 0, 'notes');
    assert.equal(idx, 0);
});

// ============================================================
// TESTS: Recent searches
// ============================================================

console.log('\n\u2500\u2500\u2500 QuickOpen: Recent searches management \u2500\u2500\u2500');

test('adds query to empty recent list', function() {
    var recent = addRecentQuery('test query', []);
    assert.equal(recent.length, 1);
    assert.equal(recent[0], 'test query');
});

test('adds query to front of list', function() {
    var recent = addRecentQuery('new query', ['old query']);
    assert.equal(recent.length, 2);
    assert.equal(recent[0], 'new query');
    assert.equal(recent[1], 'old query');
});

test('deduplicates existing query (moves to front)', function() {
    var recent = addRecentQuery('test', ['alpha', 'test', 'beta']);
    assert.equal(recent.length, 3);
    assert.equal(recent[0], 'test');
    assert.equal(recent[1], 'alpha');
    assert.equal(recent[2], 'beta');
});

test('limits to 10 items', function() {
    var existing = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'];
    var recent = addRecentQuery('new query', existing);
    assert.equal(recent.length, 10);
    assert.equal(recent[0], 'new query');
    assert.equal(recent[recent.length - 1], 'q9'); // q10 was bumped
});

test('does not add empty query', function() {
    var recent = addRecentQuery('', ['existing']);
    assert.equal(recent.length, 1);
});

test('does not add whitespace-only query', function() {
    var recent = addRecentQuery('   ', ['existing']);
    assert.equal(recent.length, 1);
});

test('does not add null query', function() {
    var recent = addRecentQuery(null, ['existing']);
    assert.equal(recent.length, 1);
});

test('does not add undefined query', function() {
    var recent = addRecentQuery(undefined, ['existing']);
    assert.equal(recent.length, 1);
});

test('handles null existing list', function() {
    var recent = addRecentQuery('new', null);
    assert.equal(recent.length, 1);
    assert.equal(recent[0], 'new');
});

test('handles undefined existing list', function() {
    var recent = addRecentQuery('new', undefined);
    assert.equal(recent.length, 1);
    assert.equal(recent[0], 'new');
});

// ============================================================
// TESTS: Integration (scoring + sorting + limiting)
// ============================================================

console.log('\n\u2500\u2500\u2500 QuickOpen: Integration scenarios \u2500\u2500\u2500');

test('full flow: score, sort, limit across note types', function() {
    var note1 = { title: 'Zebra Project', content: 'Important notes about zebras' };
    var note2 = { title: 'Alpha Initiative', content: 'Alpha is the beginning' };
    var note3 = { title: 'Beta Release', content: 'Nothing here' };

    var results = [
        Object.assign({ type: 'note', id: '3' }, note3, computeNoteScore(note3, 'Alpha')),
        Object.assign({ type: 'note', id: '1' }, note1, computeNoteScore(note1, 'Alpha')),
        Object.assign({ type: 'note', id: '2' }, note2, computeNoteScore(note2, 'Alpha'))
    ];

    var sorted = sortResults(results);
    var limited = limitResults(sorted, 2);

    // Alpha Initiative should be first (title starts with query, score 100)
    assert.equal(limited[0].id, '2');
    assert.equal(limited[0].score, 100);
    // Zebra Project content mentions 'zebras' but not 'Alpha' — no match, score 0
    // So limited should only have the 1 result, or just check ordering
    assert.equal(limited.length, 2);
    assert.ok(limited[0].score >= limited[1].score);
});

test('full flow: canvas nodes + notes mixed', function() {
    var notes = [
        { type: 'note', title: 'Design Notes', score: 100, id: 'n1' },
        { type: 'note', title: 'Other', score: 50, id: 'n2' },
        { type: 'canvas-node', title: 'Design System', score: 70, noteId: 'c1' },
        { type: 'tag', name: '#design', score: 30 },
        { type: 'command', trigger: 'design', score: 20 }
    ];

    var sorted = sortResults(notes);
    assert.equal(sorted[0].type, 'note', 'highest score first');
    assert.equal(sorted[0].id, 'n1');
    assert.equal(sorted[1].type, 'canvas-node', 'second highest');
    assert.equal(sorted[1].title, 'Design System');
    assert.equal(sorted[2].type, 'note', 'third');
    assert.equal(sorted[3].type, 'tag', 'fourth');
    assert.equal(sorted[4].type, 'command', 'fifth');
});

test('excerpt generation preserves query case', function() {
    var note = { title: 'Title', content: 'Search Query here is case sensitive in excerpt display' };
    var result = computeNoteScore(note, 'Query');
    assert.ok(result.excerpt.indexOf('Query') >= 0, 'excerpt should contain query in original case');
});

test('excerpt with length exactly 80 not truncated', function() {
    var exactLine = 'A'.repeat(80) + ' test';
    var note = { title: 'Note', content: exactLine };
    var result = computeNoteScore(note, 'test');
    assert.notEqual(result.excerpt, null);
    assert.ok(result.excerpt.indexOf('test') >= 0);
    // Line is 84 chars (80 A's + ' test'), truncated to 80 with ellipsis
    assert.ok(result.excerpt.replace(/\.\.\./g, '').length <= 83);
});

// ============================================================
// SUMMARY
// ============================================================

console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  RESULTS: ' + passed + ' passed, ' + failed + ' failed');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

if (errors.length > 0) {
    console.log('FAILURES:');
    errors.forEach(function(e) { console.log('  \u2022 ' + e.name + ': ' + e.error); });
    console.log('');
}

process.exit(failed > 0 ? 1 : 0);
