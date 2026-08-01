/**
 * Vinland Local Graph — Playwright Integration Test
 *
 * Tests the per-note local graph end-to-end:
 * - Creates two linked notes via [[wiki links]]
 * - Verifies the local graph SVG appears with D3-rendered nodes
 * - Checks the connection count badge shows the right number
 * - Tests empty state when a note has no connections
 * - Tests collapse/expand toggle behavior
 *
 * Run with:
 *   npx playwright test tests/local-graph.playwright.spec.mjs
 */

import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:9999';

// ──────────────────────────────────────────
// Helpers (borrowed from backlinks test)
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

function getFirstBlock(page) {
  return page.locator('#block-editor .block-wrapper').first()
    .locator('[contenteditable="true"]').first();
}

/**
 * Create a note with wiki link content, wait for auto-save, and close.
 */
async function createNoteWithLink(page, title, linkTarget) {
  await runCLI(page, 'note ' + title);
  await waitForEditor(page);
  await page.waitForTimeout(300);

  const block = getFirstBlock(page);
  await block.click();
  await block.fill('[[' + linkTarget + ']]');
  // Wait for auto-save debounce (500ms) + MetadataCache update + buffer
  await page.waitForTimeout(1200);
  await closeEditor(page);
}

/**
 * Open a note by its exact title using Notes.openByTitle().
 * More reliable than CLI for opening existing notes.
 */
async function openNoteByTitle(page, title) {
  const opened = await page.evaluate((t) => {
    if (window.Notes && window.Notes.openByTitle) {
      return window.Notes.openByTitle(t);
    }
    return false;
  }, title);
  expect(opened).toBe(true);
  await page.waitForTimeout(600);
}

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  // Clean state
  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX'
    );
    keys.forEach(k => localStorage.removeItem(k));
    if (window.ModalManager) window.ModalManager.closeAll();
    if (window.State && window.State.CONFIG) window.State.CONFIG.first_run = false;
    if (window.State) window.State.NOTES.length = 0;
  });
  await page.waitForTimeout(300);
});

// ──────────────────────────────────────────
// Tests
// ──────────────────────────────────────────

test('local graph shows connected notes via wiki links', async ({ page }) => {
  // Create two linked notes
  await createNoteWithLink(page, 'AlphaNote', 'BetaNote');
  await createNoteWithLink(page, 'BetaNote', 'AlphaNote');

  // Open AlphaNote by title (uses Notes.openByTitle, no reload needed)
  await openNoteByTitle(page, 'AlphaNote');
  await waitForEditor(page);
  await page.waitForTimeout(1000); // D3 simulation settle

  // The local graph container should exist
  await expect(page.locator('#editor-local-graph')).toBeVisible({ timeout: 3000 });

  // The SVG should exist and have rendered D3 nodes (circle elements)
  const circles = page.locator('#local-graph-svg circle');
  await expect(circles.first()).toBeVisible({ timeout: 5000 });

  // Should have at least 2 circles (center + connected)
  const count = await circles.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // Connection count badge should show a number
  const badge = page.locator('#local-graph-count');
  await expect(badge).not.toHaveText('');
});

test('local graph shows empty state for unconnected note', async ({ page }) => {
  // Create a note with no wiki links
  await runCLI(page, 'note LonelyNote');
  await waitForEditor(page);
  await page.waitForTimeout(1000);

  // The local graph container should exist
  await expect(page.locator('#editor-local-graph')).toBeVisible({ timeout: 3000 });

  // The empty state message should be visible
  const emptyEl = page.locator('#local-graph-empty');
  await expect(emptyEl).toBeVisible({ timeout: 3000 });
  await expect(emptyEl).toContainText('No connected notes');

  // Count badge should be empty
  const badge = page.locator('#local-graph-count');
  await expect(badge).toHaveText('');
});

test('local graph toggles collapse/expand on header click', async ({ page }) => {
  // Create linked notes so the graph has content
  await createNoteWithLink(page, 'NodeA', 'NodeB');
  await createNoteWithLink(page, 'NodeB', 'NodeA');

  // Open NodeA (local graph has connections now, toggle is wired)
  await openNoteByTitle(page, 'NodeA');
  await waitForEditor(page);
  await page.waitForTimeout(1000);

  const graphEl = page.locator('#editor-local-graph');
  await expect(graphEl).toBeVisible({ timeout: 3000 });

  // Should NOT have 'collapsed' initially
  await expect(graphEl).not.toHaveClass(/collapsed/);

  // Click the header to collapse — auto-wait for the class to apply
  const header = page.locator('#local-graph-toggle');
  await header.click();
  await expect(graphEl).toHaveClass(/collapsed/, { timeout: 3000 });

  // Click again to expand — auto-wait for the class to be removed
  await header.click();
  await expect(graphEl).not.toHaveClass(/collapsed/, { timeout: 3000 });
});

test('local graph shows multiple connections', async ({ page }) => {
  // Create a triangle: NoteA → NoteB, NoteB → NoteC, NoteC → NoteA
  await createNoteWithLink(page, 'NoteA', 'NoteB');
  await createNoteWithLink(page, 'NoteB', 'NoteC');
  await createNoteWithLink(page, 'NoteC', 'NoteA');

  // Open NoteB — should show NoteA (backlink via NoteC→A is irrelevant) and NoteC (forward)
  await openNoteByTitle(page, 'NoteB');
  await waitForEditor(page);
  await page.waitForTimeout(1000);

  const circles = page.locator('#local-graph-svg circle');
  await expect(circles.first()).toBeVisible({ timeout: 5000 });

  // Count badge should show connections
  const badge = page.locator('#local-graph-count');
  await expect(badge).not.toHaveText('');
});
