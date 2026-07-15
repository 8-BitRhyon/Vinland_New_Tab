#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const suites = [
  'notes-unit-tests.mjs',
  'notes-editor-open.test.mjs',
  'storage-shard.test.mjs',
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

const results = await Promise.all(suites.map(runSuite));
process.exit(exitCode);
