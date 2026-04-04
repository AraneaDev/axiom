import { test, expect } from '@playwright/test';

import { DEMO_USERS, login, ORG } from './helpers';

const TEAM = 'axiom';
const PROJECT = 'axiom-mvp';
const CUSTOM_FIELDS_URL = `/${ORG}/${TEAM}/${PROJECT}/settings/fields`;
const ISSUES_URL = `/${ORG}/${TEAM}/${PROJECT}/issues`;

test.describe('Custom Fields', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USERS.admin);
  });

  test('can view custom fields settings page', async ({ page }) => {
    await page.goto(CUSTOM_FIELDS_URL);
    await expect(page.getByRole('heading', { name: /custom fields/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: /add field/i })).toBeVisible();
  });

  test('can create a new text custom field', async ({ page }) => {
    await page.goto(CUSTOM_FIELDS_URL);
    await expect(page.getByRole('heading', { name: /custom fields/i }).first()).toBeVisible({
      timeout: 10_000,
    });

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
    await page.goto(CUSTOM_FIELDS_URL);
    await expect(page.getByRole('heading', { name: /custom fields/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: /add field/i }).click();

    await page.getByLabel('Name').fill('E2E Select Field');

    // Change type to Select
    await page.getByLabel('Type').selectOption('SELECT');

    // Options input should now appear
    await page.getByLabel(/options/i).fill('Alpha, Beta, Gamma');

    await page.getByRole('button', { name: /create field/i }).click();

    await expect(page.getByText('E2E Select Field').first()).toBeVisible({ timeout: 10_000 });
    // Options should be shown beneath the field
    await expect(page.getByText(/Alpha.*Beta.*Gamma/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('custom field appears on issue detail', async ({ page }) => {
    // First create a custom field
    await page.goto(CUSTOM_FIELDS_URL);
    await expect(page.getByRole('heading', { name: /custom fields/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: /add field/i }).click();
    await page.getByLabel('Name').fill('E2E Detail Field');
    await page.getByRole('button', { name: /create field/i }).click();
    await expect(page.getByText('E2E Detail Field').first()).toBeVisible({ timeout: 10_000 });

    // Navigate to any existing issue
    await page.goto(ISSUES_URL);
    await expect(page.locator('a[href*="/issues/"]').first()).toBeVisible({ timeout: 10_000 });
    await page.locator('a[href*="/issues/"]').first().click();
    await expect(page).toHaveURL(/\/issues\/\d+/, { timeout: 10_000 });

    // The custom field should be rendered in the issue sidebar/detail panel
    await expect(page.getByText('E2E Detail Field').first()).toBeVisible({ timeout: 10_000 });
  });

  test('can delete a custom field with confirmation', async ({ page }) => {
    // Create a field to delete
    await page.goto(CUSTOM_FIELDS_URL);
    await expect(page.getByRole('heading', { name: /custom fields/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: /add field/i }).click();
    await page.getByLabel('Name').fill('delete-me-field');
    await page.getByRole('button', { name: /create field/i }).click();
    await expect(page.getByText('delete-me-field').first()).toBeVisible({ timeout: 10_000 });

    // Click the delete button for this field (last one added)
    await page.getByTitle('Delete field').last().click();

    // Confirm dialog should appear
    await expect(page.getByText(/delete custom field/i).first()).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /^delete$/i }).click();

    // Field should be removed
    await expect(page.getByText('delete-me-field')).not.toBeVisible({ timeout: 10_000 });
  });
});
