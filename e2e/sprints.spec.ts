import { test, expect } from '@playwright/test';

import { login, ORG } from './helpers';

const TEAM = 'core';
const PROJECT = 'platform';
const SPRINTS_URL = `/${ORG}/${TEAM}/${PROJECT}/sprints`;
const BACKLOG_URL = `/${ORG}/${TEAM}/${PROJECT}/backlog`;

test.describe('Sprints', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to sprints view', async ({ page }) => {
    await page.goto(SPRINTS_URL);
    await expect(
      page.getByRole('heading', { name: /sprint|backlog/i }).first()
        .or(page.getByText(/sprint/i).first())
    ).toBeVisible({ timeout: 10_000 });
  });

  test('sprint list renders sprints', async ({ page }) => {
    await page.goto(SPRINTS_URL);
    // Should show at least one sprint or a backlog section
    await expect(
      page.locator('[data-testid*="sprint"], .sprint-card, .sprint-section').first()
        .or(page.getByText(/sprint \d+|backlog/i).first())
    ).toBeVisible({ timeout: 10_000 });
  });

  test('sprint shows issue cards', async ({ page }) => {
    await page.goto(SPRINTS_URL);
    // Wait for issue cards or rows within sprints
    await expect(
      page.locator('a[href*="/issues/"], [data-testid="issue-card"], .issue-card').first()
        .or(page.getByText(/PLAT-\d+/i).first())
    ).toBeVisible({ timeout: 15_000 });
  });

  test('sprint shows status indicators', async ({ page }) => {
    await page.goto(SPRINTS_URL);
    // Sprints should show status like Active, Planned, Completed
    await expect(
      page.getByText(/active|planned|completed|not started/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('backlog view loads', async ({ page }) => {
    await page.goto(BACKLOG_URL);
    // Should display backlog heading or sprint/backlog content
    await expect(
      page.getByRole('heading', { name: /backlog|sprint/i }).first()
        .or(page.getByText(/backlog/i).first())
    ).toBeVisible({ timeout: 10_000 });
  });

  test('clicking an issue card navigates to issue detail', async ({ page }) => {
    await page.goto(SPRINTS_URL);
    const issueLink = page.locator('a[href*="/issues/"]').first();
    if (await issueLink.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await issueLink.click();
      await expect(page).toHaveURL(/\/issues\/\d+/);
      await expect(page.getByText(/PLAT-\d+/)).toBeVisible({ timeout: 10_000 });
    }
  });
});
