/**
 * Vinland AttachmentsManager - Unit Tests
 *
 * Tests the REAL js/core/AttachmentsManager.js against the REAL
 * js/core/Storage.js DB with a stubbed IndexedDB layer (in-memory Map).
 * No copied extracts - tests cannot drift from source.
 *
 * Run with: node tests/attachments-unit-tests.mjs
 * (aggregated by tests/run-all.mjs)
 */

import assert from 'node:assert/strict';

// ------------------------------------------------------------
// Globals shims (must exist before importing Storage.js/AttachmentsManager.js)
// ------------------------------------------------------------
const localStorageShim = (() => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    has: (k) => store.has(k),
    raw: (k) => store.get(k),
  };
})();

globalThis.localStorage = localStorageShim;
globalThis.document = { getElementById: () => null, createElement: () => null };
globalThis.window = { addEventListener: () => {} };

// URL object-URL shim (indexed counter for uniqueness)
let urlCounter = 0;
const revokedUrls = [];
globalThis.URL = {
  createObjectURL: () => `blob:fake-${++urlCounter}`,
  revokeObjectURL: (url) => revokedUrls.push(url),
};

// FileReader shim - resolves onload like the real API
function fileBytes(file) {
  return typeof file._bytes === 'string'
    ? new TextEncoder().encode(file._bytes)
    : file._bytes;
}
globalThis.FileReader = class {
  onload = null;
  onerror = null;
  readAsArrayBuffer(file) {
    Promise.resolve(fileBytes(file)).then((buf) => {
      this.onload && this.onload({ target: { result: buf.buffer || buf } });
    });
  }
  readAsDataURL(file) {
    Promise.resolve(fileBytes(file)).then((buf) => {
      const b64 = Buffer.from(buf).toString('base64');
      const type = file.type || 'application/octet-stream';
      this.onload && this.onload({ target: { result: `data:${type};base64,${b64}` } });
    });
  }
};

// ------------------------------------------------------------
// Import REAL modules + stub the IndexedDB layer
// ------------------------------------------------------------
const { AttachmentsManager } = await import('../js/core/AttachmentsManager.js');
const { DB } = await import('../js/core/Storage.js');

const idbStore = new Map();
DB.save = async (k, v) => { idbStore.set(k, v); };
DB.get = async (k) => (idbStore.has(k) ? idbStore.get(k) : null);
DB.delete = async (k) => { idbStore.delete(k); };

// ------------------------------------------------------------
// Test runner
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

function fresh() {
  localStorageShim.clear();
  idbStore.clear();
  revokedUrls.length = 0;
}

function fakeFile(name, type, bytes) {
  return { name, type, size: bytes.length, _bytes: bytes };
}

// ============================================================
console.log('\n─── AttachmentsManager: index & metadata ───');

test('(a) _getIndex returns [] when empty or malformed', () => {
  fresh();
  assert.deepEqual(AttachmentsManager._getIndex(), [], 'empty index');
  localStorageShim.setItem('VINLAND_ATTACHMENTS_INDEX', '{ not json');
  assert.deepEqual(AttachmentsManager._getIndex(), [], 'malformed index');
});

test('(b) _saveIndex persists round-trip via _getIndex', () => {
  fresh();
  AttachmentsManager._saveIndex([{ id: 'att_1', name: 'a.png' }]);
  assert.deepEqual(AttachmentsManager._getIndex(), [{ id: 'att_1', name: 'a.png' }]);
});

test('(c) list() mirrors the persisted index', () => {
  fresh();
  AttachmentsManager._saveIndex([{ id: 'att_1', name: 'a.png' }]);
  assert.equal(AttachmentsManager.list().length, 1);
});

test('(d) listImages() filters only isImage entries', () => {
  fresh();
  AttachmentsManager._saveIndex([
    { id: 'att_1', name: 'a.png', isImage: true },
    { id: 'att_2', name: 'b.pdf', isImage: false },
  ]);
  const images = AttachmentsManager.listImages();
  assert.equal(images.length, 1);
  assert.equal(images[0].id, 'att_1');
});

test('(e) getMeta() finds by id, null when missing', () => {
  fresh();
  AttachmentsManager._saveIndex([{ id: 'att_1', name: 'a.png' }]);
  assert.equal(AttachmentsManager.getMeta('att_1').name, 'a.png');
  assert.equal(AttachmentsManager.getMeta('nope'), null);
});

test('(f) getTotalSize() sums sizes, tolerates missing size', () => {
  fresh();
  AttachmentsManager._saveIndex([
    { id: 'att_1', size: 100 },
    { id: 'att_2', size: 250 },
    { id: 'att_3' },
  ]);
  assert.equal(AttachmentsManager.getTotalSize(), 350);
});

// ============================================================
console.log('\n─── AttachmentsManager: upload & blob flow ───');

test('(g) upload stores blob in IDB + metadata in index (att_ prefix)', async () => {
  fresh();
  const file = fakeFile('pic.png', 'image/png', new TextEncoder().encode('PNGDATA'));
  const id = await AttachmentsManager.upload(file);
  assert.ok(id.startsWith('att_'), 'id should have att_ prefix');
  assert.ok(idbStore.has(id), 'blob not stored in IDB');
  assert.equal(idbStore.get(id).type, 'image/png', 'blob type wrong');
  const meta = AttachmentsManager.getMeta(id);
  assert.equal(meta.name, 'pic.png');
  assert.equal(meta.isImage, true);
  assert.equal(meta.size, 7);
});

test('(h) upload merges extraMeta into the metadata entry', async () => {
  fresh();
  const file = fakeFile('doc.txt', 'text/plain', new TextEncoder().encode('hello'));
  const id = await AttachmentsManager.upload(file, { source: 'attachment-browser' });
  assert.equal(AttachmentsManager.getMeta(id).source, 'attachment-browser');
  assert.equal(AttachmentsManager.getMeta(id).isImage, false);
});

test('(i) getBlob normalizes att_ prefix and returns stored blob', async () => {
  fresh();
  const file = fakeFile('f.pdf', 'application/pdf', new TextEncoder().encode('PDF'));
  const id = await AttachmentsManager.upload(file);
  // Without prefix
  const blob = await AttachmentsManager.getBlob(id.replace('att_', ''));
  assert.ok(blob, 'blob missing');
  assert.equal(blob.type, 'application/pdf');
  // With prefix
  const blob2 = await AttachmentsManager.getBlob(id);
  assert.ok(blob2, 'prefixed lookup failed');
});

test('(j) getBlob resolves null for unknown / empty keys', async () => {
  fresh();
  assert.equal(await AttachmentsManager.getBlob('att_missing'), null);
  assert.equal(await AttachmentsManager.getBlob('att_'), null);
  assert.equal(await AttachmentsManager.getBlob(''), null);
});

test('(k) getURL caches object URL for repeat calls', async () => {
  fresh();
  const file = fakeFile('x.png', 'image/png', new TextEncoder().encode('X'));
  const id = await AttachmentsManager.upload(file);
  const url1 = await AttachmentsManager.getURL(id);
  const url2 = await AttachmentsManager.getURL(id);
  assert.equal(url1, url2, 'object URL should be cached');
  assert.ok(url1.startsWith('blob:'));
});

test('(l) revokeURL removes the cached object URL', async () => {
  fresh();
  const file = fakeFile('x.png', 'image/png', new TextEncoder().encode('X'));
  const id = await AttachmentsManager.upload(file);
  await AttachmentsManager.getURL(id);
  AttachmentsManager.revokeURL(id);
  assert.equal(revokedUrls.length, 1, 'revokeObjectURL not called');
  const url = await AttachmentsManager.getURL(id);
  assert.ok(url.startsWith('blob:'), 'URL should be re-created after revoke');
});

test('(m) delete removes blob from IDB + entry from index + revokes URL', async () => {
  fresh();
  const file = fakeFile('gone.pdf', 'application/pdf', new TextEncoder().encode('P'));
  const id = await AttachmentsManager.upload(file);
  await AttachmentsManager.getURL(id);
  await AttachmentsManager.delete(id);
  assert.ok(!idbStore.has(id), 'blob not deleted from IDB');
  assert.equal(AttachmentsManager.getMeta(id), null, 'index entry not removed');
  assert.equal(revokedUrls.length, 1, 'object URL not revoked on delete');
  assert.equal(AttachmentsManager.list().length, 0);
});

test('(n2) getDataURL returns a data URL for embedded blocks', async () => {
  fresh();
  const file = fakeFile('embed.png', 'image/png', new TextEncoder().encode('PNG'));
  const id = await AttachmentsManager.upload(file);
  const dataUrl = await AttachmentsManager.getDataURL(id);
  assert.ok(dataUrl && dataUrl.startsWith('data:image/png;base64,'), 'data URL wrong format');
  assert.equal(await AttachmentsManager.getDataURL('att_missing'), null, 'missing should resolve null');
});

test('(n) getThumbnailURL falls back to getURL for non-images', async () => {
  fresh();
  const file = fakeFile('note.txt', 'text/plain', new TextEncoder().encode('hi'));
  const id = await AttachmentsManager.upload(file);
  const url = await AttachmentsManager.getThumbnailURL(id);
  assert.ok(url && url.startsWith('blob:'), 'non-image should resolve via getURL');
});

// ============================================================
console.log('\n─── AttachmentsManager: pure helpers ───');

test('(o) _formatSize handles B/KB/MB', () => {
  assert.equal(AttachmentsManager._formatSize(0), '0 B');
  assert.equal(AttachmentsManager._formatSize(512), '512 B');
  assert.equal(AttachmentsManager._formatSize(2048), '2.0 KB');
  assert.equal(AttachmentsManager._formatSize(1048576), '1.0 MB');
  assert.equal(AttachmentsManager._formatSize(5242880), '5.0 MB');
});

test('(p) _getFileIcon maps mime types to icons', () => {
  assert.equal(AttachmentsManager._getFileIcon('application/pdf'), '📄');
  assert.equal(AttachmentsManager._getFileIcon('text/plain'), '📝');
  assert.equal(AttachmentsManager._getFileIcon('audio/mpeg'), '🎵');
  assert.equal(AttachmentsManager._getFileIcon('video/mp4'), '🎬');
  assert.equal(AttachmentsManager._getFileIcon('application/zip'), '📦');
  assert.equal(AttachmentsManager._getFileIcon('application/octet-stream'), '📎');
});

test('(q) init() is idempotent and wires beforeunload cleanup', () => {
  fresh();
  let listeners = 0;
  globalThis.window = {
    addEventListener: (ev) => { if (ev === 'beforeunload') listeners++; },
  };
  AttachmentsManager.init();
  AttachmentsManager.init();
  assert.equal(listeners, 1, 'init should only register the listener once');
});

// ============================================================
console.log('\n══════════════════════════════════════════════════');
console.log(`  ATTACHMENTS SUITE: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');

if (errors.length > 0) {
  console.log('FAILURES:');
  errors.forEach((e) => console.log(`  • ${e.name}: ${e.error}`));
  console.log('');
}

process.exit(failed > 0 ? 1 : 0);
