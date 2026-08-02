

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = resolve(ROOT, 'scripts/package-release.sh');

// ------------------------------------------------------------
// Tool availability: skip gracefully if the packaging toolchain is
// missing (e.g. a bare runner without zip/unzip). The dedicated
// package-check CI job installs them; elsewhere SKIP, not FAIL.
// ------------------------------------------------------------
const requiredTools = ['bash', 'python3', 'zip', 'unzip'];
const missing = requiredTools.filter((t) => spawnSync('which', [t], { encoding: 'utf8' }).status !== 0);
if (missing.length > 0) {
  console.log(`\n  PACKAGE-EXCLUSIONS SUITE: SKIPPED (missing: ${missing.join(', ')})`);
  process.exit(0);
}

// ------------------------------------------------------------
// Test runner (mirrors attachments-unit-tests style)
// ------------------------------------------------------------
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
console.log('\n─── Static: required -x exclusion patterns in package-release.sh ───');

const scriptSrc = readFileSync(SCRIPT, 'utf8');

const REQUIRED_EXCLUSIONS = [
  '-x "*.git*"',        // lowercase .git
  '-x ".Git/*"',        // capital-G APFS quirk (case-insensitive filesystems)
  '-x ".venv/*"',
  '-x ".venv-brand/*"',
  '-x "tests/*"',
  '-x "docs/*"',
  '-x "node_modules/*"',
  '-x "scripts/*"',
  '-x ".github/*"',
  '-x "dist/*"',
  '-x "playwright-report/*"',
  '-x "test-results/*"',
  '-x "skills-lock.json"',
  '-x "__pycache__/*"',
  '-x "package.json"',
  '-x "package-lock.json"',
];

test('(a) script contains all required -x exclusion patterns', () => {
  const missingPatterns = REQUIRED_EXCLUSIONS.filter((p) => !scriptSrc.includes(p));
  assert.deepEqual(missingPatterns, [], `missing exclusions: ${missingPatterns.join(', ')}`);
});

// ============================================================
console.log('\n─── Behavioral: built store zip contains no excluded paths ───');

// Build the zip. Exit code 0 also proves the 80MB size guard did NOT fire.
const build = spawnSync('bash', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });

test('(b) package-release.sh builds the zip successfully (exit 0 = size guard OK)', () => {
  assert.equal(build.status, 0, `script exited ${build.status}:\n${build.stderr || build.stdout}`);
});

const version = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8')).version;
const zipPath = resolve(ROOT, 'dist', `vinland-v${version}.zip`);

const entries = existsSync(zipPath)
  ? spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
      .stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  : [];

// Any entry matching one of these prefixes (or equal to it) is a leak.
const EXCLUDED_PREFIXES = [
  '.git',               // catches .git/ and .Git/ (both cases, incl. .github/)
  '.venv',              // catches .venv/ and .venv-brand/
  'tests/',
  'docs/',
  'node_modules/',
  'scripts/',
  '.github/',
  'dist/',
  'playwright-report/',
  'test-results/',
  '__pycache__/',
  'skills-lock.json',
  'package.json',
  'package-lock.json',
];

test('(c) zip is non-empty and lists real payload entries', () => {
  assert.ok(entries.length > 0, 'zip appears empty - unzip -Z1 produced no entries');
});

test('(d) no excluded path prefix leaks into the zip', () => {
  const offenders = entries.filter((e) => EXCLUDED_PREFIXES.some((p) => e.startsWith(p)));
  assert.deepEqual(offenders, [], `excluded paths leaked into the zip: ${offenders.join(', ')}`);
});

test('(e) core extension payload IS present (index.html, manifest.json, js/)', () => {
  assert.ok(entries.includes('index.html'), 'index.html missing from zip');
  assert.ok(entries.includes('manifest.json'), 'manifest.json missing from zip');
  assert.ok(entries.some((e) => e.startsWith('js/')), 'no js/ files in zip');
});

test('(f) built zip stays under the 80MB size guard (CWS caps at 100MB)', () => {
  assert.ok(existsSync(zipPath), 'zip missing - cannot check size');
  const sizeBytes = statSync(zipPath).size;
  assert.ok(
    sizeBytes < 80 * 1024 * 1024,
    `zip is ${Math.round(sizeBytes / 1048576)}MB - over the 80MB guard`
  );
});

// Cleanup: never leave build artifacts behind.
if (existsSync(zipPath)) rmSync(zipPath, { force: true });

// ============================================================
console.log('\n══════════════════════════════════════════════════');
console.log(`  PACKAGE-EXCLUSIONS SUITE: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');

if (errors.length > 0) {
  console.log('FAILURES:');
  errors.forEach((e) => console.log(`  • ${e.name}: ${e.error}`));
  console.log('');
}

process.exit(failed > 0 ? 1 : 0);
