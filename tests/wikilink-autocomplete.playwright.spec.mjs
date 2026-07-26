/**
 * WikiLink Autocomplete E2E Tests
 *
 * Tests the [[wiki link]] autocomplete feature:
 * - WA1: Type [[ in block editor, verify autocomplete overlay appears
 * - WA2: Filter suggestions by typing more characters
 * - WA3: Select a suggestion with Enter, verify [[Title]] is inserted
 * - WA4: Escape dismisses the autocomplete overlay
 * - WA5: 'No notes match' shown for non-existent query
 *
 * Run with:
 *   npx playwright test tests/wikilink-autocomplete.playwright.spec.mjs
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

async function getBlockContent(page) {
  return await page.evaluate(() => {
    const el = document.querySelector('.block-content[contenteditable="true"]');
    return el ? el.textContent : '';
  });
}

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  // Navigate and wait for app to load
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  // Clear state
  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX' ||
      k.startsWith('OPERATOR_BOARDS_') || k === 'VINLAND_METADATA_CACHE'
    );
    keys.forEach(k => localStorage.removeItem(k));
    if (window.State) {
      window.State.NOTES.length = 0;
      window.State.CONFIG.first_run = false;
    }
    if (window.MetadataCache) {
      window.MetadataCache.index = new Map();
      window.MetadataCache.tagIndex = new Map();
      window.MetadataCache.linkIndex = new Map();
      window.MetadataCache.backlinks = new Map();
    }
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

// ═══════════════════════════════════════════
// WA1: Typing [[ shows autocomplete
// ═══════════════════════════════════════════
test('WA1. Typing [[ in block editor shows autocomplete overlay', async ({ page }) => {
  // Create a note to serve as a link target
  await runCLI(page, 'note Target Note');
  await waitForEditor(page);
  await closeEditor(page);

  // Create a second note where we'll type [[
  await runCLI(page, 'note Source Note');
  await waitForEditor(page);

  // Focus the block content and type [[
  const blockContent = page.locator('.block-content[contenteditable="true"]').first();
  await blockContent.waitFor({ state: 'visible', timeout: 5000 });
  await blockContent.click();
  await page.waitForTimeout(200);

  // Type [[ into the contenteditable
  await blockContent.type('[[');
  await page.waitForTimeout(500);

  // The autocomplete overlay should appear
  const autocomplete = page.locator('#wikilink-autocomplete');
  await expect(autocomplete).toBeVisible({ timeout: 3000 });

  // The overlay should show the note title
  await expect(autocomplete.locator('.wikilink-item-title')).toHaveCount(1);
  await expect(autocomplete.locator('.wikilink-item-title').first()).toContainText('Target Note');

  // Close editor
  await closeEditor(page);
});

// ═══════════════════════════════════════════
// WA2: Typing more characters filters suggestions
// ═══════════════════════════════════════════
test('WA2. Typing partial title filters autocomplete results', async ({ page }) => {
  // Create two target notes
  await runCLI(page, 'note Alpha Project');
  await closeEditor(page);
  await runCLI(page, 'note Beta Project');
  await closeEditor(page);

  // Create source note
  await runCLI(page, 'note My Source');
  await waitForEditor(page);

  // Focus block and type [[
  const blockContent = page.locator('.block-content[contenteditable="true"]').first();
  await blockContent.waitFor({ state: 'visible', timeout: 5000 });
  await blockContent.click();
  await page.waitForTimeout(200);
  await blockContent.type('[[');
  await page.waitForTimeout(500);

  // Should show both notes initially (2 items + 1 header)
  const autocomplete = page.locator('#wikilink-autocomplete');
  await expect(autocomplete).toBeVisible({ timeout: 3000 });
  let items = autocomplete.locator('.wikilink-item[data-note-id]');
  await expect(items).toHaveCount(2);

  // Type 'Alpha' to filter
  await blockContent.type('Alpha');
  await page.waitForTimeout(300);

  // Should only show Alpha Project
  items = autocomplete.locator('.wikilink-item[data-note-id]');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Alpha Project');

  await closeEditor(page);
});

// ═══════════════════════════════════════════
// WA3: Enter selects suggestion, inserting [[Title]]
// ═══════════════════════════════════════════
test('WA3. Enter selects suggestion and inserts [[Title]]', async ({ page }) => {
  // Create a note to link to
  await runCLI(page, 'note Linked Document');
  await closeEditor(page);

  // Create source note
  await runCLI(page, 'note My Document');
  await waitForEditor(page);

  // Focus block and type [[
  const blockContent = page.locator('.block-content[contenteditable="true"]').first();
  await blockContent.waitFor({ state: 'visible', timeout: 5000 });
  await blockContent.click();
  await page.waitForTimeout(200);

  // The block content is empty, so we need to type some text first
  await blockContent.type('Refer to ');
  await page.waitForTimeout(200);

  // Now type [[ to trigger autocomplete
  await blockContent.type('[[');
  await page.waitForTimeout(500);

  // Verify overlay appears
  const autocomplete = page.locator('#wikilink-autocomplete');
  await expect(autocomplete).toBeVisible({ timeout: 3000 });

  // Press Enter to select the first (and only) suggestion
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // The autocomplete should be hidden
  await expect(autocomplete).not.toBeVisible({ timeout: 2000 });

  // The content should now contain [[Linked Document]]
  const content = await getBlockContent(page);
  expect(content).toContain('[[Linked Document]]');

  await closeEditor(page);
});

// ═══════════════════════════════════════════
// WA4: Escape dismisses autocomplete
// ═══════════════════════════════════════════
test('WA4. Escape dismisses the autocomplete overlay', async ({ page }) => {
  // Create a note
  await runCLI(page, 'note Test Note');
  await closeEditor(page);

  // Create source note
  await runCLI(page, 'note Source');
  await waitForEditor(page);

  // Focus block and type [[
  const blockContent = page.locator('.block-content[contenteditable="true"]').first();
  await blockContent.waitFor({ state: 'visible', timeout: 5000 });
  await blockContent.click();
  await page.waitForTimeout(200);
  await blockContent.type('[[');
  await page.waitForTimeout(500);

  // Verify overlay appears
  const autocomplete = page.locator('#wikilink-autocomplete');
  await expect(autocomplete).toBeVisible({ timeout: 3000 });

  // Press Escape to dismiss
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Autocomplete should be hidden
  await expect(autocomplete).not.toBeVisible({ timeout: 2000 });

  // Note: Escape also closes the editor modal (event continues to Input.js handler),
  // so closeEditor() is not needed here.
});

// ═══════════════════════════════════════════
// WA5: Non-existent query shows 'No notes match'
// ═══════════════════════════════════════════
test('WA5. Non-matching query shows "No notes match" message', async ({ page }) => {
  // Create a note
  await runCLI(page, 'note My Note');
  await closeEditor(page);

  // Create source note
  await runCLI(page, 'note Editing');
  await waitForEditor(page);

  // Focus block and type [[
  const blockContent = page.locator('.block-content[contenteditable="true"]').first();
  await blockContent.waitFor({ state: 'visible', timeout: 5000 });
  await blockContent.click();
  await page.waitForTimeout(200);
  await blockContent.type('[[');
  await page.waitForTimeout(500);

  // Type a non-matching query
  await blockContent.type('ZZZ');
  await page.waitForTimeout(300);

  // Should show 'No notes match' message
  const autocomplete = page.locator('#wikilink-autocomplete');
  await expect(autocomplete).toBeVisible({ timeout: 3000 });
  await expect(autocomplete.locator('.wikilink-empty')).toContainText('No notes match');

  await closeEditor(page);
});
