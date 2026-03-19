import { test, expect } from '@playwright/test';

import { login, ORG } from './helpers';

const TEAM = 'core';
const PROJECT = 'platform';
const PROJECT_SETTINGS_URL = `/${ORG}/${TEAM}/${PROJECT}/settings`;
const REPOS_URL = `/${ORG}/${TEAM}/repos`;

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to project settings', async ({ page }) => {
    await page.goto(PROJECT_SETTINGS_URL);
    await expect(
      page.getByRole('heading', { name: /settings/i }).first()
        .or(page.getByText(/settings/i).first())
    ).toBeVisible({ timeout: 10_000 });
  });

  test('project labels settings page loads', async ({ page }) => {
    await page.goto(`${PROJECT_SETTINGS_URL}/labels`);
    await expect(
      page.getByRole('heading', { name: /labels/i }).first()
        .or(page.getByText(/labels/i).first())
    ).toBeVisible({ timeout: 10_000 });
    // Should show label entries or a create button
    await expect(
      page.getByRole('button', { name: /create|add|new/i }).first()
        .or(page.locator('[data-testid*="label"], .label-row, .label-item').first())
    ).toBeVisible({ timeout: 10_000 });
  });

  test('project automation settings page loads', async ({ page }) => {
    await page.goto(`${PROJECT_SETTINGS_URL}/automation`);
    await expect(
      page.getByText(/automation|rules/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('repo settings page loads', async ({ page }) => {
    await page.goto(REPOS_URL);
    // Navigate to first repo
    await page.locator('a[href*="/repos/"]').first().click();
    await expect(page).toHaveURL(/\/repos\//);

    // Find and click settings tab/link
    const settingsLink = page.getByRole('link', { name: /settings/i }).first();
    if (await settingsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await settingsLink.click();
      await expect(
        page.getByRole('heading', { name: /settings/i }).first()
          .or(page.getByText(/settings/i).first())
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test('SSH keys settings page loads', async ({ page }) => {
    await page.goto(`/${ORG}/settings/ssh-keys`);
    // Should show SSH keys heading or section
    await expect(
      page.getByText(/ssh key/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('SSH keys page has add key form elements', async ({ page }) => {
    await page.goto(`/${ORG}/settings/ssh-keys`);
    await expect(page.getByText(/ssh key/i).first()).toBeVisible({ timeout: 10_000 });
    // Should have a button to add a new key
    await expect(
      page.getByRole('button', { name: /add|create|new/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('org settings page loads', async ({ page }) => {
    await page.goto(`/${ORG}/settings`);
    await expect(
      page.getByRole('heading', { name: /settings/i }).first()
        .or(page.getByText(/settings/i).first())
    ).toBeVisible({ timeout: 10_000 });
  });
});
