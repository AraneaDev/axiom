import { test, expect } from '@playwright/test';

import { login, ORG } from './helpers';

const TEAM = 'core';
const PROJECT = 'platform';
const PROJECT_SETTINGS_URL = `/${ORG}/${TEAM}/${PROJECT}/settings`;

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to project settings', async ({ page }) => {
    await page.goto(PROJECT_SETTINGS_URL);
    // /settings redirects to the first settings tab
    await expect(page).toHaveURL(new RegExp(`${PROJECT_SETTINGS_URL}/labels`), { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Project Settings' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('project labels settings page loads', async ({ page }) => {
    await page.goto(`${PROJECT_SETTINGS_URL}/labels`);
    await expect(page.getByRole('heading', { name: 'Labels', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    // Seeded label entries and the create button
    await expect(page.getByText('enhancement', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: /new label/i })).toBeVisible();
  });

  test('project automation settings page loads', async ({ page }) => {
    await page.goto(`${PROJECT_SETTINGS_URL}/automation`);
    await expect(
      page.getByText(/automation|rules/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('org settings page loads', async ({ page }) => {
    await page.goto(`/${ORG}/settings`);
    // The org settings nav, with its first section
    await expect(page.getByRole('link', { name: 'Service accounts' })).toBeVisible({
      timeout: 10_000,
    });
  });
});
