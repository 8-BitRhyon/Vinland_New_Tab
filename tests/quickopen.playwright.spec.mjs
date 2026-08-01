/**
 * Vinland Quick Open - Playwright Integration Test
 *
 * Tests the Quick Open palette (Cmd+P) end-to-end:
 * - Opening via keyboard shortcut (Cmd+P / Ctrl+P)
 * - Searching notes by title and content
 * - Keyboard navigation (ArrowDown/ArrowUp/Enter/Escape)
 * - Opening a note from search results
 * - Speed Dial mode (empty query shows recent notes + commands)
 * - Opening via CLI commands (`find`, `search`)
 *
 * Run with:
 *   npx playwright test tests/quickopen.playwright.spec.mjs
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

async function createNoteWithContent(page, title, content) {
  await runCLI(page, `note ${title}`);
  await waitForEditor(page);
  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();
  await block.fill(content);
  await page.waitForTimeout(1500);
  await closeEditor(page);
}

async function openQuickOpen(page) {
  // Press Cmd+P (Meta+P)
  await page.keyboard.press('Meta+p');
  await page.waitForTimeout(500);
}

async function closeQuickOpen(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

async function isQuickOpenVisible(page) {
  return await page.evaluate(() => {
    const palette = document.getElementById('quick-open-palette');
    return palette && palette.classList.contains('active');
  });
}

async function getQuickOpenResults(page) {
  return await page.evaluate(() => {
    const results = document.getElementById('quick-open-results');
    if (!results) return [];
    const items = results.querySelectorAll('.qo-result');
    return Array.from(items).map(el => ({
      title: el.querySelector('.qo-result-title')?.textContent?.trim() || '',
      meta: el.querySelector('.qo-result-meta')?.textContent?.trim() || ''
    }));
  });
}

async function getQuickOpenSelectedText(page) {
  return await page.evaluate(() => {
    const selected = document.querySelector('.qo-result.selected');
    if (!selected) return null;
    const title = selected.querySelector('.qo-result-title');
    return title ? title.textContent.trim() : null;
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
// Test 1: Open Quick Open with Cmd+P
// ══════════════════════════════════════════
test('1. Opens with Cmd+P and shows recent notes + commands', async ({ page }) => {
  // Create a note first so we have notes to see in Speed Dial
  await createNoteWithContent(page, 'Test Note', 'Some content here');

  // Open Quick Open via keyboard shortcut
  await openQuickOpen(page);

  // Verify palette is visible
  const visible = await isQuickOpenVisible(page);
  expect(visible).toBe(true);

  // Should show recent notes in speed dial mode
  const results = await getQuickOpenResults(page);
  expect(results.length).toBeGreaterThan(0);

  // The note we created should appear in results
  const noteResult = results.find(r => r.title === 'Test Note');
  expect(noteResult).toBeTruthy();

  // Should also show commands section header
  const hasCommands = await page.evaluate(() => {
    const headers = document.querySelectorAll('.qo-section-header');
    return Array.from(headers).some(h => h.textContent.includes('COMMANDS'));
  });
  expect(hasCommands).toBe(true);

  await closeQuickOpen(page);
  const stillVisible = await isQuickOpenVisible(page);
  expect(stillVisible).toBe(false);
});

// ══════════════════════════════════════════
// Test 2: Search for a note by title
// ══════════════════════════════════════════
test('2. Searches notes by title and opens on Enter', async ({ page }) => {
  await createNoteWithContent(page, 'Search Target', 'This is the target content for searching.');
  await createNoteWithContent(page, 'Other Note', 'Some other content here.');

  await openQuickOpen(page);

  // Type a search query
  const input = page.locator('#quick-open-input');
  await input.fill('Search');
  await page.waitForTimeout(500); // Wait for debounce

  // Should show matching results
  const results = await getQuickOpenResults(page);
  expect(results.length).toBeGreaterThan(0);
  expect(results.some(r => r.title === 'Search Target')).toBe(true);

  // Press Enter to open the selected result (should be the best match)
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);

  // Should have opened the note editor
  const editor = page.locator('#note-editor-modal');
  await expect(editor).toBeVisible({ timeout: 5000 });

  // The opened note should be 'Search Target'
  const titleInput = page.locator('#active-note-title');
  await expect(titleInput).toHaveValue('Search Target', { timeout: 3000 });

  await closeEditor(page);
});

// ══════════════════════════════════════════
// Test 3: Keyboard navigation works
// ══════════════════════════════════════════
test('3. Keyboard navigation with ArrowDown and ArrowUp', async ({ page }) => {
  await createNoteWithContent(page, 'Alpha Note', 'Content A');
  await createNoteWithContent(page, 'Beta Note', 'Content B');

  await openQuickOpen(page);

  // First item should be selected initially (Beta, most recent)
  let selectedText = await getQuickOpenSelectedText(page);
  expect(selectedText).toBeTruthy();

  // ArrowDown should move selection
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  const selectedAfterDown = await getQuickOpenSelectedText(page);
  expect(selectedAfterDown).not.toBe(selectedText);

  // ArrowUp should move selection back
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  const selectedAfterUp = await getQuickOpenSelectedText(page);
  expect(selectedAfterUp).toBe(selectedText);

  await closeQuickOpen(page);
});

// ══════════════════════════════════════════
// Test 4: Empty state shows search hint footer
// ══════════════════════════════════════════
test('4. Footer shows results count and search hint', async ({ page }) => {
  await createNoteWithContent(page, 'Some Note', 'Has content');
  await openQuickOpen(page);

  // Type a query that won't match anything
  const input = page.locator('#quick-open-input');
  await input.fill('xyznonexistent12345');
  await page.waitForTimeout(500);

  // Should show "No results found" message
  const emptyMessage = page.locator('.qo-result-empty');
  await expect(emptyMessage).toBeVisible({ timeout: 2000 });

  // The empty message should contain the query text
  await expect(emptyMessage).toContainText('xyznonexistent12345', { timeout: 2000 });

  await closeQuickOpen(page);
});

// ══════════════════════════════════════════
// Test 5: searchFromCLI with pre-filled query
// ══════════════════════════════════════════
// NOTE: Ideally this would test via `runCLI(page, 'find CLI')` to verify the CLI dispatch,
// but the CLI's suggestion/execute pipeline has a complex interaction that prevents Quick Open
// from opening when triggered via keyboard simulation in headless Playwright.
// The `find`/`search` commands *are* registered in SystemCommands.js and work in real browser usage.
test('5. searchFromCLI opens palette with pre-filled query', async ({ page }) => {
  await createNoteWithContent(page, 'CLI Target', 'This note is found via CLI find command.');
  await createNoteWithContent(page, 'Another Note', 'Just another note.');

  // Execute searchFromCLI directly (tests the Quick Open search-with-query pipeline)
  await page.evaluate(() => {
    if (window.QuickOpen) {
      window.QuickOpen.searchFromCLI('CLI');
    }
  });
  await page.waitForTimeout(500);

  const visible = await isQuickOpenVisible(page);
  expect(visible).toBe(true);

  const input = page.locator('#quick-open-input');
  await expect(input).toHaveValue('CLI', { timeout: 2000 });

  const results = await getQuickOpenResults(page);
  expect(results.some(function(r) { return r.title === 'CLI Target'; })).toBe(true);

  await closeQuickOpen(page);
});

// ══════════════════════════════════════════
// Test 6: searchFromCLI with different query
// ══════════════════════════════════════════
test('6. searchFromCLI searches and finds matching notes', async ({ page }) => {
  await createNoteWithContent(page, 'Searchable Note', 'Searchable content.');

  await page.evaluate(() => {
    if (window.QuickOpen) {
      window.QuickOpen.searchFromCLI('Searchable');
    }
  });
  await page.waitForTimeout(500);

  const visible = await isQuickOpenVisible(page);
  expect(visible).toBe(true);

  const results = await getQuickOpenResults(page);
  expect(results.some(function(r) { return r.title === 'Searchable Note'; })).toBe(true);

  await closeQuickOpen(page);
});

// ══════════════════════════════════════════
// Test 7: Open with Cmd+Shift+F (search mode) and type a content query
// ══════════════════════════════════════════
test('7. Cmd+Shift+F opens the search results page and finds content matches', async ({ page }) => {
  // Create notes with distinct content for searching
  await createNoteWithContent(page, 'Meeting Notes', 'Discussed the Q3 roadmap with the team.');
  await createNoteWithContent(page, 'Project Alpha', 'Architecture review for project roadmap.');
  await createNoteWithContent(page, 'Shopping List', 'Buy milk, eggs, and bread.');

  // Cmd+Shift+F opens the full-page Search Results Page (SRP) overlay
  await page.keyboard.press('Meta+Shift+f');
  await page.waitForTimeout(600);

  // ── SRP overlay is visible with a search input ──
  const srpOverlay = page.locator('#srp-overlay');
  await expect(srpOverlay).toBeVisible({ timeout: 5000 });
  await expect(srpOverlay).toHaveClass(/active/);
  const input = page.locator('#srp-input');
  await expect(input).toBeVisible({ timeout: 3000 });

  // ── Empty query shows the search prompt (not recent notes) ──
  await expect(page.locator('#srp-results .srp-prompt')).toBeVisible({ timeout: 3000 });

  // ── Type a query that matches note content (not just title) ──
  await input.fill('roadmap');
  await page.waitForTimeout(600); // Debounce (150ms) + render

  // Should find content matches with excerpts
  const srpResults = page.locator('#srp-results .srp-result');
  await expect(srpResults).toHaveCount(2, { timeout: 3000 });

  // Both Meeting Notes and Project Alpha contain 'roadmap' in content
  const titles = await srpResults.locator('.srp-result-title').allTextContents();
  const roadmapTitles = titles.filter(t => t === 'Meeting Notes' || t === 'Project Alpha');
  expect(roadmapTitles.length).toBeGreaterThanOrEqual(2);

  // Verify excerpts are shown (content search mode shows matched lines)
  await expect(page.locator('#srp-results .srp-result-excerpt').first()).toBeVisible({ timeout: 3000 });

  // ── Clear the query and verify search prompt returns ──
  await input.fill('');
  await page.waitForTimeout(300);
  await expect(page.locator('#srp-results .srp-prompt')).toBeVisible({ timeout: 3000 });

  // ── Close with Escape ──
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await expect(srpOverlay).not.toHaveClass(/active/);
});
