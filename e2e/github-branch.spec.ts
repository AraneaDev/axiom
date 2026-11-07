import { test, expect } from '@playwright/test';

import { DEMO_USERS, login, ORG } from './helpers';

// The demo user has no connected GitHub account, so the dialog shows the notice and its link.
// The success path is covered by the backend tests against the fake and the component test.
test.describe('Create a branch from the issue page', () => {
  test('without a connected account the dialog links to the GitHub settings', async ({ page }) => {
    await login(page, DEMO_USERS.admin);
    await page.goto(`/${ORG}/core/platform/issues/1`);

    await page.getByRole('button', { name: 'Create branch' }).click({ timeout: 15_000 });
    const dialog = page.getByRole('dialog', { name: 'Create a branch' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Branch name')).toHaveCount(0);
    await expect(dialog.getByRole('link', { name: 'Connect GitHub' })).toHaveAttribute(
      'href',
      '/settings/github',
    );
  });
});
