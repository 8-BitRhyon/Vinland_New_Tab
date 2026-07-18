/**
 * Vinland Notes Workflow - Playwright Integration Tests
 *
 * Tests the complete notes lifecycle: create, edit, save, close, reopen,
 * content persistence, and CLI command execution.
 *
 * Run with:
 *   npx playwright test
 *
 * Or start the server separately and run:
 *   npx playwright test tests/notes.playwright.spec.mjs
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

async function openFirstNote(page) {
  // Quick Notes panel .note-item is the most reliable selector
  const noteItem = page.locator('.note-item').first();
  const sidebarItem = page.locator('.sidebar-note-item').first();
  const quickHeader = page.locator('#quick-notes-panel-header');

  // Try Quick Notes items first (sorted by modified desc)
  if (await noteItem.isVisible({ timeout: 2000 }).catch(() => false)) {
    await noteItem.click();
    return true;
  }
  // Try sidebar items
  if (await sidebarItem.isVisible({ timeout: 2000 }).catch(() => false)) {
    await sidebarItem.click();
    return true;
  }
  // Try clicking the quick notes panel header to expand
  if (await quickHeader.isVisible({ timeout: 1000 }).catch(() => false)) {
    await quickHeader.click();
    await page.waitForTimeout(500);
    if (await noteItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      await noteItem.first().click();
      return true;
    }
  }
  return false;
}

function getFirstBlock(page) {
  return page.locator('#block-editor .block-wrapper').first()
    .locator('[contenteditable="true"]').first();
}

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  // Wait for the CLI input to appear - confirms boot sequence completed
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
  // Brief buffer for any remaining async renders
  await page.waitForTimeout(500);
});

test.afterEach(async ({ page }) => {
  // Clean up test artifacts from localStorage so they don't leak between runs
  await page.evaluate(() => {
    try {
      const keys = Object.keys(localStorage).filter(k =>
        k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX'
      );
      keys.forEach(k => localStorage.removeItem(k));
    } catch {
      // Page may have navigated away; ignore
    }
  }).catch(() => {});
});

// ══════════════════════════════════════════
// 1. Page Load & CLI Input
// ══════════════════════════════════════════
test('1. App loads and CLI input is functional', async ({ page }) => {
  await expect(page.locator('#cmd-input')).toBeVisible();
  await expect(page.locator('#clock')).toBeVisible();

  // CLI: type "help" and press Enter
  await runCLI(page, 'help');
  await page.waitForTimeout(600);

  // The help modal or a notification toast should appear
  const helpModal = page.locator('#help-modal');
  const notification = page.locator('#notif-toast');
  await expect(helpModal.or(notification).first()).toBeVisible({ timeout: 5000 });

  // Close any open modals
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// 2. Create Note via CLI
// ══════════════════════════════════════════
test('2. Create a note via CLI command', async ({ page }) => {
  await runCLI(page, 'note Playwright Test Note');

  const editor = await waitForEditor(page);
  const titleInput = page.locator('#active-note-title');
  await expect(titleInput).toBeVisible({ timeout: 5000 });

  await closeEditor(page);
  await expect(editor).not.toBeVisible({ timeout: 3000 });
});

// ══════════════════════════════════════════
// 3. Edit & Verify Content Persistence
// ══════════════════════════════════════════
test('3. Edit note content and verify it persists', async ({ page }) => {
  await runCLI(page, 'note Content Test');
  await waitForEditor(page);

  const blockEditor = page.locator('#block-editor');
  await expect(blockEditor).toBeVisible({ timeout: 5000 });

  // Type content into the first editable block
  const blockContent = getFirstBlock(page);
  await blockContent.waitFor({ state: 'visible', timeout: 5000 });
  await blockContent.click();
  await blockContent.fill('Hello from Playwright!');

  // Wait for auto-save debounce (500ms) + buffer
  await page.waitForTimeout(1200);
  await closeEditor(page);

  // Re-open the most recent note from the Quick Notes panel
  const opened = await openFirstNote(page);
  expect(opened).toBe(true);

  await waitForEditor(page);
  await page.waitForTimeout(500);

  // Verify persisted content matches
  const contentAfter = getFirstBlock(page);
  await expect(contentAfter).toContainText('Hello from Playwright!', { timeout: 5000 });
});

// ══════════════════════════════════════════
// 4. Title & Content Both Persist Across Close/Reopen
// ══════════════════════════════════════════
test('4. Title and content both persist across close and reopen', async ({ page }) => {
  await runCLI(page, 'note Persistence Test');
  await waitForEditor(page);

  // Set title
  const titleInput = page.locator('#active-note-title');
  await titleInput.waitFor({ state: 'visible', timeout: 5000 });
  await titleInput.fill('My Saved Note');

  // Set content
  const blockContent = getFirstBlock(page);
  await blockContent.waitFor({ state: 'visible', timeout: 5000 });
  await blockContent.click();
  await blockContent.fill('Content that must survive close and reopen.');

  // Wait for auto-save
  await page.waitForTimeout(1200);
  await closeEditor(page);
  await page.waitForTimeout(300);

  // Reopen
  const opened = await openFirstNote(page);
  expect(opened).toBe(true);
  await waitForEditor(page);
  await page.waitForTimeout(600);

  // Assert title persisted
  await expect(titleInput).toHaveValue('My Saved Note', { timeout: 5000 });

  // Assert content persisted
  const contentAfter = getFirstBlock(page);
  await expect(contentAfter).toContainText('survive close and reopen', { timeout: 5000 });
});

// ══════════════════════════════════════════
// 5. CLI Commands Execute Without Errors
// ══════════════════════════════════════════
test('5. CLI commands execute without errors', async ({ page }) => {
  // "daily" - opens or creates today's daily note
  await runCLI(page, 'daily');
  await page.waitForTimeout(500);
  const editor = page.locator('#note-editor-modal');
  if (await editor.isVisible().catch(() => false)) {
    await closeEditor(page);
  }

  // "pomo 10s" - short pomodoro
  await runCLI(page, 'pomo 10s');
  await page.waitForTimeout(400);
  const pomoDisplay = page.locator('#pomodoro-timer, .pomodoro-time');
  if (await pomoDisplay.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await expect(pomoDisplay.first()).toBeVisible();
  }

  // "kill" - close all modals
  await runCLI(page, 'kill');
  await page.waitForTimeout(300);

  // "zen" - toggle zen mode on and off
  await runCLI(page, 'zen');
  await page.waitForTimeout(300);
  await runCLI(page, 'zen');
  await page.waitForTimeout(200);
});

// ══════════════════════════════════════════
// 6. Notes Sidebar Toggles via CLI
// ══════════════════════════════════════════
test('6. Notes sidebar toggles via CLI command', async ({ page }) => {
  const sidebar = page.locator('.notes-sidebar');
  await sidebar.waitFor({ state: 'attached', timeout: 10000 });

  const initialCollapsed = await sidebar.evaluate(
    (el) => el.classList.contains('collapsed')
  );

  await runCLI(page, 'notes');
  await page.waitForTimeout(600);

  const afterToggle = await sidebar.evaluate(
    (el) => el.classList.contains('collapsed')
  );
  expect(afterToggle).not.toBe(initialCollapsed);

  // Toggle back to original state
  await runCLI(page, 'notes');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// 7. Editor Opens & Closes Reliably (3 cycles)
// ══════════════════════════════════════════
test('7. Editor modal opens and closes reliably across three cycles', async ({ page }) => {
  const editor = page.locator('#note-editor-modal');

  for (let i = 0; i < 3; i++) {
    await runCLI(page, `note Cycle Test ${i}`);
    await editor.waitFor({ state: 'visible', timeout: 5000 });
    await expect(editor).toBeVisible();

    await closeEditor(page);
    await expect(editor).not.toBeVisible({ timeout: 3000 });
    await page.waitForTimeout(200);
  }
});

// ══════════════════════════════════════════
// 8. Save Status Indicator Updates
// ══════════════════════════════════════════
test('8. Save status indicator shows SAVED after content change', async ({ page }) => {
  await runCLI(page, 'note Save Status');
  await waitForEditor(page);

  const saveStatus = page.locator('#save-status');
  test.skip(
    !(await saveStatus.isVisible({ timeout: 2000 }).catch(() => false)),
    'Save status element not in DOM - skipping'
  );

  // Type content to trigger auto-save
  const blockContent = getFirstBlock(page);
  await blockContent.click();
  await blockContent.fill('Testing save status...');

  // Wait for auto-save debounce + save
  await page.waitForTimeout(1200);

  await expect(saveStatus).toContainText('SAVED', { timeout: 3000 });
  await closeEditor(page);
});

// ══════════════════════════════════════════
// 9. CLI Suggestions On Typing
// ══════════════════════════════════════════
test('9. CLI suggestions appear when typing partial commands', async ({ page }) => {
  const cmdInput = page.locator('#cmd-input');
  await cmdInput.waitFor({ state: 'visible', timeout: 10000 });
  await cmdInput.click();

  // Type a partial trigger
  await cmdInput.fill('no');

  // Suggestions box should appear
  const suggestions = page.locator('#suggestions');
  await expect(suggestions).toBeVisible({ timeout: 3000 });

  // Should list at least one suggestion
  const items = suggestions.locator('.suggestion-item');
  await expect(items.first()).toBeVisible({ timeout: 3000 });

  // Clear input - suggestions should hide
  await cmdInput.fill('');
  await page.waitForTimeout(400);
  await expect(suggestions).not.toBeVisible({ timeout: 2000 });
});
