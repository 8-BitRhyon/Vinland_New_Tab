/**
 * Vinland Release-Candidate Smoke — Real Chrome Extension Context
 *
 * Unlike every other spec (which runs against the plain-HTTP page at
 * 127.0.0.1:9999), THIS spec launches the actual unpacked extension in a
 * persistent Chromium profile and drives the REAL chrome-extension:// page.
 *
 * It is the only test that proves the extension-context APIs exist and work:
 *   - chrome.identity / chrome.storage are present
 *   - the MV3 service worker boots
 *   - the new-tab override actually renders from the extension origin
 *   - a full user journey: note → block editor → canvas → tasks → quick-open
 *     search → settings → sync tab → backup → reload persistence
 *
 * Because it boots the extension it is slower than the HTTP specs, so it runs
 * in its OWN CI job (release-candidate) and is excluded from the sharded E2E
 * matrix via `--grep-invert "Release Candidate"`.
 *
 * Run locally with:
 *   npx playwright test tests/release-candidate.playwright.spec.mjs
 */

import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// The extension IS the repo root (tests/ is one level down).
const EXTENSION_PATH = fileURLToPath(new URL('..', import.meta.url));

test.setTimeout(120000);

// ──────────────────────────────────────────
// Extension fixtures — one persistent profile
// ──────────────────────────────────────────

let pageErrors = [];
let consoleErrors = [];
let failedRequests = [];

const ext = test.extend({
  // Test-scoped persistent profile: a FRESH unpacked extension boot per test.
  // Playwright's built-in `context` fixture is test-scoped and cannot be
  // re-registered at worker scope, so this follows the official
  // Playwright extension-testing pattern (fresh profile per test = stronger
  // isolation). resetState() additionally clears app state after each boot.
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      acceptDownloads: true,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });      // Watch every page this context opens (including the new-tab override).
      context.on('page', (p) => {
        p.on('pageerror', (e) => pageErrors.push(e.message));
        p.on('console', (m) => {
          if (m.type() === 'error') consoleErrors.push(m.text());
        });
        // Chrome's console message for a failed resource load is URL-less, so
        // log failed requests explicitly — without this, a new 404 would fail
        // the gate with zero debugging signal.
        p.on('requestfailed', (r) => {
          const err = r.failure() ? r.failure().errorText : 'unknown';
          failedRequests.push(`${r.url()} -> ${err}`);
        });
      });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = new URL(sw.url()).hostname;
    await use(extensionId);
  },

  page: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`, { timeout: 30000 });
    await page.waitForSelector('#cmd-input', { timeout: 20000 });
    await use(page);
    await page.close();
  },
});

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

async function runCLI(page, command) {
  const cmdInput = page.locator('#cmd-input');
  await cmdInput.waitFor({ state: 'visible', timeout: 10000 });
  await cmdInput.fill(command);
  await cmdInput.press('Enter');
  await page.waitForTimeout(500);
}

async function waitForEditor(page) {
  const editor = page.locator('#note-editor-modal');
  await editor.waitFor({ state: 'visible', timeout: 10000 });
  return editor;
}

async function closeEditor(page) {
  const closeBtn = page.locator('#note-editor-close');
  await closeBtn.waitFor({ state: 'visible', timeout: 5000 });
  await closeBtn.click();
  await page.waitForTimeout(400);
}

function getFirstBlock(page) {
  return page.locator('#block-editor .block-wrapper').first()
    .locator('[contenteditable="true"]').first();
}

/** Reset data + UI to a clean first-run-like state for each journey test. */
async function resetState(page) {
  await page.evaluate(() => {
    try {
      if (window.ModalManager && window.ModalManager.closeAll) window.ModalManager.closeAll();
      if (window.ModalManager && window.ModalManager.close) window.ModalManager.close('welcome-modal');
    } catch { /* ignore */ }
    try {
      const keys = Object.keys(localStorage).filter((k) =>
        k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX' ||
        k.startsWith('VINLAND_') || k === 'OPERATOR_CONFIG_V3'
      );
      keys.forEach((k) => localStorage.removeItem(k));
      if (window.State) {
        if (Array.isArray(window.State.NOTES)) window.State.NOTES.length = 0;
        if (Array.isArray(window.State.TASKS)) window.State.TASKS.length = 0;
        if (Array.isArray(window.State.BOARDS)) window.State.BOARDS.length = 0;
        if (Array.isArray(window.State.CANVASES)) window.State.CANVASES.length = 0;
        if (window.State.CONFIG) {
          // Do NOT force first_run=true — boot.js opens the welcome modal on
          // first-run, which would cover the UI on the reload test.
          window.State.CONFIG.auto_backup_interval = 0;
        }
      }
    } catch { /* ignore */ }
  });
  await page.waitForTimeout(300);
}

// ══════════════════════════════════════════
// 1. Boot — the real extension context works
// ══════════════════════════════════════════

ext('Release Candidate: boot — MV3 service worker + extension APIs + zero uncaught errors', async ({ context, extensionId }) => {
  // A fresh page so this test owns its own error snapshot (the shared fixture
  // page and later tests accumulate history into the module-level arrays).
  // Error listeners attach via the worker-scoped context.on('page') hook — no
  // manual listeners here (avoids double-counting).
  const baselineErrors = pageErrors.length;
  const baselineConsole = consoleErrors.length;
  const baselineFailed = failedRequests.length;

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`, { timeout: 30000 });
  await page.waitForSelector('#cmd-input', { timeout: 20000 });

  // The new-tab override renders from the extension origin.
  expect(page.url()).toMatch(/^chrome-extension:\/\/[a-p]{32}\/index\.html/);
  await expect(page.locator('#cmd-input')).toBeVisible();

  // Extension-context APIs that plain-HTTP E2E can NEVER see.
  const apiCheck = await page.evaluate(() => ({
    hasChrome: typeof window.chrome !== 'undefined',
    hasIdentity: !!(window.chrome && window.chrome.identity),
    hasStorage: !!(window.chrome && window.chrome.storage && window.chrome.storage.local),
    hasRuntime: !!(window.chrome && window.chrome.runtime && window.chrome.runtime.id),
    runtimeId: (window.chrome && window.chrome.runtime && window.chrome.runtime.id) || null,
    hasCmdInput: !!document.getElementById('cmd-input'),
  }));
  expect(apiCheck.hasChrome, 'window.chrome must exist in extension context').toBe(true);
  expect(apiCheck.hasIdentity, 'chrome.identity must exist (Drive sync needs it)').toBe(true);
  expect(apiCheck.hasStorage, 'chrome.storage must exist').toBe(true);
  expect(apiCheck.hasRuntime, 'chrome.runtime must exist').toBe(true);
  expect(apiCheck.runtimeId, 'chrome.runtime.id should match the loaded extension').toBe(extensionId);
  expect(apiCheck.hasCmdInput).toBe(true);

  // No uncaught JS exceptions on boot.
  const newErrors = pageErrors.slice(baselineErrors);
  expect(newErrors, 'boot must not throw uncaught page errors').toEqual([]);

  // Console errors must be empty. Chrome's message for a failed resource load
  // is the URL-less 'Failed to load resource: net::ERR_FILE_NOT_FOUND', so a
  // strict zero-error assertion is the only reliable gate — any 404 on boot is
  // a release blocker (this gate caught the missing background.mp4 request in
  // SettingsUI.initBackground, now fixed).
  const newConsole = consoleErrors.slice(baselineConsole);
  expect(newConsole, `console errors on boot: ${JSON.stringify(newConsole)}`).toEqual([]);

  const newFailed = failedRequests.slice(baselineFailed);
  expect(newFailed, `failed resource requests on boot: ${JSON.stringify(newFailed)}`).toEqual([]);

  await page.close();
});

// ══════════════════════════════════════════
// 2. Note lifecycle — real extension storage
// ══════════════════════════════════════════

ext('Release Candidate: note lifecycle persists in real extension storage', async ({ page }) => {
  await resetState(page);

  await runCLI(page, 'note RC Smoke Note');
  await waitForEditor(page);
  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();
  await block.fill('Release candidate content');
  await page.waitForTimeout(1500); // auto-save debounce
  await closeEditor(page);

  // Reopen by title through the real Notes API.
  const opened = await page.evaluate((t) =>
    window.Notes && window.Notes.openByTitle ? window.Notes.openByTitle(t) : false,
    'RC Smoke Note',
  );
  expect(opened).toBe(true);
  await page.waitForTimeout(500);
  await expect(getFirstBlock(page)).toContainText('Release candidate content', { timeout: 5000 });
  await closeEditor(page);

  // Persisted in the extension's localStorage, not just in memory.
  const persisted = await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find((n) => n.title === 'RC Smoke Note');
    return {
      count: window.State?.NOTES?.length ?? 0,
      hasNote: !!note,
      content: note ? note.content : null,
    };
  });
  expect(persisted.hasNote).toBe(true);
  expect(persisted.content).toContain('Release candidate content');
});

// ══════════════════════════════════════════
// 3. Canvas — board renders in extension context
// ══════════════════════════════════════════

ext('Release Candidate: canvas board renders and holds a node', async ({ page }) => {
  await resetState(page);

  await runCLI(page, 'canvas');
  const container = page.locator('#canvas-container');
  await container.waitFor({ state: 'visible', timeout: 15000 });

  // CanvasManager initialized: canvasData exists on the canvas note.
  const canvasOk = await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find((n) => n.type === 'canvas');
    return {
      found: !!note,
      hasData: !!(note && note.canvasData && Array.isArray(note.canvasData.nodes)),
      nodeCount: note && note.canvasData ? (note.canvasData.nodes || []).length : 0,
    };
  });
  expect(canvasOk.found, 'canvas CLI must create a canvas-type note').toBe(true);
  expect(canvasOk.hasData, 'canvas note must carry canvasData').toBe(true);
});

// ══════════════════════════════════════════
// 4. Tasks
// ══════════════════════════════════════════

ext('Release Candidate: task CLI appends to mission list', async ({ page }) => {
  await resetState(page);

  await runCLI(page, 'task SweepTask');
  const missionList = page.locator('#mission-list');
  await expect(missionList).toContainText('SweepTask', { timeout: 8000 });

  const taskCount = await page.evaluate(() => (window.State?.TASKS ?? []).length);
  expect(taskCount).toBeGreaterThan(0);
});

// ══════════════════════════════════════════
// 5. Quick-Open search finds the created note
// ══════════════════════════════════════════

ext('Release Candidate: quick-open search finds a note', async ({ page }) => {
  await resetState(page);

  await runCLI(page, 'note RC Search Note');
  await waitForEditor(page);
  await closeEditor(page);

  await page.keyboard.press('Meta+p'); // Cmd+P — quick open
  const overlay = page.locator('#quick-open-overlay');
  await overlay.waitFor({ state: 'visible', timeout: 8000 });

  const input = page.locator('#quick-open-input');
  await input.fill('RC Search');
  const results = page.locator('#quick-open-results');
  await expect(results).toContainText('RC Search Note', { timeout: 8000 });
});

// ══════════════════════════════════════════
// 6. Settings → SYNC tab → fail-fast guard + backup
// ══════════════════════════════════════════

ext('Release Candidate: settings sync tab renders, Drive guard fires, backup works', async ({ page }) => {
  await resetState(page);

  await page.locator('#config-btn').click();
  const modal = page.locator('#config-modal');
  await modal.waitFor({ state: 'visible', timeout: 8000 });

  await page.locator(".config-nav-item[data-tab='sync']").click();
  await expect(page.locator('#drive-connect-btn')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#sync-backup-now-btn')).toBeVisible();

  // Placeholder client ID → the fail-fast guard must toast an actionable message.
  await page.locator('#drive-connect-btn').click();
  const toast = page.locator('#notif-toast');
  await toast.waitFor({ state: 'visible', timeout: 8000 });
  const toastText = (await toast.textContent()) || '';
  expect(toastText, `fail-fast toast expected, got: "${toastText}"`).toMatch(/client/i);

  // BACKUP NOW — real BackupManager path in extension context.
  const lastBackupBefore = await page.evaluate(() => window.State?.CONFIG?.last_backup_time ?? null);
  await page.locator('#sync-backup-now-btn').click();
  await expect
    .poll(async () => page.evaluate(() => window.State?.CONFIG?.last_backup_time ?? null), { timeout: 8000 })
    .not.toBe(lastBackupBefore);
});

// ══════════════════════════════════════════
// 7. Persistence across reload
// ══════════════════════════════════════════

ext('Release Candidate: notes survive a full page reload', async ({ page }) => {
  await resetState(page);

  await runCLI(page, 'note RC Persist Note');
  await waitForEditor(page);
  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();
  await block.fill('Reload survives');
  await page.waitForTimeout(1500);
  await closeEditor(page);

  await page.reload();
  await page.waitForSelector('#cmd-input', { timeout: 20000 });
  await page.waitForTimeout(800);

  // Close any first-run welcome modal that appeared after the reload so the
  // subsequent evaluate + sidebar reads are occlusion-free.
  await page.evaluate(() => {
    try {
      if (window.ModalManager && window.ModalManager.closeAll) window.ModalManager.closeAll();
    } catch { /* ignore */ }
  });

  const after = await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find((n) => n.title === 'RC Persist Note');
    return { hasNote: !!note, content: note ? note.content : null };
  });
  expect(after.hasNote, 'note must survive reload in extension storage').toBe(true);
  expect(after.content).toContain('Reload survives');
});
