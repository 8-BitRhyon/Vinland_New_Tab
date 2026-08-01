/**
 * Vinland BackupManager._updateDriveFile - Unit Tests
 *
 * Tests the REAL js/features/BackupManager.js against a mocked global.fetch.
 * No copied extracts — tests cannot drift from source.
 *
 * Covers the sync audit fix (commit 9080ab3) behaviours:
 *   - 200 success            → callback(true, fileId)
 *   - 404 (file gone)        → resets fileId + delegates to _createDriveFile (recreate)
 *   - 401/403 (auth)         → refreshDriveToken once, retry a single time
 *   - 401 → refresh fail     → callback(false), NO retry, NO create (no duplicate)
 *   - 401 retried → still 401→ mark disconnected, NO create (no duplicate)
 *   - network rejection      → callback(false)
 *
 * Run with: node tests/backup-manager-unit-tests.mjs
 * (aggregated by tests/run-all.mjs)
 */

import assert from 'node:assert/strict';

// ------------------------------------------------------------
// Globals shims (must exist before importing Storage/Config/BackupManager)
// ------------------------------------------------------------
const localStorageShim = (() => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    has: (k) => store.has(k),
  };
})();

globalThis.localStorage = localStorageShim;
globalThis.window = { showNotification: () => {} };
globalThis.document = { getElementById: () => null, createElement: () => null };

// ------------------------------------------------------------
// Import REAL module
// ------------------------------------------------------------
const { BackupManager } = await import('../js/features/BackupManager.js');

// ------------------------------------------------------------
// fetch mock helpers
// ------------------------------------------------------------
let fetchCalls = [];
let fetchResponses = [];

// responses: array of Response-like objects OR functions (url, opts) => Response-like
function mockFetchSequence(responses) {
  fetchCalls = [];
  fetchResponses = responses;
  globalThis.fetch = (url, opts) => {
    fetchCalls.push({ url: String(url), opts });
    const idx = Math.min(fetchCalls.length - 1, fetchResponses.length - 1);
    const r = fetchResponses[idx];
    if (typeof r === 'function') return Promise.resolve(r(String(url), opts));
    return Promise.resolve(r);
  };
}

function okResponse(id) {
  return { ok: true, status: 200, json: () => Promise.resolve({ id }) };
}

// Reset manager state between tests (chrome is undefined in Node, so
// saveDriveState/refreshDriveToken no-op safely; we override the latter).
function resetManager() {
  BackupManager.driveAccessToken = 'test-token';
  BackupManager.driveConnected = true;
  BackupManager.driveFileId = 'file_1';
  BackupManager._createDriveFile = (data, cb) => {
    throw new Error('_createDriveFile should not be called in this test');
  };
}

// Guard against a hung callback: resolve the promise only if the callback
// fires, otherwise reject after 2s so the suite fails loudly instead of
// hanging CI forever.
function withTimeout(promise, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TIMEOUT: ' + label + ' never invoked the callback')), 2000);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

// ------------------------------------------------------------
// Test runner (async-aware, mirrors attachments-unit-tests style)
// ------------------------------------------------------------
let passed = 0;
let failed = 0;
const errors = [];

async function test(name, fn) {
  try {
    await fn();
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
console.log('\n─── BackupManager._driveErrorCode: classification ───');

await test('(a) 401/403 → auth, 404 → not_found, 5xx → error', async () => {
  assert.equal(BackupManager._driveErrorCode(401), 'auth');
  assert.equal(BackupManager._driveErrorCode(403), 'auth');
  assert.equal(BackupManager._driveErrorCode(404), 'not_found');
  assert.equal(BackupManager._driveErrorCode(500), 'error');
  assert.equal(BackupManager._driveErrorCode(429), 'error');
});

// ============================================================
console.log('\n─── BackupManager._updateDriveFile: success path ───');

await test('(b) 200 with id → callback(true, fileId), single PATCH', async () => {
  resetManager();
  mockFetchSequence([okResponse('file_1')]);

  const data = { notes: [] };
  const result = await withTimeout(new Promise((resolve) => {
    BackupManager._updateDriveFile(data, (success, fileId) => resolve({ success, fileId }));
  }), '200 success');

  assert.equal(result.success, true);
  assert.equal(result.fileId, 'file_1');
  assert.equal(fetchCalls.length, 1, 'exactly one fetch');
  assert.ok(fetchCalls[0].url.includes('/files/file_1'), 'PATCH targets file_1');
});

// ============================================================
console.log('\n─── BackupManager._updateDriveFile: 404 recreate ───');

await test('(c) 404 → resets fileId + delegates to _createDriveFile, no double callback', async () => {
  resetManager();
  mockFetchSequence([{ status: 404 }]);

  let createCalls = 0;
  let createData = null;
  BackupManager._createDriveFile = (data, cb) => {
    createCalls++;
    createData = data;
    cb(true, 'new-file-id'); // _createDriveFile owns the callback
  };

  const data = { notes: ['x'] };
  const result = await withTimeout(new Promise((resolve) => {
    BackupManager._updateDriveFile(data, (success, fileId) => resolve({ success, fileId }));
  }), '404 recreate');

  assert.equal(fetchCalls.length, 1, 'no extra PATCH after 404');
  assert.ok(fetchCalls[0].url.includes('/files/file_1'), '404 PATCH targeted the existing file');
  assert.equal(createCalls, 1, '_createDriveFile invoked exactly once');
  assert.equal(createData, data, 'same data forwarded');
  assert.equal(BackupManager.driveFileId, null, 'fileId reset before recreate');
  assert.deepEqual(result, { success: true, fileId: 'new-file-id' }, 'single callback via create path');
});

// ============================================================
console.log('\n─── BackupManager._updateDriveFile: 401 refresh + retry ───');

await test('(d) 401 → refresh token once, retry once, NO duplicate create', async () => {
  resetManager();
  mockFetchSequence([{ status: 401 }, okResponse('file_1')]);

  let refreshCalls = 0;
  let createCalls = 0;
  BackupManager.refreshDriveToken = (cb) => {
    refreshCalls++;
    BackupManager.driveAccessToken = 'refreshed-token';
    cb(true);
  };
  BackupManager._createDriveFile = () => { createCalls++; };

  const result = await withTimeout(new Promise((resolve) => {
    BackupManager._updateDriveFile({ notes: [] }, (success, fileId) => resolve({ success, fileId }));
  }), '401 refresh-retry');

  assert.equal(refreshCalls, 1, 'token refreshed exactly once');
  assert.equal(fetchCalls.length, 2, 'initial 401 + one retry = 2 fetches');
  assert.equal(createCalls, 0, 'NO duplicate file created');
  assert.deepEqual(result, { success: true, fileId: 'file_1' });
  assert.ok(fetchCalls[1].url.includes('/files/file_1'), 'retry still PATCHes same file');
});

await test('(e) 401 → refresh FAILS → callback(false), no retry, no create', async () => {
  resetManager();
  mockFetchSequence([{ status: 401 }]);

  let refreshCalls = 0;
  let createCalls = 0;
  BackupManager.refreshDriveToken = (cb) => {
    refreshCalls++;
    cb(false); // refresh failed — abort
  };
  BackupManager._createDriveFile = () => { createCalls++; };

  const result = await withTimeout(new Promise((resolve) => {
    BackupManager._updateDriveFile({ notes: [] }, (success, fileId) => resolve({ success, fileId }));
  }), '401 refresh-fails');

  assert.equal(refreshCalls, 1, 'refresh attempted once');
  assert.equal(fetchCalls.length, 1, 'no retry after failed refresh');
  assert.equal(createCalls, 0, 'NO duplicate created');
  assert.deepEqual(result, { success: false, fileId: null });
});

await test('(f) 401 retried → STILL 401 → mark disconnected, NO duplicate create', async () => {
  resetManager();
  mockFetchSequence([{ status: 401 }, { status: 401 }]);

  let refreshCalls = 0;
  let createCalls = 0;
  let notified = null;
  BackupManager.refreshDriveToken = (cb) => {
    refreshCalls++;
    BackupManager.driveAccessToken = 'refreshed-again';
    cb(true);
  };
  BackupManager._createDriveFile = () => { createCalls++; };
  globalThis.window = { showNotification: (msg) => { notified = msg; } };

  const result = await withTimeout(new Promise((resolve) => {
    BackupManager._updateDriveFile({ notes: [] }, (success, fileId) => resolve({ success, fileId }));
  }), '401 retried-still-401');

  assert.equal(refreshCalls, 1, 'refresh only on first 401 (retried guard)');
  assert.equal(fetchCalls.length, 2, 'two attempts, no more');
  assert.equal(createCalls, 0, 'NO duplicate created');
  assert.deepEqual(result, { success: false, fileId: null });
  assert.equal(BackupManager.driveConnected, false, 'badge truthfully disconnected');
  assert.equal(BackupManager.driveAccessToken, null, 'token cleared');
  assert.equal(BackupManager.driveFileId, null, 'fileId cleared');
  assert.ok(notified && notified.includes('Auth rejected'), 'honest reconnect toast');
});

// ============================================================
console.log('\n─── BackupManager._updateDriveFile: network error ───');

await test('(g) fetch rejection → callback(false), no create', async () => {
  resetManager();
  fetchCalls = [];
  globalThis.fetch = () => Promise.reject(new Error('network down'));

  let createCalls = 0;
  BackupManager._createDriveFile = () => { createCalls++; };

  const result = await withTimeout(new Promise((resolve) => {
    BackupManager._updateDriveFile({ notes: [] }, (success, fileId) => resolve({ success, fileId }));
  }), 'network rejection');

  assert.deepEqual(result, { success: false, fileId: null });
  assert.equal(createCalls, 0, 'NO create on network error');
});

// ============================================================
console.log('\n══════════════════════════════════════════════════');
console.log(`  BACKUP MANAGER SUITE: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');

if (errors.length > 0) {
  console.log('FAILURES:');
  errors.forEach((e) => console.log(`  • ${e.name}: ${e.error}`));
  console.log('');
}

process.exit(failed > 0 ? 1 : 0);
