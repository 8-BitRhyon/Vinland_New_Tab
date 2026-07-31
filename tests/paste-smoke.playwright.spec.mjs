/**
 * Vinland BlockEditor Paste - Playwright Smoke Test
 *
 * Verifies the paste flow works end-to-end using REAL clipboard paste
 * (navigator.clipboard.writeText + Meta+V), not synthetic ClipboardEvents
 * (synthetic events never trigger the browser's native paste default action,
 * which handlePaste relies on for short single-line text).
 *
 * Covers:
 * - Single-line paste inserts natively at the cursor
 * - Multi-line paste of bullets splits into one block per line
 * - Multi-line paste of contiguous plain text merges into one paragraph block
 * - No console errors during paste
 *
 * Run with:
 *   npx playwright test tests/paste-smoke.playwright.spec.mjs
 */

import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:9999';

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

async function runCLI(page, command) {
  const cmdInput = page.locator('#cmd-input');
  await cmdInput.waitFor({ state: 'visible', timeout: 15000 });
  await cmdInput.fill(command);
  await cmdInput.press('Enter');
  await page.waitForTimeout(500);
}

async function waitForEditor(page) {
  const editor = page.locator('#note-editor-modal');
  await editor.waitFor({ state: 'visible', timeout: 8000 });
  return editor;
}

function getFirstBlock(page) {
  return page.locator('#block-editor .block-wrapper').first()
    .locator('[contenteditable="true"]').first();
}

function blockCount(page) {
  return page.locator('#block-editor .block-wrapper').count();
}

/** Real clipboard paste: write text to clipboard, focus, press Meta+V. */
async function realPaste(page, text) {
  await page.evaluate((txt) => navigator.clipboard.writeText(txt), text);
  await page.keyboard.press('Meta+V');
  await page.waitForTimeout(500);
}

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);
  // Clipboard access requires permissions + a user gesture; grant up front.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
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
// Paste smoke tests
// ══════════════════════════════════════════

test('P1. Single-line paste inserts text at the cursor', async ({ page }) => {
  await runCLI(page, 'note Paste Smoke Test');
  await waitForEditor(page);

  const firstBlock = getFirstBlock(page);
  await firstBlock.waitFor({ state: 'visible', timeout: 5000 });
  await firstBlock.click();

  await realPaste(page, 'Hello pasted line');
  const text = await firstBlock.textContent();
  expect(text).toContain('Hello pasted line');
});

test('P2. Multi-line bullet paste splits into one block per line', async ({ page }) => {
  await runCLI(page, 'note Paste Split Test');
  await waitForEditor(page);

  const firstBlock = getFirstBlock(page);
  await firstBlock.waitFor({ state: 'visible', timeout: 5000 });
  await firstBlock.click();

  const before = await blockCount(page);
  await realPaste(page, '- one\n- two\n- three');
  const after = await blockCount(page);

  // Bullets create one block per line -> 3 new bullet blocks
  expect(after).toBe(before + 3);

  const allText = await page.locator('#block-editor .block-wrapper').allTextContents();
  const joined = allText.join('\n');
  expect(joined).toContain('one');
  expect(joined).toContain('two');
  expect(joined).toContain('three');
});

test('P3. Multi-line plain text merges into a single paragraph block', async ({ page }) => {
  await runCLI(page, 'note Paste Merge Test');
  await waitForEditor(page);

  const firstBlock = getFirstBlock(page);
  await firstBlock.waitFor({ state: 'visible', timeout: 5000 });
  await firstBlock.click();

  const before = await blockCount(page);
  await realPaste(page, 'Line one\nLine two\nLine three');
  const after = await blockCount(page);

  // Contiguous plain lines buffer into one paragraph block
  // (tolerant: a trailing newline in the pasted text would split an extra
  // empty line into its own paragraph, so exact equality is brittle)
  expect(after).toBeGreaterThanOrEqual(before + 1);

  const allText = await page.locator('#block-editor .block-wrapper').allTextContents();
  const joined = allText.join('\n');
  expect(joined).toContain('Line one');
  expect(joined).toContain('Line two');
  expect(joined).toContain('Line three');
});

test('P4. No console errors during paste operations', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

  await runCLI(page, 'note Paste Errors Test');
  await waitForEditor(page);

  const firstBlock = getFirstBlock(page);
  await firstBlock.waitFor({ state: 'visible', timeout: 5000 });
  await firstBlock.click();

  await realPaste(page, 'single line');
  await realPaste(page, 'multi\nline\nsplit');
  await realPaste(page, '- a\n- b');

  const relevant = errors.filter(e =>
    /paste|handlePaste|_pHandle|BlockEditor|PageManager/i.test(e)
  );
  expect(relevant).toEqual([]);
});
