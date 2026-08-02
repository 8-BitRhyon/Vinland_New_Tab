// ═══════════════════════════════════════════════════════════════
// Canvas Search (Cmd+F) E2E Tests
// ═══════════════════════════════════════════════════════════════
// CF1: Cmd+F opens the search overlay with an input
// CF2: Typing a query filters results by title
// CF3: Selecting a result closes overlay and selects the node
// CF4: ArrowDown/Up navigates through results
// CF5: Escape closes the overlay without closing editor

import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:9999';

// ── Hooks ───────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);
});

// ── Helpers ──────────────────────────────────────────────────


async function waitForAppReady(page) {
  await page.waitForFunction(() => {
    return typeof window.State !== 'undefined' && window.State && window.State.NOTES;
  }, { timeout: 10000 });
}


async function setupCanvasWithNodes(page, nodes) {
  await waitForAppReady(page);

  const noteId = await page.evaluate((nodes) => {
    // Create a canvas note with the given nodes
    const id = 'note_canvas_' + Date.now();
    const note = {
      id,
      type: 'canvas',
      title: 'Search Test Canvas',
      blocks: [{ id: 'blk_1', type: 'canvas', content: '' }],
      canvasData: { nodes: nodes || [], edges: [] },
      created: Date.now(),
      modified: Date.now()
    };
    window.State.NOTES.push(note);
    return id;
  }, nodes);

  // Open the note (this opens the editor with the canvas)
  await page.evaluate((id) => {
    if (window.Notes && window.Notes.open) window.Notes.open(id);
  }, noteId);

  await page.waitForTimeout(500);
  return noteId;
}

async function closeEditor(page) {
  const closeBtn = page.locator('#note-editor-close');
  await closeBtn.waitFor({ state: 'visible', timeout: 5000 });
  await closeBtn.click();
  await page.waitForTimeout(300);
}

// ═══════════════════════════════════════════════════════════════

// CF1: Cmd+F opens the search overlay
test('CF1. Cmd+F opens the canvas search overlay with an input', async ({ page }) => {
  await setupCanvasWithNodes(page, [
    { id: 'node_a', title: 'Alpha Project', preview: 'Planning phase', x: 0, y: 0, width: 200, height: 80 },
    { id: 'node_b', title: 'Beta Launch', preview: 'Q3 release', x: 300, y: 0, width: 200, height: 80 }
  ]);
  await page.waitForTimeout(300);

  // Press Cmd+F
  await page.keyboard.press('Meta+f');
  await page.waitForTimeout(300);

  // Search overlay should be visible
  await expect(page.locator('#canvas-search-overlay')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#canvas-search-input')).toBeVisible({ timeout: 2000 });
  await expect(page.locator('#canvas-search-results')).toBeVisible({ timeout: 2000 });

  // Results should show both nodes (empty query = all nodes)
  const items = page.locator('.canvas-search-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Alpha Project');
  await expect(items.nth(1)).toContainText('Beta Launch');

  // Close
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await expect(page.locator('#canvas-search-overlay')).not.toBeVisible({ timeout: 2000 });

  await closeEditor(page);
});

// CF2: Typing a query filters results
test('CF2. Typing a query in search input filters results by title', async ({ page }) => {
  await setupCanvasWithNodes(page, [
    { id: 'node_1', title: 'Alpha Project', preview: 'Initial planning', x: 0, y: 0, width: 200, height: 80 },
    { id: 'node_2', title: 'Beta Features', preview: 'Feature list', x: 300, y: 0, width: 200, height: 80 },
    { id: 'node_3', title: 'Gamma Release', preview: 'Release notes', x: 600, y: 0, width: 200, height: 80 }
  ]);
  await page.waitForTimeout(300);

  // Open search
  await page.keyboard.press('Meta+f');
  await page.waitForTimeout(300);
  await expect(page.locator('#canvas-search-overlay')).toBeVisible({ timeout: 3000 });

  // Type a query
  const input = page.locator('#canvas-search-input');
  await input.fill('Beta');
  await page.waitForTimeout(200);

  // Should only show the Beta node
  const items = page.locator('.canvas-search-item');
  await expect(items).toHaveCount(1);
  await expect(items.nth(0)).toContainText('Beta Features');

  // Clear and search for 'alpha' (case-insensitive)
  await input.fill('alpha');
  await page.waitForTimeout(200);
  await expect(items).toHaveCount(1);
  await expect(items.nth(0)).toContainText('Alpha Project');

  // Close
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await closeEditor(page);
});

// CF3: Selecting a result closes overlay and selects the node
test('CF3. Selecting a search result closes overlay and selects the matching node', async ({ page }) => {
  await setupCanvasWithNodes(page, [
    { id: 'node_findme', title: 'Find This Node', preview: 'Target content', x: 0, y: 0, width: 200, height: 80 },
    { id: 'node_other', title: 'Other Node', preview: 'Not the target', x: 400, y: 0, width: 200, height: 80 }
  ]);
  await page.waitForTimeout(300);

  // Open search
  await page.keyboard.press('Meta+f');
  await page.waitForTimeout(300);

  // Type query to narrow to one result
  const input = page.locator('#canvas-search-input');
  await input.fill('Find This');
  await page.waitForTimeout(200);

  // Should have 1 result
  const items = page.locator('.canvas-search-item');
  await expect(items).toHaveCount(1);

  // First result should be pre-selected (selectedIndex = 0)
  await expect(items.nth(0)).toHaveClass(/canvas-search-item-selected/);

  // Press Enter to select
  await input.press('Enter');
  await page.waitForTimeout(500);

  // Overlay should be closed
  await expect(page.locator('#canvas-search-overlay')).not.toBeVisible({ timeout: 2000 });

  // The node should be selected (selected-node class)
  const selectedCard = page.locator('#canvas-node-node_findme.selected-node');
  await expect(selectedCard).toHaveCount(1, { timeout: 3000 });

  await closeEditor(page);
});

// CF4: ArrowDown/Up navigation through results
test('CF4. ArrowDown and ArrowUp navigate through search results', async ({ page }) => {
  await setupCanvasWithNodes(page, [
    { id: 'node_10', title: 'Apple', preview: 'Fruit', x: 0, y: 0, width: 200, height: 80 },
    { id: 'node_20', title: 'Banana', preview: 'Yellow fruit', x: 300, y: 0, width: 200, height: 80 },
    { id: 'node_30', title: 'Cherry', preview: 'Red fruit', x: 600, y: 0, width: 200, height: 80 }
  ]);
  await page.waitForTimeout(300);

  // Open search (empty query shows all nodes)
  await page.keyboard.press('Meta+f');
  await page.waitForTimeout(300);
  await expect(page.locator('#canvas-search-overlay')).toBeVisible({ timeout: 3000 });

  // First item should be selected by default
  const items = page.locator('.canvas-search-item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveClass(/canvas-search-item-selected/);

  // ArrowDown to second item
  const input = page.locator('#canvas-search-input');
  await input.press('ArrowDown');
  await page.waitForTimeout(100);
  await expect(items.nth(1)).toHaveClass(/canvas-search-item-selected/);
  await expect(items.nth(0)).not.toHaveClass(/canvas-search-item-selected/);

  // ArrowDown to third item
  await input.press('ArrowDown');
  await page.waitForTimeout(100);
  await expect(items.nth(2)).toHaveClass(/canvas-search-item-selected/);

  // ArrowUp back to second item
  await input.press('ArrowUp');
  await page.waitForTimeout(100);
  await expect(items.nth(1)).toHaveClass(/canvas-search-item-selected/);

  // Close
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await closeEditor(page);
});

// CF5: Escape closes the overlay without closing the editor
test('CF5. Escape key closes the canvas search overlay without closing the editor', async ({ page }) => {
  await setupCanvasWithNodes(page, [
    { id: 'node_x', title: 'Node X', preview: 'Content X', x: 0, y: 0, width: 200, height: 80 }
  ]);
  await page.waitForTimeout(300);

  // Open search
  await page.keyboard.press('Meta+f');
  await page.waitForTimeout(300);
  await expect(page.locator('#canvas-search-overlay')).toBeVisible({ timeout: 3000 });

  // Type something
  const input = page.locator('#canvas-search-input');
  await input.fill('Node X');
  await page.waitForTimeout(200);

  // Press Escape
  await input.press('Escape');
  await page.waitForTimeout(300);

  // Overlay should be closed
  await expect(page.locator('#canvas-search-overlay')).not.toBeVisible({ timeout: 2000 });

  // Editor should still be open (Escape only closes the search overlay, not the editor)
  await expect(page.locator('#canvas-container')).toBeVisible({ timeout: 2000 });

  await closeEditor(page);
});
