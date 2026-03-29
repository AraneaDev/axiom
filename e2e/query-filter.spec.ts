import { test, expect } from '@playwright/test';

import { login, ORG } from './helpers';

const TEAM = 'core';
const PROJECT = 'platform';
const ISSUES_URL = `/${ORG}/${TEAM}/${PROJECT}/issues`;

test.describe('Query Filter', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('shows query bar toggle button', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('heading', { name: /issues/i })).toBeVisible({ timeout: 10_000 });
    // Code icon button toggles query mode
    const toggleButton = page
      .getByRole('button', { name: /query|code|filter mode/i })
      .first()
      .or(page.locator('[data-testid="query-toggle"], [title*="query" i], [title*="Query" i]').first());
    await expect(toggleButton).toBeVisible({ timeout: 10_000 });
  });

  test('can toggle between filter mode and query mode', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('heading', { name: /issues/i })).toBeVisible({ timeout: 10_000 });

    // Find and click the query mode toggle
    const toggleButton = page
      .getByRole('button', { name: /query|code/i })
      .first()
      .or(page.locator('[data-testid="query-toggle"], [title*="query" i]').first());
    await toggleButton.click();

    // Query bar input should appear
    const queryInput = page
      .getByRole('textbox', { name: /query/i })
      .first()
      .or(page.locator('[data-testid="query-bar"], input[placeholder*="query" i], input[placeholder*="filter" i]').first());
    await expect(queryInput).toBeVisible({ timeout: 10_000 });

    // Toggle back — dropdowns/filters should return
    await toggleButton.click();
    await expect(queryInput).not.toBeVisible({ timeout: 10_000 });
  });

  test('can filter issues with simple query syntax', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('heading', { name: /issues/i })).toBeVisible({ timeout: 10_000 });

    // Switch to query mode
    const toggleButton = page
      .getByRole('button', { name: /query|code/i })
      .first()
      .or(page.locator('[data-testid="query-toggle"], [title*="query" i]').first());
    await toggleButton.click();

    const queryInput = page
      .getByRole('textbox', { name: /query/i })
      .first()
      .or(page.locator('[data-testid="query-bar"], input[placeholder*="query" i], input[placeholder*="filter" i]').first());
    await expect(queryInput).toBeVisible({ timeout: 10_000 });

    // Type a simple type filter
    await queryInput.fill('type:bug');
    await queryInput.press('Enter');

    // Results should update — list of issues should still render (possibly filtered)
    const issueList = page
      .locator('[data-testid="issue-row"], tr, .issue-row, a[href*="/issues/"]')
      .first();
    // Either results show or an empty state is visible
    const emptyState = page.getByText(/no issues|no results/i).first();
    await expect(issueList.or(emptyState)).toBeVisible({ timeout: 10_000 });
  });

  test('can filter with complex query syntax', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('heading', { name: /issues/i })).toBeVisible({ timeout: 10_000 });

    const toggleButton = page
      .getByRole('button', { name: /query|code/i })
      .first()
      .or(page.locator('[data-testid="query-toggle"], [title*="query" i]').first());
    await toggleButton.click();

    const queryInput = page
      .getByRole('textbox', { name: /query/i })
      .first()
      .or(page.locator('[data-testid="query-bar"], input[placeholder*="query" i], input[placeholder*="filter" i]').first());
    await expect(queryInput).toBeVisible({ timeout: 10_000 });

    await queryInput.fill('priority:high,critical');
    await queryInput.press('Enter');

    const issueList = page
      .locator('[data-testid="issue-row"], tr, .issue-row, a[href*="/issues/"]')
      .first();
    const emptyState = page.getByText(/no issues|no results/i).first();
    await expect(issueList.or(emptyState)).toBeVisible({ timeout: 10_000 });
  });

  test('can clear query', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('heading', { name: /issues/i })).toBeVisible({ timeout: 10_000 });

    const toggleButton = page
      .getByRole('button', { name: /query|code/i })
      .first()
      .or(page.locator('[data-testid="query-toggle"], [title*="query" i]').first());
    await toggleButton.click();

    const queryInput = page
      .getByRole('textbox', { name: /query/i })
      .first()
      .or(page.locator('[data-testid="query-bar"], input[placeholder*="query" i], input[placeholder*="filter" i]').first());
    await expect(queryInput).toBeVisible({ timeout: 10_000 });

    await queryInput.fill('type:bug');
    await queryInput.press('Enter');

    // Click the clear / X button
    const clearButton = page
      .getByRole('button', { name: /clear/i })
      .first()
      .or(page.locator('[data-testid="query-clear"], [title*="clear" i], [aria-label*="clear" i]').first());
    await clearButton.click();

    // All issues should return — list should be non-empty
    const issueList = page
      .locator('[data-testid="issue-row"], tr, .issue-row, a[href*="/issues/"]')
      .first();
    await expect(issueList).toBeVisible({ timeout: 10_000 });
  });
});
