#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const suites = [
  'metadata-cache-unit-tests.mjs',
  'quickopen-unit-tests.mjs',
  'notes-unit-tests.mjs',
  'import-unit-tests.mjs',
  'notes-editor-open.test.mjs',
  'storage-shard.test.mjs',
  'dataview-unit-tests.mjs',
  'canvas-unit-tests.mjs',
];

let exitCode = 0;

async function runSuite(suite) {
  const node = process.execPath;
  const path = resolve(__dirname, suite);
  return new Promise((resolvePromise) => {
    const proc = spawn(node, [path], { stdio: 'inherit', cwd: resolve(__dirname, '..') });
    proc.on('exit', (code) => {
      if (code !== 0) exitCode = 1;
      resolvePromise();
    });
  });
}

// Sequential execution keeps CI logs readable — Promise.all interleaves
// stdout/stderr from all child processes, making failures hard to diagnose.
for (const suite of suites) {
  await runSuite(suite);
}
process.exit(exitCode);
