import { test, expect, type Page } from '@playwright/test';

import { login, ORG } from './helpers';

const TEAM = 'core';
const PROJECT = 'platform';
// Sprints are managed on the backlog page; the seed has an active "Sprint 1"
// (PLAT-1, PLAT-2) and a planned "Sprint 2" (PLAT-4).
const BACKLOG_URL = `/${ORG}/${TEAM}/${PROJECT}/backlog`;

/** The header row of each sprint panel (the sidebar summary repeats names and statuses). */
function sprintHeaders(page: Page) {
  return page.locator('div:has(> button[title="Collapse sprint"])');
}

test.describe('Sprints', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('backlog view loads', async ({ page }) => {
    await page.goto(BACKLOG_URL);
    await expect(page.getByRole('heading', { name: 'Backlog', level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: /create sprint/i })).toBeVisible();
  });

  test('sprint list renders sprints', async ({ page }) => {
    await page.goto(BACKLOG_URL);
    await expect(sprintHeaders(page)).toHaveCount(2, { timeout: 10_000 });
    await expect(sprintHeaders(page).filter({ hasText: 'Sprint 1' })).toBeVisible();
    await expect(sprintHeaders(page).filter({ hasText: 'Sprint 2' })).toBeVisible();
  });

  test('sprint shows issue cards', async ({ page }) => {
    await page.goto(BACKLOG_URL);
    await expect(page.getByRole('button', { name: 'Set up CI/CD pipeline' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: 'Add rate limiting to API' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'User profile editing' })).toBeVisible();
  });

  test('sprint shows status indicators', async ({ page }) => {
    await page.goto(BACKLOG_URL);
    await expect(sprintHeaders(page).filter({ hasText: 'Sprint 1' })).toContainText('ACTIVE', {
      timeout: 10_000,
    });
    await expect(sprintHeaders(page).filter({ hasText: 'Sprint 2' })).toContainText('PLANNING');
  });

  test('clicking an issue card navigates to issue detail', async ({ page }) => {
    await page.goto(BACKLOG_URL);
    await page.getByRole('button', { name: 'Set up CI/CD pipeline' }).click();
    await expect(page).toHaveURL(/\/issues\/1$/, { timeout: 10_000 });
    await expect(page.getByText(/PLAT-1\b/).first()).toBeVisible({ timeout: 10_000 });
  });
});
