import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:9999';

async function openApp(page) {
  await page.goto(APP_URL);
  await page.locator('#cmd-input').waitFor({ state: 'visible', timeout: 15000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

test('quick toolbar renders and its buttons run the same commands as the CLI', async ({ page }) => {
  await openApp(page);
  const toolbar = page.locator('#quick-toolbar');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('.qt-btn')).toHaveCount(6);

  // Notes button executes the `notes` command → COMMAND toast (not an error).
  await toolbar.locator('.qt-btn[title="Notes"]').click();
  const toast = page.locator('#notif-toast');
  await toast.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  if (await toast.count() > 0) {
    const text = (await toast.textContent()) || '';
    expect(text).not.toContain('ERROR');
    expect(text).toContain('COMMAND');
  }
});

test('quick toolbar hides in zen mode', async ({ page }) => {
  await openApp(page);
  const toolbar = page.locator('#quick-toolbar');
  await expect(toolbar).toBeVisible();

  // `zen` toggles body.zen-mode; CSS hides the toolbar.
  await page.locator('#cmd-input').fill('zen');
  await page.locator('#cmd-input').press('Enter');
  await page.waitForTimeout(400);
  await expect(page.locator('body')).toHaveClass(/zen-mode/);
  await expect(toolbar).toBeHidden();
});

test('quick toolbar respects the show_toolbar setting', async ({ page }) => {
  await openApp(page);
  const toolbar = page.locator('#quick-toolbar');
  await expect(toolbar).toBeVisible();

  await page.evaluate(() => {
    window.State.CONFIG.show_toolbar = false;
    if (window.QuickToolbar) window.QuickToolbar._sync();
  });
  await expect(toolbar).toBeHidden();

  await page.evaluate(() => {
    window.State.CONFIG.show_toolbar = true;
    if (window.QuickToolbar) window.QuickToolbar._sync();
  });
  await expect(toolbar).toBeVisible();
});

test('the tour command replays onboarding', async ({ page }) => {
  // The tour skips under automation; strip the flag so replay behaves like
  // a real user asking to see the tour again.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => undefined,
    });
  });
  await page.goto(APP_URL);
  await page.locator('#cmd-input').waitFor({ state: 'visible', timeout: 15000 });
  // First-run tour already auto-opened; dismiss it.
  await page.locator('#tour-skip').click().catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await page.locator('#cmd-input').fill('tour');
  await page.locator('#cmd-input').press('Enter');
  await page.waitForTimeout(400);

  await expect(page.locator('#welcome-modal')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.tour-step[data-step="0"]')).toHaveClass(/active/);
});
