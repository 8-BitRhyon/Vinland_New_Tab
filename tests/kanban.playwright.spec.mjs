/**
 * Vinland Kanban Board — Playwright Integration Tests
 *
 * Tests the complete Kanban board workflow: create a board, open it,
 * add cards, edit card content, delete cards, manage columns, and
 * verify persistence across close/reopen.
 *
 * Run with:
 *   npx playwright test tests/kanban.playwright.spec.mjs
 */

import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:9999';

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

async function waitForBoardModal(page) {
  const modal = page.locator('#kanban-modal');
  await modal.waitFor({ state: 'visible', timeout: 8000 });
  return modal;
}

async function closeBoardModal(page) {
  const closeBtn = page.locator('#kanban-modal-close-btn');
  if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(400);
}

/** Create a board via window.KanbanManager. Returns the board ID. */
async function createBoard(page, title) {
  return await page.evaluate((t) => {
    if (!window.KanbanManager) return null;
    const board = window.KanbanManager.createBoard(t);
    return board ? board.id : null;
  }, title);
}

/** Open a board by ID via KanbanManager.open(). */
async function openBoard(page, boardId) {
  await page.evaluate((id) => {
    if (window.KanbanManager) {
      window.KanbanManager.open(id);
    }
  }, boardId);
  await page.waitForTimeout(400);
}

/**
 * Add a card to a specific column index.
 * If boardId is provided, adds directly via State (works before opening the board).
 * If boardId is omitted, uses KanbanManager.activeBoard (must be open).
 */
async function addCard(page, colIndex, content, boardId) {
  if (boardId) {
    // Direct State manipulation — works before the board is opened
    await page.evaluate(({ idx, text, bId }) => {
      const board = (window.State?.BOARDS ?? []).find(b => b.id === bId);
      if (!board) return;
      const col = board.columns[idx];
      if (!col) return;
      col.cards.push({
        id: 'card_' + Date.now(),
        content: text,
        created: Date.now()
      });
      board.modified = Date.now();
      if (window.saveData) window.saveData();
      if (window.KanbanManager && window.KanbanManager.render &&
          window.KanbanManager.activeBoard?.id === bId) {
        window.KanbanManager.render();
      }
    }, { idx: colIndex, text: content, bId: boardId });
  } else {
    // Use active board (must be open first)
    await page.evaluate(({ idx, text }) => {
      const km = window.KanbanManager;
      if (!km || !km.activeBoard) return;
      const col = km.activeBoard.columns[idx];
      if (!col) return;
      km.addCard(col.id, text);
    }, { idx: colIndex, text: content });
  }
  await page.waitForTimeout(200);
}

/** Get the count of cards in a specific column. */
async function getCardCount(page, colIndex) {
  return await page.evaluate((idx) => {
    const km = window.KanbanManager;
    if (!km || !km.activeBoard) return 0;
    const col = km.activeBoard.columns[idx];
    return col ? col.cards.length : 0;
  }, colIndex);
}

/** Get all columns in the active board. */
async function getColumnTitles(page) {
  return await page.evaluate(() => {
    const km = window.KanbanManager;
    if (!km || !km.activeBoard) return [];
    return km.activeBoard.columns.map(c => c.title);
  });
}

// ──────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 15000 });

  // Clear any leftover boards and notes from previous tests
  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX' ||
      k === 'OPERATOR_BOARDS_V1'
    );
    keys.forEach(k => localStorage.removeItem(k));
    if (window.State) {
      if (Array.isArray(window.State.NOTES)) window.State.NOTES.length = 0;
      if (Array.isArray(window.State.BOARDS)) window.State.BOARDS.length = 0;
    }
  });

  await page.waitForTimeout(300);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    try {
      const keys = Object.keys(localStorage).filter(k =>
        k.startsWith('OPERATOR_NOTE_') || k === 'OPERATOR_NOTES_INDEX' ||
        k === 'OPERATOR_BOARDS_V1'
      );
      keys.forEach(k => localStorage.removeItem(k));
    } catch { /* page may have navigated away */ }
  }).catch(() => {});
});

// ══════════════════════════════════════════
// 1. Create a Board
// ══════════════════════════════════════════
test('1. Create a board via KanbanManager.createBoard', async ({ page }) => {
  const boardId = await createBoard(page, 'Test Board');
  expect(boardId).not.toBeNull();

  // Verify board exists in State.BOARDS
  const boards = await page.evaluate(() => {
    return (window.State?.BOARDS ?? []).map(b => ({ id: b.id, title: b.title, colCount: b.columns.length }));
  });

  expect(boards.length).toBe(1);
  expect(boards[0].title).toBe('Test Board');
  expect(boards[0].colCount).toBe(3); // Default: PENDING, ACTIVE, RESOLVED
});

// ══════════════════════════════════════════
// 2. Open Board Modal
// ══════════════════════════════════════════
test('2. Open a board and verify the kanban modal appears', async ({ page }) => {
  const boardId = await createBoard(page, 'Modal Test');
  expect(boardId).not.toBeNull();

  await openBoard(page, boardId);
  const modal = await waitForBoardModal(page);

  // The modal title should show the board name
  const title = page.locator('#kanban-modal-title');
  await expect(title).toBeVisible({ timeout: 2000 });
  await expect(title).toContainText(/modal test/i);

  // The container should be visible with columns
  const container = page.locator('#kanban-container');
  await expect(container).toBeVisible({ timeout: 2000 });

  // Should have 3 default column elements
  const columns = page.locator('.kanban-column');
  await expect(columns).toHaveCount(3);

  // Close the modal
  await closeBoardModal(page);
  await expect(modal).not.toBeVisible({ timeout: 3000 });
});

// ══════════════════════════════════════════
// 3. Add Cards and Verify
// ══════════════════════════════════════════
test('3. Add cards to columns and verify they appear', async ({ page }) => {
  const boardId = await createBoard(page, 'Card Test');
  expect(boardId).not.toBeNull();
  await openBoard(page, boardId);
  await waitForBoardModal(page);

  // Add cards to column 0 (PENDING)
  await addCard(page, 0, 'First card');
  await addCard(page, 0, 'Second card');

  // Add card to column 1 (ACTIVE)
  await addCard(page, 1, 'Active card');

  // Verify card counts
  expect(await getCardCount(page, 0)).toBe(2);
  expect(await getCardCount(page, 1)).toBe(1);
  expect(await getCardCount(page, 2)).toBe(0);

  // Verify cards are rendered in the DOM
  const cardElements = page.locator('.kanban-card');
  const cardCount = await cardElements.count();
  expect(cardCount).toBe(3);

  // Close modal
  await closeBoardModal(page);
});

// ══════════════════════════════════════════
// 4. Edit Card Content
// ══════════════════════════════════════════
test('4. Edit card content inline', async ({ page }) => {
  const boardId = await createBoard(page, 'Edit Test');
  expect(boardId).not.toBeNull();
  await openBoard(page, boardId);
  await waitForBoardModal(page);

  // Add a card
  await addCard(page, 0, 'Original content');

  // Find the card content element and click to edit it
  const cardContent = page.locator('.kanban-card-content').first();
  await cardContent.click();
  await page.waitForTimeout(300);

  // The card should now be contenteditable
  const isEditable = await cardContent.getAttribute('contenteditable');
  expect(isEditable).toBe('true');

  // Type new content
  await cardContent.fill('Edited content');

  // Blur to save
  await page.locator('#kanban-container').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(300);

  // Verify the content was saved
  const cardData = await page.evaluate(() => {
    const km = window.KanbanManager;
    if (!km || !km.activeBoard) return null;
    return km.activeBoard.columns[0].cards[0].content;
  });
  expect(cardData).toBe('Edited content');

  await closeBoardModal(page);
});

// ══════════════════════════════════════════
// 5. Delete a Card
// ══════════════════════════════════════════
test('5. Delete a card from a column', async ({ page }) => {
  const boardId = await createBoard(page, 'Delete Test');
  expect(boardId).not.toBeNull();
  await openBoard(page, boardId);
  await waitForBoardModal(page);

  // Add two cards
  await addCard(page, 0, 'Keep me');
  await addCard(page, 0, 'Delete me');
  expect(await getCardCount(page, 0)).toBe(2);

  // Delete the second card via KanbanManager
  await page.evaluate(() => {
    const km = window.KanbanManager;
    if (!km || !km.activeBoard) return;
    const col = km.activeBoard.columns[0];
    const card = col.cards[1];
    if (card) km.deleteCard(card.id, col.id);
  });
  await page.waitForTimeout(200);

  // Only 1 card should remain
  expect(await getCardCount(page, 0)).toBe(1);

  // The remaining card should be "Keep me"
  const remaining = await page.evaluate(() => {
    const km = window.KanbanManager;
    if (!km || !km.activeBoard) return null;
    return km.activeBoard.columns[0].cards[0].content;
  });
  expect(remaining).toBe('Keep me');

  await closeBoardModal(page);
});

// ══════════════════════════════════════════
// 6. Add a Column
// ══════════════════════════════════════════
test('6. Add a custom column to the board', async ({ page }) => {
  const boardId = await createBoard(page, 'Column Test');
  expect(boardId).not.toBeNull();
  await openBoard(page, boardId);
  await waitForBoardModal(page);

  // Add a column via KanbanManager
  await page.evaluate(() => {
    const km = window.KanbanManager;
    if (km) km.addColumn('BACKLOG');
  });
  await page.waitForTimeout(200);

  // Verify 4 columns now exist
  const titles = await getColumnTitles(page);
  expect(titles.length).toBe(4);
  expect(titles[3]).toBe('BACKLOG');

  // Verify DOM has 4 column elements
  const columns = page.locator('.kanban-column');
  await expect(columns).toHaveCount(4);

  await closeBoardModal(page);
});

// ══════════════════════════════════════════
// 7. Rename a Column
// ══════════════════════════════════════════
test('7. Rename a column', async ({ page }) => {
  const boardId = await createBoard(page, 'Rename Test');
  expect(boardId).not.toBeNull();
  await openBoard(page, boardId);
  await waitForBoardModal(page);

  // Rename column 0 from "PENDING" to "TODO"
  await page.evaluate(() => {
    const km = window.KanbanManager;
    if (!km || !km.activeBoard) return;
    const col = km.activeBoard.columns[0];
    km.renameColumn(col.id, 'TODO');
  });
  await page.waitForTimeout(200);

  const titles = await getColumnTitles(page);
  expect(titles[0]).toBe('TODO');
  expect(titles[1]).toBe('ACTIVE');
  expect(titles[2]).toBe('RESOLVED');

  await closeBoardModal(page);
});

// ══════════════════════════════════════════
// 8. Delete a Column
// ══════════════════════════════════════════
test('8. Delete a column from the board', async ({ page }) => {
  const boardId = await createBoard(page, 'Delete Col Test');
  expect(boardId).not.toBeNull();
  await openBoard(page, boardId);
  await waitForBoardModal(page);

  // Delete the third column (RESOLVED) — it has no cards, so no confirm modal
  await page.evaluate(() => {
    const km = window.KanbanManager;
    if (!km || !km.activeBoard) return;
    const col = km.activeBoard.columns[2]; // RESOLVED
    km.deleteColumn(col.id);
  });
  await page.waitForTimeout(200);

  const titles = await getColumnTitles(page);
  expect(titles.length).toBe(2);
  expect(titles).toEqual(['PENDING', 'ACTIVE']);

  await closeBoardModal(page);
});

// ══════════════════════════════════════════
// 9. Board Persistence Across Close/Reopen
// ══════════════════════════════════════════
test('9. Board data persists across close and reopen', async ({ page }) => {
  const boardId = await createBoard(page, 'Persistence Test');
  expect(boardId).not.toBeNull();

  // Add cards before opening the modal (pass boardId for direct State access)
  await addCard(page, 0, 'Persistent card 1', boardId);
  await addCard(page, 1, 'Persistent card 2', boardId);

  // Open the board
  await openBoard(page, boardId);
  await waitForBoardModal(page);

  // Verify cards appear
  expect(await getCardCount(page, 0)).toBe(1);
  expect(await getCardCount(page, 1)).toBe(1);

  // Close
  await closeBoardModal(page);

  // Reopen
  await openBoard(page, boardId);
  await waitForBoardModal(page);

  // Verify cards persisted
  expect(await getCardCount(page, 0)).toBe(1);
  expect(await getCardCount(page, 1)).toBe(1);

  const firstCard = await page.evaluate(() => {
    const km = window.KanbanManager;
    if (!km || !km.activeBoard) return null;
    return km.activeBoard.columns[0].cards[0]?.content;
  });
  expect(firstCard).toBe('Persistent card 1');

  await closeBoardModal(page);
});

// ══════════════════════════════════════════
// 10. Board Persists Across Page Reload
// ══════════════════════════════════════════
test('10. Board data persists across page reload', async ({ page }) => {
  const boardId = await createBoard(page, 'Reload Test');
  expect(boardId).not.toBeNull();

  await addCard(page, 0, 'Reload survivor', boardId);

  // Reload the page
  await page.reload();
  await page.waitForTimeout(2000);
  await expect(page.locator('#cmd-input')).toBeVisible({ timeout: 10000 });

  // Verify board still exists in State.BOARDS
  const boards = await page.evaluate(() => {
    return (window.State?.BOARDS ?? []).map(b => ({
      id: b.id,
      title: b.title,
      cardCount: (b.columns?.[0]?.cards ?? []).length
    }));
  });
  expect(boards.length).toBeGreaterThanOrEqual(1);
  const testBoard = boards.find(b => b.title === 'Reload Test');
  expect(testBoard).toBeDefined();
  expect(testBoard.cardCount).toBe(1);

  // Open the board and verify the card is there
  if (testBoard) {
    await openBoard(page, testBoard.id);
    await waitForBoardModal(page);
    expect(await getCardCount(page, 0)).toBe(1);
    await closeBoardModal(page);
  }
});

// ══════════════════════════════════════════
// 11. Multiple Boards
// ══════════════════════════════════════════
test('11. Create multiple independent boards', async ({ page }) => {
  const board1Id = await createBoard(page, 'Board Alpha');
  expect(board1Id).not.toBeNull();
  await addCard(page, 0, 'Alpha card', board1Id);

  const board2Id = await createBoard(page, 'Board Beta');
  expect(board2Id).not.toBeNull();
  await addCard(page, 0, 'Beta card', board2Id);

  // Open Alpha
  await openBoard(page, board1Id);
  await waitForBoardModal(page);
  expect(await getCardCount(page, 0)).toBe(1);

  const alphaContent = await page.evaluate(() => {
    const km = window.KanbanManager;
    if (!km || !km.activeBoard) return null;
    return km.activeBoard.columns[0].cards[0]?.content;
  });
  expect(alphaContent).toBe('Alpha card');
  await closeBoardModal(page);

  // Open Beta
  await openBoard(page, board2Id);
  await waitForBoardModal(page);
  expect(await getCardCount(page, 0)).toBe(1);

  const betaContent = await page.evaluate(() => {
    const km = window.KanbanManager;
    if (!km || !km.activeBoard) return null;
    return km.activeBoard.columns[0].cards[0]?.content;
  });
  expect(betaContent).toBe('Beta card');
  await closeBoardModal(page);
});
