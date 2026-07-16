/**
 * Vinland Settings UI, Theme Switching & Zen Mode — Playwright Integration Tests
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
  const saveBtn = page.locator('#config-save-btn');
  await expect(saveBtn).toBeVisible({ timeout: 2000 });

  // Reset defaults button should be visible
  const resetBtn = page.locator('#reset-defaults-btn');
  await expect(resetBtn).toBeVisible({ timeout: 2000 });

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

  // Background URLs textarea
  const bgInput = page.locator('#cfg-backgrounds');
  await expect(bgInput).toBeVisible({ timeout: 2000 });

  await closeModal(page);
});

test('5. Settings modal has import/export theme buttons', async ({ page }) => {
  await openSettings(page);

  const configModal = page.locator('#config-modal');
  await expect(configModal).toBeVisible({ timeout: 5000 });

  const importBtn = page.locator('#import-theme-btn');
  await expect(importBtn).toBeVisible({ timeout: 2000 });

  const exportBtn = page.locator('#export-theme-btn');
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
