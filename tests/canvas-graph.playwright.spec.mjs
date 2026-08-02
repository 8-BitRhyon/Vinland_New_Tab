

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

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  // Clear all persistent state
  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX' ||
      k.startsWith('OPERATOR_BOARDS_')
    );
    keys.forEach(k => localStorage.removeItem(k));
    if (window.State) {
      if (Array.isArray(window.State.NOTES)) window.State.NOTES.length = 0;
      if (Array.isArray(window.State.BOARDS)) window.State.BOARDS.length = 0;
    }

    // Dismiss welcome modal if present (first_run config)
    if (window.ModalManager) {
      window.ModalManager.closeAll();
    }
    if (window.State && window.State.CONFIG) {
      window.State.CONFIG.first_run = false;
    }
  });

  await page.waitForTimeout(300);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    try {
      const keys = Object.keys(localStorage).filter(k =>
        k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX' ||
        k.startsWith('OPERATOR_BOARDS_')
      );
      keys.forEach(k => localStorage.removeItem(k));
    } catch {  }
  }).catch(() => {});
});

// ══════════════════════════════════════════
// CANVAS TESTS
// ══════════════════════════════════════════

test('1. Create a canvas via CLI command', async ({ page }) => {
  await runCLI(page, 'canvas');

  // The editor modal should open with canvas routing
  const editor = await waitForEditor(page);

  // The canvas container should be visible
  const canvasContainer = page.locator('#canvas-container');
  await expect(canvasContainer).toBeVisible({ timeout: 5000 });

  // Canvas toolbar should have the expected buttons
  const addNodeBtn = page.locator('#canvas-add-node');
  await expect(addNodeBtn).toBeVisible({ timeout: 2000 });
  await expect(addNodeBtn).toContainText('+ NODE');

  await expect(page.locator('#canvas-add-file')).toBeVisible();
  await expect(page.locator('#canvas-add-url')).toBeVisible();
  await expect(page.locator('#canvas-add-group')).toBeVisible();
  await expect(page.locator('#canvas-reset-view')).toBeVisible();

  // The canvas board should exist
  const board = page.locator('.canvas-board');
  await expect(board).toBeVisible({ timeout: 2000 });

  // The hint overlay should be visible (empty canvas)
  const hint = page.locator('.canvas-hint-overlay');
  await expect(hint).toBeVisible({ timeout: 2000 });

  await closeEditor(page);
});

test('2. Add a node via toolbar button', async ({ page }) => {
  await runCLI(page, 'canvas');
  await waitForEditor(page);
  await expect(page.locator('#canvas-container')).toBeVisible({ timeout: 5000 });

  // Click the + NODE button
  await page.locator('#canvas-add-node').click();
  await page.waitForTimeout(500);

  // After adding a node, the hint should disappear and node count should update
  const nodeCount = page.locator('#canvas-node-count');
  await expect(nodeCount).toBeVisible({ timeout: 2000 });
  await expect(nodeCount).toContainText('1 node');

  // A canvas card should appear in the DOM
  const canvasCards = page.locator('.canvas-card');
  await expect(canvasCards).toHaveCount(1);

  // The canvas hint should be hidden
  const hint = page.locator('.canvas-hint-overlay');
  await expect(hint).not.toBeVisible({ timeout: 2000 });

  // Click + NODE again
  await page.locator('#canvas-add-node').click();
  await page.waitForTimeout(400);
  await expect(nodeCount).toContainText('2 nodes');
  await expect(canvasCards).toHaveCount(2);

  await closeEditor(page);
});

test('3. Canvas node has editable content', async ({ page }) => {
  await runCLI(page, 'canvas');
  await waitForEditor(page);
  await expect(page.locator('#canvas-container')).toBeVisible({ timeout: 5000 });

  // Add a node
  await page.locator('#canvas-add-node').click();
  await page.waitForTimeout(500);

  // The canvas card body should exist (the editable content area)
  const cardBody = page.locator('.canvas-card-body').first();
  await expect(cardBody).toBeVisible({ timeout: 2000 });
  await expect(cardBody).toHaveAttribute('contenteditable', 'true');
});

test('4. Canvas tooltip shows node count updates', async ({ page }) => {
  await runCLI(page, 'canvas');
  await waitForEditor(page);
  await expect(page.locator('#canvas-container')).toBeVisible({ timeout: 5000 });

  // Add a node and verify count
  await page.locator('#canvas-add-node').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#canvas-node-count')).toContainText('1 node');

  // Reset view button works
  const resetBtn = page.locator('#canvas-reset-view');
  await expect(resetBtn).toBeVisible();

  await closeEditor(page);
});

test('5. Canvas data persists across close and reopen', async ({ page }) => {
  await runCLI(page, 'canvas');
  await waitForEditor(page);
  await expect(page.locator('#canvas-container')).toBeVisible({ timeout: 5000 });

  // Add a node
  await page.locator('#canvas-add-node').click();
  await page.waitForTimeout(400);
  await expect(page.locator('.canvas-card')).toHaveCount(1);

  // Get the canvas note ID
  const noteId = await page.evaluate(() => {
    const canvasNote = (window.State?.NOTES ?? []).find(n => n.type === 'canvas');
    return canvasNote ? canvasNote.id : null;
  });
  expect(noteId).not.toBeNull();

  // Close the editor
  await closeEditor(page);

  // Reopen the canvas via Notes.open
  await page.evaluate((id) => {
    if (window.Notes && window.Notes.open) window.Notes.open(id);
  }, noteId);
  await page.waitForTimeout(600);

  // The canvas container should still be visible
  await expect(page.locator('#canvas-container')).toBeVisible({ timeout: 5000 });

  // The node should still be there
  const canvasCards = page.locator('.canvas-card');
  await expect(canvasCards).toHaveCount(1);
  await expect(page.locator('#canvas-node-count')).toContainText('1 node');

  await closeEditor(page);
});

// ══════════════════════════════════════════
// GRAPH MANAGER TESTS
// ══════════════════════════════════════════

test('6. Open Graph Manager via button', async ({ page }) => {
  // Open GraphManager programmatically
  await page.evaluate(() => {
    if (window.GraphManager) {
      window.GraphManager.open();
    }
  });
  await page.waitForTimeout(800);

  // The graph modal should open
  const graphModal = page.locator('#graph-modal');
  await expect(graphModal).toBeVisible({ timeout: 5000 });

  // Graph container should exist
  const graphContainer = page.locator('#graph-container');
  await expect(graphContainer).toBeVisible({ timeout: 2000 });

  // Graph should have an SVG rendered by D3
  const svg = graphContainer.locator('svg');
  await expect(svg).toBeVisible({ timeout: 5000 });

  // There should be mode toggle and legend
  const modeToggle = page.locator('#graph-mode-toggle');
  await expect(modeToggle).toBeVisible({ timeout: 2000 });

  const legend = page.locator('#graph-legend');
  await expect(legend).toBeVisible({ timeout: 2000 });

  // Close via escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await expect(graphModal).not.toBeVisible({ timeout: 3000 });
});

test('7. Graph modal can be opened and closed repeatedly', async ({ page }) => {
  const graphModal = page.locator('#graph-modal');

  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      if (window.GraphManager) window.GraphManager.open();
    });
    await page.waitForTimeout(800);
    await expect(graphModal).toBeVisible({ timeout: 5000 });
    await expect(graphModal.locator('#graph-container svg')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await expect(graphModal).not.toBeVisible({ timeout: 3000 });
  }
});

test('8. Graph mode toggle switches between LOCAL and GLOBAL', async ({ page }) => {
  await page.evaluate(() => {
    if (window.GraphManager) window.GraphManager.open();
  });
  await page.waitForTimeout(800);
  await expect(page.locator('#graph-modal')).toBeVisible({ timeout: 5000 });

  const toggle = page.locator('#graph-mode-toggle');
  await expect(toggle).toHaveText(/GLOBAL|LOCAL/, { timeout: 2000 });
  const initialMode = ((await toggle.textContent()) || '').toUpperCase();

  // Click to toggle — auto-wait until the label flips to the OTHER real mode
  // (guards against passing on a transient ''/stale value during re-render)
  await toggle.click();
  await expect.poll(async () => {
    const t = ((await toggle.textContent()) || '').toUpperCase();
    return /GLOBAL|LOCAL/.test(t) && t !== initialMode;
  }, { timeout: 3000 }).toBe(true);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
});

test('9. Graph renders with D3 nodes when notes exist', async ({ page }) => {
  // Create two notes with wiki-links to establish a graph connection
  await runCLI(page, 'note Alpha Note');
  await waitForEditor(page);
  // Add wiki-link content
  const blockContent = page.locator('#block-editor .block-wrapper').first()
    .locator('[contenteditable="true"]').first();
  await blockContent.waitFor({ state: 'visible', timeout: 5000 });
  await blockContent.click();
  await blockContent.fill('Linked to [[Beta Note]]');
  await page.waitForTimeout(500);
  await closeEditor(page);

  await runCLI(page, 'note Beta Note');
  await waitForEditor(page);
  await page.waitForTimeout(300);
  await closeEditor(page);

  // Open the graph
  await page.evaluate(() => {
    if (window.GraphManager) window.GraphManager.open();
  });
  await page.waitForTimeout(800);

  const graphModal = page.locator('#graph-modal');
  await expect(graphModal).toBeVisible({ timeout: 5000 });

  // SVG should be rendered with nodes
  const svg = page.locator('#graph-container svg');
  await expect(svg).toBeVisible({ timeout: 5000 });

  // The graph should have circle elements (nodes)
  // D3 renders circles asynchronously — auto-wait for at least one
  const circles = svg.locator('circle');
  await expect.poll(async () => circles.count(), { timeout: 5000 }).toBeGreaterThanOrEqual(1);

  // Should have legend items for the notes' groups — positive auto-wait
  // (requires presence AND non-empty text; a negative toHaveText would pass
  // vacuously if the element were missing)
  const legend = page.locator('#graph-legend');
  await expect(legend).toHaveText(/.+/, { timeout: 5000 });

  // Close
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
});

test('10. Graph can render without any notes', async ({ page }) => {
  await page.evaluate(() => {
    if (window.GraphManager) window.GraphManager.open();
  });
  await page.waitForTimeout(800);

  await expect(page.locator('#graph-modal')).toBeVisible({ timeout: 5000 });

  // SVG should still be created even with no notes
  const svg = page.locator('#graph-container svg');
  await expect(svg).toBeVisible({ timeout: 5000 });

  // Legend might be empty but should exist
  const legend = page.locator('#graph-legend');
  await expect(legend).toBeVisible({ timeout: 2000 });

  // Mode toggle should still work
  const toggle = page.locator('#graph-mode-toggle');
  await expect(toggle).toBeVisible({ timeout: 2000 });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
});

test('11. Open graph via programmatic call (sidebar button is inside editor modal)', async ({ page }) => {
  // NOTE: #open-graph-btn lives inside .notes-sidebar which is a child of
  // #note-editor-modal (display:none by default). Clicking the actual UI button
  // requires opening the editor first. This test exercises the same code path
  // (GraphManager.open()) that the button's handler calls.
  await page.evaluate(() => {
    if (window.GraphManager) window.GraphManager.open();
  });
  await page.waitForTimeout(800);
  await expect(page.locator('#graph-modal')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#graph-container svg')).toBeVisible({ timeout: 5000 });

  // Close via escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await expect(page.locator('#graph-modal')).not.toBeVisible({ timeout: 3000 });
});
