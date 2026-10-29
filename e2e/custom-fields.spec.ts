import { test, expect, type Page } from '@playwright/test';

import { DEMO_USERS, login, ORG, issueLinks } from './helpers';

const TEAM = 'core';
const PROJECT = 'platform';
const CUSTOM_FIELDS_URL = `/${ORG}/${TEAM}/${PROJECT}/settings/fields`;
const ISSUES_URL = `/${ORG}/${TEAM}/${PROJECT}/issues`;

/**
 * Open the custom fields settings page and wait for the seeded field to load. Without
 * the wait, actions can race the initial empty list (which renders its own "Add Field"
 * button).
 */
async function gotoCustomFields(page: Page) {
  await page.goto(CUSTOM_FIELDS_URL);
  await expect(page.getByRole('heading', { name: /custom fields/i }).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('Customer', { exact: true })).toBeVisible({ timeout: 10_000 });
}

test.describe('Custom Fields', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USERS.admin);
  });

  test('can view custom fields settings page', async ({ page }) => {
    await gotoCustomFields(page);
    await expect(page.getByRole('button', { name: /add field/i })).toBeVisible();
  });

  test('can create a new text custom field', async ({ page }) => {
    await gotoCustomFields(page);

    // Open the add form
    await page.getByRole('button', { name: /add field/i }).click();

    // Fill in field name
    await page.getByLabel('Name').fill('E2E Text Field');

    // Type defaults to TEXT — submit directly
    await page.getByRole('button', { name: /create field/i }).click();

    // New field should appear in the list
    await expect(page.getByText('E2E Text Field').first()).toBeVisible({ timeout: 10_000 });
  });

  test('can create a select custom field with options', async ({ page }) => {
    await gotoCustomFields(page);

    await page.getByRole('button', { name: /add field/i }).click();

    await page.getByLabel('Name').fill('E2E Select Field');

    // Change type to Select
    await page.getByLabel('Type').click();
    await page.getByRole('button', { name: 'Select', exact: true }).click();

    // Options input should now appear
    await page.getByLabel(/options/i).fill('Alpha, Beta, Gamma');

    await page.getByRole('button', { name: /create field/i }).click();

    await expect(page.getByText('E2E Select Field').first()).toBeVisible({ timeout: 10_000 });
    // Options should be shown beneath the field
    await expect(page.getByText(/Alpha.*Beta.*Gamma/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('custom field appears on issue detail', async ({ page }) => {
    // First create a custom field
    await gotoCustomFields(page);

    await page.getByRole('button', { name: /add field/i }).click();
    await page.getByLabel('Name').fill('E2E Detail Field');
    await page.getByRole('button', { name: /create field/i }).click();
    await expect(page.getByText('E2E Detail Field').first()).toBeVisible({ timeout: 10_000 });

    // Navigate to any existing issue
    await page.goto(ISSUES_URL);
    await expect(issueLinks(page).first()).toBeVisible({ timeout: 10_000 });
    await issueLinks(page).first().click();
    await expect(page).toHaveURL(/\/issues\/\d+/, { timeout: 10_000 });

    // The custom field should be rendered in the issue sidebar/detail panel
    await expect(page.getByText('E2E Detail Field').first()).toBeVisible({ timeout: 10_000 });
  });

  test('can delete a custom field with confirmation', async ({ page }) => {
    // Create a field to delete
    await gotoCustomFields(page);

    await page.getByRole('button', { name: /add field/i }).click();
    await page.getByLabel('Name').fill('delete-me-field');
    await page.getByRole('button', { name: /create field/i }).click();
    await expect(page.getByText('delete-me-field').first()).toBeVisible({ timeout: 10_000 });

    // Click the delete button in the row of the field we just created
    await page
      .locator('div:has(> button[title="Delete field"])')
      .filter({ hasText: 'delete-me-field' })
      .getByTitle('Delete field')
      .click();

    // Confirm dialog should appear
    await expect(page.getByText(/delete custom field/i).first()).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /^delete$/i }).click();

    // Field should be removed
    await expect(page.getByText('delete-me-field')).toHaveCount(0, { timeout: 10_000 });
  });
});
