

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
console.log('\n─── BackupManager.maybePromptBackup: proactive reminder ───');

// maybePromptBackup reads State.CONFIG and calls the bare global
// showConfirmModal. Wire both up for these tests.
const { State } = await import('../js/core/Store.js');

function freshReminderState() {
  // Merge over the existing config (don't replace wholesale — other suites may
  // share this process, and replaced configs lose merged defaults like version).
  Object.assign(State.CONFIG, {
    first_run: false,
    backup_reminder_enabled: true,
    backup_reminder_days: 7,
    last_backup_time: null,
    last_backup_prompt: null,
  });
  globalThis.showConfirmModal = () => {};
}

// (m) overrides BackupManager.triggerBackup — restore it afterwards so the
// shared module object is left untouched for any other suite in this process.
const _realTriggerBackup = BackupManager.triggerBackup;

await test('(h) overdue (never backed up) → prompt shown, last_backup_prompt recorded', async () => {
  freshReminderState();
  let shown = null;
  globalThis.showConfirmModal = (title, msg, onConfirm) => { shown = { title, msg, onConfirm }; };

  BackupManager.maybePromptBackup();

  assert.ok(shown, 'modal invoked');
  assert.ok(shown.title.includes('BACKUP REMINDER'), 'title set');
  assert.ok(shown.msg.includes('7'), 'message mentions the day window');
  assert.equal(typeof shown.onConfirm, 'function', 'EXPORT NOW callback wired');
  assert.ok(State.CONFIG.last_backup_prompt, 'prompt timestamp persisted');
});

await test('(i) recent backup → no prompt', async () => {
  freshReminderState();
  State.CONFIG.last_backup_time = Date.now() - 60 * 60 * 1000; // 1h ago
  let shown = false;
  globalThis.showConfirmModal = () => { shown = true; };

  BackupManager.maybePromptBackup();

  assert.equal(shown, false, 'no modal for a fresh backup');
  assert.equal(State.CONFIG.last_backup_prompt, null, 'no prompt timestamp written');
});

await test('(j) reminders disabled → no prompt even when overdue', async () => {
  freshReminderState();
  State.CONFIG.backup_reminder_enabled = false;
  let shown = false;
  globalThis.showConfirmModal = () => { shown = true; };

  BackupManager.maybePromptBackup();

  assert.equal(shown, false, 'reminder toggle respected');
});

await test('(k) first-run tour active → no prompt', async () => {
  freshReminderState();
  State.CONFIG.first_run = true;
  let shown = false;
  globalThis.showConfirmModal = () => { shown = true; };

  BackupManager.maybePromptBackup();

  assert.equal(shown, false, 'suppressed during first-run');
});

await test('(l) prompted within window → no repeat nag', async () => {
  freshReminderState();
  State.CONFIG.last_backup_prompt = Date.now() - 60 * 60 * 1000; // 1h ago
  let shown = false;
  globalThis.showConfirmModal = () => { shown = true; };

  BackupManager.maybePromptBackup();

  assert.equal(shown, false, 'one nudge per window');
});

await test('(m) EXPORT NOW → triggerBackup(auto) downloads local JSON', async () => {
  freshReminderState();
  let mode = null;
  let confirmed = false;
  BackupManager.triggerBackup = (m) => { mode = m; confirmed = true; };
  globalThis.showConfirmModal = (t, m, onConfirm) => onConfirm();

  BackupManager.maybePromptBackup();

  assert.equal(confirmed, true, 'EXPORT NOW fires the backup');
  assert.equal(mode, 'auto', 'local download path (not Drive push)');
  BackupManager.triggerBackup = _realTriggerBackup; // restore shared module
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
