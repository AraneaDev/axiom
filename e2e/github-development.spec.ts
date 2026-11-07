import { test, expect } from '@playwright/test';

import { DEMO_USERS, login, ORG } from './helpers';

// The seed links the PLAT project to the invented repository acme-labs/widget and attaches one
// pull request (#42) and one failed check to PLAT-1. GitHub itself is never reached.
test.describe('GitHub Development panel', () => {
  test('shows the pull request and the log of the failed check', async ({ page }) => {
    await login(page, DEMO_USERS.admin);
    await page.goto(`/${ORG}/core/platform/issues/1`);

    await expect(page.getByRole('heading', { name: 'Development' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: '#42' })).toBeVisible();
    await expect(page.getByText('Add a cache for stored widgets')).toBeVisible();

    await page.getByRole('button', { name: /build/ }).click();
    await expect(page.getByText('Run unit tests')).toBeVisible();
    await expect(page.getByLabel('Log tail')).toContainText('expected 2 widgets, got 3');
  });

  test('the project settings page shows the linked repository', async ({ page }) => {
    await login(page, DEMO_USERS.admin);
    await page.goto(`/${ORG}/core/platform/settings/github`);
    await expect(page.getByRole('link', { name: /acme-labs\/widget/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Reconcile now' })).toBeVisible();
  });
});
