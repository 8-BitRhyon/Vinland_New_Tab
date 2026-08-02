

import assert from 'node:assert/strict';
import { escapeHtml, escapeAttr, sanitizeLinkUrl } from '../js/core/Utils.js';

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

// ============================================================
console.log('\n─── escapeHtml() ───');

test('escapes raw script tags', () => {
  assert.equal(
    escapeHtml('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;'
  );
});

test('escapes double quotes (attribute-breakout vector)', () => {
  assert.equal(
    escapeHtml('" onmouseover="alert(1)'),
    '&quot; onmouseover=&quot;alert(1)'
  );
});

test('escapes single quotes', () => {
  assert.equal(escapeHtml("it's"), 'it&#39;s');
});

test('escapes ampersands first (no double-escape)', () => {
  assert.equal(escapeHtml('a&b'), 'a&amp;b');
});

test('full escape of all five dangerous chars', () => {
  assert.equal(escapeHtml('a&b<c>d"e\'f'), 'a&amp;b&lt;c&gt;d&quot;e&#39;f');
});

test('returns empty string for null/undefined', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(''), '');
});

test('passes through plain text unchanged', () => {
  assert.equal(escapeHtml('hello world 123'), 'hello world 123');
});

// ============================================================
console.log('\n─── escapeAttr() (quote-only, for already-escaped text) ───');

test('escapes quotes but NOT ampersands (avoids double-escape)', () => {
  // Upstream (highlightSyntax step 1) already escaped & < > — escapeAttr must
  // not turn &amp; into &amp;amp;
  assert.equal(escapeAttr('R&amp;D'), 'R&amp;D');
  assert.equal(escapeAttr('a&b'), 'a&b');
});

test('closes quote-breakout in an attribute value', () => {
  assert.equal(
    escapeAttr('x" onmouseover="alert(1)'),
    'x&quot; onmouseover=&quot;alert(1)'
  );
});

test('escapes single quotes too', () => {
  assert.equal(escapeAttr("a'b"), 'a&#39;b');
});

test('returns empty string for null/undefined', () => {
  assert.equal(escapeAttr(null), '');
  assert.equal(escapeAttr(undefined), '');
});

// ============================================================
console.log('\n─── sanitizeLinkUrl() ───');

test('allows https URLs (trimmed)', () => {
  assert.equal(sanitizeLinkUrl('https://example.com/page?q=1'), 'https://example.com/page?q=1');
  assert.equal(sanitizeLinkUrl('  https://example.com  '), 'https://example.com');
});

test('allows http and mailto', () => {
  assert.equal(sanitizeLinkUrl('http://example.com'), 'http://example.com');
  assert.equal(sanitizeLinkUrl('mailto:hi@example.com'), 'mailto:hi@example.com');
});

test('scheme check is case-insensitive', () => {
  assert.equal(sanitizeLinkUrl('HTTPS://example.com'), 'HTTPS://example.com');
  assert.equal(sanitizeLinkUrl('Http://example.com'), 'Http://example.com');
});

test('REJECTS javascript: URLs', () => {
  assert.equal(sanitizeLinkUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeLinkUrl('JaVaScRiPt:alert(1)'), null);
  assert.equal(sanitizeLinkUrl('  javascript:alert(1)  '), null);
});

test('REJECTS entity-obfuscated javascript scheme', () => {
  // If raw user text passes through entity escaping then gets unescaped for
  // validation, encoded schemes must still be caught.
  assert.equal(sanitizeLinkUrl('jav&#x61;script:alert(1)'), null);
  assert.equal(sanitizeLinkUrl('jav&amp;script:alert(1)'), null);
});

test('REJECTS data:, vbscript:, file:, blob:', () => {
  assert.equal(sanitizeLinkUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeLinkUrl('vbscript:msgbox(1)'), null);
  assert.equal(sanitizeLinkUrl('file:///etc/passwd'), null);
  assert.equal(sanitizeLinkUrl('blob:https://example.com/uuid'), null);
});

test('REJECTS whitespace/control-char scheme smuggling', () => {
  assert.equal(sanitizeLinkUrl('java\nscript:alert(1)'), null);
  assert.equal(sanitizeLinkUrl('java\tscript:alert(1)'), null);
});

test('ALLOWS scheme-less relative and anchor targets (PKM internal links)', () => {
  // Root-relative, anchor, and relative paths carry no scheme — no script
  // execution is possible, and Obsidian-style internal links keep working.
  assert.equal(sanitizeLinkUrl('/wiki/foo'), '/wiki/foo');
  assert.equal(sanitizeLinkUrl('#section'), '#section');
  assert.equal(sanitizeLinkUrl('./notes.md'), './notes.md');
  assert.equal(sanitizeLinkUrl('../notes.md'), '../notes.md');
});

test('REJECTS scheme-less random strings and empty input', () => {
  assert.equal(sanitizeLinkUrl('not-a-url'), null);
  assert.equal(sanitizeLinkUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeLinkUrl(''), null);
  assert.equal(sanitizeLinkUrl(null), null);
  assert.equal(sanitizeLinkUrl(undefined), null);
});

// ============================================================
console.log('\n═══════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════\n');

if (errors.length > 0) {
  console.log('FAILURES:');
  errors.forEach((e) => console.log(`  • ${e.name}: ${e.error}`));
  console.log('');
}

process.exit(failed > 0 ? 1 : 0);
