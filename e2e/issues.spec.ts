import { test, expect } from '@playwright/test';

import { login, ORG, issueLinks } from './helpers';

// Seed data: Core team -> Platform project (prefix PLAT)
const ISSUES_URL = `/${ORG}/core/platform/issues`;

test.describe('Issues', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('issue list shows seeded issues', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('heading', { name: /issues/i })).toBeVisible();
    // Seed has platform issues
    await expect(page.getByRole('link', { name: /PLAT-1 Set up CI\/CD pipeline/ })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('link', { name: /PLAT-7 API response caching/ })).toBeVisible();
  });

  test('issue list has new issue button', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('link', { name: /new issue/i })).toBeVisible();
  });

  test('create a new issue', async ({ page }) => {
    await page.goto(`/${ORG}/core/platform/issues/new`);
    await page.getByLabel('Title').fill('E2E Test Issue');
    await page.getByRole('button', { name: /create/i }).click();
    // Creating an issue opens its detail page
    await expect(page).toHaveURL(/\/issues\/\d+$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'E2E Test Issue' })).toBeVisible();
  });

  test('issue detail page loads', async ({ page }) => {
    await page.goto(ISSUES_URL);
    // Click first issue link
    await issueLinks(page).first().click();
    await expect(page).toHaveURL(/\/issues\/\d+$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Should show issue key like PLAT-1
    await expect(page.getByText(/PLAT-\d+/).first()).toBeVisible();
  });

  test('navigate between issue list and detail', async ({ page }) => {
    await page.goto(ISSUES_URL);
    // Go to detail
    await issueLinks(page).first().click();
    await expect(page).toHaveURL(/\/issues\/\d+$/, { timeout: 10_000 });
    await expect(page.getByText(/PLAT-\d+/).first()).toBeVisible();
    // Go back to list
    await page.goBack();
    await expect(page.getByRole('heading', { name: /issues/i })).toBeVisible();
  });

  test('issue detail shows sidebar with priority', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await issueLinks(page).first().click();
    // The detail view should show a priority field
    await expect(page.getByText('Priority', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('add a comment on an issue', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await issueLinks(page).first().click();
    await expect(page).toHaveURL(/\/issues\/\d+$/, { timeout: 10_000 });
    await expect(page.getByText(/PLAT-\d+/).first()).toBeVisible();

    // Look for comment input area (textarea, contenteditable, or ProseMirror editor)
    const commentArea = page.locator('textarea, [contenteditable="true"], .ProseMirror').last();
    await commentArea.click();
    await commentArea.fill('E2E test comment');

    // Submit comment
    await page.getByRole('button', { name: 'Comment', exact: true }).click();

    // Verify comment appears
    await expect(page.getByText('E2E test comment')).toBeVisible({ timeout: 10_000 });
  });
});
