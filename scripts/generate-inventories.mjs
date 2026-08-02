#!/usr/bin/env node
/**
 * generate-inventories.mjs
 *
 * Regenerates the per-module function inventories in docs/DEVELOPMENT.md from
 * the source, so they can't silently drift when functions change.
 *
 *   npm run docs          # regenerate (updates the tables in place)
 *   npm run docs:check    # verify only — exits 1 if any drift was found
 *
 * How it works
 * ------------
 * 1. Extracts every function/method name per configured module (with the
 *    nearest preceding `//` comment as a hint). Heuristic, not a parser:
 *    it matches object-literal methods (`name: function(`, `name() {`,
 *    `name: (...) =>`), named functions, and accessors. Multi-line
 *    shorthand signatures (`open(\n  id\n) {`) are missed — that is a known
 *    limitation, not an error.
 * 2. Parses the existing table for that module in docs/DEVELOPMENT.md.
 * 3. Merges:
 *      - Existing rows keep their HAND-CURATED descriptions when at least one
 *        of their function names is still present in the source.
 *      - NEW functions get an auto row: `| name() | (auto) <hint> |` so a
 *        human can fold them into a curated row afterwards.
 *      - Rows whose names are ALL gone are dropped and reported (stale).
 *    Name matching is fuzzy (case-insensitive substring) so elided combined
 *    rows like `_renderHeading/Task/List/Quote/...Block` still cover their
 *    functions. NOTE the asymmetry: a doc key that is a substring of a source
 *    name silently covers it (e.g. `Move` from `_kHandleAltArrowMove` covers a
 *    new `_bindMarqueeMove`) — that errs toward under-reporting, which is the
 *    safe direction for a CI drift gate.
 * 4. Rewrites only the table block (header + intro paragraphs untouched) and
 *    refreshes the `(≈Nk lines)` suffix in the section header.
 *
 * The generated tables are a DOCUMENTATION aid. Descriptions are human
 * text — the generator never fabricates them beyond `(auto) <hint>`.
 */

import fs from 'node:fs';
import path from 'node:path';

const DOC = 'docs/DEVELOPMENT.md';
const CHECK = process.argv.includes('--check');

// Module -> section header prefix (without the `(≈Nk lines)` suffix).
const MODULES = [
  { path: 'js/editor/BlockEditor.js', header: '#### BlockEditor — function inventory' },
  { path: 'js/ui/SettingsUI.js', header: '#### SettingsUI — function inventory' },
  { path: 'js/modules/NotesController.js', header: '#### NotesController — function inventory' },
  { path: 'js/modules/CanvasManager.js', header: '#### CanvasManager — function inventory' },
  { path: 'js/modules/GraphManager.js', header: '#### GraphManager — function inventory' },
  { path: 'js/features/QuickOpen.js', header: '#### QuickOpen — function inventory' },
  { path: 'js/core/MetadataCache.js', header: '#### MetadataCache — function inventory' },
  { path: 'js/core/Storage.js', header: '#### Storage — function inventory' },
  { path: 'js/editor/PageManager.js', header: '#### PageManager — function inventory' },
  { path: 'js/features/BackupManager.js', header: '#### BackupManager — function inventory' },
  { path: 'js/features/FlashcardManager.js', header: '#### FlashcardManager — function inventory' },
  { path: 'js/features/DataviewQuery.js', header: '#### DataviewQuery — function inventory' },
  { path: 'js/ui/Sidebar.js', header: '#### Sidebar — function inventory' },
];

// ──────────────────────────────────────────
// Extraction
// ──────────────────────────────────────────

const FUNC_PATTERNS = [
  /^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?function\s*\(/, // name: function (
  /^\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\{/, // name() {
  /^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{$/, // name(params) {
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/, // [export] function name(
  /^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?\([^)]*\)\s*=>/, // name: (...) =>
  /^\s*(?:get|set)\s+([A-Za-z_$][\w$]*)\s*\(/, // get/set name(
];

// Keywords/statements the generic `name(params) {` pattern would otherwise
// pick up (e.g. `if (...) {`, `setTimeout(function () {`, `catch (e) {`).
const NOISE = new Set([
  'if', 'for', 'while', 'switch', 'function', 'return', 'class', 'const',
  'let', 'var', 'case', 'default', 'do', 'else', 'try', 'catch', 'finally',
  'new', 'delete', 'void', 'typeof', 'instanceof', 'in', 'of', 'throw',
  'break', 'continue', 'yield', 'await', 'debugger', 'static', 'then',
  'setTimeout', 'setInterval', 'requestAnimationFrame', 'addEventListener',
  'removeEventListener', 'querySelector', 'querySelectorAll', 'getElementById',
  'getElementsByClassName', 'JSON', 'Math', 'Promise', 'Object', 'Array',
  'String', 'Number', 'Date', 'navigator', 'window', 'document', 'chrome',
]);

const BANNER_RE = /^\s*\/\/\s*[─=─\-—\s·]{6,}/;
const COMMENT_RE = /^\s*\/\/\s*(.+)$/;

function extractFunctions(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  const seen = new Set();
  let hint = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (BANNER_RE.test(line)) { hint = null; continue; }

    let name = null;
    for (const re of FUNC_PATTERNS) {
      const m = line.match(re);
      if (m) { name = m[1]; break; }
    }
    if (name && !NOISE.has(name) && !seen.has(name)) {
      seen.add(name);
      out.push({ name, hint, line: i + 1 });
      hint = null;
      continue;
    }
    if (name && NOISE.has(name)) continue;

    const c = line.match(COMMENT_RE);
    if (c) { hint = c[1].trim().replace(/^[─=─\-—\s·]+$/, '').slice(0, 80); continue; }
    if (line.trim() === '') continue;
    hint = null; // plain code line clears the pending hint
  }
  return out;
}

// ──────────────────────────────────────────
// Doc parsing / merging
// ──────────────────────────────────────────

function normalizeKeys(rowLine) {
  const parts = rowLine.split('|');
  if (parts.length < 3) return [];
  const cell = parts[1].replace(/`/g, '').replace(/ \/ /g, '/').replace(/ \+ /g, '/');
  const keys = [];
  for (const raw of cell.split('/')) {
    let tok = raw.trim();
    if (!tok) continue;
    // Scoped names like HistoryManager.push -> push
    if (tok.includes('.')) tok = tok.split('.').pop();
    const id = tok.match(/^([A-Za-z_$][\w$]*)/);
    if (id) keys.push(id[1]);
  }
  return keys;
}

/**
 * Fuzzy coverage: doc key covers source fn (or vice versa) via substring.
 * Case-insensitive so elided rows like `.../InitFindBar` still match the
 * source `_initFindBar`.
 */
function isCovered(key, sourceNames) {
  const k = key.toLowerCase();
  return sourceNames.some((f) => {
    const n = f.toLowerCase();
    return n === k || n.includes(k) || k.includes(n);
  });
}

function findSection(docLines, header) {
  const hi = docLines.findIndex((l) => l.startsWith(header));
  if (hi === -1) return null;
  let i = hi + 1;
  while (i < docLines.length && !docLines[i].includes('| Function |')) i++;
  if (i >= docLines.length) return null;
  const headerRowIdx = i;
  const sepIdx = i + 1; // '|---|---|'
  const rows = [];
  let j = sepIdx + 1;
  while (j < docLines.length && docLines[j].trim().startsWith('|')) {
    rows.push({ line: docLines[j], keys: normalizeKeys(docLines[j]) });
    j++;
  }
  return { headerIdx: hi, headerRowIdx, sepIdx, lastRowIdx: j - 1, rows };
}

function regenModule(docLines, mod, report) {
  const sec = findSection(docLines, mod.header);
  if (!sec) {
    report.push(`⚠  section not found in ${DOC}: "${mod.header}" (add it manually)`);
    return { changed: false };
  }
  const srcLines = fs.readFileSync(mod.path, 'utf8').split('\n');
  const fns = extractFunctions(mod.path);
  const sourceNames = fns.map((f) => f.name);
  const docKeys = new Set();
  for (const r of sec.rows) r.keys.forEach((k) => docKeys.add(k));

  const removed = [...docKeys].filter((k) => !isCovered(k, sourceNames));
  const removedSet = new Set(removed);
  const newFns = fns.filter((f) => !isCovered(f.name, [...docKeys]));

  // Rebuild rows: keep curated rows that still have ≥1 live key.
  const kept = sec.rows.filter((r) => r.keys.some((k) => !removedSet.has(k)));
  const droppedRows = sec.rows.filter((r) => r.keys.every((k) => removedSet.has(k)));

  const newRows = newFns.map((f) => {
    const h = f.hint ? f.hint : '—';
    return { line: `| \`${f.name}()\` | (auto) ${h} |`, keys: [f.name] };
  });

  const changed =
    removed.length > 0 || newFns.length > 0 || droppedRows.length > 0;

  report.push(
    `  ${mod.path} · ${fns.length} functions · ${kept.length} curated · ` +
      `${newFns.length} new · ${removed.length} removed · ${droppedRows.length} stale rows`
  );
  for (const f of newFns) report.push(`    ✚ ${f.name}() — ${f.hint || '(no hint)'}`);
  for (const k of removed) report.push(`    ✖ ${k}`);
  // Print the FULL row text so a renamed function's curated description is
  // never lost to a rename (the maintainer can re-curate from the report).
  for (const r of droppedRows) report.push(`    🗑 dropped row: ${r.line.trim()}`);

  if (CHECK || !changed) return { changed };

  // Rebuild the table block: header row (keep), separator + kept rows + new rows.
  const allRows = [...kept, ...newRows];
  const block = [
    '|---|---|',
    ...allRows.map((r) => r.line),
    '_Inventory auto-generated by `npm run docs` — edit rows here; new functions get `(auto)` rows._',
  ];
  // Refresh the (≈Nk lines) suffix in the section header.
  const suffix = `(≈${(srcLines.length / 1000).toFixed(1)}k lines)`;
  const headerLine = docLines[sec.headerIdx].replace(/\(≈[\d.]+k lines\)/, suffix);
  docLines[sec.headerIdx] = headerLine;
  docLines.splice(sec.sepIdx, sec.lastRowIdx - sec.sepIdx + 1, ...block);
  return { changed: true };
}

// ──────────────────────────────────────────
// Main
// ──────────────────────────────────────────

const doc = fs.readFileSync(DOC, 'utf8');
const docLines = doc.split('\n');
const report = [];
let anyChanged = false;

for (const mod of MODULES) {
  const r = regenModule(docLines, mod, report);
  anyChanged = anyChanged || r.changed;
}

console.log(`Vinland inventory generator (${CHECK ? 'check mode' : 'update mode'})`);
for (const line of report) console.log(line);

if (CHECK) {
  const drifted = report.some((l) => l.includes('✚') || l.includes('✖') || l.includes('🗑'));
  console.log(
    drifted
      ? '\n✖ Drift detected — run `npm run docs` and commit the regenerated tables.'
      : '\n✓ Inventories are in sync with the source.'
  );
  process.exit(drifted ? 1 : 0);
}

if (anyChanged) {
  fs.writeFileSync(DOC, docLines.join('\n'));
  console.log('\n✓ Table(s) regenerated in ' + DOC);
} else {
  console.log('\n✓ No drift — ' + DOC + ' already in sync.');
}
