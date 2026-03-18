import { test, expect } from '@playwright/test';

import { login, ORG } from './helpers';

const BOARD_URL = `/${ORG}/core/platform/board`;

test.describe('Kanban Board', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('board view shows columns', async ({ page }) => {
    await page.goto(BOARD_URL);
    await expect(page.getByText('Backlog')).toBeVisible();
    await expect(page.getByText('In Progress')).toBeVisible();
    await expect(page.getByText('Done')).toBeVisible();
  });

  test('board has issue cards', async ({ page }) => {
    await page.goto(BOARD_URL);
    // At least one card somewhere on the board
    await expect(
      page.locator('.board-card, [draggable="true"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('board cards show issue keys', async ({ page }) => {
    await page.goto(BOARD_URL);
    // Cards should display issue keys like PLAT-1
    await expect(page.getByText(/PLAT-\d+/).first()).toBeVisible({ timeout: 10_000 });
  });

  test('clicking a board card navigates to issue detail', async ({ page }) => {
    await page.goto(BOARD_URL);
    // Click on an issue link within the board
    const card = page.locator('a[href*="/issues/"]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page.getByText(/PLAT-\d+/)).toBeVisible();
  });
});
