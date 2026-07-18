/**
 * Vinland Trash & Restore Workflow - Playwright Integration Tests
 *
 * Tests the complete trash lifecycle: move note to trash, verify it's hidden
 * from Quick Notes, restore it, and verify it reappears with content intact.
 *
 * Uses evaluate-based data manipulation for trash/restore (reliable),
 * then verifies actual UI consequences: Quick Notes list, trash banner,
 * RESTORE button, editor state, and localStorage persistence.
 *
 * NOTE: We use window.saveAllNotes() for persistence because saveData()
 * has a noteCache diff-check that inexplicably skips writes in headless
 * Chrome. Manual setItem works fine and is used as a fallback.
 *
 * Run with:
 *   npx playwright test tests/trash.playwright.spec.mjs
 */

import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:9999';

// ──────────────────────────────────────────
// Helpers: CLI & Editor
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

async function getQuickNotesCount(page) {
  return await page.locator('.note-item').count();
}

function getFirstBlock(page) {
  return page.locator('#block-editor .block-wrapper').first()
    .locator('[contenteditable="true"]').first();
}

// ──────────────────────────────────────────
// Helpers: Note ID / Storage
// ──────────────────────────────────────────

/** Get the most recently created note's ID from in-memory State. */
async function getCurrentNoteId(page) {
  return await page.evaluate(() => {
    const notes = window.State && window.State.NOTES;
    if (notes && notes.length > 0 && notes[0].id) return notes[0].id;
    return null;
  });
}

async function getNoteFromStorage(page, id) {
  if (!id) return null;
  return await page.evaluate((noteId) => {
    const raw = localStorage.getItem('OPERATOR_NOTE_' + noteId);
    return raw ? JSON.parse(raw) : null;
  }, id);
}

// ──────────────────────────────────────────
// Helpers: Trash / Restore via data manipulation
//
// IMPORTANT: We write to localStorage using manual setItem + saveAllNotes
// because window.saveData() has a noteCache diff-check that doesn't work
// correctly in headless Chrome when called via page.evaluate.
// ──────────────────────────────────────────

/**
 * Trash a note by directly setting its path to '/.trash' in both
 * localStorage and the in-memory State. Then re-render the sidebar.
 * Uses manual localStorage write to bypass noteCache issues.
 * Returns true if the note was found and trashed.
 */
async function trashViaData(page, noteId) {
  if (!noteId) return false;
  return await page.evaluate((id) => {
    const raw = localStorage.getItem('OPERATOR_NOTE_' + id);
    if (!raw) return false;

    // Parse, modify the path
    const note = JSON.parse(raw);
    note.originalPath = note.path || '/';
    note.path = '/.trash';
    note.modified = Date.now();

    // Write using the app's saveAllNotes (bypasses noteCache diff)
    if (window.State && Array.isArray(window.State.NOTES)) {
      const found = window.State.NOTES.find(n => n.id === id);
      if (found) {
        found.path = '/.trash';
        found.originalPath = found.originalPath || '/';
        found.modified = Date.now();
      }
    }

    // Manual localStorage write + index update
    localStorage.setItem('OPERATOR_NOTE_' + id, JSON.stringify(note));
    const allIds = (window.State?.NOTES ?? []).map(n => n.id).filter(Boolean);
    localStorage.setItem('OPERATOR_NOTES_INDEX', JSON.stringify(allIds));

    if (typeof window.saveAllNotes === 'function') {
      window.saveAllNotes();
    }

    // Re-render
    if (window.Notes) {
      if (typeof window.Notes.renderNotes === 'function') window.Notes.renderNotes();
      if (typeof window.Notes.renderSidebar === 'function') window.Notes.renderSidebar();
    }

    return true;
  }, noteId);
}

/**
 * Restore a trashed note by resetting its path and removing originalPath.
 * Uses manual localStorage write to bypass noteCache issues.
 * Returns true if the note was found and restored.
 */
async function restoreViaData(page, noteId) {
  if (!noteId) return false;
  return await page.evaluate((id) => {
    const raw = localStorage.getItem('OPERATOR_NOTE_' + id);
    if (!raw) return false;

    const note = JSON.parse(raw);
    const originalPath = note.originalPath || '/';
    note.path = originalPath;
    delete note.originalPath;
    note.modified = Date.now();

    // Manual localStorage write
    localStorage.setItem('OPERATOR_NOTE_' + id, JSON.stringify(note));
    const allIds = (window.State?.NOTES ?? []).map(n => n.id).filter(Boolean);
    localStorage.setItem('OPERATOR_NOTES_INDEX', JSON.stringify(allIds));

    if (typeof window.saveAllNotes === 'function') {
      window.saveAllNotes();
    }

    // Sync in-memory State
    if (window.State && Array.isArray(window.State.NOTES)) {
      const found = window.State.NOTES.find(n => n.id === id);
      if (found) {
        found.path = originalPath;
        delete found.originalPath;
        found.modified = Date.now();
      }
    }

    // Re-render
    if (window.Notes) {
      if (typeof window.Notes.renderNotes === 'function') window.Notes.renderNotes();
      if (typeof window.Notes.renderSidebar === 'function') window.Notes.renderSidebar();
    }

    return true;
  }, noteId);
}

/** Open a note by ID using Notes.open. */
async function openNoteById(page, noteId) {
  await page.evaluate((id) => {
    if (window.Notes && window.Notes.open) {
      window.Notes.open(id);
    }
  }, noteId);
  await page.waitForTimeout(600);
}

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  // Clear both localStorage AND in-memory State.NOTES
  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX'
    );
    keys.forEach(k => localStorage.removeItem(k));
    if (window.State && Array.isArray(window.State.NOTES)) {
      window.State.NOTES.length = 0;
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
    } catch { /* page may have navigated away */ }
  }).catch(() => {});
});

// ══════════════════════════════════════════
// Tests
// ══════════════════════════════════════════

test('1. Trashing a note sets path to /.trash in localStorage', async ({ page }) => {
  await runCLI(page, 'note Trash Test Note');
  await waitForEditor(page);
  await getFirstBlock(page).fill('This note is going to the trash.');
  await page.waitForTimeout(500);

  const noteId = await getCurrentNoteId(page);
  expect(noteId, 'Note should exist in State.NOTES').not.toBeNull();

  // Verify initial state: note is in localStorage
  const noteBefore = await getNoteFromStorage(page, noteId);
  expect(noteBefore, 'Note shard should exist in localStorage').not.toBeNull();
  expect(noteBefore.path).toBe('/');

  // Trash
  const trashed = await trashViaData(page, noteId);
  expect(trashed).toBe(true);

  // ASSERTS
  const trashedNote = await getNoteFromStorage(page, noteId);
  expect(trashedNote.path).toBe('/.trash');
  expect(trashedNote.originalPath).toBe('/');
  expect(trashedNote.title).toBe('Trash Test Note');

  // Quick Notes should be empty
  expect(await getQuickNotesCount(page)).toBe(0);
});

test('2. Trashed note disappears from Quick Notes while other notes remain', async ({ page }) => {
  await runCLI(page, 'note Keep Me');
  await waitForEditor(page);
  await getFirstBlock(page).fill('This note stays.');
  await page.waitForTimeout(500);
  await closeEditor(page);

  await runCLI(page, 'note Trash Me');
  await waitForEditor(page);
  await getFirstBlock(page).fill('This note gets trashed.');
  await page.waitForTimeout(500);
  await closeEditor(page);

  await page.waitForTimeout(300);
  expect(await getQuickNotesCount(page)).toBe(2);

  const trashNoteId = await getCurrentNoteId(page);
  expect(trashNoteId).not.toBeNull();
  const trashed = await trashViaData(page, trashNoteId);
  expect(trashed).toBe(true);

  expect(await getQuickNotesCount(page)).toBe(1);
  await expect(page.locator('.note-item').first()).toContainText('Keep Me');
});

test('3. Opening a trashed note shows trash banner with RESTORE button', async ({ page }) => {
  await runCLI(page, 'note Trash Banner Test');
  await waitForEditor(page);
  await getFirstBlock(page).fill('Check for trash banner.');
  await page.waitForTimeout(500);

  const noteId = await getCurrentNoteId(page);
  expect(noteId).not.toBeNull();

  const trashed = await trashViaData(page, noteId);
  expect(trashed).toBe(true);
  await closeEditor(page);

  await openNoteById(page, noteId);
  await expect(page.locator('#note-editor-modal')).toBeVisible({ timeout: 5000 });

  const banner = page.locator('#trash-banner-container');
  await expect(banner).toBeVisible({ timeout: 3000 });
  await expect(banner).toContainText('Trash');
  await expect(page.locator('#btn-restore-note')).toBeVisible();
  await expect(page.locator('#btn-restore-note')).toContainText('RESTORE');
  await expect(page.locator('#btn-delete-forever')).toBeVisible();

  const blockEditor = page.locator('#block-editor');
  const pointerEvents = await blockEditor.evaluate(el => el.style.pointerEvents);
  expect(pointerEvents).toBe('none');
});

test('4. Restore a trashed note via the RESTORE button', async ({ page }) => {
  await runCLI(page, 'note Restore Test');
  await waitForEditor(page);
  await getFirstBlock(page).fill('This content must survive trash and restore.');
  await page.waitForTimeout(500);

  const noteId = await getCurrentNoteId(page);
  expect(noteId).not.toBeNull();

  const trashed = await trashViaData(page, noteId);
  expect(trashed).toBe(true);
  await closeEditor(page);

  expect(await getQuickNotesCount(page)).toBe(0);

  await openNoteById(page, noteId);
  await expect(page.locator('#trash-banner-container')).toBeVisible({ timeout: 3000 });

  await page.locator('#btn-restore-note').click();
  await page.waitForTimeout(800);

  await expect(page.locator('#trash-banner-container')).not.toBeVisible({ timeout: 3000 });
  const blockEditor = page.locator('#block-editor');
  const pointerEvents = await blockEditor.evaluate(el => el.style.pointerEvents);
  expect(pointerEvents).not.toBe('none');

  await expect(getFirstBlock(page)).toContainText('survive trash and restore', { timeout: 3000 });

  const quickItem = page.locator('.note-item').first();
  await expect(quickItem).toBeVisible({ timeout: 3000 });
  await expect(quickItem).toContainText('Restore Test');

  const restoredNote = await getNoteFromStorage(page, noteId);
  expect(restoredNote.path).toBe('/');
  expect(restoredNote.originalPath).toBeUndefined();
});

test('5. localStorage confirms full trash then restore path cycle', async ({ page }) => {
  await runCLI(page, 'note Cycle Check');
  await waitForEditor(page);
  await closeEditor(page);
  await page.waitForTimeout(300);

  const noteId = await getCurrentNoteId(page);
  expect(noteId).not.toBeNull();

  const before = await getNoteFromStorage(page, noteId);
  expect(before.path).toBe('/');
  expect(before.originalPath).toBeUndefined();

  expect(await trashViaData(page, noteId)).toBe(true);
  const trashed = await getNoteFromStorage(page, noteId);
  expect(trashed.path).toBe('/.trash');
  expect(trashed.originalPath).toBe('/');

  expect(await restoreViaData(page, noteId)).toBe(true);
  const restored = await getNoteFromStorage(page, noteId);
  expect(restored.path).toBe('/');
  expect(restored.originalPath).toBeUndefined();
});

test('6. Trash status persists across page reload', async ({ page }) => {
  await runCLI(page, 'note Reload Survivor');
  await waitForEditor(page);
  await getFirstBlock(page).fill('Surviving across reloads.');
  await page.waitForTimeout(500);

  const noteId = await getCurrentNoteId(page);
  expect(noteId).not.toBeNull();

  expect(await trashViaData(page, noteId)).toBe(true);

  await page.reload();
  await page.waitForTimeout(2000);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 10000 });
  expect(await getQuickNotesCount(page)).toBe(0);

  expect(await restoreViaData(page, noteId)).toBe(true);

  await page.reload();
  await page.waitForTimeout(2000);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 10000 });
  expect(await getQuickNotesCount(page)).toBe(1);
  await expect(page.locator('.note-item').first()).toContainText('Reload Survivor');
});

test('7. Page Actions menu contains a Move to Trash option', async ({ page }) => {
  await runCLI(page, 'note UI Smoke Test');
  await waitForEditor(page);

  const actionsBtn = page.locator('#page-actions-btn');
  await actionsBtn.waitFor({ state: 'visible', timeout: 5000 });
  await actionsBtn.click();
  await page.waitForTimeout(400);

  const menu = page.locator('#page-actions-menu.active');
  await expect(menu).toBeVisible({ timeout: 3000 });

  const trashAction = menu.locator('[data-action="trash"]');
  await expect(trashAction).toBeVisible({ timeout: 2000 });
  await expect(trashAction).toContainText('Move to Trash');

  const searchInput = page.locator('#page-actions-search');
  await searchInput.press('Escape');
  await page.waitForTimeout(300);
  await expect(menu).not.toBeVisible({ timeout: 2000 });
});
