/**
 * Vinland Backlinks Panel - Playwright Integration Test
 *
 * Tests the backlinks panel end-to-end:
 * - Creates two notes with bidirectional [[wiki links]]
 * - Verifies backlinks appear in both directions
 * - Confirms clicking a backlink navigates to the target note
 * - Verifies the backlinks panel correctly updates after navigation
 *
 * Run with:
 *   npx playwright test tests/backlinks.playwright.spec.mjs
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
  await page.waitForTimeout(400);
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
 * Create a note via CLI, fill its content, wait for auto-save, and close.
 * Uses a unique title to avoid collisions.
 */
async function createNoteWithContent(page, title, content) {
  await runCLI(page, `note ${title}`);
  await waitForEditor(page);
  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();
  await block.fill(content);
  // Wait for auto-save debounce (500ms) + MetadataCache update + buffer
  await page.waitForTimeout(1500);
  await closeEditor(page);
}

/**
 * Open a note by its exact title using Notes.openByTitle().
 * This is more reliable than clicking sidebar/Quick Notes items.
 */
async function openNoteByTitle(page, title) {
  const opened = await page.evaluate((t) => {
    if (window.Notes && window.Notes.openByTitle) {
      return window.Notes.openByTitle(t);
    }
    return false;
  }, title);
  expect(opened).toBe(true);
  await page.waitForTimeout(500);
  return opened;
}

/**
 * Get the text content of the backlinks panel header.
 * Returns empty string if the panel is not visible/active.
 */
async function getBacklinksHeaderText(page) {
  return await page.evaluate(() => {
    const panel = document.getElementById('note-backlinks-panel');
    if (!panel) return '';
    if (!panel.classList.contains('active')) return '';
    const header = panel.querySelector('.note-backlinks-header');
    return header ? header.textContent.trim() : '';
  });
}

/**
 * Get the list of backlink item titles shown in the panel.
 * Returns an empty array if the panel is not visible/active.
 */
async function getBacklinkTitles(page) {
  return await page.evaluate(() => {
    const panel = document.getElementById('note-backlinks-panel');
    if (!panel || !panel.classList.contains('active')) return [];
    const items = panel.querySelectorAll('.note-backlink-item');
    return Array.from(items).map(el => {
      const titleEl = el.querySelector('.note-backlink-title');
      return titleEl ? titleEl.textContent.trim() : '';
    });
  });
}

/**
 * Click on a backlink item by its title text.
 */
async function clickBacklinkByTitle(page, title) {
  await page.evaluate((t) => {
    const panel = document.getElementById('note-backlinks-panel');
    if (!panel) return;
    const items = panel.querySelectorAll('.note-backlink-item');
    for (const el of items) {
      const titleEl = el.querySelector('.note-backlink-title');
      if (titleEl && titleEl.textContent.trim() === t) {
        el.click();
        return;
      }
    }
  }, title);
  await page.waitForTimeout(600);
}

/**
 * Check if the backlinks panel exists and is in the given state.
 */
async function getBacklinksPanelState(page) {
  return await page.evaluate(() => {
    const p = document.getElementById('note-backlinks-panel');
    if (!p) return { exists: false };
    return {
      exists: true,
      isActive: p.classList.contains('active'),
      isEmpty: p.classList.contains('empty'),
      classList: p.className
    };
  });
}

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);

  // Clean localStorage for a fresh state
  await page.evaluate(() => {
    try {
      const keys = Object.keys(localStorage).filter(k =>
        k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX' ||
        k.startsWith('VINLAND_') || k === 'OPERATOR_BOARDS_V1'
      );
      keys.forEach(k => localStorage.removeItem(k));
      if (window.State) {
        if (Array.isArray(window.State.NOTES)) window.State.NOTES.length = 0;
      }
    } catch { /* ignore */ }
  });

  await page.waitForTimeout(300);
});

test.afterEach(async ({ page }) => {
  // Clean up test artifacts
  await page.evaluate(() => {
    try {
      const keys = Object.keys(localStorage).filter(k =>
        k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX'
      );
      keys.forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }
  }).catch(() => {});
});

// ══════════════════════════════════════════
// Test 1: Backlinks panel shows when wiki links exist
// ══════════════════════════════════════════
test('1. Backlinks panel shows notes that link via [[wiki links]]', async ({ page }) => {
  // Create two notes with bidirectional wiki links
  await createNoteWithContent(page, 'Alpha', 'This is a reference to [[Beta]]');
  await createNoteWithContent(page, 'Beta', 'This links back to [[Alpha]]');

  // Open Alpha by title (reliable, doesn't depend on sidebar visibility)
  await openNoteByTitle(page, 'Alpha');
  await waitForEditor(page);
  await page.waitForTimeout(800);

  // Step 3: Verify the backlinks panel is visible and shows Beta
  const panel = page.locator('#note-backlinks-panel');
  await expect(panel).toBeVisible({ timeout: 3000 });

  const state = await getBacklinksPanelState(page);
  expect(state.isActive).toBe(true);

  // Check header text mentions backlinks
  const headerText = await getBacklinksHeaderText(page);
  expect(headerText).toContain('BACKLINKS');
  expect(headerText).toContain('1');

  // Check Beta is listed as a backlink
  const backlinkTitles = await getBacklinkTitles(page);
  expect(backlinkTitles).toContain('Beta');

  // Step 4: Click the Beta backlink and verify it navigates
  await clickBacklinkByTitle(page, 'Beta');
  await page.waitForTimeout(800);

  // The editor should now show Beta's content
  const titleInput = page.locator('#active-note-title');
  await expect(titleInput).toBeVisible({ timeout: 3000 });
  await expect(titleInput).toHaveValue('Beta', { timeout: 3000 });

  // Verify Beta's content persisted
  const betaContent = getFirstBlock(page);
  await expect(betaContent).toContainText('links back to', { timeout: 3000 });

  await closeEditor(page);
});

// ══════════════════════════════════════════
// Test 2: Bidirectional backlinks - both directions work
// ══════════════════════════════════════════
test('2. Backlinks appear in both directions for bidirectional wiki links', async ({ page }) => {
  // Create three notes with wiki links
  await createNoteWithContent(page, 'Alpha', 'Links to [[Beta]]');
  await createNoteWithContent(page, 'Beta', 'Links to [[Alpha]]');
  await createNoteWithContent(page, 'Gamma', 'Links to [[Alpha]] and [[Beta]]');

  // ---- Direction A: Open Alpha, verify backlinks from Beta and Gamma ----
  await openNoteByTitle(page, 'Alpha');
  await waitForEditor(page);
  await page.waitForTimeout(800);

  const panel = page.locator('#note-backlinks-panel');
  await expect(panel).toBeVisible({ timeout: 3000 });

  let state = await getBacklinksPanelState(page);
  expect(state.isActive).toBe(true);

  let headerText = await getBacklinksHeaderText(page);
  expect(headerText).toContain('BACKLINKS');
  // Should have 2 backlinks: Beta and Gamma
  expect(headerText).toMatch(/2\s+references?/i);

  let backlinkTitles = await getBacklinkTitles(page);
  expect(backlinkTitles).toContain('Beta');
  expect(backlinkTitles).toContain('Gamma');
  await closeEditor(page);

  // ---- Direction B: Open Beta, verify backlinks from Alpha and Gamma ----
  await openNoteByTitle(page, 'Beta');
  await waitForEditor(page);
  await page.waitForTimeout(800);

  await expect(panel).toBeVisible({ timeout: 3000 });

  state = await getBacklinksPanelState(page);
  expect(state.isActive).toBe(true);

  headerText = await getBacklinksHeaderText(page);
  expect(headerText).toContain('BACKLINKS');
  expect(headerText).toMatch(/2\s+references?/i);

  backlinkTitles = await getBacklinkTitles(page);
  expect(backlinkTitles).toContain('Alpha');
  expect(backlinkTitles).toContain('Gamma');

  await closeEditor(page);
});

// ══════════════════════════════════════════
// Test 3: Backlinks panel stays empty when no wiki links exist
// ══════════════════════════════════════════
test('3. Backlinks panel is empty when no notes link to the current note', async ({ page }) => {
  // Create a note with no wiki links
  await createNoteWithContent(page, 'Lone Note', 'This note has no wiki links referencing it.');

  // Create another note that does NOT link to Lone Note
  await createNoteWithContent(page, 'Another Note', 'This note links to nothing in particular.');

  // Open Lone Note by title
  await openNoteByTitle(page, 'Lone Note');
  await waitForEditor(page);
  await page.waitForTimeout(600);

  // Verify the backlinks panel exists but is empty (has class 'empty')
  const state = await getBacklinksPanelState(page);
  expect(state.exists).toBe(true);
  expect(state.isEmpty).toBe(true);
  expect(state.isActive).toBe(false);

  const backlinkTitles = await getBacklinkTitles(page);
  expect(backlinkTitles.length).toBe(0);

  await closeEditor(page);
});

// ══════════════════════════════════════════
// Test 4: Backlinks disappear when wiki link is removed
// ══════════════════════════════════════════
test('4. Backlinks panel updates when wiki links are removed', async ({ page }) => {
  // Create both notes with bidirectional wiki links
  await createNoteWithContent(page, 'Alpha', 'This references [[Beta]]');
  await createNoteWithContent(page, 'Beta', 'This references [[Alpha]]');

  // Open Beta and verify Alpha shows as backlink
  await openNoteByTitle(page, 'Beta');
  await waitForEditor(page);
  await page.waitForTimeout(800);

  // Verify Alpha appears as a backlink
  let backlinkTitles = await getBacklinkTitles(page);
  expect(backlinkTitles).toContain('Alpha');
  await closeEditor(page);

  // Open Alpha and remove the wiki link content
  await openNoteByTitle(page, 'Alpha');
  await waitForEditor(page);
  await page.waitForTimeout(500);

  const block = getFirstBlock(page);
  await block.click();
  await block.fill('This no longer references anything.');
  // Wait for auto-save + MetadataCache update
  await page.waitForTimeout(1500);
  await closeEditor(page);

  // Re-open Beta and verify Alpha no longer appears as a backlink
  await openNoteByTitle(page, 'Beta');
  await waitForEditor(page);
  await page.waitForTimeout(800);

  backlinkTitles = await getBacklinkTitles(page);
  // Alpha should no longer appear as a backlink (its wiki link to Beta was removed)
  expect(backlinkTitles).not.toContain('Alpha');

  await closeEditor(page);
});

// ══════════════════════════════════════════
// Test 5: Backlinks panel navigates to the correct note on click
// ══════════════════════════════════════════
test('5. Clicking a backlink navigates to the linked note and shows correct backlinks', async ({ page }) => {
  // Create a triangle: A → [[B]], B → [[C]], C → [[A]]
  await createNoteWithContent(page, 'A', 'Links to [[B]]');
  await createNoteWithContent(page, 'B', 'Links to [[C]]');
  await createNoteWithContent(page, 'C', 'Links to [[A]]');

  // Open A - should show backlink from C
  await openNoteByTitle(page, 'A');
  await waitForEditor(page);
  await page.waitForTimeout(800);

  // A's backlinks: C (C links to A) - not B (A links to B, but B doesn't link back to A)
  let backlinkTitles = await getBacklinkTitles(page);
  expect(backlinkTitles).toContain('C');
  expect(backlinkTitles).not.toContain('B');

  // Click on C's backlink to navigate to C
  await clickBacklinkByTitle(page, 'C');
  await page.waitForTimeout(800);

  // Verify we're now viewing C
  const titleInput = page.locator('#active-note-title');
  await expect(titleInput).toHaveValue('C', { timeout: 3000 });

  // C's backlinks: B (B links to C)
  backlinkTitles = await getBacklinkTitles(page);
  expect(backlinkTitles).toContain('B');

  // Click B's backlink to navigate to B
  await clickBacklinkByTitle(page, 'B');
  await page.waitForTimeout(800);

  await expect(titleInput).toHaveValue('B', { timeout: 3000 });

  // B's backlinks: A (A links to B)
  backlinkTitles = await getBacklinkTitles(page);
  expect(backlinkTitles).toContain('A');

  await closeEditor(page);
});

// ══════════════════════════════════════════
// Test 6: Backlinks are cleaned up when a linked note is permanently deleted
// ══════════════════════════════════════════
test('6. Permanently deleting a note removes it from backlinks and cleans MetadataCache', async ({ page }) => {
  // Create two notes with bidirectional wiki links
  await createNoteWithContent(page, 'Alpha', 'This references [[Beta]]');
  await createNoteWithContent(page, 'Beta', 'This references [[Alpha]]');

  // Open Alpha and verify Beta shows as a backlink
  await openNoteByTitle(page, 'Alpha');
  await waitForEditor(page);
  await page.waitForTimeout(800);

  let backlinkTitles = await getBacklinkTitles(page);
  expect(backlinkTitles).toContain('Beta');

  // Save Beta's ID and permanently delete it via page.evaluate
  // (deleteNotePermanently uses confirm() which blocks in E2E, so we
  //  directly exercise the MetadataCache.removeNote() path)
  const deleted = await page.evaluate(() => {
    try {
      const betaNote = window.State.NOTES.find(n => n.title === 'Beta');
      if (!betaNote) return { success: false, error: 'Beta note not found' };

      const betaId = betaNote.id;
      const idx = window.State.NOTES.indexOf(betaNote);
      if (idx !== -1) window.State.NOTES.splice(idx, 1);

      if (window.MetadataCache && window.MetadataCache.removeNote) {
        window.MetadataCache.removeNote(betaId);
      }

      if (window.saveData) window.saveData();

      // Verify cleanup:
      // - linkIndex still has 'beta' because Alpha still links to [[Beta]] in content
      // - linkIndex 'alpha' should be GONE because Beta was the only note linking to [[Alpha]]
      const linkIndexHasBeta = window.MetadataCache.linkIndex.has('beta');
      const linkIndexHasAlpha = window.MetadataCache.linkIndex.has('alpha');
      // backlinks entry for Beta's ID should be gone
      const backlinksHasBeta = window.MetadataCache.backlinks.has(betaId);
      // index entry for Beta should be gone
      const indexHasBeta = window.MetadataCache.index.has(betaId);

      // Also verify Beta's ID is NOT in any other note's backlink set (orphan cleanup)
      var staleBacklinkFound = false;
      window.MetadataCache.backlinks.forEach(function(noteSet) {
          if (noteSet.has(betaId)) {
              staleBacklinkFound = true;
          }
      });

      return {
        success: true,
        linkIndexPreservesBeta: linkIndexHasBeta,
        linkIndexCleanedAlpha: !linkIndexHasAlpha,
        backlinksCleaned: !backlinksHasBeta,
        noStaleBacklinks: !staleBacklinkFound,
        indexCleaned: !indexHasBeta
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  expect(deleted.success).toBe(true);
  // Alpha still has [[Beta]] in content, so linkIndex for 'beta' should persist
  expect(deleted.linkIndexPreservesBeta).toBe(true);
  // Beta was the only note linking to [[Alpha]], so linkIndex for 'alpha' should be cleaned
  expect(deleted.linkIndexCleanedAlpha).toBe(true);
  // Beta's own backlinks entry should be gone
  expect(deleted.backlinksCleaned).toBe(true);
  // No other backlink set should contain Beta's ID as a stale reference
  expect(deleted.noStaleBacklinks).toBe(true);
  expect(deleted.indexCleaned).toBe(true);

  // Close and re-open Alpha to refresh the panel
  await closeEditor(page);
  await openNoteByTitle(page, 'Alpha');
  await waitForEditor(page);
  await page.waitForTimeout(800);

  // Beta should no longer appear as a backlink
  backlinkTitles = await getBacklinkTitles(page);
  expect(backlinkTitles).not.toContain('Beta');

  // The panel should be empty since only Alpha and Beta exist, and Beta was deleted
  const state = await getBacklinksPanelState(page);
  expect(state.isEmpty).toBe(true);

  await closeEditor(page);
});
