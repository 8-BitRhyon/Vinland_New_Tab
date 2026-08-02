

import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:9999';

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => localStorage.removeItem('OPERATOR_CONFIG_V3'));
  await page.reload();
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    if (window.State && window.State.CONFIG) window.State.CONFIG.first_run = false;
  });
});

test('presets set full surface tokens and body class', async ({ page }) => {
  // Apply ocean-like tokens (default surface, no retroma).
  await page.evaluate(() => {
    const c = window.State.CONFIG || {};
    c.theme_color = '#00ffff';
    c.secondary_color = '#0077be';
    c.bg_color = '#000000';
    c.danger_color = '#ff0055';
    c.warning_color = '#ffb800';
    c.board_color = '#00d4ff';
    c.dim_color = '#555555';
    c.theme_preset = 'ocean';
    if (window.Config) window.Config.applyTheme();
  });
  await page.waitForTimeout(200);

  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim().toLowerCase()
  )).toBe('#000000');
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--main-color').trim().toLowerCase()
  )).toBe('#00ffff');
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--danger-color').trim().toLowerCase()
  )).toBe('#ff0055');
  expect(await page.evaluate(() =>
    document.body.classList.contains('theme-retroma')
  )).toBe(false);

  // Apply retroma tokens.
  await page.evaluate(() => {
    const c = window.State.CONFIG || {};
    c.theme_color = '#a54a3c';
    c.secondary_color = '#7c766e';
    c.bg_color = '#e6ddce';
    c.danger_color = '#c0392b';
    c.warning_color = '#e67e22';
    c.board_color = '#2980b9';
    c.dim_color = '#9e9589';
    c.theme_preset = 'retroma';
    c.graph_col_1 = '#a54a3c';
    c.graph_col_2 = '#7c766e';
    c.graph_col_3 = '#c0392b';
    c.graph_col_4 = '#e67e22';
    c.graph_col_5 = '#433e38';
    if (window.Config) window.Config.applyTheme();
  });
  await page.waitForTimeout(200);

  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim().toLowerCase()
  )).toBe('#e6ddce');
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--main-color').trim().toLowerCase()
  )).toBe('#a54a3c');
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--danger-color').trim().toLowerCase()
  )).toBe('#c0392b');
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--board-color').trim().toLowerCase()
  )).toBe('#2980b9');
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--dim-color').trim().toLowerCase()
  )).toBe('#9e9589');
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--graph-col-1').trim().toLowerCase()
  )).toBe('#a54a3c');
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--warning-color').trim().toLowerCase()
  )).toBe('#e67e22');
  expect(await page.evaluate(() =>
    document.body.classList.contains('theme-retroma')
  )).toBe(true);

  // Switch back - body class removed, tokens reset.
  await page.evaluate(() => {
    const c = window.State.CONFIG || {};
    c.theme_color = '#00ffff';
    c.secondary_color = '#0077be';
    c.bg_color = '#000000';
    c.theme_preset = 'ocean';
    if (window.Config) window.Config.applyTheme();
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() =>
    document.body.classList.contains('theme-retroma')
  )).toBe(false);
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim().toLowerCase()
  )).toBe('#000000');
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--main-color').trim().toLowerCase()
  )).toBe('#00ffff');
});
