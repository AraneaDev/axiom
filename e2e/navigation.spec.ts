import { test, expect, type Page } from '@playwright/test';
import { login, ORG } from './helpers';

// Other specs create extra organisations, so pick the Axiom card by its URL
function axiomWorkspaceLink(page: Page) {
  return page.getByRole('main').locator(`a[href="/${ORG}"]`).filter({ hasText: /open workspace/i });
}

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dashboard shows organisations', async ({ page }) => {
    await expect(page.getByRole('main').getByRole('heading', { name: 'Axiom' })).toBeVisible();
    await expect(axiomWorkspaceLink(page)).toBeVisible();
  });

  test('open workspace navigates to org teams page', async ({ page }) => {
    await axiomWorkspaceLink(page).click();
    await expect(page).toHaveURL(`/${ORG}`);
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();
  });

  test('org teams page lists seed teams', async ({ page }) => {
    await page.goto(`/${ORG}`);
    const teams = page.getByRole('main');
    await expect(teams.getByRole('heading', { name: 'Core' })).toBeVisible();
    await expect(teams.getByText('Core platform team')).toBeVisible();
  });

  test('clicking a team navigates to team detail', async ({ page }) => {
    await page.goto(`/${ORG}`);
    await page.getByRole('main').getByRole('link', { name: /^Core/ }).click();
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
    await page.getByRole('banner').getByRole('link', { name: 'Axiom' }).click();
    // The logo links to '/', which redirects an authenticated user to the dashboard
    await expect(page).toHaveURL('/dashboard');
  });
});
