/**
 * Vinland Version History — Playwright Integration Test
 *
 * Tests the git-based note versioning system:
 * - Auto-snapshots on save
 * - Version timeline display in the editor panel
 * - Diff viewer showing changes between versions
 * - Rollback to restore previous content
 *
 * Run with:
 *   npx playwright test tests/version-history.playwright.spec.mjs
 */

import { test, expect } from '@playwright/test';
import { APP_URL, runCLI, waitForEditor, closeEditor, getFirstBlock } from './helpers.mjs';

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);

  // Clear all persisted data and version history
  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith('OPERATOR_') || k.startsWith('VINLAND_')
    );
    keys.forEach(k => localStorage.removeItem(k));
    if (window.State) {
      if (Array.isArray(window.State.NOTES)) window.State.NOTES.length = 0;
      if (Array.isArray(window.State.TASKS)) window.State.TASKS.length = 0;
      if (Array.isArray(window.State.BOARDS)) window.State.BOARDS.length = 0;
    }
    // Clear IndexedDB version history
    if (window.VersionHistoryManager && window.VersionHistoryManager.clearAll) {
      window.VersionHistoryManager.clearAll();
    }
  });

  await page.waitForTimeout(300);

  // Accept any confirm() dialogs that might appear during tests
  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    try {
      const keys = Object.keys(localStorage).filter(k =>
        k.startsWith('OPERATOR_') || k.startsWith('VINLAND_')
      );
      keys.forEach(k => localStorage.removeItem(k));
      if (window.VersionHistoryManager && window.VersionHistoryManager.clearAll) {
        window.VersionHistoryManager.clearAll();
      }
    } catch { /* ignore */ }
  }).catch(() => {});
});

// ════════════════════════════════════════════════════════════
// Test 1: Auto-snapshot captures versions on each save
// ════════════════════════════════════════════════════════════
test('1. Auto-snapshots are created on each save and listed in version panel', async ({ page }) => {
  // ── 1a. Create a note ──
  await runCLI(page, 'note Version Test Note');
  await waitForEditor(page);

  // ── 1b. Type initial content and save ──
  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();
  await block.fill('Version 1 content');
  // Trigger save via Cmd+S
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);

  // ── 1c. Edit content again and save ──
  await block.click();
  await block.fill('Version 2 content');
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);

  // ── 1d. Edit content a third time and save ──
  await block.click();
  await block.fill('Version 3 content');
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);

  // ── 1e. Open version history panel ──
  const versionPanel = page.locator('#note-version-history');
  await versionPanel.waitFor({ state: 'visible', timeout: 5000 });

  // Verify 3 version entries appear
  const versionItems = page.locator('.version-item');
  await expect(versionItems).toHaveCount(3);

  // ── 1f. Close editor ──
  await closeEditor(page);
});

// ════════════════════════════════════════════════════════════
// Test 2: Version panel shows timestamps and snapshot messages
// ════════════════════════════════════════════════════════════
test('2. Version items display timestamps and auto-generated messages', async ({ page }) => {
  await runCLI(page, 'note Timestamp Test');
  await waitForEditor(page);

  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();
  await block.fill('Initial content for timestamp test.');
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);

  // Edit again
  await block.click();
  await block.fill('Edited content.');
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);

  // Verify version panel shows up
  const versionPanel = page.locator('#note-version-history');
  await versionPanel.waitFor({ state: 'visible', timeout: 5000 });

  // Check timestamps are visible
  const timestamps = page.locator('.version-timestamp');
  const count = await timestamps.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // Check each has a timestamp (not empty)
  for (let i = 0; i < count; i++) {
    const text = await timestamps.nth(i).textContent();
    expect(text.trim().length).toBeGreaterThan(0);
  }

  await closeEditor(page);
});

// ════════════════════════════════════════════════════════════
// Test 3: Clicking a version shows diff view
// ════════════════════════════════════════════════════════════
test('3. Clicking a version in the panel shows diff view with changes', async ({ page }) => {
  await runCLI(page, 'note Diff Test Note');
  await waitForEditor(page);

  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();

  // Create first version
  await block.fill('Original content line one.\nOriginal content line two.');
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);

  // Create second version with significant changes
  await block.click();
  await block.fill('Modified content line one.\nNew content line inserted.\nModified line two.');
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);

  // Open version panel
  const versionPanel = page.locator('#note-version-history');
  await versionPanel.waitFor({ state: 'visible', timeout: 5000 });

  // Click the DIFF button on the oldest version (last in newest-first list)
  // The click handler is on .version-diff-btn, not on .version-item
  const diffButtons = page.locator('.version-diff-btn');
  const btnCount = await diffButtons.count();
  expect(btnCount).toBeGreaterThanOrEqual(2);
  
  // Click the LAST diff button (oldest version in newest-first ordering)
  await diffButtons.nth(btnCount - 1).click();
  await page.waitForTimeout(500);

  // Diff container should now be visible
  const diffContainer = page.locator('#version-diff-view');
  await expect(diffContainer).toBeVisible({ timeout: 3000 });

  // Should show some diff content (added/removed lines)
  const diffContent = await diffContainer.textContent();
  expect(diffContent.length).toBeGreaterThan(0);

  await closeEditor(page);
});

// ════════════════════════════════════════════════════════════
// Test 4: Rollback restores note to a previous version
// ════════════════════════════════════════════════════════════
test('4. Rolling back to a version restores the note content', async ({ page }) => {
  await runCLI(page, 'note Rollback Test Note');
  await waitForEditor(page);

  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();

  // Create version 1
  await block.fill('Version 1: This is the original content.');
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);

  // Create version 2
  await block.click();
  await block.fill('Version 2: This is modified content that should be rolled back.');
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);

  // Create version 3
  await block.click();
  await block.fill('Version 3: This is the latest content.');
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);

  // Open version panel
  const versionPanel = page.locator('#note-version-history');
  await versionPanel.waitFor({ state: 'visible', timeout: 5000 });

  // Click the restore button on the oldest version (last in newest-first list)
  const restoreButtons = page.locator('.version-restore-btn');
  const btnCount = await restoreButtons.count();
  expect(btnCount).toBeGreaterThanOrEqual(3);

  // The last restore button corresponds to the oldest version (Version 1)
  await restoreButtons.nth(btnCount - 1).click();
  await page.waitForTimeout(600);

  // The note should now have the Version 1 content
  // Read the current content via evaluate
  const currentContent = await page.evaluate(() => {
    const note = window.State.NOTES.find(n => n.title === 'Rollback Test Note');
    return note ? note.content : '';
  });

  expect(currentContent).toContain('Version 1: This is the original content.');

  await closeEditor(page);
});

// ════════════════════════════════════════════════════════════
// Test 5: Versions command and history modal work
// ════════════════════════════════════════════════════════════
test('5. Versions CLI command opens version history modal for the active note', async ({ page }) => {
  await runCLI(page, 'note Version Cmd Test');
  await waitForEditor(page);

  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();
  await block.fill('Content for version command test.');
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);

  // Use the versions CLI command
  await page.keyboard.press('Escape'); // Ensure no other modals are open
  await page.waitForTimeout(300);
  await runCLI(page, 'versions');

  // Wait for the version history modal to appear
  const versionModal = page.locator('#version-history-modal');
  await expect(versionModal).toBeVisible({ timeout: 5000 });

  // Should show at least one version entry in the modal
  // Wait for the async version loading to complete
  // Note: modal uses .version-modal-item (not .version-item) for its entries
  await page.waitForTimeout(1000);
  const modalItems = page.locator('#version-history-modal .version-modal-item');
  await expect(modalItems).toHaveCount(1);

  // Close modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Editor was already closed before opening the modal, so no need to closeEditor
});

// ════════════════════════════════════════════════════════════
// Test 6: H5 compaction — prune() removes orphans + trims oversized stores
// ════════════════════════════════════════════════════════════
test('6. H5 prune removes orphaned stores and trims oversized stores to the cap', async ({ page }) => {
  // Create a live note so it exists in State.NOTES
  await runCLI(page, 'note Prune Test Note');
  await waitForEditor(page);
  const noteId = await page.evaluate(() => window.State.NOTES[0].id);

  // Seed IndexedDB directly: 60 versions for the live note (over the 50 cap)
  // plus an orphan store for a note id that no longer exists.
  await page.evaluate(async (id) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('OPERATOR_VERSIONS', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('versions', 'readwrite');
    const store = tx.objectStore('versions');

    const versions = [];
    for (let i = 0; i < 60; i++) {
      versions.push({ id: 'v' + i, timestamp: Date.now() - (60 - i) * 1000, title: 'Prune Test Note', content: 'content ' + i, blocks: [], message: 'seed ' + i });
    }
    store.put(versions, id);
    // Orphan: a store whose note was deleted without removeNote()
    store.put([{ id: 'orphan_v1', timestamp: Date.now(), title: 'Ghost', content: 'x', blocks: [], message: 'orphan' }], 'ghost_note_id');
    await new Promise((resolve) => { tx.oncomplete = resolve; });
  }, noteId);

  // Run the compaction
  const stats = await page.evaluate(() => window.VersionHistoryManager.prune());

  // Orphan removed, oversized store trimmed to 50
  expect(stats.removed).toBe(1);
  expect(stats.trimmed).toBe(1);

  const liveCount = await page.evaluate((id) => new Promise((resolve) => {
    const req = indexedDB.open('OPERATOR_VERSIONS', 1);
    req.onsuccess = () => {
      const tx = req.result.transaction('versions', 'readonly');
      const getReq = tx.objectStore('versions').get(id);
      getReq.onsuccess = () => resolve((getReq.result || []).length);
    };
  }), noteId);
  expect(liveCount).toBe(50);

  const orphanCount = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('OPERATOR_VERSIONS', 1);
    req.onsuccess = () => {
      const tx = req.result.transaction('versions', 'readonly');
      const getReq = tx.objectStore('versions').get('ghost_note_id');
      getReq.onsuccess = () => resolve(getReq.result === undefined ? 0 : 1);
    };
  }));
  expect(orphanCount).toBe(0);

  await closeEditor(page);
});

// ════════════════════════════════════════════════════════════
// Test 7: No version history shown for notes with no saves
// ════════════════════════════════════════════════════════════
test('7. New note with no saves shows empty version history state', async ({ page }) => {
  await runCLI(page, 'note Empty History Test');
  await waitForEditor(page);

  // Immediately check version panel without saving
  const versionPanel = page.locator('#note-version-history');

  // Wait for panel to render (async version loading or empty state)
  await page.waitForTimeout(1000);

  // Panel exists in DOM
  await expect(versionPanel).toHaveCount(1);

  // Verify empty state via text content (panel is display:none when empty via CSS)
  const emptyText = await page.evaluate(() => {
    const el = document.querySelector('.version-empty');
    return el ? el.textContent : null;
  });
  expect(emptyText).toContain('No version history');

  // No version items
  const items = page.locator('.version-item');
  await expect(items).toHaveCount(0);

  await closeEditor(page);
});
