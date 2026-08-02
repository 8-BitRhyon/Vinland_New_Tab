

import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:9999';

async function runCLI(page, command) {
  const cmdInput = page.locator('#cmd-input');
  await cmdInput.waitFor({ state: 'visible', timeout: 10000 });
  await cmdInput.fill(command);
  await cmdInput.press('Enter');
  await page.waitForTimeout(500);
}

async function createCanvas(page) {
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
    Object.keys(localStorage)
      .filter((k) => k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX' ||
                     k.startsWith('OPERATOR_BOARDS_') || k.startsWith('vinland_canvas_'))
      .forEach((k) => localStorage.removeItem(k));
    if (window.ModalManager) window.ModalManager.closeAll();
    if (window.State && window.State.CONFIG) window.State.CONFIG.first_run = false;
    if (window.State) window.State.NOTES.length = 0;
  });
  await page.waitForTimeout(300);
});

test('typing a wiki-link auto-creates a file node + edge and persists', async ({ page }) => {
  // Target note must exist before the wiki-link is typed.
  await runCLI(page, 'note Target Note');
  const targetId = await page.evaluate(() => {
    const n = window.State.NOTES.find((x) => x.title === 'Target Note');
    return n ? n.id : null;
  });
  expect(targetId).toBeTruthy();

  const canvasId = await createCanvas(page);

  // Add one text node, then type a wiki-link into its body.
  await page.locator('#canvas-add-node').click();
  await page.waitForTimeout(200);

  const textNodeId = await page.evaluate((cid) => {
    const note = window.State.NOTES.find((n) => n.id === cid);
    const text = note.canvasData.nodes.find((nd) => nd.type !== 'file');
    return text ? text.id : null;
  }, canvasId);
  expect(textNodeId).toBeTruthy();

  const body = page.locator(`#canvas-node-${textNodeId} .canvas-card-body`);
  await body.click();
  await page.keyboard.insertText('[[Target Note]]');
  await body.blur();
  await page.waitForTimeout(300);

  // A file node + wiki edge should now exist.
  const routed = await page.evaluate((args) => {
    const note = window.State.NOTES.find((n) => n.id === args.canvasId);
    const fileNode = note.canvasData.nodes.find((nd) => nd.type === 'file' && nd.linkedNoteId === args.targetId);
    const edge = note.canvasData.edges.find((e) => e.fromNode === args.textNodeId && fileNode && e.toNode === fileNode.id);
    return { hasFile: !!fileNode, hasEdge: !!edge, isWiki: edge ? edge.isWikiLink === true : false };
  }, { canvasId, targetId, textNodeId });
  expect(routed.hasFile).toBe(true);
  expect(routed.hasEdge).toBe(true);
  expect(routed.isWiki).toBe(true);

  // Round-trip: reload and confirm the file node + edge survived.
  await page.reload();
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction((args) => {
    const note = window.State.NOTES.find((n) => n.id === args.canvasId);
    if (!note || !note.canvasData) return false;
    const fileNode = note.canvasData.nodes.find((nd) => nd.type === 'file' && nd.linkedNoteId === args.targetId);
    return !!fileNode && (note.canvasData.edges || []).some((e) => e.fromNode === args.textNodeId && e.toNode === fileNode.id);
  }, { canvasId, targetId, textNodeId }, { timeout: 8000 });

  const persisted = await page.evaluate((args) => {
    const note = window.State.NOTES.find((n) => n.id === args.canvasId);
    const fileNode = note.canvasData.nodes.find((nd) => nd.type === 'file' && nd.linkedNoteId === args.targetId);
    return !!fileNode;
  }, { canvasId, targetId, textNodeId });
  expect(persisted).toBe(true);
});
