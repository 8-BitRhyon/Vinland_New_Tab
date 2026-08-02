

import { test, expect } from '@playwright/test';
import { APP_URL, closeEditor } from './helpers.mjs';

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
        k.startsWith('VINLAND_')
      );
      keys.forEach(k => localStorage.removeItem(k));
      if (window.State) {
        if (Array.isArray(window.State.NOTES)) window.State.NOTES.length = 0;
      }
    } catch {  }
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
    } catch {  }
  }).catch(() => {});
});

// ══════════════════════════════════════════
// Test 1: Open Quick Capture with Cmd+Shift+I
// ══════════════════════════════════════════
test('1. Opens capture overlay with Cmd+Shift+I', async ({ page }) => {
  await page.keyboard.press('Meta+Shift+i');
  await page.waitForTimeout(500);

  const visible = await page.evaluate(() => {
    const overlay = document.getElementById('quick-capture-overlay');
    return overlay && overlay.classList.contains('active');
  });
  expect(visible).toBe(true);

  const focused = await page.evaluate(() => {
    const input = document.getElementById('quick-capture-input');
    return document.activeElement === input;
  });
  expect(focused).toBe(true);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const stillVisible = await page.evaluate(() => {
    const overlay = document.getElementById('quick-capture-overlay');
    return overlay && overlay.classList.contains('active');
  });
  expect(stillVisible).toBe(false);
});

// ══════════════════════════════════════════
// Test 2: Capture text creates /Inbox note
// ══════════════════════════════════════════
test('2. Capturing text creates a note in /Inbox', async ({ page }) => {
  await page.keyboard.press('Meta+Shift+i');
  await page.waitForTimeout(500);

  await page.locator('#quick-capture-input').fill('Remember to buy groceries');
  await page.locator('#quick-capture-input').press('Enter');
  await page.waitForTimeout(600);

  const inboxNotes = await page.evaluate(() => {
    if (!window.State || !window.State.NOTES) return [];
    return window.State.NOTES.filter(n => n.path === '/Inbox').map(n => ({
      title: n.title,
      path: n.path
    }));
  });
  expect(inboxNotes.length).toBeGreaterThan(0);
  expect(inboxNotes.some(n => n.title.includes('groceries'))).toBe(true);

  const toast = page.locator('#quick-capture-toast');
  await expect(toast).toBeVisible({ timeout: 2000 });
  await expect(toast).toContainText('INBOX');
});

// ══════════════════════════════════════════
// Test 3: Multiple captures accumulate
// ══════════════════════════════════════════
test('3. Multiple captures accumulate in /Inbox folder', async ({ page }) => {
  await page.keyboard.press('Meta+Shift+i');
  await page.waitForTimeout(300);
  await page.locator('#quick-capture-input').fill('Task one');
  await page.locator('#quick-capture-input').press('Enter');
  await page.waitForTimeout(500);

  await page.keyboard.press('Meta+Shift+i');
  await page.waitForTimeout(300);
  await page.locator('#quick-capture-input').fill('Task two');
  await page.locator('#quick-capture-input').press('Enter');
  await page.waitForTimeout(500);

  const count = await page.evaluate(() => {
    if (!window.State || !window.State.NOTES) return 0;
    return window.State.NOTES.filter(n => n.path === '/Inbox').length;
  });
  expect(count).toBe(2);
});

// ══════════════════════════════════════════
// Test 4: Inbox preview shows recent captures
// ══════════════════════════════════════════
test('4. Capture overlay shows recent inbox items in preview', async ({ page }) => {
  await page.evaluate(() => {
    if (!window.State) return;
    window.State.NOTES.push({
      id: 'inbox_prev_1', title: 'First Capture',
      content: 'This is the first capture.',
      path: '/Inbox', created: Date.now() - 5000, modified: Date.now() - 5000
    });
    window.State.NOTES.push({
      id: 'inbox_prev_2', title: 'Second Capture',
      content: 'This is the second capture.',
      path: '/Inbox', created: Date.now() - 3000, modified: Date.now() - 3000
    });
    if (window.saveData) window.saveData();
  });
  await page.waitForTimeout(300);

  await page.keyboard.press('Meta+Shift+i');
  await page.waitForTimeout(500);

  const previewVisible = await page.evaluate(() => {
    const preview = document.getElementById('quick-capture-inbox-preview');
    if (!preview) return false;
    return preview.style.display !== 'none' && preview.children.length > 0;
  });
  expect(previewVisible).toBe(true);

  const headerText = await page.evaluate(() => {
    const header = document.querySelector('.qc-inbox-header');
    return header ? header.textContent : '';
  });
  expect(headerText).toContain('INBOX');

  // Click on the first inbox item via evaluate (greeting overlay intercepts Playwright clicks)
  await page.evaluate(() => {
    const item = document.querySelector('.qc-inbox-item');
    if (item) item.click();
  });
  await page.waitForTimeout(500);

  const editor = page.locator('#note-editor-modal');
  await expect(editor).toBeVisible({ timeout: 5000 });
  await closeEditor(page);
});

// ══════════════════════════════════════════
// Test 5: Empty capture closes without creating
// ══════════════════════════════════════════
test('5. Empty capture just closes without creating a note', async ({ page }) => {
  const notesBefore = await page.evaluate(() => {
    return window.State && window.State.NOTES ? window.State.NOTES.length : 0;
  });

  await page.keyboard.press('Meta+Shift+i');
  await page.waitForTimeout(300);

  await page.locator('#quick-capture-input').press('Enter');
  await page.waitForTimeout(400);

  const notesAfter = await page.evaluate(() => {
    return window.State && window.State.NOTES ? window.State.NOTES.length : 0;
  });
  expect(notesAfter).toBe(notesBefore);

  const stillVisible = await page.evaluate(() => {
    const overlay = document.getElementById('quick-capture-overlay');
    return overlay && overlay.classList.contains('active');
  });
  expect(stillVisible).toBe(false);
});

// ══════════════════════════════════════════
// Test 6: Toggle with repeated shortcut
// ══════════════════════════════════════════
test('6. Cmd+Shift+I toggles the capture overlay', async ({ page }) => {
  await page.keyboard.press('Meta+Shift+i');
  await page.waitForTimeout(300);
  const open = await page.evaluate(() => {
    const overlay = document.getElementById('quick-capture-overlay');
    return overlay && overlay.classList.contains('active');
  });
  expect(open).toBe(true);

  await page.keyboard.press('Meta+Shift+i');
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => {
    const overlay = document.getElementById('quick-capture-overlay');
    return overlay && overlay.classList.contains('active');
  });
  expect(closed).toBe(false);
});
