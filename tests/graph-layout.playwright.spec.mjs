/**
 * Vinland Graph Layout Persistence - Playwright Integration Test
 *
 * Verifies that saved node positions (VINLAND_GRAPH_LAYOUT) are applied AND
 * pinned, so the D3 force simulation does not re-arrange the graph on every
 * open. This guards the "graph layout resets every open" regression.
 *
 * Run with:
 *   npx playwright test tests/graph-layout.playwright.spec.mjs
 */

import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:9999';

async function runCLI(page, command) {
  const cmdInput = page.locator('#cmd-input');
  await cmdInput.waitFor({ state: 'visible', timeout: 10000 });
  await cmdInput.fill(command);
  await cmdInput.press('Enter');
  await page.waitForTimeout(500);
}

async function closeEditor(page) {
  const closeBtn = page.locator('#note-editor-close');
  await closeBtn.waitFor({ state: 'visible', timeout: 5000 });
  await closeBtn.click();
  await page.waitForTimeout(400);
}

async function openGraph(page) {
  // The [GRAPH] button lives inside the (collapsible) notes sidebar; invoke the
  // authoritative entry point directly so the test targets render()/pinning
  // rather than sidebar-visibility UI.
  await page.evaluate(() => window.GraphManager.open());
  await page.waitForSelector('#graph-container .nodes > g', { timeout: 8000 });
  // Allow the simulation tick to settle.
  await page.waitForTimeout(900);
}

async function closeGraph(page) {
  await page.evaluate(() => {
    if (window.ModalManager) window.ModalManager.close('graph-modal');
  });
  await page.waitForTimeout(400);
}

// Returns the parsed [x, y] translate of the graph node whose label === title,
// or null if not found.
async function getNodePosition(page, title) {
  return page.evaluate((t) => {
    const groups = Array.from(document.querySelectorAll('#graph-container .nodes > g'));
    const g = groups.find((el) => (el.textContent || '').trim() === t);
    if (!g) return null;
    const transform = g.getAttribute('transform') || '';
    const m = transform.match(/translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/);
    if (!m) return null;
    return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
  }, title);
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  // Clear persistent state and dismiss onboarding.
  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith('OPERATOR_NOTE_') ||
      k === 'OPERATOR_NOTES_INDEX' ||
      k.startsWith('OPERATOR_BOARDS_') ||
      k === 'VINLAND_GRAPH_LAYOUT'
    );
    keys.forEach((k) => localStorage.removeItem(k));
    if (window.ModalManager) window.ModalManager.closeAll();
    if (window.State && window.State.CONFIG) window.State.CONFIG.first_run = false;
    if (window.State) window.State.NOTES.length = 0;
  });
  await page.waitForTimeout(300);
});

test('1. Saved positions are applied AND pinned on open', async ({ page }) => {
  // Create two notes so the graph has nodes.
  await runCLI(page, 'note Alpha');
  await closeEditor(page);
  await runCLI(page, 'note Beta');
  await closeEditor(page);

  const ids = await page.evaluate(() =>
    window.State.NOTES.map((n) => ({ id: n.id, title: n.title }))
  );
  const alpha = ids.find((n) => n.title === 'Alpha');
  const beta = ids.find((n) => n.title === 'Beta');
  expect(alpha).toBeTruthy();
  expect(beta).toBeTruthy();

  const SAVED = {
    [alpha.id]: { x: 360, y: 210 },
    [beta.id]: { x: 820, y: 540 },
  };

  // Seed the layout, then reload so boot re-reads it into Notes.graphLayout.
  await page.evaluate((layout) => {
    localStorage.setItem('VINLAND_GRAPH_LAYOUT', JSON.stringify(layout));
  }, SAVED);
  await page.reload();
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  await openGraph(page);

  const aPos = await getNodePosition(page, 'Alpha');
  const bPos = await getNodePosition(page, 'Beta');
  expect(aPos).not.toBeNull();
  expect(bPos).not.toBeNull();

  // Pinned nodes must sit at the EXACT saved coordinates (forceCenter/charge
  // must not have moved them). Tolerance 1px for float formatting.
  expect(Math.abs(aPos.x - 360)).toBeLessThanOrEqual(1);
  expect(Math.abs(aPos.y - 210)).toBeLessThanOrEqual(1);
  expect(Math.abs(bPos.x - 820)).toBeLessThanOrEqual(1);
  expect(Math.abs(bPos.y - 540)).toBeLessThanOrEqual(1);

  await closeGraph(page);
});

test('2. Layout persists across close and reopen (no re-randomize)', async ({ page }) => {
  await runCLI(page, 'note Alpha');
  await closeEditor(page);
  await runCLI(page, 'note Beta');
  await closeEditor(page);

  const ids = await page.evaluate(() =>
    window.State.NOTES.map((n) => ({ id: n.id, title: n.title }))
  );
  const alpha = ids.find((n) => n.title === 'Alpha');
  const beta = ids.find((n) => n.title === 'Beta');

  const SAVED = {
    [alpha.id]: { x: 360, y: 210 },
    [beta.id]: { x: 820, y: 540 },
  };
  await page.evaluate((layout) => {
    localStorage.setItem('VINLAND_GRAPH_LAYOUT', JSON.stringify(layout));
  }, SAVED);
  await page.reload();
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  // First open
  await openGraph(page);
  const firstA = await getNodePosition(page, 'Alpha');
  expect(firstA).not.toBeNull();
  expect(Math.abs(firstA.x - 360)).toBeLessThanOrEqual(1);
  expect(Math.abs(firstA.y - 210)).toBeLessThanOrEqual(1);
  await closeGraph(page);

  // Reopen - positions must be identical to the first open (persisted, not
  // recomputed fresh).
  await openGraph(page);
  const secondA = await getNodePosition(page, 'Alpha');
  const secondB = await getNodePosition(page, 'Beta');
  expect(secondA).not.toBeNull();
  expect(secondB).not.toBeNull();
  expect(Math.abs(secondA.x - 360)).toBeLessThanOrEqual(1);
  expect(Math.abs(secondA.y - 210)).toBeLessThanOrEqual(1);
  expect(Math.abs(secondB.x - 820)).toBeLessThanOrEqual(1);
  expect(Math.abs(secondB.y - 540)).toBeLessThanOrEqual(1);

  await closeGraph(page);
});
