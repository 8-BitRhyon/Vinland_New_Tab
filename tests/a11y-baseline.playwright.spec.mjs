

import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:9999';

function scanStylesheets(page, predicate) {
  return page.evaluate((fnSrc) => {
    const predicate = eval('(' + fnSrc + ')');
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; } // cross-origin
      if (!rules) continue;
      for (const rule of rules) {
        if (predicate(rule)) return true;
      }
    }
    return false;
  }, predicate.toString());
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    if (window.State && window.State.CONFIG) window.State.CONFIG.first_run = false;
  });
  await page.waitForTimeout(200);
});

test('global :focus-visible ring rule is present', async ({ page }) => {
  const found = await scanStylesheets(page, (rule) =>
    rule.selectorText && rule.selectorText.includes('focus-visible')
  );
  expect(found).toBe(true);
});

test('prefers-reduced-motion reset exists and collapses animation', async ({ page }) => {
  const mediaFound = await scanStylesheets(page, (rule) =>
    (rule.media && rule.media.mediaText.includes('prefers-reduced-motion')) ||
    (rule.conditionText && rule.conditionText.includes('prefers-reduced-motion'))
  );
  expect(mediaFound).toBe(true);

  // Behavioral: with reduced motion emulated, a fresh animated element's
  // computed animation-duration collapses to the reset value.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dur = await page.evaluate(() => {
    const el = document.createElement('div');
    el.style.animation = '1s linear 0s';
    document.body.appendChild(el);
    const d = getComputedStyle(el).animationDuration;
    el.remove();
    return d;
  });
  // Browsers normalize 0.001ms -> 1e-06s; either proves the reset applies.
  expect(dur === '0.001ms' || dur === '1e-06s').toBe(true);
  await page.emulateMedia({ reducedMotion: null });
});

test('icon-only buttons are labeled', async ({ page }) => {
  const labels = await page.evaluate(() => ({
    dock: document.getElementById('add-dock-btn')?.getAttribute('aria-label'),
    cmd: document.getElementById('add-cmd-btn')?.getAttribute('aria-label'),
    kanbanClose: document.getElementById('kanban-modal-close-btn')?.getAttribute('aria-label'),
  }));
  expect(labels.dock).toBeTruthy();
  expect(labels.cmd).toBeTruthy();
  expect(labels.kanbanClose).toBeTruthy();
});

test('modal gets dialog semantics, traps Tab, and restores focus on close', async ({ page }) => {
  await page.evaluate(() => window.ModalManager.open('config-modal'));
  await page.waitForTimeout(200);

  const opened = await page.evaluate(() => {
    const m = document.getElementById('config-modal');
    return {
      role: m.getAttribute('role'),
      ariaModal: m.getAttribute('aria-modal'),
      focusInside: m.contains(document.activeElement),
    };
  });
  expect(opened.role).toBe('dialog');
  expect(opened.ariaModal).toBe('true');
  expect(opened.focusInside).toBe(true);

  // Tab stays inside the dialog (focus trap).
  await page.keyboard.press('Tab');
  await page.waitForTimeout(50);
  const stillInside = await page.evaluate(() =>
    document.getElementById('config-modal').contains(document.activeElement)
  );
  expect(stillInside).toBe(true);

  // Escape closes and returns focus outside the dialog.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const closed = await page.evaluate(() => {
    const m = document.getElementById('config-modal');
    return {
      open: m.classList.contains('active'),
      focusInside: m.contains(document.activeElement),
    };
  });
  expect(closed.open).toBe(false);
  expect(closed.focusInside).toBe(false);
});

test('toasts are announced via aria-live', async ({ page }) => {
  await page.evaluate(() => window.showNotification('audit toast'));
  await page.waitForTimeout(50);
  const live = await page.evaluate(() => {
    const t = document.getElementById('notif-toast');
    return t ? t.getAttribute('aria-live') : null;
  });
  expect(live).toBe('polite');
});
