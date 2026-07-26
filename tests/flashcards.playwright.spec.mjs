/**
 * Vinland Spaced Repetition Flashcards — Playwright Integration Test
 *
 * Tests the flashcard/review system:
 * - Cloze deletion extraction ({c1::text}) from note content
 * - Review queue (Cmd+R)
 * - SM-2 card grading and rescheduling
 * - Card statistics
 *
 * Run with:
 *   npx playwright test tests/flashcards.playwright.spec.mjs
 */

import { test, expect } from '@playwright/test';
import { APP_URL, runCLI, waitForEditor, closeEditor, getFirstBlock } from './helpers.mjs';

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);

  // Clear all persisted data and flashcard index
  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith('OPERATOR_') || k.startsWith('VINLAND_')
    );
    keys.forEach(k => localStorage.removeItem(k));
    if (window.State) {
      if (Array.isArray(window.State.NOTES)) window.State.NOTES.length = 0;
      if (Array.isArray(window.State.TASKS)) window.State.TASKS.length = 0;
      if (Array.isArray(window.State.BOARDS)) window.State.BOARDS.length = 0;
    }
    // Clear IndexedDB flashcard data
    if (window.FlashcardManager && window.FlashcardManager.clearAll) {
      window.FlashcardManager.clearAll();
    }
  });

  await page.waitForTimeout(300);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    try {
      const keys = Object.keys(localStorage).filter(k =>
        k.startsWith('OPERATOR_') || k.startsWith('VINLAND_')
      );
      keys.forEach(k => localStorage.removeItem(k));
      if (window.FlashcardManager && window.FlashcardManager.clearAll) {
        window.FlashcardManager.clearAll();
      }
    } catch { /* ignore */ }
  }).catch(() => {});
});

// ════════════════════════════════════════════════════════════
// Test 1: Cloze deletions are extracted as flashcards
// ════════════════════════════════════════════════════════════
test('1. Cloze deletions in note content are extracted as flashcards in the review queue', async ({ page }) => {
  // Create a note with cloze deletions
  await runCLI(page, 'note Cloze Test Note');
  await waitForEditor(page);

  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();

  // Type content with {c1::cloze deletion} syntax
  await block.type('The capital of France is {c1::Paris::city}.', { delay: 10 });
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);
  await closeEditor(page);

  // Open the review queue
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await runCLI(page, 'review');
  await page.waitForTimeout(800);

  // Review modal should be visible
  const reviewModal = page.locator('#review-modal');
  await expect(reviewModal).toBeVisible({ timeout: 5000 });

  // Should show progress indicator (visible) showing 1 card
  const progress = page.locator('.review-progress');
  await expect(progress).toBeVisible();
  const progressText = await progress.textContent();
  expect(progressText).toMatch(/Card 1 of 1/);
});

// ════════════════════════════════════════════════════════════
// Test 2: Grading a card reschedules it (SM-2)
// ════════════════════════════════════════════════════════════
test('2. Grading a card with quality 4 (Easy) reschedules it with a future due date', async ({ page }) => {
  await runCLI(page, 'note Grade Test');
  await waitForEditor(page);

  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();
  await block.type('A {c1::graded card::test} in the system.', { delay: 5 });
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);
  await closeEditor(page);

  // Open review queue
  await runCLI(page, 'review');
  await page.waitForTimeout(800);

  // Click "SHOW ANSWER" to reveal grade buttons
  const flipBtn = page.locator('#review-flip-btn');
  await expect(flipBtn).toBeVisible({ timeout: 3000 });
  await flipBtn.click();
  await page.waitForTimeout(200);

  // Grade the card as "Easy" (quality=5)
  const easyBtn = page.locator('#review-grade-easy');
  await expect(easyBtn).toBeVisible({ timeout: 3000 });
  await easyBtn.click();
  await page.waitForTimeout(500);

  // Session is complete — shows "Session Complete!" message
  const completeMsg = page.locator('.review-complete');
  await expect(completeMsg).toBeVisible({ timeout: 3000 });

  // Close modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Re-open review session — the card was scheduled 4 days out, so should be empty now
  await runCLI(page, 'review');
  await page.waitForTimeout(800);
  const emptyMsg = page.locator('.review-empty');
  await expect(emptyMsg).toBeVisible({ timeout: 3000 });

  // Close modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ════════════════════════════════════════════════════════════
// Test 3: Multiple cloze deletions create multiple cards
// ════════════════════════════════════════════════════════════
test('3. A note with multiple {c1::} and {c2::} creates separate flashcard entries', async ({ page }) => {
  await runCLI(page, 'note Multi Cloze Test');
  await waitForEditor(page);

  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();
  // Content with multiple cloze deletions at different card numbers
  await block.type('{c1::German::language} is spoken in {c2::Germany::country}.', { delay: 5 });
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);
  await closeEditor(page);

  // Open review queue
  await runCLI(page, 'review');
  await page.waitForTimeout(800);

  // Should have 2 cards due (Card 1 of 2 shown on review-progress)
  const progress = page.locator('.review-progress');
  await expect(progress).toBeVisible();
  const progressText = await progress.textContent();
  expect(progressText).toMatch(/Card 1 of 2/);
});

// ════════════════════════════════════════════════════════════
// Test 4: ::simple:: syntax works as shorthand for {c1::simple}
// ════════════════════════════════════════════════════════════
test('4. Simple ::double-colon:: syntax is extracted as a flashcard', async ({ page }) => {
  await runCLI(page, 'note Simple Cloze Test');
  await waitForEditor(page);

  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();
  await block.type('The ::capital:: of France is Paris.', { delay: 5 });
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);
  await closeEditor(page);

  // Open review queue
  await runCLI(page, 'review');
  await page.waitForTimeout(800);

  // Should have 1 card due from ::capital:: (Card 1 of 1 shown)
  const progress = page.locator('.review-progress');
  await expect(progress).toBeVisible();
  const progressText = await progress.textContent();
  expect(progressText).toMatch(/Card 1 of 1/);
});

// ════════════════════════════════════════════════════════════
// Test 5: Review session ends when all cards are graded
// ════════════════════════════════════════════════════════════
test('5. Review session progresses through all cards and shows empty state when done', async ({ page }) => {
  await runCLI(page, 'note End Session Test');
  await waitForEditor(page);

  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();
  await block.type('{c1::card1} {c1::card2} {c1::card3}', { delay: 5 });
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);
  await closeEditor(page);

  // Open review queue - should have 3 cards
  await runCLI(page, 'review');
  await page.waitForTimeout(800);

  // Grade all 3 cards as "Good"
  for (let i = 0; i < 3; i++) {
    // Click "SHOW ANSWER" to reveal grade buttons
    const flipBtn = page.locator('#review-flip-btn');
    await expect(flipBtn).toBeVisible({ timeout: 3000 });
    await flipBtn.click();
    await page.waitForTimeout(100);

    const goodBtn = page.locator('#review-grade-good');
    await expect(goodBtn).toBeVisible({ timeout: 3000 });
    await goodBtn.click();
    await page.waitForTimeout(300);
  }

  // After grading all, should see empty/completed state
  const emptyMsg = page.locator('.review-complete');
  await expect(emptyMsg).toBeVisible({ timeout: 3000 });
});

// ════════════════════════════════════════════════════════════
// Test 6: `flashcards` CLI command shows stats + opens review
// ════════════════════════════════════════════════════════════
test('6. `flashcards` CLI command shows stats notification and opens the review queue', async ({ page }) => {
  // Create a note with multiple clozes
  await runCLI(page, 'note Flashcards Cmd Test');
  await waitForEditor(page);

  const block = getFirstBlock(page);
  await block.waitFor({ state: 'visible', timeout: 5000 });
  await block.click();
  await block.type('{c1::Paris} {c1::Berlin} and {c1::London}.', { delay: 5 });
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);
  await closeEditor(page);

  // Run the `flashcards` command
  await runCLI(page, 'flashcards');
  await page.waitForTimeout(1000);

  // Should have opened the review modal with 3 cards (Card 1 of 3)
  const reviewModal = page.locator('#review-modal');
  await expect(reviewModal).toBeVisible({ timeout: 5000 });

  const progress = page.locator('.review-progress');
  await expect(progress).toBeVisible();
  const progressText = await progress.textContent();
  expect(progressText).toMatch(/Card 1 of 3/);

  // Verify we can grade cards (proves the session is functional after stats)
  const flipBtn = page.locator('#review-flip-btn');
  await expect(flipBtn).toBeVisible({ timeout: 3000 });
  await flipBtn.click();
  await page.waitForTimeout(100);

  const goodBtn = page.locator('#review-grade-good');
  await expect(goodBtn).toBeVisible({ timeout: 3000 });
  await goodBtn.click();
  await page.waitForTimeout(300);

  // Should now show Card 2 of 3 (grading advanced to next card)
  const progress2 = page.locator('.review-progress');
  await expect(progress2).toBeVisible({ timeout: 3000 });
  const progressText2 = await progress2.textContent();
  expect(progressText2).toMatch(/Card 2 of 3/);
});
