import { test, expect } from '@playwright/test';

const APP = 'http://127.0.0.1:9999';

async function gotoApp(page) {
  await page.goto(APP);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
}

async function runCLI(page, command) {
  const cmdInput = page.locator('#cmd-input');
  await cmdInput.waitFor({ state: 'visible', timeout: 15000 });
  await cmdInput.fill(command);
  await cmdInput.press('Enter');
  await page.waitForTimeout(500);
}

// Issue: the main-page notes panel had rounded corners (8px) while other
// panels (dock, modals) are sharp-edged.
test('notes panel edges are sharp (border-radius 0)', async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() =>
    getComputedStyle(document.getElementById('notes-panel')).borderTopLeftRadius
  );
  expect(r).toBe('0px');
});

// Issue: the first-run CLI "Try: ..." hint should be X-dismissible and
// stay gone after a reload.
test('CLI command hint is X-dismissible and persists across reload', async ({ page }) => {
  await gotoApp(page);

  const hint = page.locator('#command-hint');
  await expect(hint).toBeVisible({ timeout: 5000 });
  const x = page.locator('#command-hint-dismiss');
  await expect(x).toBeVisible();

  await x.click();

  await expect(hint).toBeHidden();
  const flag = await page.evaluate(() => localStorage.getItem('VINLAND_CLI_HINTS_DISMISSED'));
  expect(flag).toBe('1');

  await page.reload();
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#command-hint')).toBeHidden();
});

// Issue: the CLI hints should auto-hide after the user runs their first command.
test('CLI hints auto-hide after first command', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('#command-hint')).toBeVisible({ timeout: 5000 });

  await page.locator('#cmd-input').fill('help');
  await page.locator('#cmd-input').press('Enter');
  await page.waitForTimeout(500);

  await expect(page.locator('#command-hint')).toBeHidden();
  const flag = await page.evaluate(() => localStorage.getItem('VINLAND_CLI_HINTS_DISMISSED'));
  expect(flag).toBe('1');
});

// Issue: applying the retroma (paper) theme tinted settings input boxes
// with its skin/paper surface color. Inputs must stay dark terminals.
test('retroma theme does not tint settings input boxes', async ({ page }) => {
  await gotoApp(page);

  // retroma paper surface is #e6ddce (230,221,206).
  await page.evaluate(() => { if (window.SettingsUI) window.SettingsUI.toggleConfig(); });
  await page.waitForTimeout(400);
  await runCLI(page, 'theme retroma');
  await page.waitForTimeout(400);

  const result = await page.evaluate(() => {
    const input = document.querySelector('.config-input');
    const body = document.body;
    return {
      inputBg: getComputedStyle(input).backgroundColor,
      bodyBg: getComputedStyle(body).backgroundColor,
    };
  });

  // Body keeps the paper surface (theme intent preserved).
  expect(result.bodyBg).toBe('rgb(230, 221, 206)');
  // Inputs must NOT be the paper/skin color.
  expect(result.inputBg).not.toBe('rgb(230, 221, 206)');
  // Inputs stay dark terminal surfaces.
  expect(result.inputBg).toBe('rgb(21, 18, 14)');
});
