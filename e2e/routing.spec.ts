import { test, expect } from '@playwright/test';
import { login, ORG } from './helpers';

test.describe('Routing after git hosting removal', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('an old repo URL shows the not-found page', async ({ page }) => {
    await page.goto(`/${ORG}/core/repos/axiom`);
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(page.getByText('The page you are looking for does not exist')).toBeVisible();
  });

  test('the sidebar has no Repositories item', async ({ page }) => {
    await page.goto(`/${ORG}/core`);
    const sidebar = page.getByRole('complementary');
    // The team sidebar lists Projects, Wiki, Members and Roadmap; wait for it to render
    await expect(sidebar.getByRole('link', { name: 'Wiki' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Repositories' })).toHaveCount(0);
  });
});
