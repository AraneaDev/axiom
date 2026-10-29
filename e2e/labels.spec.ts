import { test, expect, type Page } from '@playwright/test';

import { DEMO_USERS, login, ORG } from './helpers';

const TEAM = 'core';
const PROJECT = 'platform';
const LABELS_URL = `/${ORG}/${TEAM}/${PROJECT}/settings/labels`;
const ISSUES_URL = `/${ORG}/${TEAM}/${PROJECT}/issues`;

/**
 * Open the labels settings page and wait for the seeded labels to load. Without
 * the wait, actions can race the initial empty list (which renders its own
 * "New Label" button).
 */
async function gotoLabels(page: Page) {
  await page.goto(LABELS_URL);
  await expect(page.getByRole('heading', { name: /labels/i }).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('enhancement').first()).toBeVisible({ timeout: 10_000 });
}

test.describe('Labels', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USERS.admin);
  });

  test('can view labels in project settings', async ({ page }) => {
    await gotoLabels(page);

    // Seed labels should be visible
    await expect(page.getByText('bug').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('frontend').first()).toBeVisible();
    await expect(page.getByText('backend').first()).toBeVisible();
    await expect(page.getByText('enhancement').first()).toBeVisible();
  });

  test('labels settings page shows New Label button', async ({ page }) => {
    await gotoLabels(page);
    await expect(page.getByRole('button', { name: /new label/i })).toBeVisible();
  });

  test('can create a new label', async ({ page }) => {
    await gotoLabels(page);

    // Open the add form
    await page.getByRole('button', { name: /new label/i }).click();

    // Fill in label name
    await page.getByLabel('Name').fill('e2e-test-label');

    // Save
    await page.getByRole('button', { name: /create label/i }).click();

    // New label should appear in the list
    await expect(page.getByText('e2e-test-label').first()).toBeVisible({ timeout: 10_000 });
  });

  test('create label form can be cancelled', async ({ page }) => {
    await gotoLabels(page);

    await page.getByRole('button', { name: /new label/i }).click();

    // Form should be visible
    await expect(page.getByLabel('Name')).toBeVisible();

    // Cancel
    await page.getByRole('button', { name: /cancel/i }).click();

    // Form should be gone
    await expect(page.getByLabel('Name')).not.toBeVisible();
  });

  test('can edit an existing label', async ({ page }) => {
    await gotoLabels(page);

    // Click the edit (pencil) button for the 'docs' label
    await page.getByTitle('Edit label').first().click();

    // Edit form should appear with a name input
    await expect(page.getByLabel('Name').first()).toBeVisible({ timeout: 5_000 });

    // Save without changes
    await page.getByRole('button', { name: /save/i }).click();
  });

  test('can delete a label with confirmation', async ({ page }) => {
    // First create a label so we can safely delete it
    await gotoLabels(page);

    // Create a disposable label
    await page.getByRole('button', { name: /new label/i }).click();
    await page.getByLabel('Name').fill('delete-me-label');
    await page.getByRole('button', { name: /create label/i }).click();
    await expect(page.getByText('delete-me-label').first()).toBeVisible({ timeout: 10_000 });

    // Click the delete button in the row of the label we just created (the list is
    // sorted, so the new label is not necessarily the last row)
    const row = page
      .locator('div:has(> button[title="Delete label"])')
      .filter({ hasText: 'delete-me-label' });
    await row.getByTitle('Delete label').click();

    // Confirm dialog should appear
    await expect(page.getByText(/delete label/i).first()).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /^delete$/i }).click();

    // Label should be gone
    await expect(page.getByText('delete-me-label')).toHaveCount(0, { timeout: 10_000 });
  });

  test('can view labels applied to an issue', async ({ page }) => {
    // PLAT-3 is seeded with the labels 'bug' and 'frontend'
    await page.goto(`${ISSUES_URL}/3`);
    await expect(page.getByText('PLAT-3').first()).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText('Labels', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('bug', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('frontend', { exact: true }).first()).toBeVisible();
  });

  test('issue list shows label badges on issues', async ({ page }) => {
    await page.goto(ISSUES_URL);

    // PLAT-6 is seeded with the labels 'bug' and 'backend'
    const row = page.getByRole('link', { name: /PLAT-6/ });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText('bug', { exact: true })).toBeVisible();
    await expect(row.getByText('backend', { exact: true })).toBeVisible();
  });
});
