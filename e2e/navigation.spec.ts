import { test, expect } from '@playwright/test';
import { login, ORG } from './helpers';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dashboard shows organisations', async ({ page }) => {
    await expect(page.getByText('Axiom')).toBeVisible();
    await expect(page.getByRole('link', { name: /open workspace/i })).toBeVisible();
  });

  test('open workspace navigates to org teams page', async ({ page }) => {
    await page.getByRole('link', { name: /open workspace/i }).click();
    await expect(page).toHaveURL(`/${ORG}`);
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();
  });

  test('org teams page lists seed teams', async ({ page }) => {
    await page.goto(`/${ORG}`);
    await expect(page.getByText('Core')).toBeVisible();
    await expect(page.getByText('Frontend')).toBeVisible();
    await expect(page.getByText('Infrastructure')).toBeVisible();
  });

  test('clicking a team navigates to team detail', async ({ page }) => {
    await page.goto(`/${ORG}`);
    await page.getByRole('link', { name: /^Core/ }).click();
    await expect(page).toHaveURL(`/${ORG}/core`);
  });

  test('sidebar shows org and team sections', async ({ page }) => {
    await page.goto(`/${ORG}/core`);
    // Sidebar navigation links
    await expect(page.getByRole('link', { name: /issues/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /wiki/i }).first()).toBeVisible();
  });

  test('header logo links back to dashboard', async ({ page }) => {
    await page.goto(`/${ORG}/core`);
    await page.getByRole('link', { name: 'Axiom' }).click();
    await expect(page).toHaveURL('/');
  });
});
