import { test, expect } from '@playwright/test';

import { login, ORG } from './helpers';

test.describe('Create entity forms', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should create an organization with description', async ({ page }) => {
    await page.goto('/orgs/new');

    const orgName = `E2E Test Org ${Date.now()}`;
    await page.getByLabel('Organization name').fill(orgName);

    // Slug should auto-populate
    const slugInput = page.getByLabel('URL slug');
    await expect(slugInput).not.toHaveValue('');

    // Fill the description (markdown editor)
    const descField = page.locator('form .ProseMirror');
    await expect(descField).toBeVisible();
    await descField.fill('Organization created by E2E test');

    await page.getByRole('button', { name: /create organization/i }).click();

    // Should redirect to the new org page (not stay on the form)
    await page.waitForURL((url) => !url.pathname.includes('/orgs/new'), { timeout: 10_000 });
  });

  test('should create a team with description', async ({ page }) => {
    await page.goto(`/${ORG}/teams/new`);

    const teamName = `E2E Test Team ${Date.now()}`;
    await page.getByLabel(/team name/i).fill(teamName);

    // Fill the description (markdown editor)
    const descField = page.locator('form .ProseMirror');
    await expect(descField).toBeVisible();
    await descField.fill('Team created by E2E test');

    await page.getByRole('button', { name: /create team/i }).click();

    // Should redirect away from the create page
    await page.waitForURL((url) => !url.pathname.includes('/teams/new'), { timeout: 10_000 });
  });
});
