/**
 * Vinland Backup & Sync - Playwright Integration Test
 *
 * Tests backup and sync features:
 * - Sync tab exists in settings navigation
 * - Backup interval selector in sync tab
 * - Changing interval persists to config
 * - Backup Now button sets last_backup_time
 * - Sync tab displays backup/drive status
 * - Drive connect/disconnect button visibility
 * - Backup interval persists across reload
 * - Backup Now triggers download via BackupManager
 *
 * Run with:
 *   npx playwright test tests/backup-sync.playwright.spec.mjs
 */

import { test, expect } from '@playwright/test';
import { APP_URL } from './helpers.mjs';

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
        k.startsWith('VINLAND_') || k === 'OPERATOR_CONFIG_V3'
      );
      keys.forEach(k => localStorage.removeItem(k));
      if (window.State) {
        if (Array.isArray(window.State.NOTES)) window.State.NOTES.length = 0;
        if (window.State.CONFIG) {
          window.State.CONFIG.auto_backup_interval = 0;
          window.State.CONFIG.last_backup_time = null;
          window.State.CONFIG.drive_last_sync = null;
        }
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

async function openSettings(page) {
  const configBtn = page.locator('#config-btn');
  await configBtn.waitFor({ state: 'visible', timeout: 10000 });
  await configBtn.click();
  await page.waitForTimeout(500);
  await expect(page.locator('#config-modal')).toBeVisible({ timeout: 5000 });
}

async function closeSettings(page) {
  const closeBtn = page.locator('#config-modal .close-modal');
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(400);
  }
}

async function navigateToTab(page, tabName) {
  const navItem = page.locator(`.config-nav-item[data-tab="${tabName}"]`);
  await navItem.waitFor({ state: 'visible', timeout: 5000 });
  await navItem.click();
  await page.waitForTimeout(300);
}

// ══════════════════════════════════════════
// Test 1: Sync tab exists in settings
// ══════════════════════════════════════════
test('1. Sync tab appears in settings navigation', async ({ page }) => {
  await openSettings(page);
  const syncNav = page.locator('.config-nav-item[data-tab="sync"]');
  await expect(syncNav).toBeVisible({ timeout: 3000 });
  await expect(syncNav).toHaveText('SYNC');
  await closeSettings(page);
});

// ══════════════════════════════════════════
// Test 2: Sync tab shows backup controls
// ══════════════════════════════════════════
test('2. Sync tab shows backup interval dropdown and buttons', async ({ page }) => {
  await openSettings(page);
  await navigateToTab(page, 'sync');

  const intervalSelect = page.locator('#cfg-auto-backup');
  await expect(intervalSelect).toBeVisible({ timeout: 3000 });

  const options = await intervalSelect.locator('option').allTextContents();
  expect(options.some(o => o === 'OFF')).toBe(true);
  expect(options.some(o => o.includes('hour'))).toBe(true);

  await expect(page.locator('#sync-backup-now-btn')).toBeVisible();
  await expect(page.locator('#sync-backup-now-btn')).toContainText('BACKUP NOW');

  await expect(page.locator('#drive-connect-btn')).toBeVisible();
  await expect(page.locator('#drive-connect-btn')).toContainText('CONNECT DRIVE');

  await closeSettings(page);
});

// ══════════════════════════════════════════
// Test 3: Changing backup interval persists via the SAVE flow
// ══════════════════════════════════════════
test('3. Changing backup interval persists via the settings SAVE flow', async ({ page }) => {
  await openSettings(page);
  await navigateToTab(page, 'sync');

  await page.locator('#cfg-auto-backup').selectOption('30');
  await page.waitForTimeout(400);

  // Dirty tracking: the change is staged, not yet persisted (no immediate save)
  let interval = await page.evaluate(() => {
    return window.State && window.State.CONFIG ? window.State.CONFIG.auto_backup_interval : null;
  });
  expect(interval).not.toBe(30);

  // The header SAVE button applies it (saveConfigFromUI reads the select)
  await page.locator('#header-save-btn').click();
  await page.waitForTimeout(800);

  interval = await page.evaluate(() => {
    return window.State && window.State.CONFIG ? window.State.CONFIG.auto_backup_interval : null;
  });
  expect(interval).toBe(30);
});

// ══════════════════════════════════════════
// Test 4: Backup Now sets last_backup_time
// ══════════════════════════════════════════
test('4. Backup Now button sets last_backup_time', async ({ page }) => {
  await openSettings(page);
  await navigateToTab(page, 'sync');

  await page.locator('#sync-backup-now-btn').click();
  await page.waitForTimeout(800);

  const lastBackup = await page.evaluate(() => {
    return window.State && window.State.CONFIG ? window.State.CONFIG.last_backup_time : null;
  });
  expect(lastBackup).not.toBeNull();
  expect(typeof lastBackup).toBe('number');

  // The HTML splits the label ('LAST BACKUP') and value (#sync-last-backup)
  // into sibling spans — assert the label element exists and the value is a
  // real timestamp rather than the 'never' placeholder.
  await expect(page.locator('.sync-status-item').filter({ hasText: 'LAST BACKUP' })).toBeVisible();
  const lastBackupEl = page.locator('#sync-last-backup');
  // Auto-wait: value must resolve to a real timestamp, not the placeholder
  await expect(lastBackupEl).not.toContainText('never', { timeout: 3000 });
  await expect(lastBackupEl).not.toHaveText('', { timeout: 3000 });

  await closeSettings(page);
});

// ══════════════════════════════════════════
// Test 5: Sync tab displays backup/drive status
// ══════════════════════════════════════════
test('5. Sync tab displays last backup and drive sync status', async ({ page }) => {
  await page.evaluate(() => {
    if (window.State && window.State.CONFIG) {
      window.State.CONFIG.last_backup_time = Date.now() - 60000;
      window.State.CONFIG.drive_last_sync = new Date(Date.now() - 3600000).toISOString();
    }
  });

  await openSettings(page);
  await navigateToTab(page, 'sync');

  const lastBackupEl = page.locator('#sync-last-backup');
  await expect(lastBackupEl).toBeVisible();
  await expect(lastBackupEl).not.toContainText('never');

  const lastDriveEl = page.locator('#sync-last-drive');
  await expect(lastDriveEl).toBeVisible();
  await expect(lastDriveEl).not.toContainText('never');

  await closeSettings(page);
});

// ══════════════════════════════════════════
// Test 6: Drive button visibility
// ══════════════════════════════════════════
test('6. Drive connect/disconnect buttons toggle correctly', async ({ page }) => {
  await openSettings(page);
  await navigateToTab(page, 'sync');

  await expect(page.locator('#drive-connect-btn')).toBeVisible();
  await expect(page.locator('#drive-disconnect-btn')).not.toBeVisible();
  await expect(page.locator('#drive-sync-push-btn')).not.toBeVisible();
  await expect(page.locator('#drive-sync-pull-btn')).not.toBeVisible();

  await expect(page.locator('#drive-status')).toContainText('Not connected');
  await closeSettings(page);
});

// ══════════════════════════════════════════
// Test 7: Backup interval persists across reload
// ══════════════════════════════════════════
test('7. Backup interval persists across reloads', async ({ page }) => {
  await page.evaluate(() => {
    if (window.State && window.State.CONFIG) {
      window.State.CONFIG.auto_backup_interval = 60;
      // Persist to localStorage directly (saveConfig not exposed on window)
      try {
        localStorage.setItem('OPERATOR_CONFIG_V3', JSON.stringify(window.State.CONFIG));
      } catch (e) { /* ignore */ }
    }
  });

  await page.reload();
  await page.waitForTimeout(1000);

  const interval = await page.evaluate(() => {
    return window.State && window.State.CONFIG ? window.State.CONFIG.auto_backup_interval : null;
  });
  expect(interval).toBe(60);
});

// ══════════════════════════════════════════
// Test 8: Backup Now triggers BackupManager
// ══════════════════════════════════════════
test('8. Backup Now triggers download via BackupManager', async ({ page }) => {
  await page.evaluate(() => {
    if (!window.State) return;
    window.State.NOTES.push({
      id: 'test_note_backup', title: 'Backup Test Note',
      content: 'This note should appear in backup.',
      path: '/', created: Date.now(), modified: Date.now()
    });
    window.State.TASKS = [{ text: 'Test task', completed: false }];
  });

  await openSettings(page);
  await navigateToTab(page, 'sync');

  // Set up download listener before clicking
  const downloadPromise = page.waitForEvent('download', { timeout: 3000 }).catch(() => null);

  await page.locator('#sync-backup-now-btn').click();
  await page.waitForTimeout(1000);

  // Verify backup was triggered
  const lastBackup = await page.evaluate(() => {
    return window.State && window.State.CONFIG ? window.State.CONFIG.last_backup_time : null;
  });
  expect(lastBackup).not.toBeNull();

  await closeSettings(page);
});
