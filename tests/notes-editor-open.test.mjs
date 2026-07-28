/**
 * Notes Editor Open - TDD: Red → Green
 *
 * Bug: ModalManager.open('note-editor-modal') is at the END of Notes.open(),
 * after BlockEditor.render(). If BlockEditor.render throws, the modal never opens.
 *
 * RED test: reads the source and asserts ModalManager.open comes BEFORE
 * BlockEditor.render. With the current (buggy) code this assertion FAILS
 * because ModalManager.open is at line ~797, BlockEditor.render at line ~665.
 *
 * GREEN fix: move ModalManager.open before BlockEditor.render and wrap
 * render in try/catch.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// -----------------------------------------------------------
// Test runner
// -----------------------------------------------------------
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

function findLine(lines, pattern) {
  const idx = lines.findIndex(l => pattern.test(l));
  return idx >= 0 ? { idx, line: lines[idx] } : null;
}

// ============================================================
console.log('\n─── Notes.open() line ordering ───');

// RED test: reads the source, finds the two key lines, and asserts
// that ModalManager.open comes BEFORE BlockEditor.render.
// The current buggy code has them in the WRONG order - so this FAILS.

test('ModalManager.open must be called BEFORE BlockEditor.render in Notes.open()', () => {
  const src = readFileSync(
    resolve(__dirname, '../js/modules/NotesController.js'),
    'utf8'
  );
  const lines = src.split('\n');

  // Scope to the open() function: from "open: function" to "create: function"
  const openStart = lines.findIndex(l => /^\s+open:\s*function/.test(l));
  const openEnd = lines.findIndex((l, i) => i > openStart && /^\s+create:\s*function/.test(l));
  const openLines = lines.slice(openStart, openEnd);

  // Find ALL ModalManager.open('note-editor-modal') in open()
  const modalOpenIndices = [];
  openLines.forEach((l, i) => {
    if (/ModalManager\.open\(["']note-editor-modal["']\)/.test(l)) modalOpenIndices.push(i);
  });
  // Find the FIRST BlockEditor.render( in open()
  const renderCall = findLine(openLines, /BlockEditor\.render\(/);

  // The canvas-specific one (usually first, inside `if (note.type === 'canvas')`) returns
  // early - it only runs for canvas notes. For non-canvas notes we need at least one
  // ModalManager.open BEFORE BlockEditor.render.
  const openBeforeRender = modalOpenIndices.some(idx => idx < renderCall.idx);

  assert.ok(modalOpenIndices.length > 0, 'At least one ModalManager.open must exist in Notes.open()');
  assert.ok(renderCall, 'BlockEditor.render must exist in Notes.open()');

  // RED: without the fix, every ModalManager.open comes AFTER BlockEditor.render.
  // GREEN: an early ModalManager.open before the render call makes this pass.
  assert.ok(
    openBeforeRender,
    `FAIL: All ${modalOpenIndices.length} ModalManager.open calls (${modalOpenIndices.map(i => i + openStart + 1).join(', ')}) come AFTER ` +
    `BlockEditor.render (line ${openStart + renderCall.idx + 1}) in open() - ` +
    'a render error silently prevents the modal from opening.\n' +
    'Fix: add a ModalManager.open before BlockEditor.render and ' +
    'wrap render in try/catch.'
  );
});

// ============================================================
console.log('\n══════════════════════════════════════════════════');
console.log(`  EDITOR OPEN SUITE: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');

if (errors.length > 0) {
  console.log('FAILURES:');
  errors.forEach((e) => console.log(`  • ${e.name}: ${e.error}`));
  console.log('');
}

process.exit(failed > 0 ? 1 : 0);
