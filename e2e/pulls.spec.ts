import { test, expect } from '@playwright/test';

import { login, ORG } from './helpers';

const TEAM = 'core';
const REPOS_URL = `/${ORG}/${TEAM}/repos`;

test.describe('Pull Requests', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to repo PR list', async ({ page }) => {
    await page.goto(REPOS_URL);
    // Click first repo
    await page.locator('a[href*="/repos/"]').first().click();
    // Navigate to PRs tab
    const prTab = page.getByRole('link', { name: /pull requests|prs/i }).first();
    await expect(prTab).toBeVisible({ timeout: 10_000 });
    await prTab.click();
    await expect(page).toHaveURL(/\/pulls/);
  });

  test('PR list page renders', async ({ page }) => {
    await page.goto(REPOS_URL);
    await page.locator('a[href*="/repos/"]').first().click();
    const prTab = page.getByRole('link', { name: /pull requests|prs/i }).first();
    await expect(prTab).toBeVisible({ timeout: 10_000 });
    await prTab.click();
    // Should show a heading or list area for pull requests
    await expect(
      page.getByRole('heading', { name: /pull requests|prs/i }).first()
        .or(page.locator('[data-testid="pr-list"], .pr-list, table').first())
    ).toBeVisible({ timeout: 10_000 });
  });

  test('view PR detail page', async ({ page }) => {
    await page.goto(REPOS_URL);
    await page.locator('a[href*="/repos/"]').first().click();
    const prTab = page.getByRole('link', { name: /pull requests|prs/i }).first();
    await expect(prTab).toBeVisible({ timeout: 10_000 });
    await prTab.click();

    // Click first PR link if any exist
    const prLink = page.locator('a[href*="/pulls/"]').first();
    if (await prLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await prLink.click();
      // PR detail should show a title heading
      await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test('PR detail shows status badges', async ({ page }) => {
    await page.goto(REPOS_URL);
    await page.locator('a[href*="/repos/"]').first().click();
    const prTab = page.getByRole('link', { name: /pull requests|prs/i }).first();
    await expect(prTab).toBeVisible({ timeout: 10_000 });
    await prTab.click();

    const prLink = page.locator('a[href*="/pulls/"]').first();
    if (await prLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await prLink.click();
      // Should show status badge (open, merged, closed)
      await expect(
        page.getByText(/open|merged|closed/i).first()
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test('PR detail shows merge controls', async ({ page }) => {
    await page.goto(REPOS_URL);
    await page.locator('a[href*="/repos/"]').first().click();
    const prTab = page.getByRole('link', { name: /pull requests|prs/i }).first();
    await expect(prTab).toBeVisible({ timeout: 10_000 });
    await prTab.click();

    const prLink = page.locator('a[href*="/pulls/"]').first();
    if (await prLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await prLink.click();
      // For open PRs, merge button should be visible; for merged/closed, status indicator
      await expect(
        page.getByRole('button', { name: /merge/i }).first()
          .or(page.getByText(/merged|closed/i).first())
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test('PR detail shows file changes tab', async ({ page }) => {
    await page.goto(REPOS_URL);
    await page.locator('a[href*="/repos/"]').first().click();
    const prTab = page.getByRole('link', { name: /pull requests|prs/i }).first();
    await expect(prTab).toBeVisible({ timeout: 10_000 });
    await prTab.click();

    const prLink = page.locator('a[href*="/pulls/"]').first();
    if (await prLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await prLink.click();
      // Should have a files/changes tab or section
      const filesTab = page.getByRole('link', { name: /files|changes|diff/i }).first()
        .or(page.getByRole('tab', { name: /files|changes|diff/i }).first());
      await expect(filesTab).toBeVisible({ timeout: 10_000 });
    }
  });
});
