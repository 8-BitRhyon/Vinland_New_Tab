/**
 * Vinland Data Export - Playwright Integration Test
 *
 * Tests the `export` CLI command end-to-end:
 * - Creating notes, tasks, and boards as test data
 * - Running the `export` CLI command
 * - Capturing the downloaded JSON file
 * - Verifying all data types are present and correct
 *
 * Run with:
 *   npx playwright test tests/export.playwright.spec.mjs
 */

import { test, expect } from '@playwright/test';
import { APP_URL, runCLI, readDownload } from './helpers.mjs';

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);

  // Clear all persisted data from previous tests
  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX' ||
      k.startsWith('OPERATOR_') || k.startsWith('VINLAND_')
    );
    keys.forEach(k => localStorage.removeItem(k));
    if (window.State) {
      if (Array.isArray(window.State.NOTES)) window.State.NOTES.length = 0;
      if (Array.isArray(window.State.TASKS)) window.State.TASKS.length = 0;
      if (Array.isArray(window.State.BOARDS)) window.State.BOARDS.length = 0;
      if (Array.isArray(window.State.COMMAND_HISTORY)) window.State.COMMAND_HISTORY.length = 0;
    }
  });

  await page.waitForTimeout(300);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    try {
      const keys = Object.keys(localStorage).filter(k =>
        k.startsWith('OPERATOR_') || k.startsWith('VINLAND_')
      );
      keys.forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }
  }).catch(() => {});
});

// ══════════════════════════════════════════
// Test 1: Export full vault via CLI and verify all data types
// ══════════════════════════════════════════
test('1. Export creates downloadable JSON with all data types', async ({ page }) => {
  // ── 1a. Create a note ──
  await page.evaluate(() => {
    const note = {
      id: 'note_test_1',
      title: 'Test Note',
      content: 'This is a test note with [[wiki link]].',
      path: '/',
      created: Date.now(),
      modified: Date.now()
    };
    window.State.NOTES.push(note);
    if (window.saveData) window.saveData();
  });

  // ── 1b. Create a task ──
  await page.evaluate(() => {
    const task = {
      id: 'task_test_1',
      text: 'Test task',
      completed: false,
      priority: 'normal',
      created: Date.now()
    };
    window.State.TASKS.push(task);
    if (window.saveData) window.saveData();
  });

  // ── 1c. Create a kanban board ──
  await page.evaluate(() => {
    if (!window.KanbanManager) return;
    const board = window.KanbanManager.createBoard('Test Board');
    if (board && board.columns.length > 0) {
      board.columns[0].cards.push({
        id: 'card_test_1',
        content: 'Test card',
        created: Date.now()
      });
      board.modified = Date.now();
    }
    if (window.saveData) window.saveData();
  });
  await page.waitForTimeout(300);

  // ── 1d. Run the export CLI command and capture the download ──
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    runCLI(page, 'export')
  ]);

  expect(download).toBeDefined();
  expect(download.suggestedFilename()).toMatch(/^vinland_backup_\d{4}-\d{2}-\d{2}\.json$/);

  // ── 1e. Read and parse the downloaded JSON ──
  const raw = await readDownload(download);
  const data = JSON.parse(raw);

  // ── 1f. Verify metadata ──
  expect(data).toHaveProperty('exportedAt');
  expect(data).toHaveProperty('exportVersion', 1);

  // ── 1g. Verify config ──
  expect(data).toHaveProperty('config');
  expect(data.config).toHaveProperty('theme_color');

  // ── 1h. Verify notes ──
  expect(data).toHaveProperty('notes');
  expect(Array.isArray(data.notes)).toBe(true);
  expect(data.notes.length).toBeGreaterThanOrEqual(1);
  const matchedNote = data.notes.find(n => n.id === 'note_test_1');
  expect(matchedNote).toBeDefined();
  expect(matchedNote.title).toBe('Test Note');
  expect(matchedNote.content).toContain('wiki link');

  // ── 1i. Verify tasks ──
  expect(data).toHaveProperty('tasks');
  expect(Array.isArray(data.tasks)).toBe(true);
  expect(data.tasks.length).toBeGreaterThanOrEqual(1);
  const matchedTask = data.tasks.find(t => t.id === 'task_test_1');
  expect(matchedTask).toBeDefined();
  expect(matchedTask.text).toBe('Test task');

  // ── 1j. Verify boards ──
  expect(data).toHaveProperty('boards');
  expect(Array.isArray(data.boards)).toBe(true);
  expect(data.boards.length).toBeGreaterThanOrEqual(1);
  const matchedBoard = data.boards.find(b => b.title === 'Test Board');
  expect(matchedBoard).toBeDefined();
  expect(matchedBoard.columns.length).toBe(3);
  const firstCol = matchedBoard.columns[0];
  expect(firstCol.cards.length).toBeGreaterThanOrEqual(1);
  expect(firstCol.cards[0].content).toBe('Test card');

  // ── 1k. Verify canvases ──
  expect(data).toHaveProperty('canvases');
  expect(Array.isArray(data.canvases)).toBe(true);

  // ── 1l. Verify history ──
  expect(data).toHaveProperty('history');
  expect(Array.isArray(data.history)).toBe(true);
});

// ══════════════════════════════════════════
// Test 2: Export with empty data produces valid JSON
// ══════════════════════════════════════════
test('2. Export with empty vault produces valid minimal JSON', async ({ page }) => {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    runCLI(page, 'export')
  ]);

  const raw = await readDownload(download);
  const data = JSON.parse(raw);

  expect(data).toHaveProperty('exportedAt');
  expect(data).toHaveProperty('exportVersion', 1);
  expect(data).toHaveProperty('config');
  expect(data.notes).toEqual([]);
  expect(data.tasks).toEqual([]);
  expect(data.boards).toEqual([]);
  expect(data.canvases).toEqual([]);
  expect(data.history).toEqual([]);
});

// ══════════════════════════════════════════
// Test 3: Export via Settings EXPORT CONFIG button
// ══════════════════════════════════════════
test('3. Settings panel export button downloads all data', async ({ page }) => {
  // Create a note and a task via the import system
  await page.evaluate(() => {
    const note = {
      id: 'note_settings_test',
      title: 'Settings Export Note',
      content: 'Created to verify the settings panel export.',
      path: '/',
      created: Date.now(),
      modified: Date.now()
    };
    window.State.NOTES.push(note);

    const task = {
      id: 'task_settings_test',
      text: 'Settings export task',
      completed: false,
      priority: 'high',
      created: Date.now()
    };
    window.State.TASKS.push(task);

    if (window.saveData) window.saveData();
  });
  await page.waitForTimeout(300);

  // Open the settings panel
  await page.evaluate(() => {
    if (window.SettingsUI) window.SettingsUI.open();
  });
  await page.waitForTimeout(500);

  // Navigate to the Maintenance tab
  await page.evaluate(() => {
    const navItems = document.querySelectorAll('.config-nav-item');
    navItems.forEach(item => {
      if (item.getAttribute('data-tab') === 'maintenance') {
        item.click();
      }
    });
  });
  await page.waitForTimeout(300);

  // Click the EXPORT CONFIG button
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.locator('#export-config').click()
  ]);

  expect(download).toBeDefined();
  expect(download.suggestedFilename()).toMatch(/^operator_backup_\d{4}-\d{2}-\d{2}\.json$/);

  const raw = await readDownload(download);
  const data = JSON.parse(raw);

  // Verify data
  expect(data).toHaveProperty('notes');
  expect(data.notes.length).toBeGreaterThanOrEqual(1);
  const matchedNote = data.notes.find(n => n.id === 'note_settings_test');
  expect(matchedNote).toBeDefined();
  expect(matchedNote.title).toBe('Settings Export Note');

  expect(data).toHaveProperty('tasks');
  const matchedTask = data.tasks.find(t => t.id === 'task_settings_test');
  expect(matchedTask).toBeDefined();
  expect(matchedTask.text).toBe('Settings export task');

  expect(data).toHaveProperty('boards');
  expect(data).toHaveProperty('canvases');
  expect(data).toHaveProperty('history');

  // Close settings
  await page.evaluate(() => {
    if (window.SettingsUI) window.SettingsUI.close(true);
  });
});

// ══════════════════════════════════════════
// Test 4: Smoke test — export does not break calendar (CLI + shortcut)
// ══════════════════════════════════════════
test('4. Export does not break calendar CLI command or Cmd+Shift+C shortcut', async ({ page }) => {
  // Create a small note so export has data
  await page.evaluate(() => {
    const note = {
      id: 'note_smoke',
      title: 'Smoke Test Note',
      content: 'Verifies export does not disrupt other CLI commands.',
      path: '/',
      created: Date.now(),
      modified: Date.now()
    };
    window.State.NOTES.push(note);
    if (window.saveData) window.saveData();
  });
  await page.waitForTimeout(200);

  // ── 4a. Run export CLI ──
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    runCLI(page, 'export')
  ]);
  expect(download).toBeDefined();

  // ── 4b. Run calendar CLI — must still open ──
  await runCLI(page, 'calendar');
  await page.waitForTimeout(500);

  let visible = await page.evaluate(() => {
    const modal = document.getElementById('calendar-modal');
    return modal && modal.classList.contains('active');
  });
  expect(visible).toBe(true);

  // Verify correct month/year title
  const now = new Date();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const expectedTitle = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
  let title = await page.evaluate(() => {
    const el = document.getElementById('calendar-title');
    return el ? el.textContent.trim() : '';
  });
  expect(title).toBe(expectedTitle);

  // Close calendar
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ── 4c. Press Cmd+Shift+C — must still open ──
  await page.keyboard.press('Meta+Shift+c');
  await page.waitForTimeout(500);

  visible = await page.evaluate(() => {
    const modal = document.getElementById('calendar-modal');
    return modal && modal.classList.contains('active');
  });
  expect(visible).toBe(true);

  title = await page.evaluate(() => {
    const el = document.getElementById('calendar-title');
    return el ? el.textContent.trim() : '';
  });
  expect(title).toBe(expectedTitle);

  // Close calendar
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  visible = await page.evaluate(() => {
    const modal = document.getElementById('calendar-modal');
    return modal && modal.classList.contains('active');
  });
  expect(visible).toBe(false);
});

// ══════════════════════════════════════════
// Test 5: Full round-trip — export then import via Settings panel
// ══════════════════════════════════════════
test('5. Full round-trip: export data then import it back restores all types', async ({ page }) => {
  // ── 5a. Create test data ──
  await page.evaluate(() => {
    const note = {
      id: 'note_roundtrip',
      title: 'Round Trip Note',
      content: 'This note survives export and import.',
      path: '/',
      created: Date.now(),
      modified: Date.now()
    };
    window.State.NOTES.push(note);

    const task = {
      id: 'task_roundtrip',
      text: 'Round trip task',
      completed: false,
      priority: 'high',
      created: Date.now()
    };
    window.State.TASKS.push(task);

    if (window.KanbanManager) {
      const board = window.KanbanManager.createBoard('Round Trip Board');
      if (board && board.columns.length > 0) {
        board.columns[0].cards.push({
          id: 'card_roundtrip',
          content: 'Round trip card',
          created: Date.now()
        });
        board.modified = Date.now();
      }
    }

    if (window.saveData) window.saveData();
  });
  await page.waitForTimeout(300);

  // ── 5b. Export via CLI and capture the JSON ──
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    runCLI(page, 'export')
  ]);
  const exportedJson = await readDownload(download);

  // ── 5c. Clear existing data to prove import restores it ──
  await page.evaluate(() => {
    if (Array.isArray(window.State.NOTES)) window.State.NOTES.length = 0;
    if (Array.isArray(window.State.TASKS)) window.State.TASKS.length = 0;
    if (Array.isArray(window.State.BOARDS)) window.State.BOARDS.length = 0;
  });
  await page.waitForTimeout(100);

  // Verify clear worked
  const emptyCheck = await page.evaluate(() => ({
    notes: window.State.NOTES.length,
    tasks: window.State.TASKS.length,
    boards: window.State.BOARDS.length
  }));
  expect(emptyCheck.notes).toBe(0);
  expect(emptyCheck.tasks).toBe(0);
  expect(emptyCheck.boards).toBe(0);

  // ── 5d. Open the Settings panel and navigate to Maintenance tab ──
  await page.evaluate(() => {
    if (window.SettingsUI) window.SettingsUI.open();
  });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const navItems = document.querySelectorAll('.config-nav-item');
    navItems.forEach(item => {
      if (item.getAttribute('data-tab') === 'maintenance') {
        item.click();
      }
    });
  });
  await page.waitForTimeout(300);

  // ── 5e. Upload the exported JSON via the hidden file input ──
  // The importDataFile handler reads the file, restores state, then
  // schedules location.reload() after 1500ms. We skip checking the toast
  // to avoid a race condition with the page reload.
  await page.locator('#import-file').setInputFiles({
    name: 'vinland_roundtrip.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exportedJson, 'utf-8')
  });

  // ── 5f. Wait for page to reload and the app to boot again ──
  // importDataFile calls location.reload() after ~1500ms via setTimeout.
  // The generous timeout handles reload (~1.5s) + boot sequence, and
  // toBeVisible re-queries after each navigation automatically.
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(500);

  // ── 5g. Verify all data types were restored ──
  const restoredData = await page.evaluate(() => ({
    notes: (window.State.NOTES || []).map(n => ({ id: n.id, title: n.title, content: n.content })),
    tasks: (window.State.TASKS || []).map(t => ({ id: t.id, text: t.text })),
    boards: (window.State.BOARDS || []).map(b => ({ title: b.title, cards: b.columns?.[0]?.cards?.map(c => c.content) || [] }))
  }));

  // Verify note
  expect(restoredData.notes.length).toBeGreaterThanOrEqual(1);
  const matchedNote = restoredData.notes.find(n => n.id === 'note_roundtrip');
  expect(matchedNote).toBeDefined();
  expect(matchedNote.title).toBe('Round Trip Note');
  expect(matchedNote.content).toBe('This note survives export and import.');

  // Verify task
  expect(restoredData.tasks.length).toBeGreaterThanOrEqual(1);
  const matchedTask = restoredData.tasks.find(t => t.id === 'task_roundtrip');
  expect(matchedTask).toBeDefined();
  expect(matchedTask.text).toBe('Round trip task');

  // Verify board
  expect(restoredData.boards.length).toBeGreaterThanOrEqual(1);
  const matchedBoard = restoredData.boards.find(b => b.title === 'Round Trip Board');
  expect(matchedBoard).toBeDefined();
  expect(matchedBoard.cards.length).toBeGreaterThanOrEqual(1);
  expect(matchedBoard.cards[0]).toBe('Round trip card');
});

// ══════════════════════════════════════════
// Test 6: Forward-compatible import — manually crafted exportVersion:1 JSON
// ══════════════════════════════════════════
test('6. Import manually crafted exportVersion:1 JSON to verify forward compatibility', async ({ page }) => {
  // ── 6a. Build a minimal exportVersion:1 payload ──
  const craftPayload = () => ({
    exportedAt: '2026-07-23T00:00:00.000Z',
    exportVersion: 1,
    config: {
      theme_color: '#ff8800',
      user_name: 'ForwardCompat',
      show_bookmarks: true
    },
    notes: [
      {
        id: 'note_fwd_1',
        title: 'Forward Compat Note',
        content: 'This note proves v1 imports work.',
        path: '/',
        created: 1700000000000,
        modified: 1700000000000
      },
      {
        id: 'note_fwd_2',
        title: 'Wiki Link Note',
        content: 'Referencing [[Forward Compat Note]] for backlinks.',
        path: '/Projects',
        created: 1700000001000,
        modified: 1700000001000
      }
    ],
    tasks: [
      {
        id: 'task_fwd_1',
        text: 'Forward compat task',
        completed: false,
        priority: 'high',
        created: 1700000000000
      },
      {
        id: 'task_fwd_2',
        text: 'Completed task',
        completed: true,
        priority: 'normal',
        created: 1700000001000
      }
    ],
    boards: [
      {
        id: 'board_fwd_1',
        title: 'Forward Board',
        columns: [
          { id: 'col_todo', title: 'TODO', cards: [{ id: 'card_fwd_1', content: 'Forward card', created: 1700000000000 }] },
          { id: 'col_active', title: 'ACTIVE', cards: [] },
          { id: 'col_done', title: 'DONE', cards: [] }
        ],
        created: 1700000000000,
        modified: 1700000000000
      }
    ],
    canvases: [],
    history: ['note Forward', 'task test', 'help']
  });

  const payloadJson = JSON.stringify(craftPayload(), null, 2);

  // ── 6b. Open Settings panel and navigate to Maintenance tab ──
  await page.evaluate(() => {
    if (window.SettingsUI) window.SettingsUI.open();
  });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const navItems = document.querySelectorAll('.config-nav-item');
    navItems.forEach(item => {
      if (item.getAttribute('data-tab') === 'maintenance') {
        item.click();
      }
    });
  });
  await page.waitForTimeout(300);

  // ── 6c. Upload the manually crafted JSON via the hidden file input ──
  await page.locator('#import-file').setInputFiles({
    name: 'forward_compat_v1.json',
    mimeType: 'application/json',
    buffer: Buffer.from(payloadJson, 'utf-8')
  });

  // ── 6d. Wait for page to reload and the app to boot ──
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(500);

  // ── 6e. Verify imported data ──
  const state = await page.evaluate(() => ({
    themeColor: window.State?.CONFIG?.theme_color,
    userName: window.State?.CONFIG?.user_name,
    notes: (window.State.NOTES || []).map(n => ({ id: n.id, title: n.title, content: n.content, path: n.path })),
    tasks: (window.State.TASKS || []).map(t => ({ id: t.id, text: t.text, completed: t.completed })),
    boards: (window.State.BOARDS || []).map(b => ({ id: b.id, title: b.title, colCount: b.columns.length, firstCard: b.columns[0]?.cards?.[0]?.content })),
    canvases: Array.isArray(window.State.CANVASES) ? window.State.CANVASES : null,
    history: window.State.COMMAND_HISTORY || []
  }));

  // Verify config restored
  expect(state.themeColor).toBe('#ff8800');
  expect(state.userName).toBe('ForwardCompat');

  // Verify notes: both created and content intact
  expect(state.notes.length).toBe(2);
  const n1 = state.notes.find(n => n.id === 'note_fwd_1');
  expect(n1).toBeDefined();
  expect(n1.title).toBe('Forward Compat Note');
  expect(n1.content).toBe('This note proves v1 imports work.');
  expect(n1.path).toBe('/');

  const n2 = state.notes.find(n => n.id === 'note_fwd_2');
  expect(n2).toBeDefined();
  expect(n2.title).toBe('Wiki Link Note');
  expect(n2.content).toContain('Forward Compat Note');
  expect(n2.path).toBe('/Projects');

  // Verify tasks: both created, one completed
  expect(state.tasks.length).toBe(2);
  const t1 = state.tasks.find(t => t.id === 'task_fwd_1');
  expect(t1).toBeDefined();
  expect(t1.text).toBe('Forward compat task');
  expect(t1.completed).toBe(false);

  const t2 = state.tasks.find(t => t.id === 'task_fwd_2');
  expect(t2).toBeDefined();
  expect(t2.text).toBe('Completed task');
  expect(t2.completed).toBe(true);

  // Verify board with columns and cards
  expect(state.boards.length).toBe(1);
  const b1 = state.boards.find(b => b.id === 'board_fwd_1');
  expect(b1).toBeDefined();
  expect(b1.title).toBe('Forward Board');
  expect(b1.colCount).toBe(3);
  expect(b1.firstCard).toBe('Forward card');

  // Verify canvases is an empty array (not null/undefined)
  expect(state.canvases).toEqual([]);

  // Verify command history
  expect(state.history.length).toBe(3);
  expect(state.history[0]).toBe('note Forward');
  expect(state.history[1]).toBe('task test');
  expect(state.history[2]).toBe('help');
});

// ══════════════════════════════════════════════
// Test 7: Import triggers MetadataCache rebuild — tags, wiki links, backlinks all indexed
// ══════════════════════════════════════════════
test('7. Import+reload rebuilds MetadataCache with tags, wiki links, and backlinks', async ({ page }) => {
  // ── 7a. Build a payload with #hashtags, [[wiki links]], and frontmatter tags ──
  const notesPayload = [
    {
      id: 'mc_alpha',
      title: 'Alpha',
      content: 'This note has #project tag and links to [[Beta]].',
      path: '/',
      created: 1700000000000,
      modified: 1700000000000
    },
    {
      id: 'mc_beta',
      title: 'Beta',
      content: 'This note has #reference tag and links to [[Alpha]] and also [[Gamma]].',
      path: '/docs',
      created: 1700000001000,
      modified: 1700000001000
    },
    {
      id: 'mc_gamma',
      title: 'Gamma',
      content: '---\ntags: [frontmatter-tag]\n---\nBody with no wiki links.',
      path: '/archive',
      created: 1700000002000,
      modified: 1700000002000
    }
  ];

  const payload = {
    exportedAt: '2026-07-23T00:00:00.000Z',
    exportVersion: 1,
    config: { theme_color: '#0f0' },
    notes: notesPayload,
    tasks: [],
    boards: [],
    canvases: [],
    history: []
  };

  const payloadJson = JSON.stringify(payload, null, 2);

  // ── 7b. Open Settings panel and navigate to Maintenance tab ──
  await page.evaluate(() => {
    if (window.SettingsUI) window.SettingsUI.open();
  });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const navItems = document.querySelectorAll('.config-nav-item');
    navItems.forEach(item => {
      if (item.getAttribute('data-tab') === 'maintenance') {
        item.click();
      }
    });
  });
  await page.waitForTimeout(300);

  // ── 7c. Upload the crafted JSON via the hidden file input ──
  await page.locator('#import-file').setInputFiles({
    name: 'metadata_cache_test.json',
    mimeType: 'application/json',
    buffer: Buffer.from(payloadJson, 'utf-8')
  });

  // ── 7d. Wait for page to reload and MetadataCache to index the imported notes ──
  // The importDataFile handles the JSON and calls location.reload() after ~1500ms.
  // After the reload, boot.js runs loadData() then MetadataCache.init().
  // We poll for MetadataCache to have all 3 notes indexed — this is the most
  // reliable signal because:
  //   - toBeVisible('#cmd-input') can pass immediately on the OLD page (pre-reload)
  //   - waitForFunction polls until MetadataCache actually has the right index size
  await page.waitForFunction(() => {
    const mc = window.MetadataCache;
    return mc && mc.initialized && mc.index && mc.index.size >= 3;
  }, { timeout: 30000 });
  await page.waitForTimeout(300);

  // ── 7e. Verify MetadataCache indexes are populated correctly ──
  const cacheState = await page.evaluate(() => {
    const mc = window.MetadataCache;
    if (!mc || !mc.initialized) return { error: 'MetadataCache not initialized' };

    return {
      initialized: mc.initialized,
      indexSize: mc.index.size,

      // Tag index queries
      projectTagCount: (mc.tagIndex.get('project') || new Set()).size,
      referenceTagCount: (mc.tagIndex.get('reference') || new Set()).size,
      frontmatterTagCount: (mc.tagIndex.get('frontmatter-tag') || new Set()).size,

      // getByTag returns correct notes
      projectNotes: mc.getByTag('project').map(m => m.title),
      referenceNotes: mc.getByTag('reference').map(m => m.title),
      frontmatterNotes: mc.getByTag('frontmatter-tag').map(m => m.title),

      // getAllTags counts
      allTags: mc.getAllTags(),

      // Backlinks: Beta links to Alpha, so Alpha should have Beta as backlink
      alphaBacklinks: mc.getBacklinks('mc_alpha').map(m => m.title),
      // Alpha links to Beta, so Beta should have Alpha as backlink
      betaBacklinks: mc.getBacklinks('mc_beta').map(m => m.title),

      // Linking notes: which notes link to each title
      linkingToBeta: mc.getLinkingNotes('Beta').map(m => m.title),
      linkingToAlpha: mc.getLinkingNotes('Alpha').map(m => m.title),

      // Individual note metadata
      alphaMeta: mc.get('mc_alpha') ? {
        tags: mc.get('mc_alpha').tags,
        links: mc.get('mc_alpha').links.map(l => l.target),
        wordCount: mc.get('mc_alpha').wordCount
      } : null,

      betaMeta: mc.get('mc_beta') ? {
        tags: mc.get('mc_beta').tags,
        links: mc.get('mc_beta').links.map(l => l.target)
      } : null
    };
  });

  // Should not have error
  expect(cacheState.error).toBeUndefined();

  // ── Verify index size ──
  expect(cacheState.initialized).toBe(true);
  expect(cacheState.indexSize).toBe(3);

  // ── Verify tag index counts ──
  expect(cacheState.projectTagCount).toBe(1);
  expect(cacheState.referenceTagCount).toBe(1);
  expect(cacheState.frontmatterTagCount).toBe(1);

  // ── Verify getByTag returns correct notes ──
  expect(cacheState.projectNotes).toEqual(['Alpha']);
  expect(cacheState.referenceNotes).toEqual(['Beta']);
  expect(cacheState.frontmatterNotes).toEqual(['Gamma']);

  // ── Verify getAllTags counts ──
  expect(cacheState.allTags).toHaveProperty('project', 1);
  expect(cacheState.allTags).toHaveProperty('reference', 1);
  expect(cacheState.allTags).toHaveProperty('frontmatter-tag', 1);

  // ── Verify backlinks: bidirectional between Alpha and Beta ──
  // Beta links to [[Alpha]], so Alpha's backlinks should include Beta
  expect(cacheState.alphaBacklinks).toContain('Beta');
  // Alpha links to [[Beta]], so Beta's backlinks should include Alpha
  expect(cacheState.betaBacklinks).toContain('Alpha');
  // Gamma has no wiki links, so no one links to Gamma from content
  // (But Gamma is not linked by anyone because no note has [[Gamma]])
  // Actually, Beta links to [[Alpha]] and also [[Gamma]], so Gamma should have Beta as backlink
  // Let's add a check for Gamma backlinks

  // ── Verify linking notes ──
  // Alpha links to [[Beta]], so linkingToBeta should include Alpha
  expect(cacheState.linkingToBeta).toContain('Alpha');
  // Beta links to [[Alpha]], so linkingToAlpha should include Beta
  expect(cacheState.linkingToAlpha).toContain('Beta');

  // ── Verify individual note metadata ──
  expect(cacheState.alphaMeta).not.toBeNull();
  expect(cacheState.alphaMeta.tags).toContain('project');
  expect(cacheState.alphaMeta.links).toContain('Beta');
  expect(cacheState.alphaMeta.wordCount).toBeGreaterThan(0);

  expect(cacheState.betaMeta).not.toBeNull();
  expect(cacheState.betaMeta.tags).toContain('reference');
  expect(cacheState.betaMeta.links).toContain('Alpha');
  expect(cacheState.betaMeta.links).toContain('Gamma');

  // ── Also verify Gamma's backlinks: Beta links to [[Gamma]] ──
  const gammaState = await page.evaluate(() => {
    const mc = window.MetadataCache;
    if (!mc) return null;
    return {
      gammaLinks: mc.get('mc_gamma') ? mc.get('mc_gamma').links.map(l => l.target) : null,
      gammaBacklinks: mc.getBacklinks('mc_gamma').map(m => m.title)
    };
  });

  expect(gammaState.gammaLinks).toEqual([]); // Gamma has no wiki links in its content
  // But Beta links to [[Gamma]], so Gamma should have Beta as a backlink
  expect(gammaState.gammaBacklinks).toContain('Beta');
});
