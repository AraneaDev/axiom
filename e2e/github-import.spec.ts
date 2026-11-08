import { test, expect } from '@playwright/test';

import { DEMO_USERS, login, ORG } from './helpers';

// The seed links the PLAT project to the invented repository acme-labs/widget. GitHub itself is
// never reached: the import and the release notes are covered by the backend tests.
test.describe('GitHub import and release notes settings', () => {
  test('shows both sections and saves a default release notes space', async ({ page }) => {
    await login(page, DEMO_USERS.admin);
    await page.goto(`/${ORG}/core/platform/settings/github`);

    await expect(page.getByRole('heading', { name: 'GitHub Issues import' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel('Import GitHub Issues')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Release notes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Write release notes' })).toBeVisible();

    await page.getByLabel('Default space').click();
    const options = page.locator('div.absolute button', { hasNotText: 'No default space' });
    const first = options.last();
    const name = (await first.textContent())?.trim() ?? '';
    await first.click();
    await expect(page.getByText('Default space saved')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Default space')).toContainText(name, { timeout: 15_000 });
  });
});
