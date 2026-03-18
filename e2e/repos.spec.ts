import { test, expect } from '@playwright/test';

import { login, ORG } from './helpers';

// The seed creates a repo under the "axiom" team; try core first, fall back to axiom
const TEAM = 'core';
const REPOS_URL = `/${ORG}/${TEAM}/repos`;

test.describe('Repositories', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to repo list', async ({ page }) => {
    await page.goto(REPOS_URL);
    // Should show a repos page with a heading or list
    await expect(
      page.getByRole('heading', { name: /repositories|repos/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('repo list shows repositories', async ({ page }) => {
    await page.goto(REPOS_URL);
    // Wait for repo entries to appear
    await expect(
      page.locator('a[href*="/repos/"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('view repo detail page', async ({ page }) => {
    await page.goto(REPOS_URL);
    // Click first repo link
    await page.locator('a[href*="/repos/"]').first().click();
    // Repo detail should show the file tree or README
    await expect(
      page.locator('table, [role="tree"], .file-tree, .tree-view, a[href*="/blob/"], a[href*="/tree/"]').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('browse file tree from repo detail', async ({ page }) => {
    await page.goto(REPOS_URL);
    await page.locator('a[href*="/repos/"]').first().click();
    // Wait for file listing
    await expect(
      page.locator('a[href*="/tree/"], a[href*="/blob/"]').first()
    ).toBeVisible({ timeout: 15_000 });
    // Click on a tree/blob link to navigate deeper
    const treeLink = page.locator('a[href*="/tree/"], a[href*="/blob/"]').first();
    await treeLink.click();
    // URL should now contain /tree/ or /blob/
    await expect(page).toHaveURL(/\/(tree|blob)\//);
  });

  test('view a file shows content', async ({ page }) => {
    await page.goto(REPOS_URL);
    await page.locator('a[href*="/repos/"]').first().click();
    // Wait for file listing to load
    await expect(
      page.locator('a[href*="/blob/"], a[href*="/tree/"]').first()
    ).toBeVisible({ timeout: 15_000 });

    // Navigate to a blob (file) -- may need to go through a tree first
    const blobLink = page.locator('a[href*="/blob/"]').first();
    if (await blobLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await blobLink.click();
    } else {
      // Enter a directory first, then find a file
      await page.locator('a[href*="/tree/"]').first().click();
      await expect(page.locator('a[href*="/blob/"]').first()).toBeVisible({ timeout: 10_000 });
      await page.locator('a[href*="/blob/"]').first().click();
    }
    // File view should render code content
    await expect(
      page.locator('pre, code, .code-view, .file-content, .hljs, [data-line-number]').first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
