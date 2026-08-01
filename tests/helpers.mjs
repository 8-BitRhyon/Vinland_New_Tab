/**
 * Vinland Shared E2E Test Helpers
 *
 * Common utilities shared across Playwright spec files to reduce duplication.
 * Import from individual spec files:
 *
 *   import { runCLI, waitForEditor, ... } from './helpers.mjs';
 */

// ──────────────────────────────────────────
// App URL
// ──────────────────────────────────────────

export const APP_URL = 'http://127.0.0.1:9999';

// ──────────────────────────────────────────
// CLI
// ──────────────────────────────────────────

/**
 * Fill the CLI input with a command and press Enter.
 * Used by calendar, export and other tests that require explicit execution.
 */
export async function runCLI(page, command) {
  const cmdInput = page.locator('#cmd-input');
  await cmdInput.waitFor({ state: 'visible', timeout: 10000 });
  await cmdInput.fill(command);
  await cmdInput.press('Enter');
  await page.waitForTimeout(400);
}

/**
 * Fill the CLI input without pressing Enter (shows suggestions only).
 * Used by older tests that trigger execution through other means.
 */
export async function runCLIFillOnly(page, command) {
  const cmdInput = page.locator('#cmd-input');
  await cmdInput.waitFor({ state: 'visible', timeout: 10000 });
  await cmdInput.fill(command);
}

// ──────────────────────────────────────────
// Note Editor
// ──────────────────────────────────────────

export async function waitForEditor(page) {
  const editor = page.locator('#note-editor-modal');
  await editor.waitFor({ state: 'visible', timeout: 8000 });
  return editor;
}

export async function closeEditor(page) {
  const closeBtn = page.locator('#note-editor-close');
  await closeBtn.waitFor({ state: 'visible', timeout: 5000 });
  await closeBtn.click();
  await page.waitForTimeout(400);
}

export function getFirstBlock(page) {
  return page.locator('#block-editor .block-wrapper').first()
    .locator('[contenteditable="true"]').first();
}

export async function createNoteWithContent(page, title, content) {
  await runCLI(page, `note ${title}`);
  await waitForEditor(page);
  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();
  await block.fill(content);
  await page.waitForTimeout(1500);
  await closeEditor(page);
}

/**
 * Create a note with content, then move it to a specific path.
 *
 * Path editing uses the breadcrumb UI (932e68f): the editable path input
 * #note-path-edit is hidden by default and revealed via #breadcrumb-toggle-btn.
 */
export async function createNoteWithContentAndPath(page, title, content, path) {
  await createNoteWithContent(page, title, content);
  // Reopen the existing note by title, then set its path
  await page.evaluate((t) => {
    if (window.Notes) window.Notes.openByTitle(t);
  }, title);
  await page.waitForTimeout(500);
  await waitForEditor(page);
  // Toggle breadcrumb edit mode to reveal the path input
  const bcToggle = page.locator('#breadcrumb-toggle-btn');
  await bcToggle.waitFor({ state: 'visible', timeout: 3000 });
  await bcToggle.click();
  const pathEdit = page.locator('#note-path-edit');
  await pathEdit.waitFor({ state: 'visible', timeout: 3000 });
  await pathEdit.fill(path || '/');
  await pathEdit.press('Enter');
  await page.waitForTimeout(300);
  await closeEditor(page);
}

// ──────────────────────────────────────────
// Data / Download
// ──────────────────────────────────────────

/** Read a Playwright Download as a string. */
export async function readDownload(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// ──────────────────────────────────────────
// Calendar
// ──────────────────────────────────────────

export async function isCalendarVisible(page) {
  return await page.evaluate(() => {
    const modal = document.getElementById('calendar-modal');
    return modal && modal.classList.contains('active');
  });
}

export async function getCalendarTitleText(page) {
  return await page.evaluate(() => {
    const title = document.getElementById('calendar-title');
    return title ? title.textContent.trim() : '';
  });
}

export async function getCalendarFooterText(page) {
  return await page.evaluate(() => {
    const footer = document.getElementById('calendar-footer-count');
    return footer ? footer.textContent.trim() : '';
  });
}

export async function clickDayCell(page, dayNumber) {
  await page.evaluate((day) => {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;
    const cell = grid.querySelector(`.calendar-cell[data-day="${day}"]`);
    if (cell) cell.click();
  }, dayNumber);
  await page.waitForTimeout(600);
}

export async function getDaysWithNotesCount(page) {
  return await page.evaluate(() => {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return 0;
    return grid.querySelectorAll('.calendar-cell.calendar-has-notes').length;
  });
}
