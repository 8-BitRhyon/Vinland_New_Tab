/**
 * Vinland Kanban link persistence - Playwright Integration Test
 *
 * Regression guard for the two-storage consistency bug: creating/linking a
 * kanban board updates the note's `kanban_ref` block in memory but the note
 * was not persisted at link time (only the board in State.BOARDS was). If the
 * tab closed before the debounced autosave fired, the note lost its reference
 * and the board was orphaned.
 *
 * This asserts the note shard in localStorage carries the KANBAN marker
 * IMMEDIATELY after linking - i.e. saveData() ran at link time, not later.
 *
 * Run with:
 *   npx playwright test tests/kanban-persist.playwright.spec.mjs
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

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith('OPERATOR_NOTE_') ||
      k === 'OPERATOR_NOTES_INDEX' ||
      k.startsWith('OPERATOR_BOARDS_')
    );
    keys.forEach((k) => localStorage.removeItem(k));
    if (window.ModalManager) window.ModalManager.closeAll();
    if (window.State && window.State.CONFIG) window.State.CONFIG.first_run = false;
    if (window.State) window.State.NOTES.length = 0;
  });
  await page.waitForTimeout(300);
});

test('kanban board link persists to the note immediately (no orphan)', async ({ page }) => {
  await runCLI(page, 'note KanbanPersist');
  const editor = await waitForEditor(page);

  // Open the slash menu via the block drag handle (deterministic trigger).
  await editor.locator('.block-drag-handle').first().click();
  const kanbanItem = page.locator('.slash-item[data-cmd="kanban"]');
  await expect(kanbanItem).toBeVisible({ timeout: 5000 });
  await kanbanItem.click(); // runs the kanban command -> opens input modal

  // The CREATE BOARD input modal should appear.
  const modal = page.locator('#input-modal');
  await expect(modal).toHaveClass(/active/, { timeout: 5000 });

  await page.fill('#input-modal-field', 'My Board');
  await page.keyboard.press('Enter'); // confirm -> createBoard + link + saveData

  await page.waitForTimeout(300);

  // The note shard must already contain the KANBAN marker - proving the link
  // was persisted synchronously at link time, not via a later autosave.
  const persisted = await page.evaluate(() => {
    const note = window.State.NOTES.find((n) => n.title === 'KanbanPersist');
    if (!note) return false;
    const raw = localStorage.getItem('OPERATOR_NOTE_' + note.id);
    return !!raw && raw.includes('%%KANBAN:');
  });
  expect(persisted).toBe(true);

  // And the board is reachable from the note after a reload (true persistence).
  await closeEditor(page);
  await page.reload();
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  const boardLinkedAfterReload = await page.evaluate(() => {
    const note = window.State.NOTES.find((n) => n.title === 'KanbanPersist');
    if (!note) return false;
    return (note.content || '').includes('%%KANBAN:');
  });
  expect(boardLinkedAfterReload).toBe(true);
});
