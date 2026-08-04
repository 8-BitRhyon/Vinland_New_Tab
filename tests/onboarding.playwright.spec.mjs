import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:9999';

// The tour is skipped under automation (navigator.webdriver) to keep other
// specs deterministic. These tests deliberately strip the flag so the tour
// runs like it would for a real first-time user.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => undefined,
    });
  });
});

// ──────────────────────────────────────────
// First-run onboarding: guided tour + sample content seed
// ──────────────────────────────────────────

test('first run opens the guided tour and seeds a welcome note + board', async ({ page }) => {
  await page.goto(APP_URL);

  // The welcome modal hosts the tour on first run.
  await expect(page.locator('#welcome-modal')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.tour-step[data-step="0"]')).toHaveClass(/active/);

  // Sample content was seeded (still flagged first_run until dismissed).
  const seeded = await page.evaluate(() => ({
    note: (window.State.NOTES || []).some((n) => n.title === 'Welcome to Vinland'),
    board: (window.State.BOARDS || []).some((b) => b.title === 'Welcome Board'),
    firstRun: window.State.CONFIG.first_run,
  }));
  expect(seeded.note).toBe(true);
  expect(seeded.board).toBe(true);
  expect(seeded.firstRun).toBe(true);
});

test('the tour runs a real command and dismisses permanently', async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#welcome-modal')).toBeVisible({ timeout: 15000 });

  // START TOUR → the typing demo step
  await page.locator('#tour-start').click();
  await expect(page.locator('.tour-step[data-step="1"]')).toHaveClass(/active/);

  // RUN IT executes the demo task command and advances to success.
  await page.locator('#tour-run').click();
  await expect(page.locator('.tour-step[data-step="2"]')).toHaveClass(/active/);

  // A task was actually created by the demo command.
  const tasks = await page.evaluate(() => window.State.TASKS || []);
  expect(tasks.some((t) => (t.text || '').includes('Buy groceries'))).toBe(true);

  // Walk the remaining steps and finish.
  await page.locator('#tour-next').click();
  await expect(page.locator('.tour-step[data-step="3"]')).toHaveClass(/active/);
  await page.locator('#tour-finish').click();

  await expect(page.locator('#welcome-modal')).not.toBeVisible();
  const after = await page.evaluate(() => ({
    firstRun: window.State.CONFIG.first_run,
  }));
  expect(after.firstRun).toBe(false);
});

test('SKIP also ends first-run permanently', async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#welcome-modal')).toBeVisible({ timeout: 15000 });

  await page.locator('#tour-skip').click();
  await expect(page.locator('#welcome-modal')).not.toBeVisible();

  const firstRun = await page.evaluate(() => window.State.CONFIG.first_run);
  expect(firstRun).toBe(false);
});
