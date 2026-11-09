import { test, expect } from '@playwright/test';

import { login, ORG } from './helpers';

test.describe('Service accounts', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('an owner makes a token for the seeded bot, sees it once, and after a reload only its prefix', async ({
    page,
  }) => {
    const name = `e2e ${Date.now()}`;

    // The org settings, then Service accounts
    await page.goto(`/${ORG}/settings`);
    await page.getByRole('link', { name: 'Service accounts' }).click();
    await expect(page).toHaveURL(new RegExp(`/${ORG}/settings/service-accounts$`));

    // The seeded bot, and its page
    await page.getByRole('link', { name: /Triage bot/ }).click();
    await expect(page.getByRole('heading', { name: 'Triage bot' })).toBeVisible({
      timeout: 10_000,
    });

    // A new token
    await page.getByRole('button', { name: /New token/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Token name').fill(name);
    await dialog.getByRole('button', { name: /Create token/ }).click();

    // The raw token, once, with the snippets filled in with it
    const shown = page.getByTestId('new-token');
    await expect(shown).toBeVisible({ timeout: 10_000 });
    const raw = await shown.getByLabel('token', { exact: true }).inputValue();
    expect(raw.length).toBeGreaterThan(20);
    await expect(shown.getByLabel('Claude Code: Command')).toHaveValue(
      new RegExp(`Authorization: Token ${raw}`),
    );

    // The list holds it by its prefix, and the raw value appears nowhere else
    const row = page.locator('[data-testid^="token-"]', { hasText: name });
    await expect(row).toBeVisible();
    const prefix = (await row.locator('code').innerText()).replace(/\.\.\.$/, '');
    expect(raw.startsWith(prefix)).toBe(true);
    expect(await row.innerText()).not.toContain(raw);

    // A reload: the raw token is gone, only the prefix shows
    await page.reload();
    await expect(page.locator('[data-testid^="token-"]', { hasText: name })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('new-token')).toHaveCount(0);
    expect(await page.content()).not.toContain(raw);
    await expect(
      page.locator('[data-testid^="token-"]', { hasText: name }).locator('code'),
    ).toHaveText(`${prefix}...`);
  });
});
