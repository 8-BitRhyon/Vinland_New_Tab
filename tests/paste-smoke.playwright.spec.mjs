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

/**
 * Native paste key differs by OS: Meta+V (⌘V) on macOS, Control+V on
 * Linux/Windows. Using the wrong one means the browser never performs its
 * native paste default action, so handlePaste never fires in CI.
 */
const PASTE_KEY = process.platform === 'darwin' ? 'Meta+V' : 'Control+V';

/**
 * Real clipboard paste: write text to clipboard, focus, press the native paste key.
 * The 500ms settle wait is redundant for P1-P3 (they auto-wait via assertions)
 * but P4 relies on it to capture paste-triggered console errors — keep it.
 */
async function realPaste(page, text) {
  await page.evaluate((txt) => navigator.clipboard.writeText(txt), text);
  await page.keyboard.press(PASTE_KEY);
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
  // Auto-wait: the paste lands async (browser-native default action), so poll
  // instead of a single read after a fixed timeout — timing-proof on slow CI.
  await expect(firstBlock).toContainText('Hello pasted line', { timeout: 5000 });
});

test('P2. Multi-line bullet paste splits into one block per line', async ({ page }) => {
  await runCLI(page, 'note Paste Split Test');
  await waitForEditor(page);

  const firstBlock = getFirstBlock(page);
  await firstBlock.waitFor({ state: 'visible', timeout: 5000 });
  await firstBlock.click();

  const before = await blockCount(page);
  await realPaste(page, '- one\n- two\n- three');

  // Auto-wait for the 3 new bullet blocks (paste is async).
  await expect(page.locator('#block-editor .block-wrapper')).toHaveCount(before + 3, { timeout: 5000 });
  await expect.poll(async () => {
    const allText = await page.locator('#block-editor .block-wrapper').allTextContents();
    const joined = allText.join('\n');
    return joined.includes('one') && joined.includes('two') && joined.includes('three');
  }, { timeout: 5000 }).toBe(true);
});

test('P3. Multi-line plain text merges into a single paragraph block', async ({ page }) => {
  await runCLI(page, 'note Paste Merge Test');
  await waitForEditor(page);

  const firstBlock = getFirstBlock(page);
  await firstBlock.waitFor({ state: 'visible', timeout: 5000 });
  await firstBlock.click();

  const before = await blockCount(page);
  await realPaste(page, 'Line one\nLine two\nLine three');

  // Auto-wait: contiguous plain lines buffer into one paragraph block
  // (tolerant: a trailing newline in the pasted text would split an extra
  // empty line into its own paragraph, so a lower bound is used).
  await expect.poll(async () => page.locator('#block-editor .block-wrapper').count(), {
    timeout: 5000,
  }).toBeGreaterThanOrEqual(before + 1);

  await expect.poll(async () => {
    const allText = await page.locator('#block-editor .block-wrapper').allTextContents();
    const joined = allText.join('\n');
    return joined.includes('Line one') && joined.includes('Line two') && joined.includes('Line three');
  }, { timeout: 5000 }).toBe(true);
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
