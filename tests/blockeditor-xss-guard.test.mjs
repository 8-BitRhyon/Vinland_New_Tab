

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const src = readFileSync(resolve(__dirname, '../js/editor/BlockEditor.js'), 'utf8');
const lines = src.split('\n');

// getCalcPreviewHtml moved to CalcPreview.js (L8 monolith decomposition).
const calcSrc = readFileSync(resolve(__dirname, '../js/editor/CalcPreview.js'), 'utf8');
const calcLines = calcSrc.split('\n');

// Extract the body of a named method between `name: function` and the next
// top-level `},` at the same indent — good enough for sink presence checks.
function methodBodyFrom(sourceLines, methodName) {
  const start = sourceLines.findIndex((l) => new RegExp(`^\\s+${methodName}:\\s*function|^export function ${methodName}\\s*\\(`).test(l));
  if (start === -1) return null;
  const indent = sourceLines[start].match(/^\s*/)[0].length;
  let end = -1;
  for (let i = start + 1; i < sourceLines.length; i++) {
    if (/^\s*}\s*,?\s*$/.test(sourceLines[i]) && sourceLines[i].match(/^\s*/)[0].length === indent) {
      end = i;
      break;
    }
  }
  return end === -1 ? null : sourceLines.slice(start, end + 1).join('\n');
}

function methodBody(methodName) {
  return methodBodyFrom(lines, methodName);
}

// ============================================================
console.log('\n─── BlockEditor import wiring ───');

test('BlockEditor imports the hardening helpers from Utils.js', () => {
  assert.match(src, /import\s*\{[^}]*escapeHtml[^}]*\}\s*from\s*['"]\.\.\/core\/Utils\.js['"]/,
    'escapeHtml must be imported from ../core/Utils.js');
  assert.match(src, /import\s*\{[^}]*escapeAttr[^}]*\}\s*from\s*['"]\.\.\/core\/Utils\.js['"]/,
    'escapeAttr must be imported from ../core/Utils.js');
  assert.match(src, /import\s*\{[^}]*sanitizeLinkUrl[^}]*\}\s*from\s*['"]\.\.\/core\/Utils\.js['"]/,
    'sanitizeLinkUrl must be imported from ../core/Utils.js');
});

// ============================================================
console.log('\n─── markdownToHtml link step ───');

test('link replacement validates the URL scheme before emitting href', () => {
  const body = methodBody('markdownToHtml');
  assert.ok(body, 'markdownToHtml method must exist');
  const linkStep = body.split('// 5. Links')[1] || '';
  assert.match(linkStep, /sanitizeLinkUrl\(/, 'link step must call sanitizeLinkUrl');
  assert.match(linkStep, /escapeHtml\(/, 'link step must escape the URL attribute');
  assert.match(linkStep, /=== null/, 'dangerous schemes must fall back to plain text');
});

// ============================================================
console.log('\n─── highlightSyntax wiki links ───');

test('wiki-link data-note-title is quote-escaped', () => {
  const body = methodBody('highlightSyntax');
  assert.ok(body, 'highlightSyntax method must exist');
  const wikiStep = body.split('Wiki Link Highlighting')[1] || body;
  assert.match(wikiStep, /escapeAttr\(title\)/, 'data-note-title value must be escapeAttr()ed');
  assert.ok(!/data-note-title="'\s*\+\s*noteTitle\.trim\(\)/.test(wikiStep),
    'must not interpolate raw noteTitle into the attribute');
});

// ============================================================
console.log('\n─── getCalcPreviewHtml ───');

test('calc preview escapes expr and result', () => {
  // L8: the function now lives in CalcPreview.js — assert the module source.
  const body = methodBodyFrom(calcLines, 'getCalcPreviewHtml');
  assert.ok(body, 'getCalcPreviewHtml must exist in CalcPreview.js');
  assert.match(body, /escapeHtml\(expr\)/, 'expression span must be escaped');
  assert.match(body, /escapeHtml\(result\)/, 'result span must be escaped');
  assert.ok(!/calc-expression">'\s*\+\s*expr\s*\+/.test(body),
    'must not interpolate raw expr');
});

// ============================================================
console.log('\n══════════════════════════════════════════════════');
console.log(`  BLOCKEDITOR XSS GUARD SUITE: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');

if (errors.length > 0) {
  console.log('FAILURES:');
  errors.forEach((e) => console.log(`  • ${e.name}: ${e.error}`));
  console.log('');
}

process.exit(failed > 0 ? 1 : 0);
