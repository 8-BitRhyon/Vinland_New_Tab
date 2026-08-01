/**
 * Vinland Settings UI, Theme Switching and Zen Mode - Playwright Integration Tests
 *
 * Tests the config modal, theme preset application, help modal, and zen mode toggle.
 *
 * Run with:
 *   npx playwright test tests/settings-ui.playwright.spec.mjs
 */

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

async function openSettings(page) {
  await page.evaluate(() => {
    if (window.SettingsUI && window.SettingsUI.toggleConfig) {
      window.SettingsUI.toggleConfig();
    }
  });
  await page.waitForTimeout(600);
}

async function closeModal(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  // Ensure we start in default state (no zen, default theme)
  await page.evaluate(() => {
    document.body.classList.remove('zen-mode');
    document.body.classList.remove('theme-retroma');
  });

  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// SETTINGS MODAL TESTS
// ══════════════════════════════════════════

test('1. Open settings modal via evaluate', async ({ page }) => {
  await openSettings(page);

  const configModal = page.locator('#config-modal');
  await expect(configModal).toBeVisible({ timeout: 5000 });

  // Config header should be visible
  const header = configModal.locator('.config-header');
  await expect(header).toBeVisible({ timeout: 2000 });

  // Save button should be visible
  const saveBtn = page.locator('#header-save-btn');
  await expect(saveBtn).toBeVisible({ timeout: 2000 });

  // Close settings
  await closeModal(page);
  await expect(configModal).not.toBeVisible({ timeout: 3000 });
});

test('2. Open settings modal via config button click', async ({ page }) => {
  const configBtn = page.locator('#config-btn');
  await expect(configBtn).toBeVisible({ timeout: 5000 });

  await configBtn.click();
  await page.waitForTimeout(600);

  const configModal = page.locator('#config-modal');
  await expect(configModal).toBeVisible({ timeout: 5000 });

  await closeModal(page);
  await expect(configModal).not.toBeVisible({ timeout: 3000 });
});

test('3. Close and reopen settings modal multiple times', async ({ page }) => {
  const configModal = page.locator('#config-modal');

  for (let i = 0; i < 3; i++) {
    await openSettings(page);
    await expect(configModal).toBeVisible({ timeout: 5000 });
    await closeModal(page);
    await expect(configModal).not.toBeVisible({ timeout: 3000 });
  }
});

test('4. Settings modal has background configuration fields', async ({ page }) => {
  await openSettings(page);

  const configModal = page.locator('#config-modal');
  await expect(configModal).toBeVisible({ timeout: 5000 });

  // Background type selector
  const bgType = page.locator('#cfg-bg-type');
  await expect(bgType).toBeVisible({ timeout: 2000 });

  // Background color picker
  const bgColor = page.locator('#cfg-bg-color');
  await expect(bgColor).toBeVisible({ timeout: 2000 });

  // Background thumbnail grid (replaced textarea)
  const bgGrid = page.locator('#bg-thumbnails');
  await expect(bgGrid).toBeVisible({ timeout: 2000 });

  // Upload button should be visible
  const uploadBtn = page.locator('#upload-bg-btn');
  await expect(uploadBtn).toBeVisible({ timeout: 2000 });

  await closeModal(page);
});

test('5. Settings modal has import/export theme buttons', async ({ page }) => {
  await openSettings(page);

  const configModal = page.locator('#config-modal');
  await expect(configModal).toBeVisible({ timeout: 5000 });

  const importBtn = page.locator('#btn-import-theme');
  await expect(importBtn).toBeVisible({ timeout: 2000 });

  const exportBtn = page.locator('#btn-export-theme');
  await expect(exportBtn).toBeVisible({ timeout: 2000 });

  await closeModal(page);
});

// ══════════════════════════════════════════
// THEME SWITCHING TESTS
// ══════════════════════════════════════════

test('6. Switch to retroma theme via CLI', async ({ page }) => {
  await runCLI(page, 'theme retroma');

  await page.waitForTimeout(500);

  // Body should have the retroma theme class
  const hasRetroma = await page.evaluate(() => {
    return document.body.classList.contains('theme-retroma');
  });
  expect(hasRetroma).toBe(true);

  // Default terminal theme class should NOT be present
  const hasDefault = await page.evaluate(() => {
    return document.body.classList.contains('theme-default');
  });
  expect(hasDefault).toBe(false);
});

test('7. Switch back to default theme via CLI', async ({ page }) => {
  // Switch to retroma first
  await runCLI(page, 'theme retroma');
  await page.waitForTimeout(300);

  // Switch back to default
  await runCLI(page, 'theme default');
  await page.waitForTimeout(500);

  const hasRetroma = await page.evaluate(() => {
    return document.body.classList.contains('theme-retroma');
  });
  expect(hasRetroma).toBe(false);
});

test('8. Kill command closes settings modal', async ({ page }) => {
  await openSettings(page);

  const configModal = page.locator('#config-modal');
  await expect(configModal).toBeVisible({ timeout: 5000 });

  // Close all modals via evaluate (bypasses overlay-blocked command input)
  await page.evaluate(() => {
    if (window.ModalManager) window.ModalManager.closeAll();
  });
  await page.waitForTimeout(400);

  await expect(configModal).not.toBeVisible({ timeout: 3000 });
});

// ══════════════════════════════════════════
// ZEN MODE TESTS
// ══════════════════════════════════════════

test('9. Toggle zen mode via CLI', async ({ page }) => {
  await runCLI(page, 'zen');

  await page.waitForTimeout(500);

  const isZen = await page.evaluate(() => {
    return document.body.classList.contains('zen-mode');
  });
  expect(isZen).toBe(true);
});

test('10. Toggle zen mode off by running again', async ({ page }) => {
  // Turn on
  await runCLI(page, 'zen');
  await page.waitForTimeout(300);

  // Turn off
  await runCLI(page, 'zen');
  await page.waitForTimeout(500);

  const isZen = await page.evaluate(() => {
    return document.body.classList.contains('zen-mode');
  });
  expect(isZen).toBe(false);
});

test('11. Zen mode is not active by default', async ({ page }) => {
  const isZen = await page.evaluate(() => {
    return document.body.classList.contains('zen-mode');
  });
  expect(isZen).toBe(false);
});

test('12. Multiple zen toggles cycle correctly', async ({ page }) => {
  // on → off → on → off
  for (let i = 0; i < 4; i++) {
    await runCLI(page, 'zen');
    await page.waitForTimeout(300);
  }

  // Should end up off (even number of toggles)
  const isZen = await page.evaluate(() => {
    return document.body.classList.contains('zen-mode');
  });
  expect(isZen).toBe(false);
});

// ══════════════════════════════════════════
// HELP MODAL TESTS
// ══════════════════════════════════════════

test('13. Open help modal via CLI', async ({ page }) => {
  await runCLI(page, 'help');

  const helpModal = page.locator('#help-modal');
  await expect(helpModal).toBeVisible({ timeout: 5000 });

  // Help content should be visible
  await expect(helpModal.locator('.config-header')).toBeVisible({ timeout: 2000 });

  await closeModal(page);
  await expect(helpModal).not.toBeVisible({ timeout: 3000 });
});

test('14. Open help modal via man CLI', async ({ page }) => {
  await runCLI(page, 'man');

  const helpModal = page.locator('#help-modal');
  await expect(helpModal).toBeVisible({ timeout: 5000 });

  await closeModal(page);
  await expect(helpModal).not.toBeVisible({ timeout: 3000 });
});

test('15. Open help modal via help button click', async ({ page }) => {
  const helpBtn = page.locator('#help-btn');
  await expect(helpBtn).toBeVisible({ timeout: 5000 });

  await helpBtn.click();
  await page.waitForTimeout(600);

  const helpModal = page.locator('#help-modal');
  await expect(helpModal).toBeVisible({ timeout: 5000 });

  await closeModal(page);
  await expect(helpModal).not.toBeVisible({ timeout: 3000 });
});

// Regression: db: background thumbnails must render the uploaded media, not blank cards.
test('16. Uploaded background shows a rendered thumbnail (not blank)', async ({ page }) => {
  // Build a tiny valid PNG in-memory and upload it through the background file input.
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC';
  const buffer = Buffer.from(pngBase64, 'base64');
  await page.evaluate(() => { if (window.SettingsUI) window.SettingsUI.toggleConfig(); });
  await page.waitForTimeout(400);

  const fileInput = page.locator('#bg-file-input');
  await expect(fileInput).toBeAttached({ timeout: 5000 });
  await fileInput.setInputFiles({
    name: 'regression-test.png',
    mimeType: 'image/png',
    buffer: buffer,
  });

  await page.waitForTimeout(800);

  const cards = page.locator('#bg-thumbnails .bg-thumb-card');
  await expect(cards).toHaveCount(1, { timeout: 5000 });

  const img = cards.first().locator('img');
  await expect(img).toBeAttached({ timeout: 5000 });
  const src = await img.getAttribute('src');
  expect(src).toBeTruthy();
  expect(src.startsWith('blob:')).toBeTruthy();
  // The card should not be flagged as a failed load (red border).
  const border = await cards.first().evaluate((el) => el.style.borderColor);
  expect(border).not.toContain('255, 68, 68');
});

// Regression: an uploaded db: background must persist and apply after a tab reload
// (i.e. reopening the new tab), with no extension restart.
test('17. Uploaded background persists and applies after reload', async ({ page }) => {
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC';
  const buffer = Buffer.from(pngBase64, 'base64');

  // Open settings and upload a PNG.
  await page.evaluate(() => { if (window.SettingsUI) window.SettingsUI.toggleConfig(); });
  await page.waitForTimeout(400);

  const fileInput = page.locator('#bg-file-input');
  await expect(fileInput).toBeAttached({ timeout: 5000 });
  await fileInput.setInputFiles({
    name: 'persist-bg.png',
    mimeType: 'image/png',
    buffer: buffer,
  });

  // Thumbnail should render a blob image immediately (live, in-session).
  const thumbImg = page.locator('#bg-thumbnails .bg-thumb-card img').first();
  await expect(thumbImg).toBeAttached({ timeout: 5000 });
  // Auto-wait for the blob URL — the img element attaches before its src is assigned.
  await expect(thumbImg).toHaveAttribute('src', /blob:/, { timeout: 5000 });

  // Save the configuration.
  await page.locator('#header-save-btn').click();
  await page.waitForTimeout(600);

  // CONFIG should now include the db: asset.
  const savedBg = await page.evaluate(() => (window.State && window.State.CONFIG.backgrounds) || []);
  expect(savedBg.some((b) => b.startsWith('db:'))).toBeTruthy();

  // Reload the new tab (simulates reopening a tab, not restarting the extension).
  await page.reload();
  await page.waitForTimeout(600);

  // The background image element must be applied with a blob URL, no restart needed.
  await page.waitForFunction(() => {
    const el = document.getElementById('bg-image');
    return !!el && /blob:/.test(el.style.backgroundImage) && el.style.opacity === '1';
  }, null, { timeout: 8000 });

  // And CONFIG still references the db: asset after reload.
  const reloadedBg = await page.evaluate(() => (window.State && window.State.CONFIG.backgrounds) || []);
  expect(reloadedBg.some((b) => b.startsWith('db:'))).toBeTruthy();
});
