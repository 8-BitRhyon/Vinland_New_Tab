

import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:9999';

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

async function clearToasts(page) {
  await page.evaluate(() => {
    const t = document.getElementById('notif-toast');
    if (t) t.remove();
  });
}

async function runCLI(page, command) {
  const cmdInput = page.locator('#cmd-input');
  await cmdInput.waitFor({ state: 'visible', timeout: 10000 });
  await cmdInput.fill(command);
  await cmdInput.press('Enter');
  await page.waitForTimeout(400);
}


async function expectCommandOk(page, command, targetSelector, opts = {}) {
  const { timeout = 7000 } = opts;
  await clearToasts(page);
  await runCLI(page, command);

  // CommandLine.execute always shows `COMMAND: <title>` synchronously on
  // success and `ERROR: <msg>` on a thrown exception — so wait for the toast
  // to actually render, then assert it is not an error.
  const toast = page.locator('#notif-toast');
  await toast.waitFor({ state: 'visible', timeout: 3000 }).catch(function() {});
  if (await toast.count() > 0) {
    const text = (await toast.textContent()) || '';
    expect(text, `command "${command}" should not show an ERROR toast`).not.toContain('ERROR');
  }

  if (targetSelector) {
    await expect(page.locator(targetSelector)).toBeVisible({ timeout });
  }

  // Close whatever opened so the next command starts clean.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

async function openApp(page) {
  await page.goto(APP_URL);
  await page.locator('#cmd-input').waitFor({ state: 'visible', timeout: 15000 });
  // Close any modal/overlay that opened during boot (e.g. auto-open note editor).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// ──────────────────────────────────────────
// Tests
// ──────────────────────────────────────────

test.describe('CLI command sweep', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('notes, canvas, and navigation commands', async ({ page }) => {
    // notes:create — opens the note editor
    await expectCommandOk(page, 'note SweepNote', '#note-editor-modal');

    // notes:toggle — toggles the sidebar collapsed state
    const sidebar = page.locator('.notes-sidebar');
    const before = await sidebar.evaluate(function(el) { return el.classList.contains('collapsed'); });
    await clearToasts(page);
    await runCLI(page, 'notes');
    await expect.poll(async function() {
      return sidebar.evaluate(function(el) { return el.classList.contains('collapsed'); });
    }, { timeout: 3000 }).not.toBe(before);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    // canvas:open — creates canvas note and shows canvas container
    await expectCommandOk(page, 'canvas', '#canvas-container');

    // nav:daily — opens/creates daily note
    await expectCommandOk(page, 'daily', '#note-editor-modal');

    // nav:random — opens a random text note (canvas notes are excluded)
    await expectCommandOk(page, 'random', '#note-editor-modal');

    // info:find / info:search — quick-open overlay
    await expectCommandOk(page, 'find SweepNote', '#quick-open-overlay');
    await expectCommandOk(page, 'search SweepNote', '#quick-open-overlay');

    // nav:calendar — calendar overlay
    await expectCommandOk(page, 'calendar', '#calendar-overlay');

    // nav:agenda — agenda modal
    await expectCommandOk(page, 'agenda', '#agenda-modal');

    // nav:templates — template browser overlay
    await expectCommandOk(page, 'template', '#template-browser-overlay');

    // nav:tags — tag browser overlay
    await expectCommandOk(page, 'tags', '#tag-browser-overlay');

    // dataview:open / dataview:open-full — dv modal
    await expectCommandOk(page, 'dv', '#dv-modal');
    await expectCommandOk(page, 'dataview', '#dv-modal');

    // version:history — version history modal
    await expectCommandOk(page, 'versions', '#version-history-modal');

    // workspace:manage — workspace overlay
    await expectCommandOk(page, 'workspace', '#workspace-overlay');

    // attachments:list — attachment browser modal
    await expectCommandOk(page, 'attachments', '#attachment-browser-modal');
  });

  test('system, utility, and tool commands', async ({ page }) => {
    // task:add — appends a task to the mission list
    await clearToasts(page);
    await runCLI(page, 'task SweepTask');
    const toast = page.locator('#notif-toast');
    if (await toast.count() > 0) {
      const text = (await toast.textContent()) || '';
      expect(text, 'task command should not show an ERROR toast').not.toContain('ERROR');
    }
    const missionList = page.locator('#mission-list');
    await expect(missionList).toContainText('SweepTask', { timeout: 5000 });

    // task:clear-done — no crash
    await expectCommandOk(page, 'clear done', null);

    // sys:theme — reset to defaults (no crash)
    await expectCommandOk(page, 'theme default', null);

    // ui:zen — toggles zen mode class on body
    await clearToasts(page);
    await runCLI(page, 'zen');
    await expect(page.locator('body')).toHaveClass(/zen-mode/, { timeout: 3000 });
    await runCLI(page, 'zen'); // toggle back off
    await page.waitForTimeout(250);

    // ui:kill — closes all modals (no crash)
    await expectCommandOk(page, 'kill', null);

    // kanban:open / kanban:quick — kanban modal
    await expectCommandOk(page, 'board', '#kanban-modal');
    await expectCommandOk(page, 'kanban', '#kanban-modal');

    // info:help / info:man — help modal
    await expectCommandOk(page, 'help', '#help-modal');
    await expectCommandOk(page, 'man', '#help-modal');

    // pomo:start — starts pomodoro (no crash)
    await expectCommandOk(page, 'pomo 25', null);

    // info:weather — fetch weather. The external open-meteo APIs are mocked
    // with route interception so the assertion is fully deterministic in CI
    // (no live network, no async error toast race). We then assert both the
    // COMMAND toast (no ERROR) and that the widget rendered a temperature.
    await page.route('https://geocoding-api.open-meteo.com/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [{ name: 'London', latitude: 51.5, longitude: -0.12 }] }),
      });
    });
    await page.route('https://api.open-meteo.com/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          current: { temperature_2m: 18.5, relative_humidity_2m: 65, precipitation: 0, weather_code: 1, wind_speed_10m: 12 },
        }),
      });
    });
    await expectCommandOk(page, 'weather London', null, { timeout: 9000 });
    // The mocked fetch must render a real temperature into the widget.
    // (Weather.render() rebuilds the widget with class="weather-temp" — the
    // id="weather-temp" only exists in the initial static HTML, so select
    // by class, not id.)
    await expect(page.locator('.weather-temp')).toHaveText(/\d+°/, { timeout: 5000 });

    // bm:search — no bookmarks in test env → "not found" toast, no crash
    await expectCommandOk(page, 'b nonexistentbookmark', null);

    // flashcard:review — opens review modal
    await expectCommandOk(page, 'review', '#review-modal', { timeout: 9000 });

    // flashcard:stats — stats then review modal
    await expectCommandOk(page, 'flashcards', '#review-modal', { timeout: 9000 });

    // obsidian:import — file picker trigger (no crash)
    await expectCommandOk(page, 'obsidian-import', null);

    // data:import — import file trigger (no crash)
    await expectCommandOk(page, 'import', null);

    // data:export — download trigger (no crash)
    await expectCommandOk(page, 'export', null);
  });

  test('sys:reload reloads the application', async ({ page }) => {
    await runCLI(page, 'reload');
    // After reload the CLI input must come back (fresh boot).
    await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
  });

  // ── Tab completion (onboarding UX) ──────────────────────────────
  test('Tab completes a command trigger into the input', async ({ page }) => {
    await openApp(page);
    const cmdInput = page.locator('#cmd-input');
    await cmdInput.fill('ta');
    await cmdInput.press('Tab');
    // Registry-first match for 'ta' is the task command → trigger + space.
    await expect(cmdInput).toHaveValue('task ');
  });

  test('Tab fills a highlighted suggestion (trigger only, no execution)', async ({ page }) => {
    await openApp(page);
    const cmdInput = page.locator('#cmd-input');
    await cmdInput.fill('pomo');
    // Arrow down highlights the first suggestion, Tab fills its trigger.
    await cmdInput.press('ArrowDown');
    await cmdInput.press('Tab');
    await expect(cmdInput).toHaveValue('pomo ');
    // No modal opened and no toast fired → nothing executed.
    await expect(page.locator('#notif-toast')).toHaveCount(0);
  });

  test('Tab never clobbers args already typed after the trigger', async ({ page }) => {
    await openApp(page);
    const cmdInput = page.locator('#cmd-input');
    await cmdInput.fill('task Buy groceries');
    await cmdInput.press('Tab');
    // The typed args must survive Tab (regression: it used to reset to `task `).
    await expect(cmdInput).toHaveValue('task Buy groceries');
  });

  // ── CLI polish (discoverability sprint) ─────────────────────────
  test('suggestion rows show the command arg hint', async ({ page }) => {
    await openApp(page);
    const cmdInput = page.locator('#cmd-input');
    await cmdInput.fill('note');
    // The `note` command hint is `[content]` and must render in the row.
    await expect(page.locator('#suggestions .cmd-args').first()).toBeVisible();
    await expect(page.locator('#suggestions .cmd-args').first()).toContainText('[content]');
  });

  test('suggestion dropdown shows the keyboard footer', async ({ page }) => {
    await openApp(page);
    const cmdInput = page.locator('#cmd-input');
    await cmdInput.fill('note');
    const footer = page.locator('#suggestions .suggestions-footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText('navigate');
    await expect(footer).toContainText('run');
    await expect(footer).toContainText('fill');
  });
});
