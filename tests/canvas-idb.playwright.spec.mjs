/**
 * Vinland Canvas IndexedDB offload - Playwright Integration Test
 *
 * Regression guard for the canvas-storage-quota limitation: large canvas data
 * was previously serialized directly into the per-note localStorage shard and
 * could blow the 5 MB budget. Now `note.canvasData` is mirrored to IndexedDB
 * (`OPERATOR_VAULT`/`media_assets`, key `vinland_canvas_<id>`); the localStorage
 * shard keeps only a lightweight `{ _external: true }` marker.
 *
 * This asserts two things:
 *   (A) after adding nodes, the localStorage shard carries the marker and NOT
 *       the node payload (offload worked);
 *   (B) after a reload, the canvas rehydrates from IndexedDB (round-trip).
 *
 * Run with:
 *   npx playwright test tests/canvas-idb.playwright.spec.mjs
 */

import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:9999';
const NODE_COUNT = 5;

async function runCLI(page, command) {
  const cmdInput = page.locator('#cmd-input');
  await cmdInput.waitFor({ state: 'visible', timeout: 10000 });
  await cmdInput.fill(command);
  await cmdInput.press('Enter');
  await page.waitForTimeout(500);
}

async function createCanvas(page) {
  // The canvas is created via the slash menu inside a note editor, not the
  // global CLI. Open a host note, then trigger the /canvas slash command.
  await runCLI(page, 'note CanvasHost');
  const editor = page.locator('#note-editor-modal');
  await editor.waitFor({ state: 'visible', timeout: 8000 });

  await editor.locator('.block-drag-handle').first().click();
  const canvasItem = page.locator('.slash-item[data-cmd="canvas"]');
  await expect(canvasItem).toBeVisible({ timeout: 5000 });
  await canvasItem.click();

  await expect(page.locator('#canvas-container')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#canvas-add-node')).toBeVisible({ timeout: 8000 });
  return page.evaluate(() => {
    const note = window.State.NOTES.find((n) => n.type === 'canvas');
    return note ? note.id : null;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith('OPERATOR_NOTE_') ||
      k === 'OPERATOR_NOTES_INDEX' ||
      k.startsWith('OPERATOR_BOARDS_') ||
      k.startsWith('vinland_canvas_')
    );
    keys.forEach((k) => localStorage.removeItem(k));
    if (window.ModalManager) window.ModalManager.closeAll();
    if (window.State && window.State.CONFIG) window.State.CONFIG.first_run = false;
    if (window.State) window.State.NOTES.length = 0;
  });
  await page.waitForTimeout(300);
});

test('canvas payload is offloaded to IndexedDB, not localStorage', async ({ page }) => {
  const canvasId = await createCanvas(page);
  expect(canvasId).toBeTruthy();

  // Add NODE_COUNT nodes via the toolbar + NODE button.
  for (let i = 0; i < NODE_COUNT; i++) {
    await page.locator('#canvas-add-node').click();
    await page.waitForTimeout(150);
  }

  // (A) The localStorage shard must carry the marker and NOT the node payload.
  const shard = await page.evaluate((id) => {
    const raw = localStorage.getItem('OPERATOR_NOTE_' + id);
    if (!raw) return null;
    const note = JSON.parse(raw);
    return { raw, canvasData: note.canvasData };
  }, canvasId);

  expect(shard).not.toBeNull();
  expect(shard.canvasData && shard.canvasData._external).toBe(true);
  // The node id prefix must NOT appear in the on-disk shard.
  expect(shard.raw.includes('node_')).toBe(false);

  // (B) Round-trip: reload, then the in-memory note rehydrates from IndexedDB.
  await page.reload();
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  await page.waitForFunction((args) => {
    const note = window.State.NOTES.find((n) => n.id === args.id);
    return note && note.canvasData && note.canvasData.nodes && note.canvasData.nodes.length === args.count;
  }, { id: canvasId, count: NODE_COUNT }, { timeout: 8000 });

  const reloadedNodes = await page.evaluate((id) => {
    const note = window.State.NOTES.find((n) => n.id === id);
    return note.canvasData.nodes.length;
  }, canvasId);
  expect(reloadedNodes).toBe(NODE_COUNT);
});
