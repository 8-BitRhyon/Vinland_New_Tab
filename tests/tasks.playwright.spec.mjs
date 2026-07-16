/**
 * Vinland Tasks / Missions System — Playwright Integration Tests
 *
 * Tests the complete tasks workflow: add via CLI, priorities, categories,
 * completion toggle, progress bar, clear done, and empty state.
 *
 * Run with:
 *   npx playwright test tests/tasks.playwright.spec.mjs
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

async function addTaskViaState(page, text, options = {}) {
  await page.evaluate(
    ({ text, priority, category, time }) => {
      const task = {
        text: text,
        completed: false,
        time: time || '',
        priority: priority || 'normal',
        category: category || null,
      };
      if (window.State && Array.isArray(window.State.TASKS)) {
        window.State.TASKS.push(task);
        if (window.renderMissions) window.renderMissions();
        if (window.updateProgressBar) window.updateProgressBar();
      }
    },
    { text, priority: options.priority || 'normal', category: options.category || null, time: options.time || '' }
  );
  await page.waitForTimeout(300);
}

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  // Clear all persistent state
  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(
      (k) =>
        k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX' || k.startsWith('OPERATOR_BOARDS_')
    );
    keys.forEach((k) => localStorage.removeItem(k));
    if (window.State) {
      if (Array.isArray(window.State.NOTES)) window.State.NOTES.length = 0;
      if (Array.isArray(window.State.BOARDS)) window.State.BOARDS.length = 0;
      if (Array.isArray(window.State.TASKS)) window.State.TASKS.length = 0;
    }
    // Re-render to reflect cleared state
    if (window.renderMissions) window.renderMissions();
    if (window.updateProgressBar) window.updateProgressBar();
  });

  await page.waitForTimeout(300);
});

// ══════════════════════════════════════════
// TASKS / MISSIONS TESTS
// ══════════════════════════════════════════

test('1. Add a task via CLI command', async ({ page }) => {
  await runCLI(page, 'task Buy groceries');

  // The mission log panel should be active
  const missionLog = page.locator('#mission-log');
  await expect(missionLog).toBeVisible({ timeout: 3000 });

  // The task should appear in the mission list
  const missionList = page.locator('#mission-list');
  await expect(missionList).toBeVisible({ timeout: 2000 });

  // Should have exactly one mission item
  const items = page.locator('#mission-list .mission-item');
  await expect(items).toHaveCount(1);

  // The mission text should contain the task content
  const missionText = items.locator('.mission-text');
  await expect(missionText).toHaveText('Buy groceries');

  // A normal priority task gets | indicator
  const priorityIndicator = items.locator('.priority-indicator');
  await expect(priorityIndicator).toBeVisible();
  await expect(priorityIndicator).toHaveText('| ');
});

test('2. Add multiple tasks and verify count', async ({ page }) => {
  await runCLI(page, 'task First task');
  await runCLI(page, 'task Second task');
  await runCLI(page, 'task Third task');

  const items = page.locator('#mission-list .mission-item');
  await expect(items).toHaveCount(3);
});

test('3. Task with high priority (!!)', async ({ page }) => {
  await runCLI(page, 'task !! Urgent bug fix');

  const items = page.locator('#mission-list .mission-item');
  await expect(items).toHaveCount(1);

  // Should have high priority class
  await expect(items.first()).toHaveClass(/priority-high/);

  // Priority indicator should show !!
  const indicator = items.locator('.priority-indicator');
  await expect(indicator).toHaveText('!! ');

  // The text should not include the !! prefix
  const missionText = items.locator('.mission-text');
  await expect(missionText).toHaveText('Urgent bug fix');
});

test('4. Task with medium priority (!)', async ({ page }) => {
  await runCLI(page, 'task ! Meeting prep');

  const items = page.locator('#mission-list .mission-item');
  await expect(items).toHaveCount(1);

  await expect(items.first()).toHaveClass(/priority-medium/);

  const indicator = items.locator('.priority-indicator');
  await expect(indicator).toHaveText('! ');

  const missionText = items.locator('.mission-text');
  await expect(missionText).toHaveText('Meeting prep');
});

test('5. Task with low priority (~)', async ({ page }) => {
  await runCLI(page, 'task ~ Clean up notes');

  const items = page.locator('#mission-list .mission-item');
  await expect(items).toHaveCount(1);

  await expect(items.first()).toHaveClass(/priority-low/);

  const indicator = items.locator('.priority-indicator');
  await expect(indicator).toHaveText('~ ');

  const missionText = items.locator('.mission-text');
  await expect(missionText).toHaveText('Clean up notes');
});

test('6. Task with category @category', async ({ page }) => {
  await runCLI(page, 'task Review PR @work');

  const items = page.locator('#mission-list .mission-item');
  await expect(items).toHaveCount(1);

  // Should have category badge
  const badge = items.locator('.category-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('@work');

  // The text should not include the @category part
  const missionText = items.locator('.mission-text');
  await expect(missionText).toHaveText('Review PR');
});

test('7. Tasks are sorted by priority (high first)', async ({ page }) => {
  await addTaskViaState(page, 'Normal task', { priority: 'normal' });
  await addTaskViaState(page, 'Urgent task', { priority: 'high' });
  await addTaskViaState(page, 'Low pri task', { priority: 'low' });

  const items = page.locator('#mission-list .mission-item');
  await expect(items).toHaveCount(3);

  // High priority should come first
  const firstClass = await items.nth(0).getAttribute('class');
  expect(firstClass).toMatch(/priority-high/);

  // Normal next
  const secondClass = await items.nth(1).getAttribute('class');
  expect(secondClass).not.toMatch(/priority-/);

  // Low last
  const thirdClass = await items.nth(2).getAttribute('class');
  expect(thirdClass).toMatch(/priority-low/);
});

test('8. Toggle task completion by clicking checkbox', async ({ page }) => {
  await runCLI(page, 'task Complete me');

  const items = page.locator('#mission-list .mission-item');
  await expect(items).toHaveCount(1);

  // Item should not have completed class initially
  await expect(items.first()).not.toHaveClass(/completed/);

  // Click the checkbox to toggle completion
  const checkbox = items.locator('.task-checkbox');
  await checkbox.click();
  await page.waitForTimeout(400);

  // Item should now have completed class
  await expect(items.first()).toHaveClass(/completed/);

  // Click again to un-complete
  await checkbox.click();
  await page.waitForTimeout(400);

  // Item should no longer have completed class
  await expect(items.first()).not.toHaveClass(/completed/);
});

test('9. Clear completed tasks via CLI', async ({ page }) => {
  await runCLI(page, 'task Keep this');
  await runCLI(page, 'task Remove this');

  // Complete the second task
  const items = page.locator('#mission-list .mission-item');
  await expect(items).toHaveCount(2);

  await items.nth(1).locator('.task-checkbox').click();
  await page.waitForTimeout(400);

  // Run clear done
  await runCLI(page, 'clear done');

  // Only the uncompleted task should remain
  await expect(items).toHaveCount(1);
  const missionText = items.locator('.mission-text');
  await expect(missionText).toHaveText('Keep this');
});

test('10. Progress bar updates when tasks are completed', async ({ page }) => {
  await addTaskViaState(page, 'Task A', { priority: 'normal' });
  await addTaskViaState(page, 'Task B', { priority: 'normal' });
  await addTaskViaState(page, 'Task C', { priority: 'normal' });

  // Check progress text (0/3 = 0%)
  const progressText = page.locator('#progress-text');
  await expect(progressText).toBeVisible({ timeout: 2000 });
  await expect(progressText).toHaveText(/0\/3/);

  // Complete one task via State
  await page.evaluate(() => {
    if (window.State && window.State.TASKS && window.State.TASKS[0]) {
      window.State.TASKS[0].completed = true;
      if (window.renderMissions) window.renderMissions();
      if (window.updateProgressBar) window.updateProgressBar();
    }
  });
  await page.waitForTimeout(300);

  // Progress should show 1/3
  await expect(progressText).toHaveText(/1\/3/);

  // Complete all
  await page.evaluate(() => {
    if (window.State && window.State.TASKS) {
      window.State.TASKS.forEach((t) => (t.completed = true));
      if (window.renderMissions) window.renderMissions();
      if (window.updateProgressBar) window.updateProgressBar();
    }
  });
  await page.waitForTimeout(300);

  // Progress should show 3/3 (100%)
  await expect(progressText).toHaveText(/3\/3.*100%\)/);
});

test('11. Empty state shows when no tasks exist', async ({ page }) => {
  // After beforeEach clears state, the missions panel should show empty state
  const missionLog = page.locator('#mission-log');
  await expect(missionLog).toBeVisible({ timeout: 3000 });

  // Empty state hint should be visible
  const emptyState = page.locator('.empty-state-hint');
  await expect(emptyState).toBeVisible({ timeout: 2000 });

  // Should show the empty state title
  const emptyTitle = emptyState.locator('.empty-state-title');
  await expect(emptyTitle).toHaveText('NO ACTIVE MISSIONS');

  // Should show instructions
  const emptyBody = emptyState.locator('.empty-state-body');
  await expect(emptyBody).toBeVisible();
  await expect(emptyBody).toContainText('task');
});

test('12. Streak counter element exists', async ({ page }) => {
  // The streak count should be visible
  const streakEl = page.locator('#streak-count');
  await expect(streakEl).toBeVisible({ timeout: 3000 });

  // Should start at 0
  await expect(streakEl).toHaveText('0');
});

test('13. Add task with time bracket', async ({ page }) => {
  await addTaskViaState(page, 'Standup meeting', {
    priority: 'normal',
    time: '10:00',
  });

  const items = page.locator('#mission-list .mission-item');
  await expect(items).toHaveCount(1);

  // Should show the time
  const missionTime = items.locator('.mission-time');
  await expect(missionTime).toBeVisible();
  await expect(missionTime).toContainText('10:00');

  // Text should not include the time bracket
  const missionText = items.locator('.mission-text');
  await expect(missionText).toHaveText('Standup meeting');
});

test('14. Mission log panel is visible after adding tasks', async ({ page }) => {
  // Initially, after clearing state, the empty state should show
  const missionLog = page.locator('#mission-log');
  await expect(missionLog).toBeVisible({ timeout: 3000 });

  // After adding tasks, panel should still be visible
  await runCLI(page, 'task Test task');
  await expect(missionLog).toBeVisible();
  await expect(page.locator('#mission-list')).toBeVisible();
});

test('15. Progress bar width updates proportionally', async ({ page }) => {
  await addTaskViaState(page, 'Task 1', { priority: 'normal' });
  await addTaskViaState(page, 'Task 2', { priority: 'normal' });

  // Complete one task
  await page.evaluate(() => {
    if (window.State && window.State.TASKS && window.State.TASKS[0]) {
      window.State.TASKS[0].completed = true;
      if (window.renderMissions) window.renderMissions();
      if (window.updateProgressBar) window.updateProgressBar();
    }
  });
  await page.waitForTimeout(300);

  // Progress bar should have some width (50%)
  const progressBar = page.locator('#progress-bar');
  const width = await progressBar.getAttribute('style');
  expect(width).toMatch(/width:\s*50%/);
});
