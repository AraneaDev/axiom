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

  test('org settings page loads', async ({ page }) => {
    await page.goto(`/${ORG}/settings`);
    await expect(
      page.getByRole('heading', { name: /settings/i }).first()
        .or(page.getByText(/settings/i).first())
    ).toBeVisible({ timeout: 10_000 });
  });
});
