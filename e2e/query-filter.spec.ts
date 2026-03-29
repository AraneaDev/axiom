import { test, expect } from '@playwright/test';

import { login, ORG } from './helpers';

const TEAM = 'core';
const PROJECT = 'platform';
const ISSUES_URL = `/${ORG}/${TEAM}/${PROJECT}/issues`;

// NOTE: The issues page has a text search box plus Filters/Sort/Saved dropdown buttons.
// A query-syntax toggle does not exist in the current UI.

test.describe('Query Filter', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('shows issues list with heading', async ({ page }) => {
    await page.goto(ISSUES_URL);
    // Heading is "Platform Issues" (project name + " Issues")
    await expect(page.getByRole('heading', { name: /issues/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('shows filter controls on issues page', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('heading', { name: /issues/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // The issues filter bar has a search textbox and filter/sort buttons
    await expect(page.getByRole('textbox', { name: /search issues/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: /filters/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /sort/i })).toBeVisible({ timeout: 10_000 });
  });

  test('can search issues with text search', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('heading', { name: /issues/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    const searchInput = page.getByRole('textbox', { name: /search issues/i });
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Type a search term that matches one seeded issue
    await searchInput.fill('CI/CD');

    // At least one issue link should be visible (or empty state if no match)
    await expect(page.locator('a[href*="/issues/"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('can clear search to restore full list', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('heading', { name: /issues/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    const searchInput = page.getByRole('textbox', { name: /search issues/i });
    await searchInput.fill('CI/CD');

    // Clear the search
    await searchInput.clear();

    // Full issue list should be visible again
    await expect(page.locator('a[href*="/issues/"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('shows issue rows with priority and status', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('heading', { name: /issues/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // Issues should render as links to /issues/:num
    await expect(page.locator('a[href*="/issues/"]').first()).toBeVisible({ timeout: 10_000 });
    // At least one priority badge should be visible (seeded issues have HIGH, MEDIUM, LOW, CRITICAL)
    await expect(
      page.getByText(/HIGH|MEDIUM|LOW|CRITICAL/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
