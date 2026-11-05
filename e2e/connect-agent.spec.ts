import { test, expect } from '@playwright/test';

import { login } from './helpers';

test.describe('Connect an agent', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('creates a token and shows the Claude Code command', async ({ page }) => {
    const name = `Claude Code ${Date.now()}`;
    await page.goto('/settings/connect-agent');
    await page.getByLabel('Token name').fill(name);
    await page.getByRole('button', { name: /create token/i }).click();

    const command = page.getByLabel('Command', { exact: true });
    await expect(command).toBeVisible({ timeout: 10_000 });
    const value = await command.inputValue();
    expect(value).toContain(`${new URL(page.url()).origin}/api/mcp`);
    expect(value).toMatch(/Authorization: Token tk_/);

    await page.goto('/settings/tokens');
    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
