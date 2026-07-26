/**
 * Vinland Template Browser - Playwright Integration Test
 *
 * Tests the Template Browser (Cmd+Shift+N):
 * - Opening via keyboard shortcut
 * - Creating a template note in /Templates folder
 * - Browsing templates
 * - Creating a note from a template
 * - CLI 'template' command
 * - YAML frontmatter template flag
 * - Empty state message
 *
 * Run with:
 *   npx playwright test tests/template-browser.playwright.spec.mjs
 */

import { test, expect } from '@playwright/test';
import { APP_URL, runCLI, waitForEditor, closeEditor, createNoteWithContentAndPath } from './helpers.mjs';

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
// Test 1: Open Template Browser with Cmd+Shift+N
// ══════════════════════════════════════════
test('1. Opens with Cmd+Shift+N and shows templates', async ({ page }) => {
  await createNoteWithContentAndPath(page, 'Meeting Template',
    '# Meeting\n\n- Attendees:\n- Agenda:\n- Action items:', '/Templates');

  await page.keyboard.press('Meta+Shift+n');
  await page.waitForTimeout(500);

  const visible = await page.evaluate(() => {
    const palette = document.getElementById('template-browser-palette');
    return palette && palette.classList.contains('active');
  });
  expect(visible).toBe(true);

  const results = await page.evaluate(() => {
    const resultsEl = document.getElementById('template-browser-results');
    if (!resultsEl) return [];
    const items = resultsEl.querySelectorAll('.qo-result');
    return Array.from(items).map(el => ({
      title: el.querySelector('.qo-result-title')?.textContent?.trim() || ''
    }));
  });
  expect(results.some(r => r.title === 'Meeting Template')).toBe(true);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const stillVisible = await page.evaluate(() => {
    const palette = document.getElementById('template-browser-palette');
    return palette && palette.classList.contains('active');
  });
  expect(stillVisible).toBe(false);
});

// ══════════════════════════════════════════
// Test 2: Search templates by name
// ══════════════════════════════════════════
test('2. Searches templates by name', async ({ page }) => {
  await createNoteWithContentAndPath(page, 'Daily Standup', 'Standup notes', '/Templates');
  await createNoteWithContentAndPath(page, 'Project Retro', 'Retro template', '/Templates');

  await page.keyboard.press('Meta+Shift+n');
  await page.waitForTimeout(500);

  await page.locator('#template-browser-input').fill('Daily');
  await page.waitForTimeout(300);

  const results = await page.evaluate(() => {
    const resultsEl = document.getElementById('template-browser-results');
    if (!resultsEl) return [];
    const items = resultsEl.querySelectorAll('.qo-result');
    return Array.from(items).map(el => ({
      title: el.querySelector('.qo-result-title')?.textContent?.trim() || ''
    }));
  });
  expect(results.length).toBe(1);
  expect(results[0].title).toBe('Daily Standup');

  await page.keyboard.press('Escape');
});

// ══════════════════════════════════════════
// Test 3: Create note from template via page.evaluate
// ══════════════════════════════════════════
test('3. Creates a new note from a template', async ({ page }) => {
  const templateContent = '# Meeting\n\n**Date:** [date]\n**Attendees:**\n- [name]\n\n## Agenda\n1. [item]\n\n## Notes\n';

  await createNoteWithContentAndPath(page, 'Meeting Template', templateContent, '/Templates');

  // Create a note from the template directly (bypasses input modal)
  await page.evaluate(() => {
    if (window.Notes && window.Notes._findTemplate) {
      window.Notes.create('', '/', 'Meeting Template');
    }
  });
  await page.waitForTimeout(600);

  // The editor should open with template content
  const editor = page.locator('#note-editor-modal');
  await expect(editor).toBeVisible({ timeout: 5000 });

  // Blocks should have been rendered from the template
  const blockCount = await page.evaluate(() => {
    const editor = document.getElementById('block-editor');
    if (!editor) return 0;
    return editor.querySelectorAll('.block-wrapper').length;
  });
  // Block count should be at least 1 and block should contain template content
  const blockContent = await page.evaluate(() => {
    const block = document.querySelector('#block-editor .block-wrapper [contenteditable]');
    return block ? block.textContent : '';
  });
  expect(blockContent.length).toBeGreaterThan(0);
  expect(blockContent).toContain('Meeting');

  await closeEditor(page);
});

// ══════════════════════════════════════════
// Test 4: CLI 'template' command opens browser
// ══════════════════════════════════════════
test('4. CLI template command opens the template browser', async ({ page }) => {
  await createNoteWithContentAndPath(page, 'Sprint Planning', 'Sprint planning template', '/Templates');

  await runCLI(page, 'template');
  await page.waitForTimeout(500);

  const visible = await page.evaluate(() => {
    const palette = document.getElementById('template-browser-palette');
    return palette && palette.classList.contains('active');
  });
  expect(visible).toBe(true);

  await page.keyboard.press('Escape');
});

// ══════════════════════════════════════════
// Test 5: Template with YAML frontmatter flag
// ══════════════════════════════════════════
test('5. Recognizes templates via template:true frontmatter', async ({ page }) => {
  await page.evaluate(() => {
    if (!window.State) return;
    window.State.NOTES.push({
      id: 'yaml_template_' + Date.now(),
      title: 'YAML Marked Template',
      content: '---\ntemplate: true\n---\n\n# Custom Template\n\nThis has template:true in YAML.',
      blocks: [{ id: 'b1', type: 'p', content: 'This has template:true in YAML.' }],
      path: '/',
      created: Date.now(),
      modified: Date.now()
    });
    if (window.saveData) window.saveData();
  });
  await page.waitForTimeout(300);

  await page.keyboard.press('Meta+Shift+n');
  await page.waitForTimeout(500);

  const visible = await page.evaluate(() => {
    const palette = document.getElementById('template-browser-palette');
    return palette && palette.classList.contains('active');
  });
  expect(visible).toBe(true);

  const results = await page.evaluate(() => {
    const resultsEl = document.getElementById('template-browser-results');
    if (!resultsEl) return [];
    const items = resultsEl.querySelectorAll('.qo-result');
    return Array.from(items).map(el => ({
      title: el.querySelector('.qo-result-title')?.textContent?.trim() || ''
    }));
  });
  expect(results.some(r => r.title === 'YAML Marked Template')).toBe(true);

  await page.keyboard.press('Escape');
});

// ══════════════════════════════════════════
// Test 6: Empty state shows helpful message
// ══════════════════════════════════════════
test('6. Shows helpful empty state when no templates exist', async ({ page }) => {
  await page.keyboard.press('Meta+Shift+n');
  await page.waitForTimeout(500);

  const emptyMsg = await page.evaluate(() => {
    const resultsEl = document.getElementById('template-browser-results');
    if (!resultsEl) return '';
    const empty = resultsEl.querySelector('.qo-result-empty');
    return empty ? empty.textContent.trim() : '';
  });
  expect(emptyMsg.length).toBeGreaterThan(0);
  expect(emptyMsg.toLowerCase()).toContain('template');

  await page.keyboard.press('Escape');
});
