

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


async function startPomodoro(page, duration = '30s') {
  await page.evaluate((d) => {
    if (window.Pomodoro) window.Pomodoro.start(d);
  }, duration);
  await page.waitForTimeout(600);
}

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  // Clear persistent state and ensure clean pomodoro state
  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX' ||
      k.startsWith('OPERATOR_BOARDS_')
    );
    keys.forEach(k => localStorage.removeItem(k));
    if (window.State) {
      if (Array.isArray(window.State.NOTES)) window.State.NOTES.length = 0;
      if (Array.isArray(window.State.BOARDS)) window.State.BOARDS.length = 0;
    }
    // Stop any running pomodoro
    if (window.Pomodoro) window.Pomodoro.stop();
  });

  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// POMODORO TESTS
// ══════════════════════════════════════════

test('1. Start pomodoro via CLI command', async ({ page }) => {
  await runCLI(page, 'pomo 30s');

  // The pomodoro container should become visible
  const container = page.locator('#pomodoro-container');
  await expect(container).toBeVisible({ timeout: 3000 });

  // The time display should show the remaining time
  const timeDisplay = page.locator('#pomodoro-time');
  await expect(timeDisplay).toBeVisible({ timeout: 2000 });

  // Should show ~30 seconds (auto-wait; could be 00:30 or 00:29 depending on timing)
  await expect(timeDisplay).toHaveText(/^00:[23]\d$/, { timeout: 3000 });

  // Pause button should say PAUSE
  const pauseBtn = page.locator('#pomodoro-pause');
  await expect(pauseBtn).toBeVisible({ timeout: 2000 });
  await expect(pauseBtn).toHaveText('PAUSE');

  // Stop button should be visible
  const stopBtn = page.locator('#pomodoro-stop');
  await expect(stopBtn).toBeVisible({ timeout: 2000 });
  await expect(stopBtn).toHaveText('STOP');
});

test('2. Start pomodoro with custom time via evaluate', async ({ page }) => {
  await startPomodoro(page, '1m');

  const container = page.locator('#pomodoro-container');
  await expect(container).toBeVisible({ timeout: 3000 });

  const timeDisplay = page.locator('#pomodoro-time');
  await expect(timeDisplay).toBeVisible({ timeout: 2000 });

  // Should show ~1 minute (auto-wait with tick tolerance)
  await expect(timeDisplay).toHaveText(/^(00:5[89]|01:00)$/, { timeout: 3000 });
});

test('3. Pause a running pomodoro', async ({ page }) => {
  await startPomodoro(page, '30s');

  const container = page.locator('#pomodoro-container');
  await expect(container).toBeVisible({ timeout: 3000 });

  // Click pause
  const pauseBtn = page.locator('#pomodoro-pause');
  await pauseBtn.click();
  await page.waitForTimeout(400);

  // Button text should now say RESUME
  await expect(pauseBtn).toHaveText('RESUME');

  // Container should still be visible (timer is paused, not stopped)
  await expect(container).toBeVisible();

  // The time display should still show time (not hidden)
  const timeDisplay = page.locator('#pomodoro-time');
  await expect(timeDisplay).toBeVisible();
});

test('4. Resume a paused pomodoro', async ({ page }) => {
  await startPomodoro(page, '30s');

  // Pause first
  await page.locator('#pomodoro-pause').click();
  await page.waitForTimeout(400);

  // Now resume
  await page.locator('#pomodoro-pause').click();
  await page.waitForTimeout(400);

  // Button text should say PAUSE again
  await expect(page.locator('#pomodoro-pause')).toHaveText('PAUSE');

  // Container should still be visible
  await expect(page.locator('#pomodoro-container')).toBeVisible();
});

test('5. Stop a running pomodoro', async ({ page }) => {
  await startPomodoro(page, '30s');

  await expect(page.locator('#pomodoro-container')).toBeVisible({ timeout: 3000 });

  // Click stop
  await page.locator('#pomodoro-stop').click();
  await page.waitForTimeout(400);

  // Container should disappear
  await expect(page.locator('#pomodoro-container')).not.toBeVisible({ timeout: 2000 });

  // Timer state should be inactive
  const isActive = await page.evaluate(() => {
    return window.Pomodoro ? window.Pomodoro.state.active : null;
  });
  expect(isActive).toBe(false);
});

test('6. Timer display updates as time passes', async ({ page }) => {
  await startPomodoro(page, '30s');

  await expect(page.locator('#pomodoro-container')).toBeVisible({ timeout: 3000 });

  // Capture the initial display, then auto-wait for it to advance
  const timeDisplay = page.locator('#pomodoro-time');
  const initialText = (await timeDisplay.textContent()) || '';

  // Auto-wait: the timer display must tick past its initial value
  // (|| '' guards against a transient null read passing the poll prematurely)
  await expect.poll(async () => ((await timeDisplay.textContent()) || ''), { timeout: 5000 })
    .not.toBe(initialText);

  // Container should still be visible (timer hasn't expired yet)
  await expect(page.locator('#pomodoro-container')).toBeVisible();

  // Display should match a 30s timer still in the 10-29s window
  await expect(timeDisplay).toHaveText(/^00:[12]\d$/, { timeout: 2000 });
});

test('7. Start, stop, then start again with different duration', async ({ page }) => {
  // First: start 30s
  await startPomodoro(page, '30s');
  await expect(page.locator('#pomodoro-container')).toBeVisible({ timeout: 3000 });

  // Stop
  await page.locator('#pomodoro-stop').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#pomodoro-container')).not.toBeVisible({ timeout: 2000 });

  // Start again with 1m
  await startPomodoro(page, '1m');
  await expect(page.locator('#pomodoro-container')).toBeVisible({ timeout: 3000 });

  // Should show ~1 minute (fresh timer) — auto-wait with tick tolerance
  await expect(page.locator('#pomodoro-time')).toHaveText(/^(00:5[89]|01:00)$/, { timeout: 3000 });

  // Clean up
  await page.locator('#pomodoro-stop').click();
});

test('8. Starting pomodoro while one is already running resets it', async ({ page }) => {
  // Start 30s timer
  await startPomodoro(page, '30s');
  await expect(page.locator('#pomodoro-container')).toBeVisible({ timeout: 3000 });

  // Wait 2 seconds, then start a new 1m timer (should reset)
  await page.waitForTimeout(2000);

  // Start a different duration - this should reset the timer
  await startPomodoro(page, '1m');

  // Should now show 1 minute, not the remaining ~28s — auto-wait with tolerance
  await expect(page.locator('#pomodoro-time')).toHaveText(/^(00:5[89]|01:00)$/, { timeout: 3000 });

  // Clean up
  await page.locator('#pomodoro-stop').click();
});

test('9. Pomodoro completion shows HUD and completion modal', async ({ page }) => {
  // Start a very short 1-second timer
  await startPomodoro(page, '1s');

  await expect(page.locator('#pomodoro-container')).toBeVisible({ timeout: 3000 });

  // Wait for timer to expire (1s + generous buffer)
  await page.waitForTimeout(3000);

  // The pomodoro container should be hidden (timer stopped)
  await expect(page.locator('#pomodoro-container')).not.toBeVisible({ timeout: 5000 });

  // The completion HUD should be visible
  const pomoHud = page.locator('#pomo-hud');
  await expect(pomoHud).toHaveClass(/active/);

  // The completion modal should be open
  const completeModal = page.locator('#pomodoro-complete-modal');
  await expect(completeModal).toBeVisible({ timeout: 5000 });

  // The modal should have completion stats
  await expect(page.locator('#pomo-complete-duration')).toBeVisible({ timeout: 2000 });
  await expect(page.locator('#pomo-complete-time')).toBeVisible({ timeout: 2000 });

  // The dismiss button should be visible
  const dismissBtn = page.locator('#pomo-dismiss-btn');
  await expect(dismissBtn).toBeVisible({ timeout: 2000 });
  await expect(dismissBtn).toHaveText('ACKNOWLEDGE');
});

test('10. Dismiss completion modal and verify state resets', async ({ page }) => {
  // Start and complete a very short timer
  await startPomodoro(page, '1s');

  // Wait for completion
  await page.waitForTimeout(3000);

  // Verify modal appeared
  const completeModal = page.locator('#pomodoro-complete-modal');
  await expect(completeModal).toBeVisible({ timeout: 5000 });

  // Click acknowledge/dismiss
  await page.locator('#pomo-dismiss-btn').click();
  await page.waitForTimeout(400);

  // Modal should close
  await expect(completeModal).not.toBeVisible({ timeout: 3000 });

  // Timer state should be inactive
  const isActive = await page.evaluate(() => {
    return window.Pomodoro ? window.Pomodoro.state.active : null;
  });
  expect(isActive).toBe(false);
});
