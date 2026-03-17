import { test, expect } from '@playwright/test';
import { login, ORG } from './helpers';

// Seed data: Core team → Platform project (prefix PLAT)
const ISSUES_URL = `/${ORG}/core/platform/issues`;
const BOARD_URL = `/${ORG}/core/platform/board`;

test.describe('Issues', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('issue list shows seeded issues', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('heading', { name: /issues/i })).toBeVisible();
    // Seed has ~15 platform issues
    const rows = page.locator('[data-testid="issue-row"], tr, .issue-row').first();
    await expect(rows).toBeVisible({ timeout: 10_000 });
  });

  test('issue list has new issue button', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('link', { name: /new issue/i })).toBeVisible();
  });

  test('create a new issue', async ({ page }) => {
    await page.goto(`/${ORG}/core/platform/issues/new`);
    await page.getByLabel('Title').fill('E2E Test Issue');
    await page.getByRole('button', { name: /create/i }).click();
    await expect(page).toHaveURL(ISSUES_URL);
    await expect(page.getByText('E2E Test Issue')).toBeVisible();
  });

  test('issue detail page loads', async ({ page }) => {
    await page.goto(ISSUES_URL);
    // Click first issue
    await page.locator('a[href*="/issues/"]').first().click();
    await expect(page.getByRole('heading')).toBeVisible();
    // Should show issue key like PLAT-1
    await expect(page.getByText(/PLAT-\d+/)).toBeVisible();
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
    await expect(page.locator('.board-card, [draggable="true"]').first()).toBeVisible({ timeout: 10_000 });
  });
});
