/**
 * Vinland Dataview Query Panel - Playwright Integration Tests
 *
 * Tests the Dataview-style query panel (Cmd+Shift+Q):
 * - Opening via CLI `dv #tag` command
 * - Verifying LIST results appear with note title and snippet
 * - Clicking a result to open the note editor
 * - Cmd+Shift+Q keyboard shortcut
 * - TABLE view rendering
 * - TASK view rendering
 * - Error state for invalid queries
 * - Escape to close
 *
 * Run with:
 *   npx playwright test tests/dataview-query.playwright.spec.mjs
 */

import { test, expect } from '@playwright/test';
import { APP_URL, runCLI, closeEditor } from './helpers.mjs';

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

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

/**
 * Check if the Dataview modal is visible
 */
async function isDataviewVisible(page) {
  return await page.evaluate(() => {
    const modal = document.getElementById('dv-modal');
    return modal && modal.classList.contains('active');
  });
}

/**
 * Get the text content of all result items in the Dataview results list
 */
async function getResultTitles(page) {
  return await page.evaluate(() => {
    const container = document.getElementById('dv-results');
    if (!container) return [];
    const items = container.querySelectorAll('.dv-result-item');
    return Array.from(items).map(el => {
      const titleEl = el.querySelector('.dv-item-title');
      return titleEl ? titleEl.textContent.trim() : '';
    }).filter(Boolean);
  });
}

/**
 * Get the result count from the footer
 */
async function getResultCount(page) {
  return await page.evaluate(() => {
    const footer = document.getElementById('dv-footer');
    if (!footer) return '';
    const countEl = footer.querySelector('.dv-footer-count');
    return countEl ? countEl.textContent.trim() : '';
  });
}

/**
 * Get the error message text (if any)
 */
async function getErrorMessage(page) {
  return await page.evaluate(() => {
    const errorEl = document.getElementById('dv-error');
    if (!errorEl || errorEl.style.display === 'none') return '';
    return errorEl.textContent.trim();
  });
}

// ══════════════════════════════════════════
// Test 1: Open Dataview with `dv` CLI command
// ══════════════════════════════════════════
test('1. Opens dataview panel via CLI `dv` command', async ({ page }) => {
  await runCLI(page, 'dv');
  await page.waitForTimeout(500);

  const visible = await isDataviewVisible(page);
  expect(visible).toBe(true);

  // Should show empty state prompt
  const emptyMsg = await page.evaluate(() => {
    const results = document.getElementById('dv-results');
    if (!results) return '';
    const empty = results.querySelector('.dv-empty');
    return empty ? empty.textContent.trim() : '';
  });
  expect(emptyMsg).toContain('Enter a query');

  // Input should be focused
  const focusedEl = await page.evaluate(() => document.activeElement?.id || '');
  expect(focusedEl).toBe('dv-input');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const stillVisible = await isDataviewVisible(page);
  expect(stillVisible).toBe(false);
});

// ══════════════════════════════════════════
// Test 2: Query with #tag shows matching notes
// ══════════════════════════════════════════
test('2. `dv #tag` CLI command shows matching notes in list view', async ({ page }) => {
  // Create notes via page.evaluate for reliable MetadataCache indexing
  await page.evaluate(() => {
    if (!window.State || !window.MetadataCache) return;
    const now = Date.now();
    window.State.NOTES.push({
      id: 'note_sprint_' + now,
      title: 'Sprint Planning',
      content: 'Planning for the upcoming sprint.\nLots of stories to review.\n#project',
      blocks: [{ id: 'b1_' + now, type: 'p', content: 'Planning for the upcoming sprint.\nLots of stories to review.\n#project' }],
      path: '/',
      created: now,
      modified: now
    });
    window.State.NOTES.push({
      id: 'note_retro_' + now,
      title: 'Retro Notes',
      content: 'Team retro for last sprint.\nAction items: improve CI.\n#project',
      blocks: [{ id: 'b2_' + now, type: 'p', content: 'Team retro for last sprint.\nAction items: improve CI.\n#project' }],
      path: '/',
      created: now,
      modified: now
    });
    window.State.NOTES.push({
      id: 'note_random_' + now,
      title: 'Random Note',
      content: 'Just a random thought...',
      blocks: [{ id: 'b3_' + now, type: 'p', content: 'Just a random thought...' }],
      path: '/',
      created: now,
      modified: now
    });
    // Re-index MetadataCache
    window.MetadataCache.initialized = false;
    window.MetadataCache.init();
  });
  await page.waitForTimeout(500);

  await runCLI(page, 'dv #project');
  await page.waitForTimeout(600);

  const visible = await isDataviewVisible(page);
  expect(visible).toBe(true);

  // Should show matching notes
  const titles = await getResultTitles(page);
  expect(titles.length).toBe(2);
  expect(titles).toContain('Sprint Planning');
  expect(titles).toContain('Retro Notes');
  expect(titles).not.toContain('Random Note');

  // Footer should show count
  const count = await getResultCount(page);
  expect(count).toMatch(/2\s+results?/);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// Test 3: Click a result opens the note editor
// ══════════════════════════════════════════
test('3. Clicking a result opens the note editor', async ({ page }) => {
  await page.evaluate(() => {
    if (!window.State || !window.MetadataCache) return;
    const now = Date.now();
    window.State.NOTES.push({
      id: 'note_imp_' + now,
      title: 'Important Note',
      content: 'This is an important note.\n#important',
      blocks: [{ id: 'b1_' + now, type: 'p', content: 'This is an important note.\n#important' }],
      path: '/',
      created: now,
      modified: now
    });
    window.MetadataCache.initialized = false;
    window.MetadataCache.init();
  });
  await page.waitForTimeout(500);

  await runCLI(page, 'dv #important');
  await page.waitForTimeout(500);

  const visible = await isDataviewVisible(page);
  expect(visible).toBe(true);

  // Click the first result
  const firstResult = page.locator('.dv-result-item').first();
  await expect(firstResult).toBeVisible({ timeout: 3000 });
  await firstResult.click();
  await page.waitForTimeout(500);

  // The note editor should open with the correct note
  const editor = page.locator('#note-editor-modal');
  await expect(editor).toBeVisible({ timeout: 5000 });

  const titleInput = page.locator('#active-note-title');
  await expect(titleInput).toHaveValue('Important Note', { timeout: 3000 });

  // Dataview modal should be closed
  const dvVisible = await isDataviewVisible(page);
  expect(dvVisible).toBe(false);

  await closeEditor(page);
});

// ══════════════════════════════════════════
// Test 4: Cmd+Shift+Q keyboard shortcut opens panel
// ══════════════════════════════════════════
test('4. Opens with Cmd+Shift+Q keyboard shortcut', async ({ page }) => {
  await page.keyboard.press('Meta+Shift+q');
  await page.waitForTimeout(500);

  const visible = await isDataviewVisible(page);
  expect(visible).toBe(true);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// Test 5: TABLE query renders table view
// ══════════════════════════════════════════
test('5. TABLE query renders table view with property columns', async ({ page }) => {
  // Inject notes directly with proper content strings (not blocks) so YAML
  // frontmatter is correctly parsed by MetadataCache.parseFrontmatter.
  await page.evaluate(() => {
    if (!window.State || !window.MetadataCache) return;
    const now = Date.now();
    window.State.NOTES.push({
      id: 'note_tracker_' + now,
      title: 'Task Tracker',
      content: '---\nstatus: Active\npriority: high\n---\n\nTracking tasks.\n#tracker',
      blocks: [],
      path: '/',
      created: now,
      modified: now
    });
    window.State.NOTES.push({
      id: 'note_buglog_' + now,
      title: 'Bug Log',
      content: '---\nstatus: Active\npriority: medium\n---\n\nBug reports.\n#tracker',
      blocks: [],
      path: '/',
      created: now,
      modified: now
    });
    window.MetadataCache.initialized = false;
    window.MetadataCache.init();
  });
  await page.waitForTimeout(500);

  await runCLI(page, 'dv');
  await page.waitForTimeout(300);

  const input = page.locator('#dv-input');
  await input.fill('TABLE status, priority FROM #tracker');
  await page.locator('#dv-run-btn').click();
  await page.waitForTimeout(500);

  // Should show table view
  const table = page.locator('.dv-table');
  await expect(table).toBeVisible({ timeout: 3000 });

  // Table should have headers matching fields
  const headers = await page.evaluate(() => {
    const headerCells = document.querySelectorAll('.dv-table th');
    return Array.from(headerCells).map(th => th.textContent.trim());
  });
  expect(headers).toContain('NOTE');
  expect(headers).toContain('STATUS');
  expect(headers).toContain('PRIORITY');

  // Should have row for each note
  const rows = page.locator('.dv-table tbody tr');
  await expect(rows).toHaveCount(2);

  // Click a row to open the note
  await rows.first().click();
  await page.waitForTimeout(500);

  const editor = page.locator('#note-editor-modal');
  await expect(editor).toBeVisible({ timeout: 5000 });

  await closeEditor(page);
});

// ══════════════════════════════════════════
// Test 6: TASK query shows task view (with task-type blocks)
// ══════════════════════════════════════════
test('6. TASK query shows task items grouped by note (with task-type blocks)', async ({ page }) => {
  // Inject notes with proper task-type blocks so executeQuery detects them
  await page.evaluate(() => {
    if (!window.State || !window.MetadataCache) return;
    const now = Date.now();
    window.State.NOTES.push({
      id: 'note_tasks_' + now,
      title: 'Project Tasks',
      content: '- [ ] Fix login bug\n- [x] Update docs\n- [ ] Write tests\n#sprint',
      blocks: [
        { id: 'bt1_' + now, type: 'task', content: 'Fix login bug', checked: false },
        { id: 'bt2_' + now, type: 'task', content: 'Update docs', checked: true },
        { id: 'bt3_' + now, type: 'task', content: 'Write tests', checked: false },
        { id: 'bt4_' + now, type: 'p', content: '#sprint', checked: false }
      ],
      path: '/',
      created: now,
      modified: now
    });
    window.State.NOTES.push({
      id: 'note_personal_' + now,
      title: 'Personal Tasks',
      content: '- [ ] Buy groceries\n- [ ] Call dentist\n#sprint',
      blocks: [
        { id: 'bp1_' + now, type: 'task', content: 'Buy groceries', checked: false },
        { id: 'bp2_' + now, type: 'task', content: 'Call dentist', checked: false },
        { id: 'bp3_' + now, type: 'p', content: '#sprint', checked: false }
      ],
      path: '/',
      created: now,
      modified: now
    });
    window.MetadataCache.initialized = false;
    window.MetadataCache.init();
  });
  await page.waitForTimeout(500);

  await runCLI(page, 'dv TASK FROM #sprint');
  await page.waitForTimeout(500);

  // Should show task groups (auto-wait for the async render)
  const taskGroups = page.locator('.dv-task-group');
  await expect.poll(async () => taskGroups.count(), { timeout: 5000 }).toBeGreaterThanOrEqual(1);

  // Should show task items with checkboxes (auto-wait for the async render)
  const taskItems = page.locator('.dv-task-item');
  await expect.poll(async () => taskItems.count(), { timeout: 5000 }).toBeGreaterThanOrEqual(2);

  // Completed task should have done class
  const doneTasks = page.locator('.dv-task-text.dv-task-done');
  await expect(doneTasks).toHaveCount(1);

  // Click a task item to open the note (dv-task-item has data-note-id)
  const firstTask = page.locator('.dv-task-item').first();
  await firstTask.click();
  await page.waitForTimeout(500);

  const editor = page.locator('#note-editor-modal');
  await expect(editor).toBeVisible({ timeout: 5000 });

  await closeEditor(page);
});

// ══════════════════════════════════════════
// Test 7: Invalid query shows error message
// ══════════════════════════════════════════
test('7. Invalid query shows error message', async ({ page }) => {
  await runCLI(page, 'dv');
  await page.waitForTimeout(300);

  // Type gibberish and click RUN
  const input = page.locator('#dv-input');
  await input.fill('garbage query nothing');
  await page.locator('#dv-run-btn').click();
  await page.waitForTimeout(300);

  const error = await getErrorMessage(page);
  expect(error.length).toBeGreaterThan(0);
  expect(error.toLowerCase()).toContain('parse');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// Test 8: CLI `dataview` full command opens panel
// ══════════════════════════════════════════
test('8. CLI `dataview` full command opens the panel', async ({ page }) => {
  await runCLI(page, 'dataview');
  await page.waitForTimeout(500);

  const visible = await isDataviewVisible(page);
  expect(visible).toBe(true);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// Test 9: Folder query shows notes in a folder
// ══════════════════════════════════════════
test('9. QUERY FROM "folder" shows notes in that folder', async ({ page }) => {
  // Create notes with specific paths
  await page.evaluate(() => {
    if (!window.State) return;
    const now = Date.now();
    window.State.NOTES.push({
      id: 'journal_1_' + now,
      title: 'Daily Entry',
      content: 'A journal entry.\n#journal',
      blocks: [{ id: 'b1', type: 'p', content: 'A journal entry.' }],
      path: '/Journal',
      created: now,
      modified: now
    });
    window.State.NOTES.push({
      id: 'journal_2_' + now,
      title: 'Weekly Review',
      content: 'Weekly thoughts.\n#journal',
      blocks: [{ id: 'b1', type: 'p', content: 'Weekly thoughts.' }],
      path: '/Journal',
      created: now,
      modified: now
    });
    window.State.NOTES.push({
      id: 'work_note_' + now,
      title: 'Work Note',
      content: 'Work-related.\n#work',
      blocks: [{ id: 'b1', type: 'p', content: 'Work-related.' }],
      path: '/Work',
      created: now,
      modified: now
    });
    if (window.saveData) window.saveData();
    if (window.MetadataCache) {
      // Re-index all notes for the new data
      window.MetadataCache.initialized = false;
      window.MetadataCache.init();
    }
  });
  await page.waitForTimeout(500);

  await runCLI(page, 'dv LIST FROM "Journal"');
  await page.waitForTimeout(500);

  const visible = await isDataviewVisible(page);
  expect(visible).toBe(true);

  const titles = await getResultTitles(page);
  expect(titles.length).toBe(2);
  expect(titles).toContain('Daily Entry');
  expect(titles).toContain('Weekly Review');
  expect(titles).not.toContain('Work Note');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// Test 10: TASK query with content-fallback notes (no task-type blocks)
// ══════════════════════════════════════════
test('10. TASK query finds notes with task content in plain blocks (content fallback)', async ({ page }) => {
  // Create notes with task-like content (`- [ ]`) but NO task-type blocks.
  // The note content has `- [ ]` patterns, but blocks are type 'p' (paragraph),
  // not type 'task'. This tests the content-fallback fix in executeQuery().
  await page.evaluate(() => {
    if (!window.State || !window.MetadataCache) return;
    const now = Date.now();
    const ts = String(now).slice(-6);
    // Note with tasks in plain block content, no task-type blocks
    window.State.NOTES.push({
      id: 'note_inbox_' + ts,
      title: 'Inbox Tasks',
      content: '- [ ] Buy groceries\n- [x] Pay bills\n- [ ] Call dentist\n#errands',
      blocks: [
        { id: 'bi1_' + ts, type: 'p', content: '- [ ] Buy groceries\n- [x] Pay bills\n- [ ] Call dentist\n#errands' }
      ],
      path: '/Inbox',
      created: now,
      modified: now
    });
    // Second note with task-type blocks (standard approach, used for comparison)
    window.State.NOTES.push({
      id: 'note_sprint_' + ts,
      title: 'Sprint Tasks',
      content: '- [ ] Fix bug\n- [x] Deploy\n#errands',
      blocks: [
        { id: 'bs1_' + ts, type: 'task', content: 'Fix bug', checked: false },
        { id: 'bs2_' + ts, type: 'task', content: 'Deploy', checked: true },
        { id: 'bs3_' + ts, type: 'p', content: '#errands' }
      ],
      path: '/',
      created: now,
      modified: now
    });
    // Note with task content but NO tag — should NOT appear in results
    window.State.NOTES.push({
      id: 'note_untagged_' + ts,
      title: 'Untagged Task Note',
      content: '- [ ] Untagged item\n- [ ] Another',
      blocks: [
        { id: 'bu1_' + ts, type: 'p', content: '- [ ] Untagged item\n- [ ] Another' }
      ],
      path: '/',
      created: now,
      modified: now
    });
    window.MetadataCache.initialized = false;
    window.MetadataCache.init();
  });
  await page.waitForTimeout(500);

  // Open Dataview with TASK query, targeting the #errands tag
  await runCLI(page, 'dv TASK FROM #errands');
  await page.waitForTimeout(600);

  // Should see both notes with task content (Inbox via content fallback, Sprint via task blocks)
  const taskGroups = page.locator('.dv-task-group');
  await expect(taskGroups).toHaveCount(2, { timeout: 3000 });

  // Check group titles — should show both "Inbox Tasks" and "Sprint Tasks"
  const groupTitles = await page.evaluate(() => {
    const titles = document.querySelectorAll('.dv-task-group-title');
    return Array.from(titles).map(el => el.textContent.trim());
  });
  expect(groupTitles.some(t => t.startsWith('Inbox Tasks'))).toBe(true);
  expect(groupTitles.some(t => t.startsWith('Sprint Tasks'))).toBe(true);

  // Total task items should include both notes' tasks:
  //   Inbox Tasks: 3 (Buy groceries, Pay bills (done), Call dentist)
  //   Sprint Tasks: 2 (Fix bug, Deploy (done))
  const taskItems = page.locator('.dv-task-item');
  await expect(taskItems).toHaveCount(5, { timeout: 3000 });

  // Done tasks: Pay bills (Inbox) + Deploy (Sprint) = 2
  const doneTasks = page.locator('.dv-task-text.dv-task-done');
  await expect(doneTasks).toHaveCount(2, { timeout: 3000 });

  // Click the first Inbox Tasks item to open its note
  const inboxTask = page.locator('.dv-task-item[data-note-id*="inbox"]').first();
  await expect(inboxTask).toBeVisible({ timeout: 3000 });
  await inboxTask.click();
  await page.waitForTimeout(500);

  const editor = page.locator('#note-editor-modal');
  await expect(editor).toBeVisible({ timeout: 5000 });

  const titleInput = page.locator('#active-note-title');
  await expect(titleInput).toHaveValue('Inbox Tasks', { timeout: 3000 });

  await closeEditor(page);
});

// ══════════════════════════════════════════
// Test 11: Auto-complete suggests tags when typing #
// ══════════════════════════════════════════
test('11. Auto-complete shows tag suggestions when typing #', async ({ page }) => {
  // Create notes with various tags so MetadataCache has them indexed
  await page.evaluate(() => {
    if (!window.State || !window.MetadataCache) return;
    const now = Date.now();
    window.State.NOTES.push({ id: 'n1_' + now, title: 'Project Alpha', content: '#project\n#active', blocks: [{ id: 'b1', type: 'p', content: '#project\n#active' }], path: '/', created: now, modified: now });
    window.State.NOTES.push({ id: 'n2_' + now, title: 'Project Beta', content: '#project\n#backlog', blocks: [{ id: 'b2', type: 'p', content: '#project\n#backlog' }], path: '/', created: now, modified: now });
    window.State.NOTES.push({ id: 'n3_' + now, title: 'Journal Entry', content: '#journal\n#personal', blocks: [{ id: 'b3', type: 'p', content: '#journal\n#personal' }], path: '/Journal', created: now, modified: now });
    window.State.NOTES.push({ id: 'n4_' + now, title: 'Quick Notes', content: '#journal', blocks: [{ id: 'b4', type: 'p', content: '#journal' }], path: '/Journal/Quick', created: now, modified: now });
    window.MetadataCache.initialized = false;
    window.MetadataCache.init();
  });
  await page.waitForTimeout(500);

  // Open the Dataview panel
  await runCLI(page, 'dv');
  await page.waitForTimeout(300);

  const dvInput = page.locator('#dv-input');
  await expect(dvInput).toBeVisible();

  // Type a single # to trigger tag suggestions
  await dvInput.pressSequentially('#');
  await page.waitForTimeout(300);

  // Suggestions dropdown should appear
  const suggestions = page.locator('#dv-suggestions');
  await expect(suggestions).toHaveClass(/active/, { timeout: 2000 });

  // Should show multiple tag suggestions (auto-wait)
  const items = page.locator('.dv-suggestion-item');
  await expect.poll(async () => items.count(), { timeout: 5000 }).toBeGreaterThanOrEqual(4); // project, active, backlog, journal, personal

  // Filter by typing more
  await dvInput.pressSequentially('pro');
  await page.waitForTimeout(300);

  // Should now show only matching tags (active, backlog don't start with pro)
  const filteredItems = page.locator('.dv-suggestion-item');
  await expect.poll(async () => filteredItems.count(), { timeout: 5000 }).toBeGreaterThanOrEqual(1);

  // First suggestion should be "#project" (prefix match gets top score) — auto-wait
  await expect(page.locator('.dv-suggestion-item').first()).toContainText('project', { timeout: 3000 });

  // Press Enter to select the first suggestion
  await dvInput.press('Enter');
  await page.waitForTimeout(300);

  // Suggestions should disappear
  await expect(suggestions).not.toHaveClass(/active/, { timeout: 2000 });

  // Input should now contain #project with a space after (auto-wait)
  await expect(dvInput).toHaveValue(/#project/, { timeout: 3000 });

  // Close the panel
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// Test 12: Auto-complete shows folder suggestions when typing "
// ══════════════════════════════════════════
test('12. Auto-complete shows folder suggestions when typing "', async ({ page }) => {
  // Notes with various paths (already created in beforeEach if needed)
  await page.evaluate(() => {
    if (!window.State) return;
    const now = Date.now();
    window.State.NOTES.push({ id: 'f1_' + now, title: 'Journal 1', content: 'Entry', blocks: [{ id: 'b1', type: 'p', content: 'Entry' }], path: '/Journal', created: now, modified: now });
    window.State.NOTES.push({ id: 'f2_' + now, title: 'Journal 2', content: 'Entry', blocks: [{ id: 'b2', type: 'p', content: 'Entry' }], path: '/Journal/Quick', created: now, modified: now });
    window.State.NOTES.push({ id: 'f3_' + now, title: 'Work Note', content: 'Entry', blocks: [{ id: 'b3', type: 'p', content: 'Entry' }], path: '/Work', created: now, modified: now });
  });
  await page.waitForTimeout(300);

  await runCLI(page, 'dv');
  await page.waitForTimeout(300);

  const dvInput = page.locator('#dv-input');
  await expect(dvInput).toBeVisible();

  // Type LIST FROM " to trigger folder suggestions
  await dvInput.pressSequentially('LIST FROM "');
  await page.waitForTimeout(300);

  // Suggestions dropdown should appear
  const suggestions = page.locator('#dv-suggestions');
  await expect(suggestions).toHaveClass(/active/, { timeout: 2000 });

  // Should show folder suggestions (auto-wait)
  const items = page.locator('.dv-suggestion-item');
  await expect.poll(async () => items.count(), { timeout: 5000 }).toBeGreaterThanOrEqual(2); // Journal, Journal/Quick, Work

  // Filter by typing Jo
  await dvInput.pressSequentially('Jo');
  await page.waitForTimeout(300);

  // Should show Journal-related folders (auto-wait)
  const filteredItems = page.locator('.dv-suggestion-item');
  await expect.poll(async () => filteredItems.count(), { timeout: 5000 }).toBeGreaterThanOrEqual(2); // Journal, Journal/Quick

  // Press Tab to select the first suggestion (Tab also selects)
  await dvInput.press('Tab');
  await page.waitForTimeout(300);

  // Suggestions should disappear
  await expect(suggestions).not.toHaveClass(/active/, { timeout: 2000 });

  // Input should now contain "Journal" with closing quote and space
  const inputValue = await dvInput.inputValue();
  expect(inputValue).toContain('"Journal"');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// Test 13: Arrow keys navigate suggestions
// ══════════════════════════════════════════
test('13. Arrow keys navigate suggestion items', async ({ page }) => {
  // Ensure at least one note with tags exists
  await page.evaluate(() => {
    if (!window.State || !window.MetadataCache) return;
    const now = Date.now();
    window.State.NOTES.push({ id: 'a1_' + now, title: 'Alpha', content: '#alpha\n#active\n#archive', blocks: [{ id: 'b1', type: 'p', content: '#alpha\n#active\n#archive' }], path: '/', created: now, modified: now });
    window.MetadataCache.initialized = false;
    window.MetadataCache.init();
  });
  await page.waitForTimeout(500);

  await runCLI(page, 'dv');
  await page.waitForTimeout(300);

  const dvInput = page.locator('#dv-input');
  await expect(dvInput).toBeVisible();

  // Type # to trigger suggestions
  await dvInput.pressSequentially('#');
  await page.waitForTimeout(300);

  // First item should be selected by default
  let selectedText = await page.evaluate(() => {
    const selected = document.querySelector('.dv-suggestion-selected');
    return selected ? selected.textContent.trim() : '';
  });
  expect(selectedText.length).toBeGreaterThan(0);

  // Press ArrowDown
  await dvInput.press('ArrowDown');
  await page.waitForTimeout(200);

  // Second item should now be selected
  let secondSelected = await page.evaluate(() => {
    const items = document.querySelectorAll('.dv-suggestion-item');
    return items[1] && items[1].classList.contains('dv-suggestion-selected');
  });
  expect(secondSelected).toBe(true);

  // Press ArrowUp to go back
  await dvInput.press('ArrowUp');
  await page.waitForTimeout(200);

  // First item should be selected again
  let firstSelected = await page.evaluate(() => {
    const items = document.querySelectorAll('.dv-suggestion-item');
    return items[0] && items[0].classList.contains('dv-suggestion-selected');
  });
  expect(firstSelected).toBe(true);

  // Escape should hide suggestions but keep panel open
  await dvInput.press('Escape');
  await page.waitForTimeout(200);

  const suggestions = page.locator('#dv-suggestions');
  await expect(suggestions).not.toHaveClass(/active/, { timeout: 2000 });

  // Panel should still be open
  const dvVisible = await page.evaluate(() => {
    const modal = document.getElementById('dv-modal');
    return modal && modal.classList.contains('active');
  });
  expect(dvVisible).toBe(true);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// Test 14: Click-to-select suggestion
// ══════════════════════════════════════════
test('14. Clicking a suggestion selects it', async ({ page }) => {
  await page.evaluate(() => {
    if (!window.State || !window.MetadataCache) return;
    const now = Date.now();
    window.State.NOTES.push({ id: 'c1_' + now, title: 'Config Note', content: '#config\n#settings', blocks: [{ id: 'b1', type: 'p', content: '#config\n#settings' }], path: '/', created: now, modified: now });
    window.MetadataCache.initialized = false;
    window.MetadataCache.init();
  });
  await page.waitForTimeout(500);

  await runCLI(page, 'dv');
  await page.waitForTimeout(300);

  const dvInput = page.locator('#dv-input');
  await expect(dvInput).toBeVisible();

  // Type #c to filter to #config
  await dvInput.pressSequentially('#c');
  await page.waitForTimeout(300);

  // Suggestions dropdown should appear
  const suggestions = page.locator('#dv-suggestions');
  await expect(suggestions).toHaveClass(/active/, { timeout: 2000 });

  // Click the first suggestion item
  const firstItem = page.locator('.dv-suggestion-item').first();
  await expect(firstItem).toBeVisible();
  await firstItem.click();
  await page.waitForTimeout(300);

  // Suggestions should disappear
  await expect(suggestions).not.toHaveClass(/active/, { timeout: 2000 });

  // Input should contain the selected tag
  const inputValue = await dvInput.inputValue();
  expect(inputValue).toContain('#config');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});
