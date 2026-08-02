

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

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX'
    );
    keys.forEach(k => localStorage.removeItem(k));
    if (window.State) {
      window.State.NOTES.length = 0;
      window.State.CONFIG.first_run = false;
    }
  });
  await page.waitForTimeout(300);
});

// ═══════════════════════════════════════════
// CB1: Code block has line numbers gutter
// ═══════════════════════════════════════════
test('CB1. Code block renders with line numbers gutter', async ({ page }) => {
  await runCLI(page, 'note Code Test');
  await waitForEditor(page);

  // Use /code slash command to create a code block
  const blockContent = page.locator('.block-content[contenteditable="true"]').first();
  await blockContent.waitFor({ state: 'visible', timeout: 5000 });
  await blockContent.click();
  await page.waitForTimeout(200);

  // Use evaluate to set up a code block directly (SlashMenu triggers via character-by-character
  // typing, which can be unreliable in headless Playwright)
  await page.evaluate(() => {
    var note = window.State.NOTES.find(n => n.type !== 'canvas');
    if (!note) return;
    // Clear the default block and create a code block
    note.blocks = [{
      id: 'blk_' + Date.now(),
      type: 'code',
      content: 'const x = 42;\nconsole.log(x);',
      language: 'javascript',
      order: 0,
      level: 0
    }];
    if (window.BlockEditor && window.BlockEditor.render) {
      window.BlockEditor.render(note.id);
    }
  });
  await page.waitForTimeout(600);

  // The code block should now be rendered with a line numbers gutter
  const gutter = page.locator('.code-line-numbers');
  await expect(gutter).toBeVisible({ timeout: 3000 });

  // Initially should have 2 line numbers (2 lines of code)
  const lineSpans = gutter.locator('span');
  await expect(lineSpans).toHaveCount(2);

  await closeEditor(page);
});

// ═══════════════════════════════════════════
// CB2: Copy button is present in code blocks
// ═══════════════════════════════════════════
test('CB2. Code block has a copy button', async ({ page }) => {
  await runCLI(page, 'note Code Copy Test');
  await waitForEditor(page);

  // Create a code block directly via evaluate
  await page.evaluate(() => {
    var note = window.State.NOTES.find(n => n.type !== 'canvas');
    if (!note) return;
    note.blocks = [{
      id: 'blk_' + Date.now(),
      type: 'code',
      content: 'const x = 42;',
      language: 'javascript',
      order: 0,
      level: 0
    }];
    if (window.BlockEditor && window.BlockEditor.render) {
      window.BlockEditor.render(note.id);
    }
  });
  await page.waitForTimeout(600);

  // The code block should have a copy button
  const copyBtn = page.locator('.code-copy-btn');
  await expect(copyBtn).toBeVisible({ timeout: 3000 });
  await expect(copyBtn).toContainText('COPY');

  await closeEditor(page);
});

// ═══════════════════════════════════════════
// CB3: Code block has a language label
// ═══════════════════════════════════════════
test('CB3. Code block displays language label', async ({ page }) => {
  await runCLI(page, 'note Lang Test');
  await waitForEditor(page);

  // Create a code block directly via evaluate
  await page.evaluate(() => {
    var note = window.State.NOTES.find(n => n.type !== 'canvas');
    if (!note) return;
    note.blocks = [{
      id: 'blk_' + Date.now(),
      type: 'code',
      content: 'function hello() {\n  return 42;\n}',
      language: 'javascript',
      order: 0,
      level: 0
    }];
    if (window.BlockEditor && window.BlockEditor.render) {
      window.BlockEditor.render(note.id);
    }
  });
  await page.waitForTimeout(600);

  // Should show the language label (default: javascript)
  const langLabel = page.locator('.code-lang-label');
  await expect(langLabel).toBeVisible({ timeout: 3000 });
  await expect(langLabel).toContainText('javascript');

  await closeEditor(page);
});
