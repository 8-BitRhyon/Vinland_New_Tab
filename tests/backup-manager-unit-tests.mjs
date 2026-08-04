

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
console.log('\n─── Encryption at rest (AES-GCM + PBKDF2) ───');

function freshEncState() {
  Object.assign(State.CONFIG, {
    backup_encryption_enabled: true,
  });
  BackupManager.clearPassphrase();
}

await test('(n) encryptBackup → envelope, decryptBackup → original roundtrip', async () => {
  freshEncState();
  BackupManager.setPassphrase('test-pass-1234');
  const original = '{"notes":[{"id":"n1","title":"secret"}]}';

  const envelope = await new Promise((res) => BackupManager.encryptBackup(original, (env) => res(env)));
  assert.ok(envelope, 'envelope produced');
  assert.ok(envelope.includes('vinland-enc-v1'), 'marker present');
  assert.ok(!envelope.includes('secret'), 'plaintext not leaked into envelope');

  const decrypted = await new Promise((res) => BackupManager.decryptBackup(envelope, (plain) => res(plain)));
  assert.equal(decrypted, original, 'roundtrip matches');
});

await test('(o) wrong passphrase → passphrase_wrong error', async () => {
  freshEncState();
  BackupManager.setPassphrase('correct-pass');
  const envelope = await new Promise((res) => BackupManager.encryptBackup('{"a":1}', (env) => res(env)));

  BackupManager.clearPassphrase();
  BackupManager.setPassphrase('wrong-pass!!');
  const result = await new Promise((res) => BackupManager.decryptBackup(envelope, (p, e, code) => res({ p, code })));
  assert.equal(result.p, null, 'no plaintext on wrong passphrase');
  assert.equal(result.code, 'passphrase_wrong', 'auth-tag mismatch classified');
});

await test('(p) plaintext JSON passes through unchanged (no envelope)', async () => {
  freshEncState();
  BackupManager.clearPassphrase();
  const plain = '{"tasks":[],"notes":[]}';
  const result = await new Promise((res) => BackupManager.decryptBackup(plain, (p, e, code) => res({ p, code })));
  assert.equal(result.p, plain, 'plaintext passthrough');
  assert.equal(result.code, null, 'no error');
});

await test('(q) encrypted payload without stored passphrase → passphrase_required', async () => {
  freshEncState();
  BackupManager.setPassphrase('saved-pass-1');
  const envelope = await new Promise((res) => BackupManager.encryptBackup('{"b":2}', (env) => res(env)));
  BackupManager.clearPassphrase(); // drop it — restore on another device

  const result = await new Promise((res) => BackupManager.decryptBackup(envelope, (p, e, code) => res({ p, code })));
  assert.equal(result.p, null, 'no plaintext without passphrase');
  assert.equal(result.code, 'passphrase_required', 'user asked to set passphrase');
  BackupManager.clearPassphrase();
});

await test('(q2) plaintext JSON containing the marker string passes through', async () => {
  // Regression guard for the substring-detection false positive: a plaintext
  // backup whose content mentions the marker must NOT be treated as an envelope.
  freshEncState();
  BackupManager.clearPassphrase();
  const plain = JSON.stringify({
    notes: [{ id: 'n9', content: 'note mentioning vinland-enc-v1 inside a body' }],
    tasks: [],
  });
  const result = await new Promise((res) => BackupManager.decryptBackup(plain, (p, e, code) => res({ p, code })));
  assert.equal(result.p, plain, 'plaintext preserved');
  assert.equal(result.code, null, 'no error');
});

await test('(q3) malformed envelope → invalid (caller never hangs)', async () => {
  freshEncState();
  BackupManager.setPassphrase('some-pass');
  const bad = JSON.stringify({ marker: 'vinland-enc-v1', salt: '!!not-base64!!', iv: 'x', ct: 'y' });
  const result = await new Promise((res) => BackupManager.decryptBackup(bad, (p, e, code) => res({ p, code })));
  assert.equal(result.p, null, 'no plaintext');
  assert.equal(result.code, 'invalid', 'malformed envelope classified invalid');
});

await test('(q4) decrypt uses envelope.iterations (not the module constant)', async () => {
  freshEncState();
  BackupManager.setPassphrase('iter-test-pass');

  // Force a non-default iteration count at ENCRYPT time (simulates a backup
  // created by an older/future build), so envelope.iterations carries a value
  // that differs from ENCRYPTION_ITERATIONS while matching the ciphertext.
  const realEncrypt = BackupManager._encryptAesGcm.bind(BackupManager);
  BackupManager._encryptAesGcm = (text, pass) => realEncrypt(text, pass, 12345);
  const envelope = await new Promise((res) => BackupManager.encryptBackup('{"x":1}', (env) => res(env)));
  BackupManager._encryptAesGcm = realEncrypt; // restore before decrypt
  const parsed = JSON.parse(envelope);
  assert.equal(parsed.iterations, 12345, 'envelope records the actual iteration count');

  // Decrypt WITHOUT any spy: _decryptAesGcm must read envelope.iterations and
  // re-derive with 12345, not the 150000 constant — otherwise the key would
  // mismatch the ciphertext and decrypt would fail.
  const ok = await new Promise((res) => BackupManager.decryptBackup(envelope, (p) => res(p)));
  assert.equal(ok, '{"x":1}', 'decrypt succeeds using the envelope iteration count');
});

// ============================================================
console.log('\n─── Diff-aware scheduled pull ───');

await test('(r) merge adds remote-only entities', async () => {
  State.NOTES = [{ id: 'n1', title: 'local', modified: 100 }];
  State.TASKS = [{ text: 'local task' }];
  State.BOARDS = [{ id: 'b1', title: 'local board', modified: 100 }];
  const summary = BackupManager._mergeRemoteData({
    notes: [{ id: 'n2', title: 'remote new', modified: 200 }],
    tasks: [{ text: 'remote task' }],
    boards: [{ id: 'b2', title: 'remote board', modified: 200 }],
  });
  assert.equal(summary.notes, 1, 'remote note added');
  assert.equal(summary.tasks, 1, 'remote task added');
  assert.equal(summary.boards, 1, 'remote board added');
  assert.equal(summary.changed, true);
  assert.equal(State.NOTES.length, 2, 'local kept + remote added');
});

await test('(s) merge: newer modified wins, older remote is skipped', async () => {
  State.NOTES = [{ id: 'n1', title: 'local-newer', modified: 300 }];
  const summary = BackupManager._mergeRemoteData({
    notes: [{ id: 'n1', title: 'remote-older', modified: 100 }],
  });
  assert.equal(summary.notes, 0, 'older remote does not clobber');
  assert.equal(State.NOTES[0].title, 'local-newer', 'local kept');
});

await test('(t) merge: newer remote replaces local', async () => {
  State.NOTES = [{ id: 'n1', title: 'local-older', modified: 100 }];
  const summary = BackupManager._mergeRemoteData({
    notes: [{ id: 'n1', title: 'remote-newer', modified: 400 }],
  });
  assert.equal(summary.notes, 1, 'remote newer replaces');
  assert.equal(State.NOTES[0].title, 'remote-newer', 'remote content adopted');
});

await test('(u) merge: no id/timestamp → unchanged, no clobber', async () => {
  State.NOTES = [{ title: 'no-id-local' }];
  const summary = BackupManager._mergeRemoteData({
    notes: [{ title: 'no-id-remote' }], // no id → skipped by _mergeById
  });
  assert.equal(summary.notes, 0, 'unkeyable entities skipped');
  assert.equal(State.NOTES.length, 1, 'local untouched');
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
