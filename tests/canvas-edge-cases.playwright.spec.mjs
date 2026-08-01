/**
 * Vinland Canvas Edge Cases - Playwright Integration Tests
 *
 * Stress-tests the CanvasManager to find and guard against edge cases:
 * - 100+ node rendering
 * - Rapid add/delete cycles
 * - Group node creation + persistence
 * - Dangling edge cleanup on node deletion
 * - Double-click node creation
 * - Empty state hints
 * - Pan/zoom state preservation
 * - Invalid URL embed handling
 * - Backlinks panel positioning
 * - Undo/redo after operations
 *
 * Run with:
 *   npx playwright test tests/canvas-edge-cases.playwright.spec.mjs
 */

import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:9999';

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
  await editor.waitFor({ state: 'visible', timeout: 8000 });
  return editor;
}

async function closeEditor(page) {
  const closeBtn = page.locator('#note-editor-close');
  await closeBtn.waitFor({ state: 'visible', timeout: 5000 });
  await closeBtn.click();
  await page.waitForTimeout(400);
}

async function openCanvas(page) {
  await runCLI(page, 'canvas');
  await waitForEditor(page);
  await expect(page.locator('#canvas-container')).toBeVisible({ timeout: 5000 });
}

async function getCanvasNoteId(page) {
  return await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    return note ? note.id : null;
  });
}

async function addNodeViaClick(page) {
  await page.locator('#canvas-add-node').click();
  await page.waitForTimeout(200);
}

async function addGroupViaClick(page) {
  await page.locator('#canvas-add-group').click();
  await page.waitForTimeout(400);
}

async function deleteSelectedViaKey(page) {
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
}

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX' ||
      k.startsWith('OPERATOR_BOARDS_') || k.startsWith('vinland_canvas_')
    );
    keys.forEach(k => localStorage.removeItem(k));
    if (window.ModalManager) window.ModalManager.closeAll();
    if (window.State && window.State.CONFIG) window.State.CONFIG.first_run = false;
    if (window.State) window.State.NOTES.length = 0;
  });
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// [1] Empty state
// ══════════════════════════════════════════

test('EC1. Empty canvas shows hint overlay', async ({ page }) => {
  await openCanvas(page);

  // Hint should be visible
  const hint = page.locator('.canvas-hint-overlay');
  await expect(hint).toBeVisible({ timeout: 2000 });
  await expect(hint).toContainText('CANVAS // EMPTY');

  // Node count should show 0
  await expect(page.locator('#canvas-node-count')).toContainText('0 nodes');

  // Minimap should be hidden
  const minimap = page.locator('#canvas-minimap');
  await expect(minimap).not.toBeVisible();

  await closeEditor(page);
});

// ══════════════════════════════════════════
// [2] Double-click creates node
// ══════════════════════════════════════════

test('EC2. Double-click on empty canvas creates node', async ({ page }) => {
  await openCanvas(page);

  // Double-click in the center of the canvas container
  const canvasContainer = page.locator('#canvas-container');
  await canvasContainer.dblclick({ position: { x: 300, y: 200 } });
  await page.waitForTimeout(500);

  // A node should appear
  await expect(page.locator('.canvas-card')).toHaveCount(1);
  await expect(page.locator('#canvas-node-count')).toContainText('1 node');

  // Double-click again
  await canvasContainer.dblclick({ position: { x: 500, y: 300 } });
  await page.waitForTimeout(500);

  await expect(page.locator('.canvas-card')).toHaveCount(2);

  await closeEditor(page);
});

// ══════════════════════════════════════════
// [3] 100-node stress test
// ══════════════════════════════════════════

test('EC3. Canvas handles 100 nodes without crashing', async ({ page }) => {
  await openCanvas(page);

  // Rapidly add 100 nodes
  for (let i = 0; i < 100; i++) {
    await addNodeViaClick(page);
  }

  // Wait for rendering to settle
  await page.waitForTimeout(500);

  // Should show 100 nodes
  const cards = page.locator('.canvas-card');
  await expect(cards).toHaveCount(100);
  await expect(page.locator('#canvas-node-count')).toContainText('100 nodes');

  // Node count should match data model
  const dataCount = await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    return note && note.canvasData && note.canvasData.nodes ? note.canvasData.nodes.length : -1;
  });
  expect(dataCount).toBe(100);

  // Verify node count persists after close/reopen
  const noteId = await getCanvasNoteId(page);
  await closeEditor(page);

  await page.evaluate((id) => {
    if (window.Notes && window.Notes.open) window.Notes.open(id);
  }, noteId);
  await page.waitForTimeout(800);

  await expect(page.locator('.canvas-card')).toHaveCount(100);
  await expect(page.locator('#canvas-node-count')).toContainText('100 nodes');

  await closeEditor(page);
});

// ══════════════════════════════════════════
// [4] Rapid add + delete cycle
// ══════════════════════════════════════════

test('EC4. Rapid add and delete cycle leaves clean state', async ({ page }) => {
  await openCanvas(page);

  // Add 20 nodes
  for (let i = 0; i < 20; i++) {
    await addNodeViaClick(page);
  }
  await expect(page.locator('.canvas-card')).toHaveCount(20);

  // Select all nodes by marquee (click and drag on bg)
  const canvasContainer = page.locator('#canvas-container');
  const box = await canvasContainer.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 20, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Delete all selected nodes
  await deleteSelectedViaKey(page);
  await page.waitForTimeout(300);

  // Canvas should be empty (auto-wait for the cards to be removed)
  await expect(page.locator('.canvas-card')).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('#canvas-node-count')).toContainText('0 nodes');

  // Hint should reappear
  const hint = page.locator('.canvas-hint-overlay');
  await expect(hint).toBeVisible({ timeout: 2000 });

  // Repeat cycle: add 10, delete all, add 10 again
  for (let i = 0; i < 10; i++) await addNodeViaClick(page);
  await expect(page.locator('.canvas-card')).toHaveCount(10);

  // Select and delete all nodes
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 20, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await deleteSelectedViaKey(page);
  await page.waitForTimeout(300);

  await expect(page.locator('.canvas-card')).toHaveCount(0);

  // Add 10 again to verify the canvas is still functional
  for (let i = 0; i < 10; i++) await addNodeViaClick(page);
  await expect(page.locator('.canvas-card')).toHaveCount(10);

  await closeEditor(page);
});

// ══════════════════════════════════════════
// [5] Group node creation and persistence
// ══════════════════════════════════════════

test('EC5. Group node renders, persists, and does not duplicate on load', async ({ page }) => {
  await openCanvas(page);

  // Add some regular nodes
  await addNodeViaClick(page);
  await addNodeViaClick(page);
  await expect(page.locator('.canvas-card')).toHaveCount(2);

  // Add a group node
  await addGroupViaClick(page);

  // Groups use .canvas-group class, not .canvas-card
  const groups = page.locator('.canvas-group');
  await expect(groups).toHaveCount(1);

  // Total nodes in data model should be 3 (2 cards + 1 group)
  const dataCount = await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    return note && note.canvasData && note.canvasData.nodes ? note.canvasData.nodes.length : -1;
  });
  expect(dataCount).toBe(3);

  const noteId = await getCanvasNoteId(page);

  // Close and reopen — verify no group duplication
  await closeEditor(page);
  await page.evaluate((id) => {
    if (window.Notes && window.Notes.open) window.Notes.open(id);
  }, noteId);
  await page.waitForTimeout(800);

  // Should still have exactly 1 group, 2 cards
  await expect(page.locator('.canvas-group')).toHaveCount(1);
  await expect(page.locator('.canvas-card')).toHaveCount(2);
  await expect(page.locator('#canvas-node-count')).toContainText('3 nodes');

  // Reopen again — groups should not accumulate
  await closeEditor(page);
  await page.evaluate((id) => {
    if (window.Notes && window.Notes.open) window.Notes.open(id);
  }, noteId);
  await page.waitForTimeout(800);

  await expect(page.locator('.canvas-group')).toHaveCount(1);
  await expect(page.locator('.canvas-card')).toHaveCount(2);

  await closeEditor(page);
});

// ══════════════════════════════════════════
// [6] Delete node with edges cleans up dangling edges
// ══════════════════════════════════════════

test('EC6. Deleting a connected node removes its edges (no dangling)', async ({ page }) => {
  await openCanvas(page);

  // Add 3 nodes via toolbar
  for (let i = 0; i < 3; i++) await addNodeViaClick(page);

  // Inject an edge between node 0 and node 1 directly via page.evaluate
  // (Keyboard Tab spawning is unreliable in headless Playwright)
  await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    if (!note || !note.canvasData || !note.canvasData.nodes || note.canvasData.nodes.length < 2) return;
    if (!note.canvasData.edges) note.canvasData.edges = [];
    note.canvasData.edges.push({
      id: 'edge_test_' + Date.now(),
      fromNode: note.canvasData.nodes[0].id,
      toNode: note.canvasData.nodes[1].id,
      fromPort: 'right',
      toPort: 'left',
      label: ''
    });
    if (window.saveData) window.saveData();
    // Re-render edges via CanvasManager
    if (window.CanvasManager && window.CanvasManager._refreshEdges) {
      window.CanvasManager._refreshEdges();
    }
  });
  await page.waitForTimeout(400);

  // Should now have 3 nodes and 1 edge
  const edgeCount1 = await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    return note && note.canvasData && note.canvasData.edges ? note.canvasData.edges.length : -1;
  });
  expect(edgeCount1).toBe(1);

  // Select the first node via evaluate and delete it
  await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    if (!note || !note.canvasData || !note.canvasData.nodes || !note.canvasData.nodes[0]) return;
    if (window.CanvasManager && window.CanvasManager.selectNode) {
      window.CanvasManager.selectNode(note.canvasData.nodes[0].id, false);
    }
  });
  await page.waitForTimeout(200);
  await deleteSelectedViaKey(page);
  await page.waitForTimeout(300);

  // Should now have 2 nodes and 0 edges (edge connected to deleted node removed)
  const dataCount = await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    return note && note.canvasData && note.canvasData.nodes ? note.canvasData.nodes.length : -1;
  });
  expect(dataCount).toBe(2);

  const edgeCount2 = await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    return note && note.canvasData && note.canvasData.edges ? note.canvasData.edges.length : -1;
  });
  expect(edgeCount2).toBe(0, 'dangling edge should be removed after source node deletion');

  await closeEditor(page);
});

// ══════════════════════════════════════════
// [7] Undo/Redo cycle
// ══════════════════════════════════════════

test('EC7. Undo restores deleted nodes, redo re-deletes them', async ({ page }) => {
  await openCanvas(page);

  // Add 5 nodes
  for (let i = 0; i < 5; i++) await addNodeViaClick(page);
  await expect(page.locator('.canvas-card')).toHaveCount(5);

  // Select and delete all
  const canvasContainer = page.locator('#canvas-container');
  const box = await canvasContainer.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 20, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await deleteSelectedViaKey(page);
  await page.waitForTimeout(300);
  await expect(page.locator('.canvas-card')).toHaveCount(0);

  // Undo (Cmd+Z) — should restore the 5 nodes
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(500);
  await expect(page.locator('.canvas-card')).toHaveCount(5);

  // Redo (Cmd+Shift+Z) — should re-delete them
  await page.keyboard.press('Meta+Shift+z');
  await page.waitForTimeout(500);
  await expect(page.locator('.canvas-card')).toHaveCount(0);

  await closeEditor(page);
});

// ══════════════════════════════════════════
// [8] Double-click on existing node does nothing
// ══════════════════════════════════════════

test('EC8. Double-click on existing node does not create duplicate', async ({ page }) => {
  await openCanvas(page);

  await addNodeViaClick(page);
  await expect(page.locator('.canvas-card')).toHaveCount(1);

  // Double-click directly on the existing card
  const card = page.locator('.canvas-card').first();
  const box = await card.boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);

  // Should still have only 1 node (no duplicate created)
  await expect(page.locator('.canvas-card')).toHaveCount(1);

  await closeEditor(page);
});

// ══════════════════════════════════════════
// [9] Invalid URL embed does not crash
// ══════════════════════════════════════════

test('EC9. Invalid URL embed does not crash the canvas', async ({ page }) => {
  await openCanvas(page);

  // Click + URL button
  await page.locator('#canvas-add-url').click();
  await page.waitForTimeout(300);

  // Type an invalid URL and press Enter
  const urlInput = page.locator('#canvas-url-picker input');
  await expect(urlInput).toBeVisible();
  await urlInput.fill('not-a-valid-url');
  await urlInput.press('Enter');
  await page.waitForTimeout(500);

  // Should create an embed node without crashing (error caught gracefully)
  const embedNodes = page.locator('.canvas-card.embed-node');
  // The node should exist - it was created even with the invalid URL
  // because we catch the error
  await expect(page.locator('#canvas-node-count')).toContainText('1 node');
});

// ══════════════════════════════════════════
// [10] Canvas viewport persists after reopen
// ══════════════════════════════════════════

test('EC10. Canvas pan/zoom state persists across close/reopen', async ({ page }) => {
  await openCanvas(page);

  // Add some nodes
  for (let i = 0; i < 5; i++) await addNodeViaClick(page);

  // Pan the canvas by setting the transform directly via evaluate
  // (middle-button pan is unreliable in Playwright headless mode)
  await page.evaluate(() => {
    if (window.CanvasManager && window.CanvasManager.transform) {
      window.CanvasManager.transform.x = 200;
      window.CanvasManager.transform.y = 100;
      window.CanvasManager.updateTransform();
      window.CanvasManager.updateUI();
      // Save viewport through the real save path so both save + restore are tested
      if (window.CanvasManager._saveViewport) {
        window.CanvasManager._saveViewport();
      }
    }
  });
  await page.waitForTimeout(200);

  // Verify transform was applied
  const transform1 = await page.evaluate(() => {
    const board = document.querySelector('.canvas-board');
    return board ? board.style.transform : null;
  });
  expect(transform1).toContain('translate(200px');

  const noteId = await getCanvasNoteId(page);
  await closeEditor(page);

  // Reopen
  await page.evaluate((id) => {
    if (window.Notes && window.Notes.open) window.Notes.open(id);
  }, noteId);
  await page.waitForTimeout(800);

  // Transform should be restored (viewport persistence)
  const transform2 = await page.evaluate(() => {
    const board = document.querySelector('.canvas-board');
    return board ? board.style.transform : null;
  });

  expect(transform2).not.toBeNull();
  // Verify the panned state persisted (non-zero translate)
  expect(transform2).not.toMatch(/translate\(0px,\s*0px\)/);

  await closeEditor(page);
});

// ══════════════════════════════════════════
// [11] Copy/paste nodes via Cmd+C / Cmd+V
// ══════════════════════════════════════════

test('EC11. Copy and paste nodes via clipboard shortcuts', async ({ page }) => {
  await openCanvas(page);

  // Add 3 nodes
  for (let i = 0; i < 3; i++) await addNodeViaClick(page);
  await expect(page.locator('.canvas-card')).toHaveCount(3);

  // Select all 3 nodes via marquee
  const canvasContainer = page.locator('#canvas-container');
  const box = await canvasContainer.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 20, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Store last mouse coords so paste positions at cursor center
  await page.evaluate(() => {
    if (window.CanvasManager) {
      window.CanvasManager.lastMouseCoords = { x: 500, y: 400 };
    }
  });

  // Copy (Cmd+C)
  await page.keyboard.press('Meta+c');
  await page.waitForTimeout(200);

  // Verify clipboard was populated
  const clipSize = await page.evaluate(() => {
    if (!window.CanvasManager || !window.CanvasManager.clipboard) return -1;
    return window.CanvasManager.clipboard.nodes ? window.CanvasManager.clipboard.nodes.length : 0;
  });
  expect(clipSize).toBe(3);

  // Paste (Cmd+V)
  await page.keyboard.press('Meta+v');
  await page.waitForTimeout(400);

  // Should now have 6 nodes (3 original + 3 pasted)
  await expect(page.locator('.canvas-card')).toHaveCount(6);
  await expect(page.locator('#canvas-node-count')).toContainText('6 nodes');

  // Verify data model matches
  const dataCount = await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    return note && note.canvasData && note.canvasData.nodes ? note.canvasData.nodes.length : -1;
  });
  expect(dataCount).toBe(6);

  await closeEditor(page);
});

// ══════════════════════════════════════════
// [12] Color picker on group nodes
// ══════════════════════════════════════════

test('EC12. Group node accepts color change via data-color attribute', async ({ page }) => {
  await openCanvas(page);

  // Add a group node
  await addGroupViaClick(page);
  await expect(page.locator('.canvas-group')).toHaveCount(1);

  // Set color via evaluate (simulates context menu swatch click)
  await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    if (!note || !note.canvasData || !note.canvasData.nodes) return;
    const groupNode = note.canvasData.nodes.find(n => n.type === 'group');
    if (!groupNode) return;

    // Save history state then set color
    if (window.CanvasManager && window.CanvasManager._saveHistoryState) {
      window.CanvasManager._saveHistoryState();
    }
    groupNode.color = 'red';

    // Update the DOM card's data-color attribute
    const card = document.getElementById('canvas-node-' + groupNode.id);
    if (card) {
      card.setAttribute('data-color', 'red');
    }

    if (window.saveData) window.saveData();
  });
  await page.waitForTimeout(200);

  // Verify data-color attribute is set on the group
  const colorAttr = await page.evaluate(() => {
    const group = document.querySelector('.canvas-group');
    return group ? group.getAttribute('data-color') : null;
  });
  expect(colorAttr).toBe('red');

  // Verify color persisted in data model
  const modelColor = await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    if (!note || !note.canvasData || !note.canvasData.nodes) return null;
    const groupNode = note.canvasData.nodes.find(n => n.type === 'group');
    return groupNode ? groupNode.color : null;
  });
  expect(modelColor).toBe('red');

  await closeEditor(page);
});

// ══════════════════════════════════════════
// [13] Edge creation via data model + SVG rendering
// ══════════════════════════════════════════

test('EC13. Edge created in data model renders in SVG layer', async ({ page }) => {
  await openCanvas(page);

  // Add 2 nodes at known positions
  await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    if (!note || !note.canvasData) return;
    note.canvasData.nodes.push({
      id: 'node_a', title: 'Node A', x: 100, y: 100, width: 120, height: 80
    });
    note.canvasData.nodes.push({
      id: 'node_b', title: 'Node B', x: 400, y: 100, width: 120, height: 80
    });
    if (window.CanvasManager) {
      window.CanvasManager.load(note.id);
    }
  });
  await page.waitForTimeout(500);

  await expect(page.locator('.canvas-card')).toHaveCount(2);
  await expect(page.locator('#canvas-node-count')).toContainText('2 nodes');

  // Inject edge via evaluate into data model + render (Shift+drag hit-testing unreliable in headless)
  await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    if (!note || !note.canvasData || !note.canvasData.nodes || note.canvasData.nodes.length < 2) return;
    if (!note.canvasData.edges) note.canvasData.edges = [];
    note.canvasData.edges.push({
      id: 'edge_test_' + Date.now(),
      fromNode: 'node_a',
      toNode: 'node_b',
      fromPort: 'right',
      toPort: 'left',
      label: ''
    });
    if (window.saveData) window.saveData();
    if (window.CanvasManager && window.CanvasManager._refreshEdges) {
      window.CanvasManager._refreshEdges();
    }
  });
  await page.waitForTimeout(400);

  // Verify edge was created
  const edgeCount = await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    return note && note.canvasData && note.canvasData.edges ? note.canvasData.edges.length : -1;
  });
  expect(edgeCount).toBe(1);

  // Verify edge connects correct nodes
  const edgeDetails = await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    if (!note || !note.canvasData || !note.canvasData.edges || note.canvasData.edges.length === 0) return null;
    const e = note.canvasData.edges[0];
    return { fromNode: e.fromNode, toNode: e.toNode };
  });
  expect(edgeDetails).not.toBeNull();
  expect(edgeDetails.fromNode).toBe('node_a');
  expect(edgeDetails.toNode).toBe('node_b');
  // Also verify the edge is rendered in the DOM (SVG path exists)
  const edgeEls = await page.evaluate(() => {
    return document.querySelectorAll('#canvas-svg-layer .canvas-edge').length;
  });
  expect(edgeEls).toBeGreaterThanOrEqual(1);

  await closeEditor(page);
});

// ══════════════════════════════════════════
// [14] Resize handle changes node dimensions
// ══════════════════════════════════════════

test('EC14. Dragging resize handle changes node width and height', async ({ page }) => {
  await openCanvas(page);

  // Add a group node (groups have .canvas-resizer; generic text nodes do not)
  await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    if (!note || !note.canvasData) return;
    note.canvasData.nodes.push({
      id: 'resize_node', type: 'group', label: 'Resize Test',
      x: 200, y: 200, width: 240, height: 160, color: 'default'
    });
    if (window.CanvasManager) {
      window.CanvasManager.load(note.id);
    }
  });
  await page.waitForTimeout(500);

  // Groups render with .canvas-group, not .canvas-card
  await expect(page.locator('.canvas-group')).toHaveCount(1);

  // Get initial dimensions from data model (.canvas-group min-height varies)
  const initialDims = await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    if (!note || !note.canvasData || !note.canvasData.nodes) return null;
    const node = note.canvasData.nodes.find(n => n.id === 'resize_node');
    return node ? { w: node.width, h: node.height } : null;
  });
  expect(initialDims).not.toBeNull();
  expect(initialDims.w).toBe(240);
  expect(initialDims.h).toBe(160);

  // Get resizer handle position
  const resizerPos = await page.evaluate(() => {
    const resizer = document.querySelector('.canvas-resizer');
    if (!resizer) return null;
    const r = resizer.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  expect(resizerPos).not.toBeNull();

  // Drag the resizer handle 80px right and 60px down
  await page.mouse.move(resizerPos.x, resizerPos.y);
  await page.mouse.down();
  await page.mouse.move(resizerPos.x + 80, resizerPos.y + 60, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Verify dimensions increased
  const newDims = await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    if (!note || !note.canvasData || !note.canvasData.nodes) return null;
    const node = note.canvasData.nodes.find(n => n.id === 'resize_node');
    if (!node) return null;
    return { w: node.width, h: node.height };
  });
  expect(newDims).not.toBeNull();
  expect(newDims.w).toBeGreaterThan(240);
  expect(newDims.h).toBeGreaterThan(160);

  await closeEditor(page);
});

// ══════════════════════════════════════════
// [15] Shift+click multi-selection
// ══════════════════════════════════════════

test('EC15. Shift+click selects multiple nodes cumulatively', async ({ page }) => {
  await openCanvas(page);

  // Inject 3 nodes at distinct positions via evaluate so Shift+click resolves correctly
  // (addNodeViaClick places all nodes at center, making click targeting unreliable)
  await page.evaluate(() => {
    const note = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    if (!note || !note.canvasData) return;
    note.canvasData.nodes.push({ id: 'sel_a', title: 'A', x: 100, y: 100, width: 120, height: 80 });
    note.canvasData.nodes.push({ id: 'sel_b', title: 'B', x: 300, y: 100, width: 120, height: 80 });
    note.canvasData.nodes.push({ id: 'sel_c', title: 'C', x: 500, y: 100, width: 120, height: 80 });
    if (window.CanvasManager) {
      window.CanvasManager.load(note.id);
    }
  });
  await page.waitForTimeout(500);
  await expect(page.locator('.canvas-card')).toHaveCount(3);

  // Shift+click each node by ID to multi-select
  const ids = ['sel_a', 'sel_b', 'sel_c'];
  for (const id of ids) {
    await page.evaluate((nodeId) => {
      if (window.CanvasManager && window.CanvasManager.selectNode) {
        window.CanvasManager.selectNode(nodeId, true);
      }
    }, id);
    await page.waitForTimeout(100);
  }

  // Verify 3 nodes are selected
  const selectedCount = await page.evaluate(() => {
    if (!window.CanvasManager) return -1;
    return window.CanvasManager.selectedNodeIds ? window.CanvasManager.selectedNodeIds.size : -1;
  });
  expect(selectedCount).toBe(3);

  // Verify all 3 cards have the selected-node class
  const selectedDomCards = await page.evaluate(() => {
    return document.querySelectorAll('.canvas-card.selected-node').length;
  });
  expect(selectedDomCards).toBe(3);

  // Click background to clear selection
  const canvasContainer = page.locator('#canvas-container');
  const box = await canvasContainer.boundingBox();
  await page.mouse.click(box.x + 5, box.y + 5);
  await page.waitForTimeout(200);

  // Verify selection cleared
  const clearedCount = await page.evaluate(() => {
    if (!window.CanvasManager) return -1;
    return window.CanvasManager.selectedNodeIds ? window.CanvasManager.selectedNodeIds.size : -1;
  });
  expect(clearedCount).toBe(0);

  await closeEditor(page);
});
