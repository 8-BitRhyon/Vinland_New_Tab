#!/usr/bin/env node


import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['js', 'tests', 'scripts'];
const EXT = new Set(['.js', '.mjs', '.cjs']);
const HARVEST_PATH = '/tmp/vinland-comment-harvest.json';


function isRegexStart(src, i) {
  // Scan back over whitespace and line/block comments to the previous token.
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  // Re-walk comments backwards is overkill; a trailing comment before `/`
  // is vanishingly rare in this codebase. Previous significant char:
  const prev = j >= 0 ? src[j] : '';
  if (prev === '') return true; // start of file / after whitespace-only line
  return '([{,;:=!?&|+-*%^~<>'.includes(prev);
}


function scanFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const comments = [];
  let out = '';
  let i = 0;
  let line = 1;
  const n = src.length;
  let state = 'code'; // code | line | block | sq | dq | tmpl | regex

  while (i < n) {
    const ch = src[i];
    const nx = src[i + 1];

    if (state === 'code') {
      if (ch === '/' && nx === '/') { state = 'line'; out += ch + nx; i += 2; continue; }
      if (ch === '/' && nx === '*') {
        // Locate the closing */.
        const close = src.indexOf('*/', i + 2);
        const startIdx = i;
        const startLine = line;
        let endIdx, text;
        if (close === -1) {
          text = src.slice(i + 2);
          endIdx = n;
        } else {
          text = src.slice(i + 2, close);
          endIdx = close + 2;
        }
        const nlCount = (text.match(/\n/g) || []).length;
        const endLine = startLine + nlCount;
        // Normalize: strip leading "*" decoration from each line.
        const cleaned = text
          .split('\n')
          .map((l) => l.replace(/^\s*\* ?/, '').replace(/\s+$/, ''))
          .join('\n')
          .trim();
        comments.push({ file: filePath, startLine, endLine, text: cleaned });

        // Whole-line comment? (only whitespace before on its first line and
        // only whitespace after on its last line) -> drop entirely, keep one
        // newline to avoid gluing neighboring statements together.
        let lineStart = src.lastIndexOf('\n', startIdx - 1);
        if (lineStart === -1) lineStart = 0; else lineStart += 1;
        const beforeWs = src.slice(lineStart, startIdx);
        const nlAfter = src.indexOf('\n', endIdx);
        const afterWs = nlAfter === -1 ? src.slice(endIdx) : src.slice(endIdx, nlAfter);
        const wholeLine = beforeWs.trim() === '' && afterWs.trim() === '';

        if (wholeLine) {
          if (nlAfter !== -1) { out += '\n'; i = nlAfter + 1; line = endLine + 1; }
          else { i = n; }
        } else {
          i = endIdx;
        }
        continue;
      }
      if (ch === "'") { state = 'sq'; out += ch; i++; continue; }
      if (ch === '"') { state = 'dq'; out += ch; i++; continue; }
      if (ch === '`') { state = 'tmpl'; out += ch; i++; continue; }
      if (ch === '/' && isRegexStart(src, i)) { state = 'regex'; out += ch; i++; continue; }
      out += ch; i++;
      if (ch === '\n') line++;
      continue;
    }

    if (state === 'line') {
      out += ch; i++;
      if (ch === '\n') { state = 'code'; line++; }
      continue;
    }

    if (state === 'sq' || state === 'dq') {
      out += ch; i++;
      if (ch === '\\') { if (i < n) { out += src[i]; i++; } continue; }
      if (ch === '\n') line++;
      if (ch === (state === 'sq' ? "'" : '"')) state = 'code';
      continue;
    }

    if (state === 'tmpl') {
      out += ch; i++;
      if (ch === '\\') { if (i < n) { out += src[i]; i++; } continue; }
      if (ch === '\n') line++;
      if (ch === '`') state = 'code';
      // ${...} expressions inside templates: conservatively treat the whole
      // template as opaque (JS in ${} rarely contains /* */).
      continue;
    }

    if (state === 'regex') {
      out += ch; i++;
      if (ch === '\\') { if (i < n) { out += src[i]; i++; } continue; }
      if (ch === '\n') { state = 'code'; line++; continue; }
      if (ch === '[') {
        // NOTE: the top of this block already emitted '[' and advanced i.
        // Do NOT emit/advance again here — duplicating the '[' shifts the
        // class contents (e.g. [a-z] -> [[-z], a SILENT corruption that
        // still parses, or [1-9] -> [[-9], a hard syntax error).
        while (i < n && src[i] !== ']') {
          if (src[i] === '\\' && i + 1 < n) { out += src[i] + src[i + 1]; i += 2; }
          else { out += src[i]; i++; }
        }
        if (i < n) { out += src[i]; i++; } // closing ]
        continue;
      }
      if (ch === '/') state = 'code';
      continue;
    }
  }

  return { out, comments };
}


function collectFiles(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      collectFiles(full, acc);
    } else if (EXT.has(path.extname(entry.name))) {
      acc.push(full);
    }
  }
  return acc;
}

const files = [];
for (const root of ROOTS) collectFiles(root, files);

const allComments = [];
let stripped = 0;
let filesTouched = 0;
const failures = [];

for (const file of files) {
  const { out, comments } = scanFile(file);
  if (comments.length === 0) continue;
  filesTouched++;
  stripped += comments.length;
  allComments.push(...comments);
  fs.writeFileSync(file, out);
  // Sanity: the file must still parse.
  const check = spawnSyncCheck(file);
  if (check !== null) {
    failures.push({ file, error: check });
  }
}

import { spawnSync } from 'node:child_process';
function spawnSyncCheck(file) {
  const r = spawnSync('node', ['--check', file], { encoding: 'utf8' });
  return r.status === 0 ? null : (r.stderr || 'parse failed');
}

fs.writeFileSync(HARVEST_PATH, JSON.stringify(allComments, null, 1));

console.log(`Files scanned:   ${files.length}`);
console.log(`Files touched:   ${filesTouched}`);
console.log(`Comments moved:  ${stripped}`);
console.log(`Parse failures:  ${failures.length}`);
if (failures.length) {
  for (const f of failures.slice(0, 20)) console.log('  FAIL', f.file, '-', f.error.split('\n')[0]);
  process.exit(1);
}
console.log(`Harvest written: ${HARVEST_PATH}`);
