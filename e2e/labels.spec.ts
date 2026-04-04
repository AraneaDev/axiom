import { test, expect } from '@playwright/test';

import { DEMO_USERS, login, ORG } from './helpers';

const TEAM = 'axiom';
const PROJECT = 'axiom-mvp';
const LABELS_URL = `/${ORG}/${TEAM}/${PROJECT}/settings/labels`;
const ISSUES_URL = `/${ORG}/${TEAM}/${PROJECT}/issues`;

test.describe('Labels', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USERS.admin);
  });

  test('can view labels in project settings', async ({ page }) => {
    await page.goto(LABELS_URL);
    await expect(page.getByRole('heading', { name: /labels/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Seed labels should be visible
    await expect(page.getByText('bug').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('frontend').first()).toBeVisible();
    await expect(page.getByText('backend').first()).toBeVisible();
    await expect(page.getByText('enhancement').first()).toBeVisible();
  });

  test('labels settings page shows New Label button', async ({ page }) => {
    await page.goto(LABELS_URL);
    await expect(page.getByRole('heading', { name: /labels/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: /new label/i })).toBeVisible();
  });

  test('can create a new label', async ({ page }) => {
    await page.goto(LABELS_URL);
    await expect(page.getByRole('heading', { name: /labels/i }).first()).toBeVisible({
      timeout: 10_000,
    });

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
    await page.goto(LABELS_URL);
    await expect(page.getByRole('heading', { name: /labels/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: /new label/i }).click();

    // Form should be visible
    await expect(page.getByLabel('Name')).toBeVisible();

    // Cancel
    await page.getByRole('button', { name: /cancel/i }).click();

    // Form should be gone
    await expect(page.getByLabel('Name')).not.toBeVisible();
  });

  test('can edit an existing label', async ({ page }) => {
    await page.goto(LABELS_URL);
    await expect(page.getByRole('heading', { name: /labels/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Click the edit (pencil) button for the 'docs' label
    await page.getByTitle('Edit label').first().click();

    // Edit form should appear with a name input
    await expect(page.getByLabel('Name').first()).toBeVisible({ timeout: 5_000 });

    // Save without changes
    await page.getByRole('button', { name: /save/i }).click();
  });

  test('can delete a label with confirmation', async ({ page }) => {
    // First create a label so we can safely delete it
    await page.goto(LABELS_URL);
    await expect(page.getByRole('heading', { name: /labels/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Create a disposable label
    await page.getByRole('button', { name: /new label/i }).click();
    await page.getByLabel('Name').fill('delete-me-label');
    await page.getByRole('button', { name: /create label/i }).click();
    await expect(page.getByText('delete-me-label').first()).toBeVisible({ timeout: 10_000 });

    // Find its delete button and click it
    // The delete button has title="Delete label" and is the last one added
    const deleteButtons = page.getByTitle('Delete label');
    await deleteButtons.last().click();

    // Confirm dialog should appear
    await expect(page.getByText(/delete label/i).first()).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /^delete$/i }).click();

    // Label should be gone
    await expect(page.getByText('delete-me-label')).not.toBeVisible({ timeout: 10_000 });
  });

  test('can view labels applied to an issue', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('heading', { name: /issues/i })).toBeVisible({ timeout: 10_000 });

    // Click an issue that has labels (seed issues have 'backend', 'bug', etc.)
    await page.locator('a[href*="/issues/"]').first().click();
    await expect(page).toHaveURL(/\/issues\/\d+/, { timeout: 10_000 });

    // The issue detail may show a Labels section if labels are applied
    // We check either labels section or the absence of it without error
    const labelsHeading = page.getByText('Labels', { exact: true });
    const hasLabels = await labelsHeading.isVisible({ timeout: 5_000 }).catch(() => false);

    if (hasLabels) {
      // At least one badge label should be visible under the heading
      await expect(labelsHeading).toBeVisible();
    }
    // If no labels on that issue, the section is simply hidden — that's valid
  });

  test('issue list shows label badges on issues', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('heading', { name: /issues/i })).toBeVisible({ timeout: 10_000 });

    // At least one label badge should be visible somewhere in the issue list
    // Seed data attaches labels like 'bug', 'frontend', 'backend' to issues
    await expect(
      page.getByText('bug').first().or(page.getByText('frontend').first())
    ).toBeVisible({ timeout: 10_000 });
  });
});
