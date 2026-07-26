/**
 * Vinland Calendar View - Playwright Integration Test
 *
 * Tests the Calendar overlay (CLI `calendar` command) end-to-end:
 * - Opening via CLI `calendar` command
 * - Month/year title display and navigation
 * - Previous/next month buttons
 * - TODAY button returns to current month
 * - Days with notes show dot indicators
 * - Clicking a day with no notes creates/opens a daily note
 * - Clicking a day with multiple notes shows the note picker
 * - Keyboard navigation (arrow keys for months, Escape to close)
 * - Cmd+Shift+C keyboard shortcut (standalone and while editor is open)
 *
 * Run with:
 *   npx playwright test tests/calendar.playwright.spec.mjs
 */

import { test, expect } from '@playwright/test';
import {
  APP_URL,
  runCLI,
  waitForEditor,
  closeEditor,
  getFirstBlock,
  createNoteWithContent,
  isCalendarVisible,
  getCalendarTitleText,
  getCalendarFooterText,
  getDaysWithNotesCount,
  clickDayCell
} from './helpers.mjs';

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);

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
// Test 1: Open Calendar via CLI command
// ══════════════════════════════════════════
test('1. Opens calendar via CLI command', async ({ page }) => {
  await runCLI(page, 'calendar');
  await page.waitForTimeout(500);

  const visible = await isCalendarVisible(page);
  expect(visible).toBe(true);

  const now = new Date();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const expectedTitle = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
  const title = await getCalendarTitleText(page);
  expect(title).toBe(expectedTitle);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const stillVisible = await isCalendarVisible(page);
  expect(stillVisible).toBe(false);
});

// ══════════════════════════════════════════
// Test 2: Month navigation buttons
// ══════════════════════════════════════════
test('2. Navigate months with prev/next buttons', async ({ page }) => {
  await runCLI(page, 'calendar');
  await page.waitForTimeout(500);

  const now = new Date();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  await page.locator('#calendar-next-btn').click();
  await page.waitForTimeout(200);

  let nextMonth = now.getMonth() + 1;
  let nextYear = now.getFullYear();
  if (nextMonth > 11) { nextMonth = 0; nextYear++; }
  const expectedNextTitle = `${monthNames[nextMonth]} ${nextYear}`;
  const titleAfterNext = await getCalendarTitleText(page);
  expect(titleAfterNext).toBe(expectedNextTitle);

  await page.locator('#calendar-prev-btn').click();
  await page.waitForTimeout(200);

  const expectedCurrentTitle = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
  const titleAfterPrev = await getCalendarTitleText(page);
  expect(titleAfterPrev).toBe(expectedCurrentTitle);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// Test 3: TODAY button returns to current month
// ══════════════════════════════════════════
test('3. TODAY button jumps to current month', async ({ page }) => {
  await runCLI(page, 'calendar');
  await page.waitForTimeout(500);

  const now = new Date();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const expectedCurrentTitle = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;

  await page.locator('#calendar-next-btn').click();
  await page.waitForTimeout(200);
  await page.locator('#calendar-next-btn').click();
  await page.waitForTimeout(200);

  await page.locator('#calendar-today-btn').click();
  await page.waitForTimeout(200);

  const title = await getCalendarTitleText(page);
  expect(title).toBe(expectedCurrentTitle);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// Test 4: Days with notes show dot indicators
// ══════════════════════════════════════════
test('4. Days with notes show dot indicators in the grid', async ({ page }) => {
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const dateStr = threeDaysAgo.toISOString().split('T')[0];

  await createNoteWithContent(page, `Daily Log ${dateStr}`, 'A daily log entry for testing.');

  await runCLI(page, 'calendar');
  await page.waitForTimeout(500);

  const daysWithNotes = await getDaysWithNotesCount(page);
  expect(daysWithNotes).toBeGreaterThanOrEqual(1);

  const footerText = await getCalendarFooterText(page);
  expect(footerText).toMatch(/1\s+note/);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// Test 5: Click day with no notes creates a daily note
// ══════════════════════════════════════════
test('5. Clicking a day with no notes opens/creates the daily note', async ({ page }) => {
  await runCLI(page, 'calendar');
  await page.waitForTimeout(500);

  const today = new Date();
  const todayDay = today.getDate();

  await clickDayCell(page, todayDay);
  await page.waitForTimeout(500);

  const editor = page.locator('#note-editor-modal');
  await expect(editor).toBeVisible({ timeout: 5000 });

  const todayISO = today.toISOString().split('T')[0];
  const expectedTitle = `Daily Log ${todayISO}`;
  const titleInput = page.locator('#active-note-title');
  await expect(titleInput).toHaveValue(expectedTitle, { timeout: 3000 });

  await closeEditor(page);
});

// ══════════════════════════════════════════
// Test 6: Multiple notes on same day show picker
// ══════════════════════════════════════════
test('6. Clicking a day with multiple notes shows the note picker', async ({ page }) => {
  const today = new Date();
  const todayISO = today.toISOString().split('T')[0];

  await createNoteWithContent(page, `Daily Log ${todayISO}`, 'First daily entry.');
  await createNoteWithContent(page, `Meeting Notes ${todayISO}`, 'Meeting notes for today.');

  await runCLI(page, 'calendar');
  await page.waitForTimeout(500);

  const todayDay = today.getDate();
  await clickDayCell(page, todayDay);
  await page.waitForTimeout(500);

  const pickerVisible = await page.evaluate(() => {
    const picker = document.getElementById('calendar-note-picker');
    return picker && picker.style.display === 'block';
  });
  expect(pickerVisible).toBe(true);

  const pickerItems = page.locator('.calendar-picker-item');
  await expect(pickerItems).toHaveCount(2);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// Test 7: Keyboard arrow navigation between months
// ══════════════════════════════════════════
test('7. Keyboard arrow keys navigate between months', async ({ page }) => {
  await runCLI(page, 'calendar');
  await page.waitForTimeout(500);

  const now = new Date();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);

  let nextMonth = now.getMonth() + 1;
  let nextYear = now.getFullYear();
  if (nextMonth > 11) { nextMonth = 0; nextYear++; }
  let title = await getCalendarTitleText(page);
  expect(title).toBe(`${monthNames[nextMonth]} ${nextYear}`);

  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);

  title = await getCalendarTitleText(page);
  expect(title).toBe(`${monthNames[now.getMonth()]} ${now.getFullYear()}`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// Test 8: Open calendar with Cmd+Shift+C shortcut
// ══════════════════════════════════════════
test('8. Opens calendar with Cmd+Shift+C keyboard shortcut', async ({ page }) => {
  await page.keyboard.press('Meta+Shift+c');
  await page.waitForTimeout(500);

  const visible = await isCalendarVisible(page);
  expect(visible).toBe(true);

  const now = new Date();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const expectedTitle = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
  const title = await getCalendarTitleText(page);
  expect(title).toBe(expectedTitle);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const stillVisible = await isCalendarVisible(page);
  expect(stillVisible).toBe(false);
});

// ══════════════════════════════════════════
// Test 9: Double-tap Cmd+Shift+C is safe
// ══════════════════════════════════════════
test('9. Pressing Cmd+Shift+C when calendar is already open does nothing', async ({ page }) => {
  await page.keyboard.press('Meta+Shift+c');
  await page.waitForTimeout(500);
  const visible = await isCalendarVisible(page);
  expect(visible).toBe(true);

  const titleBefore = await getCalendarTitleText(page);

  await page.keyboard.press('Meta+Shift+c');
  await page.waitForTimeout(300);

  const visibleAfter = await isCalendarVisible(page);
  expect(visibleAfter).toBe(true);

  const titleAfter = await getCalendarTitleText(page);
  expect(titleAfter).toBe(titleBefore);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// Test 10: Cmd+Shift+C while note editor is open
// ══════════════════════════════════════════
test('10. Cmd+Shift+C opens calendar while note editor is open', async ({ page }) => {
  // Open the note editor
  const cmdInput = page.locator('#cmd-input');
  await cmdInput.fill('note Editor Test');
  await cmdInput.press('Enter');
  await waitForEditor(page);
  await page.waitForTimeout(300);

  const editor = page.locator('#note-editor-modal');
  await expect(editor).toBeVisible({ timeout: 2000 });

  // While the editor is open, press Cmd+Shift+C
  // The capture-phase handler must fire before any editor-specific handlers
  await page.keyboard.press('Meta+Shift+c');
  await page.waitForTimeout(500);

  // Calendar should open (capture-phase took priority)
  const visible = await isCalendarVisible(page);
  expect(visible).toBe(true);

  // Note editor should remain open underneath (separate overlay)
  await expect(editor).toBeVisible({ timeout: 2000 });

  // Calendar should show the correct month/year
  const now = new Date();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const title = await getCalendarTitleText(page);
  expect(title).toBe(`${monthNames[now.getMonth()]} ${now.getFullYear()}`);

  // Close the calendar by clicking the backdrop overlay (not Escape, which would
  // also hit ModalManager's Escape handler and close the note editor underneath)
  await page.evaluate(() => {
    const overlay = document.getElementById('calendar-overlay');
    if (overlay) overlay.click();
  });
  await page.waitForTimeout(300);
  const stillVisible = await isCalendarVisible(page);
  expect(stillVisible).toBe(false);

  // Note editor should remain open underneath
  await expect(editor).toBeVisible({ timeout: 2000 });

  // Close the editor
  await closeEditor(page);
  await expect(editor).not.toBeVisible({ timeout: 3000 });
});
