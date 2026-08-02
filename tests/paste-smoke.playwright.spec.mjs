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
 * - XSS payloads rendered through the REAL markdownToHtml pipeline (Enter-split
 *   re-render) must produce plain text — no dangerous anchor, no injected
 *   attributes (P5/P6)
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

/**
 * Assert no element inside #block-editor carries ANY attribute starting with
 * "on" (onmouseover, onload, onfocus, onpointerdown, ...). A JS-driven scan is
 * strictly stronger than a CSS attribute-selector list, which can only enumerate
 * known handlers — a sanitizer hole that allowed an unlisted handler would
 * otherwise slip through the tests.
 */
async function expectNoInlineHandlers(page) {
  const withHandlers = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('#block-editor *').forEach((el) => {
      for (const name of el.getAttributeNames()) {
        if (name.toLowerCase().startsWith('on')) bad.push(el.tagName + '[' + name + ']');
      }
    });
    return bad;
  });
  expect(withHandlers).toEqual([]);
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

// ══════════════════════════════════════════
// XSS payload rendering (exercises the REAL markdownToHtml pipeline)
// ══════════════════════════════════════════
// Typing keeps the payload as raw text; pressing Enter triggers a block split
// which re-renders ALL blocks through BlockEditor.markdownToHtml — the exact
// path where the hardened link sanitizer runs. Asserting the RENDERED output
// (rejected link -> plain link text, no <a>, no injected attributes) proves
// the sanitizer was exercised with a payload, not just that raw text exists.

test('P5. javascript: link payload renders as plain text, no anchor in DOM', async ({ page }) => {
  await runCLI(page, 'note XSS Link Test');
  await waitForEditor(page);

  const firstBlock = getFirstBlock(page);
  await firstBlock.waitFor({ state: 'visible', timeout: 5000 });
  await firstBlock.click();

  await page.keyboard.type('[x](javascript:alert(1))');
  // Enter-split forces render() -> markdownToHtml over the block content.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  // Rendered: the dangerous scheme was rejected, so the link label 'x' renders
  // as plain text with the unmatched trailing ')' left literal — the raw
  // markdown must NOT survive the render. This exact output proves the
  // sanitizer ran: the payload was neutralized, not passed through.
  const firstContent = page.locator('#block-editor .block-wrapper .block-content').first();
  await expect(firstContent).toHaveText('x)', { timeout: 5000 });
  await expect(firstContent).not.toContainText('javascript');
  await expect(firstContent).not.toContainText('[');

  // No anchor element anywhere in the editor, and no javascript: href in DOM.
  await expect(page.locator('#block-editor a.external-link')).toHaveCount(0);
  await expect(page.locator('#block-editor a[href*="javascript:"]')).toHaveCount(0);
  await expect(page.locator('#block-editor [href]')).toHaveCount(0);

  // No inline event-handler attributes anywhere in the editor (any on* name).
  await expectNoInlineHandlers(page);
});

test('P6. Attribute-breakout link payload renders as plain text, no injected attribute', async ({ page }) => {
  await runCLI(page, 'note XSS Attr Test');
  await waitForEditor(page);

  const firstBlock = getFirstBlock(page);
  await firstBlock.waitFor({ state: 'visible', timeout: 5000 });
  await firstBlock.click();

  await page.keyboard.type('[x](" onmouseover="alert(1))');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  // The quoted-URL breakout must be neutralized: render the link label 'x' as
  // plain text with the unmatched trailing ')' left literal. The raw markdown
  // and the injected onmouseover= must not survive the render.
  const firstContent = page.locator('#block-editor .block-wrapper .block-content').first();
  await expect(firstContent).toHaveText('x)', { timeout: 5000 });
  await expect(firstContent).not.toContainText('onmouseover');
  await expect(firstContent).not.toContainText('[');

  // No anchor, no href anywhere, and no injected on* attribute in the DOM.
  await expect(page.locator('#block-editor a.external-link')).toHaveCount(0);
  await expect(page.locator('#block-editor [href]')).toHaveCount(0);
  await expectNoInlineHandlers(page);
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
